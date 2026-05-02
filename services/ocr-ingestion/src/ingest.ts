// Orchestrator: domain input -> OCR submission -> persistence -> queue ->
// worker outcome -> persistence. The orchestrator does not know how OCR
// runs; it only knows the boundaries it talks to.
//
// Sequencing rationale
// --------------------
// We persist the job *before* enqueueing so a crash between enqueue and
// the next persistence call cannot leave a queued job with no record.
// (The reverse order would be worse: a status arriving before the job
// row exists.) Statuses and results are persisted *after* the worker's
// outcome is in hand because the in-process fake bundles the full
// trajectory in one call. A real BullMQ-backed worker would persist
// per attempt; the same persistence primitives compose either way.

import type {
  OcrJobAdapter,
} from "ocr-worker-adapter";
import type {
  OcrPersistence,
  OcrJobRecord,
  OcrStatusEvent,
  OcrResultRecord,
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
   * Test-only escape hatch: forces a specific worker scenario. Production
   * callers omit it; the worker decides reality.
   */
  scenario?: FakeScenario;
}

export interface IngestionOutcome {
  job: OcrJobRecord;
  statuses: OcrStatusEvent[];
  results: OcrResultRecord[];
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

  // 1. Build a contract-valid submission from domain input.
  const submission = createOcrSubmissionFromDocument(input, deps);

  // 2. Persist the job before any side effects on the queue.
  const job = await deps.persistence.createOcrJob(submission);

  // 3. Hand to the queue adapter. Scenario is forwarded for tests; in
  //    production the worker decides outcomes on its own.
  const enqueueOpts = deps.scenario !== undefined ? { scenario: deps.scenario } : {};
  await deps.queueAdapter.enqueueOcrJob(submission, enqueueOpts);

  // 4. Drive the queue forward synchronously so the test can observe the
  //    full lifecycle. A real worker process would call this in a loop.
  const processed = await deps.queueAdapter.processNextOcrJob();
  if (!processed) {
    throw new IngestionError("queue did not return a processed job");
  }
  if (processed.outcome.job_id !== submission.job_id) {
    throw new IngestionError(
      `processed job_id ${processed.outcome.job_id} does not match submission ${submission.job_id}`,
    );
  }

  // 5. Persist the worker's status timeline. The persistence layer
  //    re-validates the chain on each append.
  for (const t of processed.outcome.statuses) {
    await deps.persistence.appendOcrStatus(submission.job_id, t);
  }

  // 6. Persist per-page results. Persistence re-validates each result.
  for (const r of processed.outcome.results) {
    await deps.persistence.saveOcrResult(submission.job_id, r);
  }

  // 7. Read back through the same interface the rest of the app would use,
  //    so the returned snapshot matches what queries will see.
  const stored = await deps.persistence.getOcrJob(submission.job_id);
  if (!stored) {
    throw new IngestionError("job vanished from persistence after writes");
  }
  const statuses = await deps.persistence.listOcrJobStatuses(submission.job_id);
  const results = await deps.persistence.listOcrResults(submission.job_id);
  return { job: stored, statuses, results };
}
