// Cross-job read: listOcrReviewPageRows. Extracted from SqliteOcrPersistence
// (LOC-01) as a self-contained list handler — one handler per file per the
// project's extraction conventions. Largest single extraction in the LOC-01
// split because of the 4-tuple seek predicate and the wide JOIN projection.

import type { Database as BetterSqlite3Database } from "better-sqlite3";

import type {
  ListOcrReviewPageRowsPage,
  ListOcrReviewPageRowsQuery,
  OcrResultRecord,
  OcrReviewPageRow,
} from "../types.js";

import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";

import { rowToJobRecord } from "./jobRecordMappers.js";

export function listOcrReviewPageRows(
  db: BetterSqlite3Database,
  query: ListOcrReviewPageRowsQuery,
): ListOcrReviewPageRowsPage {
  const limit = resolveLimit(query.limit);
  const filters = {
    tenant_id: query.tenant_id,
    document_id: query.document_id,
    document_revision: query.document_revision,
    case_id: query.case_id,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "review_pages", filters_hash })
      : null;

  // Filter on the result side (denormalized linkage). Manual-review queue is
  // the only supported lookup, so the index covers it.
  const where: string[] = [
    "r.tenant_id = ?",
    "r.manual_review_recommended = 1",
  ];
  const params: unknown[] = [query.tenant_id];
  if (query.document_id !== undefined) {
    where.push("r.document_id = ?");
    params.push(query.document_id);
  }
  if (query.document_revision !== undefined) {
    where.push("r.document_revision = ?");
    params.push(query.document_revision);
  }
  if (query.case_id !== undefined) {
    // Filter via job-side case_id semantics, but the denorm column on results
    // is written from job.case_id at insert time, so equality here is
    // identical to filtering on the job table.
    where.push("r.case_id = ?");
    params.push(query.case_id);
  }

  // Seek predicate for ORDER BY r.persisted_at DESC, r.job_id ASC,
  // r.page_number ASC, r.page_id ASC. "Strictly after" tuple
  // (tP, tJ, tN, tI) becomes a 4-step OR-chain:
  //   r.persisted_at < tP                                    (DESC)
  //   OR (r.persisted_at = tP AND r.job_id > tJ)             (ASC)
  //   OR (r.persisted_at = tP AND r.job_id = tJ AND r.page_number > tN) (ASC)
  //   OR (r.persisted_at = tP AND r.job_id = tJ AND r.page_number = tN
  //       AND r.page_id > tI)                                (ASC)
  if (cursor !== null) {
    const [tP, tJ, tN, tI] = cursor.last_sort_tuple as [
      string,
      string,
      number,
      string,
    ];
    where.push(
      `(
         r.persisted_at < ?
         OR (r.persisted_at = ? AND r.job_id > ?)
         OR (r.persisted_at = ? AND r.job_id = ? AND r.page_number > ?)
         OR (r.persisted_at = ? AND r.job_id = ? AND r.page_number = ? AND r.page_id > ?)
       )`,
    );
    params.push(tP, tP, tJ, tP, tJ, tN, tP, tJ, tN, tI);
  }

  const sql = `
    SELECT
      r.job_id           AS r_job_id,
      r.page_id          AS r_page_id,
      r.page_number      AS r_page_number,
      r.persisted_at     AS r_persisted_at,
      r.result_json      AS r_result_json,
      j.job_id           AS j_job_id,
      j.tenant_id        AS j_tenant_id,
      j.case_id          AS j_case_id,
      j.document_id      AS j_document_id,
      j.document_revision AS j_document_revision,
      j.submitted_by     AS j_submitted_by,
      j.created_at       AS j_created_at,
      j.terminal_state   AS j_terminal_state,
      j.submission_json  AS j_submission_json,
      j.metadata_json    AS j_metadata_json,
      j.pending_retry_submission_json AS j_pending_retry_submission_json
    FROM ocr_results r
    JOIN ocr_jobs j ON j.job_id = r.job_id
    WHERE ${where.join(" AND ")}
    ORDER BY r.persisted_at DESC, r.job_id ASC, r.page_number ASC, r.page_id ASC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit + 1) as Array<{
    r_job_id: string;
    r_page_id: string;
    r_page_number: number;
    r_persisted_at: string;
    r_result_json: string;
    j_job_id: string;
    j_tenant_id: string;
    j_case_id: string | null;
    j_document_id: string;
    j_document_revision: number | null;
    j_submitted_by: string;
    j_created_at: string;
    j_terminal_state: string | null;
    j_submission_json: string;
    j_metadata_json: string | null;
    j_pending_retry_submission_json: string | null;
  }>;

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;

  const out: OcrReviewPageRow[] = slice.map((row) => {
    const job = rowToJobRecord({
      job_id: row.j_job_id,
      tenant_id: row.j_tenant_id,
      case_id: row.j_case_id,
      document_id: row.j_document_id,
      document_revision: row.j_document_revision,
      submitted_by: row.j_submitted_by,
      created_at: row.j_created_at,
      terminal_state: row.j_terminal_state,
      submission_json: row.j_submission_json,
      metadata_json: row.j_metadata_json,
      pending_retry_submission_json: row.j_pending_retry_submission_json,
    });
    const result: OcrResultRecord = {
      result: JSON.parse(row.r_result_json) as OcrResultRecord["result"],
      persisted_at: row.r_persisted_at,
    };
    return { job, result };
  });

  const last = slice[slice.length - 1];
  const next_cursor =
    hasMore && last !== undefined
      ? encodeCursor({
          v: 1,
          kind: "review_pages",
          filters_hash,
          last_sort_tuple: [
            last.r_persisted_at,
            last.r_job_id,
            last.r_page_number,
            last.r_page_id,
          ],
        })
      : null;

  return { rows: out, next_cursor };
}
