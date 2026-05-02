// Public surface for ocr-review.
//
// Step 8A — single-job-id-scoped read APIs:
//   - getOcrJobLifecycle
//   - getReviewableOcrPage
//   - summarizeOcrIngestionOutcome
//
// Step 8B — cross-job read APIs (no rerun collapse; persistence-owned cursors):
//   - listOcrJobsForDocument
//   - listPagesNeedingManualReview

export { getOcrJobLifecycle } from "./lifecycle.js";
export { getReviewableOcrPage } from "./page.js";
export { summarizeOcrIngestionOutcome } from "./summary.js";
export {
  listOcrJobsForDocument,
  listPagesNeedingManualReview,
  type ListOcrJobsForDocumentResult,
  type ListPagesNeedingManualReviewResult,
} from "./crossJob.js";

export type {
  OcrJobLifecycle,
  ReviewableOcrPage,
  OcrIngestionOutcomeSummary,
  OcrDocumentJobSummary,
  PageOutcome,
  BlockDigest,
  EvidenceIndexSignal,
  PartialFailureDigest,
} from "./types.js";

export { TEXT_PREVIEW_MAX_CHARS } from "./types.js";
