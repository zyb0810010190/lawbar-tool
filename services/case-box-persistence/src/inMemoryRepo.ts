// In-memory implementation of `CaseBoxPersistence` for Phase A1.
//
// State lives in module-local WeakMaps keyed by instance, so the class
// surface stays at exactly the 10 documented public methods. The
// `Object.getOwnPropertyNames(prototype)` allowlist check in conformance
// §6.2.7 is the load-bearing static assertion that nothing leaks.
//
// Atomic write discipline: every write builds the next-state shape in
// local variables, validates everything, builds the audit event + hash,
// THEN mutates the WeakMap-backed state in one synchronous step. Any
// throw before the mutation step leaves all state untouched.
//
// Test seam: `_tamperStoredEventForTest` is a module-local exported
// FUNCTION (NOT a class method) that the test-only `tests/internals.mjs`
// imports from `dist/inMemoryRepo.js`. It is NOT re-exported from
// `src/index.ts`, so external consumers using `case-box-persistence`
// cannot reach it.

import {
  assertValidMatterTransition,
  buildCaseBoxAuditEvent,
  IllegalTransitionError,
  validateDocument,
  validateMatter,
  verifyAuditChain,
  type CaseBoxAuditEvent,
  type CaseBoxAuditEventKind,
  type CaseBoxDocument,
  type CaseBoxMatter,
} from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";
import { generateUlid } from "./ulid.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "./cursor.js";
import {
  entityStateHash,
  eventHashFn,
  priorHeadOf,
  type StoredAuditEvent,
} from "./auditChain.js";
import type {
  ArchiveMatterOpts,
  AuditChainHead,
  CaseBoxPersistence,
  EffectiveClassificationResult,
  GetEffectiveClassificationQuery,
  GetPrivilegeStatusQuery,
  ListAuditEventsPage,
  ListAuditEventsQuery,
  ListConfidentialityClassificationsPage,
  ListConfidentialityClassificationsQuery,
  ListDocumentsPage,
  ListDocumentsQuery,
  ListPrivilegeMarkersPage,
  ListPrivilegeMarkersQuery,
  PrivilegeTransitionOpts,
  VerifyAuditChainResult,
} from "./types.js";

import type {
  CaseBoxConfidentialityClassification,
  CaseBoxPrivilegeMarker,
  PrivilegeResolution,
} from "case-box-contract";
import {
  computeEffectiveLevel,
  createClassificationState,
  listClassifications,
  prepareAppendClassification,
  type ClassificationState,
} from "./inMemoryClassification.js";
import {
  createPrivilegeState,
  getEffectivePrivilege,
  listPrivilegeMarkers as listPrivilegeMarkersImpl,
  prepareAppendPrivilegeMarker,
  prepareTransitionPrivilegeMarker,
  type PrivilegeState,
} from "./inMemoryPrivilege.js";

interface InternalState {
  readonly matters: Map<string, CaseBoxMatter>;
  /** documentId → { record, matter_id } */
  readonly documents: Map<string, { document: CaseBoxDocument; matter_id: string }>;
  /** matter_id → append-only sequence of stored events */
  readonly auditByMatter: Map<string, StoredAuditEvent[]>;
  /** Phase A2 — confidentiality classification storage + duplicate-id index. */
  readonly classification: ClassificationState;
  /** Phase A3 — privilege-marker storage + duplicate-id index + marker→matter index. */
  readonly privilege: PrivilegeState;
}

const _state = new WeakMap<InMemoryCaseBoxPersistence, InternalState>();

export interface InMemoryCaseBoxPersistenceOptions {
  /** Injected clock. Default: () => new Date(). */
  now?: () => Date;
  /** Injected ID generator. Default: generateUlid() — 26-char [0-9a-z]. */
  generateId?: () => string;
}

export class InMemoryCaseBoxPersistence implements CaseBoxPersistence {
  readonly #now: () => Date;
  readonly #generateId: () => string;

  constructor(options: InMemoryCaseBoxPersistenceOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#generateId = options.generateId ?? generateUlid;
    _state.set(this, {
      matters: new Map(),
      documents: new Map(),
      auditByMatter: new Map(),
      classification: createClassificationState(),
      privilege: createPrivilegeState(),
    });
  }

  // -------------------------------------------------------------------------
  // Matter — write paths
  // -------------------------------------------------------------------------

  async createMatter(input: unknown): Promise<CaseBoxMatter> {
    const state = stateOf(this);
    const v = validateMatter(input);
    if (!v.ok) {
      throw new CaseBoxPersistenceError("invalid_payload", `invalid matter submission: ${v.summary}`);
    }
    const matter = structuredClone(v.value) as CaseBoxMatter;

    if (matter.status !== "active") {
      throw new CaseBoxPersistenceError("invalid_initial_state", `matter must be created with status="active" (got ${JSON.stringify(matter.status)})`);
    }
    if (matter.archived_at !== undefined) {
      throw new CaseBoxPersistenceError("invalid_initial_state", `matter must be created with archived_at unset`);
    }
    if (
      matter.external_ocr_authorized === true ||
      matter.sync_grant_present === true ||
      matter.llm_extraction_opt_in === true
    ) {
      throw new CaseBoxPersistenceError(
        "local_only_external_flag_rejected",
        `matter cannot be created with any of external_ocr_authorized, sync_grant_present, llm_extraction_opt_in set true; opt-in must happen via a future audited write API`,
      );
    }

    if (state.matters.has(matter.id)) {
      throw new CaseBoxPersistenceError("duplicate_id", `matter already exists: ${matter.id}`);
    }

    const afterHash = entityStateHash(matter);
    const stamp = this.#nowIso();
    const eventInput = {
      kind: "MATTER_REGISTERED" as CaseBoxAuditEventKind,
      id: this.#generateId(),
      tenant_id: matter.tenant_id,
      actor_user_id: matter.actor_user_id,
      matter_id: matter.id,
      entity_id: matter.id,
      before_state_hash: null,
      after_state_hash: afterHash,
      prev_event_hash: null,
      timestamp: stamp,
    };
    const built = buildCaseBoxAuditEvent(eventInput);
    if (!built.ok) {
      throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
    }

    // Commit (mutation step) — no validators or builders fire after this.
    state.matters.set(matter.id, matter);
    state.auditByMatter.set(matter.id, [{ sequence: 1, event: built.value }]);
    return structuredClone(matter) as CaseBoxMatter;
  }

  async archiveMatter(matterId: string, opts: ArchiveMatterOpts): Promise<CaseBoxMatter> {
    return this.#transitionMatter(matterId, opts, "archived", "MATTER_ARCHIVED");
  }

  async unarchiveMatter(matterId: string, opts: ArchiveMatterOpts): Promise<CaseBoxMatter> {
    return this.#transitionMatter(matterId, opts, "active", "MATTER_UNARCHIVED");
  }

  // -------------------------------------------------------------------------
  // Matter — read paths
  // -------------------------------------------------------------------------

  async getMatter(matterId: string): Promise<CaseBoxMatter | null> {
    const state = stateOf(this);
    const m = state.matters.get(matterId);
    return m === undefined ? null : (structuredClone(m) as CaseBoxMatter);
  }

  // -------------------------------------------------------------------------
  // Document — write paths
  // -------------------------------------------------------------------------

  async registerDocument(matterId: string, input: unknown): Promise<CaseBoxDocument> {
    const state = stateOf(this);
    const matter = state.matters.get(matterId);
    if (matter === undefined) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
    }
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
    if (state.documents.has(document.id)) {
      throw new CaseBoxPersistenceError("duplicate_id", `document already exists: ${document.id}`);
    }

    const afterHash = entityStateHash(document);
    const stored = state.auditByMatter.get(matterId) ?? [];
    const prevHash = priorHeadOf(stored);
    const stamp = this.#nowIso();
    const built = buildCaseBoxAuditEvent({
      kind: "DOCUMENT_REGISTERED",
      id: this.#generateId(),
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

    // Commit
    state.documents.set(document.id, { document, matter_id: matterId });
    stored.push({ sequence: stored.length + 1, event: built.value });
    state.auditByMatter.set(matterId, stored);
    return structuredClone(document) as CaseBoxDocument;
  }

  // -------------------------------------------------------------------------
  // Document — read paths
  // -------------------------------------------------------------------------

  async getDocument(documentId: string): Promise<CaseBoxDocument | null> {
    const state = stateOf(this);
    const entry = state.documents.get(documentId);
    return entry === undefined ? null : (structuredClone(entry.document) as CaseBoxDocument);
  }

  async listDocuments(query: ListDocumentsQuery): Promise<ListDocumentsPage> {
    const state = stateOf(this);
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
    const filters = { tenant_id: query.tenant_id, matter_id: query.matter_id };
    const filters_hash = computeFiltersHash(filters);
    const cursor =
      query.cursor !== undefined
        ? decodeCursor(query.cursor, { kind: "documents_by_matter", filters_hash })
        : null;

    let rows: CaseBoxDocument[] = [];
    for (const entry of state.documents.values()) {
      if (entry.matter_id !== query.matter_id) continue;
      if (entry.document.tenant_id !== query.tenant_id) continue;
      rows.push(entry.document);
    }
    // ORDER BY received_at DESC, id ASC
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

  // -------------------------------------------------------------------------
  // Audit observability
  // -------------------------------------------------------------------------

  async listAuditEvents(query: ListAuditEventsQuery): Promise<ListAuditEventsPage> {
    const state = stateOf(this);
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
    const filters = { tenant_id: query.tenant_id, matter_id: query.matter_id };
    const filters_hash = computeFiltersHash(filters);
    const cursor =
      query.cursor !== undefined
        ? decodeCursor(query.cursor, { kind: "audit_events_by_matter", filters_hash })
        : null;

    const stored = state.auditByMatter.get(query.matter_id) ?? [];
    // Stored is already in sequence-ASC order (append-only push).
    let filtered = stored;
    if (cursor !== null) {
      const [tSeq] = cursor.last_sort_tuple as [number];
      filtered = stored.filter((s) => s.sequence > tSeq);
    }
    const hasMore = filtered.length > limit;
    const slice = hasMore ? filtered.slice(0, limit) : filtered;
    const last = slice[slice.length - 1];
    const next_cursor =
      hasMore && last !== undefined
        ? encodeCursor({
            v: 1,
            kind: "audit_events_by_matter",
            filters_hash,
            last_sort_tuple: [last.sequence],
          })
        : null;
    return {
      rows: slice.map((s) => structuredClone(s.event) as CaseBoxAuditEvent),
      next_cursor,
    };
  }

  async getAuditChainHead(matterId: string): Promise<AuditChainHead> {
    const state = stateOf(this);
    const matter = state.matters.get(matterId);
    if (matter === undefined) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
    }
    const stored = state.auditByMatter.get(matterId) ?? [];
    if (stored.length === 0) {
      return { headHash: null, lastEventId: null, count: 0 };
    }
    const last = stored[stored.length - 1]!;
    return {
      headHash: eventHashFn(last.event),
      lastEventId: last.event.id,
      count: stored.length,
    };
  }

  async verifyAuditChainForMatter(matterId: string): Promise<VerifyAuditChainResult> {
    const state = stateOf(this);
    const matter = state.matters.get(matterId);
    if (matter === undefined) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
    }
    const stored = state.auditByMatter.get(matterId) ?? [];
    const events = stored.map((s) => s.event);
    return verifyAuditChain(events, { eventHashFn });
  }

  // -------------------------------------------------------------------------
  // Phase A2 — confidentiality classification delegates
  // -------------------------------------------------------------------------

  async appendConfidentialityClassification(input: unknown): Promise<CaseBoxConfidentialityClassification> {
    const state = stateOf(this);
    const matterIdFromInput = input !== null && typeof input === "object"
      ? (input as { matter_id?: unknown }).matter_id
      : undefined;
    // Pre-validate matter existence BEFORE prepareAppendClassification runs
    // generators (audit Dim 1 #2). The matter check is cheap and belongs in
    // the validate-everything-first phase.
    if (typeof matterIdFromInput === "string" && !state.matters.has(matterIdFromInput)) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
    }
    const prepared = prepareAppendClassification(state.classification, input, {
      generateId: () => this.#generateId(),
      nowIso: () => this.#nowIso(),
      storedAuditEventsForMatter: () => {
        if (typeof matterIdFromInput !== "string") return [];
        return state.auditByMatter.get(matterIdFromInput) ?? [];
      },
      getDocument: (documentId) => {
        const entry = state.documents.get(documentId);
        return entry === undefined ? null : { document: entry.document };
      },
    });
    // Defense-in-depth: re-check matter existence after prepare (the
    // document target's matter_id should match prepared.matterId, but
    // explicit guard surfaces typos faster).
    if (!state.matters.has(prepared.matterId)) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${prepared.matterId}`);
    }

    // Commit
    const arr = state.classification.classificationsByMatter.get(prepared.matterId) ?? [];
    arr.push(prepared.row);
    state.classification.classificationsByMatter.set(prepared.matterId, arr);
    state.classification.classificationIds.add(prepared.row.id);
    const stored = state.auditByMatter.get(prepared.matterId) ?? [];
    stored.push(prepared.audit);
    state.auditByMatter.set(prepared.matterId, stored);
    return structuredClone(prepared.row) as CaseBoxConfidentialityClassification;
  }

  async getEffectiveClassification(query: GetEffectiveClassificationQuery): Promise<EffectiveClassificationResult> {
    const state = stateOf(this);
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
    if (query.target_type !== "document") {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `getEffectiveClassification accepts target_type "document" only in A2 (got ${JSON.stringify(query.target_type)})`,
      );
    }
    const docEntry = state.documents.get(query.target_id);
    if (docEntry === undefined) {
      throw new CaseBoxPersistenceError("unknown_document", `unknown document target: ${query.target_id}`);
    }
    if (docEntry.document.tenant_id !== query.tenant_id) {
      throw new CaseBoxPersistenceError(
        "tenant_mismatch",
        `document.tenant_id (${docEntry.document.tenant_id}) does not match query.tenant_id (${query.tenant_id})`,
      );
    }
    if (docEntry.document.matter_id !== query.matter_id) {
      throw new CaseBoxPersistenceError(
        "matter_id_mismatch",
        `document.matter_id (${docEntry.document.matter_id}) does not match query.matter_id (${query.matter_id})`,
      );
    }
    return computeEffectiveLevel(
      state.classification,
      query.matter_id,
      query.target_type,
      query.target_id,
    );
  }

  async listConfidentialityClassifications(query: ListConfidentialityClassificationsQuery): Promise<ListConfidentialityClassificationsPage> {
    const state = stateOf(this);
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
    return listClassifications(state.classification, query);
  }

  // -------------------------------------------------------------------------
  // Phase A3 — privilege marker delegates
  // -------------------------------------------------------------------------

  async appendPrivilegeMarker(input: unknown): Promise<CaseBoxPrivilegeMarker> {
    const state = stateOf(this);
    const matterIdFromInput = input !== null && typeof input === "object"
      ? (input as { matter_id?: unknown }).matter_id
      : undefined;
    if (typeof matterIdFromInput === "string" && !state.matters.has(matterIdFromInput)) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
    }
    const prepared = prepareAppendPrivilegeMarker(state.privilege, input, {
      generateId: () => this.#generateId(),
      nowIso: () => this.#nowIso(),
      storedAuditEventsForMatter: () => {
        if (typeof matterIdFromInput !== "string") return [];
        return state.auditByMatter.get(matterIdFromInput) ?? [];
      },
      getDocument: (documentId) => {
        const entry = state.documents.get(documentId);
        return entry === undefined ? null : { document: entry.document };
      },
    });
    if (!state.matters.has(prepared.matterId)) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${prepared.matterId}`);
    }

    // Commit
    const arr = state.privilege.markersByMatter.get(prepared.matterId) ?? [];
    arr.push(prepared.row);
    state.privilege.markersByMatter.set(prepared.matterId, arr);
    state.privilege.privilegeIds.add(prepared.row.id);
    state.privilege.markerIndex.set(prepared.row.id, prepared.matterId);
    const stored = state.auditByMatter.get(prepared.matterId) ?? [];
    stored.push(prepared.audit);
    state.auditByMatter.set(prepared.matterId, stored);
    return structuredClone(prepared.row) as CaseBoxPrivilegeMarker;
  }

  async transitionPrivilegeMarker(markerId: string, opts: PrivilegeTransitionOpts): Promise<CaseBoxPrivilegeMarker> {
    const state = stateOf(this);
    const prepared = prepareTransitionPrivilegeMarker(state.privilege, markerId, opts, {
      generateId: () => this.#generateId(),
      nowIso: () => this.#nowIso(),
      storedAuditEventsForMatter: (matterId) => state.auditByMatter.get(matterId) ?? [],
    });

    // Commit: replace marker row in-place; append audit event.
    const arr = state.privilege.markersByMatter.get(prepared.matterId)!;
    const idx = arr.findIndex((m) => m.id === markerId);
    arr[idx] = prepared.next;
    const stored = state.auditByMatter.get(prepared.matterId) ?? [];
    stored.push(prepared.audit);
    state.auditByMatter.set(prepared.matterId, stored);
    return structuredClone(prepared.next) as CaseBoxPrivilegeMarker;
  }

  async getPrivilegeStatus(query: GetPrivilegeStatusQuery): Promise<PrivilegeResolution> {
    const state = stateOf(this);
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
    if (query.target_type !== "document") {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `getPrivilegeStatus accepts target_type "document" only in A3 (got ${JSON.stringify(query.target_type)})`,
      );
    }
    const docEntry = state.documents.get(query.target_id);
    if (docEntry === undefined) {
      throw new CaseBoxPersistenceError("unknown_document", `unknown document target: ${query.target_id}`);
    }
    if (docEntry.document.tenant_id !== query.tenant_id) {
      throw new CaseBoxPersistenceError(
        "tenant_mismatch",
        `document.tenant_id (${docEntry.document.tenant_id}) does not match query.tenant_id (${query.tenant_id})`,
      );
    }
    if (docEntry.document.matter_id !== query.matter_id) {
      throw new CaseBoxPersistenceError(
        "matter_id_mismatch",
        `document.matter_id (${docEntry.document.matter_id}) does not match query.matter_id (${query.matter_id})`,
      );
    }
    return getEffectivePrivilege(state.privilege, query.matter_id, query.target_type, query.target_id);
  }

  async listPrivilegeMarkers(query: ListPrivilegeMarkersQuery): Promise<ListPrivilegeMarkersPage> {
    const state = stateOf(this);
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
    return listPrivilegeMarkersImpl(state.privilege, query);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  #nowIso(): string {
    const d = this.#now();
    if (!(d instanceof Date)) {
      throw new CaseBoxPersistenceError("invalid_argument", `injected now() must return a Date (got ${typeof d})`);
    }
    let iso: string;
    try {
      iso = d.toISOString();
    } catch {
      throw new CaseBoxPersistenceError("invalid_argument", `injected now() returned an invalid Date`);
    }
    return iso;
  }

  async #transitionMatter(
    matterId: string,
    opts: ArchiveMatterOpts,
    to: CaseBoxMatter["status"],
    kind: CaseBoxAuditEventKind,
  ): Promise<CaseBoxMatter> {
    const state = stateOf(this);
    const matter = state.matters.get(matterId);
    if (matter === undefined) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
    }
    if (typeof opts.reason !== "string" || opts.reason.length === 0) {
      throw new CaseBoxPersistenceError("invalid_argument", `reason must be a non-empty string`);
    }
    if (typeof opts.actor_user_id !== "string" || opts.actor_user_id.length === 0) {
      throw new CaseBoxPersistenceError("invalid_argument", `actor_user_id must be a non-empty string`);
    }
    // Use the contract state-machine guard as the single source of truth
    // (per audit Dim 1 #1). Drift between the contract's allowed-edges
    // table and any manual check here is now impossible.
    try {
      assertValidMatterTransition(matter.status, to, "lawyer");
    } catch (e) {
      if (e instanceof IllegalTransitionError) {
        throw new CaseBoxPersistenceError("illegal_transition", e.message);
      }
      throw e;
    }
    // Capture one timestamp per write so archived_at and audit timestamp
    // agree (per audit Dim 1 #3).
    const stamp = this.#nowIso();
    const beforeHash = entityStateHash(matter);
    const next: CaseBoxMatter = {
      ...structuredClone(matter),
      status: to,
    };
    if (to === "archived") {
      next.archived_at = stamp;
    } else if (to === "active") {
      // Unarchive clears the archived_at field per Step-1 lifecycle.
      delete (next as { archived_at?: string }).archived_at;
    }
    // Re-validate the next matter shape against the contract before any
    // mutation (per audit Dim 1 #2). Catches drift if the lifecycle
    // field set ever changes.
    const nextValid = validateMatter(next);
    if (!nextValid.ok) {
      throw new CaseBoxPersistenceError("invalid_payload", `post-transition matter invalid: ${nextValid.summary}`);
    }
    const afterHash = entityStateHash(next);
    const stored = state.auditByMatter.get(matterId) ?? [];
    const prevHash = priorHeadOf(stored);
    const built = buildCaseBoxAuditEvent({
      kind,
      id: this.#generateId(),
      tenant_id: matter.tenant_id,
      actor_user_id: opts.actor_user_id,
      matter_id: matterId,
      entity_id: matterId,
      before_state_hash: beforeHash,
      after_state_hash: afterHash,
      prev_event_hash: prevHash,
      timestamp: stamp,
      reason: opts.reason,
    });
    if (!built.ok) {
      throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
    }

    // Commit
    state.matters.set(matterId, next);
    stored.push({ sequence: stored.length + 1, event: built.value });
    state.auditByMatter.set(matterId, stored);
    return structuredClone(next) as CaseBoxMatter;
  }
}

function stateOf(p: InMemoryCaseBoxPersistence): InternalState {
  const s = _state.get(p);
  if (s === undefined) {
    throw new Error("InMemoryCaseBoxPersistence: internal state missing (instance not constructed via class?)");
  }
  return s;
}

// ---------------------------------------------------------------------------
// Test seam — NOT exported from src/index.ts. Tests/internals.mjs imports
// it directly from dist/inMemoryRepo.js.
// ---------------------------------------------------------------------------

/**
 * Replace one stored audit event in a matter's chain with the mutator's
 * output. Used ONLY by `tests/internals.mjs` to drive the §6.3.4 tamper
 * test. NOT a method on the class — keeping it module-private ensures
 * the conformance §6.2.7 prototype allowlist stays clean.
 */
export function _tamperStoredEventForTest(
  persistence: InMemoryCaseBoxPersistence,
  matterId: string,
  sequence: number,
  mutator: (event: CaseBoxAuditEvent) => CaseBoxAuditEvent,
): void {
  const state = _state.get(persistence);
  if (state === undefined) {
    throw new Error("_tamperStoredEventForTest: persistence has no internal state");
  }
  const stored = state.auditByMatter.get(matterId);
  if (stored === undefined) {
    throw new Error(`_tamperStoredEventForTest: unknown matter ${matterId}`);
  }
  const idx = stored.findIndex((s) => s.sequence === sequence);
  if (idx < 0) {
    throw new Error(`_tamperStoredEventForTest: no event with sequence ${sequence} in matter ${matterId}`);
  }
  const tampered = mutator(structuredClone(stored[idx]!.event));
  stored[idx] = { sequence: stored[idx]!.sequence, event: tampered };
}
