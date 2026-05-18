// Step 10I-B1 + ADR-11G — schema v3 migration tests for the SQLite OCR
// persistence + queue store.
//
// What this pins:
//   - empty DB → applySchema brings it to v3 in one call
//   - v1-only DB (already migrated by an earlier 9-era persistence) is
//     upgraded additively without touching v1 tables/data
//   - v3 → v3 is idempotent (no spurious rows, no clock samples)
//   - v4-on-disk is REFUSED before any mutation (newer-version guard)
//   - queue tables and the partial-unique active-job_id index exist
//   - queue tables carry NO foreign key to ocr_jobs (queue lifecycle is
//     independent of persistence by design)
//   - ADR-11G: ocr_jobs has the nullable pending_retry_submission_json
//     column after v3
//   - openSqliteOcrQueue applies WAL and a non-zero busy_timeout
//
// All tests use file-backed temp DBs where restart-style behavior is
// asserted; idempotency-only tests stay on `:memory:` for speed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import {
  applySchema,
  CURRENT_SCHEMA_VERSION,
  openSqliteOcrQueue,
} from "../dist/index.js";

function tmpDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "ocr-queue-schema-"));
  return { path: join(dir, "queue.sqlite"), dir };
}

test("CURRENT_SCHEMA_VERSION is 3", () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 3);
});

test("applySchema on empty DB applies v1, v2, v3 in one call", () => {
  const db = new Database(":memory:");
  try {
    const v = applySchema(db);
    assert.equal(v, 3);

    const rows = db
      .prepare("SELECT version FROM schema_version ORDER BY version ASC")
      .all();
    assert.deepEqual(
      rows.map((r) => r.version),
      [1, 2, 3],
    );

    // v1 tables present.
    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.ok(tableNames.includes("ocr_jobs"));
    assert.ok(tableNames.includes("ocr_status_events"));
    assert.ok(tableNames.includes("ocr_results"));
    // v2 tables present.
    assert.ok(tableNames.includes("ocr_queue_jobs"));
    assert.ok(tableNames.includes("ocr_queue_receipts"));

    // v3 column on ocr_jobs.
    const cols = db
      .prepare("PRAGMA table_info(ocr_jobs)")
      .all()
      .map((r) => r.name);
    assert.ok(
      cols.includes("pending_retry_submission_json"),
      "ADR-11G: ocr_jobs must carry pending_retry_submission_json after v3",
    );
  } finally {
    db.close();
  }
});

test("applySchema on a v1-only DB is upgraded additively to v3", () => {
  // Simulate a Step-9-era DB: only the v1 statements applied, schema_version
  // row carries 1.
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version (version, applied_at) VALUES (1, '2026-01-01T00:00:00Z');
      CREATE TABLE ocr_jobs (
        job_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        case_id TEXT,
        document_id TEXT NOT NULL,
        document_revision INTEGER,
        submitted_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        terminal_state TEXT,
        submission_json TEXT NOT NULL,
        metadata_json TEXT
      );
      INSERT INTO ocr_jobs
        (job_id, tenant_id, document_id, submitted_by, created_at, submission_json)
        VALUES ('j1', 't1', 'd1', 'user', '2026-01-01T00:00:00Z', '{}');
    `);

    const v = applySchema(db);
    assert.equal(v, 3);

    // v1 row still 1; v2 + v3 rows added; v1 data preserved.
    const versions = db
      .prepare("SELECT version FROM schema_version ORDER BY version ASC")
      .all()
      .map((r) => r.version);
    assert.deepEqual(versions, [1, 2, 3]);

    const jobRow = db
      .prepare("SELECT job_id FROM ocr_jobs WHERE job_id = 'j1'")
      .get();
    assert.deepEqual(jobRow, { job_id: "j1" });

    // v2 tables now exist.
    const queueTables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ocr_queue_jobs','ocr_queue_receipts')",
      )
      .all()
      .map((r) => r.name)
      .sort();
    assert.deepEqual(queueTables, ["ocr_queue_jobs", "ocr_queue_receipts"]);
  } finally {
    db.close();
  }
});

test("applySchema is idempotent at v3 (no extra rows, no clock samples)", () => {
  const db = new Database(":memory:");
  try {
    let calls = 0;
    const clock = () => {
      calls++;
      return new Date("2030-01-01T00:00:00Z");
    };
    applySchema(db, clock);
    const callsAfterFirst = calls;
    applySchema(db, clock);
    applySchema(db, clock);
    assert.equal(
      calls,
      callsAfterFirst,
      "second/third apply at-current must not call the clock",
    );

    const rows = db
      .prepare("SELECT version FROM schema_version ORDER BY version ASC")
      .all();
    assert.equal(rows.length, CURRENT_SCHEMA_VERSION);
  } finally {
    db.close();
  }
});

test("applySchema refuses a v4-on-disk DB before any mutation", () => {
  const db = new Database(":memory:");
  try {
    // Pretend the DB was migrated by a future build to v4.
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version (version, applied_at) VALUES (1, '2026-01-01T00:00:00Z');
      INSERT INTO schema_version (version, applied_at) VALUES (2, '2026-01-02T00:00:00Z');
      INSERT INTO schema_version (version, applied_at) VALUES (3, '2026-01-03T00:00:00Z');
      INSERT INTO schema_version (version, applied_at) VALUES (4, '2026-01-04T00:00:00Z');
      -- Simulate a v4-only marker table whose presence we will assert is
      -- left untouched after the refusal.
      CREATE TABLE __future_v4_marker (id INTEGER);
    `);

    assert.throws(
      () => applySchema(db),
      (err) =>
        err instanceof Error &&
        /newer than supported/.test(err.message) &&
        /4/.test(err.message),
      "applySchema must throw before mutating a newer-version DB",
    );

    // Refusal is pre-mutation — schema_version contents are unchanged and
    // no rollback half-state was left behind.
    const versions = db
      .prepare("SELECT version FROM schema_version ORDER BY version ASC")
      .all()
      .map((r) => r.version);
    assert.deepEqual(versions, [1, 2, 3, 4]);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    assert.deepEqual(tables, ["__future_v4_marker", "schema_version"]);
  } finally {
    db.close();
  }
});

test("v2 queue tables: partial unique on active job_id, no FK to ocr_jobs", () => {
  const db = new Database(":memory:");
  try {
    applySchema(db);

    // No FOREIGN KEY entries on either queue table.
    const fkJobs = db.pragma("foreign_key_list(ocr_queue_jobs)");
    assert.deepEqual(fkJobs, [], "ocr_queue_jobs must have no FK");
    const fkReceipts = db.pragma("foreign_key_list(ocr_queue_receipts)");
    assert.deepEqual(fkReceipts, [], "ocr_queue_receipts must have no FK");

    // Pin the full set of v2 indexes by name. Each one is load-bearing:
    //   - uq_ocr_queue_jobs_active_jobid → active dedupe (1-per-job_id)
    //   - idx_ocr_queue_jobs_claimable   → drives claimNext FIFO + lazy
    //                                       reclaim of expired claims
    //   - idx_ocr_queue_receipts_by_job  → per-job receipt lookups for
    //                                       restart classification
    // A drop of any of these is a queue-correctness regression, not just
    // a perf regression.
    const jobIndexes = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='ocr_queue_jobs'",
      )
      .all();
    const partial = jobIndexes.find(
      (ix) => ix.name === "uq_ocr_queue_jobs_active_jobid",
    );
    assert.ok(partial, "expected partial unique index uq_ocr_queue_jobs_active_jobid");
    assert.match(partial.sql, /UNIQUE/i);
    assert.match(partial.sql, /WHERE\s+state\s*!=\s*'resolved'/i);

    const claimable = jobIndexes.find(
      (ix) => ix.name === "idx_ocr_queue_jobs_claimable",
    );
    assert.ok(claimable, "expected idx_ocr_queue_jobs_claimable on ocr_queue_jobs");
    // Composite over (state, enqueue_seq) — order matters for FIFO scan.
    assert.match(claimable.sql, /\bstate\b/);
    assert.match(claimable.sql, /\benqueue_seq\b/);

    const receiptIndexes = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='ocr_queue_receipts'",
      )
      .all();
    const byJob = receiptIndexes.find(
      (ix) => ix.name === "idx_ocr_queue_receipts_by_job",
    );
    assert.ok(byJob, "expected idx_ocr_queue_receipts_by_job on ocr_queue_receipts");
    assert.match(byJob.sql, /\bjob_id\b/);
    assert.match(byJob.sql, /\bissued_at_ms\b/);

    // Functional check: two non-resolved rows with same job_id collide;
    // a resolved row + a fresh waiting row for the same job_id is OK.
    db.prepare(
      `INSERT INTO ocr_queue_jobs (transport_id, job_id, job_json, submission_json,
                                    state, enqueued_at_ms, enqueue_seq)
         VALUES ('t1', 'jX', '{}', '{}', 'waiting', 1, 1)`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO ocr_queue_jobs (transport_id, job_id, job_json, submission_json,
                                          state, enqueued_at_ms, enqueue_seq)
               VALUES ('t2', 'jX', '{}', '{}', 'waiting', 2, 2)`,
          )
          .run(),
      /UNIQUE/,
    );
    // Resolve the original; a fresh waiting row for the same job_id is now
    // allowed by the partial-unique index.
    db.prepare(
      "UPDATE ocr_queue_jobs SET state='resolved', resolution='completed', resolved_at_ms=99 WHERE transport_id='t1'",
    ).run();
    db.prepare(
      `INSERT INTO ocr_queue_jobs (transport_id, job_id, job_json, submission_json,
                                    state, enqueued_at_ms, enqueue_seq)
         VALUES ('t3', 'jX', '{}', '{}', 'waiting', 3, 3)`,
    ).run();
  } finally {
    db.close();
  }
});

test("openSqliteOcrQueue sets WAL journal mode and non-zero busy_timeout", () => {
  const { path, dir } = tmpDbPath();
  let db;
  try {
    const opened = openSqliteOcrQueue({ path });
    db = opened.db;
    const journal = db.pragma("journal_mode", { simple: true });
    assert.equal(journal, "wal");
    const busy = db.pragma("busy_timeout", { simple: true });
    assert.ok(busy > 0, `busy_timeout must be > 0, got ${busy}`);
  } finally {
    if (db) db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
