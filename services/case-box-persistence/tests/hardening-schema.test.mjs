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
