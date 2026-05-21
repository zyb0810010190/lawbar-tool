// Read-side aggregations for Phase A8.
//
// Pure read-only over the repo's state. No mutations, no audit events.
// Every method is tenant/matter scoped per the A4 F5.1 lesson.

import type {
  CaseBoxDeadline,
  CaseBoxDocument,
  CaseBoxFact,
  CaseBoxMatter,
  CaseBoxOcrLink,
  PrivilegeResolution,
} from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "./cursor.js";
import type { ClassificationState } from "./inMemoryClassification.js";
import { getEffectiveClassificationHelper } from "./inMemoryClassification.js";
import type { PrivilegeState } from "./inMemoryPrivilege.js";
import { getPrivilegeStatusHelper } from "./inMemoryPrivilege.js";
import type { FactState } from "./inMemoryFact.js";
import type { DocketState } from "./inMemoryDocket.js";
import type { DeadlineState } from "./inMemoryDeadline.js";
import type { EvidenceState } from "./inMemoryEvidence.js";
import type { OcrLinkState } from "./inMemoryOcrLink.js";
import type {
  DeadlineCalendarQuery,
  DocumentDetail,
  EffectiveClassificationResult,
  GetDeadlineQuery,
  GetDocumentDetailQuery,
  GetFactSupersessionChainQuery,
  GetMatterSummaryQuery,
  ListDeadlinesPage,
  ListDeadlinesQuery,
  ListMattersPage,
  ListMattersQuery,
  MatterSummary,
} from "./types.js";

/** Fact-candidate preview cap inside getDocumentDetail (preview only). */
export const FACT_CANDIDATE_PREVIEW_CAP = 50;

interface RepoStateView {
  matters: Map<string, CaseBoxMatter>;
  documents: Map<string, { document: CaseBoxDocument; matter_id: string }>;
  classification: ClassificationState;
  privilege: PrivilegeState;
  fact: FactState;
  docket: DocketState;
  deadline: DeadlineState;
  evidence: EvidenceState;
  ocrLink: OcrLinkState;
}

// ---------------------------------------------------------------------------
// listMatters
// ---------------------------------------------------------------------------

export function listMattersHelper(
  state: RepoStateView,
  query: ListMattersQuery,
): ListMattersPage {
  const limit = resolveLimit(query.limit);
  const filters = { tenant_id: query.tenant_id, status: query.status };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "matters_by_tenant", filters_hash })
      : null;
  let rows: CaseBoxMatter[] = [];
  for (const matter of state.matters.values()) {
    if (matter.tenant_id !== query.tenant_id) continue;
    if (query.status !== undefined && matter.status !== query.status) continue;
    rows.push(matter);
  }
  // ORDER BY created_at DESC, id ASC
  rows.sort((a, b) => {
    if (a.created_at < b.created_at) return 1;
    if (a.created_at > b.created_at) return -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  if (cursor !== null) {
    const [tCreated, tId] = cursor.last_sort_tuple as [string, string];
    rows = rows.filter((m) => {
      if (m.created_at < tCreated) return true;
      if (m.created_at === tCreated && m.id > tId) return true;
      return false;
    });
  }
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  const next_cursor =
    hasMore && last !== undefined
      ? encodeCursor({
          v: 1,
          kind: "matters_by_tenant",
          filters_hash,
          last_sort_tuple: [last.created_at, last.id],
        })
      : null;
  return {
    rows: slice.map((m) => structuredClone(m) as CaseBoxMatter),
    next_cursor,
  };
}

// ---------------------------------------------------------------------------
// getMatterSummary
// ---------------------------------------------------------------------------

export function getMatterSummaryHelper(
  state: RepoStateView,
  query: GetMatterSummaryQuery,
): MatterSummary | null {
  const matter = state.matters.get(query.matter_id);
  if (matter === undefined) return null;
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  // Count documents in matter — tenant defense per audit Dim 5 #1.
  let documents = 0;
  for (const entry of state.documents.values()) {
    if (entry.matter_id !== query.matter_id) continue;
    if (entry.document.tenant_id !== query.tenant_id) continue;
    documents++;
  }
  // Facts by status (tenant-filtered).
  const facts_by_status = { candidate: 0, reviewed: 0, accepted: 0, rejected: 0 };
  const factArr = state.fact.factsByMatter.get(query.matter_id) ?? [];
  for (const f of factArr) {
    if (f.tenant_id !== query.tenant_id) continue;
    if (f.status in facts_by_status) {
      facts_by_status[f.status as keyof typeof facts_by_status]++;
    }
  }
  // Deadlines by status (tenant-filtered).
  const deadlines_by_status = { pending: 0, met: 0, missed: 0, withdrawn: 0 };
  const dArr = state.deadline.deadlinesByMatter.get(query.matter_id) ?? [];
  for (const d of dArr) {
    if (d.tenant_id !== query.tenant_id) continue;
    if (d.status in deadlines_by_status) {
      deadlines_by_status[d.status as keyof typeof deadlines_by_status]++;
    }
  }
  // Docket entries by confirmation_state (tenant-filtered).
  const docket_entries_by_state = { proposed: 0, confirmed: 0, dismissed: 0 };
  const docArr = state.docket.entriesByMatter.get(query.matter_id) ?? [];
  for (const e of docArr) {
    if (e.tenant_id !== query.tenant_id) continue;
    if (e.confirmation_state in docket_entries_by_state) {
      docket_entries_by_state[e.confirmation_state as keyof typeof docket_entries_by_state]++;
    }
  }
  // Evidence items by status (tenant-filtered).
  const evidence_items_by_status = { proposed: 0, accepted: 0, rejected: 0, superseded: 0 };
  const evArr = state.evidence.evidenceByMatter.get(query.matter_id) ?? [];
  for (const e of evArr) {
    if (e.tenant_id !== query.tenant_id) continue;
    if (e.status in evidence_items_by_status) {
      evidence_items_by_status[e.status as keyof typeof evidence_items_by_status]++;
    }
  }
  // Privilege markers (tenant-filtered count).
  const pmArr = state.privilege.markersByMatter.get(query.matter_id) ?? [];
  const privilege_markers = pmArr.filter((m) => m.tenant_id === query.tenant_id).length;
  // Classifications (tenant-filtered count).
  const cfArr = state.classification.classificationsByMatter.get(query.matter_id) ?? [];
  const confidentiality_classifications = cfArr.filter((c) => c.tenant_id === query.tenant_id).length;
  // OCR links — tenant-filter via document lookup since the Set holds doc-ids.
  const ocrSet = state.ocrLink.linksByMatter.get(query.matter_id) ?? new Set<string>();
  let ocr_links = 0;
  for (const docId of ocrSet) {
    const link = state.ocrLink.linksByDocumentId.get(docId);
    if (link !== undefined && link.tenant_id === query.tenant_id) ocr_links++;
  }

  return {
    matter: structuredClone(matter) as CaseBoxMatter,
    counts: {
      documents,
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
// getDocumentDetail
// ---------------------------------------------------------------------------

export function getDocumentDetailHelper(
  state: RepoStateView,
  query: GetDocumentDetailQuery,
): DocumentDetail | null {
  const matter = state.matters.get(query.matter_id);
  if (matter === undefined) return null;
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const docEntry = state.documents.get(query.document_id);
  if (docEntry === undefined) return null;
  if (docEntry.matter_id !== query.matter_id) return null;
  if (docEntry.document.tenant_id !== query.tenant_id) return null;

  // Helpers (scope already proven; cannot throw scope errors).
  const effective_classification = getEffectiveClassificationHelper(
    state.classification,
    state.matters,
    state.documents,
    {
      tenant_id: query.tenant_id,
      matter_id: query.matter_id,
      target_type: "document",
      target_id: query.document_id,
    },
  );
  const privilege_status = getPrivilegeStatusHelper(
    state.privilege,
    state.matters,
    state.documents,
    {
      tenant_id: query.tenant_id,
      matter_id: query.matter_id,
      target_type: "document",
      target_id: query.document_id,
    },
  );
  const ocr_link = state.ocrLink.linksByDocumentId.get(query.document_id) ?? null;
  // fact_candidates: filter, sort by created_at ASC, id ASC; cap at preview.
  // Tenant defense per audit Dim 5 #1.
  const factArr = state.fact.factsByMatter.get(query.matter_id) ?? [];
  const candidates: CaseBoxFact[] = [];
  for (const f of factArr) {
    if (f.tenant_id !== query.tenant_id) continue;
    if (f.source_document_id === query.document_id && f.status === "candidate") {
      candidates.push(f);
    }
  }
  candidates.sort((a, b) => {
    const ac = a.created_at ?? "";
    const bc = b.created_at ?? "";
    if (ac < bc) return -1;
    if (ac > bc) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const fact_candidates = candidates.slice(0, FACT_CANDIDATE_PREVIEW_CAP).map(
    (f) => structuredClone(f) as CaseBoxFact,
  );

  return {
    document: structuredClone(docEntry.document) as CaseBoxDocument,
    ocr_link: ocr_link === null ? null : (structuredClone(ocr_link) as CaseBoxOcrLink),
    effective_classification: effective_classification as EffectiveClassificationResult,
    privilege_status: privilege_status as PrivilegeResolution,
    fact_candidates,
  };
}

// ---------------------------------------------------------------------------
// getDeadline + listDeadlines + getDeadlineCalendar
// ---------------------------------------------------------------------------

export function getDeadlineHelper(
  state: RepoStateView,
  query: GetDeadlineQuery,
): CaseBoxDeadline | null {
  const matter = state.matters.get(query.matter_id);
  if (matter === undefined) return null;
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const deadline = state.deadline.deadlineById.get(query.deadline_id);
  if (deadline === undefined) return null;
  if (deadline.matter_id !== query.matter_id) return null;
  if (deadline.tenant_id !== query.tenant_id) return null;
  return structuredClone(deadline) as CaseBoxDeadline;
}

function compareDeadlinesChronological(a: CaseBoxDeadline, b: CaseBoxDeadline): number {
  if (a.due_at < b.due_at) return -1;
  if (a.due_at > b.due_at) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function listDeadlinesHelper(
  state: RepoStateView,
  query: ListDeadlinesQuery,
): ListDeadlinesPage {
  const matter = state.matters.get(query.matter_id);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${query.matter_id}`);
  }
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const limit = resolveLimit(query.limit);
  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    status: query.status,
    kind: query.kind,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "deadlines_by_matter", filters_hash })
      : null;
  const raw = state.deadline.deadlinesByMatter.get(query.matter_id) ?? [];
  let rows = raw.filter((d) => {
    if (d.tenant_id !== query.tenant_id) return false;
    if (query.status !== undefined && d.status !== query.status) return false;
    if (query.kind !== undefined && d.kind !== query.kind) return false;
    return true;
  });
  rows.sort(compareDeadlinesChronological);
  if (cursor !== null) {
    const [tDue, tId] = cursor.last_sort_tuple as [string, string];
    rows = rows.filter((d) => {
      if (d.due_at > tDue) return true;
      if (d.due_at === tDue && d.id > tId) return true;
      return false;
    });
  }
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  const next_cursor =
    hasMore && last !== undefined
      ? encodeCursor({
          v: 1,
          kind: "deadlines_by_matter",
          filters_hash,
          last_sort_tuple: [last.due_at, last.id],
        })
      : null;
  return {
    rows: slice.map((d) => structuredClone(d) as CaseBoxDeadline),
    next_cursor,
  };
}

export function getDeadlineCalendarHelper(
  state: RepoStateView,
  query: DeadlineCalendarQuery,
): CaseBoxDeadline[] {
  const matter = state.matters.get(query.matter_id);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${query.matter_id}`);
  }
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const raw = state.deadline.deadlinesByMatter.get(query.matter_id) ?? [];
  const rows: CaseBoxDeadline[] = [];
  for (const d of raw) {
    // Tenant defense per audit Dim 5 #1.
    if (d.tenant_id !== query.tenant_id) continue;
    if (query.from !== undefined && d.due_at < query.from) continue;
    if (query.to !== undefined && d.due_at > query.to) continue;
    rows.push(d);
  }
  rows.sort(compareDeadlinesChronological);
  return rows.map((d) => structuredClone(d) as CaseBoxDeadline);
}

// ---------------------------------------------------------------------------
// getFactSupersessionChain
// ---------------------------------------------------------------------------

export function getFactSupersessionChainHelper(
  state: RepoStateView,
  query: GetFactSupersessionChainQuery,
): CaseBoxFact[] {
  const matter = state.matters.get(query.matter_id);
  if (matter === undefined) return [];
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const start = state.fact.factById.get(query.fact_id);
  if (start === undefined) return [];
  if (start.matter_id !== query.matter_id) return [];
  if (start.tenant_id !== query.tenant_id) return [];

  const chain: CaseBoxFact[] = [structuredClone(start) as CaseBoxFact];
  let cursor: string | null = start.supersedes_fact_id ?? null;
  const visited = new Set<string>([start.id]);
  const maxSteps = state.fact.factIds.size + 1;
  let steps = 0;
  while (cursor !== null && steps < maxSteps) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const next: CaseBoxFact | undefined = state.fact.factById.get(cursor);
    if (next === undefined) break;
    if (next.matter_id !== query.matter_id) break;
    // Tenant defense per audit Dim 1 #1 — defend at each hop.
    if (next.tenant_id !== query.tenant_id) break;
    chain.push(structuredClone(next) as CaseBoxFact);
    cursor = next.supersedes_fact_id ?? null;
    steps++;
  }
  return chain;
}
