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
  eventHashFn,
  type StoredAuditEvent,
} from "./auditChain.js";
import type {
  ArchiveMatterOpts,
  AuditChainHead,
  CaseBoxPersistence,
  ConfirmDocketEntryOpts,
  ConfirmDocketEntryResult,
  DeadlineTransitionOpts,
  DismissDocketEntryOpts,
  EffectiveClassificationResult,
  FactTransitionOpts,
  GetDocketEntryQuery,
  GetEffectiveClassificationQuery,
  GetFactQuery,
  GetPrivilegeStatusQuery,
  ListAuditEventsPage,
  ListAuditEventsQuery,
  ListConfidentialityClassificationsPage,
  ListConfidentialityClassificationsQuery,
  ListDocketEntriesPage,
  ListDocketEntriesQuery,
  ListDocumentsPage,
  ListDocumentsQuery,
  ListFactsPage,
  ListFactsQuery,
  ListPrivilegeMarkersPage,
  ListPrivilegeMarkersQuery,
  PrivilegeTransitionOpts,
  VerifyAuditChainResult,
} from "./types.js";

import type {
  CaseBoxConfidentialityClassification,
  CaseBoxDeadline,
  CaseBoxDocketEntry,
  CaseBoxFact,
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
import {
  createFactState,
  listFacts as listFactsImpl,
  prepareAppendFact,
  prepareTransitionFact,
  type FactState,
} from "./inMemoryFact.js";
import {
  createDocketState,
  listDocketEntries as listDocketEntriesImpl,
  prepareAppendDocketEntry,
  prepareConfirmDocketEntry,
  prepareDismissDocketEntry,
  type DocketState,
} from "./inMemoryDocket.js";
import {
  createDeadlineState,
  prepareTransitionDeadline,
  type DeadlineState,
} from "./inMemoryDeadline.js";
import {
  prepareCreateMatter,
  prepareMatterTransition,
} from "./inMemoryMatter.js";
import { prepareRegisterDocument } from "./inMemoryDocument.js";

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
  /** Phase A4 — fact storage + duplicate-id index + fact→matter index + fact→row index. */
  readonly fact: FactState;
  /** Phase A5 — docket-entry storage. */
  readonly docket: DocketState;
  /** Phase A5 — deadline storage. */
  readonly deadline: DeadlineState;
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
      fact: createFactState(),
      docket: createDocketState(),
      deadline: createDeadlineState(),
    });
  }

  // -------------------------------------------------------------------------
  // Matter — write paths
  // -------------------------------------------------------------------------

  async createMatter(input: unknown): Promise<CaseBoxMatter> {
    const state = stateOf(this);
    const prepared = prepareCreateMatter(
      input,
      (id) => state.matters.has(id),
      { generateId: () => this.#generateId(), nowIso: () => this.#nowIso() },
    );
    state.matters.set(prepared.matter.id, prepared.matter);
    state.auditByMatter.set(prepared.matter.id, [prepared.audit]);
    return structuredClone(prepared.matter) as CaseBoxMatter;
  }

  async archiveMatter(matterId: string, opts: ArchiveMatterOpts): Promise<CaseBoxMatter> {
    return this.#applyMatterTransition(matterId, opts, "archived", "MATTER_ARCHIVED");
  }

  async unarchiveMatter(matterId: string, opts: ArchiveMatterOpts): Promise<CaseBoxMatter> {
    return this.#applyMatterTransition(matterId, opts, "active", "MATTER_UNARCHIVED");
  }

  async #applyMatterTransition(
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
    const prepared = prepareMatterTransition(matter, opts, to, kind, {
      generateId: () => this.#generateId(),
      nowIso: () => this.#nowIso(),
      storedAuditEventsForMatter: () => state.auditByMatter.get(matterId) ?? [],
    });
    state.matters.set(matterId, prepared.next);
    const stored = state.auditByMatter.get(matterId) ?? [];
    stored.push(prepared.audit);
    state.auditByMatter.set(matterId, stored);
    return structuredClone(prepared.next) as CaseBoxMatter;
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
    const prepared = prepareRegisterDocument(
      matterId,
      matter,
      input,
      (id) => state.documents.has(id),
      {
        generateId: () => this.#generateId(),
        nowIso: () => this.#nowIso(),
        storedAuditEventsForMatter: () => state.auditByMatter.get(matterId) ?? [],
      },
    );
    state.documents.set(prepared.document.id, { document: prepared.document, matter_id: matterId });
    const stored = state.auditByMatter.get(matterId) ?? [];
    stored.push(prepared.audit);
    state.auditByMatter.set(matterId, stored);
    return structuredClone(prepared.document) as CaseBoxDocument;
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
  // Phase A4 — fact delegates
  // -------------------------------------------------------------------------

  async appendFact(input: unknown): Promise<CaseBoxFact> {
    const state = stateOf(this);
    const matterIdFromInput = input !== null && typeof input === "object"
      ? (input as { matter_id?: unknown }).matter_id
      : undefined;
    if (typeof matterIdFromInput === "string" && !state.matters.has(matterIdFromInput)) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
    }
    const prepared = prepareAppendFact(state.fact, input, {
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
    const matter = state.matters.get(prepared.matterId);
    if (matter === undefined) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${prepared.matterId}`);
    }
    if (matter.tenant_id !== prepared.row.tenant_id) {
      throw new CaseBoxPersistenceError(
        "tenant_mismatch",
        `fact.tenant_id (${prepared.row.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
      );
    }

    // Commit
    const arr = state.fact.factsByMatter.get(prepared.matterId) ?? [];
    arr.push(prepared.row);
    state.fact.factsByMatter.set(prepared.matterId, arr);
    state.fact.factIds.add(prepared.row.id);
    state.fact.factIndex.set(prepared.row.id, prepared.matterId);
    state.fact.factById.set(prepared.row.id, prepared.row);
    const stored = state.auditByMatter.get(prepared.matterId) ?? [];
    stored.push(prepared.audit);
    state.auditByMatter.set(prepared.matterId, stored);
    return structuredClone(prepared.row) as CaseBoxFact;
  }

  async transitionFact(factId: string, opts: FactTransitionOpts): Promise<CaseBoxFact> {
    const state = stateOf(this);
    const prepared = prepareTransitionFact(state.fact, factId, opts, {
      generateId: () => this.#generateId(),
      nowIso: () => this.#nowIso(),
      storedAuditEventsForMatter: (matterId) => state.auditByMatter.get(matterId) ?? [],
    });
    const arr = state.fact.factsByMatter.get(prepared.matterId)!;
    const idx = arr.findIndex((f) => f.id === factId);
    arr[idx] = prepared.next;
    state.fact.factById.set(factId, prepared.next);
    const stored = state.auditByMatter.get(prepared.matterId) ?? [];
    stored.push(prepared.audit);
    state.auditByMatter.set(prepared.matterId, stored);
    return structuredClone(prepared.next) as CaseBoxFact;
  }

  async getFact(query: GetFactQuery): Promise<CaseBoxFact | null> {
    const state = stateOf(this);
    // Tenant/matter isolation guard (audit Dim 5 #1 fix): callers MUST
    // supply tenant_id + matter_id + fact_id; persistence verifies the
    // requested fact belongs to the requested scope before returning.
    // Unknown matter is treated as `null` (not an error) to match
    // get-style methods' "not-found returns null" convention.
    const matter = state.matters.get(query.matter_id);
    if (matter === undefined) return null;
    if (matter.tenant_id !== query.tenant_id) {
      throw new CaseBoxPersistenceError(
        "tenant_mismatch",
        `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
      );
    }
    const row = state.fact.factById.get(query.fact_id);
    if (row === undefined) return null;
    if (row.matter_id !== query.matter_id) {
      // Fact exists but belongs to a different matter — treat as not-found
      // for this scope (do not leak the existence of cross-matter ids).
      return null;
    }
    if (row.tenant_id !== query.tenant_id) {
      return null;
    }
    return structuredClone(row) as CaseBoxFact;
  }

  async listFacts(query: ListFactsQuery): Promise<ListFactsPage> {
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
    return listFactsImpl(state.fact, query, {
      getDocument: (documentId) => {
        const entry = state.documents.get(documentId);
        return entry === undefined ? null : { document: entry.document };
      },
    });
  }

  // -------------------------------------------------------------------------
  // Phase A5 — docket-entry + deadline delegates
  // -------------------------------------------------------------------------

  async appendDocketEntry(input: unknown): Promise<CaseBoxDocketEntry> {
    const state = stateOf(this);
    const matterIdFromInput = input !== null && typeof input === "object"
      ? (input as { matter_id?: unknown }).matter_id
      : undefined;
    if (typeof matterIdFromInput === "string" && !state.matters.has(matterIdFromInput)) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
    }
    const prepared = prepareAppendDocketEntry(state.docket, input, {
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
    const matter = state.matters.get(prepared.matterId);
    if (matter === undefined) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${prepared.matterId}`);
    }
    if (matter.tenant_id !== prepared.row.tenant_id) {
      throw new CaseBoxPersistenceError(
        "tenant_mismatch",
        `entry.tenant_id (${prepared.row.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
      );
    }
    // Commit
    const arr = state.docket.entriesByMatter.get(prepared.matterId) ?? [];
    arr.push(prepared.row);
    state.docket.entriesByMatter.set(prepared.matterId, arr);
    state.docket.docketIds.add(prepared.row.id);
    state.docket.docketIndex.set(prepared.row.id, prepared.matterId);
    state.docket.docketById.set(prepared.row.id, prepared.row);
    const stored = state.auditByMatter.get(prepared.matterId) ?? [];
    stored.push(prepared.audit);
    state.auditByMatter.set(prepared.matterId, stored);
    return structuredClone(prepared.row) as CaseBoxDocketEntry;
  }

  async confirmDocketEntry(entryId: string, opts: ConfirmDocketEntryOpts): Promise<ConfirmDocketEntryResult> {
    const state = stateOf(this);
    const prepared = prepareConfirmDocketEntry(state.docket, state.deadline, entryId, opts, {
      generateId: () => this.#generateId(),
      nowIso: () => this.#nowIso(),
      storedAuditEventsForMatter: (matterId) => state.auditByMatter.get(matterId) ?? [],
    });
    if (prepared.idempotent) {
      return {
        entry: structuredClone(prepared.entry) as CaseBoxDocketEntry,
        deadline: structuredClone(prepared.deadline) as CaseBoxDeadline,
        idempotent: true,
      };
    }
    // Atomic commit: entry patch + deadline create + 2 audit events.
    const arr = state.docket.entriesByMatter.get(prepared.matterId)!;
    const idx = arr.findIndex((e) => e.id === entryId);
    arr[idx] = prepared.entry;
    state.docket.docketById.set(entryId, prepared.entry);
    const darr = state.deadline.deadlinesByMatter.get(prepared.matterId) ?? [];
    darr.push(prepared.deadline);
    state.deadline.deadlinesByMatter.set(prepared.matterId, darr);
    state.deadline.deadlineIds.add(prepared.deadline.id);
    state.deadline.deadlineIndex.set(prepared.deadline.id, prepared.matterId);
    state.deadline.deadlineById.set(prepared.deadline.id, prepared.deadline);
    const stored = state.auditByMatter.get(prepared.matterId) ?? [];
    stored.push(prepared.audits[0]!);
    stored.push(prepared.audits[1]!);
    state.auditByMatter.set(prepared.matterId, stored);
    return {
      entry: structuredClone(prepared.entry) as CaseBoxDocketEntry,
      deadline: structuredClone(prepared.deadline) as CaseBoxDeadline,
      idempotent: false,
    };
  }

  async dismissDocketEntry(entryId: string, opts: DismissDocketEntryOpts): Promise<CaseBoxDocketEntry> {
    const state = stateOf(this);
    const prepared = prepareDismissDocketEntry(state.docket, entryId, opts, {
      generateId: () => this.#generateId(),
      nowIso: () => this.#nowIso(),
      storedAuditEventsForMatter: (matterId) => state.auditByMatter.get(matterId) ?? [],
    });
    const arr = state.docket.entriesByMatter.get(prepared.matterId)!;
    const idx = arr.findIndex((e) => e.id === entryId);
    arr[idx] = prepared.next;
    state.docket.docketById.set(entryId, prepared.next);
    const stored = state.auditByMatter.get(prepared.matterId) ?? [];
    stored.push(prepared.audit);
    state.auditByMatter.set(prepared.matterId, stored);
    return structuredClone(prepared.next) as CaseBoxDocketEntry;
  }

  async getDocketEntry(query: GetDocketEntryQuery): Promise<CaseBoxDocketEntry | null> {
    const state = stateOf(this);
    const matter = state.matters.get(query.matter_id);
    if (matter === undefined) return null;
    if (matter.tenant_id !== query.tenant_id) {
      throw new CaseBoxPersistenceError(
        "tenant_mismatch",
        `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
      );
    }
    const row = state.docket.docketById.get(query.entry_id);
    if (row === undefined) return null;
    if (row.matter_id !== query.matter_id) return null;
    if (row.tenant_id !== query.tenant_id) return null;
    return structuredClone(row) as CaseBoxDocketEntry;
  }

  async listDocketEntries(query: ListDocketEntriesQuery): Promise<ListDocketEntriesPage> {
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
    return listDocketEntriesImpl(state.docket, query);
  }

  async transitionDeadline(deadlineId: string, opts: DeadlineTransitionOpts): Promise<CaseBoxDeadline> {
    const state = stateOf(this);
    const prepared = prepareTransitionDeadline(state.deadline, deadlineId, opts, {
      generateId: () => this.#generateId(),
      nowIso: () => this.#nowIso(),
      storedAuditEventsForMatter: (matterId) => state.auditByMatter.get(matterId) ?? [],
    });
    const arr = state.deadline.deadlinesByMatter.get(prepared.matterId)!;
    const idx = arr.findIndex((d) => d.id === deadlineId);
    arr[idx] = prepared.next;
    state.deadline.deadlineById.set(deadlineId, prepared.next);
    const stored = state.auditByMatter.get(prepared.matterId) ?? [];
    stored.push(prepared.audit);
    state.auditByMatter.set(prepared.matterId, stored);
    return structuredClone(prepared.next) as CaseBoxDeadline;
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

/**
 * Test-only accessor for the fact-state slot. Audit Dim 1 #1 fix: lets
 * conformance §6.A4.22 inject pre-corrupt supersedes pointers so the
 * cycle walk can be exercised. Module-local function (not on the
 * prototype) so the §6.2.7 allowlist stays at 22.
 */
export function _internalFactStateForTest(p: InMemoryCaseBoxPersistence): import("./inMemoryFact.js").FactState {
  const state = _state.get(p);
  if (state === undefined) {
    throw new Error("_internalFactStateForTest: persistence has no internal state");
  }
  return state.fact;
}
