// Step 10D — Thin OCR worker loop.
//
// A minimal in-process runner around a Step 10C `OcrProcessingCoordinator`.
// Concurrency is exactly 1: at most one `processOne()` is in flight at any
// time. The loop is intentionally narrow — a runtime shell for local/dev/
// test execution that exercises stop semantics, idle pacing, and
// observability against the accepted Step 10C outcome union. It does NOT:
//
//   - renew leases (`OcrWorker.process(job)` has no cancellation channel
//     and `processOne()` does not surface the claim receipt);
//   - apply retry/backoff for non-`empty` outcomes (no scheduled-availability
//     primitive on the queue seam);
//   - support forceful stop mid-`processOne()` (no AbortSignal in the worker
//     contract);
//   - handle DLQ or retry-count progression.
//
// All of those concerns belong to a later step (post-API-split, or behind
// a real broker like BullMQ). See the Step 10D plan-review notes for
// rationale.

import type {
  OcrCoordinatorOutcome,
  OcrCoordinatorResult,
} from "./coordinator.js";

/**
 * Anything that exposes `processOne()` returning a coordinator result.
 * `OcrProcessingCoordinator` satisfies this structurally; tests can pass a
 * plain stub.
 */
export interface OcrCoordinatorLike {
  processOne(): Promise<OcrCoordinatorResult>;
}

/**
 * Phase that produced a hook/loop error, surfaced via `onError`.
 *
 * `onError` itself does not appear here: errors thrown from the `onError`
 * hook are silently swallowed to avoid a recursion / death-spiral, so no
 * code path in this module emits `phase: "onError"`.
 */
export type OcrWorkerLoopErrorPhase = "processOne" | "onOutcome" | "loop";

export interface OcrWorkerLoopErrorEvent {
  /** Where the error originated. */
  phase: OcrWorkerLoopErrorPhase;
  /** Human-readable error message. */
  message: string;
  /** Original error, when available. Always typed as `unknown`. */
  cause?: unknown;
}

export interface OcrWorkerLoopOptions {
  /** The thing to drive. Typically an `OcrProcessingCoordinator`. */
  coordinator: OcrCoordinatorLike;
  /**
   * External graceful stop. Once aborted, the loop:
   *   - does NOT start a new iteration;
   *   - waits for the current `processOne()` (if any) to finish;
   *   - returns with `stop_reason="stopped"`.
   * If already aborted on entry, returns immediately with `iterations=0`.
   */
  stopSignal?: AbortSignal;
  /** Stop after this many iterations. `undefined` means "no cap". */
  maxIterations?: number;
  /**
   * Sleep this long after an `empty` outcome. Default: 25ms — small enough
   * to keep tests fast, big enough to avoid pathological busy-poll. Has no
   * effect on non-`empty` outcomes (Step 10D never paces non-empty results).
   */
  idleDelayMs?: number;
  /**
   * Whether `onOutcome` is invoked for `empty` results. Default `false` so
   * idle polling does not flood callers' logs/metrics.
   */
  includeEmptyOutcomes?: boolean;
  /**
   * Called for every coordinator result (including coordinator-documented
   * failure modes like `requeued`, `ack_failed`, `lease_lost`,
   * `persistence_failed`). Whether `empty` is included depends on
   * `includeEmptyOutcomes`. Synchronous or async; awaited. Errors thrown
   * from this hook are caught and reported via `onError` with
   * `phase="onOutcome"` — they do NOT crash the loop.
   */
  onOutcome?: (result: OcrCoordinatorResult) => void | Promise<void>;
  /**
   * Called for unexpected thrown exceptions from `processOne()`, hook
   * failures, or sleep-loop bugs. NOT called for documented coordinator
   * failure outcomes (those are routed through `onOutcome`). Errors thrown
   * from this hook are caught and silently dropped to avoid recursion.
   */
  onError?: (event: OcrWorkerLoopErrorEvent) => void | Promise<void>;
  /**
   * Test seam for the idle delay. Defaults to a setTimeout that resolves
   * early when `stopSignal` aborts. Production callers should not need
   * to override this.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface OcrWorkerLoopSummary {
  /** Number of `processOne()` calls that returned (success OR documented failure). */
  iterations: number;
  /** Why the loop terminated. */
  stop_reason: "max_iterations" | "stopped" | "error";
  /**
   * Histogram of coordinator outcomes (including `empty`). Sparse: only
   * keys that were actually observed are present, so any unobserved
   * outcome is `undefined` rather than `0`.
   */
  outcomes: Partial<Record<OcrCoordinatorOutcome, number>>;
  /** Last result returned by `processOne()`, when any. */
  last_outcome?: OcrCoordinatorResult;
  /** Last unexpected error event, when any. Set on stop_reason="error". */
  last_error?: { phase: OcrWorkerLoopErrorPhase; message: string };
}

const DEFAULT_IDLE_DELAY_MS = 25;

/**
 * Drive a coordinator until stopped, capped, or aborted by an unexpected
 * error. Never throws — every termination path is reported in the summary.
 */
export async function runOcrWorkerLoop(
  opts: OcrWorkerLoopOptions,
): Promise<OcrWorkerLoopSummary> {
  const {
    coordinator,
    stopSignal,
    maxIterations,
    idleDelayMs = DEFAULT_IDLE_DELAY_MS,
    includeEmptyOutcomes = false,
    onOutcome,
    onError,
    sleep = defaultSleep,
  } = opts;

  const outcomes: Partial<Record<OcrCoordinatorOutcome, number>> = {};
  let iterations = 0;
  let last_outcome: OcrCoordinatorResult | undefined;
  let last_error: OcrWorkerLoopSummary["last_error"];

  const reportError = async (event: OcrWorkerLoopErrorEvent): Promise<void> => {
    if (onError === undefined) return;
    try {
      await onError(event);
    } catch {
      // Swallow onError failures to avoid a recursion / death-spiral.
    }
  };

  // Pre-loop: an already-aborted signal means we never claim anything.
  if (stopSignal?.aborted) {
    return finalize("stopped");
  }

  // Main loop.
  for (;;) {
    if (stopSignal?.aborted) return finalize("stopped");
    if (maxIterations !== undefined && iterations >= maxIterations) {
      return finalize("max_iterations");
    }

    let result: OcrCoordinatorResult;
    try {
      result = await coordinator.processOne();
    } catch (err) {
      const message = errorMessage(err);
      last_error = { phase: "processOne", message };
      await reportError({ phase: "processOne", message, cause: err });
      return finalize("error");
    }

    iterations++;
    last_outcome = result;
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;

    const fireOnOutcome =
      onOutcome !== undefined &&
      (result.outcome !== "empty" || includeEmptyOutcomes);
    if (fireOnOutcome) {
      try {
        await onOutcome!(result);
      } catch (err) {
        const message = errorMessage(err);
        // Hook errors are NEVER fatal to the loop — they get reported
        // through onError and the loop continues.
        await reportError({ phase: "onOutcome", message, cause: err });
      }
    }

    // Idle pacing only on `empty`. Non-empty outcomes (including
    // `requeued` / `ack_failed` / `lease_lost` / `persistence_failed`)
    // continue immediately — Step 10D does NOT do retry backoff.
    if (result.outcome === "empty" && idleDelayMs > 0) {
      try {
        await sleep(idleDelayMs, stopSignal);
      } catch (err) {
        // The default sleep resolves on abort; this branch is only
        // reachable if a custom `sleep` rejects on abort. Treat that as
        // a graceful stop, not an error.
        if (stopSignal?.aborted) return finalize("stopped");
        const message = errorMessage(err);
        last_error = { phase: "loop", message };
        await reportError({ phase: "loop", message, cause: err });
        return finalize("error");
      }
    }
  }

  function finalize(
    stop_reason: OcrWorkerLoopSummary["stop_reason"],
  ): OcrWorkerLoopSummary {
    const summary: OcrWorkerLoopSummary = {
      iterations,
      stop_reason,
      outcomes,
    };
    if (last_outcome !== undefined) summary.last_outcome = last_outcome;
    if (last_error !== undefined) summary.last_error = last_error;
    return summary;
  }
}

/**
 * Default idle-sleep that resolves early when `signal` aborts. Returns
 * normally on abort (graceful stop) — never rejects.
 */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
