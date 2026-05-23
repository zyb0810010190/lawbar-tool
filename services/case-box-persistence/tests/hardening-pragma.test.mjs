// Hardening: SQLite pragma smoke (B1). Split from former monolithic
// sqlite.hardening.test.mjs per B8 plan §1.7 (closes B7 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteCaseBoxPersistence } from "./hardening-common.mjs";

test("Sqlite-B1: pragma journal_mode is 'memory' for :memory: DBs (smoke)", () => {
  const { db } = openSqliteCaseBoxPersistence();
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
