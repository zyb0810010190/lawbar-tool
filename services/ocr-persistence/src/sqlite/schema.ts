// SQLite schema for OcrPersistence (Steps 9 + 10I-B1).
//
// Design notes:
//
// 1. Tables mirror the OcrPersistence record shapes. The canonical contract
//    payload (submission / result / transition) is stored verbatim as JSON
//    TEXT; columns lifted out of the JSON exist for indexing/filtering only.
//    On read we always return the JSON payload, never re-derive it from
//    columns — this keeps the canonical-source rule from the in-memory impl
//    intact and avoids field drift.
//
// 2. Linkage fields (tenant_id, case_id, document_id, document_revision) are
//    duplicated on `ocr_results` purely to support cross-job queries without
//    forcing a join through `ocr_jobs`. The duplicated values are written
//    once at insert time from the validated payload, never updated, and the
//    pre-insert linkage check (in SqliteOcrPersistence.saveOcrResult) keeps
//    them consistent with `ocr_jobs`.
//
// 3. Timestamps for the OcrPersistence tables are ISO-8601 UTC strings
//    (`Date.prototype.toISOString()`), stored as TEXT with COLLATE BINARY so
//    lexicographic byte order matches chronological order — required by
//    cursor seek-pagination tuples. The Step 10I queue tables instead use
//    INTEGER epoch-ms columns: arithmetic comparison against a Node-clock
//    `Date.now()` is the queue's primary read pattern (lease expiry, claim
//    ordering), and ISO strings would cost a parse on every comparison.
//
// 4. Booleans are encoded as INTEGER 0/1 with a CHECK so an attacker (or a
//    bug) cannot smuggle "yes"/null/2 into manual_review_recommended.
//
// 5. The schema is versioned via `schema_version`. `applySchema` is
//    idempotent: it reads MAX(version), refuses if the DB is at a version
//    *newer* than this build supports (before any mutation), and applies
//    each missing migration in order. Each migration writes its own row to
//    `schema_version` with INSERT OR IGNORE so the table acts as an audit
//    log of applied versions, not a single-row pointer. A real migration
//    framework with down-migrations is still out of scope.
//
// 6. PRAGMA foreign_keys = ON is set on every connection in
//    SqliteOcrPersistence (NOT in this file) because the pragma is per-
//    connection in SQLite, not per-database.
//
// 7. Step 10I-B1 adds queue tables (`ocr_queue_jobs`, `ocr_queue_receipts`)
//    co-located with the persistence tables per ADR
//    `docs/adr/ocr-queue-boundary-amendment-step-10h-a.md`. Crucially these
//    tables carry NO foreign key to `ocr_jobs`: the queue is a transport,
//    and persistence and queue have independent lifecycles. A job can be
//    enqueued before it is recorded in `ocr_jobs` and vice versa; an
//    atomic "createOcrJob + enqueue" seam is deliberately deferred.

import type { Database } from "better-sqlite3";

import { OcrPersistenceError } from "../types.js";

export const CURRENT_SCHEMA_VERSION = 3;

// ---------------------------------------------------------------------------
// Per-version DDL.
//
// Each migration's statements run in a single BEGIN/COMMIT (the apply loop
// holds one transaction across all missing migrations). Statements use IF
// NOT EXISTS so reapplication of an already-applied version cannot collide
// with the user's own DDL evolutions; `applySchema` itself short-circuits
// before re-running an applied version.
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V1: ReadonlyArray<string> = [
  // Version table.
  `CREATE TABLE IF NOT EXISTS schema_version (
     version    INTEGER PRIMARY KEY,
     applied_at TEXT NOT NULL
   );`,

  // Jobs.
  `CREATE TABLE IF NOT EXISTS ocr_jobs (
     job_id             TEXT    PRIMARY KEY,
     tenant_id          TEXT    NOT NULL,
     case_id            TEXT,
     document_id        TEXT    NOT NULL,
     document_revision  INTEGER,
     submitted_by       TEXT    NOT NULL,
     created_at         TEXT    NOT NULL COLLATE BINARY,
     terminal_state     TEXT,
     submission_json    TEXT    NOT NULL,
     metadata_json      TEXT
   );`,
  // Supports listOcrJobsByDocument: WHERE tenant_id, document_id (+optional
  // document_revision) ORDER BY created_at DESC, job_id ASC.
  `CREATE INDEX IF NOT EXISTS idx_ocr_jobs_by_document
     ON ocr_jobs (tenant_id, document_id, document_revision, created_at, job_id);`,

  // Status timeline.
  `CREATE TABLE IF NOT EXISTS ocr_status_events (
     job_id           TEXT    NOT NULL,
     seq              INTEGER NOT NULL,
     from_state       TEXT,
     to_state         TEXT    NOT NULL,
     controlled_by    TEXT    NOT NULL,
     occurred_at      TEXT    NOT NULL COLLATE BINARY,
     persisted_at     TEXT    NOT NULL COLLATE BINARY,
     transition_json  TEXT    NOT NULL,
     PRIMARY KEY (job_id, seq),
     FOREIGN KEY (job_id) REFERENCES ocr_jobs(job_id)
   );`,

  // Per-page results.
  `CREATE TABLE IF NOT EXISTS ocr_results (
     job_id                     TEXT    NOT NULL,
     page_id                    TEXT    NOT NULL,
     page_number                INTEGER NOT NULL,
     tenant_id                  TEXT    NOT NULL,
     case_id                    TEXT,
     document_id                TEXT    NOT NULL,
     document_revision          INTEGER,
     status                     TEXT    NOT NULL,
     manual_review_recommended  INTEGER NOT NULL CHECK (manual_review_recommended IN (0,1)),
     persisted_at               TEXT    NOT NULL COLLATE BINARY,
     result_json                TEXT    NOT NULL,
     PRIMARY KEY (job_id, page_id),
     FOREIGN KEY (job_id) REFERENCES ocr_jobs(job_id)
   );`,
  // Supports listOcrReviewPageRows manual-review queue:
  //   WHERE tenant_id = ? AND manual_review_recommended = 1 [+filters]
  //   ORDER BY persisted_at DESC, job_id ASC, page_number ASC, page_id ASC.
  `CREATE INDEX IF NOT EXISTS idx_ocr_results_review_queue
     ON ocr_results (tenant_id, manual_review_recommended, persisted_at, job_id, page_number, page_id);`,
  // Supports document_revision narrowing on review queue.
  `CREATE INDEX IF NOT EXISTS idx_ocr_results_by_document
     ON ocr_results (tenant_id, document_id, document_revision);`,
  // Supports case_id narrowing on review queue.
  `CREATE INDEX IF NOT EXISTS idx_ocr_results_by_case
     ON ocr_results (tenant_id, case_id);`,
  // Supports listOcrResults(jobId): ORDER BY persisted_at, page_id.
  `CREATE INDEX IF NOT EXISTS idx_ocr_results_by_job
     ON ocr_results (job_id, persisted_at, page_id);`,
];

// ---------------------------------------------------------------------------
// Step 10I-B1: SQLite-backed OCR queue.
//
// Two tables, no FK to ocr_jobs:
//
//  - `ocr_queue_jobs` is the queue's own row-per-enqueue ledger. It carries
//    the full OcrJob payload as JSON plus the canonical validated submission
//    payload (used as the dedupe equality key — InMemoryOcrQueue does the
//    same). `state` distinguishes waiting / claimed / resolved so the row
//    persists past completion (tombstoned). Hard-deleting on completion
//    would erase the receipt-lineage information needed to distinguish
//    `unknown_receipt` from `stale_receipt` after a process restart.
//
//  - `ocr_queue_receipts` is an append-only ledger keyed by receipt token.
//    Every claim minted by the queue (initial or post-expiry reclaim)
//    inserts one row; every resolution (complete / requeue / supersede on
//    reclaim) updates the row's `resolution`. Restart receipt classification
//    reads this table directly — there is no in-memory state.
//
// Index choices:
//  - Partial UNIQUE on (job_id) WHERE state != 'resolved': enforces "at most
//    one active queued instance per logical job_id" without preventing
//    historical resolved rows for the same job_id.
//  - (state, enqueue_seq): the claimNext lookup `WHERE state='waiting' OR
//    (state='claimed' AND claimed_until_ms <= now) ORDER BY enqueue_seq
//    LIMIT 1` walks this index.
//  - (job_id, issued_at_ms) on receipts: lets restart classification check
//    "is there a NEWER active receipt for this job_id" (→ stale_receipt)
//    without a full scan.
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V2: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS ocr_queue_jobs (
     transport_id        TEXT    PRIMARY KEY,
     job_id              TEXT    NOT NULL,
     job_json            TEXT    NOT NULL,
     submission_json     TEXT    NOT NULL,
     state               TEXT    NOT NULL CHECK (state IN ('waiting','claimed','resolved')),
     enqueued_at_ms      INTEGER NOT NULL,
     enqueue_seq         INTEGER NOT NULL UNIQUE,
     claimed_until_ms    INTEGER,
     claimed_by          TEXT,
     current_receipt     TEXT,
     resolved_at_ms      INTEGER,
     resolution          TEXT    CHECK (resolution IS NULL OR resolution IN ('completed','requeued','superseded'))
   );`,

  // At most one non-resolved row per logical job_id (active dedupe key).
  // Resolved rows are excluded so a re-enqueue after completion is allowed
  // by the index — reactivation policy is a queue-layer decision, not a
  // schema constraint.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_ocr_queue_jobs_active_jobid
     ON ocr_queue_jobs(job_id) WHERE state != 'resolved';`,

  // Drives claimNext FIFO and lazy-reclaim of expired claims.
  `CREATE INDEX IF NOT EXISTS idx_ocr_queue_jobs_claimable
     ON ocr_queue_jobs(state, enqueue_seq);`,

  // Receipt ledger. PRIMARY KEY on receipt; queries always carry a receipt.
  `CREATE TABLE IF NOT EXISTS ocr_queue_receipts (
     receipt              TEXT    PRIMARY KEY,
     job_id               TEXT    NOT NULL,
     transport_id         TEXT    NOT NULL,
     worker_id            TEXT    NOT NULL,
     issued_at_ms         INTEGER NOT NULL,
     lease_expires_at_ms  INTEGER NOT NULL,
     resolved_at_ms       INTEGER,
     resolution           TEXT    NOT NULL CHECK (resolution IN ('claimed','requeued','completed','expired_swept','superseded'))
   );`,

  // Per-job receipt lookups (e.g. "newer active receipt exists for this
  // job_id?" during restart classification of a stale token).
  `CREATE INDEX IF NOT EXISTS idx_ocr_queue_receipts_by_job
     ON ocr_queue_receipts(job_id, issued_at_ms);`,
];

// ---------------------------------------------------------------------------
// ADR-11G: durable pending-retry outbox column on ocr_jobs.
//
// SQLite's `ALTER TABLE ADD COLUMN` does not support `IF NOT EXISTS`, but the
// migration loop (gated by `readMaxSchemaVersion`) guarantees each migration
// runs at most once per database. A nullable TEXT column carries the
// validated next-attempt submission JSON when a retry is pending; NULL means
// "no pending retry" (the default for every existing and newly-inserted
// job).
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V3: ReadonlyArray<string> = [
  `ALTER TABLE ocr_jobs ADD COLUMN pending_retry_submission_json TEXT;`,
];

const DDL_BY_VERSION: ReadonlyMap<number, ReadonlyArray<string>> = new Map([
  [1, DDL_STATEMENTS_V1],
  [2, DDL_STATEMENTS_V2],
  [3, DDL_STATEMENTS_V3],
]);

/**
 * Read the highest applied schema version from the DB. Returns 0 if the
 * `schema_version` table does not yet exist (fresh DB). This is the only
 * non-mutating read that runs *before* the migration transaction so the
 * "newer-than-supported" precondition can refuse without any write.
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
 * version in `schema_version`. Safe to call multiple times.
 *
 * Refuses to mutate if the DB is already at a version *newer* than
 * `CURRENT_SCHEMA_VERSION` — the caller's binary is too old to operate
 * safely on that DB. The check runs before BEGIN, so a refusal leaves the
 * DB byte-identical to its pre-call state.
 *
 * The caller owns the connection; this function does NOT enable foreign
 * keys (that pragma is per-connection and is set in SqliteOcrPersistence /
 * SqliteOcrQueue).
 *
 * @returns the schema version now present in the DB.
 */
export function applySchema(
  db: Database,
  now: () => Date = () => new Date(),
): number {
  const current = readMaxSchemaVersion(db);
  if (current > CURRENT_SCHEMA_VERSION) {
    // Refuse before any mutation. The DB carries a migration this build
    // does not know how to read; mixing those tables with v1/v2 DDL would
    // either duplicate-create existing tables or, worse, silently skip
    // structural invariants the newer version expects.
    throw new OcrPersistenceError(
      `schema version ${current} on disk is newer than supported ${CURRENT_SCHEMA_VERSION}; refusing to apply migration`,
    );
  }
  if (current === CURRENT_SCHEMA_VERSION) {
    // Already current — nothing to do. No transaction opened.
    return CURRENT_SCHEMA_VERSION;
  }

  // Apply only missing migrations: (current, target]. Wrapped in a single
  // transaction so a failure mid-way leaves the DB at its prior version.
  db.exec("BEGIN");
  try {
    for (let v = current + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      const ddl = DDL_BY_VERSION.get(v);
      if (ddl === undefined) {
        throw new OcrPersistenceError(
          `internal: missing DDL for schema version ${v}`,
        );
      }
      for (const stmt of ddl) {
        db.exec(stmt);
      }
      // INSERT OR IGNORE keeps applySchema idempotent under concurrent boot —
      // two processes racing on the same DB cannot trip a UNIQUE/PK error on
      // schema_version. The first writer wins; subsequent writers no-op.
      db.prepare(
        "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)",
      ).run(v, now().toISOString());
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return CURRENT_SCHEMA_VERSION;
}
