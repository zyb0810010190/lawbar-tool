// Confidentiality-classification storage + lookup for Phase A2.
//
// Module-private sibling of inMemoryRepo.ts per the A2 plan's LOC discipline
// (pre-emptive extraction). The main InMemoryCaseBoxPersistence delegates to
// the functions exported here; the persistence class keeps its public surface
// at exactly 14 methods (11 from A1 + 3 from A2).
//
// All functions are pure-with-respect-to-the-caller's-state: they receive
// the internal state object explicitly and either return computed values or
// produce side-effect descriptions (next-state shape) for the caller to
// apply in its atomic mutation step. The "validate everything, then mutate
// in one synchronous block" discipline from A1 is preserved.

import {
  buildCaseBoxAuditEvent,
  isDowngrade,
  isResetToUnclassified,
  validateConfidentialityClassification,
  ConfidentialityCreationError,
  assertValidNewConfidentialityClassification,
  type CaseBoxAuditEventKind,
  type CaseBoxConfidentialityClassification,
  type ConfidentialityLevel,
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
// Closure of A3 F2.1 — use public types instead of locally-redeclared
// ListClassificationsQuery / ListClassificationsPage.
import type {
  EffectiveClassificationResult,
  GetEffectiveClassificationQuery,
  ListConfidentialityClassificationsPage as ListClassificationsPage,
  ListConfidentialityClassificationsQuery as ListClassificationsQuery,
} from "./types.js";
import type { CaseBoxDocument, CaseBoxMatter } from "case-box-contract";

export interface RepoViewForAppend {
  matters: Map<string, CaseBoxMatter>;
  documents: Map<string, { document: CaseBoxDocument; matter_id: string }>;
  auditByMatter: Map<string, StoredAuditEvent[]>;
}
export interface CommonAppendDeps {
  generateId: () => string;
  nowIso: () => string;
}

/** State slot held by InMemoryCaseBoxPersistence; passed into every helper. */
export interface ClassificationState {
  /** Per-matter array of classification rows in insertion order. */
  classificationsByMatter: Map<string, CaseBoxConfidentialityClassification[]>;
  /** Fast O(1) duplicate-id index across the whole instance. */
  classificationIds: Set<string>;
}

export function createClassificationState(): ClassificationState {
  return {
    classificationsByMatter: new Map(),
    classificationIds: new Set(),
  };
}

/**
 * Pick the audit kind for a (prior, next) transition. Priority order:
 *   SET (prior=null) > RESET_TO_UNCLASSIFIED > DOWNGRADED > UPGRADED.
 * Same-level (prior === next, prior !== null) is REJECTED upstream — never
 * reaches this function.
 */
export function selectAuditKind(
  prior: ConfidentialityLevel | null,
  next: ConfidentialityLevel,
): CaseBoxAuditEventKind {
  if (prior === null) return "CLASSIFICATION_SET";
  if (isResetToUnclassified(prior, next)) return "CLASSIFICATION_RESET_TO_UNCLASSIFIED";
  if (isDowngrade(prior, next)) return "CLASSIFICATION_DOWNGRADED";
  return "CLASSIFICATION_UPGRADED";
}

/** Latest classification for (target_type, target_id) by set_at DESC, id ASC. */
export function findLatestForTarget(
  state: ClassificationState,
  matterId: string,
  targetType: "document" | "fact",
  targetId: string,
): CaseBoxConfidentialityClassification | null {
  const rows = state.classificationsByMatter.get(matterId) ?? [];
  let latest: CaseBoxConfidentialityClassification | null = null;
  for (const row of rows) {
    if (row.target_type !== targetType) continue;
    if (row.target_id !== targetId) continue;
    if (latest === null) {
      latest = row;
      continue;
    }
    if (compareClassificationLatestFirst(row, latest) < 0) {
      // row is "more latest" than the current candidate per the centralized
      // comparator (set_at DESC, id ASC tie-break).
      latest = row;
    }
  }
  return latest;
}

/**
 * Centralized comparator for classification rows per Step 5 obligation 4:
 * `set_at DESC, id ASC`. Used by BOTH the prior-row lookup and the effective-
 * level history sort so the rule cannot drift between them (audit Dim 2 #1).
 *
 * Returns negative when `a` should sort BEFORE `b` (i.e. `a` is "more latest").
 * Position 0 of a sorted array is the latest.
 */
function compareClassificationLatestFirst(
  a: CaseBoxConfidentialityClassification,
  b: CaseBoxConfidentialityClassification,
): number {
  // set_at DESC: greater set_at is more recent → comes first.
  if (a.set_at < b.set_at) return 1;
  if (a.set_at > b.set_at) return -1;
  // id ASC tie-break: smaller id is "more latest" per the contract.
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Compute the effective level for a target (latest-wins). null history → `unclassified`. */
export function computeEffectiveLevel(
  state: ClassificationState,
  matterId: string,
  targetType: "document" | "fact",
  targetId: string,
): { effectiveLevel: ConfidentialityLevel; history: CaseBoxConfidentialityClassification[] } {
  const rows = state.classificationsByMatter.get(matterId) ?? [];
  const matches: CaseBoxConfidentialityClassification[] = [];
  for (const row of rows) {
    if (row.target_type === targetType && row.target_id === targetId) {
      matches.push(row);
    }
  }
  // Latest-first via the centralized comparator (audit Dim 2 #1).
  matches.sort(compareClassificationLatestFirst);
  if (matches.length === 0) {
    return { effectiveLevel: "unclassified", history: [] };
  }
  return { effectiveLevel: matches[0]!.level, history: matches.map((m) => structuredClone(m) as CaseBoxConfidentialityClassification) };
}

export interface AppendDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: () => StoredAuditEvent[];
  /** Document lookup. Returns null when unknown. */
  getDocument: (documentId: string) => { document: import("case-box-contract").CaseBoxDocument } | null;
}

export interface AppendResult {
  row: CaseBoxConfidentialityClassification;
  audit: StoredAuditEvent;
  matterId: string;
}

/**
 * Validate + prepare a new classification row + audit event WITHOUT mutating
 * any caller state. The caller (InMemoryCaseBoxPersistence) is responsible
 * for applying the returned shape to its state in one synchronous commit.
 */
export function prepareAppendClassification(
  state: ClassificationState,
  input: unknown,
  deps: AppendDeps,
): AppendResult {
  // PRE-schema raw-object guard for target_type === "matter".
  if (
    input !== null &&
    typeof input === "object" &&
    (input as { target_type?: unknown }).target_type === "matter"
  ) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `target_type "matter" is rejected — matter-level confidentiality lives on the matter row, not on a classification entity`,
    );
  }
  if (
    input !== null &&
    typeof input === "object" &&
    (input as { target_type?: unknown }).target_type === "fact"
  ) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `target_type "fact" is not yet supported (facts ship in Phase A4); A2 accepts target_type "document" only`,
    );
  }

  const v = validateConfidentialityClassification(input);
  if (!v.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `invalid classification: ${v.summary}`);
  }
  const row = structuredClone(v.value) as CaseBoxConfidentialityClassification;

  // Non-blank change_reason_text guard (audit Dim 4 #1). The schema enforces
  // minLength: 1 for `other` reason text, but accepts whitespace-only. A
  // whitespace-only reason is operationally useless for downgrade/reset
  // evidence, so reject it at the persistence boundary.
  if (row.change_reason_code === "other") {
    if (typeof row.change_reason_text !== "string" || row.change_reason_text.trim().length === 0) {
      throw new CaseBoxPersistenceError(
        "invalid_payload",
        `change_reason_code === "other" requires non-blank change_reason_text`,
      );
    }
  }

  if (state.classificationIds.has(row.id)) {
    throw new CaseBoxPersistenceError("duplicate_id", `classification already exists: ${row.id}`);
  }

  // Tenant + matter consistency via the document target (shared helper —
  // closes A2 F2.2 + A3 F2.2 deferred-audit-backlog rows).
  if (row.target_type !== "document") {
    // schema enum already restricts to document|fact; we've rejected fact above.
    throw new CaseBoxPersistenceError("invalid_argument", `unexpected target_type ${JSON.stringify(row.target_type)}`);
  }
  resolveDocumentTarget(
    { getDocument: deps.getDocument },
    { tenant_id: row.tenant_id, matter_id: row.matter_id, target_id: row.target_id },
  );

  // Reject same-level (prior_level === level) writes per the plan's transition table.
  if (row.prior_level !== null && row.prior_level === row.level) {
    throw new CaseBoxPersistenceError("invalid_argument", `same-level write rejected (prior=${row.prior_level}, next=${row.level}); A2 declines no-op classifications`);
  }

  // Creation rule via the contract helper.
  const priorRow = findLatestForTarget(state, row.matter_id, row.target_type, row.target_id);
  try {
    assertValidNewConfidentialityClassification(
      {
        prior_level: row.prior_level,
        level: row.level,
        change_reason_code: row.change_reason_code,
      },
      priorRow === null ? null : { level: priorRow.level },
    );
  } catch (e) {
    if (e instanceof ConfidentialityCreationError) {
      throw new CaseBoxPersistenceError("invalid_payload", e.message);
    }
    throw e;
  }

  // Build audit event.
  const kind = selectAuditKind(row.prior_level, row.level);
  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter();
  const prevHash = priorHeadOf(stored);
  const reasonRequired = kind === "CLASSIFICATION_DOWNGRADED" || kind === "CLASSIFICATION_RESET_TO_UNCLASSIFIED";

  const eventInput: Parameters<typeof buildCaseBoxAuditEvent>[0] = {
    kind,
    id: deps.generateId(),
    tenant_id: row.tenant_id,
    actor_user_id: row.actor_user_id,
    matter_id: row.matter_id,
    entity_id: row.id,
    before_state_hash: null,
    after_state_hash: entityStateHash(row),
    prev_event_hash: prevHash,
    timestamp: stamp,
  };
  if (reasonRequired) {
    // Exact-string equality with row.change_reason_code per Step 5 obligation 7
    // and the A2 plan's "no structured-combination escape" pin.
    if (row.change_reason_code === null) {
      // The contract's assertValidNewConfidentialityClassification would have
      // already thrown for null change_reason_code on downgrade/reset. This
      // branch exists for defense-in-depth.
      throw new CaseBoxPersistenceError(
        "invalid_payload",
        `${kind} requires non-null change_reason_code`,
      );
    }
    eventInput.reason = row.change_reason_code;
  }
  const built = buildCaseBoxAuditEvent(eventInput);
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }

  return {
    row,
    audit: { sequence: stored.length + 1, event: built.value },
    matterId: row.matter_id,
  };
}

// (A3 F2.1 closure: locally-redeclared interfaces removed; types imported
//  from ./types.js at the top of this module.)

export function listClassifications(
  state: ClassificationState,
  query: ListClassificationsQuery,
): ListClassificationsPage {
  if (query.target_id !== undefined && query.target_type === undefined) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `target_id without target_type is ambiguous; supply target_type as well`,
    );
  }
  const limit = resolveLimit(query.limit);
  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    target_type: query.target_type,
    target_id: query.target_id,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "classifications_by_matter", filters_hash })
      : null;

  const raw = state.classificationsByMatter.get(query.matter_id) ?? [];
  let rows = raw.filter((r) => {
    if (r.tenant_id !== query.tenant_id) return false;
    if (query.target_type !== undefined && r.target_type !== query.target_type) return false;
    if (query.target_id !== undefined && r.target_id !== query.target_id) return false;
    return true;
  });
  // ORDER BY set_at ASC, id ASC (classification chronological order).
  rows.sort((a, b) => {
    if (a.set_at < b.set_at) return -1;
    if (a.set_at > b.set_at) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  if (cursor !== null) {
    const [tSetAt, tId] = cursor.last_sort_tuple as [string, string];
    rows = rows.filter((r) => {
      if (r.set_at > tSetAt) return true;
      if (r.set_at === tSetAt && r.id > tId) return true;
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
          kind: "classifications_by_matter",
          filters_hash,
          last_sort_tuple: [last.set_at, last.id],
        })
      : null;
  return {
    rows: slice.map((r) => structuredClone(r) as CaseBoxConfidentialityClassification),
    next_cursor,
  };
}

// ---------------------------------------------------------------------------
// applyAppendClassification — full delegate body extracted from inMemoryRepo
// for A7 LOC discipline. Behavior matches the previous inline implementation.
// ---------------------------------------------------------------------------

export function applyAppendClassification(
  state: ClassificationState,
  repo: RepoViewForAppend,
  deps: CommonAppendDeps,
  input: unknown,
): CaseBoxConfidentialityClassification {
  const matterIdFromInput = input !== null && typeof input === "object"
    ? (input as { matter_id?: unknown }).matter_id
    : undefined;
  if (typeof matterIdFromInput === "string" && !repo.matters.has(matterIdFromInput)) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
  }
  const prepared = prepareAppendClassification(state, input, {
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
  if (!repo.matters.has(prepared.matterId)) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${prepared.matterId}`);
  }
  const arr = state.classificationsByMatter.get(prepared.matterId) ?? [];
  arr.push(prepared.row);
  state.classificationsByMatter.set(prepared.matterId, arr);
  state.classificationIds.add(prepared.row.id);
  const stored = repo.auditByMatter.get(prepared.matterId) ?? [];
  stored.push(prepared.audit);
  repo.auditByMatter.set(prepared.matterId, stored);
  return structuredClone(prepared.row) as CaseBoxConfidentialityClassification;
}

// ---------------------------------------------------------------------------
// getEffectiveClassificationHelper — extracted for A7 LOC discipline.
// ---------------------------------------------------------------------------

export function getEffectiveClassificationHelper(
  state: ClassificationState,
  matters: Map<string, CaseBoxMatter>,
  documents: Map<string, { document: CaseBoxDocument; matter_id: string }>,
  query: GetEffectiveClassificationQuery,
): EffectiveClassificationResult {
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
  if (query.target_type !== "document") {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `getEffectiveClassification accepts target_type "document" only in A2 (got ${JSON.stringify(query.target_type)})`,
    );
  }
  const docEntry = documents.get(query.target_id);
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
    state,
    query.matter_id,
    query.target_type,
    query.target_id,
  );
}
