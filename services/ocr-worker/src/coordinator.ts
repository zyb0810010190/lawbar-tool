// OCR processing coordinator (Step 10C).
//
// This module owns the lifecycle wiring between the lease-aware queue
// (Step 10B), the persistence layer (Step 10A), and a worker. The queue
// stays transport-only; persistence stays the source of truth; the
// coordinator is the *only* place that decides:
//
//   - whether the next claim should be processed, ack'd, or requeued;
//   - which transitions are persisted, by whom, and in what order;
//   - how queue / persistence / worker errors fan out into a small,
//     discriminated outcome union.
//
// The full decision matrix lives in
//   /Users/zhongyibao/docs/adr/ocr-processing-coordinator-step-10c.md
// — that document is the spec; this file is the implementation.
//
// Step 10C is intentionally NOT a worker loop. One call =
// `processOneOcrQueueClaim` runs at most one claim through. A future
// Step 10D coordinator loop adds concurrency, lease renewal, and
// back-off. The single-shot shape lets every test pin time, queue
// state, and persistence state explicitly.

import { isTerminalState } from "ocr-worker-contract";
import type {
  OcrJobActor,
  OcrJobState,
  OcrResult,
  TransitionRecord,
} from "ocr-worker-contract";

import { validateWorkerOutcomeContract } from "./outcomeValidation.js";
import {
  OcrQueueError,
  type OcrJob,
  type OcrJobQueueBackend,
  type OcrQueueClaim,
  type OcrWorker,
} from "./types.js";

// ---------------------------------------------------------------------------
// Persistence port
// ---------------------------------------------------------------------------

/**
 * The minimal persistence surface the coordinator depends on. Defined
 * locally so `ocr-worker-adapter` does not take a hard package dependency
 * on `ocr-persistence`. The real `OcrPersistence` interface satisfies
 * this port structurally — TypeScript checks it at the seam.
 */
export interface OcrPersistencePort {
  /** Returns `null` if no job record exists for this `job_id`. */
  getOcrJob(jobId: string): Promise<{ terminal_state?: OcrJobState } | null>;
  /** Idempotent transition append. Throws on conflicting replay. */
  appendOcrStatusOnce(
    jobId: string,
    transition: TransitionRecord,
  ): Promise<unknown>;
  /** Idempotent per-page result write. Throws on conflicting replay. */
  saveOcrResultOnce(jobId: string, result: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Public outcome shape
// ---------------------------------------------------------------------------

/**
 * Discriminant for the coordinator's per-call result. Each variant maps
 * onto a documented branch in the ADR; tests assert on these strings.
 */
export type OcrCoordinatorOutcome =
  | "empty"
  | "completed"
  | "completed_already_terminal"
  | "requeued"
  | "persistence_failed"
  | "ack_failed"
  | "lease_lost";

export interface OcrCoordinatorResult {
  outcome: OcrCoordinatorOutcome;
  /** Logical job id. Present whenever a claim was acquired. */
  job_id?: string;
  /** Number of `appendOcrStatusOnce` calls that succeeded this turn. */
  statuses_persisted?: number;
  /** Number of `saveOcrResultOnce` calls that succeeded this turn. */
  results_persisted?: number;
  /**
   * Diagnostic context for non-`completed` / non-`empty` outcomes. `code`
   * carries the original `OcrQueueError.code` when the outcome was driven
   * by a queue ack failure; otherwise just `message`.
   */
  error?: { code?: string; message: string };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ProcessOneOcrQueueClaimOptions {
  queue: OcrJobQueueBackend;
  persistence: OcrPersistencePort;
  worker: OcrWorker;
  worker_id: string;
  /** Deterministic clock for the coordinator-owned `queued→claimed` write. */
  now?: () => Date;
}

export interface OcrProcessingCoordinatorOptions
  extends Omit<ProcessOneOcrQueueClaimOptions, never> {}

/**
 * Class-flavored convenience over `processOneOcrQueueClaim`. A future
 * worker loop will hold one of these and call `processOne()` on a timer
 * with concurrency.
 */
export class OcrProcessingCoordinator {
  constructor(private readonly opts: OcrProcessingCoordinatorOptions) {}

  processOne(): Promise<OcrCoordinatorResult> {
    return processOneOcrQueueClaim(this.opts);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the next available claim through the full coordinator lifecycle.
 * See the ADR for branch semantics.
 *
 * Never throws on documented failure modes — every documented outcome is
 * encoded in the return value. An unexpected internal error (e.g. a thrown
 * non-`OcrQueueError` from a custom queue backend) propagates so callers
 * can fail fast rather than silently swallow bugs.
 */
export async function processOneOcrQueueClaim(
  opts: ProcessOneOcrQueueClaimOptions,
): Promise<OcrCoordinatorResult> {
  const { queue, persistence, worker, worker_id } = opts;
  const now = opts.now ?? (() => new Date());

  // Step 1: claim
  const claim = await queue.claimNext(worker_id);
  if (claim === null) {
    return { outcome: "empty" };
  }

  // Step 2: read persisted job record
  const record = await persistence.getOcrJob(claim.job_id);
  if (record === null) {
    // ADR Decision 8 third bullet (B2): no persisted job record. Refuse to
    // run the worker, refuse to ack, attempt requeue so the claim is not
    // silently lost.
    return await tryRequeueAs(
      queue,
      claim,
      "persistence_failed",
      `no persisted job record for job_id=${claim.job_id}`,
    );
  }

  // Step 3: terminal redelivery short-circuit
  if (record.terminal_state !== undefined && isTerminalState(record.terminal_state)) {
    return await tryCompleteAlreadyTerminal(queue, claim);
  }

  // Step 4: persist coordinator-owned queued→claimed
  let statuses_persisted = 0;
  try {
    await persistence.appendOcrStatusOnce(claim.job_id, {
      from: "queued",
      to: "claimed",
      controlled_by: "queue" as OcrJobActor,
      at: now().toISOString(),
    });
    statuses_persisted = 1;
  } catch (err) {
    // ADR Decision 9: persistence conflict means the queue claim must NOT
    // be completed. We *do* requeue so the claim is recoverable on the
    // next delivery (the coordinator on the next turn will see the
    // existing persisted state and reconcile via the terminal-skip path
    // or replay-safe append). This avoids the silent drop that motivated
    // the rule, while keeping the divergence visible — every redelivery
    // re-evaluates persistence.
    return await tryRequeueAs(
      queue,
      claim,
      "persistence_failed",
      `appendOcrStatusOnce(queued→claimed) failed: ${errorMessage(err)}`,
    );
  }

  // Step 5: run worker. Any throw → requeue, no terminal persistence.
  let workerOutcome: Awaited<ReturnType<OcrWorker["process"]>>;
  try {
    workerOutcome = await worker.process(claim.job);
  } catch (err) {
    return await tryRequeueAs(
      queue,
      claim,
      "requeued",
      `worker threw: ${errorMessage(err)}`,
    );
  }

  // Step 6: contract + binding validation
  const validation = validateWorkerOutcomeContract(workerOutcome, claim.job);
  if (!validation.ok) {
    return await tryRequeueAs(queue, claim, "requeued", validation.reason);
  }

  // Step 7: Step-10C-specific normalization
  const norm = normalizeForStep10C(workerOutcome.statuses);
  if (!norm.ok) {
    return await tryRequeueAs(queue, claim, "requeued", norm.reason);
  }
  const transitionsToPersist = norm.transitions;
  const resultsToPersist: ReadonlyArray<OcrResult> = workerOutcome.results;

  // Step 8: persist statuses + results via replay-safe primitives
  let results_persisted = 0;
  try {
    for (const t of transitionsToPersist) {
      await persistence.appendOcrStatusOnce(claim.job_id, t);
      statuses_persisted++;
    }
    for (const r of resultsToPersist) {
      await persistence.saveOcrResultOnce(claim.job_id, r);
      results_persisted++;
    }
  } catch (err) {
    // ADR Decision 9: do NOT complete the claim on persistence conflict.
    // We also do not requeue here — the divergence should stay visible
    // (the lease will eventually expire and the queue will redeliver,
    // at which point the terminal-skip path or replay-safe append will
    // re-evaluate). Returning persistence_failed leaves the claim in
    // active state on the queue, which is the documented behavior.
    return {
      outcome: "persistence_failed",
      job_id: claim.job_id,
      statuses_persisted,
      results_persisted,
      error: { message: `persistence write failed: ${errorMessage(err)}` },
    };
  }

  // Step 9: complete
  try {
    await queue.completeClaim(claim);
  } catch (err) {
    if (err instanceof OcrQueueError) {
      const outcome = mapQueueErrorToAckOutcome(err);
      return {
        outcome,
        job_id: claim.job_id,
        statuses_persisted,
        results_persisted,
        error: { code: err.code, message: err.message },
      };
    }
    throw err;
  }

  return {
    outcome: "completed",
    job_id: claim.job_id,
    statuses_persisted,
    results_persisted,
  };
}

// ---------------------------------------------------------------------------
// Step 10C normalization
// ---------------------------------------------------------------------------

interface NormalizationOk {
  ok: true;
  transitions: TransitionRecord[];
}
interface NormalizationErr {
  ok: false;
  reason: string;
}
type NormalizationResult = NormalizationOk | NormalizationErr;

/**
 * Apply the ADR Decision 7 + Decision 12 detection rule to a worker
 * outcome's status sequence:
 *
 *   1. Drop a single leading `queued → claimed` (controlled_by=`queue`)
 *      if present — this is the duplicate the coordinator already wrote.
 *   2. Every remaining transition must be `controlled_by=`worker``.
 *      Any `queue` or `web_app` edge in the tail is a bundled-retry,
 *      lease-recovery, DLQ, or cancellation signal and must be rejected
 *      (not silently filtered).
 *   3. The remaining sequence must end at a worker terminal state
 *      admitted in Step 10C: `succeeded` or `partial_succeeded`.
 *      A worker outcome ending at `failed` is rejected because the next
 *      legal continuation (`failed → queued` / `failed → dead_lettered`)
 *      is queue-owned and out of Step 10C scope.
 */
function normalizeForStep10C(
  statuses: ReadonlyArray<TransitionRecord>,
): NormalizationResult {
  let working = statuses;
  const head = working[0];
  if (
    head !== undefined &&
    head.from === "queued" &&
    head.to === "claimed" &&
    head.controlled_by === "queue"
  ) {
    working = working.slice(1);
  }

  if (working.length === 0) {
    return {
      ok: false,
      reason:
        "worker outcome has no worker-owned transitions after stripping the leading queued→claimed",
    };
  }

  for (const t of working) {
    if (t.controlled_by !== "worker") {
      return {
        ok: false,
        reason:
          `worker outcome contains non-worker edge ${t.from}→${t.to} ` +
          `controlled_by=${t.controlled_by} (Step 10C rejects bundled retry / ` +
          `lease-recovery / DLQ / cancellation outputs)`,
      };
    }
  }

  const last = working[working.length - 1];
  // Narrowed by the .length check above, but TS noUncheckedIndexedAccess
  // cannot prove it; assert defensively.
  if (last === undefined) {
    return { ok: false, reason: "internal: empty worker tail after normalization" };
  }
  if (last.to !== "succeeded" && last.to !== "partial_succeeded") {
    return {
      ok: false,
      reason:
        `worker outcome ends at '${last.to}'; Step 10C admits only ` +
        `'succeeded' or 'partial_succeeded' worker-terminal outcomes`,
    };
  }

  return { ok: true, transitions: [...working] };
}

// ---------------------------------------------------------------------------
// Queue-error mapping
// ---------------------------------------------------------------------------

function mapQueueErrorToAckOutcome(
  err: OcrQueueError,
): "lease_lost" | "ack_failed" {
  return err.code === "lease_expired" ? "lease_lost" : "ack_failed";
}

async function tryRequeueAs(
  queue: OcrJobQueueBackend,
  claim: OcrQueueClaim,
  successOutcome: "requeued" | "persistence_failed",
  reasonMessage: string,
): Promise<OcrCoordinatorResult> {
  try {
    await queue.requeueClaim(claim);
    return {
      outcome: successOutcome,
      job_id: claim.job_id,
      error: { message: reasonMessage },
    };
  } catch (err) {
    if (err instanceof OcrQueueError) {
      return {
        outcome: mapQueueErrorToAckOutcome(err),
        job_id: claim.job_id,
        error: { code: err.code, message: `${reasonMessage}; requeueClaim: ${err.message}` },
      };
    }
    throw err;
  }
}

async function tryCompleteAlreadyTerminal(
  queue: OcrJobQueueBackend,
  claim: OcrQueueClaim,
): Promise<OcrCoordinatorResult> {
  try {
    await queue.completeClaim(claim);
    return { outcome: "completed_already_terminal", job_id: claim.job_id };
  } catch (err) {
    if (err instanceof OcrQueueError) {
      return {
        outcome: mapQueueErrorToAckOutcome(err),
        job_id: claim.job_id,
        error: { code: err.code, message: err.message },
      };
    }
    throw err;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
