// Worker-package type surface.
//
// Step 10I-A relocates the queue transport types and `OcrQueueError` to the
// neutral contract package (see ADR
// `docs/adr/ocr-queue-boundary-amendment-step-10h-a.md`). This file now
// re-exports them so internal worker source (`coordinator.ts`,
// `workerLoop.ts`, `inMemoryQueue.ts`, `adapter.ts`, `cli.ts`,
// `outcomeValidation.ts`) keeps importing from `./types.js` unchanged.
//
// Hard rule: `OcrQueueError` is re-exported by *value*, not redefined. The
// class identity must be the same whether imported via
// `ocr-worker-contract` or via `ocr-worker-adapter`. `instanceof OcrQueueError`
// must remain honest across both paths. There is a regression test pinning
// this identity in `tests/queueContractRelocation.test.mjs`.

import type { OcrJob, OcrJobOutcome } from "ocr-worker-contract";

// --- Relocated queue surface (from `ocr-worker-contract`). -------------------
export {
  OcrQueueError,
  type EnqueueResult,
  type OcrJob,
  type OcrJobQueueBackend,
  type OcrQueueClaim,
  type OcrQueueErrorCode,
} from "ocr-worker-contract";

// --- Worker-local surface (unchanged). ---------------------------------------

/**
 * The worker seam. Returns the production `OcrJobOutcome` shape per
 * ADR-11A.5 §1. Test/dev paths inject the fake worker (whose
 * `FakeJobOutcome` is a structural subtype) via the existing `buildDeps`
 * override seam. A production worker would post to an external OCR
 * service; the swap to a real engine is staged for ADR-11C.
 */
export interface OcrWorker {
  process(job: OcrJob): Promise<OcrJobOutcome>;
}

/** What `processOcrJob` / `processNextOcrJob` return to the caller. */
export interface ProcessResult {
  /** The job that was processed (id, submission, enqueued_at). */
  job: OcrJob;
  /** Full outcome from the worker — statuses, results, terminal_state. */
  outcome: OcrJobOutcome;
}

/** Adapter-layer error: invalid submission, contract-violating worker output. */
export class OcrAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrAdapterError";
  }
}
