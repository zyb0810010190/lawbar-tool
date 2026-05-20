// Fact-specific semantic invariants. Pure functions; no IO, no network, no
// persistence access. See docs/adr/case-box-step-2-fact-promotion-and-provenance.md.
//
// Three layers enforce no-auto-accept:
//   1. State machine (transitions.ts) — bans `candidate -> accepted` edge.
//   2. Schema invariants (case-box-fact.schema.json) — status × field matrix.
//   3. Creation rule (`assertValidNewFact`, here) — every new fact must be
//      created in status=candidate with all promotion fields null.
//
// Future persistence MUST call `assertValidNewFact` before insert AND MUST
// detect supersession-graph cycles (only self-cycle is caught here).

import type { CaseBoxFact } from "./generated/case-box-fact.js";

export class FactPromotionInvariantError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "FactPromotionInvariantError";
    this.violation = violation;
  }
}

export class FactCreationInvariantError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "FactCreationInvariantError";
    this.violation = violation;
  }
}

type FactPromotionInput = {
  id: string;
  status: string;
  supersedes_fact_id?: string | null;
};

/**
 * Validator-layer checks that pure JSON Schema cannot express:
 *   1. Self-cycle: `id === supersedes_fact_id`.
 *   2. `supersedes_fact_id` set only when status is `accepted`.
 *
 * Broader supersession-graph cycle detection is persistence's job; this helper
 * catches the row-local case only.
 */
export function assertFactPromotionInvariants(fact: FactPromotionInput): void {
  const supersedes = fact.supersedes_fact_id ?? null;
  if (supersedes !== null && supersedes === fact.id) {
    throw new FactPromotionInvariantError(
      `fact ${JSON.stringify(fact.id)} supersedes itself (self-cycle)`,
    );
  }
  if (supersedes !== null && fact.status !== "accepted") {
    throw new FactPromotionInvariantError(
      `supersedes_fact_id may be set only when status === "accepted" (got status=${JSON.stringify(fact.status)})`,
    );
  }
}

type FactCreationInput = {
  status: string;
  reviewer_actor_user_id?: string | null;
  reviewed_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  supersedes_fact_id?: string | null;
};

/**
 * Creation rule: every new fact MUST be inserted with `status === "candidate"`
 * AND every promotion/supersession field MUST be null. Persistence callers
 * MUST invoke this before any insert; bypassing it would allow a caller to
 * write a pre-accepted machine-extracted fact and defeat no-auto-accept.
 */
export function assertValidNewFact(fact: FactCreationInput): void {
  if (fact.status !== "candidate") {
    throw new FactCreationInvariantError(
      `new fact must be created in status="candidate" (got ${JSON.stringify(fact.status)})`,
    );
  }
  const offenders: string[] = [];
  if ((fact.reviewer_actor_user_id ?? null) !== null) offenders.push("reviewer_actor_user_id");
  if ((fact.reviewed_at ?? null) !== null) offenders.push("reviewed_at");
  if ((fact.accepted_at ?? null) !== null) offenders.push("accepted_at");
  if ((fact.rejected_at ?? null) !== null) offenders.push("rejected_at");
  if ((fact.rejection_reason ?? null) !== null) offenders.push("rejection_reason");
  if ((fact.supersedes_fact_id ?? null) !== null) offenders.push("supersedes_fact_id");
  if (offenders.length > 0) {
    throw new FactCreationInvariantError(
      `new fact must have null promotion fields; non-null: ${offenders.join(", ")}`,
    );
  }
}

export function isFactCandidateOnly(fact: { status: string }): boolean {
  return fact.status === "candidate";
}

const MACHINE_SOURCE_TYPES = new Set(["llm_extraction", "ocr_excerpt", "imported"]);

export function factWasMachineExtracted(fact: { source_type: string }): boolean {
  return MACHINE_SOURCE_TYPES.has(fact.source_type);
}

export function isMachineExtractedCandidate(
  fact: { status: string; source_type: string },
): boolean {
  return isFactCandidateOnly(fact) && factWasMachineExtracted(fact);
}

// Re-export the type alias for downstream type-narrowing convenience.
export type { CaseBoxFact };
