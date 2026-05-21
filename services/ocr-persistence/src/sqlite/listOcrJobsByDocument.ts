// Cross-job read: listOcrJobsByDocument. Extracted from SqliteOcrPersistence
// (LOC-01) as a self-contained list handler — one handler per file per the
// project's extraction conventions.

import type { Database as BetterSqlite3Database } from "better-sqlite3";

import type {
  ListOcrJobsByDocumentPage,
  ListOcrJobsByDocumentQuery,
} from "../types.js";

import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";

import { rowToJobRecord, type OcrJobRow } from "./jobRecordMappers.js";

export function listOcrJobsByDocument(
  db: BetterSqlite3Database,
  query: ListOcrJobsByDocumentQuery,
): ListOcrJobsByDocumentPage {
  const limit = resolveLimit(query.limit);
  const filters = {
    tenant_id: query.tenant_id,
    document_id: query.document_id,
    document_revision: query.document_revision,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "jobs_by_document", filters_hash })
      : null;

  const where: string[] = ["tenant_id = ?", "document_id = ?"];
  const params: unknown[] = [query.tenant_id, query.document_id];
  if (query.document_revision !== undefined) {
    where.push("document_revision = ?");
    params.push(query.document_revision);
  }

  // Seek predicate for ORDER BY created_at DESC, job_id ASC. "Strictly after"
  // tuple (tCreated, tJobId) is:
  //   created_at < tCreated  (DESC: smaller is later in the result order)
  //   OR (created_at = tCreated AND job_id > tJobId)
  if (cursor !== null) {
    const [tCreated, tJobId] = cursor.last_sort_tuple as [string, string];
    where.push("(created_at < ? OR (created_at = ? AND job_id > ?))");
    params.push(tCreated, tCreated, tJobId);
  }

  // Fetch limit+1 to know whether more rows remain.
  const sql = `SELECT * FROM ocr_jobs
               WHERE ${where.join(" AND ")}
               ORDER BY created_at DESC, job_id ASC
               LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit + 1) as OcrJobRow[];

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const records = slice.map((r) => rowToJobRecord(r));
  const last = slice[slice.length - 1];

  const next_cursor =
    hasMore && last !== undefined
      ? encodeCursor({
          v: 1,
          kind: "jobs_by_document",
          filters_hash,
          last_sort_tuple: [last.created_at, last.job_id],
        })
      : null;

  return { rows: records, next_cursor };
}
