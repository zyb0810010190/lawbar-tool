// data-migration-compat.test.mjs — WI-DESKTOP-DATA-MIGRATION-COMPAT-16
// (hardened by WI-MIGRATION-COMPAT-FIX1).
//
// Verifies that an existing local case-box SQLite store created by an EARLIER app
// schema version opens under the CURRENT runtime WITHOUT DATA LOSS. This is the exact
// runtime the desktop app uses (`openSqliteCaseBoxPersistence`), tested here (the
// persistence package) because that is where the migration mechanism +
// `openSqliteCaseBoxPersistence` live, and where `better-sqlite3` is the node-ABI
// binding — the desktop's own copy is an Electron-ABI binding that a plain
// `node --test` cannot load. The desktop calls the SAME entrypoint, so a green test
// here IS the desktop compatibility guarantee.
//
// SYNTHETIC DATA ONLY, temp files under os.tmpdir(); `assertSafeTempRoot()` refuses to
// run if the temp root resolves inside the repo tree or ~/Library. No repo-tree writes,
// no real client data, nothing under dev-memo/run/intake/.
//
// Schema/version mechanism (services/case-box-persistence/src/sqlite/schema.ts):
//   - a `schema_version(version, applied_at)` table is the single source of truth (no
//     PRAGMA user_version); `applySchema(db)` (run unconditionally by
//     openSqliteCaseBoxPersistence) reads MAX(version), refuses a future-version DB,
//     else applies each missing version's DDL in ONE transaction and records it.
//
// OLD-STORE FIDELITY (FIX1, audit M2): the simulated old store is NOT a current DB
// rewound. It is built from a FROZEN v1..v8 DDL snapshot (below) — a versioned fixture
// generated at test time — and populated with AUTHENTIC rows written by the persistence
// API on a separate DB and copied in via ATTACH (so rows are real API output, not
// hand-written). RESIDUAL LIMITATION (documented, deferred — see
// dev-memo/deferred-audit-findings.md): the copied rows use the CURRENT serialized
// `payload_json` shape, so this still does not prove compatibility with an actual older
// app binary's persisted-JSON quirks. That would need a pinned old-app snapshot, which
// the repo has chosen not to commit as a binary fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { openSqliteCaseBoxPersistence, CURRENT_SCHEMA_VERSION } from "../dist/index.js";
import {
  makeMatterInput,
  makeDocumentInput,
  makeDocketEntryInput,
  DEFAULT_MATTER_ID,
  DEFAULT_DOCUMENT_ID,
  DEFAULT_DOCKET_ENTRY_ID,
} from "./conformance/fixtures.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");

// COMPLETE frozen snapshot of the v1..v8 DDL (every v1..v8 table + its indexes),
// copied verbatim from schema.ts. These table DDLs are FROZEN history (never altered
// after ship — only new versions add tables), so this is exactly what a v8 store
// contained. Building the old store from this snapshot (rather than a current DB rewound
// to v8) is the FIX1 remediation of audit M2.
const FROZEN_V8_DDL = [
  // v1
  `CREATE TABLE IF NOT EXISTS schema_version (
     version    INTEGER PRIMARY KEY,
     applied_at TEXT NOT NULL
   );`,
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
  `CREATE INDEX IF NOT EXISTS idx_case_box_matters_by_tenant
     ON case_box_matters (tenant_id, status, created_at, id);`,
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
  `CREATE INDEX IF NOT EXISTS idx_case_box_audit_events_by_matter
     ON case_box_audit_events (matter_id, sequence);`,
  `CREATE TABLE IF NOT EXISTS case_box_audit_chain_heads (
     matter_id     TEXT    PRIMARY KEY,
     head_hash     TEXT,
     last_event_id TEXT,
     event_count   INTEGER NOT NULL DEFAULT 0,
     updated_at    TEXT    NOT NULL COLLATE BINARY
   );`,
  // v2
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
  `CREATE INDEX IF NOT EXISTS idx_case_box_documents_by_matter
     ON case_box_documents (tenant_id, matter_id, received_at DESC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_documents_by_matter_filter
     ON case_box_documents (tenant_id, matter_id, status, doc_type, received_at DESC, id ASC);`,
  // v3
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
  `CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_target
     ON case_box_confidentiality_classifications
       (matter_id, target_type, target_id, set_at DESC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_matter_seek
     ON case_box_confidentiality_classifications
       (matter_id, set_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_matter_target_seek
     ON case_box_confidentiality_classifications
       (matter_id, target_type, target_id, set_at ASC, id ASC);`,
  // v4
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
  `CREATE INDEX IF NOT EXISTS idx_case_box_privilege_markers_by_target
     ON case_box_privilege_markers
       (matter_id, target_type, target_id, kind, status, id);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_privilege_markers_by_matter_seek
     ON case_box_privilege_markers
       (matter_id, proposed_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_privilege_markers_by_matter_filter_seek
     ON case_box_privilege_markers
       (matter_id, target_type, target_id, status, kind, proposed_at ASC, id ASC);`,
  // v5
  `CREATE TABLE IF NOT EXISTS case_box_facts (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     source_document_id       TEXT,
     source_type              TEXT    NOT NULL,
     status                   TEXT    NOT NULL,
     purpose                  TEXT,
     as_of_date               TEXT,
     supersedes_fact_id       TEXT,
     created_at               TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_facts_by_matter_seek
     ON case_box_facts (matter_id, created_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_facts_by_matter_filter_seek
     ON case_box_facts (matter_id, status, source_type, source_document_id, created_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_facts_by_supersedes
     ON case_box_facts (matter_id, supersedes_fact_id, id);`,
  // v6
  `CREATE TABLE IF NOT EXISTS case_box_docket_entries (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     source_document_id       TEXT,
     source_type              TEXT    NOT NULL,
     proposed_kind            TEXT    NOT NULL,
     confirmation_state       TEXT    NOT NULL,
     proposed_at              TEXT    NOT NULL COLLATE BINARY,
     confirmed_deadline_id    TEXT,
     payload_json             TEXT    NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS case_box_deadlines (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     source_docket_entry_id   TEXT    NOT NULL,
     kind                     TEXT    NOT NULL,
     status                   TEXT    NOT NULL,
     due_at                   TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_docket_entries_by_matter_seek
     ON case_box_docket_entries (matter_id, proposed_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_docket_entries_by_matter_filter_seek
     ON case_box_docket_entries (matter_id, confirmation_state, source_type, proposed_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_docket_entries_by_confirmed_deadline
     ON case_box_docket_entries (matter_id, confirmed_deadline_id);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_deadlines_by_matter_seek
     ON case_box_deadlines (matter_id, due_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_deadlines_by_matter_filter_seek
     ON case_box_deadlines (matter_id, status, kind, due_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_deadlines_by_source_docket
     ON case_box_deadlines (matter_id, source_docket_entry_id, id);`,
  // v7
  `CREATE TABLE IF NOT EXISTS case_box_evidence_items (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     source_document_id       TEXT,
     status                   TEXT    NOT NULL,
     party_side               TEXT,
     supersedes_evidence_id   TEXT,
     lawyer_weight            TEXT,
     created_at               TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_evidence_items_by_matter_seek
     ON case_box_evidence_items (matter_id, created_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_evidence_items_by_matter_filter_seek
     ON case_box_evidence_items (matter_id, status, source_document_id, created_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_evidence_items_by_supersedes
     ON case_box_evidence_items (matter_id, supersedes_evidence_id, id);`,
  // v8
  `CREATE TABLE IF NOT EXISTS case_box_ocr_links (
     document_id              TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     ocr_job_id               TEXT    NOT NULL,
     direction                TEXT    NOT NULL,
     status_snapshot          TEXT    NOT NULL,
     last_seen_at             TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_ocr_links_by_matter_seek
     ON case_box_ocr_links (matter_id, last_seen_at DESC, document_id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_ocr_links_by_matter_filter_seek
     ON case_box_ocr_links (matter_id, status_snapshot, last_seen_at DESC, document_id ASC);`,
];
const SIMULATED_OLD_VERSION = 8;
// Rows the API populates that we copy into the frozen v8 store (authentic output).
const COPIED_TABLES = [
  "case_box_matters",
  "case_box_documents",
  "case_box_docket_entries",
  "case_box_audit_events",
  "case_box_audit_chain_heads",
];
// Every user table a real v8 store could contain (v1..v8). After building the fixture,
// the store MUST contain only a subset of these — an unexpected table means the fixture
// or drop-set is stale, so fail loudly rather than false-pass.
const V8_TABLES = new Set([
  "schema_version",
  "case_box_matters",
  "case_box_audit_events",
  "case_box_audit_chain_heads", // v1
  "case_box_documents", // v2
  "case_box_confidentiality_classifications", // v3
  "case_box_privilege_markers", // v4
  "case_box_facts", // v5
  "case_box_docket_entries",
  "case_box_deadlines", // v6
  "case_box_evidence_items", // v7
  "case_box_ocr_links", // v8
]);
// Tables added at v9..v12 — must NOT exist in the old store, must exist after upgrade.
const NEWER_TABLES = [
  "case_box_document_pages", // v9
  "case_box_document_page_geometries", // v10
  "case_box_anchors", // v11
  "case_box_links", // v11 (+ v12 columns)
];

function maxSchemaVersion(db) {
  return db.prepare("SELECT MAX(version) AS v FROM schema_version").get().v;
}
function tableExists(db, name) {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name) !== undefined
  );
}
function userTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
}
function rowCount(db, table, whereSql = "", ...params) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${whereSql}`).get(...params).n;
}
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return child === parent || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}
// PREFLIGHT (before any write): os.tmpdir() honors $TMPDIR — refuse if the temp root
// resolves inside the repo tree or ~/Library so the fixture can never write there.
function assertSafeTempRoot() {
  const tmp = realpathSync(os.tmpdir());
  const repo = realpathSync(REPO_ROOT);
  const lib = path.join(os.homedir(), "Library");
  assert.ok(!isInside(repo, tmp), `refusing: TMPDIR resolves inside the repo tree (${tmp})`);
  assert.ok(!isInside(lib, tmp), `refusing: TMPDIR resolves inside ~/Library (${tmp})`);
}

// Build a v8-schema store at `oldDbPath` from the frozen DDL, populated with authentic
// rows copied (via ATTACH) from `sourceDbPath` (a current DB written through the API).
function buildFrozenV8Store(oldDbPath, sourceDbPath, now) {
  const db = new Database(oldDbPath);
  try {
    db.pragma("foreign_keys = OFF");
    for (const stmt of FROZEN_V8_DDL) db.exec(stmt);
    const ins = db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)");
    for (let v = 1; v <= SIMULATED_OLD_VERSION; v++) ins.run(v, now);
    // copy authentic API rows; early-table columns are identical v8<->current (never altered)
    db.prepare("ATTACH DATABASE ? AS src").run(sourceDbPath);
    for (const t of COPIED_TABLES) db.exec(`INSERT INTO main.${t} SELECT * FROM src.${t};`);
    db.exec("DETACH DATABASE src");
    // self-checks: EXACTLY the complete v8 table set (every v1..v8 table, no v9+), at
    // version 8, with the data. Completeness guards against a "subset" fixture.
    const present = new Set(userTables(db));
    for (const t of present) {
      assert.ok(V8_TABLES.has(t), `unexpected non-v8 table '${t}' in the frozen fixture — update it`);
    }
    for (const t of V8_TABLES) {
      assert.ok(present.has(t), `frozen v8 fixture is missing v8 table '${t}' — snapshot incomplete`);
    }
    for (const t of NEWER_TABLES) assert.ok(!tableExists(db, t), `${t} must NOT exist in a v8 store`);
    assert.equal(maxSchemaVersion(db), SIMULATED_OLD_VERSION, "frozen fixture is at v8");
    assert.equal(rowCount(db, "case_box_matters"), 1, "synthetic matter present in v8 fixture");
    assert.equal(rowCount(db, "case_box_documents"), 1, "synthetic document present in v8 fixture");
    assert.equal(
      rowCount(db, "case_box_docket_entries", "WHERE id = ?", DEFAULT_DOCKET_ENTRY_ID),
      1,
      "synthetic docket entry present in v8 fixture",
    );
  } finally {
    db.close();
  }
}

const STORAGE_URI = "file:///tmp/synthetic-doc.pdf"; // synthetic document-dir reference

test("migration-compat: a frozen-DDL v8 store opens under the current runtime with no data loss", async () => {
  assertSafeTempRoot();
  const root = mkdtempSync(path.join(os.tmpdir(), "lawbar-migrate-"));
  const oldDbPath = path.join(root, "case-box.sqlite"); // the "old" store we upgrade
  const sourceDbPath = path.join(root, "source.sqlite"); // API-written source of authentic rows
  try {
    // --- Phase 1: authentic synthetic rows via the API (current version) ---
    {
      const { persistence, db } = openSqliteCaseBoxPersistence({ path: sourceDbPath });
      await persistence.createMatter(makeMatterInput({ name: "Synthetic Migration Matter" }));
      await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ storage_uri: STORAGE_URI }));
      await persistence.appendDocketEntry(makeDocketEntryInput());
      db.close();
    }

    // --- Phase 2: build a FROZEN v8 store populated with those authentic rows ---
    buildFrozenV8Store(oldDbPath, sourceDbPath, "2026-05-20T00:00:00.000Z");

    // --- Phase 3: reopen the v8 store via the CURRENT runtime -> must upgrade v8 -> current ---
    {
      const { persistence, db } = openSqliteCaseBoxPersistence({ path: oldDbPath });

      // (a) database opens + schema reaches the expected current state
      assert.equal(maxSchemaVersion(db), CURRENT_SCHEMA_VERSION, "upgraded to current version");

      // (b) matter readable THROUGH the API — deep fields, not just presence
      const matter = await persistence.getMatter(DEFAULT_MATTER_ID);
      assert.ok(matter, "matter survived the upgrade");
      assert.equal(matter.name, "Synthetic Migration Matter", "matter name intact");
      assert.equal(matter.matter_type, "litigation", "matter_type intact");
      assert.equal(matter.status, "active", "matter status intact");

      // (c) document + its directory reference + content fields intact
      const doc = await persistence.getDocument(DEFAULT_DOCUMENT_ID);
      assert.ok(doc, "document survived the upgrade");
      assert.equal(doc.storage_uri, STORAGE_URI, "document storage reference intact");
      assert.equal(doc.filename, "complaint.pdf", "document filename intact");
      assert.equal(doc.matter_id, DEFAULT_MATTER_ID, "document matter linkage intact");

      // (d) audit / event / deadline / docket tables NOT dropped, and the SPECIFIC rows survived
      for (const t of ["case_box_audit_events", "case_box_audit_chain_heads", "case_box_deadlines", "case_box_docket_entries"]) {
        assert.ok(tableExists(db, t), `${t} must still exist after upgrade`);
      }
      assert.equal(
        rowCount(db, "case_box_docket_entries", "WHERE id = ?", DEFAULT_DOCKET_ENTRY_ID),
        1,
        "the synthetic docket entry survived by id",
      );
      const head = db
        .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
        .get(DEFAULT_MATTER_ID);
      assert.ok(head, "audit chain head for the matter survived");
      const eventCount = rowCount(db, "case_box_audit_events", "WHERE matter_id = ?", DEFAULT_MATTER_ID);
      assert.ok(eventCount >= 1, "audit events survived the upgrade");
      assert.equal(head.event_count, eventCount, "audit chain head count matches surviving events");

      // (e) the v9-v12 tables the old store lacked are created by the migration
      for (const t of NEWER_TABLES) {
        assert.ok(tableExists(db, t), `${t} must be created by the upgrade`);
      }
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true }); // temp only; no repo-tree data
  }
});

test("migration-compat: reopening an already-current DB is an idempotent no-op", async () => {
  assertSafeTempRoot();
  const root = mkdtempSync(path.join(os.tmpdir(), "lawbar-migrate-"));
  const dbPath = path.join(root, "case-box.sqlite");
  try {
    let baselineVersionRows;
    {
      const { persistence, db } = openSqliteCaseBoxPersistence({ path: dbPath });
      await persistence.createMatter(makeMatterInput({ name: "Idempotent Reopen" }));
      baselineVersionRows = rowCount(db, "schema_version");
      db.close();
    }
    // reopen twice more; a no-op reopen must NOT re-apply DDL: version stable, NO new
    // schema_version rows (no duplicate/re-recorded versions), and data byte-stable.
    for (let i = 0; i < 2; i++) {
      const { persistence, db } = openSqliteCaseBoxPersistence({ path: dbPath });
      assert.equal(maxSchemaVersion(db), CURRENT_SCHEMA_VERSION, "version stable on reopen");
      assert.equal(rowCount(db, "schema_version"), baselineVersionRows, "no new schema_version rows on no-op reopen");
      assert.equal(rowCount(db, "case_box_matters"), 1, "no duplicate/lost matter rows on reopen");
      const matter = await persistence.getMatter(DEFAULT_MATTER_ID);
      assert.ok(matter && matter.name === "Idempotent Reopen", "data stable across reopen");
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
