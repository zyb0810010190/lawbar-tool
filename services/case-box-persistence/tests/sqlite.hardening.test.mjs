// SQLite hardening tests for case-box-persistence Phase B1.
// Per dev-memo/plan-case-box-persistence-B1-matter.md §1.3 + rev-2 risk #7:
// B1 hardening = pragma + schema-version smoke + audit-chain-head
// invariant. B5 owns crash-injection / WAL-replay / deeper hardening.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import {
  applySchema,
  CURRENT_SCHEMA_VERSION,
  CaseBoxPersistenceError,
  openSqliteCaseBoxPersistence,
} from "../dist/index.js";
import {
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
} from "./conformance/fixtures.mjs";

// ---------------------------------------------------------------------------
// Pragma smoke
// ---------------------------------------------------------------------------

test("Sqlite-B1: pragma journal_mode is 'memory' for :memory: DBs (smoke)", () => {
  const { db } = openSqliteCaseBoxPersistence();
  // SQLite reports "memory" for journal_mode on :memory: DBs regardless of
  // the WAL pragma — this asserts the pragma was issued without error and
  // SQLite returned the in-memory-specific value.
  const mode = db.pragma("journal_mode", { simple: true });
  assert.equal(mode, "memory");
  db.close();
});

test("Sqlite-B1: pragma journal_mode is 'wal' for file-backed DBs", () => {
  const dir = mkdtempSync(join(tmpdir(), "casebox-b1-wal-"));
  try {
    const { db } = openSqliteCaseBoxPersistence({ path: join(dir, "test.db") });
    const mode = db.pragma("journal_mode", { simple: true });
    assert.equal(mode, "wal");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Sqlite-B1: pragma busy_timeout is non-zero", () => {
  const { db } = openSqliteCaseBoxPersistence();
  const timeout = db.pragma("busy_timeout", { simple: true });
  assert.ok(timeout > 0, `busy_timeout must be > 0 (got ${timeout})`);
  db.close();
});

test("Sqlite-B1: pragma foreign_keys is ON (1)", () => {
  const { db } = openSqliteCaseBoxPersistence();
  const fk = db.pragma("foreign_keys", { simple: true });
  assert.equal(fk, 1);
  db.close();
});

// ---------------------------------------------------------------------------
// applySchema smoke
// ---------------------------------------------------------------------------

test("Sqlite-B1: applySchema on empty DB applies v1 once", () => {
  const db = new Database(":memory:");
  const v = applySchema(db);
  assert.equal(v, CURRENT_SCHEMA_VERSION);
  const rows = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
  assert.deepEqual(rows.map((r) => r.version), [1]);
  db.close();
});

test("Sqlite-B1: applySchema is idempotent at vN (second call no-op)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  const before = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get();
  applySchema(db);
  const after = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get();
  assert.deepEqual(after, before);
  db.close();
});

test("Sqlite-B1: applySchema refuses a future-version DB before any mutation", () => {
  const db = new Database(":memory:");
  // Hand-craft a schema_version table at v2 (CURRENT_SCHEMA_VERSION is 1).
  db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
           INSERT INTO schema_version (version, applied_at) VALUES (2, '2026-05-22T00:00:00.000Z');`);
  assert.throws(() => applySchema(db), CaseBoxPersistenceError);
  // Verify no other tables were created (refusal before mutation).
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_version'")
    .all();
  assert.equal(tables.length, 0);
  db.close();
});

// ---------------------------------------------------------------------------
// Audit-chain head invariant: event_count == COUNT(*) == MAX(sequence)
// Per B1 plan §9 parity matrix + rev-1 reviewer Dim-2 #3 / Dim-4 #1.
// ---------------------------------------------------------------------------

test("Sqlite-B1: audit-chain-head invariant after createMatter (event_count == COUNT(*) == MAX(sequence))", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("hard1"),
  });
  await persistence.createMatter(makeMatterInput());
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 1);
  assert.equal(count.c, 1);
  assert.equal(maxSeq.m, 1);
  db.close();
});

test("Sqlite-B1: audit-chain-head invariant after archive + unarchive (3 events)", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("hard2"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  await persistence.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 3, "event_count must match committed event count");
  assert.equal(count.c, 3, "COUNT(*) must match committed event count");
  assert.equal(maxSeq.m, 3, "MAX(sequence) must match committed event count");
  db.close();
});
