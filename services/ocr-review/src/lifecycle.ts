// Single-job lifecycle derivation. Pure read over OcrPersistence —
// jobs/statuses/results are fetched by job_id; nothing is mutated.
//
// Why "current_state" + "terminal_state" instead of one field:
//   The persistence layer caches the last persisted status.to under
//   OcrJobRecord.terminal_state, but that cache is misnamed — it tracks
//   the *last* `to`, which may be non-terminal (e.g. "claimed",
//   "processing"). The read model splits this into:
//     - current_state: last status.to OR undefined
//     - is_terminal: contract's isTerminalState(current_state)
//     - terminal_state: current_state iff is_terminal else undefined
//   Consumers asking "is the job done and how did it end" use terminal_state.
//   Consumers asking "what's happening right now" use current_state.

import { isTerminalState, type OcrJobState } from "ocr-worker-contract";
import type {
  OcrPersistence,
  OcrStatusEvent,
} from "ocr-persistence";

import type { OcrJobLifecycle } from "./types.js";

/**
 * Single-job lifecycle view. Returns null when the job does not exist.
 * Returns a valid pending-shaped lifecycle when the job exists but has
 * no statuses or results yet (an in-flight ingestion before the worker
 * reports anything).
 *
 * The read model does not validate or mutate persistence state; it only
 * calls the documented read methods.
 */
export async function getOcrJobLifecycle(
  persistence: OcrPersistence,
  jobId: string,
): Promise<OcrJobLifecycle | null> {
  const job = await persistence.getOcrJob(jobId);
  if (!job) return null;
  // The persistence layer guarantees ordering on these reads
  // (statuses by seq; results by persisted_at then page_id), so the
  // read model does NOT re-sort. Re-sorting would mask any future
  // ordering bug in persistence.
  const statuses = await persistence.listOcrJobStatuses(jobId);
  const results = await persistence.listOcrResults(jobId);

  const current_state = deriveCurrentState(statuses);
  const is_terminal =
    current_state !== undefined && isTerminalState(current_state);
  const terminal_state = is_terminal ? current_state : undefined;

  return {
    job,
    statuses,
    results,
    current_state,
    is_terminal,
    terminal_state,
  };
}

// ---------------------------------------------------------------------------
// Helpers (exported for sibling modules; not part of the public API).
// ---------------------------------------------------------------------------

export function deriveCurrentState(
  statuses: ReadonlyArray<OcrStatusEvent>,
): OcrJobState | undefined {
  if (statuses.length === 0) return undefined;
  // statuses is ordered by seq ascending; last element is the most recent.
  return statuses[statuses.length - 1]!.to;
}

/** Count `failed -> queued` edges. Each one is a retry. */
export function deriveRetryCount(
  statuses: ReadonlyArray<OcrStatusEvent>,
): number {
  let n = 0;
  for (const s of statuses) {
    if (s.from === "failed" && s.to === "queued") n++;
  }
  return n;
}
