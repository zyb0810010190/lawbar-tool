// Public surface of the ingestion package.

export { createOcrSubmissionFromDocument } from "./createSubmission.js";
export {
  ingestDocumentForOcr,
  type IngestDependencies,
  type IngestionOutcome,
} from "./ingest.js";
export {
  IngestionError,
  type DocumentIngestionInput,
  type IngestionPage,
  type IngestionEnvironment,
} from "./types.js";
