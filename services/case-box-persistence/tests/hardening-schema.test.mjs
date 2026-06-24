// Hardening: applySchema smoke (B2). Split from former monolithic
// sqlite.hardening.test.mjs per B8 plan §1.7 (closes B7 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  applySchema,
  CURRENT_SCHEMA_VERSION,
  CaseBoxPersistenceError,
} from "./hardening-common.mjs";

test("Sqlite-B2: applySchema on empty DB applies all current versions once", () => {
  const db = new Database(":memory:");
  const v = applySchema(db);
  assert.equal(v, CURRENT_SCHEMA_VERSION);
  const rows = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
  const expected = [];
  for (let i = 1; i <= CURRENT_SCHEMA_VERSION; i++) expected.push(i);
  assert.deepEqual(rows.map((r) => r.version), expected);
  db.close();
});

test("Sqlite-B2: applySchema is idempotent at vN (second call no-op)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  const before = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get();
  applySchema(db);
  const after = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get();
  assert.deepEqual(after, before);
  db.close();
});

test("Sqlite-B2: applySchema refuses a future-version DB before any mutation", () => {
  const db = new Database(":memory:");
  // Plant a schema_version row at CURRENT_SCHEMA_VERSION+1; applySchema
  // must refuse before creating any other table.
  const futureVersion = CURRENT_SCHEMA_VERSION + 1;
  db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
           INSERT INTO schema_version (version, applied_at) VALUES (${futureVersion}, '2026-05-22T00:00:00.000Z');`);
  assert.throws(() => applySchema(db), CaseBoxPersistenceError);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_version'")
    .all();
  assert.equal(tables.length, 0);
  db.close();
});

test("Sqlite-B2+: applySchema upgrades a v1 DB additively to current version", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
           INSERT INTO schema_version (version, applied_at) VALUES (1, '2026-05-22T00:00:00.000Z');
           CREATE TABLE case_box_matters (id TEXT PRIMARY KEY, payload_json TEXT);
           CREATE TABLE case_box_audit_events (event_id TEXT PRIMARY KEY);
           CREATE TABLE case_box_audit_chain_heads (matter_id TEXT PRIMARY KEY);`);
  const v = applySchema(db);
  assert.equal(v, CURRENT_SCHEMA_VERSION);
  const docsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='case_box_documents'")
    .get();
  assert.ok(docsTable, "case_box_documents must exist after upgrade");
  const rows = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
  const expected = [];
  for (let i = 1; i <= CURRENT_SCHEMA_VERSION; i++) expected.push(i);
  assert.deepEqual(rows.map((r) => r.version), expected);
  db.close();
});

// ---------------------------------------------------------------------------
// WI-A3-PAGE-T1: schema V9 case_box_document_pages (DocumentPage page identity).
// physical_page_index is 0-BASED (CHECK >= 0); the human citation LABEL is a
// separate concern kept in payload_json, never the machine index. No FK
// (app-layer invariant); no geometry/viewport columns; no anchor/link tables.
// ---------------------------------------------------------------------------

function insertPage(db, id, documentId, physicalPageIndex) {
  db.prepare(
    `INSERT INTO case_box_document_pages
       (id, tenant_id, matter_id, document_id, physical_page_index, created_at, payload_json)
     VALUES (?, 't1', 'm1', ?, ?, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(id, documentId, physicalPageIndex);
}

test("A3-PAGE-T1: V9 creates case_box_document_pages with the expected columns (no geometry/viewport)", () => {
  const db = new Database(":memory:");
  assert.equal(applySchema(db), 9);
  const cols = db
    .prepare("PRAGMA table_info('case_box_document_pages')")
    .all()
    .map((c) => c.name)
    .sort();
  assert.deepEqual(cols, [
    "created_at",
    "document_id",
    "id",
    "matter_id",
    "payload_json",
    "physical_page_index",
    "tenant_id",
  ]);
  // No geometry / page-box / rotation / page_ratio / viewport / screen columns.
  for (const forbidden of [
    "bounds_x", "bounds_y", "bounds_width", "bounds_height", "rotation",
    "resolved_box", "page_ratio", "geometry_captured_at", "rect_x", "rect_y",
    "viewport", "screen", "device_pixel_ratio",
  ]) {
    assert.ok(!cols.includes(forbidden), `unexpected geometry/viewport column '${forbidden}'`);
  }
  db.close();
});

test("A3-PAGE-T1: physical_page_index = 0 is accepted (0-based)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  assert.doesNotThrow(() => insertPage(db, "p0", "doc-1", 0));
  const got = db
    .prepare("SELECT physical_page_index AS i FROM case_box_document_pages WHERE id='p0'")
    .get();
  assert.equal(got.i, 0);
  db.close();
});

test("A3-PAGE-T1: negative physical_page_index is rejected (CHECK >= 0)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  assert.throws(() => insertPage(db, "pneg", "doc-1", -1), /CHECK|constraint/i);
  db.close();
});

test("A3-PAGE-T1: UNIQUE(document_id, physical_page_index) is enforced", () => {
  const db = new Database(":memory:");
  applySchema(db);
  insertPage(db, "p-a", "doc-1", 0);
  assert.throws(() => insertPage(db, "p-b", "doc-1", 0), /UNIQUE|constraint/i);
  // Same index on a DIFFERENT document is fine (identity is per document).
  assert.doesNotThrow(() => insertPage(db, "p-c", "doc-2", 0));
  db.close();
});

test("A3-PAGE-T1: case_box_document_pages has NO SQLite foreign keys (app-layer invariant)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  const fks = db.prepare("PRAGMA foreign_key_list('case_box_document_pages')").all();
  assert.equal(fks.length, 0, "case-box convention forbids SQLite FKs; document_id is an app-layer invariant");
  db.close();
});

test("A3-PAGE-T1: V9 introduces NO geometry/anchor/link tables", () => {
  const db = new Database(":memory:");
  applySchema(db);
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name),
  );
  for (const absent of [
    "case_box_document_page_geometry",
    "case_box_document_page_geometries",
    "case_box_anchors",
    "case_box_links",
    "case_box_anchor_links",
  ]) {
    assert.ok(!tables.has(absent), `V9 must not create '${absent}' (foundations/anchors are later WIs)`);
  }
  db.close();
});

test("A3-PAGE-T1: V9 upgrades a V8 DB additively without dropping existing data", () => {
  const db = new Database(":memory:");
  // Plant a V8 DB with a pre-existing document row; applySchema must apply ONLY V9
  // and leave the existing data intact.
  db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
           INSERT INTO schema_version (version, applied_at) VALUES (8, '2026-06-24T00:00:00.000Z');
           CREATE TABLE case_box_documents (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
           INSERT INTO case_box_documents (id, payload_json) VALUES ('keep-me', '{}');`);
  assert.equal(applySchema(db), 9);
  const kept = db.prepare("SELECT id FROM case_box_documents WHERE id='keep-me'").get();
  assert.ok(kept, "existing document row must survive the V8 -> V9 upgrade");
  const pages = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='case_box_document_pages'")
    .get();
  assert.ok(pages, "case_box_document_pages must exist after the V9 upgrade");
  const ver = db.prepare("SELECT MAX(version) AS v FROM schema_version").get();
  assert.equal(ver.v, 9);
  db.close();
});
