// Step 10K — test-only helper: drive the OCR worker pipeline locally.
//
// Post-10K, `ingestDocumentForOcr` only enqueues. Tests that previously
// observed terminal state inline now have to run the worker themselves
// against the same queue + persistence pair. This helper does that via
// the 10C coordinator (`processOneOcrQueueClaim`) so test code paths
// stay aligned with what the production worker bin actually does — no
// shortcut that bypasses lifecycle persistence.
//
// NOT exported from production runtime callers. The seam lives under
// `ocr-ingestion/testing` so its non-production status is visible at the
// import site.

import { processFakeOcrJob, type FakeScenario } from "ocr-worker-contract/testing";
import {
  processOneOcrQueueClaim,
  type OcrCoordinatorResult,
  type OcrPersistencePort,
  type OcrWorker,
} from "ocr-worker-adapter";
import type {
  OcrJob,
  OcrJobQueueBackend,
} from "ocr-worker-contract";

export interface DrainOcrPipelineOptions {
  queue: OcrJobQueueBackend;
  persistence: OcrPersistencePort;
  /**
   * Optional override. Defaults to a fake worker that runs
   * `processFakeOcrJob` for whatever scenario was attached to the queue
   * candidate. Tests that wired a `scenario` via `ingestDocumentForOcr`
   * will see that scenario surface here.
   */
  worker?: OcrWorker;
  /**
   * Stable worker identity for `claimNext`. Defaults to
   * `"drain-helper"`. Tests that need a specific id can override.
   */
  worker_id?: string;
  /**
   * Hard ceiling on the number of `processOne` calls. Default 100.
   * Defends against unexpected requeue loops in failing tests.
   */
  maxIterations?: number;
  /** Deterministic clock for status timestamps. */
  now?: () => Date;
}

const defaultDrainWorker: OcrWorker = {
  async process(job: OcrJob) {
    return processFakeOcrJob(job.submission, {
      scenario: (job.scenario ?? "success") as FakeScenario,
    });
  },
};

/**
 * Drive the coordinator until the queue reports `empty`. Returns the
 * outcome list in the order they were produced. A non-`empty` outcome
 * after `maxIterations` throws — tests should treat that as a real
 * failure rather than silently terminate.
 */
export async function drainOcrPipelineForTesting(
  opts: DrainOcrPipelineOptions,
): Promise<OcrCoordinatorResult[]> {
  const worker = opts.worker ?? defaultDrainWorker;
  const worker_id = opts.worker_id ?? "drain-helper";
  const max = opts.maxIterations ?? 100;
  const now = opts.now;

  const outcomes: OcrCoordinatorResult[] = [];
  for (let i = 0; i < max; i++) {
    const result = await processOneOcrQueueClaim({
      queue: opts.queue,
      persistence: opts.persistence,
      worker,
      worker_id,
      ...(now !== undefined ? { now } : {}),
    });
    outcomes.push(result);
    if (result.outcome === "empty") return outcomes;
  }
  throw new Error(
    `drainOcrPipelineForTesting: queue did not drain within ${max} iterations`,
  );
}
