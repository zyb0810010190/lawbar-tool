// Fact storage + lifecycle for Phase A4.
//
// Module-private sibling of inMemoryRepo.ts per the A4 plan's LOC discipline
// (pre-emptive extraction, parallel to A2/A3 siblings).
//
// A4 narrows the persistence surface: appendFact accepts ONLY
// status === "candidate". Direct reviewed/accepted/rejected creation is
// REJECTED at this boundary (the contract's assertValidNewFact also
// enforces it; persistence pre-validates so the error is invalid_argument
// rather than invalid_payload).
//
// Supersession is a new-row relationship per Step 2 ADR §3:
//   - new accepted fact carries supersedes_fact_id pointing to prior accepted fact;
//   - both rows stay in status "accepted";
//   - audit kind FACT_REPLACEMENT_ACCEPTED (action: create) — before_state_hash
//     MUST be null per audit-log.ts:365.
//
// Broader supersession-graph cycle detection is a persistence obligation
// (Step 2 ADR §3 explicit hard requirement). Implemented here as a walk
// from opts.supersedes_fact_id following .supersedes_fact_id pointers;
// bounded by total fact count for defense against pre-existing corruption.

import {
  assertFactPromotionInvariants,
  assertValidFactTransition,
  assertValidNewFact,
  buildCaseBoxAuditEvent,
  FactCreationInvariantError,
  FactPromotionInvariantError,
  IllegalTransitionError,
  validateFact,
  type CaseBoxAuditEventKind,
  type CaseBoxFact,
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

export interface FactState {
  /** Per-matter array in insertion order. */
  factsByMatter: Map<string, CaseBoxFact[]>;
  /** Fast O(1) duplicate-id index. */
  factIds: Set<string>;
  /** factId → matterId for transition path lookup. */
  factIndex: Map<string, string>;
  /** factId → row reference for O(chain length) supersession walk. */
  factById: Map<string, CaseBoxFact>;
}

export function createFactState(): FactState {
  return {
    factsByMatter: new Map(),
    factIds: new Set(),
    factIndex: new Map(),
    factById: new Map(),
  };
}

/** Per-matter chronological comparator: created_at ASC, id ASC tie-break. */
function compareFactsChronological(a: CaseBoxFact, b: CaseBoxFact): number {
  const ac = a.created_at ?? "";
  const bc = b.created_at ?? "";
  if (ac < bc) return -1;
  if (ac > bc) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

interface AppendDeps extends ResolveDocumentDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: () => StoredAuditEvent[];
}

interface PrepareAppendResult {
  row: CaseBoxFact;
  audit: StoredAuditEvent;
  matterId: string;
}

export function prepareAppendFact(
  state: FactState,
  input: unknown,
  deps: AppendDeps,
): PrepareAppendResult {
  // Pre-schema raw guard: candidate-only at the persistence boundary.
  if (input !== null && typeof input === "object") {
    const status = (input as { status?: unknown }).status;
    if (status !== undefined && status !== "candidate") {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `appendFact accepts only status === "candidate" (got ${JSON.stringify(status)}); use transitionFact for promotion`,
      );
    }
  }

  const v = validateFact(input);
  if (!v.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `invalid fact: ${v.summary}`);
  }
  const row = structuredClone(v.value) as CaseBoxFact;

  if (state.factIds.has(row.id)) {
    throw new CaseBoxPersistenceError("duplicate_id", `fact already exists: ${row.id}`);
  }

  try {
    assertValidNewFact(row);
  } catch (e) {
    if (e instanceof FactCreationInvariantError) {
      throw new CaseBoxPersistenceError("invalid_payload", e.message);
    }
    throw e;
  }
  try {
    assertFactPromotionInvariants(row);
  } catch (e) {
    if (e instanceof FactPromotionInvariantError) {
      throw new CaseBoxPersistenceError("invalid_payload", e.message);
    }
    throw e;
  }

  // Source-document tenant/matter consistency when source_document_id is set.
  if (row.source_document_id !== null) {
    resolveDocumentTarget(
      { getDocument: deps.getDocument },
      {
        tenant_id: row.tenant_id,
        matter_id: row.matter_id,
        target_id: row.source_document_id,
      },
    );
  }

  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter();
  const prevHash = priorHeadOf(stored);
  const kind: CaseBoxAuditEventKind = "FACT_PROPOSED";
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

export interface FactTransitionOpts {
  readonly to: "reviewed" | "accepted" | "rejected";
  readonly reviewer_actor_user_id: string;
  readonly at: string;
  readonly rejection_reason?: string;
  readonly supersedes_fact_id?: string;
}

interface PrepareTransitionResult {
  next: CaseBoxFact;
  audit: StoredAuditEvent;
  matterId: string;
}

interface TransitionDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
}

export function prepareTransitionFact(
  state: FactState,
  factId: string,
  opts: FactTransitionOpts,
  deps: TransitionDeps,
): PrepareTransitionResult {
  if (typeof factId !== "string" || factId.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `factId must be a non-empty string`);
  }
  if (opts === null || typeof opts !== "object") {
    throw new CaseBoxPersistenceError("invalid_argument", `opts must be an object`);
  }
  if (typeof opts.reviewer_actor_user_id !== "string" || opts.reviewer_actor_user_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `reviewer_actor_user_id must be a non-empty string`);
  }
  if (typeof opts.at !== "string" || opts.at.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `at must be a non-empty ISO-8601 timestamp string`);
  }

  const matterId = state.factIndex.get(factId);
  if (matterId === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown fact: ${factId}`);
  }
  const prior = state.factById.get(factId);
  if (prior === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown fact (factById miss): ${factId}`);
  }

  // Reason pre-validation for rejected edges (mirrors A3's pattern).
  if (opts.to === "rejected") {
    if (typeof opts.rejection_reason !== "string" || opts.rejection_reason.trim().length === 0) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `transition to rejected requires a non-empty rejection_reason`,
      );
    }
  }

  // Supersession pre-checks for accepted-with-supersedes path.
  if (opts.to === "accepted" && opts.supersedes_fact_id !== undefined) {
    if (typeof opts.supersedes_fact_id !== "string" || opts.supersedes_fact_id.length === 0) {
      throw new CaseBoxPersistenceError("invalid_argument", `supersedes_fact_id must be a non-empty string`);
    }
    if (opts.supersedes_fact_id === factId) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `fact ${factId} cannot supersede itself (self-cycle)`,
      );
    }
    const target = state.factById.get(opts.supersedes_fact_id);
    if (target === undefined) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `supersedes_fact_id references unknown fact: ${opts.supersedes_fact_id}`,
      );
    }
    if (target.matter_id !== prior.matter_id) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `supersedes_fact_id references a fact in a different matter: ${opts.supersedes_fact_id}`,
      );
    }
    if (target.status !== "accepted") {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `supersedes_fact_id must reference an accepted fact (got ${JSON.stringify(target.status)})`,
      );
    }
    // Supersession-graph cycle walk: starting from target, follow
    // .supersedes_fact_id pointers; reject if we encounter factId or
    // exceed the total fact count (defense against pre-existing graph
    // corruption).
    const visited = new Set<string>();
    let cursor: string | null = opts.supersedes_fact_id;
    while (cursor !== null) {
      if (cursor === factId) {
        throw new CaseBoxPersistenceError(
          "invalid_argument",
          `transition would create supersession cycle: ${factId} ← ${opts.supersedes_fact_id} ← ... ← ${factId}`,
        );
      }
      if (visited.has(cursor)) {
        throw new CaseBoxPersistenceError(
          "invalid_argument",
          `pre-existing supersession cycle detected starting at ${opts.supersedes_fact_id}`,
        );
      }
      visited.add(cursor);
      const node: CaseBoxFact | undefined = state.factById.get(cursor);
      if (node === undefined) break;
      cursor = node.supersedes_fact_id ?? null;
      if (visited.size > state.factIds.size + 1) {
        throw new CaseBoxPersistenceError(
          "invalid_argument",
          `supersession walk exceeded fact count; corrupt chain at ${opts.supersedes_fact_id}`,
        );
      }
    }
  }

  // Contract transition guard (3-arg; no reason arg for facts).
  try {
    assertValidFactTransition(prior.status, opts.to, "lawyer");
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      throw new CaseBoxPersistenceError("illegal_transition", e.message);
    }
    throw e;
  }

  const next: CaseBoxFact = structuredClone(prior) as CaseBoxFact;
  next.status = opts.to;
  if (opts.to === "reviewed") {
    next.reviewer_actor_user_id = opts.reviewer_actor_user_id;
    next.reviewed_at = opts.at;
  } else if (opts.to === "rejected") {
    // Both shortcut (from candidate) and direct (from reviewed) end up here.
    // If reviewer fields are unset (shortcut), set them from opts.
    if ((next.reviewer_actor_user_id ?? null) === null) {
      next.reviewer_actor_user_id = opts.reviewer_actor_user_id;
    }
    if ((next.reviewed_at ?? null) === null) {
      next.reviewed_at = opts.at;
    }
    next.rejected_at = opts.at;
    next.rejection_reason = opts.rejection_reason!;
  } else if (opts.to === "accepted") {
    next.accepted_at = opts.at;
    if (opts.supersedes_fact_id !== undefined) {
      next.supersedes_fact_id = opts.supersedes_fact_id;
    }
  }

  // Re-validate against schema (catches malformed timestamps, mirrors A3).
  const reValid = validateFact(next);
  if (!reValid.ok) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `transition would produce schema-invalid fact: ${reValid.summary}`,
    );
  }
  try {
    assertFactPromotionInvariants(next);
  } catch (e) {
    if (e instanceof FactPromotionInvariantError) {
      throw new CaseBoxPersistenceError("invalid_payload", e.message);
    }
    throw e;
  }

  // Audit kind + field bindings per the audit-log table.
  const isReplacement = opts.to === "accepted" && opts.supersedes_fact_id !== undefined;
  const kind: CaseBoxAuditEventKind =
    opts.to === "reviewed"
      ? "FACT_REVIEWED"
      : opts.to === "rejected"
        ? "FACT_REJECTED"
        : isReplacement
          ? "FACT_REPLACEMENT_ACCEPTED"
          : "FACT_ACCEPTED";
  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter(matterId);
  const prevHash = priorHeadOf(stored);
  const eventInput: Parameters<typeof buildCaseBoxAuditEvent>[0] = {
    kind,
    id: deps.generateId(),
    tenant_id: next.tenant_id,
    actor_user_id: opts.reviewer_actor_user_id,
    matter_id: matterId,
    entity_id: next.id,
    // FACT_REPLACEMENT_ACCEPTED is action: create per the contract table;
    // audit-log.ts:365 enforces before_state_hash === null for create. All
    // other transition kinds are action: update and carry the prior hash.
    before_state_hash: isReplacement ? null : entityStateHash(prior),
    after_state_hash: entityStateHash(next),
    prev_event_hash: prevHash,
    timestamp: stamp,
  };
  if (opts.to === "rejected") {
    eventInput.reason = opts.rejection_reason!;
  }
  const built = buildCaseBoxAuditEvent(eventInput);
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }

  return {
    next,
    audit: { sequence: stored.length + 1, event: built.value },
    matterId,
  };
}

/**
 * Test-only seam for exercising supersession-cycle detection against
 * pre-corrupt state. Audit Dim 1 #1 fix: §6.A4.22 previously asserted
 * `true` because a 2-cycle is not constructible through the legal API
 * (accepted is terminal). This export lets a conformance test corrupt
 * a fact's supersedes_fact_id directly so the cycle walk can be
 * exercised. NOT re-exported from src/index.ts — invisible to package
 * consumers. The §6.2.7 prototype allowlist stays unaffected because
 * this is a module-level function, not a class method.
 */
export function _tamperFactSupersedesForTest(
  state: FactState,
  factId: string,
  supersedesFactId: string | null,
): void {
  const row = state.factById.get(factId);
  if (row === undefined) {
    throw new Error(`tamper: unknown factId ${factId}`);
  }
  (row as { supersedes_fact_id: string | null }).supersedes_fact_id = supersedesFactId;
  // Also update the per-matter array reference.
  const arr = state.factsByMatter.get(row.matter_id) ?? [];
  const idx = arr.findIndex((f) => f.id === factId);
  if (idx >= 0) arr[idx] = row;
}

export interface ListFactsQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly status?: "candidate" | "reviewed" | "accepted" | "rejected";
  readonly source_type?: "lawyer_authored" | "llm_extraction" | "ocr_excerpt" | "imported";
  readonly source_document_id?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListFactsPage {
  readonly rows: ReadonlyArray<CaseBoxFact>;
  readonly next_cursor: string | null;
}

export function listFacts(
  state: FactState,
  query: ListFactsQuery,
  deps: ResolveDocumentDeps,
): ListFactsPage {
  // source_document_id filter validates via resolveDocumentTarget (rejects
  // unknown_document / matter_id_mismatch / tenant_mismatch — does NOT
  // silently return empty page).
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
    source_type: query.source_type,
    source_document_id: query.source_document_id,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "facts_by_matter", filters_hash })
      : null;
  const raw = state.factsByMatter.get(query.matter_id) ?? [];
  let rows = raw.filter((f) => {
    if (f.tenant_id !== query.tenant_id) return false;
    if (query.status !== undefined && f.status !== query.status) return false;
    if (query.source_type !== undefined && f.source_type !== query.source_type) return false;
    if (query.source_document_id !== undefined && f.source_document_id !== query.source_document_id) return false;
    return true;
  });
  rows.sort(compareFactsChronological);
  if (cursor !== null) {
    const [tCreated, tId] = cursor.last_sort_tuple as [string, string];
    rows = rows.filter((f) => {
      const fc = f.created_at ?? "";
      if (fc > tCreated) return true;
      if (fc === tCreated && f.id > tId) return true;
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
          kind: "facts_by_matter",
          filters_hash,
          last_sort_tuple: [last.created_at ?? "", last.id],
        })
      : null;
  return {
    rows: slice.map((f) => structuredClone(f) as CaseBoxFact),
    next_cursor,
  };
}

// ---------------------------------------------------------------------------
// applyAppendFact — A7 LOC discipline
// ---------------------------------------------------------------------------

import type { CaseBoxMatter } from "case-box-contract";
import { InMemoryAuditLog } from "./auditHeadAnchor.js";

interface FactRepoView {
  matters: Map<string, CaseBoxMatter>;
  documents: Map<string, { document: import("case-box-contract").CaseBoxDocument; matter_id: string }>;
  audit: InMemoryAuditLog;
}
interface FactCDeps { generateId: () => string; nowIso: () => string; }

export function applyAppendFact(
  state: FactState,
  repo: FactRepoView,
  deps: FactCDeps,
  input: unknown,
): CaseBoxFact {
  const matterIdFromInput = input !== null && typeof input === "object"
    ? (input as { matter_id?: unknown }).matter_id
    : undefined;
  if (typeof matterIdFromInput === "string" && !repo.matters.has(matterIdFromInput)) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
  }
  const prepared = prepareAppendFact(state, input, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: () => {
      if (typeof matterIdFromInput !== "string") return [];
      return repo.audit.get(matterIdFromInput);
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
      `fact.tenant_id (${prepared.row.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const arr = state.factsByMatter.get(prepared.matterId) ?? [];
  arr.push(prepared.row);
  state.factsByMatter.set(prepared.matterId, arr);
  state.factIds.add(prepared.row.id);
  state.factIndex.set(prepared.row.id, prepared.matterId);
  state.factById.set(prepared.row.id, prepared.row);
  repo.audit.append(prepared.matterId, prepared.audit);
  return structuredClone(prepared.row) as CaseBoxFact;
}

// ---------------------------------------------------------------------------
// applyAppendFactOnce — replay-safe variant (Phase A9)
//
// Pattern: at-least-once redelivery dedupe via id-keyed canonical-payload
// equality. Same id + same payload → return stored row, no audit. Same id
// + different payload → fall through to strict applyAppendFact which throws
// duplicate_id. New id → strict insert + audit.
//
// Precondition: callers MUST stamp the SAME id on each redelivery attempt
// of the same logical request. Once is NOT semantic dedupe across different
// ids — it's idempotency for replay of the same request id.
// ---------------------------------------------------------------------------

/**
 * Canonical, sorted-keys JSON projection of a fact-shaped object. Exported
 * for future SQLite (Phase B) parity — both impls MUST use this helper to
 * compute the dedupe-equality key.
 *
 * CaseBoxFact has no store-assigned fields, so every caller-supplied schema
 * field is included. If a future contract revision adds store-assigned
 * fields (e.g. a persisted_at), they MUST be excluded here.
 */
export function factCanonicalProjection(input: unknown): string {
  return canonicalJsonForFact(input);
}

// Defensive cycle + depth limits (audit Dim 4 #1 fix). Cyclic or
// pathologically deep objects throw before canonicalization runs unbounded.
const FACT_CANONICAL_MAX_DEPTH = 64;

function canonicalJsonForFact(v: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): string {
  if (depth > FACT_CANONICAL_MAX_DEPTH) {
    throw new RangeError("factCanonicalProjection: max depth exceeded");
  }
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (seen.has(v as object)) {
    throw new RangeError("factCanonicalProjection: cyclic reference");
  }
  seen.add(v as object);
  if (Array.isArray(v)) {
    return `[${v.map((x) => canonicalJsonForFact(x, depth + 1, seen)).join(",")}]`;
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonForFact(obj[k], depth + 1, seen)}`).join(",")}}`;
}

export function applyAppendFactOnce(
  state: FactState,
  repo: FactRepoView,
  deps: FactCDeps,
  input: unknown,
): CaseBoxFact {
  // Light pre-parse to find the id without running the full validator.
  // The fall-through path will validate strictly when there's no replay.
  if (input !== null && typeof input === "object") {
    const candidateId = (input as { id?: unknown }).id;
    if (typeof candidateId === "string" && candidateId.length > 0) {
      const stored = state.factById.get(candidateId);
      if (stored !== undefined) {
        // Tenant defense (audit Dim 5 #1 fix): if the input's tenant_id
        // differs from the stored row's tenant_id, fall through to the
        // strict path — never short-circuit into a cross-tenant read.
        const inputTenant = (input as { tenant_id?: unknown }).tenant_id;
        if (typeof inputTenant === "string" && inputTenant !== stored.tenant_id) {
          return applyAppendFact(state, repo, deps, input);
        }
        // Cycle / depth guard (audit Dim 4 #1 fix): canonicalization may
        // throw on hostile payloads; on throw, fall through to strict path
        // which validates the schema and produces a normal invalid_payload.
        try {
          if (factCanonicalProjection(stored) === factCanonicalProjection(input)) {
            // REPLAY: return stored row verbatim. No audit emission.
            return structuredClone(stored) as CaseBoxFact;
          }
        } catch {
          return applyAppendFact(state, repo, deps, input);
        }
        // Same id, different payload — fall through to strict path which
        // will throw duplicate_id (A4 semantics). The conflict surface is
        // shared with the strict path to avoid a new error code.
      }
    }
  }
  return applyAppendFact(state, repo, deps, input);
}
