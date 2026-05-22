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
// 5. B1 ships v1: matter + audit_event + audit_chain_heads tables.
//    B2 ships v2: case_box_documents table + 2 mixed-order indices.
//    B4 ships v3: case_box_confidentiality_classifications + 3 indices.
//    B5 ships v4: case_box_privilege_markers + 3 indices (mutable rows;
//    UPDATE on transition, not append-only).
//    (B3 audit observability ships read APIs without new schema.)
//    Future sub-WIs add DDL_STATEMENTS_V{N} arrays + map entries;
//    existing DDL is NEVER modified once shipped.

import type { Database } from "better-sqlite3";

import { CaseBoxPersistenceError } from "../errors.js";

export const CURRENT_SCHEMA_VERSION = 4;

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

// ---------------------------------------------------------------------------
// Version 2 (Phase B2): document entity persistence.
//
// Adds case_box_documents table + 2 indices supporting listDocuments
// seek-pagination (ORDER BY received_at DESC, id ASC) AND optional
// status + doc_type filter narrowing. Mixed-order indices match the
// query's ORDER BY exactly so SQLite can walk the index without an
// extra sort step (per B2 plan §1.1 rev-1 reviewer Dim-3 #1).
//
// R-5 (purpose / work_order_status / lifecycle free-text) and R-6
// (mime_type / byte_size / manual_extracted_text) fields stay in
// payload_json (canonical-source rule); only supersedes_document_id
// is lifted to a column for the R-5(d) supersession-invariant lookup.
//
// NO FOREIGN KEY across the case-box internal tables — SQLite ALTER
// flexibility + application-layer invariants enforce correctness.
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V2: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_documents (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     actor_user_id            TEXT    NOT NULL,
     status                   TEXT    NOT NULL,
     received_at              TEXT    NOT NULL COLLATE BINARY,
     doc_type                 TEXT    NOT NULL,
     supersedes_document_id   TEXT,
     payload_json             TEXT    NOT NULL
   );`,

  // Seek pagination index: matches ORDER BY received_at DESC, id ASC
  // exactly (mixed-order; received_at descending, id ascending).
  `CREATE INDEX IF NOT EXISTS idx_case_box_documents_by_matter
     ON case_box_documents (tenant_id, matter_id, received_at DESC, id ASC);`,

  // Filter-narrowing index: same mixed-order tail; covers
  // (tenant, matter, status, doc_type) filter combinations.
  `CREATE INDEX IF NOT EXISTS idx_case_box_documents_by_matter_filter
     ON case_box_documents (tenant_id, matter_id, status, doc_type, received_at DESC, id ASC);`,
];

// ---------------------------------------------------------------------------
// Version 3 (Phase B4): confidentiality classification persistence.
//
// Adds case_box_confidentiality_classifications table + 3 indices per
// B4 plan §1.1:
//   - per-target latest-lookup (DESC matching the centralized
//     set_at DESC, id ASC comparator).
//   - per-matter chronological list seek (unfiltered).
//   - filtered-target list seek (with target_type + target_id keys
//     before sort tail).
//
// Step-5 fields (level / prior_level / target_type / target_id /
// set_at / change_reason_code / actor_user_id) lifted to columns for
// index efficiency; payload_json carries canonical source. NO FK to
// case_box_matters or case_box_documents (application-layer
// enforcement via resolveDocumentTarget inside the transaction).
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V3: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_confidentiality_classifications (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     target_type              TEXT    NOT NULL CHECK (target_type IN ('document','fact')),
     target_id                TEXT    NOT NULL,
     level                    TEXT    NOT NULL,
     prior_level              TEXT,
     set_at                   TEXT    NOT NULL COLLATE BINARY,
     actor_user_id            TEXT    NOT NULL,
     change_reason_code       TEXT,
     payload_json             TEXT    NOT NULL
   );`,

  // Per-target latest-lookup. Mixed-order DESC/ASC matches the
  // centralized comparator (set_at DESC, id ASC tiebreak). Walked by
  // findLatestForTarget on every append (prior-row resolution) AND by
  // getEffectiveClassification.
  `CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_target
     ON case_box_confidentiality_classifications
       (matter_id, target_type, target_id, set_at DESC, id ASC);`,

  // Per-matter chronological list seek (unfiltered matter-wide).
  // listConfidentialityClassifications without target_type/target_id
  // filters walks this index. ORDER BY set_at ASC, id ASC.
  `CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_matter_seek
     ON case_box_confidentiality_classifications
       (matter_id, set_at ASC, id ASC);`,

  // Filtered-target list seek. listConfidentialityClassifications WITH
  // target_type (+optional target_id) walks this index.
  `CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_matter_target_seek
     ON case_box_confidentiality_classifications
       (matter_id, target_type, target_id, set_at ASC, id ASC);`,
];

// ---------------------------------------------------------------------------
// Version 4 (Phase B5): privilege marker persistence.
//
// Privilege markers are MUTABLE rows (status: proposed → confirmed →
// waived OR proposed → dismissed). Unlike confidentiality (append-only),
// privilege transitions UPDATE the row in place + emit a separate audit
// event for each transition. payload_json carries the canonical row;
// columns lifted: status / kind / target_type / target_id / proposed_at
// for index + filter efficiency.
//
// 3 indices:
//   - by_target (matter_id, target_type, target_id, kind, status, id) —
//     scans for confirmed-uniqueness check inside transition + per-
//     target lookups in getPrivilegeStatus.
//   - by_matter_seek (matter_id, proposed_at ASC, id ASC) — unfiltered
//     chronological list.
//   - by_matter_filter_seek (matter_id, target_type, target_id, status,
//     kind, proposed_at ASC, id ASC) — filtered list seek.
//
// No FK constraints (consistent posture from B1/B2/B3/B4).
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V4: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_privilege_markers (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     target_type              TEXT    NOT NULL CHECK (target_type IN ('document','fact')),
     target_id                TEXT    NOT NULL,
     kind                     TEXT    NOT NULL,
     status                   TEXT    NOT NULL CHECK (status IN ('proposed','confirmed','dismissed','waived')),
     proposed_at              TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,

  // Per-target confirmed-uniqueness check + per-target lookup.
  `CREATE INDEX IF NOT EXISTS idx_case_box_privilege_markers_by_target
     ON case_box_privilege_markers
       (matter_id, target_type, target_id, kind, status, id);`,

  // Per-matter chronological list seek (unfiltered).
  `CREATE INDEX IF NOT EXISTS idx_case_box_privilege_markers_by_matter_seek
     ON case_box_privilege_markers
       (matter_id, proposed_at ASC, id ASC);`,

  // Filtered list seek.
  `CREATE INDEX IF NOT EXISTS idx_case_box_privilege_markers_by_matter_filter_seek
     ON case_box_privilege_markers
       (matter_id, target_type, target_id, status, kind, proposed_at ASC, id ASC);`,
];

const DDL_BY_VERSION: ReadonlyMap<number, ReadonlyArray<string>> = new Map([
  [1, DDL_STATEMENTS_V1],
  [2, DDL_STATEMENTS_V2],
  [3, DDL_STATEMENTS_V3],
  [4, DDL_STATEMENTS_V4],
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
