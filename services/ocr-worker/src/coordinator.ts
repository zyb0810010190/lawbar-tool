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

import { randomUUID } from "node:crypto";

import {
  classifyOcrFailureForRetry,
  isTerminalState,
  RetryPolicyError,
  validateOcrSubmission,
} from "ocr-worker-contract";
import type {
  OcrJobActor,
  OcrJobState,
  OcrResult,
  OcrSubmission,
  PartialFailure,
  RetryPolicy,
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
  /**
   * Returns `null` if no job record exists for this `job_id`. The
   * `pending_retry_submission` field carries the ADR-11G outbox row
   * (the durable next-attempt submission written before completeClaim);
   * when present, the coordinator uses it as the authoritative input
   * for this turn, overriding `claim.job.submission`.
   */
  getOcrJob(jobId: string): Promise<
    {
      terminal_state?: OcrJobState;
      pending_retry_submission?: OcrSubmission;
    } | null
  >;
  /** Idempotent transition append. Throws on conflicting replay. */
  appendOcrStatusOnce(
    jobId: string,
    transition: TransitionRecord,
  ): Promise<unknown>;
  /** Idempotent per-page result write. Throws on conflicting replay. */
  saveOcrResultOnce(jobId: string, result: unknown): Promise<unknown>;
  /**
   * ADR-11G pending-retry outbox. Write the bumped next-attempt
   * submission durably BEFORE the coordinator completes the current
   * claim, so an ack failure (lease_expired / stale_receipt /
   * ack_failed) between `failed → queued` and the retry enqueue does
   * not strand `retry.attempt` at its prior value on redelivery.
   * Idempotent overwrite of any prior pending row.
   */
  setOcrPendingRetry(jobId: string, submission: unknown): Promise<void>;
  /**
   * ADR-11G pending-retry outbox. Clear the pending row after the
   * retry has been successfully enqueued, OR when a non-retry terminal
   * is reached, so a stale pending submission does not outlive the
   * job it described.
   */
  clearOcrPendingRetry(jobId: string): Promise<void>;
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
  // ADR-11F: transient failure with retry budget remaining — coordinator
  // appended failed->queued and re-enqueued a fresh job with bumped
  // submission.retry.attempt.
  | "retried"
  // ADR-11F: permanent failure OR transient with budget exhausted —
  // coordinator appended failed->dead_lettered. terminal_state on the
  // job record auto-refreshes to "dead_lettered" via persistence.
  | "dead_lettered"
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
  /**
   * Transport-id generator for the requeued OcrJob (ADR-11F retry path).
   * Default: `crypto.randomUUID()`. Tests inject a deterministic
   * generator to assert the requeue produces a predictable id.
   */
  generateJobId?: () => string;
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
  const generateJobId = opts.generateJobId ?? (() => randomUUID());

  // Step 1: claim
  const claim = await queue.claimNext(worker_id);
  if (claim === null) {
    return { outcome: "empty" };
  }

  // Step 2: read persisted job record (including ADR-11G pending-retry).
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

  // Step 3: terminal redelivery short-circuit. If a stale pending-retry
  // row outlived its job (operator action, clear-failure on a prior turn),
  // clear it best-effort so it does not strand. The terminal short-circuit
  // path is the only legitimate place an outbox row can be stale.
  if (record.terminal_state !== undefined && isTerminalState(record.terminal_state)) {
    if (record.pending_retry_submission !== undefined) {
      try {
        await persistence.clearOcrPendingRetry(claim.job_id);
      } catch {
        // Best-effort cleanup. The terminal short-circuit must complete
        // the claim regardless; a stale outbox row is recoverable.
      }
    }
    return await tryCompleteAlreadyTerminal(queue, claim);
  }

  // ADR-11G: if a pending-retry submission is durable, it is the
  // authoritative input for this turn. The queue may have redelivered
  // the original submission (e.g. ack-failure replay) — using the
  // persisted bumped submission is how `retry.attempt` actually
  // advances across redelivery.
  const effectiveClaim =
    record.pending_retry_submission !== undefined
      ? {
          ...claim,
          job: { ...claim.job, submission: record.pending_retry_submission },
        }
      : claim;

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
  // The worker sees `effectiveClaim.job`, which carries the pending-retry
  // submission when one exists. Binding validation in Step 6 likewise
  // uses the effective claim so submission ↔ result page bindings match.
  let workerOutcome: Awaited<ReturnType<OcrWorker["process"]>>;
  try {
    workerOutcome = await worker.process(effectiveClaim.job);
  } catch (err) {
    return await tryRequeueAs(
      queue,
      claim,
      "requeued",
      `worker threw: ${errorMessage(err)}`,
    );
  }

  // Step 6: contract + binding validation
  const validation = validateWorkerOutcomeContract(workerOutcome, effectiveClaim.job);
  if (!validation.ok) {
    return await tryRequeueAs(queue, claim, "requeued", validation.reason);
  }

  // Step 7: Step-10C/11F-specific normalization
  const norm = normalizeForStep10C(workerOutcome.statuses);
  if (!norm.ok) {
    return await tryRequeueAs(queue, claim, "requeued", norm.reason);
  }
  const transitionsToPersist = norm.transitions;
  const resultsToPersist: ReadonlyArray<OcrResult> = workerOutcome.results;

  // Step 7.5 (ADR-11F, B3): if the worker terminal is `failed`, the
  // outcome MUST carry at least one failed result so the classifier has
  // something to decide on. A failed-terminal with empty / non-failed
  // results is an invalid worker output (contract validation is
  // schema-only and does not enforce this coherence). Reject via
  // requeue so the persisted state is not advanced into an
  // un-classifiable shape.
  const lastTransition = transitionsToPersist[transitionsToPersist.length - 1];
  const isFailedTerminal =
    lastTransition !== undefined && lastTransition.to === "failed";
  if (isFailedTerminal) {
    const hasFailedResult = resultsToPersist.some((r) => r.status === "failed");
    if (!hasFailedResult) {
      return await tryRequeueAs(
        queue,
        claim,
        "requeued",
        "worker emitted terminal_state='failed' with no result carrying status='failed'; cannot classify for retry",
      );
    }
  }

  // Step 7.6 (ADR-11F): pre-compute retry decision BEFORE persisting any
  // results. If we will retry, the failed result for this attempt must
  // NOT be written — persistence is keyed on (job_id, page_id) and the
  // next attempt's result would collide. (Cross-validated against
  // services/ocr-persistence/src/{inMemoryRepo.ts,sqlite/SqliteOcrPersistence.ts}
  // result-conflict guards.)
  let retryDecision: { kind: "retry" | "dead_letter"; reason: string } | null = null;
  let validatedSubmission: OcrSubmission | null = null;
  let validatedRetryPolicy: RetryPolicy | null = null;
  if (isFailedTerminal) {
    // Use the effective submission (pending-retry if present, else the
    // queue's payload) so the classifier reads the bumped retry policy
    // and budget advancement actually happens across redelivery.
    const submissionVerdict = validateOcrSubmission(effectiveClaim.job.submission);
    if (!submissionVerdict.ok) {
      // Submission failed contract validation at the coordinator seam.
      // Without a typed retry policy we cannot classify; refuse to
      // advance persistence and surface for operator intervention.
      return {
        outcome: "persistence_failed",
        job_id: claim.job_id,
        statuses_persisted,
        results_persisted: 0,
        error: {
          message:
            `submission failed contract validation at retry seam: ${submissionVerdict.summary}`,
        },
      };
    }
    validatedSubmission = submissionVerdict.value;
    // The generated OcrSubmission type widens `retry` to a bag of
    // unknown properties (cross-schema invariants live in Ajv at
    // runtime). The submission just passed validateOcrSubmission, so the
    // runtime shape is RetryPolicy; assert that locally for the
    // classifier call.
    validatedRetryPolicy = validatedSubmission.retry as unknown as RetryPolicy;

    for (const result of resultsToPersist) {
      if (result.status !== "failed") continue;
      // classifyOcrFailureForRetry throws RetryPolicyError on invalid
      // numeric retry counters (B4). Schema validation does not catch
      // attempt > max_attempts; map any throw to a documented outcome
      // rather than letting it escape the coordinator.
      let verdict;
      try {
        verdict = classifyOcrFailureForRetry({
          status: result.status,
          failure: (result.partial_failure ?? null) as PartialFailure | null,
          retry: validatedRetryPolicy,
        });
      } catch (err) {
        // Map the contract's documented retry-policy guard to a
        // coordinator outcome. Unexpected errors (logic bugs, runtime
        // failures) still propagate per the function's overall
        // "fail fast on non-OcrQueueError" stance.
        if (err instanceof RetryPolicyError) {
          return {
            outcome: "persistence_failed",
            job_id: claim.job_id,
            statuses_persisted,
            results_persisted: 0,
            error: {
              message:
                `retry classifier rejected submission retry policy: ${err.message}`,
            },
          };
        }
        throw err;
      }
      switch (verdict.kind) {
        case "retry":
          retryDecision = { kind: "retry", reason: verdict.reason };
          break;
        case "dead_letter":
          if (retryDecision === null) {
            retryDecision = { kind: "dead_letter", reason: verdict.reason };
          }
          break;
        case "not_failed":
          // Unreachable today — we gate the classifier call on
          // result.status === "failed", and the contract returns
          // not_failed only when status !== "failed". Refuse to fall
          // through if a future contract change breaks that invariant:
          // a `failed` terminal with no recoverable verdict would
          // strand the job in non-terminal `failed` after the normal
          // completion path.
          return {
            outcome: "persistence_failed",
            job_id: claim.job_id,
            statuses_persisted,
            results_persisted: 0,
            error: {
              message:
                "retry classifier returned 'not_failed' for a result with status='failed' — contract invariant broken",
            },
          };
        default: {
          // Exhaustiveness guard: if RetryDecision gains a new variant
          // upstream, force a compile-time error here instead of
          // silently completing as `failed`.
          const _exhaustive: never = verdict;
          throw new Error(
            `unhandled retry classifier verdict kind: ${JSON.stringify(_exhaustive)}`,
          );
        }
      }
      if (retryDecision?.kind === "retry") break;
    }
  }
  const isRetryDecision = retryDecision?.kind === "retry";

  // Step 8: persist transitions (always) + results (skipped on retry).
  //
  // On the retry path the failed result for this attempt is discarded:
  // persistence stores one OcrResult per (job_id, page_id), so writing
  // it would collide with the next attempt's result. The worker
  // transitions still go in — they are the audit trail of what
  // happened — but the result body does not.
  let results_persisted = 0;
  try {
    for (const t of transitionsToPersist) {
      await persistence.appendOcrStatusOnce(claim.job_id, t);
      statuses_persisted++;
    }
    if (!isRetryDecision) {
      for (const r of resultsToPersist) {
        await persistence.saveOcrResultOnce(claim.job_id, r);
        results_persisted++;
      }
    }
  } catch (err) {
    return {
      outcome: "persistence_failed",
      job_id: claim.job_id,
      statuses_persisted,
      results_persisted,
      error: { message: `persistence write failed: ${errorMessage(err)}` },
    };
  }

  // Step 8.5 (ADR-11F): coordinator-owned queue edge off `failed`.
  if (retryDecision !== null) {
    // Both validatedSubmission + validatedRetryPolicy are non-null by
    // construction here (a non-null retryDecision means we entered the
    // `isFailedTerminal` branch above and successfully validated the
    // submission). Defensively assert to satisfy TS narrowing.
    if (validatedSubmission === null || validatedRetryPolicy === null) {
      throw new Error(
        "internal: retryDecision set without validated submission/retry policy",
      );
    }
    const nextState: OcrJobState =
      retryDecision.kind === "retry" ? "queued" : "dead_lettered";
    try {
      await persistence.appendOcrStatusOnce(claim.job_id, {
        from: "failed",
        to: nextState,
        controlled_by: "queue" as OcrJobActor,
        at: now().toISOString(),
        note: retryDecision.reason,
      });
      statuses_persisted++;
    } catch (err) {
      return {
        outcome: "persistence_failed",
        job_id: claim.job_id,
        statuses_persisted,
        results_persisted,
        error: {
          message:
            `appendOcrStatusOnce(failed→${nextState}) failed: ${errorMessage(err)}`,
        },
      };
    }

    // ADR-11G outbox write — durably record the bumped next-attempt
    // submission BEFORE completing the claim. If completeClaim then
    // fails, the lease will eventually expire and the queue will
    // redeliver the original job; Step 2 of the next coordinator turn
    // reads this row and runs the bumped submission, so `retry.attempt`
    // actually advances across the ack-failure path (B2 closure).
    //
    // For dead-letter, we skip the pending-retry write — there is no
    // next attempt — and we explicitly clear any stale row after the
    // claim completes (a previous turn may have written one).
    let nextSubmission: OcrSubmission | null = null;
    if (retryDecision.kind === "retry") {
      nextSubmission = structuredClone(validatedSubmission);
      const clonedRetry = nextSubmission.retry as unknown as RetryPolicy;
      clonedRetry.attempt = validatedRetryPolicy.attempt + 1;
      try {
        await persistence.setOcrPendingRetry(claim.job_id, nextSubmission);
      } catch (err) {
        return {
          outcome: "persistence_failed",
          job_id: claim.job_id,
          statuses_persisted,
          results_persisted,
          error: {
            message:
              `setOcrPendingRetry failed: ${errorMessage(err)}`,
          },
        };
      }
    }

    // Complete the current claim BEFORE enqueueing the retry. The queue
    // dedupes on (job_id, canonical submission JSON), and the original
    // claim is still active here with the old submission — re-enqueueing
    // a bumped-attempt submission for the same job_id before completing
    // would trip the queue's dedupe-conflict check. Completing first
    // releases the active slot so the retry enqueue is a clean insert.
    try {
      await queue.completeClaim(claim);
    } catch (err) {
      if (err instanceof OcrQueueError) {
        // Pending-retry row (if we wrote one) stays — that is the whole
        // point of the outbox. Redelivery reads it via Step 2.
        return {
          outcome: mapQueueErrorToAckOutcome(err),
          job_id: claim.job_id,
          statuses_persisted,
          results_persisted,
          error: { code: err.code, message: err.message },
        };
      }
      throw err;
    }

    if (retryDecision.kind === "retry" && nextSubmission !== null) {
      const nextJob: OcrJob = {
        id: generateJobId(),
        submission: nextSubmission,
        enqueued_at: now().toISOString(),
      };
      try {
        await queue.enqueue(nextJob);
      } catch (err) {
        // Enqueue failed AFTER the claim was completed. The pending
        // row + persisted failed→queued together describe the intended
        // next attempt for operator-driven recovery. Do NOT clear the
        // pending row; it is the only durable record of the bumped
        // submission.
        const code = err instanceof OcrQueueError ? err.code : undefined;
        return {
          outcome: "persistence_failed",
          job_id: claim.job_id,
          statuses_persisted,
          results_persisted,
          error: {
            code,
            message:
              `failed→queued persisted but queue.enqueue(retry) failed: ${errorMessage(err)}`,
          },
        };
      }
      // Best-effort clear: the next attempt has been enqueued, so the
      // pending row's role is over. A clear failure here leaves a stale
      // row that the NEXT successful coordinator turn will overwrite or
      // the terminal short-circuit (Step 3) will clean up.
      try {
        await persistence.clearOcrPendingRetry(claim.job_id);
      } catch {
        // Swallow: see comment above.
      }
    } else if (retryDecision.kind === "dead_letter") {
      // Clear any stale pending-retry row left from an earlier turn.
      try {
        await persistence.clearOcrPendingRetry(claim.job_id);
      } catch {
        // Best-effort cleanup; dead-letter is terminal regardless.
      }
    }

    return {
      outcome: retryDecision.kind === "retry" ? "retried" : "dead_lettered",
      job_id: claim.job_id,
      statuses_persisted,
      results_persisted,
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

  // ADR-11G terminal cleanup: a succeeded / partial_succeeded outcome
  // resolves the job; any pending-retry row (left over from a prior
  // retried attempt) is now stale.
  if (record.pending_retry_submission !== undefined) {
    try {
      await persistence.clearOcrPendingRetry(claim.job_id);
    } catch {
      // Best-effort — the claim is already completed.
    }
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
 *      admitted in Step 10C/11F: `succeeded`, `partial_succeeded`, or
 *      `failed`. Per ADR-11F the coordinator now owns the queue-controlled
 *      continuation off `failed` (either `failed → queued` for retry or
 *      `failed → dead_lettered` for dead-letter); the worker's
 *      `processing → failed` edge stays worker-owned.
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
  if (
    last.to !== "succeeded" &&
    last.to !== "partial_succeeded" &&
    last.to !== "failed"
  ) {
    return {
      ok: false,
      reason:
        `worker outcome ends at '${last.to}'; Step 10C/11F admits only ` +
        `'succeeded', 'partial_succeeded', or 'failed' worker-terminal outcomes`,
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
