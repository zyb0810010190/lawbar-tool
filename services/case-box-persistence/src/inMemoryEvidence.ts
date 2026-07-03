// Evidence-item storage + lifecycle for Phase A6.
//
// Step 1 schema asymmetry: `supersedes_evidence_id` field lives on the
// SUPERSEDED row (the field reads "id I supersede" but the schema places
// it there). Persistence's option is named `replacement_evidence_id` for
// caller clarity; the persisted contract field name stays as-is.
//
// Step 1 does NOT specify supersession-cycle detection (unlike Step 2 facts).
// A6 deliberately defers cycle detection. The plan documents this.

import {
  assertValidEvidenceTransition,
  buildCaseBoxAuditEvent,
  IllegalTransitionError,
  validateEvidenceItem,
  type CaseBoxAuditEventKind,
  type CaseBoxEvidenceItem,
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
import {
  resolveDocumentTarget,
  type ResolveDocumentDeps,
} from "./resolveTarget.js";

export interface EvidenceState {
  evidenceByMatter: Map<string, CaseBoxEvidenceItem[]>;
  evidenceIds: Set<string>;
  evidenceIndex: Map<string, string>;
  evidenceById: Map<string, CaseBoxEvidenceItem>;
}

export function createEvidenceState(): EvidenceState {
  return {
    evidenceByMatter: new Map(),
    evidenceIds: new Set(),
    evidenceIndex: new Map(),
    evidenceById: new Map(),
  };
}

function compareEvidenceChronological(
  a: CaseBoxEvidenceItem,
  b: CaseBoxEvidenceItem,
): number {
  const ac = a.created_at ?? "";
  const bc = b.created_at ?? "";
  if (ac < bc) return -1;
  if (ac > bc) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * T3 S0 (FORMS-T3-S0-SCHEMA-00 §5): blank proof content is expressed by
 * ABSENCE, never a stored empty string. A whitespace-only `proof_statement`
 * on the append input is normalized to absent BEFORE schema validation (the
 * schema's minLength 1 would otherwise reject it). Non-empty values are
 * preserved VERBATIM (no trimming); non-string values are left in place for
 * AJV to reject; the caller's input object is never mutated.
 *
 * "Blank" is defined by ECMAScript `String.prototype.trim()` (ASCII +
 * Unicode WhiteSpace/LineTerminator, incl. ideographic space U+3000).
 * Zero-width/invisible FORMAT characters (e.g. U+200B) are NOT whitespace
 * and therefore persist verbatim — trim() is the deliberate boundary
 * (audit L3, job audit-mr4iod7p-pju4hi).
 */
function normalizeAppendEvidenceInput(input: unknown): unknown {
  if (input === null || typeof input !== "object") return input;
  if (!Object.prototype.hasOwnProperty.call(input, "proof_statement")) return input;
  const ps = (input as { proof_statement?: unknown }).proof_statement;
  if (typeof ps !== "string" || ps.trim().length !== 0) return input;
  const clone = structuredClone(input) as Record<string, unknown>;
  delete clone.proof_statement;
  return clone;
}

// ---------------------------------------------------------------------------
// appendEvidenceItem (proposed-only)
// ---------------------------------------------------------------------------

interface AppendDeps extends ResolveDocumentDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: () => StoredAuditEvent[];
}

interface PrepareAppendResult {
  row: CaseBoxEvidenceItem;
  audit: StoredAuditEvent;
  matterId: string;
}

export function prepareAppendEvidenceItem(
  state: EvidenceState,
  input: unknown,
  deps: AppendDeps,
): PrepareAppendResult {
  // Pre-schema raw guard: status MUST be "proposed" at append.
  if (input !== null && typeof input === "object") {
    const status = (input as { status?: unknown }).status;
    if (status !== undefined && status !== "proposed") {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `appendEvidenceItem accepts only status === "proposed" (got ${JSON.stringify(status)}); use transitionEvidenceItem for promotion`,
      );
    }
    // Defense-in-depth (round-1 M2.1 fix): supersedes_evidence_id MUST be
    // null OR absent at append. Non-null string is inconsistent with
    // proposed status and rejects with invalid_payload.
    const sup = (input as { supersedes_evidence_id?: unknown }).supersedes_evidence_id;
    if (sup !== undefined && sup !== null) {
      throw new CaseBoxPersistenceError(
        "invalid_payload",
        `supersedes_evidence_id must be null or absent on a proposed evidence item`,
      );
    }
  }

  const v = validateEvidenceItem(normalizeAppendEvidenceInput(input));
  if (!v.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `invalid evidence item: ${v.summary}`);
  }
  const row = structuredClone(v.value) as CaseBoxEvidenceItem;

  if (state.evidenceIds.has(row.id)) {
    throw new CaseBoxPersistenceError("duplicate_id", `evidence item already exists: ${row.id}`);
  }

  // Source-document tenant/matter consistency when set.
  if ((row.source_document_id ?? null) !== null) {
    resolveDocumentTarget(
      { getDocument: deps.getDocument },
      {
        tenant_id: row.tenant_id,
        matter_id: row.matter_id,
        target_id: row.source_document_id as string,
      },
    );
  }

  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter();
  const prevHash = priorHeadOf(stored);
  const built = buildCaseBoxAuditEvent({
    kind: "EVIDENCE_PROPOSED" as CaseBoxAuditEventKind,
    id: deps.generateId(),
    tenant_id: row.tenant_id,
    actor_user_id: row.actor_user_id,
    matter_id: row.matter_id,
    entity_id: row.id,
    before_state_hash: null,
    after_state_hash: entityStateHash(row),
    prev_event_hash: prevHash,
    timestamp: stamp,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }

  return {
    row,
    audit: { sequence: stored.length + 1, event: built.value },
    matterId: row.matter_id,
  };
}

// ---------------------------------------------------------------------------
// transitionEvidenceItem
// ---------------------------------------------------------------------------

export interface EvidenceTransitionOpts {
  readonly to: "accepted" | "rejected" | "superseded";
  readonly actor_user_id: string;
  /**
   * REQUIRED when `to === "superseded"`. The id of the NEW evidence that
   * replaces this one. Maps to the persisted row's contract field
   * `supersedes_evidence_id` (the schema field name reads "id I supersede"
   * but the placement on the now-superseded row implies "id that supersedes
   * me"; persistence's option name resolves the ambiguity).
   */
  readonly replacement_evidence_id?: string;
}

interface PrepareTransitionResult {
  next: CaseBoxEvidenceItem;
  audit: StoredAuditEvent;
  matterId: string;
}

interface TransitionDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
}

export function prepareTransitionEvidenceItem(
  state: EvidenceState,
  evidenceId: string,
  opts: EvidenceTransitionOpts,
  deps: TransitionDeps,
): PrepareTransitionResult {
  if (typeof evidenceId !== "string" || evidenceId.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `evidenceId must be a non-empty string`);
  }
  if (opts === null || typeof opts !== "object") {
    throw new CaseBoxPersistenceError("invalid_argument", `opts must be an object`);
  }
  if (typeof opts.actor_user_id !== "string" || opts.actor_user_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `actor_user_id must be a non-empty string`);
  }
  // Note: evidence-item rows have no transition timestamp fields (the schema
  // does not carry accepted_at/rejected_at/superseded_at). Audit-event
  // timestamp uses #nowIso() from the persistence's injected clock; no
  // caller-supplied `at` field is exposed on EvidenceTransitionOpts.

  const matterId = state.evidenceIndex.get(evidenceId);
  if (matterId === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown evidence item: ${evidenceId}`);
  }
  const prior = state.evidenceById.get(evidenceId);
  if (prior === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown evidence item (evidenceById miss): ${evidenceId}`);
  }

  // accepted → superseded: require + validate the replacement reference.
  if (opts.to === "superseded") {
    if (typeof opts.replacement_evidence_id !== "string" || opts.replacement_evidence_id.length === 0) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `accepted → superseded requires a non-empty replacement_evidence_id`,
      );
    }
    if (opts.replacement_evidence_id === evidenceId) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `evidence ${evidenceId} cannot supersede itself (self-cycle)`,
      );
    }
    const replacement = state.evidenceById.get(opts.replacement_evidence_id);
    if (replacement === undefined) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `replacement_evidence_id references unknown evidence: ${opts.replacement_evidence_id}`,
      );
    }
    if (replacement.matter_id !== prior.matter_id) {
      throw new CaseBoxPersistenceError(
        "matter_id_mismatch",
        `replacement_evidence_id references evidence in a different matter: ${opts.replacement_evidence_id}`,
      );
    }
    if (replacement.tenant_id !== prior.tenant_id) {
      throw new CaseBoxPersistenceError(
        "tenant_mismatch",
        `replacement_evidence_id references evidence in a different tenant: ${opts.replacement_evidence_id}`,
      );
    }
  }

  // Contract transition guard.
  try {
    assertValidEvidenceTransition(prior.status, opts.to, "lawyer");
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      throw new CaseBoxPersistenceError("illegal_transition", e.message);
    }
    throw e;
  }

  // Patch row. status; supersedes_evidence_id only when to=superseded.
  const next: CaseBoxEvidenceItem = structuredClone(prior) as CaseBoxEvidenceItem;
  (next as { status: string }).status = opts.to;
  if (opts.to === "superseded") {
    (next as { supersedes_evidence_id?: string }).supersedes_evidence_id = opts.replacement_evidence_id;
  }

  // Re-validate against schema (catches missing supersedes_evidence_id, etc).
  const reValid = validateEvidenceItem(next);
  if (!reValid.ok) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `transition would produce schema-invalid evidence item: ${reValid.summary}`,
    );
  }

  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter(matterId);
  const prevHash = priorHeadOf(stored);
  const kind: CaseBoxAuditEventKind =
    opts.to === "accepted"
      ? "EVIDENCE_ACCEPTED"
      : opts.to === "rejected"
        ? "EVIDENCE_REJECTED"
        : "EVIDENCE_SUPERSEDED";
  const built = buildCaseBoxAuditEvent({
    kind,
    id: deps.generateId(),
    tenant_id: next.tenant_id,
    actor_user_id: opts.actor_user_id,
    matter_id: matterId,
    entity_id: next.id,
    before_state_hash: entityStateHash(prior),
    after_state_hash: entityStateHash(next),
    prev_event_hash: prevHash,
    timestamp: stamp,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }

  return {
    next,
    audit: { sequence: stored.length + 1, event: built.value },
    matterId,
  };
}

// ---------------------------------------------------------------------------
// listEvidenceItems
// ---------------------------------------------------------------------------

export interface ListEvidenceItemsQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly status?: "proposed" | "accepted" | "rejected" | "superseded";
  readonly source_document_id?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListEvidenceItemsPage {
  readonly rows: ReadonlyArray<CaseBoxEvidenceItem>;
  readonly next_cursor: string | null;
}

export function listEvidenceItems(
  state: EvidenceState,
  query: ListEvidenceItemsQuery,
  deps: ResolveDocumentDeps,
): ListEvidenceItemsPage {
  if (query.source_document_id !== undefined) {
    resolveDocumentTarget(deps, {
      tenant_id: query.tenant_id,
      matter_id: query.matter_id,
      target_id: query.source_document_id,
    });
  }
  const limit = resolveLimit(query.limit);
  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    status: query.status,
    source_document_id: query.source_document_id,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "evidence_items_by_matter", filters_hash })
      : null;
  const raw = state.evidenceByMatter.get(query.matter_id) ?? [];
  let rows = raw.filter((e) => {
    if (e.tenant_id !== query.tenant_id) return false;
    if (query.status !== undefined && e.status !== query.status) return false;
    if (query.source_document_id !== undefined && e.source_document_id !== query.source_document_id) return false;
    return true;
  });
  rows.sort(compareEvidenceChronological);
  if (cursor !== null) {
    const [tCreated, tId] = cursor.last_sort_tuple as [string, string];
    rows = rows.filter((e) => {
      const ec = e.created_at ?? "";
      if (ec > tCreated) return true;
      if (ec === tCreated && e.id > tId) return true;
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
          kind: "evidence_items_by_matter",
          filters_hash,
          last_sort_tuple: [last.created_at ?? "", last.id],
        })
      : null;
  return {
    rows: slice.map((e) => structuredClone(e) as CaseBoxEvidenceItem),
    next_cursor,
  };
}

// ---------------------------------------------------------------------------
// applyAppendEvidenceItem — A7 LOC discipline
// ---------------------------------------------------------------------------

import type { CaseBoxMatter as _CBM7Ev } from "case-box-contract";

interface EvidenceRepoView {
  matters: Map<string, _CBM7Ev>;
  documents: Map<string, { document: import("case-box-contract").CaseBoxDocument; matter_id: string }>;
  auditByMatter: Map<string, StoredAuditEvent[]>;
}
interface EvidenceCDeps { generateId: () => string; nowIso: () => string; }

export function applyAppendEvidenceItem(
  state: EvidenceState,
  repo: EvidenceRepoView,
  deps: EvidenceCDeps,
  input: unknown,
): CaseBoxEvidenceItem {
  const matterIdFromInput = input !== null && typeof input === "object"
    ? (input as { matter_id?: unknown }).matter_id
    : undefined;
  if (typeof matterIdFromInput === "string" && !repo.matters.has(matterIdFromInput)) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
  }
  const prepared = prepareAppendEvidenceItem(state, input, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: () => {
      if (typeof matterIdFromInput !== "string") return [];
      return repo.auditByMatter.get(matterIdFromInput) ?? [];
    },
    getDocument: (documentId) => {
      const entry = repo.documents.get(documentId);
      return entry === undefined ? null : { document: entry.document };
    },
  });
  const matter = repo.matters.get(prepared.matterId);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${prepared.matterId}`);
  }
  if (matter.tenant_id !== prepared.row.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `evidence.tenant_id (${prepared.row.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const arr = state.evidenceByMatter.get(prepared.matterId) ?? [];
  arr.push(prepared.row);
  state.evidenceByMatter.set(prepared.matterId, arr);
  state.evidenceIds.add(prepared.row.id);
  state.evidenceIndex.set(prepared.row.id, prepared.matterId);
  state.evidenceById.set(prepared.row.id, prepared.row);
  const stored = repo.auditByMatter.get(prepared.matterId) ?? [];
  stored.push(prepared.audit);
  repo.auditByMatter.set(prepared.matterId, stored);
  return structuredClone(prepared.row) as CaseBoxEvidenceItem;
}
