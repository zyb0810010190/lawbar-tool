// SQL helpers for SqliteCaseBoxPersistence evidence-item methods (Phase B8).
// Mirrors {matter,document,audit,classification,privilege,facts,docket,
// deadline}RepoQueries.ts sibling pattern. Per B8 plan §1.2 (READY at
// commit 767f1a4).
//
// Four exports:
//   - applyAppendEvidenceItemSqlite (proposed-only append; caller-tx-wrapped).
//   - applyTransitionEvidenceItemSqlite (caller-tx-wrapped UPDATE + audit).
//   - getEvidenceItemSqlite (pure read; tenant + matter scope).
//   - listEvidenceItemsSqlite (paginated read with status + source_document_id
//     filters per ListEvidenceItemsQuery; validateDocumentTarget when
//     source_document_id provided per 6.A6 cross-tenant/cross-matter cases).
//
// Transaction-scope rule (per B7 plan §1.4 transaction-scope constraint):
// every helper runs INSIDE the caller's `#runImmediateWrite` transaction.
// None opens its own transaction.
//
// Per B8 plan §1.4 + rev-2 reviewer M D1#1: `EvidenceTransitionOpts.replacement_evidence_id`
// is the OPTION KEY for the accepted→superseded edge; the LIFTED ROW
// COLUMN that the helper populates is `supersedes_evidence_id`. The
// helper writes opts.replacement_evidence_id → prepared.next.supersedes_evidence_id
// inside prepareTransitionEvidenceItem; this file persists prepared.next
// to the DB row unchanged.

import type { Database } from "better-sqlite3";

import type { CaseBoxEvidenceItem } from "case-box-contract";

import { eventHashFn, type StoredAuditEvent } from "../auditChain.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";
import { CaseBoxPersistenceError } from "../errors.js";
import {
  createEvidenceState,
  prepareAppendEvidenceItem,
  prepareTransitionEvidenceItem,
  type EvidenceState,
  type EvidenceTransitionOpts,
} from "../inMemoryEvidence.js";
import type {
  GetEvidenceItemQuery,
  ListEvidenceItemsPage,
  ListEvidenceItemsQuery,
} from "../types.js";
import { validateDocumentTarget } from "./documentRepoQueries.js";
import { SqliteBackedIdSet } from "./sqliteBackedIdSet.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireMatterTenant(
  db: Database,
  matterId: string,
  queryTenantId?: string,
): void {
  const row = db
    .prepare("SELECT tenant_id FROM case_box_matters WHERE id = ?")
    .get(matterId) as { tenant_id: string } | undefined;
  if (row === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
  }
  if (queryTenantId !== undefined && row.tenant_id !== queryTenantId) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${queryTenantId}) does not match matter.tenant_id (${row.tenant_id})`,
    );
  }
}

function loadDocumentForResolve(
  db: Database,
  documentId: string,
): { document: import("case-box-contract").CaseBoxDocument } | null {
  const row = db
    .prepare("SELECT payload_json FROM case_box_documents WHERE id = ?")
    .get(documentId) as { payload_json: string } | undefined;
  if (row === undefined) return null;
  return { document: JSON.parse(row.payload_json) as import("case-box-contract").CaseBoxDocument };
}

/**
 * Shadow `EvidenceState` for append. SqliteBackedIdSet on evidenceIds
 * (verified: prepareAppendEvidenceItem reads only .has + .add).
 */
function buildShadowAppendEvidenceState(db: Database): EvidenceState {
  const state = createEvidenceState();
  (state as { evidenceIds: Set<string> }).evidenceIds =
    new SqliteBackedIdSet(db, "case_box_evidence_items") as unknown as Set<string>;
  return state;
}

/**
 * Shadow `EvidenceState` for transition. Loads matter-scoped evidence
 * rows via a single SELECT after resolving matter_id from a targeted
 * PK lookup. Matter-scoped — NOT global. Per B6 pattern (rev-2 reviewer
 * M D3#1).
 */
function buildShadowTransitionEvidenceState(
  db: Database,
  evidenceId: string,
): EvidenceState {
  const state = createEvidenceState();
  const matterRow = db
    .prepare("SELECT matter_id FROM case_box_evidence_items WHERE id = ?")
    .get(evidenceId) as { matter_id: string } | undefined;
  if (matterRow === undefined) {
    return state;
  }
  const matterId = matterRow.matter_id;
  const rows = db
    .prepare("SELECT payload_json FROM case_box_evidence_items WHERE matter_id = ?")
    .all(matterId) as { payload_json: string }[];
  const evidences = rows.map((r) => JSON.parse(r.payload_json) as CaseBoxEvidenceItem);
  state.evidenceByMatter.set(matterId, evidences);
  for (const e of evidences) {
    state.evidenceIds.add(e.id);
    state.evidenceIndex.set(e.id, matterId);
    state.evidenceById.set(e.id, e);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Row writers
// ---------------------------------------------------------------------------

export function insertEvidenceItemRow(db: Database, e: CaseBoxEvidenceItem): void {
  db.prepare(
    `INSERT INTO case_box_evidence_items
       (id, tenant_id, matter_id, source_document_id, status,
        party_side, supersedes_evidence_id, lawyer_weight,
        created_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.id,
    e.tenant_id,
    e.matter_id,
    e.source_document_id ?? null,
    e.status,
    (e as { party_side?: string | null }).party_side ?? null,
    (e as { supersedes_evidence_id?: string | null }).supersedes_evidence_id ?? null,
    (e as { lawyer_weight?: string | null }).lawyer_weight ?? null,
    e.created_at,
    JSON.stringify(e),
  );
}

export function updateEvidenceItemRow(db: Database, e: CaseBoxEvidenceItem): void {
  // Atomic-consistency hardening (M-2): scope the mutating UPDATE to the
  // resolved row's OWN tenant_id + matter_id and assert exactly one row was
  // affected. A tenant/matter scope drift between the by-id resolve and the
  // write (or out-of-band corruption) matches zero rows and RAISES rather than
  // silently writing an audit event for an unmodified row.
  const info = db
    .prepare(
      `UPDATE case_box_evidence_items
       SET status = ?, supersedes_evidence_id = ?, payload_json = ?
     WHERE id = ? AND tenant_id = ? AND matter_id = ?`,
    )
    .run(
      e.status,
      (e as { supersedes_evidence_id?: string | null }).supersedes_evidence_id ?? null,
      JSON.stringify(e),
      e.id,
      e.tenant_id,
      e.matter_id,
    );
  if (info.changes !== 1) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `evidence-item scoped update affected ${info.changes} rows, expected 1 (tenant/matter scope drift for id=${e.id})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Shared write deps (mirror of SqliteWriteDeps).
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
// applyAppendEvidenceItemSqlite — caller-tx-wrapped append
// ---------------------------------------------------------------------------

export function applyAppendEvidenceItemSqlite(
  db: Database,
  input: unknown,
  deps: WriteDeps,
): CaseBoxEvidenceItem {
  const inputObj = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const matterIdFromInput = typeof inputObj.matter_id === "string" ? inputObj.matter_id : undefined;

  if (matterIdFromInput !== undefined) {
    const matterRow = db
      .prepare("SELECT 1 FROM case_box_matters WHERE id = ?")
      .get(matterIdFromInput);
    if (matterRow === undefined) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
    }
  }

  const shadow = buildShadowAppendEvidenceState(db);

  const prepared = prepareAppendEvidenceItem(shadow, input, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: () => deps.storedAuditEventsForMatter(matterIdFromInput ?? ""),
    getDocument: (documentId) => loadDocumentForResolve(db, documentId),
  });

  // Tenant + matter consistency mirror of inMemoryRepo wrapper.
  const matterTenantRow = db
    .prepare("SELECT tenant_id FROM case_box_matters WHERE id = ?")
    .get(prepared.matterId) as { tenant_id: string } | undefined;
  if (matterTenantRow === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${prepared.matterId}`);
  }
  if (matterTenantRow.tenant_id !== prepared.row.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `evidence-item.tenant_id (${prepared.row.tenant_id}) does not match matter.tenant_id (${matterTenantRow.tenant_id})`,
    );
  }

  const eventHash = eventHashFn(prepared.audit.event);
  insertEvidenceItemRow(db, prepared.row);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHash);
  return prepared.row;
}

// ---------------------------------------------------------------------------
// applyTransitionEvidenceItemSqlite — caller-tx-wrapped transition
// ---------------------------------------------------------------------------

export function applyTransitionEvidenceItemSqlite(
  db: Database,
  evidenceId: string,
  opts: EvidenceTransitionOpts,
  deps: WriteDeps,
): CaseBoxEvidenceItem {
  const state = buildShadowTransitionEvidenceState(db, evidenceId);
  // If accepted→superseded references a replacement evidence id, load
  // that row INTO the shadow state too (cross-matter visibility for
  // the helper's matter_id_mismatch / tenant_mismatch check at
  // inMemoryEvidence.ts:228-246). Without this, a cross-matter
  // replacement_id surfaces as "unknown" instead of the contract's
  // matter_id_mismatch (per 6.A6.16 conformance).
  if (opts.to === "superseded" && typeof opts.replacement_evidence_id === "string" && opts.replacement_evidence_id.length > 0 && !state.evidenceById.has(opts.replacement_evidence_id)) {
    const replacementRow = db
      .prepare("SELECT payload_json FROM case_box_evidence_items WHERE id = ?")
      .get(opts.replacement_evidence_id) as { payload_json: string } | undefined;
    if (replacementRow !== undefined) {
      const replacement = JSON.parse(replacementRow.payload_json) as CaseBoxEvidenceItem;
      state.evidenceIds.add(replacement.id);
      state.evidenceIndex.set(replacement.id, replacement.matter_id);
      state.evidenceById.set(replacement.id, replacement);
    }
  }
  const prepared = prepareTransitionEvidenceItem(state, evidenceId, opts, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: (matterId) => deps.storedAuditEventsForMatter(matterId),
  });
  updateEvidenceItemRow(db, prepared.next);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHashFn(prepared.audit.event));
  return prepared.next;
}

// ---------------------------------------------------------------------------
// getEvidenceItemSqlite — pure read
// ---------------------------------------------------------------------------

export function getEvidenceItemSqlite(
  db: Database,
  query: GetEvidenceItemQuery,
): CaseBoxEvidenceItem | null {
  // Parity with in-memory `getEvidenceItem` (inMemoryRepo.ts:617): unknown
  // matter returns null, but a tenant mismatch on a KNOWN matter throws.
  // Audit-fix per B8 reviewer M D1#1.
  const matterRow = db
    .prepare("SELECT tenant_id FROM case_box_matters WHERE id = ?")
    .get(query.matter_id) as { tenant_id: string } | undefined;
  if (matterRow === undefined) return null;
  if (matterRow.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matterRow.tenant_id})`,
    );
  }
  const row = db
    .prepare(
      `SELECT payload_json FROM case_box_evidence_items
       WHERE id = ? AND tenant_id = ? AND matter_id = ?`,
    )
    .get((query as { evidence_id: string }).evidence_id, query.tenant_id, query.matter_id) as
    | { payload_json: string }
    | undefined;
  if (row === undefined) return null;
  return JSON.parse(row.payload_json) as CaseBoxEvidenceItem;
}

// ---------------------------------------------------------------------------
// listEvidenceItemsSqlite — paginated read with filters
// ---------------------------------------------------------------------------

export function listEvidenceItemsSqlite(
  db: Database,
  query: ListEvidenceItemsQuery,
): ListEvidenceItemsPage {
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  // Validate source_document_id target (when provided) — must belong to
  // the same matter + tenant. Per 6.A6 cross-tenant/cross-matter cases
  // (mirrors B6 listFactsSqlite precedent).
  if (query.source_document_id !== undefined && query.source_document_id !== null) {
    validateDocumentTarget(db, {
      tenant_id: query.tenant_id,
      matter_id: query.matter_id,
      target_id: query.source_document_id,
    });
  }

  const limit = resolveLimit((query as { limit?: number }).limit);

  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    status: (query as { status?: string }).status,
    source_document_id: query.source_document_id,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    (query as { cursor?: string }).cursor !== undefined
      ? decodeCursor((query as { cursor: string }).cursor, { kind: "evidence_items_by_matter", filters_hash })
      : null;

  // Row-level tenant predicate (M-1): the requireMatterTenant preflight above
  // proves the MATTER belongs to query.tenant_id, but the child SELECT must
  // also filter evidence rows by their own tenant_id so a row whose tenant_id
  // differs from its matter's (a data-integrity violation / forward
  // multi-tenant drift) cannot leak. Matches getEvidenceItemSqlite +
  // listFactsSqlite.
  const params: unknown[] = [query.tenant_id, query.matter_id];
  const whereParts: string[] = ["tenant_id = ?", "matter_id = ?"];
  if (filters.status !== undefined) {
    whereParts.push("status = ?");
    params.push(filters.status);
  }
  if (filters.source_document_id !== undefined) {
    whereParts.push("source_document_id = ?");
    params.push(filters.source_document_id);
  }
  if (cursor !== null) {
    const [tCreated, tId] = cursor.last_sort_tuple as [string, string];
    whereParts.push("(created_at > ? OR (created_at = ? AND id > ?))");
    params.push(tCreated, tCreated, tId);
  }
  params.push(limit + 1);
  const sql =
    `SELECT created_at, id, payload_json FROM case_box_evidence_items
     WHERE ${whereParts.join(" AND ")}
     ORDER BY created_at ASC, id ASC
     LIMIT ?`;
  const rows = db.prepare(sql).all(...params) as {
    created_at: string;
    id: string;
    payload_json: string;
  }[];

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const lastSliceRow = slice[slice.length - 1];
  const next_cursor =
    hasMore && lastSliceRow !== undefined
      ? encodeCursor({
          v: 1,
          kind: "evidence_items_by_matter",
          filters_hash,
          last_sort_tuple: [lastSliceRow.created_at, lastSliceRow.id],
        })
      : null;
  return {
    rows: slice.map((r) => JSON.parse(r.payload_json) as CaseBoxEvidenceItem),
    next_cursor,
  };
}
