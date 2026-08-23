// OCR link storage for Phase A7.
//
// CaseBoxOcrLink is a READ-ONLY snapshot of an OCR job's state per
// document. Step 0 ADR §4 obligations:
//   - case-box never writes to ocr-persistence.
//   - ocr_job_id is opaque; no FK.
//   - direction === "read-only" — contract-enforced by schema's const + the
//     assertCaseBoxIsSubordinateToOcr helper.
//
// Upsert semantics: row key is document_id (no separate id). First call
// creates (OCR_LINK_SNAPSHOTTED). Subsequent calls with CHANGED fields
// refresh (OCR_LINK_REFRESHED). Byte-identical second calls are NO-OPs
// (no audit emitted).

import {
  assertCaseBoxIsSubordinateToOcr,
  buildCaseBoxAuditEvent,
  validateOcrLink,
  type CaseBoxAuditEventKind,
  type CaseBoxDocument,
  type CaseBoxMatter,
  type CaseBoxOcrLink,
} from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "./cursor.js";
import {
  entityStateHash,
  priorHeadOf,
  type StoredAuditEvent,
} from "./auditChain.js";
import { resolveDocumentTarget } from "./resolveTarget.js";
import { InMemoryAuditLog } from "./auditHeadAnchor.js";

export interface OcrLinkState {
  /** document_id → snapshot row (single row per document). */
  linksByDocumentId: Map<string, CaseBoxOcrLink>;
  /** matter_id → set of document_ids that have an OCR link. */
  linksByMatter: Map<string, Set<string>>;
}

export function createOcrLinkState(): OcrLinkState {
  return {
    linksByDocumentId: new Map(),
    linksByMatter: new Map(),
  };
}

interface RepoView {
  matters: Map<string, CaseBoxMatter>;
  documents: Map<string, { document: CaseBoxDocument; matter_id: string }>;
  audit: InMemoryAuditLog;
}
interface CDeps {
  generateId: () => string;
  nowIso: () => string;
}

// ---------------------------------------------------------------------------
// applyUpsertOcrLink — handles create / refresh / no-op
// ---------------------------------------------------------------------------

export interface UpsertOcrLinkResult {
  readonly link: CaseBoxOcrLink;
  readonly created: boolean;
}

/**
 * Canonical deep-equality for OCR links. Audit Dim 1 #1 + Dim 5 #1 fix:
 * the previous field-by-field comparison missed extra properties that the
 * schema (no `additionalProperties: false`) allows through validation.
 * Sorted-keys JSON guarantees that any field difference — including
 * unknown / extra properties — surfaces as inequality, so a refreshed
 * snapshot with truly changed state cannot silently be classified as
 * an idempotent no-op.
 */
function deepEqualLink(a: CaseBoxOcrLink, b: CaseBoxOcrLink): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * Pure prepare step for upsertOcrLink. Performs all validation +
 * document/matter resolution + idempotency preflight + audit-event
 * construction, but does NOT mutate `state` or `repo`. Returns the
 * built audit event (or `undefined` for idempotent replay).
 *
 * Per B9 plan §1.2 / §1.4 (Option A — single canonical refactor):
 * SQLite callers use this prepare-only function so they can short-
 * circuit on `audit === undefined` BEFORE issuing any INSERT / UPDATE
 * / audit-event write. The thin wrapper `applyUpsertOcrLink` below
 * adds the in-memory state mutations + audit push and is the only
 * caller from the in-memory `InMemoryCaseBoxPersistence`.
 */
export interface PrepareUpsertOcrLinkResult {
  readonly link: CaseBoxOcrLink;
  /** Idempotent replay (no-op): undefined. Create or refresh: defined. */
  readonly audit?: StoredAuditEvent;
  readonly created: boolean;
  readonly matterId: string;
}

export function prepareUpsertOcrLink(
  state: OcrLinkState,
  repo: RepoView,
  deps: CDeps,
  input: unknown,
): PrepareUpsertOcrLinkResult {
  const v = validateOcrLink(input);
  if (!v.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `invalid OCR link: ${v.summary}`);
  }
  const link = structuredClone(v.value) as CaseBoxOcrLink;

  try {
    assertCaseBoxIsSubordinateToOcr(link);
  } catch (e) {
    throw new CaseBoxPersistenceError("invalid_payload", (e as Error).message);
  }

  const docEntry = repo.documents.get(link.document_id);
  if (docEntry === undefined) {
    throw new CaseBoxPersistenceError("unknown_document", `unknown document: ${link.document_id}`);
  }
  if (docEntry.document.tenant_id !== link.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `link.tenant_id (${link.tenant_id}) does not match document.tenant_id (${docEntry.document.tenant_id})`,
    );
  }
  const matterId = docEntry.matter_id;
  if (!repo.matters.has(matterId)) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
  }

  const prior = state.linksByDocumentId.get(link.document_id);
  if (prior !== undefined && deepEqualLink(prior, link)) {
    return { link: structuredClone(prior) as CaseBoxOcrLink, created: false, matterId };
  }

  const isCreate = prior === undefined;
  const stamp = deps.nowIso();
  const stored = repo.audit.get(matterId);
  const prevHash = priorHeadOf(stored);
  const kind: CaseBoxAuditEventKind = isCreate ? "OCR_LINK_SNAPSHOTTED" : "OCR_LINK_REFRESHED";
  const built = buildCaseBoxAuditEvent({
    kind,
    id: deps.generateId(),
    tenant_id: link.tenant_id,
    actor_user_id: link.actor_user_id,
    matter_id: matterId,
    entity_id: link.document_id,
    before_state_hash: isCreate ? null : entityStateHash(prior!),
    after_state_hash: entityStateHash(link),
    prev_event_hash: prevHash,
    timestamp: stamp,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }

  return {
    link,
    audit: { sequence: stored.length + 1, event: built.value },
    created: isCreate,
    matterId,
  };
}

export function applyUpsertOcrLink(
  state: OcrLinkState,
  repo: RepoView,
  deps: CDeps,
  input: unknown,
): UpsertOcrLinkResult {
  const prepared = prepareUpsertOcrLink(state, repo, deps, input);
  if (prepared.audit === undefined) {
    return { link: prepared.link, created: false };
  }
  // Atomic commit: state mutations + audit push.
  state.linksByDocumentId.set(prepared.link.document_id, prepared.link);
  let matterSet = state.linksByMatter.get(prepared.matterId);
  if (matterSet === undefined) {
    matterSet = new Set<string>();
    state.linksByMatter.set(prepared.matterId, matterSet);
  }
  matterSet.add(prepared.link.document_id);
  repo.audit.append(prepared.matterId, prepared.audit);
  return { link: structuredClone(prepared.link) as CaseBoxOcrLink, created: prepared.created };
}

// ---------------------------------------------------------------------------
// getOcrLinkHelper — scoped read per A4 F5.1 lesson
// ---------------------------------------------------------------------------

export interface GetOcrLinkQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly document_id: string;
}

export function getOcrLinkHelper(
  state: OcrLinkState,
  matters: Map<string, CaseBoxMatter>,
  documents: Map<string, { document: CaseBoxDocument; matter_id: string }>,
  query: GetOcrLinkQuery,
): CaseBoxOcrLink | null {
  const matter = matters.get(query.matter_id);
  if (matter === undefined) return null;
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const docEntry = documents.get(query.document_id);
  if (docEntry === undefined) return null;
  if (docEntry.matter_id !== query.matter_id) return null;
  if (docEntry.document.tenant_id !== query.tenant_id) return null;
  const link = state.linksByDocumentId.get(query.document_id);
  if (link === undefined) return null;
  return structuredClone(link) as CaseBoxOcrLink;
}

// ---------------------------------------------------------------------------
// listOcrLinks — paginated per matter, order by last_seen_at DESC, doc_id ASC
// ---------------------------------------------------------------------------

export interface ListOcrLinksQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly status_snapshot?: CaseBoxOcrLink["status_snapshot"];
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListOcrLinksPage {
  readonly rows: ReadonlyArray<CaseBoxOcrLink>;
  readonly next_cursor: string | null;
}

export function listOcrLinks(
  state: OcrLinkState,
  matters: Map<string, CaseBoxMatter>,
  query: ListOcrLinksQuery,
): ListOcrLinksPage {
  const matter = matters.get(query.matter_id);
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
    status_snapshot: query.status_snapshot,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "ocr_links_by_matter", filters_hash })
      : null;

  // Hydrate from per-matter set (round-1 M2 #3 fix).
  const docIds = state.linksByMatter.get(query.matter_id) ?? new Set<string>();
  let rows: CaseBoxOcrLink[] = [];
  for (const docId of docIds) {
    const link = state.linksByDocumentId.get(docId);
    if (link === undefined) continue;
    if (query.status_snapshot !== undefined && link.status_snapshot !== query.status_snapshot) continue;
    rows.push(link);
  }
  // Order by last_seen_at DESC, document_id ASC.
  rows.sort((a, b) => {
    if (a.last_seen_at < b.last_seen_at) return 1;
    if (a.last_seen_at > b.last_seen_at) return -1;
    if (a.document_id < b.document_id) return -1;
    if (a.document_id > b.document_id) return 1;
    return 0;
  });
  if (cursor !== null) {
    const [tLast, tDoc] = cursor.last_sort_tuple as [string, string];
    rows = rows.filter((l) => {
      if (l.last_seen_at < tLast) return true;
      if (l.last_seen_at === tLast && l.document_id > tDoc) return true;
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
          kind: "ocr_links_by_matter",
          filters_hash,
          last_sort_tuple: [last.last_seen_at, last.document_id],
        })
      : null;
  return {
    rows: slice.map((l) => structuredClone(l) as CaseBoxOcrLink),
    next_cursor,
  };
}
