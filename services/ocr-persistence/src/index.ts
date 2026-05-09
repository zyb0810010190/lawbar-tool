// Public surface of the OCR persistence package.

export {
  InMemoryOcrPersistence,
  type InMemoryOcrPersistenceOptions,
} from "./inMemoryRepo.js";
export {
  OcrPersistenceError,
  type OcrPersistence,
  type OcrJobRecord,
  type OcrStatusEvent,
  type OcrResultRecord,
  type ListOcrJobsByDocumentQuery,
  type ListOcrJobsByDocumentPage,
  type ListOcrReviewPageRowsQuery,
  type ListOcrReviewPageRowsPage,
  type OcrReviewPageRow,
} from "./types.js";

export {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type OcrCursorKind,
} from "./cursor.js";

export {
  SqliteOcrPersistence,
  openSqliteOcrPersistence,
  SqliteOcrQueue,
  openSqliteOcrQueue,
  applySchema,
  CURRENT_SCHEMA_VERSION,
  isAtomicEligiblePath,
  type SqliteOcrPersistenceOptions,
  type SqliteOcrQueueOptions,
  type OpenSqliteOcrQueueOptions,
} from "./sqlite/index.js";
