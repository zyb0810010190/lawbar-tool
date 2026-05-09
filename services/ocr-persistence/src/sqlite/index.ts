// SQLite-backed OcrPersistence — public surface.

export {
  SqliteOcrPersistence,
  openSqliteOcrPersistence,
  isAtomicEligiblePath,
  type SqliteOcrPersistenceOptions,
} from "./SqliteOcrPersistence.js";
export {
  SqliteOcrQueue,
  openSqliteOcrQueue,
  type SqliteOcrQueueOptions,
  type OpenSqliteOcrQueueOptions,
} from "./SqliteOcrQueue.js";
export { applySchema, CURRENT_SCHEMA_VERSION } from "./schema.js";
