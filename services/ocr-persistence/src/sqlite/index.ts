// SQLite-backed OcrPersistence — public surface.

export {
  SqliteOcrPersistence,
  openSqliteOcrPersistence,
  type SqliteOcrPersistenceOptions,
} from "./SqliteOcrPersistence.js";
export { applySchema, CURRENT_SCHEMA_VERSION } from "./schema.js";
