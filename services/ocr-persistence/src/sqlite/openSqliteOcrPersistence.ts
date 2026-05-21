// Convenience factory: open an in-memory or file-backed SQLite database,
// apply local-durability/perf pragmas, and return a ready-to-use
// SqliteOcrPersistence. Extracted from SqliteOcrPersistence (LOC-01). The
// caller must keep a reference to the returned `db` to close it.

import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

import { SqliteOcrPersistence } from "./SqliteOcrPersistence.js";

export function openSqliteOcrPersistence(
  options: { path?: string; now?: () => Date } = {},
): { persistence: SqliteOcrPersistence; db: BetterSqlite3Database } {
  const db = new Database(options.path ?? ":memory:");
  // Local-durability/perf pragmas — NOT part of the OcrPersistence behavioural
  // contract. WAL gives concurrent readers + a single writer without blocking
  // and is a safe default for file-backed SQLite. `synchronous = NORMAL` pairs
  // with WAL: durable across process crashes (only loses uncommitted txns on
  // power loss). For `:memory:` the WAL pragma silently no-ops (returns
  // "memory"); both pragmas are harmless there.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  const persistence = new SqliteOcrPersistence({
    db,
    now: options.now,
    applySchemaOnInit: true,
  });
  return { persistence, db };
}
