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
