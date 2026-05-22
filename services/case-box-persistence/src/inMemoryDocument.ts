// Document-registration + list extraction for Phase A5/A6 LOC discipline.
//
// Originally a mechanical move of registerDocument's body from
// inMemoryRepo to keep the repo class under the 800 pure-LOC fail
// threshold. WI-brief-matter-type-persistence (2026-05-22) wires
// `assertValidDocumentSupersession` into `prepareRegisterDocument` to
// enforce R-5(d) cross-row constraints (same-matter, same-tenant, no
// self-cycle) at the persistence boundary.

import {
  assertValidDocumentSupersession,
  buildCaseBoxAuditEvent,
  DocumentSupersessionInvariantError,
  validateDocument,
  type CaseBoxAuditEventKind,
  type CaseBoxDocument,
  type CaseBoxMatter,
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
import type {
  ListDocumentsPage,
  ListDocumentsQuery,
} from "./types.js";

interface PrepareRegisterDocumentResult {
  document: CaseBoxDocument;
  audit: StoredAuditEvent;
}

interface RegisterDocumentDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: () => StoredAuditEvent[];
  /** Resolve a document row by id for R-5(d) supersession invariant. Returns null when unknown. */
  getDocumentById?: (id: string) => { id: string; tenant_id: string; matter_id: string } | null;
}

export function prepareRegisterDocument(
  matterId: string,
  matter: CaseBoxMatter,
  input: unknown,
  hasExistingDocumentId: (id: string) => boolean,
  deps: RegisterDocumentDeps,
): PrepareRegisterDocumentResult {
  const v = validateDocument(input);
  if (!v.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `invalid document submission: ${v.summary}`);
  }
  const document = structuredClone(v.value) as CaseBoxDocument;
  if (document.matter_id !== matterId) {
    throw new CaseBoxPersistenceError(
      "matter_id_mismatch",
      `document.matter_id (${document.matter_id}) does not match matterId argument (${matterId})`,
    );
  }
  if (document.tenant_id !== matter.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `document.tenant_id (${document.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  if (document.status !== "registered") {
    throw new CaseBoxPersistenceError(
      "invalid_initial_state",
      `document must be created with status="registered" (got ${JSON.stringify(document.status)})`,
    );
  }
  if (document.supersedes_document_id !== undefined && document.supersedes_document_id !== null) {
    const prior = deps.getDocumentById ? deps.getDocumentById(document.supersedes_document_id) : null;
    try {
      assertValidDocumentSupersession({
        doc: {
          id: document.id,
          tenant_id: document.tenant_id,
          matter_id: document.matter_id,
          supersedes_document_id: document.supersedes_document_id,
        },
        prior,
      });
    } catch (e) {
      if (e instanceof DocumentSupersessionInvariantError) {
        throw new CaseBoxPersistenceError("invalid_payload", e.message);
      }
      throw e;
    }
  }
  if (hasExistingDocumentId(document.id)) {
    throw new CaseBoxPersistenceError("duplicate_id", `document already exists: ${document.id}`);
  }
  const afterHash = entityStateHash(document);
  const stored = deps.storedAuditEventsForMatter();
  const prevHash = priorHeadOf(stored);
  const stamp = deps.nowIso();
  const built = buildCaseBoxAuditEvent({
    kind: "DOCUMENT_REGISTERED" as CaseBoxAuditEventKind,
    id: deps.generateId(),
    tenant_id: document.tenant_id,
    actor_user_id: document.actor_user_id,
    matter_id: matterId,
    entity_id: document.id,
    before_state_hash: null,
    after_state_hash: afterHash,
    prev_event_hash: prevHash,
    timestamp: stamp,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }
  return {
    document,
    audit: { sequence: stored.length + 1, event: built.value },
  };
}

// ---------------------------------------------------------------------------
// listDocuments helper — extracted from inMemoryRepo for A6 LOC discipline.
// ---------------------------------------------------------------------------

export function listDocumentsHelper(
  matters: Map<string, CaseBoxMatter>,
  documents: Map<string, { document: CaseBoxDocument; matter_id: string }>,
  query: ListDocumentsQuery,
): ListDocumentsPage {
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
    status: query.status,
    doc_type: query.doc_type,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "documents_by_matter", filters_hash })
      : null;
  let rows: CaseBoxDocument[] = [];
  for (const entry of documents.values()) {
    if (entry.matter_id !== query.matter_id) continue;
    if (entry.document.tenant_id !== query.tenant_id) continue;
    // A8 added optional status + doc_type filters (parent §4.4 closure).
    if (query.status !== undefined && entry.document.status !== query.status) continue;
    if (query.doc_type !== undefined && entry.document.doc_type !== query.doc_type) continue;
    rows.push(entry.document);
  }
  rows.sort((a, b) => {
    if (a.received_at < b.received_at) return 1;
    if (a.received_at > b.received_at) return -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  if (cursor !== null) {
    const [tReceived, tId] = cursor.last_sort_tuple as [string, string];
    rows = rows.filter((d) => {
      if (d.received_at < tReceived) return true;
      if (d.received_at === tReceived && d.id > tId) return true;
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
          kind: "documents_by_matter",
          filters_hash,
          last_sort_tuple: [last.received_at, last.id],
        })
      : null;
  return { rows: slice.map((d) => structuredClone(d) as CaseBoxDocument), next_cursor };
}
