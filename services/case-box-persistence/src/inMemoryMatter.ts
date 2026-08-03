// Matter-transition extraction for Phase A5 LOC discipline.
//
// Moves the body of inMemoryRepo's #transitionMatter (matter
// archive/unarchive lifecycle) to a module-level prepare-helper so the
// repo class stays under the 800 pure-LOC fail threshold after A5's
// additions. WI-brief-matter-type-persistence (2026-05-22) additionally
// wires `assertValidMatterSuccessor` into `prepareCreateMatter` to
// enforce R-5(h) cross-row constraints (same-tenant, matter_type
// differs, no self-cycle) at the persistence boundary.

import {
  assertValidMatterSuccessor,
  assertValidMatterTransition,
  buildCaseBoxAuditEvent,
  IllegalTransitionError,
  MatterSuccessorInvariantError,
  validateMatter,
  type CaseBoxAuditEventKind,
  type CaseBoxMatter,
} from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";
import {
  entityStateHash,
  priorHeadOf,
  type StoredAuditEvent,
} from "./auditChain.js";

interface PrepareTransitionMatterResult {
  next: CaseBoxMatter;
  audit: StoredAuditEvent;
}

interface PrepareCreateMatterResult {
  matter: CaseBoxMatter;
  audit: StoredAuditEvent;
}

interface CreateMatterDeps {
  generateId: () => string;
  nowIso: () => string;
  /** Resolve a matter row by id for R-5(h) successor invariant. Returns null when unknown. */
  getMatterById?: (id: string) => CaseBoxMatter | null;
}

/**
 * Pure-function matter-creation preparation. The repo class calls this
 * from createMatter, then applies the returned matter + audit-event in
 * its WeakMap.
 */
export function prepareCreateMatter(
  input: unknown,
  hasExistingId: (id: string) => boolean,
  deps: CreateMatterDeps,
): PrepareCreateMatterResult {
  const v = validateMatter(input);
  if (!v.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `invalid matter submission: ${v.summary}`);
  }
  const matter = structuredClone(v.value) as CaseBoxMatter;
  if (matter.status !== "active") {
    throw new CaseBoxPersistenceError(
      "invalid_initial_state",
      `matter must be created with status="active" (got ${JSON.stringify(matter.status)})`,
    );
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
  if (matter.successor_matter_id !== undefined && matter.successor_matter_id !== null) {
    const successor = deps.getMatterById ? deps.getMatterById(matter.successor_matter_id) : null;
    try {
      assertValidMatterSuccessor({
        original: {
          id: matter.id,
          tenant_id: matter.tenant_id,
          matter_type: matter.matter_type,
          successor_matter_id: matter.successor_matter_id,
        },
        successor: successor === null
          ? null
          : { id: successor.id, tenant_id: successor.tenant_id, matter_type: successor.matter_type },
      });
    } catch (e) {
      if (e instanceof MatterSuccessorInvariantError) {
        throw new CaseBoxPersistenceError("invalid_payload", e.message);
      }
      throw e;
    }
  }
  if (hasExistingId(matter.id)) {
    throw new CaseBoxPersistenceError("duplicate_id", `matter already exists: ${matter.id}`);
  }
  // WI-PTA-VS0: assign server-side ULIDs to id-less parties BEFORE hashing so
  // the MATTER_REGISTERED event hashes the id-ful state. Operates on the
  // already-cloned `matter` (caller input is never mutated). Rejects duplicate
  // caller-supplied party ids; generated ids are collision-free.
  assignMatterPartyIdsInPlace(matter, deps.generateId);
  const afterHash = entityStateHash(matter);
  const stamp = deps.nowIso();
  const built = buildCaseBoxAuditEvent({
    kind: "MATTER_REGISTERED" as CaseBoxAuditEventKind,
    id: deps.generateId(),
    tenant_id: matter.tenant_id,
    actor_user_id: matter.actor_user_id,
    matter_id: matter.id,
    entity_id: matter.id,
    before_state_hash: null,
    after_state_hash: afterHash,
    prev_event_hash: null,
    timestamp: stamp,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }
  return {
    matter,
    audit: { sequence: 1, event: built.value },
  };
}

interface TransitionMatterDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: () => StoredAuditEvent[];
}

export interface ArchiveMatterOpts {
  readonly actor_user_id: string;
  readonly reason: string;
}

/**
 * Pure-function matter-transition preparation. The repo class calls this
 * from archiveMatter / unarchiveMatter delegates, then applies the
 * returned next-state + audit-event in its WeakMap.
 */
export function prepareMatterTransition(
  matter: CaseBoxMatter,
  opts: ArchiveMatterOpts,
  to: CaseBoxMatter["status"],
  kind: CaseBoxAuditEventKind,
  deps: TransitionMatterDeps,
): PrepareTransitionMatterResult {
  if (typeof opts.reason !== "string" || opts.reason.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `reason must be a non-empty string`);
  }
  if (typeof opts.actor_user_id !== "string" || opts.actor_user_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `actor_user_id must be a non-empty string`);
  }
  try {
    assertValidMatterTransition(matter.status, to, "lawyer");
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      throw new CaseBoxPersistenceError("illegal_transition", e.message);
    }
    throw e;
  }
  const stamp = deps.nowIso();
  const beforeHash = entityStateHash(matter);
  const next: CaseBoxMatter = {
    ...structuredClone(matter),
    status: to,
  };
  if (to === "archived") {
    next.archived_at = stamp;
  } else if (to === "active") {
    delete (next as { archived_at?: string }).archived_at;
  }
  const nextValid = validateMatter(next);
  if (!nextValid.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `post-transition matter invalid: ${nextValid.summary}`);
  }
  const afterHash = entityStateHash(next);
  const stored = deps.storedAuditEventsForMatter();
  const prevHash = priorHeadOf(stored);
  const built = buildCaseBoxAuditEvent({
    kind,
    id: deps.generateId(),
    tenant_id: matter.tenant_id,
    actor_user_id: opts.actor_user_id,
    matter_id: matter.id,
    entity_id: matter.id,
    before_state_hash: beforeHash,
    after_state_hash: afterHash,
    prev_event_hash: prevHash,
    timestamp: stamp,
    reason: opts.reason,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }
  return {
    next,
    audit: { sequence: stored.length + 1, event: built.value },
  };
}

// ---------------------------------------------------------------------------
// WI-PTA-VS0 — matter party-identity assignment / audited backfill.
// ---------------------------------------------------------------------------

/**
 * Retry cap for collision-free party-id generation. A broken / deterministic
 * generator that keeps yielding an already-seen id must fail fast rather than
 * spin forever inside the SQLite `BEGIN IMMEDIATE` (holding the write lock).
 */
const MAX_PARTY_ID_GENERATION_ATTEMPTS = 1000;

/**
 * Assign server-side ULIDs to id-less parties on the given matter, IN PLACE.
 * The matter MUST already be a caller-owned copy (both call sites pass a
 * `structuredClone`d matter), so the caller's input is never mutated.
 *
 * Uniqueness (plan §2.5): rejects a matter whose caller-supplied party ids are
 * non-unique (`invalid_payload`), and never generates an id that collides with
 * an existing OR a freshly-generated id in the same matter. Returns the number
 * of ids assigned (0 ⇒ every party already carried an id).
 */
export function assignMatterPartyIdsInPlace(
  matter: CaseBoxMatter,
  generateId: () => string,
): number {
  const parties = matter.parties as Array<{ id?: string }>;
  if (!Array.isArray(parties)) return 0;
  const seen = new Set<string>();
  // Pass 1 — collect + reject duplicate caller-supplied ids.
  for (const party of parties) {
    const id = party.id;
    if (typeof id === "string" && id.length > 0) {
      if (seen.has(id)) {
        throw new CaseBoxPersistenceError(
          "invalid_payload",
          `duplicate party id within matter ${matter.id}: ${JSON.stringify(id)}`,
        );
      }
      seen.add(id);
    }
  }
  // Pass 2 — assign collision-free ids to id-less parties (bounded retry).
  let assigned = 0;
  for (const party of parties) {
    if (typeof party.id === "string" && party.id.length > 0) continue;
    let fresh = generateId();
    let attempts = 0;
    while (seen.has(fresh)) {
      attempts += 1;
      if (attempts > MAX_PARTY_ID_GENERATION_ATTEMPTS) {
        throw new CaseBoxPersistenceError(
          "invalid_argument",
          `party id generator failed to produce a unique id after ${MAX_PARTY_ID_GENERATION_ATTEMPTS} attempts`,
        );
      }
      fresh = generateId();
    }
    seen.add(fresh);
    party.id = fresh;
    assigned += 1;
  }
  return assigned;
}

export interface EnsureMatterPartyIdsOpts {
  readonly actorUserId: string;
}

interface EnsureMatterPartyIdsDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: () => StoredAuditEvent[];
}

interface PrepareEnsureMatterPartyIdsResult {
  /** True iff at least one party id was assigned (⇒ payload rewrite + one event). */
  changed: boolean;
  next: CaseBoxMatter;
  /** Present iff `changed`; the single MATTER_PARTY_IDS_ASSIGNED event to append. */
  audit?: StoredAuditEvent;
}

/**
 * Pure-function preparation for the audited party-id backfill
 * (`ensureMatterPartyIds`). Loads-then-prepares: the repo passes the current
 * stored matter; this builds the rewritten payload + the single
 * MATTER_PARTY_IDS_ASSIGNED audit event, or reports `changed:false` when every
 * party already has an id (idempotent — no write, no event).
 *
 * State-hash continuity (plan §4.3): `before_state_hash` is sourced DIRECTLY
 * from the prior matter event's `after_state_hash` — and that value is verified
 * fail-closed to equal the hash of the CURRENT stored payload before any
 * rewrite (audit remediation FIX 1). `after_state_hash` is the hash of the
 * rewritten id-ful payload. The actor is the EXPLICIT caller-supplied
 * `actorUserId`, never the matter's original actor (plan §2.6).
 */
export function prepareEnsureMatterPartyIds(
  matter: CaseBoxMatter,
  opts: EnsureMatterPartyIdsOpts,
  deps: EnsureMatterPartyIdsDeps,
): PrepareEnsureMatterPartyIdsResult {
  if (typeof opts.actorUserId !== "string" || opts.actorUserId.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `actorUserId must be a non-empty string`);
  }
  const next = structuredClone(matter) as CaseBoxMatter;
  // Rejects duplicate existing ids even on the all-ids-present path.
  const assigned = assignMatterPartyIdsInPlace(next, deps.generateId);
  if (assigned === 0) {
    // Idempotent: every party already has an id — no write, no event. Short-
    // circuits BEFORE the fail-closed desync check does any work, so an
    // all-ids-present matter never triggers it.
    return { changed: false, next };
  }
  // Fail-closed state-hash continuity (audit remediation FIX 1): the backfill
  // rewrites an audited entity, so the CURRENT stored payload MUST already be
  // in sync with the chain head. Require the prior matter event to exist and
  // its after_state_hash to equal the hash of the current stored payload;
  // otherwise refuse — do NOT rewrite the payload, emit an event, or advance
  // the head — rather than silently extend a corrupted chain.
  const stored = deps.storedAuditEventsForMatter();
  const prior = stored.length > 0 ? stored[stored.length - 1]! : undefined;
  if (prior === undefined) {
    throw new CaseBoxPersistenceError(
      "audit_chain_desync",
      `cannot backfill party ids: matter ${matter.id} has no prior audit event`,
    );
  }
  const priorAfterHash = prior.event.after_state_hash;
  if (priorAfterHash !== entityStateHash(matter)) {
    throw new CaseBoxPersistenceError(
      "audit_chain_desync",
      `cannot backfill party ids: stored matter ${matter.id} payload is out of sync with the audit chain ` +
        `(last event after_state_hash != current payload hash)`,
    );
  }
  const afterHash = entityStateHash(next);
  const stamp = deps.nowIso();
  const prevHash = priorHeadOf(stored);
  const built = buildCaseBoxAuditEvent({
    kind: "MATTER_PARTY_IDS_ASSIGNED" as CaseBoxAuditEventKind,
    id: deps.generateId(),
    tenant_id: matter.tenant_id,
    actor_user_id: opts.actorUserId,
    matter_id: matter.id,
    entity_id: matter.id,
    before_state_hash: priorAfterHash,
    after_state_hash: afterHash,
    prev_event_hash: prevHash,
    timestamp: stamp,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }
  return {
    changed: true,
    next,
    audit: { sequence: stored.length + 1, event: built.value },
  };
}
