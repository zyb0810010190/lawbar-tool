// SQL helpers for SqliteCaseBoxPersistence document methods (Phase B2).
// Extracted from SqliteCaseBoxPersistence.ts to keep the class under the
// LOC-01 extraction trigger (B2 plan §6 / umbrella §5).
//
// Each helper is single-statement; sequencing + transactionality is the
// caller's responsibility. The shared cursor utility (encodeCursor /
// decodeCursor / computeFiltersHash / resolveLimit) lives in
// `src/cursor.ts` — NOT duplicated here. The listDocuments helper
// composes those utilities with a SELECT that walks the mixed-order
// index `(tenant_id, matter_id, received_at DESC, id ASC)` (or its
// filter variant when status / doc_type are set).

import type { Database } from "better-sqlite3";

import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";
import { CaseBoxPersistenceError } from "../errors.js";
import type { CaseBoxDocument } from "case-box-contract";
import type { ListDocumentsPage, ListDocumentsQuery } from "../types.js";

// ---------------------------------------------------------------------------
// Single-row helpers
// ---------------------------------------------------------------------------

export function insertDocumentRow(db: Database, d: CaseBoxDocument): void {
  db.prepare(
    `INSERT INTO case_box_documents
       (id, tenant_id, matter_id, actor_user_id, status, received_at,
        doc_type, supersedes_document_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    d.id,
    d.tenant_id,
    d.matter_id,
    d.actor_user_id,
    d.status,
    d.received_at,
    d.doc_type,
    d.supersedes_document_id ?? null,
    JSON.stringify(d),
  );
}

export function selectDocumentById(db: Database, id: string): CaseBoxDocument | null {
  const row = db
    .prepare("SELECT payload_json FROM case_box_documents WHERE id = ?")
    .get(id) as { payload_json: string } | undefined;
  if (row === undefined) return null;
  return JSON.parse(row.payload_json) as CaseBoxDocument;
}

export function hasDocumentId(db: Database, id: string): boolean {
  return db.prepare("SELECT 1 FROM case_box_documents WHERE id = ?").get(id) !== undefined;
}

/** Minimal projection for assertValidDocumentSupersession callback. */
export function selectDocumentRefById(
  db: Database,
  id: string,
): { id: string; tenant_id: string; matter_id: string } | null {
  const row = db
    .prepare("SELECT id, tenant_id, matter_id FROM case_box_documents WHERE id = ?")
    .get(id) as { id: string; tenant_id: string; matter_id: string } | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// listDocuments — inlined SQL with shared cursor utility (B2 plan §3 opt A).
// ---------------------------------------------------------------------------

interface MatterTenantRow {
  tenant_id: string;
}

export function listDocumentsSqlite(
  db: Database,
  query: ListDocumentsQuery,
): ListDocumentsPage {
  // 1. Matter-existence + tenant check (matches inMemory listDocumentsHelper).
  const matter = db
    .prepare("SELECT tenant_id FROM case_box_matters WHERE id = ?")
    .get(query.matter_id) as MatterTenantRow | undefined;
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${query.matter_id}`);
  }
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }

  // 2. resolveLimit (MANDATED reuse per B2 plan rev-1 reviewer Dim-2 #1).
  const limit = resolveLimit(query.limit);

  // 3. Filters hash + cursor decode.
  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    status: query.status,
    doc_type: query.doc_type,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "documents_by_matter", filters_hash })
      : null;

  // 4. Build SELECT with WHERE + ORDER BY received_at DESC, id ASC.
  // Seek-pagination tail (received_at < t OR (received_at = t AND id > id))
  // matches the in-memory filter direction exactly.
  const params: unknown[] = [query.tenant_id, query.matter_id];
  const whereParts: string[] = ["tenant_id = ?", "matter_id = ?"];
  if (query.status !== undefined) {
    whereParts.push("status = ?");
    params.push(query.status);
  }
  if (query.doc_type !== undefined) {
    whereParts.push("doc_type = ?");
    params.push(query.doc_type);
  }
  if (cursor !== null) {
    const [tReceived, tId] = cursor.last_sort_tuple as [string, string];
    whereParts.push("(received_at < ? OR (received_at = ? AND id > ?))");
    params.push(tReceived, tReceived, tId);
  }
  // Fetch limit+1 to detect hasMore (symmetric with in-memory).
  params.push(limit + 1);
  const sql =
    `SELECT payload_json FROM case_box_documents
     WHERE ${whereParts.join(" AND ")}
     ORDER BY received_at DESC, id ASC
     LIMIT ?`;
  const rows = db.prepare(sql).all(...params) as { payload_json: string }[];

  // 5. Slice + next_cursor.
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const documents = slice.map((r) => JSON.parse(r.payload_json) as CaseBoxDocument);
  const last = documents[documents.length - 1];
  const next_cursor =
    hasMore && last !== undefined
      ? encodeCursor({
          v: 1,
          kind: "documents_by_matter",
          filters_hash,
          last_sort_tuple: [last.received_at, last.id],
        })
      : null;
  return { rows: documents, next_cursor };
}

/** SELECT matter row (full payload) for in-tx tenant + matter-existence
 * checks during registerDocument. Returns the canonical payload_json so
 * the caller can JSON.parse to a CaseBoxMatter without a second SELECT
 * (per B2 audit Low D5#1).
 */
export function selectMatterForDocument(
  db: Database,
  matterId: string,
): { payload_json: string } | null {
  const row = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(matterId) as { payload_json: string } | undefined;
  return row ?? null;
}

/** Shared validator for document-target queries (Phase B4 getEffective
 * + Phase B5 getPrivilegeStatus). Resolves the document via
 * `case_box_documents`, verifies tenant + matter consistency, throws
 * the same error codes as the in-memory helpers' inline validation.
 * Per B4 deferred Low D2#1 + B5 natural-touch under NIGHT-RUN-SQLITE-B5-IMPL.
 *
 * Caller is expected to have already validated matter+tenant (this
 * helper does NOT re-check matter existence — it only checks the
 * document target).
 */
export function validateDocumentTarget(
  db: Database,
  query: { tenant_id: string; matter_id: string; target_id: string },
): void {
  const docEntry = selectDocumentRefById(db, query.target_id);
  if (docEntry === null) {
    throw new CaseBoxPersistenceError(
      "unknown_document",
      `unknown document target: ${query.target_id}`,
    );
  }
  if (docEntry.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `document.tenant_id (${docEntry.tenant_id}) does not match query.tenant_id (${query.tenant_id})`,
    );
  }
  if (docEntry.matter_id !== query.matter_id) {
    throw new CaseBoxPersistenceError(
      "matter_id_mismatch",
      `document.matter_id (${docEntry.matter_id}) does not match query.matter_id (${query.matter_id})`,
    );
  }
}
