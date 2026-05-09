// Step 10K — ingestion is enqueue-only.
//
// Sequencing rationale (post-10K)
// -------------------------------
// Validate domain input → persist `ocr_jobs` row → place job on queue.
// Do NOT drive the worker — a separate worker process owns
// claim/process/persist via the 10C coordinator.
//
// Atomicity (10K)
// ---------------
// Atomic path requires (a) persistence advertising `enqueueNewOcrJob`
// AND (b) the runtime queue sharing the same store (probed via
// matching `dbFilePath`). Both are SQLite-on-the-same-file in
// production (per ADR-10J cross-validation). When either condition
// fails we fall back to a non-atomic createOcrJob + queue.enqueue
// sequence.
//
// Failure modes
// -------------
// Atomic path: rolled back by the SQLite transaction; neither row
// persists; OcrQueueError or OcrPersistenceError propagates.
// Fallback path: persistence succeeds first. If queue.enqueue then
// throws, the persisted ocr_jobs row LEAKS (an orphaned job with no
// queue row, no claim, no terminal_state). 10C does not auto-reconcile
// this direction (its path-B handles claimed-but-unknown-job, the
// inverse). Operator/caller must surface or retry.

import type {
  OcrJobAdapter,
} from "ocr-worker-adapter";
import type {
  EnqueueResult,
  OcrJobQueueBackend,
} from "ocr-worker-contract";
import { isAtomicEligiblePath } from "ocr-persistence";
import type {
  OcrJobRecord,
  OcrPersistence,
} from "ocr-persistence";
import type { FakeScenario } from "ocr-worker-contract/testing";

import { createOcrSubmissionFromDocument } from "./createSubmission.js";
import {
  IngestionError,
  type DocumentIngestionInput,
  type IngestionEnvironment,
} from "./types.js";

export interface IngestDependencies extends IngestionEnvironment {
  persistence: OcrPersistence;
  queueAdapter: OcrJobAdapter;
  /**
   * Optional. When provided AND it shares the persistence's store
   * (matching `dbFilePath`), ingestion takes the atomic path. The
   * runtime worker observes the inserted queue row via its own
   * connection on that file.
   */
  queue?: OcrJobQueueBackend;
  /** Test-only escape hatch forwarded to the queue candidate. */
  scenario?: FakeScenario;
}

export interface IngestionOutcome {
  job: OcrJobRecord;
  enqueueResult: EnqueueResult;
  /** Whether the underlying persistence guaranteed atomic createOcrJob + enqueue. */
  atomic: boolean;
}

export async function ingestDocumentForOcr(
  input: DocumentIngestionInput,
  deps: IngestDependencies,
): Promise<IngestionOutcome> {
  if (!deps?.persistence) {
    throw new IngestionError("persistence dependency is required");
  }
  if (!deps?.queueAdapter) {
    throw new IngestionError("queueAdapter dependency is required");
  }

  const submission = createOcrSubmissionFromDocument(input, deps);
  const enqueueOpts =
    deps.scenario !== undefined ? { scenario: deps.scenario } : {};

  if (canTakeAtomicPath(deps.persistence, deps.queue)) {
    const { job, enqueueResult } = await deps.persistence.enqueueNewOcrJob!(
      submission,
      deps.queue!,
      enqueueOpts,
    );
    return { job, enqueueResult, atomic: true };
  }

  const job = await deps.persistence.createOcrJob(submission);
  const enqueueResult = await deps.queueAdapter.enqueueOcrJob(
    submission,
    enqueueOpts,
  );
  return { job, enqueueResult, atomic: false };
}

function canTakeAtomicPath(
  persistence: OcrPersistence,
  queue: OcrJobQueueBackend | undefined,
): boolean {
  if (typeof persistence.enqueueNewOcrJob !== "function") return false;
  if (queue === undefined) return false;
  // Duck-type the same-store probe so ocr-ingestion does not need to
  // import SqliteOcr* concrete classes.
  const p = persistence as { dbFilePath?: unknown };
  const q = queue as { dbFilePath?: unknown };
  if (typeof p.dbFilePath !== "string" || typeof q.dbFilePath !== "string") {
    return false;
  }
  // `:memory:` and other transient/sentinel paths are spoofable
  // (two distinct in-memory DBs both report ":memory:"), so reject
  // them at this gate. Persistence enforces the same rule.
  if (!isAtomicEligiblePath(p.dbFilePath)) return false;
  return p.dbFilePath === q.dbFilePath;
}
