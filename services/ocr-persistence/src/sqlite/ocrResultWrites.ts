// ocr_results write helpers extracted from SqliteOcrPersistence (LOC-01).
//
// Both `saveOcrResult` (strict, dup-throws) and `saveOcrResultOnce`
// (replay-equality, dup-may-return) share an identical pre-INSERT linkage
// gauntlet: job exists, result validates, job_id / tenant_id / document_id
// match, page is in submitted pages, page_number matches the submitted page,
// document_revision (when set) matches. Centralizing the gauntlet here is
// the largest single deduplication in this refactor.
//
// All helpers below are intended to run INSIDE an already-open
// `db.transaction(...).immediate()` block — the caller owns the surrounding
// transaction boundary. None of the helpers wrap errors; OcrPersistenceError
// throws propagate to the caller's `wrapErrors` boundary.

import type { Database as BetterSqlite3Database } from "better-sqlite3";

import { validateOcrResult } from "ocr-worker-contract";

import { OcrPersistenceError } from "../types.js";
import type { OcrJobRow } from "./jobRecordMappers.js";

/** Narrow contract subset that the gauntlet enforces. The validator's full
 *  schema is what runs at validation time; this interface only types the
 *  fields the linkage gauntlet inspects. */
export interface ValidatedOcrResult {
  job_id: string;
  tenant_id: string;
  document_id: string;
  document_revision?: number;
  page_id: string;
  page_number: number;
  status: string;
  review?: { manual_review_recommended?: unknown };
}

/**
 * Run the shared linkage gauntlet. Throws `OcrPersistenceError` with the
 * specific error message the conformance harness asserts at each step.
 * Returns the validated result on success.
 *
 * Caller has already fetched `jobRow` and confirmed it exists; the gauntlet
 * does NOT re-fetch.
 */
export function validateResultAgainstJob(
  jobRow: OcrJobRow,
  jobId: string,
  result: unknown,
): ValidatedOcrResult {
  const v = validateOcrResult(result);
  if (!v.ok) {
    throw new OcrPersistenceError(`invalid result: ${v.summary}`);
  }
  const r = v.value as ValidatedOcrResult;
  if (r.job_id !== jobId) {
    throw new OcrPersistenceError(
      `result.job_id ${r.job_id} does not match jobId ${jobId}`,
    );
  }
  if (r.tenant_id !== jobRow.tenant_id) {
    throw new OcrPersistenceError(
      `result.tenant_id mismatch: ${r.tenant_id} vs ${jobRow.tenant_id}`,
    );
  }
  if (r.document_id !== jobRow.document_id) {
    throw new OcrPersistenceError(
      `result.document_id mismatch: ${r.document_id} vs ${jobRow.document_id}`,
    );
  }
  // Parse submission to inspect submitted pages. We deliberately do NOT use
  // a side table for this — the contract submission is the canonical source
  // of submitted page metadata.
  const submission = JSON.parse(jobRow.submission_json) as {
    pages: ReadonlyArray<{ page_id: string; page_number: number }>;
  };
  const submittedPage = submission.pages.find(
    (p) => p.page_id === r.page_id,
  );
  if (!submittedPage) {
    throw new OcrPersistenceError(
      `result.page_id ${r.page_id} is not present in submission.pages for job ${jobId}`,
    );
  }
  if (r.page_number !== submittedPage.page_number) {
    throw new OcrPersistenceError(
      `result.page_number ${r.page_number} does not match submitted page_number ${submittedPage.page_number} for page_id ${r.page_id}`,
    );
  }
  if (jobRow.document_revision !== null) {
    if (r.document_revision !== jobRow.document_revision) {
      throw new OcrPersistenceError(
        `result.document_revision ${r.document_revision} does not match job.document_revision ${jobRow.document_revision}`,
      );
    }
  }
  return r;
}

/**
 * Compute the `manual_review_recommended` column (0/1) from a validated
 * result. Centralized so strict and once paths cannot diverge on the
 * truthy-check shape.
 */
export function manualReviewColumn(r: ValidatedOcrResult): 0 | 1 {
  return r.review !== undefined && r.review.manual_review_recommended === true
    ? 1
    : 0;
}

/**
 * Insert one ocr_results row. Caller has already validated the result via
 * `validateResultAgainstJob` and is inside an open `BEGIN IMMEDIATE`
 * transaction. The denormalized `case_id` column is sourced from the JOB
 * row (canonical), NOT from the result payload.
 */
export function insertOcrResultRow(
  db: BetterSqlite3Database,
  jobId: string,
  jobRow: OcrJobRow,
  r: ValidatedOcrResult,
  persistedAt: string,
): void {
  db.prepare(
    `INSERT INTO ocr_results
       (job_id, page_id, page_number, tenant_id, case_id, document_id,
        document_revision, status, manual_review_recommended,
        persisted_at, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jobId,
    r.page_id,
    r.page_number,
    r.tenant_id,
    // Denorm case_id from JOB (canonical source) — not from result.
    jobRow.case_id,
    r.document_id,
    r.document_revision ?? null,
    r.status,
    manualReviewColumn(r),
    persistedAt,
    JSON.stringify(r),
  );
}
