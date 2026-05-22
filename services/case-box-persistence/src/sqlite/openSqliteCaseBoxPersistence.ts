// Convenience factory: open an in-memory or file-backed SQLite database,
// apply local-durability/perf pragmas, run applySchema, and return a
// ready-to-use SqliteCaseBoxPersistence. Mirrors
// services/ocr-persistence/src/sqlite/openSqliteOcrPersistence.ts.
//
// The caller must keep a reference to the returned `db` to close it.

import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

import { applySchema } from "./schema.js";
import { SqliteCaseBoxPersistence } from "./SqliteCaseBoxPersistence.js";

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface OpenSqliteCaseBoxPersistenceOptions {
  /** SQLite path. Defaults to `:memory:`. */
  readonly path?: string;
  /** Clock injection for deterministic timestamps in tests. */
  readonly now?: () => Date;
  /** ULID-shape id generator injection. Required for createMatter audit events. */
  readonly generateId?: () => string;
  /** SQLite busy_timeout in ms. Default 5000. */
  readonly busyTimeoutMs?: number;
}

export interface OpenSqliteCaseBoxPersistenceResult {
  readonly persistence: SqliteCaseBoxPersistence;
  readonly db: BetterSqlite3Database;
}

export function openSqliteCaseBoxPersistence(
  options: OpenSqliteCaseBoxPersistenceOptions = {},
): OpenSqliteCaseBoxPersistenceResult {
  const db = new Database(options.path ?? ":memory:");

  // WAL = concurrent readers + single writer without blocking.
  // synchronous=NORMAL pairs with WAL for durable-across-process-crash.
  // busy_timeout defends transient contention from concurrent writers.
  // foreign_keys=ON is defensive (case-box declares NO FK constraints).
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);
  db.pragma("foreign_keys = ON");

  // applySchema uses real wall-clock for schema_version.applied_at — NOT
  // the caller's injected clock. The migration timestamp is internal
  // bookkeeping and must not consume the test clock's ticks (would skew
  // matter/audit-event timestamps by one tick versus the in-memory impl).
  applySchema(db);

  const persistence = new SqliteCaseBoxPersistence({
    db,
    now: options.now,
    generateId: options.generateId,
  });
  return { persistence, db };
}
