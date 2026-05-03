// OCR queue transport types.
//
// Step 10I-A relocates these symbols out of `ocr-worker-adapter` and into the
// neutral contract package per ADR `docs/adr/ocr-queue-boundary-amendment-step-10h-a.md`.
// `ocr-worker-adapter` re-exports them so existing imports keep compiling;
// `ocr-persistence` (10I-B) will import from here directly to avoid the
// `ocr-worker` ↔ `ocr-persistence` runtime cycle.
//
// These are *transport-only* types: the queue owns claims, leases, and
// receipts; it does NOT write OCR contract statuses or results. Persistence
// ownership lives one layer above (the adapter / coordinator). A future
// SQLite or BullMQ implementation will plug in behind the same interface;
// nothing here imports a queue runtime, Redis, BullMQ, or SQLite.
//
// `OcrJob.scenario` is a fake-worker / dev / test seam (see ADR §8). 10I-A
// preserves it unchanged; 10I-B picks how it crosses the production boundary.

import type { FakeScenario } from "./testing/fake-worker.js";

/**
 * Internal representation of a queued OCR job. The `submission` field is
 * `unknown` because the adapter validates it on enqueue; once stored, the
 * job is trusted to the extent the contract validator trusted it.
 *
 * `id` is an adapter-assigned transport id (audit/trace only). The
 * canonical *logical* job identity is `submission.job_id`. The queue
 * backend's dedupe semantics key on `submission.job_id`, never on `id`.
 */
export interface OcrJob {
  /** Adapter-assigned transport id. NOT used as a queue dedupe key. */
  id: string;
  /** Original, contract-valid submission payload. */
  submission: unknown;
  /** When the adapter accepted the job. */
  enqueued_at: string;
  /**
   * Test-only hook: forces a specific scenario when this job is processed.
   * Production callers leave this undefined; the worker decides reality.
   */
  scenario?: FakeScenario;
}

/**
 * A lease over a queued job. Returned by `claimNext` and required by
 * every operation that resolves the claim. The `receipt` field is the
 * opaque, backend-assigned token that authorizes renew/complete/requeue;
 * callers must treat it as a black box. The `job_id` field equals
 * `submission.job_id` (the logical job id), NOT the transport `OcrJob.id`.
 */
export interface OcrQueueClaim {
  /** Logical job id — equals (claim.job.submission as { job_id }).job_id. */
  job_id: string;
  /** The dispatched job payload. Consumers MUST NOT mutate. */
  job: OcrJob;
  /** Identifier of the worker holding the lease. Audit/debug only. */
  worker_id: string;
  /** When the backend issued the claim. ISO-8601, backend clock. */
  claimed_at: string;
  /** Lease deadline. After this instant the receipt becomes stale. */
  lease_expires_at: string;
  /** Opaque, backend-assigned authorization token. */
  receipt: string;
}

/**
 * Outcome of an `enqueue` call.
 *
 * `deduped: true` means the backend already had an active job with the same
 * `submission.job_id` and an equal canonical submission, so the incoming
 * candidate was discarded and the *existing* canonical queued record is
 * returned. Callers that observe `deduped: true` should treat the returned
 * `job` as authoritative — its `id` / `enqueued_at` / `scenario` belong to
 * the previously-queued record, not the candidate that was just submitted.
 */
export interface EnqueueResult {
  job: OcrJob;
  deduped: boolean;
}

/**
 * The lease-aware queue backend seam. Step 10B intentionally exposes only
 * transport operations — no `dequeue`, no `size`, no priority, no
 * delayed/scheduled requeue. Test introspection (queue depth) is an
 * implementation-specific helper on `InMemoryOcrQueue`, not on this
 * interface.
 */
export interface OcrJobQueueBackend {
  /**
   * Place a job onto the waiting set.
   *
   * Dedupe (Step 10B scope = active queue only):
   *   - if NO active queued/claimed job has the same `submission.job_id`,
   *     the job is appended to the waiting tail and returned with
   *     `deduped: false`;
   *   - if an active job exists AND the canonical validated submission
   *     payloads are equal, this is an idempotent no-op: the *canonical
   *     queued* record is returned with `deduped: true`. The candidate's
   *     transport metadata (`id`, `enqueued_at`, `scenario`) is discarded;
   *   - if an active job exists AND submissions differ, throws
   *     `OcrQueueError("dedupe_conflict")`.
   *
   * Equality is over the canonicalized validated submission payload only.
   * Transport metadata (`OcrJob.id`, `enqueued_at`, `scenario`) is NOT part
   * of dedupe equality. Completed and abandoned jobs are out of scope for
   * 10B dedupe — rerun semantics are deferred.
   *
   * The returned `job` is a defensive clone of what the backend stores;
   * mutating it does not affect queue state.
   */
  enqueue(job: OcrJob): Promise<EnqueueResult>;

  /**
   * Atomically lease the next available job to `workerId`. Returns null
   * when no waiting job is available. The returned claim carries an
   * opaque receipt; the same receipt MUST be passed back to renew /
   * complete / requeue. Backend clock decides `claimed_at` and
   * `lease_expires_at`. Lease length is a backend-internal default.
   *
   * Ordering: at concurrency 1, with no priority and no delayed jobs,
   * first delivery from the waiting set is FIFO. Re-deliveries after
   * lease expiry or explicit requeue are NOT guaranteed to preserve
   * original order.
   */
  claimNext(workerId: string): Promise<OcrQueueClaim | null>;

  /**
   * Extend the lease on an active claim. The receipt is unchanged — only
   * `lease_expires_at` is bumped. Throws `OcrQueueError`:
   *   - `unknown_receipt` if the receipt was never issued or has already
   *     been resolved (complete/requeue);
   *   - `lease_expired` if the receipt was valid but its lease is already
   *     past — the slot is now reclaimable;
   *   - `stale_receipt` if a different receipt now owns the same logical
   *     job (the slot was re-claimed after expiry).
   */
  renewClaim(claim: OcrQueueClaim): Promise<OcrQueueClaim>;

  /**
   * Resolve the claim as successful. Removes the active claim. Throws
   * `OcrQueueError` for unknown/expired/stale receipts using the same
   * codes as `renewClaim`.
   */
  completeClaim(claim: OcrQueueClaim): Promise<void>;

  /**
   * Resolve the claim as not-yet-done. The job returns to the waiting set
   * and becomes claimable again. Throws `OcrQueueError` for
   * unknown/expired/stale receipts using the same codes as `renewClaim`.
   */
  requeueClaim(claim: OcrQueueClaim): Promise<void>;

  /** Optional teardown for backends that hold connections. */
  close?(): Promise<void>;
}

/**
 * Stable, discriminated error raised by `OcrJobQueueBackend` implementations.
 * Codes are part of the contract — callers (compat adapter, future
 * coordinator, SqliteOcrQueue) match on `code`, not on `message`.
 */
export type OcrQueueErrorCode =
  | "dedupe_conflict"   // enqueue with same job_id but different payload
  | "unknown_receipt"   // receipt was never issued or already resolved
  | "stale_receipt"     // receipt is no longer the active owner of the slot
  | "lease_expired"     // receipt is past its lease but not yet re-claimed
  | "invalid_claim";    // malformed claim object (missing/empty fields)

export class OcrQueueError extends Error {
  readonly code: OcrQueueErrorCode;
  constructor(code: OcrQueueErrorCode, message: string) {
    super(message);
    this.name = "OcrQueueError";
    this.code = code;
  }
}
