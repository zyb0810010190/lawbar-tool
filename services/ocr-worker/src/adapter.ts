// OCR job adapter. Sits between the web app and a queue backend.
//
// Step 10B: the adapter now drives a *lease-aware* backend
// (`OcrJobQueueBackend`). The flow is:
//
//   claimNext(workerId) → worker.process(claim.job)
//     → completeClaim(claim)            on success
//     → requeueClaim(claim)             on thrown error or contract violation
//
// The adapter still validates submissions on enqueue and re-validates the
// emitted status sequence + every result before returning. Persistence
// writes are NOT performed here — they live above (today's
// `ingestDocumentForOcr`, tomorrow's coordinator). The queue is transport
// only.
//
// Note on `transient_then_success`: the fake worker bundles the full retry
// trajectory (failed → queued → claimed → processing → succeeded) into a
// single outcome. A real worker would emit one attempt per call and the
// queue would re-claim on failure. This adapter is honest about that
// simplification — it forwards whatever outcome the worker produced and
// re-validates the chain. The split-per-attempt happens once a coordinator
// loop is wired in.

import { randomUUID } from "node:crypto";

import { validateOcrSubmission, type OcrJobOutcome } from "ocr-worker-contract";
import { processFakeOcrJob } from "ocr-worker-contract/testing";

import { InMemoryOcrQueue } from "./inMemoryQueue.js";
import { validateWorkerOutcomeContract } from "./outcomeValidation.js";
import {
  OcrAdapterError,
  type EnqueueResult,
  type OcrJob,
  type OcrJobQueueBackend,
  type OcrWorker,
  type ProcessResult,
} from "./types.js";

export interface OcrJobAdapterOptions {
  /** Defaults to a fresh in-memory lease-aware queue. */
  backend?: OcrJobQueueBackend;
  /** Defaults to a worker that wraps `processFakeOcrJob`. */
  worker?: OcrWorker;
  /** Deterministic clock for `enqueued_at`. Default: `() => new Date()`. */
  now?: () => Date;
  /** Deterministic id generator for the transport `OcrJob.id`. */
  generateId?: () => string;
  /**
   * Stable worker identity used on `claimNext`. Default: `adapter-${uuid}`.
   * Audit/debug only — the queue does not authenticate workers.
   */
  workerId?: string;
}

const defaultWorker: OcrWorker = {
  async process(job: OcrJob): Promise<OcrJobOutcome> {
    return processFakeOcrJob(job.submission, {
      scenario: job.scenario ?? "success",
    });
  },
};

/**
 * Type intersection used when calling the optional `pendingCount` helper on
 * the concrete `InMemoryOcrQueue`. The interface intentionally exposes no
 * size method; tests reach through this narrow seam instead of widening the
 * contract.
 */
type WithPendingCount = OcrJobQueueBackend & {
  pendingCount?: () => number;
};

export class OcrJobAdapter {
  private readonly backend: OcrJobQueueBackend;
  private readonly worker: OcrWorker;
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private readonly workerId: string;

  constructor(options: OcrJobAdapterOptions = {}) {
    this.backend = options.backend ?? new InMemoryOcrQueue();
    this.worker = options.worker ?? defaultWorker;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => randomUUID());
    this.workerId = options.workerId ?? `adapter-${randomUUID()}`;
  }

  /**
   * Validate the submission and put it on the queue. Returns the
   * *canonical* queued record plus a `deduped` flag.
   *
   * If `deduped` is `false` the candidate was newly enqueued and the
   * returned `job` carries the freshly-minted transport id and enqueue
   * timestamp. If `deduped` is `true` the backend already had an active
   * job with the same `submission.job_id` and an equal canonical
   * submission — the returned `job` is the *previously* queued record, so
   * its `id` / `enqueued_at` / `scenario` reflect the original submission.
   * Callers that care should treat `job` as authoritative either way.
   *
   * `scenario` is a test-only escape hatch for forcing a specific worker
   * outcome. Production callers omit it.
   */
  async enqueueOcrJob(
    submission: unknown,
    opts: { scenario?: OcrJob["scenario"] } = {},
  ): Promise<EnqueueResult> {
    const result = validateOcrSubmission(submission);
    if (!result.ok) {
      throw new OcrAdapterError(`invalid submission: ${result.summary}`);
    }
    // Deep-clone the validated submission. Ajv returns the input by reference
    // and the caller still holds it; without a clone, mutating the submission
    // after enqueue would change what the queue dispatches to the worker.
    const candidate: OcrJob = {
      id: this.generateId(),
      submission: structuredClone(result.value),
      enqueued_at: this.now().toISOString(),
      ...(opts.scenario !== undefined ? { scenario: opts.scenario } : {}),
    };
    // The backend returns the canonical queued record (its own clone);
    // forward that to the caller verbatim.
    return this.backend.enqueue(candidate);
  }

  /**
   * Process a specific job. Used by callers that already hold a job
   * reference (tests, retry handlers). Validates the worker's outputs AND
   * that the outputs are bound to the submitted job (job_id, tenant_id,
   * document_id, page_id, page_number, document_revision) before returning.
   * A misbehaving or compromised worker cannot return outputs belonging to
   * a different job/tenant/document.
   */
  async processOcrJob(job: OcrJob): Promise<ProcessResult> {
    const outcome = await this.worker.process(job);
    this.assertOutcomeContractValid(outcome, job);
    return { job, outcome };
  }

  /**
   * Claim the next available job and process it. Returns null when the
   * queue is empty (so callers can poll without exception-driven control
   * flow).
   *
   * On success → `completeClaim`. On thrown worker error OR
   * contract-violating outcome → `requeueClaim` and the original error
   * propagates. This preserves at-least-once semantics on the in-memory
   * backend: a thrown error never silently drops a job.
   *
   * Test scaffolding: this synchronous claim → process → resolve flow keeps
   * existing call sites (`ingestDocumentForOcr`, adapter tests) working
   * unchanged. A real coordinator loop would do the same dance on a timer
   * with concurrency.
   *
   * Lease-renew limitation (Step 10B):
   *   The compatibility path does NOT call `renewClaim` while the worker
   *   is processing. With the in-process fake worker this is fine — every
   *   call returns synchronously well within the default lease. For a
   *   long-running real worker, however, processing time may exceed the
   *   lease; the slot would then become reclaimable by another worker and
   *   the original `completeClaim` could surface `lease_expired` /
   *   `stale_receipt`. Periodic lease renewal is intentionally deferred to
   *   the Step 10C coordinator / long-running worker loop, where it
   *   belongs alongside concurrency control and back-off policy.
   */
  async processNextOcrJob(): Promise<ProcessResult | null> {
    const claim = await this.backend.claimNext(this.workerId);
    if (claim === null) return null;
    try {
      const result = await this.processOcrJob(claim.job);
      await this.backend.completeClaim(claim);
      return result;
    } catch (err) {
      // Restore the job so the caller can retry. We surface the original
      // error — they decide whether to retry, abandon, or escalate.
      try {
        await this.backend.requeueClaim(claim);
      } catch {
        // If the requeue itself fails (e.g. lease already expired and the
        // slot was reclaimed), don't shadow the original processing error.
      }
      throw err;
    }
  }

  /**
   * Current queue depth (waiting + claimed).
   *
   * This is **test-only support**. `OcrJobQueueBackend` deliberately does
   * not expose a `size` operation — production backends (BullMQ, Redis)
   * cannot answer it cheaply or atomically. The adapter reaches through
   * to a concrete backend's optional `pendingCount` helper (e.g. on
   * `InMemoryOcrQueue`) when present. If the wired backend does not expose
   * that helper, this method throws `OcrAdapterError` rather than silently
   * returning a misleading 0 — silent zeroes were the cause of the
   * original Codex finding (#5).
   */
  async pendingCount(): Promise<number> {
    const b = this.backend as WithPendingCount;
    if (typeof b.pendingCount !== "function") {
      throw new OcrAdapterError(
        "pendingCount is test-only support and is not implemented by this backend",
      );
    }
    return b.pendingCount();
  }

  // -------------------------------------------------------------------------
  // Output validation
  // -------------------------------------------------------------------------

  private assertOutcomeContractValid(
    outcome: OcrJobOutcome,
    job: OcrJob,
  ): void {
    const v = validateWorkerOutcomeContract(outcome, job);
    if (!v.ok) {
      throw new OcrAdapterError(v.reason);
    }
  }
}
