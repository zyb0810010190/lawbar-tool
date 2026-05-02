// SQLite schema for OcrPersistence (Step 9).
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
// 3. Timestamps are ISO-8601 UTC strings (`Date.prototype.toISOString()`),
//    stored as TEXT with COLLATE BINARY so lexicographic byte order matches
//    chronological order — required by cursor seek-pagination tuples.
//
// 4. Booleans are encoded as INTEGER 0/1 with a CHECK so an attacker (or a
//    bug) cannot smuggle "yes"/null/2 into manual_review_recommended.
//
// 5. The schema is versioned via `schema_version`. `applySchema` is
//    idempotent — re-running it is a no-op once version 1 is recorded.
//    A real migration framework is out of scope for Step 9.
//
// 6. PRAGMA foreign_keys = ON is set on every connection in
//    SqliteOcrPersistence (NOT in this file) because the pragma is per-
//    connection in SQLite, not per-database.

import type { Database } from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 1;

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

/**
 * Idempotently apply the current schema to `db`. Records the applied
 * version in `schema_version`. Safe to call multiple times.
 *
 * The caller owns the connection; this function does NOT enable foreign
 * keys (that pragma is per-connection and is set in SqliteOcrPersistence).
 *
 * @returns the schema version now present in the DB (1 today).
 */
export function applySchema(
  db: Database,
  now: () => Date = () => new Date(),
): number {
  // Wrap DDL in a single transaction so partial-application can never leave
  // the DB in an inconsistent shape.
  db.exec("BEGIN");
  try {
    for (const stmt of DDL_STATEMENTS_V1) {
      db.exec(stmt);
    }
    // INSERT OR IGNORE keeps applySchema idempotent under concurrent boot —
    // two processes racing on the same DB cannot trip a UNIQUE/PK error on
    // schema_version. The first writer wins; subsequent writers no-op.
    db.prepare(
      "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)",
    ).run(CURRENT_SCHEMA_VERSION, now().toISOString());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return CURRENT_SCHEMA_VERSION;
}
