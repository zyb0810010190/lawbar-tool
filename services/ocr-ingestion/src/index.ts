// Public surface of the ingestion package.

export { createOcrSubmissionFromDocument } from "./createSubmission.js";
export {
  ingestDocumentForOcr,
  type IngestDependencies,
  type IngestionOutcome,
} from "./ingest.js";
export {
  IngestionError,
  INGESTION_ERROR_CODES,
  type IngestionErrorCode,
  type DocumentIngestionInput,
  type IngestionPage,
  type IngestionEnvironment,
} from "./types.js";

// Step 10K — test-only helper. NOT exported from this production
// barrel; importers must reach for `ocr-ingestion/testing` so the
// non-production status is visible at every call site.
