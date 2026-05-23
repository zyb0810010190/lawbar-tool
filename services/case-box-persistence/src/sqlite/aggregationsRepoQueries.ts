// SQL helpers for SqliteCaseBoxPersistence read-side aggregation
// methods (Phase B10). Per B10 plan §1.2 (READY at commit 5d77058).
//
// Five exports — all PURE READS (no #runImmediateWrite; no audit
// emission; no write paths):
//   - listMattersSqlite (paginated; status filter via lifted column;
//     ORDER BY created_at DESC, id ASC).
//   - getMatterSummarySqlite (1 matter lookup + 8 aggregation
//     buckets across child tables).
//   - getDocumentDetailSqlite (delegates to B4/B5/B9 read helpers +
//     fact_candidates SELECT).
//   - getDeadlineCalendarSqlite (optional from/to range).
//   - getFactSupersessionChainSqlite (matter-scoped walk via
//     supersedes_fact_id).
//
// NO schema changes. CURRENT_SCHEMA_VERSION stays at 8 (per B10 plan
// §1.1 + lane constraint).
//
// Cross-tenant behavior parity per in-memory helpers
// (inMemoryAggregations.ts):
//   - Unknown matter → null (or empty array for chain).
//   - Cross-tenant EXISTING matter → THROW tenant_mismatch
//     (NOT silently null).
//
// requireMatterTenant is NOT extracted (B7 L D2#1 / B9 D2#1 deferred —
// continuing per-file inlined pattern; see B10 plan §5).

import type { Database } from "better-sqlite3";

import type {
  CaseBoxDeadline,
  CaseBoxDocument,
  CaseBoxFact,
  CaseBoxMatter,
  CaseBoxOcrLink,
} from "case-box-contract";

import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";
import { CaseBoxPersistenceError } from "../errors.js";
import { FACT_CANDIDATE_PREVIEW_CAP } from "../inMemoryAggregations.js";
import type {
  DeadlineCalendarQuery,
  DocumentDetail,
  GetDocumentDetailQuery,
  GetFactSupersessionChainQuery,
  GetMatterSummaryQuery,
  ListMattersPage,
  ListMattersQuery,
  MatterSummary,
} from "../types.js";
import {
  getEffectiveClassificationSqlite,
} from "./classificationRepoQueries.js";
import {
  getOcrLinkSqlite,
} from "./ocrLinkRepoQueries.js";
import {
  getPrivilegeStatusSqlite,
} from "./privilegeRepoQueries.js";

// ---------------------------------------------------------------------------
// Internal helper — load + tenant-validate a matter.
//
// Parity contract per inMemoryAggregations.ts:
//   - missing matter: return null (caller decides null vs throw based
//     on method-specific semantics).
//   - existing matter + tenant mismatch: throw tenant_mismatch.
// ---------------------------------------------------------------------------

function loadMatterChecked(
  db: Database,
  matterId: string,
  tenantId: string,
): CaseBoxMatter | null {
  const row = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(matterId) as { payload_json: string } | undefined;
  if (row === undefined) return null;
  const matter = JSON.parse(row.payload_json) as CaseBoxMatter;
  if (matter.tenant_id !== tenantId) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${tenantId}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  return matter;
}

// ---------------------------------------------------------------------------
// listMattersSqlite — paginated tenant-scoped read.
//
// Order: created_at DESC, id ASC (matches listMattersHelper at
// inMemoryAggregations.ts:65 per B10 plan rev-1 reviewer M D1#1).
// Cursor inverted for DESC: (created_at < tCreated OR (== AND id > tId)).
//
// Status filter: uses lifted `status` column on case_box_matters
// (per schema CHECK (status IN ('active','archived'))). Matches
// CaseBoxMatter.status semantics; NOT derived from archived_at
// (per B10 plan rev-1 reviewer M D3#3).
// ---------------------------------------------------------------------------

export function listMattersSqlite(
  db: Database,
  query: ListMattersQuery,
): ListMattersPage {
  const limit = resolveLimit(query.limit);
  const filters = { tenant_id: query.tenant_id, status: query.status };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "matters_by_tenant", filters_hash })
      : null;

  const params: unknown[] = [query.tenant_id];
  const whereParts: string[] = ["tenant_id = ?"];
  if (query.status !== undefined) {
    whereParts.push("status = ?");
    params.push(query.status);
  }
  if (cursor !== null) {
    const [tCreated, tId] = cursor.last_sort_tuple as [string, string];
    whereParts.push("(created_at < ? OR (created_at = ? AND id > ?))");
    params.push(tCreated, tCreated, tId);
  }
  params.push(limit + 1);
  const sql =
    `SELECT created_at, id, payload_json FROM case_box_matters
     WHERE ${whereParts.join(" AND ")}
     ORDER BY created_at DESC, id ASC
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
          kind: "matters_by_tenant",
          filters_hash,
          last_sort_tuple: [lastSliceRow.created_at, lastSliceRow.id],
        })
      : null;
  return {
    rows: slice.map((r) => JSON.parse(r.payload_json) as CaseBoxMatter),
    next_cursor,
  };
}

// ---------------------------------------------------------------------------
// getMatterSummarySqlite — 1 matter lookup + 8 aggregation buckets.
//
// Parity per getMatterSummaryHelper:
//   - Unknown matter → null.
//   - Existing matter + tenant mismatch → THROW tenant_mismatch.
// All child counts are matter+tenant scoped (matches in-memory's
// tenant defense per audit Dim 5 #1).
// ---------------------------------------------------------------------------

export function getMatterSummarySqlite(
  db: Database,
  query: GetMatterSummaryQuery,
): MatterSummary | null {
  const matter = loadMatterChecked(db, query.matter_id, query.tenant_id);
  if (matter === null) return null;

  const M = query.matter_id;
  const T = query.tenant_id;

  // documents
  const docCount = (db
    .prepare("SELECT COUNT(*) AS c FROM case_box_documents WHERE matter_id = ? AND tenant_id = ?")
    .get(M, T) as { c: number }).c;

  // facts_by_status
  const facts_by_status = { candidate: 0, reviewed: 0, accepted: 0, rejected: 0 };
  for (const row of db
    .prepare("SELECT status, COUNT(*) AS c FROM case_box_facts WHERE matter_id = ? AND tenant_id = ? GROUP BY status")
    .all(M, T) as { status: string; c: number }[]) {
    if (row.status in facts_by_status) {
      (facts_by_status as Record<string, number>)[row.status] = row.c;
    }
  }

  // deadlines_by_status
  const deadlines_by_status = { pending: 0, met: 0, missed: 0, withdrawn: 0 };
  for (const row of db
    .prepare("SELECT status, COUNT(*) AS c FROM case_box_deadlines WHERE matter_id = ? AND tenant_id = ? GROUP BY status")
    .all(M, T) as { status: string; c: number }[]) {
    if (row.status in deadlines_by_status) {
      (deadlines_by_status as Record<string, number>)[row.status] = row.c;
    }
  }

  // privilege_markers
  const privilege_markers = (db
    .prepare("SELECT COUNT(*) AS c FROM case_box_privilege_markers WHERE matter_id = ? AND tenant_id = ?")
    .get(M, T) as { c: number }).c;

  // docket_entries_by_state
  const docket_entries_by_state = { proposed: 0, confirmed: 0, dismissed: 0 };
  for (const row of db
    .prepare("SELECT confirmation_state, COUNT(*) AS c FROM case_box_docket_entries WHERE matter_id = ? AND tenant_id = ? GROUP BY confirmation_state")
    .all(M, T) as { confirmation_state: string; c: number }[]) {
    if (row.confirmation_state in docket_entries_by_state) {
      (docket_entries_by_state as Record<string, number>)[row.confirmation_state] = row.c;
    }
  }

  // confidentiality_classifications
  const confidentiality_classifications = (db
    .prepare("SELECT COUNT(*) AS c FROM case_box_confidentiality_classifications WHERE matter_id = ? AND tenant_id = ?")
    .get(M, T) as { c: number }).c;

  // evidence_items_by_status
  const evidence_items_by_status = { proposed: 0, accepted: 0, rejected: 0, superseded: 0 };
  for (const row of db
    .prepare("SELECT status, COUNT(*) AS c FROM case_box_evidence_items WHERE matter_id = ? AND tenant_id = ? GROUP BY status")
    .all(M, T) as { status: string; c: number }[]) {
    if (row.status in evidence_items_by_status) {
      (evidence_items_by_status as Record<string, number>)[row.status] = row.c;
    }
  }

  // ocr_links
  const ocr_links = (db
    .prepare("SELECT COUNT(*) AS c FROM case_box_ocr_links WHERE matter_id = ? AND tenant_id = ?")
    .get(M, T) as { c: number }).c;

  return {
    matter,
    counts: {
      documents: docCount,
      facts_by_status,
      deadlines_by_status,
      privilege_markers,
      docket_entries_by_state,
      confidentiality_classifications,
      evidence_items_by_status,
      ocr_links,
    },
  };
}

// ---------------------------------------------------------------------------
// getDocumentDetailSqlite — document + 4 derived fields.
//
// Per B10 plan §1.2 rev-1 reviewer M D5#2: DELEGATE to existing
// helpers (getOcrLinkSqlite / getEffectiveClassificationSqlite /
// getPrivilegeStatusSqlite). NO ad-hoc lookups.
//
// Scoped document lookup (WHERE id = ? AND matter_id = ?) per
// rev-2 reviewer L D2#1: cross-matter returns null.
// ---------------------------------------------------------------------------

export function getDocumentDetailSqlite(
  db: Database,
  query: GetDocumentDetailQuery,
): DocumentDetail | null {
  const matter = loadMatterChecked(db, query.matter_id, query.tenant_id);
  if (matter === null) return null;

  const docRow = db
    .prepare("SELECT payload_json FROM case_box_documents WHERE id = ? AND matter_id = ?")
    .get(query.document_id, query.matter_id) as { payload_json: string } | undefined;
  if (docRow === undefined) return null;
  const document = JSON.parse(docRow.payload_json) as CaseBoxDocument;
  if (document.tenant_id !== query.tenant_id) return null;

  const effective_classification = getEffectiveClassificationSqlite(db, {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    target_type: "document",
    target_id: query.document_id,
  });

  const privilege_status = getPrivilegeStatusSqlite(db, {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    target_type: "document",
    target_id: query.document_id,
  });

  const ocr_link = getOcrLinkSqlite(db, {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    document_id: query.document_id,
  });

  // fact_candidates: matter-scoped + source_document_id match + candidate
  // status. Tenant defense added in WHERE (mirrors in-memory line ~248).
  // Sort: created_at ASC, id ASC. Cap at FACT_CANDIDATE_PREVIEW_CAP.
  const factRows = db
    .prepare(
      `SELECT payload_json FROM case_box_facts
       WHERE matter_id = ? AND tenant_id = ? AND source_document_id = ?
         AND status = 'candidate'
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
    .all(query.matter_id, query.tenant_id, query.document_id, FACT_CANDIDATE_PREVIEW_CAP) as
    { payload_json: string }[];
  const fact_candidates: CaseBoxFact[] = factRows.map((r) => JSON.parse(r.payload_json) as CaseBoxFact);

  return {
    document,
    ocr_link,
    effective_classification,
    privilege_status,
    fact_candidates,
  };
}

// ---------------------------------------------------------------------------
// getDeadlineCalendarSqlite — date-range filter.
//
// Per getDeadlineCalendarHelper:
//   - Unknown matter → THROW unknown_matter.
//   - Cross-tenant matter → THROW tenant_mismatch.
//   - Returns CaseBoxDeadline[] sorted ASC by due_at, id.
// ---------------------------------------------------------------------------

export function getDeadlineCalendarSqlite(
  db: Database,
  query: DeadlineCalendarQuery,
): ReadonlyArray<CaseBoxDeadline> {
  // getDeadlineCalendarHelper throws unknown_matter (not null) — match.
  const matter = loadMatterChecked(db, query.matter_id, query.tenant_id);
  if (matter === null) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${query.matter_id}`);
  }

  const params: unknown[] = [query.matter_id, query.tenant_id];
  const whereParts: string[] = ["matter_id = ?", "tenant_id = ?"];
  if (query.from !== undefined) {
    whereParts.push("due_at >= ?");
    params.push(query.from);
  }
  if (query.to !== undefined) {
    whereParts.push("due_at <= ?");
    params.push(query.to);
  }
  const sql =
    `SELECT payload_json FROM case_box_deadlines
     WHERE ${whereParts.join(" AND ")}
     ORDER BY due_at ASC, id ASC`;
  const rows = db.prepare(sql).all(...params) as { payload_json: string }[];
  return rows.map((r) => JSON.parse(r.payload_json) as CaseBoxDeadline);
}

// ---------------------------------------------------------------------------
// getFactSupersessionChainSqlite — matter-scoped walk via supersedes_fact_id.
//
// Per getFactSupersessionChainHelper:
//   - Unknown matter → return [] (NOT throw).
//   - Cross-tenant matter → THROW tenant_mismatch.
//   - Unknown fact OR fact in different matter OR fact with different
//     tenant → return [].
//   - Walk bounded by total fact count + 1 (cycle defense).
// Returns chain in walk order (start fact first).
// ---------------------------------------------------------------------------

export function getFactSupersessionChainSqlite(
  db: Database,
  query: GetFactSupersessionChainQuery,
): ReadonlyArray<CaseBoxFact> {
  const matter = loadMatterChecked(db, query.matter_id, query.tenant_id);
  if (matter === null) return [];

  // Load all facts in the matter — matter-scoped SELECT (NOT global;
  // matches B6 transition shadow-state pattern).
  const rows = db
    .prepare("SELECT payload_json FROM case_box_facts WHERE matter_id = ?")
    .all(query.matter_id) as { payload_json: string }[];
  const factsById = new Map<string, CaseBoxFact>();
  for (const r of rows) {
    const f = JSON.parse(r.payload_json) as CaseBoxFact;
    factsById.set(f.id, f);
  }

  const start = factsById.get(query.fact_id);
  if (start === undefined) return [];
  if (start.matter_id !== query.matter_id) return [];
  if (start.tenant_id !== query.tenant_id) return [];

  const chain: CaseBoxFact[] = [start];
  let cursor: string | null = (start as { supersedes_fact_id?: string | null }).supersedes_fact_id ?? null;
  const visited = new Set<string>([start.id]);
  const maxSteps = factsById.size + 1;
  let steps = 0;
  while (cursor !== null && steps < maxSteps) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const next = factsById.get(cursor);
    if (next === undefined) break;
    if (next.matter_id !== query.matter_id) break;
    if (next.tenant_id !== query.tenant_id) break;
    chain.push(next);
    cursor = (next as { supersedes_fact_id?: string | null }).supersedes_fact_id ?? null;
    steps++;
  }
  return chain;
}
