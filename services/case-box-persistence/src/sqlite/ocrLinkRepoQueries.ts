// SQL helpers for SqliteCaseBoxPersistence OCR-link methods (Phase B9).
// Per B9 plan §1.2 (READY at commit 1357481).
//
// Three exports:
//   - applyUpsertOcrLinkSqlite (3-way: create/refresh/idempotent-replay).
//   - getOcrLinkSqlite (pure read with 6-step null-vs-throw parity).
//   - listOcrLinksSqlite (paginated read; ORDER BY last_seen_at DESC,
//     document_id ASC per inMemoryOcrLink.ts:286).
//
// Distinguishing features from B6-B8:
//   - PRIMARY KEY is `document_id` (NOT `id`). The contract has no `id`
//     field on CaseBoxOcrLink.
//   - Upsert has 3 branches: idempotent replay (byte-identical bytes)
//     emits NO writes + NO audit; create emits INSERT + SNAPSHOTTED;
//     refresh emits UPDATE + REFRESHED.
//   - SqliteBackedIdSet is NOT used (PK access is .get-style via
//     document_id, not .has on a Set).
//   - By-value mirror: no cross-package dependency (services/ocr-*).
//
// Transaction-scope rule (per B7 plan §1.4 + cc-suite rule): every
// helper runs INSIDE the caller's `#runImmediateWrite` transaction.
// None opens its own.

import type { Database } from "better-sqlite3";

import type {
  CaseBoxDocument,
  CaseBoxMatter,
  CaseBoxOcrLink,
} from "case-box-contract";

import { eventHashFn, type StoredAuditEvent } from "../auditChain.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";
import { CaseBoxPersistenceError } from "../errors.js";
import {
  createOcrLinkState,
  prepareUpsertOcrLink,
  type OcrLinkState,
} from "../inMemoryOcrLink.js";
import type {
  GetOcrLinkQuery,
  ListOcrLinksPage,
  ListOcrLinksQuery,
  UpsertOcrLinkResult,
} from "../types.js";
import { InMemoryAuditLog } from "../auditHeadAnchor.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadMatter(db: Database, matterId: string): CaseBoxMatter | undefined {
  const row = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(matterId) as { payload_json: string } | undefined;
  if (row === undefined) return undefined;
  return JSON.parse(row.payload_json) as CaseBoxMatter;
}

function loadDocumentEntry(
  db: Database,
  documentId: string,
): { document: CaseBoxDocument; matter_id: string } | undefined {
  const row = db
    .prepare("SELECT payload_json, matter_id FROM case_box_documents WHERE id = ?")
    .get(documentId) as { payload_json: string; matter_id: string } | undefined;
  if (row === undefined) return undefined;
  return { document: JSON.parse(row.payload_json) as CaseBoxDocument, matter_id: row.matter_id };
}

function loadOcrLinkByDocumentId(
  db: Database,
  documentId: string,
): CaseBoxOcrLink | undefined {
  const row = db
    .prepare("SELECT payload_json FROM case_box_ocr_links WHERE document_id = ?")
    .get(documentId) as { payload_json: string } | undefined;
  if (row === undefined) return undefined;
  return JSON.parse(row.payload_json) as CaseBoxOcrLink;
}

/**
 * Shadow `OcrLinkState` + `RepoView` shim for prepareUpsertOcrLink.
 * Loads only the rows the helper actually reads:
 *   - state.linksByDocumentId: at most 1 row (the prior link by
 *     document_id, if any).
 *   - repo.documents: at most 1 row (the linked document).
 *   - repo.matters: at most 1 row (the document's matter).
 *   - repo.auditByMatter: matter-scoped audit list for prevHash.
 *
 * The helper's mutation of these maps is harmless because the shadow
 * object is discarded after `prepareUpsertOcrLink` returns. The SQLite
 * caller then writes the actual SQL rows.
 */
function buildShadowState(
  db: Database,
  documentId: string,
  storedAuditEventsForMatter: (m: string) => StoredAuditEvent[],
): {
  state: OcrLinkState;
  repo: {
    matters: Map<string, CaseBoxMatter>;
    documents: Map<string, { document: CaseBoxDocument; matter_id: string }>;
    audit: InMemoryAuditLog;
  };
} {
  const state = createOcrLinkState();
  const matters = new Map<string, CaseBoxMatter>();
  const documents = new Map<string, { document: CaseBoxDocument; matter_id: string }>();
  const audit = new InMemoryAuditLog();

  const prior = loadOcrLinkByDocumentId(db, documentId);
  if (prior !== undefined) {
    state.linksByDocumentId.set(documentId, prior);
  }
  const docEntry = loadDocumentEntry(db, documentId);
  if (docEntry !== undefined) {
    documents.set(documentId, docEntry);
    const matter = loadMatter(db, docEntry.matter_id);
    if (matter !== undefined) {
      matters.set(docEntry.matter_id, matter);
      audit.reset(docEntry.matter_id, storedAuditEventsForMatter(docEntry.matter_id));
    }
  }

  return { state, repo: { matters, documents, audit } };
}

// ---------------------------------------------------------------------------
// Row writers
// ---------------------------------------------------------------------------

function insertOcrLinkRow(db: Database, link: CaseBoxOcrLink, matterId: string): void {
  db.prepare(
    `INSERT INTO case_box_ocr_links
       (document_id, tenant_id, matter_id, ocr_job_id, direction,
        status_snapshot, last_seen_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    link.document_id,
    link.tenant_id,
    matterId,
    link.ocr_job_id,
    link.direction,
    link.status_snapshot,
    link.last_seen_at,
    JSON.stringify(link),
  );
}

function updateOcrLinkRow(db: Database, link: CaseBoxOcrLink): void {
  db.prepare(
    `UPDATE case_box_ocr_links
       SET ocr_job_id = ?, direction = ?, status_snapshot = ?,
           last_seen_at = ?, payload_json = ?
     WHERE document_id = ?`,
  ).run(
    link.ocr_job_id,
    link.direction,
    link.status_snapshot,
    link.last_seen_at,
    JSON.stringify(link),
    link.document_id,
  );
}

// ---------------------------------------------------------------------------
// Shared write deps.
// ---------------------------------------------------------------------------

export interface WriteDeps {
  readonly generateId: () => string;
  readonly nowIso: () => string;
  readonly storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
  readonly writeAuditEventAndUpdateHead: (
    audit: StoredAuditEvent,
    eventHash: string,
  ) => void;
}

// ---------------------------------------------------------------------------
// applyUpsertOcrLinkSqlite — 3-way upsert
//
// Step ordering (per B9 plan §1.2 + §1.4):
//   1. Extract document_id from input (best-effort; helper re-validates).
//   2. Build shadow state via PK lookups (document, matter, prior link).
//   3. Call prepareUpsertOcrLink (validates + builds audit OR signals
//      idempotent replay via audit === undefined).
//   4. If audit === undefined → EARLY RETURN: NO row writes, NO audit.
//   5. Else: INSERT (create) or UPDATE (refresh) the row + write audit.
//
// All inside the caller's #runImmediateWrite transaction.
// ---------------------------------------------------------------------------

export function applyUpsertOcrLinkSqlite(
  db: Database,
  input: unknown,
  deps: WriteDeps,
): UpsertOcrLinkResult {
  const inputObj = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const documentIdFromInput = typeof inputObj.document_id === "string" ? inputObj.document_id : "";

  const { state, repo } = buildShadowState(db, documentIdFromInput, deps.storedAuditEventsForMatter);
  const prepared = prepareUpsertOcrLink(state, repo, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
  }, input);

  // Idempotent replay: NO row writes, NO audit emission. Explicit early
  // return per B9 plan §1.2 + rev-1 reviewer M D5#1.
  if (prepared.audit === undefined) {
    return { link: structuredClone(prepared.link) as CaseBoxOcrLink, created: false };
  }

  // Create or refresh path.
  const priorExists = state.linksByDocumentId.has(prepared.link.document_id);
  if (priorExists) {
    updateOcrLinkRow(db, prepared.link);
  } else {
    insertOcrLinkRow(db, prepared.link, prepared.matterId);
  }
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHashFn(prepared.audit.event));
  return { link: structuredClone(prepared.link) as CaseBoxOcrLink, created: prepared.created };
}

// ---------------------------------------------------------------------------
// getOcrLinkSqlite — full parity with getOcrLinkHelper (6 steps).
//
// Per B9 plan §1.2 + rev-1 reviewer M D2#2:
//   1. matter exists? → if missing, return null.
//   2. matter.tenant_id === query.tenant_id? → if not, throw tenant_mismatch.
//   3. document exists? → if missing, return null.
//   4. document.matter_id === query.matter_id? → if not, return null.
//   5. document.tenant_id === query.tenant_id? → if not, return null.
//   6. link by document_id exists? → if missing, return null; else return link.
// ---------------------------------------------------------------------------

export function getOcrLinkSqlite(
  db: Database,
  query: GetOcrLinkQuery,
): CaseBoxOcrLink | null {
  const matter = loadMatter(db, query.matter_id);
  if (matter === undefined) return null;
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const docEntry = loadDocumentEntry(db, query.document_id);
  if (docEntry === undefined) return null;
  if (docEntry.matter_id !== query.matter_id) return null;
  if (docEntry.document.tenant_id !== query.tenant_id) return null;
  const link = loadOcrLinkByDocumentId(db, query.document_id);
  if (link === undefined) return null;
  return structuredClone(link) as CaseBoxOcrLink;
}

// ---------------------------------------------------------------------------
// listOcrLinksSqlite — paginated read.
//
// Order: last_seen_at DESC, document_id ASC (matches inMemoryOcrLink.ts:286;
// per B9 plan rev-1 reviewer M D1#2 + D3#1).
// ---------------------------------------------------------------------------

export function listOcrLinksSqlite(
  db: Database,
  query: ListOcrLinksQuery,
): ListOcrLinksPage {
  const matter = loadMatter(db, query.matter_id);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${query.matter_id}`);
  }
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const limit = resolveLimit((query as { limit?: number }).limit);
  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    status_snapshot: (query as { status_snapshot?: string }).status_snapshot,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    (query as { cursor?: string }).cursor !== undefined
      ? decodeCursor((query as { cursor: string }).cursor, { kind: "ocr_links_by_matter", filters_hash })
      : null;

  // Row-level tenant predicate (M-1): the matter-tenant guard above proves the
  // matter belongs to query.tenant_id; re-assert each link row's own tenant_id
  // so a tenant-drifted link cannot leak.
  const params: unknown[] = [query.tenant_id, query.matter_id];
  const whereParts: string[] = ["tenant_id = ?", "matter_id = ?"];
  if (filters.status_snapshot !== undefined) {
    whereParts.push("status_snapshot = ?");
    params.push(filters.status_snapshot);
  }
  // Cursor seek: ORDER is last_seen_at DESC, document_id ASC.
  // For DESC sort, next page satisfies last_seen_at < tLast, OR
  // (last_seen_at == tLast AND document_id > tDoc).
  if (cursor !== null) {
    const [tLast, tDoc] = cursor.last_sort_tuple as [string, string];
    whereParts.push("(last_seen_at < ? OR (last_seen_at = ? AND document_id > ?))");
    params.push(tLast, tLast, tDoc);
  }
  params.push(limit + 1);
  const sql =
    `SELECT last_seen_at, document_id, payload_json FROM case_box_ocr_links
     WHERE ${whereParts.join(" AND ")}
     ORDER BY last_seen_at DESC, document_id ASC
     LIMIT ?`;
  const rows = db.prepare(sql).all(...params) as {
    last_seen_at: string;
    document_id: string;
    payload_json: string;
  }[];

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const lastSliceRow = slice[slice.length - 1];
  const next_cursor =
    hasMore && lastSliceRow !== undefined
      ? encodeCursor({
          v: 1,
          kind: "ocr_links_by_matter",
          filters_hash,
          last_sort_tuple: [lastSliceRow.last_seen_at, lastSliceRow.document_id],
        })
      : null;
  return {
    rows: slice.map((r) => JSON.parse(r.payload_json) as CaseBoxOcrLink),
    next_cursor,
  };
}
