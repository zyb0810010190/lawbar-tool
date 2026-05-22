// SQLite schema for CaseBoxPersistence (Phase B1).
//
// Design notes (mirrors services/ocr-persistence/src/sqlite/schema.ts):
//
// 1. Payload JSON is the canonical source. Columns lifted out of the JSON
//    exist for indexing/filtering only; on read we always return the JSON
//    payload, never re-derive it from columns. This preserves the
//    canonical-source rule from the in-memory impl and avoids field drift.
//
// 2. Timestamps are ISO-8601 UTC strings with COLLATE BINARY so
//    lexicographic byte order matches chronological order (required by
//    cursor pagination tuples in future sub-WIs).
//
// 3. NO FOREIGN KEY constraints between tables. case_box_audit_events
//    references matter_id by value (per parent §"Dependency direction is
//    one-way"). The pragma `foreign_keys = ON` is set defensively in
//    openSqliteCaseBoxPersistence but is irrelevant in practice (no FK).
//
// 4. The schema is versioned via `schema_version`. `applySchema` is
//    idempotent: reads MAX(version); refuses (throws
//    CaseBoxPersistenceError) if the DB is at a version *newer* than
//    this build supports before any mutation; otherwise applies each
//    missing migration in a single BEGIN/COMMIT and records the version
//    via a prepared INSERT.
//
// 5. B1 ships v1 only: matter + audit_event + audit_chain_heads tables.
//    Future sub-WIs (B2..B11) add DDL_STATEMENTS_V{N} arrays + map
//    entries; the existing v1 DDL is NEVER modified once shipped.

import type { Database } from "better-sqlite3";

import { CaseBoxPersistenceError } from "../errors.js";

export const CURRENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Per-version DDL.
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V1: ReadonlyArray<string> = [
  // Version table.
  `CREATE TABLE IF NOT EXISTS schema_version (
     version    INTEGER PRIMARY KEY,
     applied_at TEXT NOT NULL
   );`,

  // Matter rows. payload_json carries the full validated matter; columns
  // lifted only for indexing/filtering.
  `CREATE TABLE IF NOT EXISTS case_box_matters (
     id                     TEXT    PRIMARY KEY,
     tenant_id              TEXT    NOT NULL,
     actor_user_id          TEXT    NOT NULL,
     status                 TEXT    NOT NULL CHECK (status IN ('active','archived')),
     archived_at            TEXT,
     created_at             TEXT    NOT NULL COLLATE BINARY,
     matter_type            TEXT    NOT NULL,
     successor_matter_id    TEXT,
     payload_json           TEXT    NOT NULL
   );`,

  // Supports future listMatters (B10) seek-pagination by (tenant, status,
  // created_at, id).
  `CREATE INDEX IF NOT EXISTS idx_case_box_matters_by_tenant
     ON case_box_matters (tenant_id, status, created_at, id);`,

  // Audit events. event_json carries the full event; columns lifted for
  // chain verification + future listAuditEvents seek pagination.
  `CREATE TABLE IF NOT EXISTS case_box_audit_events (
     event_id          TEXT    PRIMARY KEY,
     tenant_id         TEXT    NOT NULL,
     matter_id         TEXT    NOT NULL,
     sequence          INTEGER NOT NULL,
     action            TEXT    NOT NULL,
     entity_type       TEXT    NOT NULL,
     entity_id         TEXT,
     actor_user_id     TEXT    NOT NULL,
     timestamp         TEXT    NOT NULL COLLATE BINARY,
     before_state_hash TEXT,
     after_state_hash  TEXT,
     prev_event_hash   TEXT,
     event_hash        TEXT    NOT NULL,
     reason            TEXT,
     event_json        TEXT    NOT NULL,
     UNIQUE (matter_id, sequence)
   );`,

  // Supports listAuditEvents seek pagination by (matter_id, sequence).
  `CREATE INDEX IF NOT EXISTS idx_case_box_audit_events_by_matter
     ON case_box_audit_events (matter_id, sequence);`,

  // Per-matter audit chain head. Updated in the SAME transaction as the
  // event insert. Load-bearing replay-safety invariant:
  //   event_count == COUNT(*) == MAX(sequence) for the same matter_id.
  `CREATE TABLE IF NOT EXISTS case_box_audit_chain_heads (
     matter_id     TEXT    PRIMARY KEY,
     head_hash     TEXT,
     last_event_id TEXT,
     event_count   INTEGER NOT NULL DEFAULT 0,
     updated_at    TEXT    NOT NULL COLLATE BINARY
   );`,
];

const DDL_BY_VERSION: ReadonlyMap<number, ReadonlyArray<string>> = new Map([
  [1, DDL_STATEMENTS_V1],
]);

/**
 * Read the highest applied schema version. Returns 0 when the
 * `schema_version` table does not yet exist (fresh DB).
 *
 * This is the only non-mutating read that runs BEFORE the migration
 * transaction so the "newer-than-supported" precondition can refuse
 * without any write.
 */
function readMaxSchemaVersion(db: Database): number {
  const tableRow = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
    )
    .get();
  if (tableRow === undefined) return 0;
  const row = db
    .prepare("SELECT MAX(version) AS v FROM schema_version")
    .get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

/**
 * Idempotently apply the current schema to `db`. Records each applied
 * version in `schema_version` via a prepared statement. Safe to call
 * multiple times.
 *
 * Refuses to mutate if the DB is already at a version *newer* than
 * `CURRENT_SCHEMA_VERSION` — the caller's binary is too old to operate
 * safely on that DB. The check runs before BEGIN, so a refusal leaves
 * the DB byte-identical to its pre-call state.
 *
 * @returns the schema version now present in the DB.
 */
export function applySchema(
  db: Database,
  now: () => Date = () => new Date(),
): number {
  const current = readMaxSchemaVersion(db);
  if (current > CURRENT_SCHEMA_VERSION) {
    throw new CaseBoxPersistenceError(
      "invalid_payload",
      `schema version ${current} on disk is newer than supported ${CURRENT_SCHEMA_VERSION}; refusing to apply migration`,
    );
  }
  if (current === CURRENT_SCHEMA_VERSION) {
    return CURRENT_SCHEMA_VERSION;
  }

  db.exec("BEGIN");
  try {
    for (let v = current + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      const statements = DDL_BY_VERSION.get(v);
      if (statements === undefined) {
        throw new CaseBoxPersistenceError(
          "invalid_payload",
          `no DDL registered for schema version ${v}`,
        );
      }
      for (const stmt of statements) {
        db.exec(stmt);
      }
      // Prepare AFTER DDL runs (v1 creates schema_version table; preparing
      // before would fail with "no such table: schema_version").
      db.prepare(
        "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)",
      ).run(v, now().toISOString());
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ROLLBACK best-effort; original error wins.
    }
    throw err;
  }
  return CURRENT_SCHEMA_VERSION;
}
