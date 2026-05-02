// Focused tests for the Step 9 SQLite "should-fix" hardening:
//
// 1. applySchema is idempotent under repeat invocation (and the schema_version
//    insert tolerates the row already existing — INSERT OR IGNORE).
// 2. Unexpected better-sqlite3 driver errors are wrapped into
//    OcrPersistenceError with an "internal db error: " prefix, instead of
//    leaking raw SqliteError instances across the persistence boundary.
//
// These complement (not replace) the shared conformance harness.

import { test } from "node:test";
import assert from "node:assert/strict";

import Database from "better-sqlite3";

import {
  applySchema,
  CURRENT_SCHEMA_VERSION,
  SqliteOcrPersistence,
  OcrPersistenceError,
} from "../dist/index.js";

test("applySchema: repeated invocation is idempotent (INSERT OR IGNORE)", () => {
  const db = new Database(":memory:");
  try {
    const v1 = applySchema(db);
    const v2 = applySchema(db);
    const v3 = applySchema(db);
    assert.equal(v1, CURRENT_SCHEMA_VERSION);
    assert.equal(v2, CURRENT_SCHEMA_VERSION);
    assert.equal(v3, CURRENT_SCHEMA_VERSION);

    const rows = db
      .prepare("SELECT version FROM schema_version ORDER BY version ASC")
      .all();
    // Exactly one row regardless of how many times applySchema is called.
    assert.equal(rows.length, 1);
    assert.equal(rows[0].version, CURRENT_SCHEMA_VERSION);
  } finally {
    db.close();
  }
});

test("applySchema: schema_version row is preserved across re-runs", () => {
  const db = new Database(":memory:");
  try {
    let nowCallCount = 0;
    const fixed = () => {
      nowCallCount++;
      return new Date("2030-06-01T00:00:00Z");
    };
    applySchema(db, fixed);
    const firstApplied = db
      .prepare("SELECT applied_at FROM schema_version WHERE version = ?")
      .get(CURRENT_SCHEMA_VERSION).applied_at;

    // Second call uses a different timestamp source — INSERT OR IGNORE must
    // *not* overwrite the first applied_at.
    applySchema(db, () => new Date("2099-12-31T23:59:59Z"));
    const secondApplied = db
      .prepare("SELECT applied_at FROM schema_version WHERE version = ?")
      .get(CURRENT_SCHEMA_VERSION).applied_at;

    assert.equal(secondApplied, firstApplied);
    assert.equal(nowCallCount, 1, "applied_at clock only sampled on first apply");
  } finally {
    db.close();
  }
});

test(
  "wrapErrors: unexpected driver error becomes OcrPersistenceError with 'internal db error' prefix",
  async () => {
    // Construct a persistence WITHOUT applying the schema so any access
    // raises a raw SqliteError ("no such table: ocr_jobs"). This is a
    // realistic stand-in for any unexpected DB-layer failure (drift,
    // corruption, transient I/O) — we just need *something* the driver
    // throws on that is not a domain validation failure.
    const db = new Database(":memory:");
    try {
      const persistence = new SqliteOcrPersistence({
        db,
        applySchemaOnInit: false,
      });

      let captured;
      try {
        await persistence.getOcrJob("01arz3ndektsv4rrffq69g5fav");
      } catch (err) {
        captured = err;
      }

      assert.ok(
        captured instanceof OcrPersistenceError,
        `expected OcrPersistenceError, got ${captured?.constructor?.name}`,
      );
      assert.match(captured.message, /^internal db error: /);
      // The underlying driver message should still be visible *inside* the
      // wrapper for debuggability — we are not swallowing it, just rewrapping.
      assert.match(captured.message, /no such table/i);
    } finally {
      db.close();
    }
  },
);

test(
  "wrapErrors: domain OcrPersistenceError propagates verbatim (not wrapped)",
  async () => {
    // Sanity: the wrapping path must NOT double-wrap legitimate domain errors.
    // Calling getOcrJob on a fully-applied schema with an unknown id is not
    // an error (returns null); we use createOcrJob with invalid input which
    // raises an "invalid submission" OcrPersistenceError.
    const db = new Database(":memory:");
    try {
      const persistence = new SqliteOcrPersistence({ db });

      let captured;
      try {
        await persistence.createOcrJob({ totally: "invalid" });
      } catch (err) {
        captured = err;
      }

      assert.ok(captured instanceof OcrPersistenceError);
      assert.match(captured.message, /^invalid submission: /);
      assert.doesNotMatch(captured.message, /internal db error/);
    } finally {
      db.close();
    }
  },
);
