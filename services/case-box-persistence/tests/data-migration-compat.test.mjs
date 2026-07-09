// data-migration-compat.test.mjs — WI-DESKTOP-DATA-MIGRATION-COMPAT-16.
//
// Verifies that an existing local case-box SQLite store created by an EARLIER app
// schema version opens under the CURRENT runtime WITHOUT DATA LOSS. This is the
// exact runtime the desktop app uses (`openSqliteCaseBoxPersistence`), tested here
// (the persistence package) because that is where the migration mechanism +
// `openSqliteCaseBoxPersistence` live, and where `better-sqlite3` is the node-ABI
// binding — the desktop's own copy is an Electron-ABI binding that a plain
// `node --test` cannot load. The desktop calls the SAME entrypoint, so a green
// test here IS the desktop compatibility guarantee.
//
// SYNTHETIC DATA ONLY, in a temp file under os.tmpdir(); no repo-tree writes and no
// real client data. It touches nothing under ~/Library or dev-memo/run/intake/.
//
// Schema/version mechanism (services/case-box-persistence/src/sqlite/schema.ts):
//   - a `schema_version(version, applied_at)` table is the single source of truth
//     (no PRAGMA user_version); CURRENT_SCHEMA_VERSION is the target.
//   - `applySchema(db)` (run unconditionally by openSqliteCaseBoxPersistence) reads
//     MAX(version), refuses a future-version DB, else applies each missing version's
//     DDL in ONE transaction and records it. Backward-compat = additive upgrade.
//
// Strategy: create a real file DB at the current version and write synthetic data
// through the persistence API (authentic rows), then SIMULATE an older on-disk
// version by dropping the newest tables (v9-v12) and rewinding the schema_version
// marker — reproducing exactly what an earlier app left on disk, with real early
// data. Reopen via the runtime and assert the upgrade restores current schema and
// preserves every row.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
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

// Tables added at v9..v12; dropping them + rewinding the marker reproduces a v8
// on-disk store. The early tables (matters v1, documents v2, audit v1, docket +
// deadlines v6) are schema-identical across v8->v12 (no v9..v12 DDL alters a
// v1..v8 table), so the simulation is faithful for the CURRENT schema history.
//
// FIDELITY BOUND (WI-16 audit M1): because the source DB is created by the current
// runtime and then rewound, this proves the migration RUNNER + additive v8->current
// upgrade + API round-trip over the current schema history. It is NOT a substitute
// for a store written by an actual older app BINARY — if a future version altered a
// v1..v8 table, or the persisted `payload_json` shape diverged, only a pinned
// old-app fixture would catch it (deliberately not committed here; the WI prefers
// generated fixtures over binary ones). The V8_TABLES self-check below fails loudly
// if the schema grows a post-v8 table this simulation does not account for.
const SIMULATED_OLD_VERSION = 8;
const NEWER_TABLES = [
  "case_box_links", // v11 (+ v12 columns) — drop first (FKs into anchors/pages)
  "case_box_anchors", // v11
  "case_box_document_page_geometries", // v10
  "case_box_document_pages", // v9
];
// Every user table that a real v8 store would contain (v1..v8). After the rewind,
// the on-disk store MUST contain only these — a leftover post-v8 table means the
// simulation is stale and the test fails rather than false-passing.
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

test("migration-compat: an older on-disk DB opens under the current runtime with no data loss", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lawbar-migrate-"));
  const dbPath = path.join(root, "case-box.sqlite");
  const STORAGE_URI = "file:///tmp/synthetic-doc.pdf"; // synthetic document-dir reference
  try {
    // --- Phase 1: create at current version + write synthetic data via the API ---
    {
      const { persistence, db } = openSqliteCaseBoxPersistence({ path: dbPath });
      assert.equal(maxSchemaVersion(db), CURRENT_SCHEMA_VERSION, "fresh DB is at current version");
      await persistence.createMatter(makeMatterInput({ name: "Synthetic Migration Matter" }));
      await persistence.registerDocument(
        DEFAULT_MATTER_ID,
        makeDocumentInput({ storage_uri: STORAGE_URI }),
      );
      await persistence.appendDocketEntry(makeDocketEntryInput());
      db.close(); // checkpoints WAL -> consistent on-disk file
    }

    // --- Phase 2: SIMULATE an earlier app version on disk (drop v9-v12, rewind marker) ---
    {
      const raw = new Database(dbPath);
      raw.pragma("foreign_keys = OFF");
      for (const t of NEWER_TABLES) raw.exec(`DROP TABLE IF EXISTS ${t};`);
      raw.prepare("DELETE FROM schema_version WHERE version > ?").run(SIMULATED_OLD_VERSION);
      assert.equal(maxSchemaVersion(raw), SIMULATED_OLD_VERSION, "on-disk store now looks like v8");
      // SELF-CHECK (audit M1): the simulated old store must contain ONLY v8-era tables.
      // A leftover post-v8 table means NEWER_TABLES/V8_TABLES are stale vs the schema —
      // fail loudly rather than silently prove a weaker upgrade than claimed.
      for (const t of userTables(raw)) {
        assert.ok(V8_TABLES.has(t), `unexpected post-v8 table '${t}' — the v8 simulation is stale, update it`);
      }
      // the early synthetic data is still present
      assert.equal(rowCount(raw, "case_box_matters"), 1);
      assert.equal(rowCount(raw, "case_box_documents"), 1);
      assert.equal(rowCount(raw, "case_box_docket_entries", "WHERE id = ?", DEFAULT_DOCKET_ENTRY_ID), 1);
      raw.close();
    }

    // --- Phase 3: reopen via the CURRENT runtime -> must upgrade v8 -> current ---
    {
      const { persistence, db } = openSqliteCaseBoxPersistence({ path: dbPath });

      // (a) database opens + schema reaches the expected current state
      assert.equal(maxSchemaVersion(db), CURRENT_SCHEMA_VERSION, "upgraded to current version");

      // (b) existing synthetic matter data remains readable THROUGH the API — deep fields, not just presence
      const matter = await persistence.getMatter(DEFAULT_MATTER_ID);
      assert.ok(matter, "matter survived the upgrade");
      assert.equal(matter.name, "Synthetic Migration Matter", "matter name intact");
      assert.equal(matter.matter_type, "litigation", "matter_type intact");
      assert.equal(matter.status, "active", "matter status intact");

      // (c) document + its directory reference + content fields remain intact
      const doc = await persistence.getDocument(DEFAULT_DOCUMENT_ID);
      assert.ok(doc, "document survived the upgrade");
      assert.equal(doc.storage_uri, STORAGE_URI, "document storage reference intact");
      assert.equal(doc.filename, "complaint.pdf", "document filename intact");
      assert.equal(doc.matter_id, DEFAULT_MATTER_ID, "document matter linkage intact");

      // (d) audit / event / deadline / docket tables are NOT dropped, and the SPECIFIC synthetic rows survived
      for (const t of ["case_box_audit_events", "case_box_audit_chain_heads", "case_box_deadlines", "case_box_docket_entries"]) {
        assert.ok(tableExists(db, t), `${t} must still exist after upgrade`);
      }
      // the exact docket entry (by id) survived, not merely "some row"
      assert.equal(
        rowCount(db, "case_box_docket_entries", "WHERE id = ?", DEFAULT_DOCKET_ENTRY_ID),
        1,
        "the synthetic docket entry survived by id",
      );
      // createMatter wrote an audit chain head + events for the matter; both must persist and stay consistent
      const head = db
        .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
        .get(DEFAULT_MATTER_ID);
      assert.ok(head, "audit chain head for the matter survived");
      const eventCount = rowCount(db, "case_box_audit_events", "WHERE matter_id = ?", DEFAULT_MATTER_ID);
      assert.ok(eventCount >= 1, "audit events survived the upgrade");
      assert.equal(head.event_count, eventCount, "audit chain head count matches surviving events");

      // (e) the v9-v12 tables the older store lacked are restored by the migration
      for (const t of NEWER_TABLES) {
        assert.ok(tableExists(db, t), `${t} must be (re)created by the upgrade`);
      }
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true }); // temp only; no repo-tree data
  }
});

test("migration-compat: reopening an already-current DB is an idempotent no-op", async () => {
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
