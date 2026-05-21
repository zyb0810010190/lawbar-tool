// Privilege-marker storage + lifecycle for Phase A3.
//
// Module-private sibling of inMemoryRepo.ts per the A3 plan's LOC discipline
// (pre-emptive extraction, parallel to A2's inMemoryClassification.ts).
//
// A3 narrows the persistence surface: appendPrivilegeMarker accepts ONLY
// status === "proposed". Direct lawyer-authored confirmed creation is
// REJECTED at this boundary even though the contract's
// assertValidNewPrivilegeMarker allows it. Callers must do
// append(proposed) + transition(proposed → confirmed) as two atomic
// writes so the audit table's update-only PRIVILEGE_MARKER_CONFIRMED
// kind stays coherent (PRIVILEGE_MARKER_PROPOSED is the only privilege
// audit kind with action: "create").

import {
  assertPrivilegeMarkerTimestamps,
  assertValidNewPrivilegeMarker,
  assertValidPrivilegeMarkerTransition,
  buildCaseBoxAuditEvent,
  effectivePrivilegeStatus,
  IllegalTransitionError,
  PrivilegeMarkerCreationError,
  validatePrivilegeMarker,
  type CaseBoxAuditEvent,
  type CaseBoxAuditEventKind,
  type CaseBoxPrivilegeMarker,
  type PrivilegeResolution,
} from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";
import { resolveDocumentTarget } from "./resolveTarget.js";
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

export interface PrivilegeState {
  /** Per-matter array of marker rows in insertion order. */
  markersByMatter: Map<string, CaseBoxPrivilegeMarker[]>;
  /** Fast O(1) duplicate-id index across the whole instance. */
  privilegeIds: Set<string>;
  /** markerId → matterId for transition path lookup. */
  markerIndex: Map<string, string>;
}

export function createPrivilegeState(): PrivilegeState {
  return {
    markersByMatter: new Map(),
    privilegeIds: new Set(),
    markerIndex: new Map(),
  };
}

/** Per-matter chronological comparator: proposed_at ASC, id ASC tie-break. */
function compareMarkersChronological(
  a: CaseBoxPrivilegeMarker,
  b: CaseBoxPrivilegeMarker,
): number {
  const ap = a.proposed_at ?? "";
  const bp = b.proposed_at ?? "";
  if (ap < bp) return -1;
  if (ap > bp) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

interface AppendDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: () => StoredAuditEvent[];
  getDocument: (documentId: string) => { document: import("case-box-contract").CaseBoxDocument } | null;
}

interface PrepareAppendResult {
  row: CaseBoxPrivilegeMarker;
  audit: StoredAuditEvent;
  matterId: string;
}

export function prepareAppendPrivilegeMarker(
  state: PrivilegeState,
  input: unknown,
  deps: AppendDeps,
): PrepareAppendResult {
  // Pre-schema raw guards (A3 narrows the persistence surface).
  if (input !== null && typeof input === "object") {
    const target_type = (input as { target_type?: unknown }).target_type;
    if (target_type === "matter") {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `target_type "matter" is rejected — privilege markers cannot target a matter`,
      );
    }
    if (target_type === "fact") {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `target_type "fact" is not yet supported (facts ship in Phase A4)`,
      );
    }
    const status = (input as { status?: unknown }).status;
    if (status !== undefined && status !== "proposed") {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `appendPrivilegeMarker accepts only status === "proposed" (got ${JSON.stringify(status)}); use transitionPrivilegeMarker to reach confirmed`,
      );
    }
  }

  const v = validatePrivilegeMarker(input);
  if (!v.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `invalid privilege marker: ${v.summary}`);
  }
  const row = structuredClone(v.value) as CaseBoxPrivilegeMarker;

  if (state.privilegeIds.has(row.id)) {
    throw new CaseBoxPersistenceError("duplicate_id", `privilege marker already exists: ${row.id}`);
  }

  try {
    assertValidNewPrivilegeMarker(row);
  } catch (e) {
    if (e instanceof PrivilegeMarkerCreationError) {
      throw new CaseBoxPersistenceError("invalid_payload", e.message);
    }
    throw e;
  }
  try {
    assertPrivilegeMarkerTimestamps(row);
  } catch (e) {
    if (e instanceof PrivilegeMarkerCreationError) {
      throw new CaseBoxPersistenceError("invalid_payload", e.message);
    }
    throw e;
  }

  if (row.target_type !== "document") {
    throw new CaseBoxPersistenceError("invalid_argument", `unexpected target_type ${JSON.stringify(row.target_type)}`);
  }
  // Shared helper (closes A3 F2.2 deferred-audit-backlog row).
  resolveDocumentTarget(
    { getDocument: deps.getDocument },
    { tenant_id: row.tenant_id, matter_id: row.matter_id, target_id: row.target_id },
  );

  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter();
  const prevHash = priorHeadOf(stored);
  const kind: CaseBoxAuditEventKind = "PRIVILEGE_MARKER_PROPOSED";
  const built = buildCaseBoxAuditEvent({
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

export interface PrivilegeTransitionOpts {
  readonly to: "confirmed" | "dismissed" | "waived";
  readonly actor_user_id: string;
  readonly at: string;
  readonly reason?: string;
}

interface PrepareTransitionResult {
  next: CaseBoxPrivilegeMarker;
  prior: CaseBoxPrivilegeMarker;
  audit: StoredAuditEvent;
  matterId: string;
}

interface TransitionDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
}

export function prepareTransitionPrivilegeMarker(
  state: PrivilegeState,
  markerId: string,
  opts: PrivilegeTransitionOpts,
  deps: TransitionDeps,
): PrepareTransitionResult {
  if (typeof markerId !== "string" || markerId.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `markerId must be a non-empty string`);
  }
  if (opts === null || typeof opts !== "object") {
    throw new CaseBoxPersistenceError("invalid_argument", `opts must be an object`);
  }
  if (typeof opts.actor_user_id !== "string" || opts.actor_user_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `actor_user_id must be a non-empty string`);
  }
  if (typeof opts.at !== "string" || opts.at.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `at must be a non-empty ISO-8601 timestamp string`);
  }
  const matterId = state.markerIndex.get(markerId);
  if (matterId === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown privilege marker: ${markerId}`);
  }
  const arr = state.markersByMatter.get(matterId) ?? [];
  const idx = arr.findIndex((m) => m.id === markerId);
  if (idx === -1) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown privilege marker (index miss): ${markerId}`);
  }
  const prior = arr[idx]!;

  // Pre-validate reason for reason-required edges so missing required input
  // surfaces as invalid_argument rather than illegal_transition (per plan
  // round-2 reconciliation M1 fix).
  if (opts.to === "dismissed" || opts.to === "waived") {
    if (typeof opts.reason !== "string" || opts.reason.length === 0) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `transition to ${opts.to} requires a non-empty reason`,
      );
    }
  }

  try {
    assertValidPrivilegeMarkerTransition(prior.status, opts.to, "lawyer", opts.reason);
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      throw new CaseBoxPersistenceError("illegal_transition", e.message);
    }
    throw e;
  }

  // Confirmed-marker uniqueness: scoped to status === "confirmed" only.
  if (opts.to === "confirmed") {
    for (const other of arr) {
      if (other.id === prior.id) continue;
      if (other.status !== "confirmed") continue;
      if (
        other.target_type === prior.target_type &&
        other.target_id === prior.target_id &&
        other.kind === prior.kind
      ) {
        throw new CaseBoxPersistenceError(
          "invalid_argument",
          `another confirmed privilege marker already exists for (target_type=${prior.target_type}, target_id=${prior.target_id}, kind=${prior.kind}); waive it first`,
        );
      }
    }
  }

  const next: CaseBoxPrivilegeMarker = structuredClone(prior) as CaseBoxPrivilegeMarker;
  next.status = opts.to;
  if (opts.to === "confirmed") {
    (next as { confirmed_actor_user_id?: string | null }).confirmed_actor_user_id = opts.actor_user_id;
    (next as { confirmed_at?: string | null }).confirmed_at = opts.at;
  } else if (opts.to === "dismissed") {
    (next as { dismissed_actor_user_id?: string | null }).dismissed_actor_user_id = opts.actor_user_id;
    (next as { dismissed_at?: string | null }).dismissed_at = opts.at;
    (next as { dismissal_reason?: string | null }).dismissal_reason = opts.reason!;
  } else if (opts.to === "waived") {
    (next as { waiver_actor_user_id?: string | null }).waiver_actor_user_id = opts.actor_user_id;
    (next as { waived_at?: string | null }).waived_at = opts.at;
    (next as { waiver_reason?: string | null }).waiver_reason = opts.reason!;
  }

  // Re-validate the patched row against the schema FIRST (audit Dim 1 #1 +
  // Dim 5 #1): the contract schema's `format: date-time` is strict where
  // Date.parse is lenient, so this catches non-ISO opts.at values before
  // assertPrivilegeMarkerTimestamps (which uses Date.parse) classifies them
  // as invalid_payload. Schema rejection → invalid_argument.
  const reValid = validatePrivilegeMarker(next);
  if (!reValid.ok) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `transition would produce schema-invalid marker: ${reValid.summary}`,
    );
  }
  try {
    assertPrivilegeMarkerTimestamps(next);
  } catch (e) {
    if (e instanceof PrivilegeMarkerCreationError) {
      throw new CaseBoxPersistenceError("invalid_payload", e.message);
    }
    throw e;
  }

  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter(matterId);
  const prevHash = priorHeadOf(stored);
  const kind: CaseBoxAuditEventKind =
    opts.to === "confirmed"
      ? "PRIVILEGE_MARKER_CONFIRMED"
      : opts.to === "dismissed"
        ? "PRIVILEGE_MARKER_DISMISSED"
        : "PRIVILEGE_MARKER_WAIVED";
  const eventInput: Parameters<typeof buildCaseBoxAuditEvent>[0] = {
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
  };
  if (opts.to === "dismissed" || opts.to === "waived") {
    eventInput.reason = opts.reason!;
  }
  const built = buildCaseBoxAuditEvent(eventInput);
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }

  return {
    next,
    prior,
    audit: { sequence: stored.length + 1, event: built.value },
    matterId,
  };
}

export function getEffectivePrivilege(
  state: PrivilegeState,
  matterId: string,
  targetType: "document" | "fact",
  targetId: string,
): PrivilegeResolution {
  const all = state.markersByMatter.get(matterId) ?? [];
  // Deep-clone before passing to the resolver so the resolver's output
  // arrays are safe to expose without further cloning.
  const cloned = all.map((m) => structuredClone(m) as CaseBoxPrivilegeMarker);
  return effectivePrivilegeStatus(targetType, targetId, cloned);
}

// (A3 F2.1 closure: locally-redeclared ListPrivilegeMarkers{Query,Page}
//  removed; types imported from ./types.js at the top of this module.)
import type {
  ListPrivilegeMarkersPage,
  ListPrivilegeMarkersQuery,
} from "./types.js";

export function listPrivilegeMarkers(
  state: PrivilegeState,
  query: ListPrivilegeMarkersQuery,
): ListPrivilegeMarkersPage {
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
    status: query.status,
    kind: query.kind,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "privilege_markers_by_matter", filters_hash })
      : null;

  const raw = state.markersByMatter.get(query.matter_id) ?? [];
  let rows = raw.filter((m) => {
    if (m.tenant_id !== query.tenant_id) return false;
    if (query.target_type !== undefined && m.target_type !== query.target_type) return false;
    if (query.target_id !== undefined && m.target_id !== query.target_id) return false;
    if (query.status !== undefined && m.status !== query.status) return false;
    if (query.kind !== undefined && m.kind !== query.kind) return false;
    return true;
  });
  rows.sort(compareMarkersChronological);
  if (cursor !== null) {
    const [tProposed, tId] = cursor.last_sort_tuple as [string, string];
    rows = rows.filter((m) => {
      const mp = m.proposed_at ?? "";
      if (mp > tProposed) return true;
      if (mp === tProposed && m.id > tId) return true;
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
          kind: "privilege_markers_by_matter",
          filters_hash,
          last_sort_tuple: [last.proposed_at ?? "", last.id],
        })
      : null;
  return {
    rows: slice.map((m) => structuredClone(m) as CaseBoxPrivilegeMarker),
    next_cursor,
  };
}
