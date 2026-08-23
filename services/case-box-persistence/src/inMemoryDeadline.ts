// Deadline storage + lifecycle for Phase A5.
//
// Step 6 ADR §7 mapping: a CaseBoxDeadline row is materialized by Mode B
// of confirmDocketEntry (see inMemoryDocket.ts). This module owns the
// build-helper (so Mode B doesn't inline it) plus the deadline state
// slot and transitionDeadline lifecycle.
//
// Deadline schema lifecycle fields are limited to: status, met_at,
// previous_status, transition_reason. There is NO missed_at or
// withdrawn_at field — transitions to those terminal states patch only
// `status` (the `opts.at` is consumed by the audit event's timestamp).

import {
  assertValidDeadlineTransition,
  buildCaseBoxAuditEvent,
  IllegalTransitionError,
  validateDeadline,
  type CaseBoxAuditEventKind,
  type CaseBoxDeadline,
  type CaseBoxDocketEntry,
} from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";
import {
  entityStateHash,
  priorHeadOf,
  type StoredAuditEvent,
} from "./auditChain.js";

export interface DeadlineState {
  deadlinesByMatter: Map<string, CaseBoxDeadline[]>;
  deadlineIds: Set<string>;
  deadlineIndex: Map<string, string>;
  deadlineById: Map<string, CaseBoxDeadline>;
}

export function createDeadlineState(): DeadlineState {
  return {
    deadlinesByMatter: new Map(),
    deadlineIds: new Set(),
    deadlineIndex: new Map(),
    deadlineById: new Map(),
  };
}

/**
 * Build a new CaseBoxDeadline row from a docket entry being confirmed.
 * Step 6 ADR §7 field mapping. Used by Mode B in inMemoryDocket.ts.
 *
 * Critical: actor_user_id is the CONFIRMING actor (NOT the entry's
 * original proposer). Optional fields (met_at, previous_status,
 * transition_reason) are OMITTED entirely (not nulled). `source_rule_citation`
 * is copied only when the entry's value is a non-null string.
 */
export function buildDeadlineRowFromDocketEntry(
  entry: CaseBoxDocketEntry,
  opts: { deadline_id: string; confirmation_actor_user_id: string },
): CaseBoxDeadline {
  const row: { [k: string]: unknown } = {
    id: opts.deadline_id,
    tenant_id: entry.tenant_id,
    actor_user_id: opts.confirmation_actor_user_id,
    matter_id: entry.matter_id,
    kind: entry.proposed_kind,
    due_at: entry.proposed_due_at,
    owner_user_id: entry.proposed_owner_user_id,
    status: "pending",
  };
  if (typeof entry.source_rule_citation === "string" && entry.source_rule_citation.length > 0) {
    row.source_rule_citation = entry.source_rule_citation;
  }
  return row as unknown as CaseBoxDeadline;
}

export interface DeadlineTransitionOpts {
  readonly to: "met" | "missed" | "withdrawn";
  readonly actor_user_id: string;
  readonly at: string;
  readonly transition_reason?: string;
}

interface PrepareTransitionDeadlineResult {
  next: CaseBoxDeadline;
  audit: StoredAuditEvent;
  matterId: string;
}

interface TransitionDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
}

export function prepareTransitionDeadline(
  state: DeadlineState,
  deadlineId: string,
  opts: DeadlineTransitionOpts,
  deps: TransitionDeps,
): PrepareTransitionDeadlineResult {
  if (typeof deadlineId !== "string" || deadlineId.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `deadlineId must be a non-empty string`);
  }
  if (opts === null || typeof opts !== "object") {
    throw new CaseBoxPersistenceError("invalid_argument", `opts must be an object`);
  }
  if (typeof opts.actor_user_id !== "string" || opts.actor_user_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `actor_user_id must be a non-empty string`);
  }
  if (typeof opts.at !== "string" || opts.at.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `at must be a non-empty ISO-8601 timestamp`);
  }
  const matterId = state.deadlineIndex.get(deadlineId);
  if (matterId === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown deadline: ${deadlineId}`);
  }
  const prior = state.deadlineById.get(deadlineId);
  if (prior === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown deadline (deadlineById miss): ${deadlineId}`);
  }

  // Pre-validate transition_reason for missed → met (only edge that requires it).
  const isMissedToMet = prior.status === "missed" && opts.to === "met";
  if (isMissedToMet) {
    if (typeof opts.transition_reason !== "string" || opts.transition_reason.trim().length === 0) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `missed → met transition requires non-empty transition_reason`,
      );
    }
  }

  try {
    assertValidDeadlineTransition(prior.status, opts.to, "lawyer", opts.transition_reason);
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      throw new CaseBoxPersistenceError("illegal_transition", e.message);
    }
    throw e;
  }

  // Patch only contract-defined fields. Schema has met_at + previous_status +
  // transition_reason; no missed_at, no withdrawn_at.
  const next: CaseBoxDeadline = structuredClone(prior) as CaseBoxDeadline;
  (next as { status: string }).status = opts.to;
  if (opts.to === "met") {
    (next as { met_at?: string }).met_at = opts.at;
  }
  if (isMissedToMet) {
    (next as { previous_status?: string }).previous_status = "missed";
    (next as { transition_reason?: string }).transition_reason = opts.transition_reason!;
  }
  const reValid = validateDeadline(next);
  if (!reValid.ok) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `transition would produce schema-invalid deadline: ${reValid.summary}`,
    );
  }

  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter(matterId);
  const prevHash = priorHeadOf(stored);
  const kind: CaseBoxAuditEventKind = isMissedToMet
    ? "DEADLINE_MISSED_TO_MET"
    : opts.to === "met"
      ? "DEADLINE_MET"
      : opts.to === "missed"
        ? "DEADLINE_MISSED"
        : "DEADLINE_WITHDRAWN";
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
  if (isMissedToMet) {
    eventInput.reason = opts.transition_reason!;
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
