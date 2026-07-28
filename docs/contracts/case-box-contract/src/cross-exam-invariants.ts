// CrossExaminationOpinion-specific semantic invariant. Pure function; no IO, no
// network, no persistence access. Mirrors the src/fact-invariants.ts precedent:
// the JSON Schema (case-box-cross-examination-opinion.schema.json) stays FLAT
// (no if/then) and this helper carries the cross-field rule that a flat schema
// deliberately does not express.
//
// Rule (frozen spec §3, "required iff"; strict): `our_response_short_version`
// MUST be a non-empty string when
//   direction === "their_anticipated_objection_to_our_evidence"
// and MUST be null/empty otherwise. `our_response_short_version` is OUR prepared
// response to an anticipated objection against OUR evidence; under
//   direction === "our_objection_to_their_evidence"
// (we are objecting to opposing evidence) there is no such objection to respond
// to, so a response is not applicable — hence the strict "iff", enforced in both
// directions.
//
// `validateCrossExaminationOpinion` (schema-only) proves shape; callers compose
// "shape-valid AND invariant-holds", exactly like validateFact + assertValidNewFact.

import type { CaseBoxCrossExaminationOpinion } from "./generated/case-box-cross-examination-opinion.js";

export class CrossExaminationInvariantError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "CrossExaminationInvariantError";
    this.violation = violation;
  }
}

type CrossExaminationInvariantInput = {
  direction: string;
  our_response_short_version?: string | null;
};

const DIRECTION_REQUIRES_RESPONSE = "their_anticipated_objection_to_our_evidence";
const DIRECTION_FORBIDS_RESPONSE = "our_objection_to_their_evidence";

// A response is "present" only if it is a non-whitespace string. null, "", and
// whitespace-only all count as "absent" — a whitespace response is not a
// prepared response.
function hasResponse(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Strict-iff cross-field invariant for CrossExaminationOpinion:
 *   - direction=their_anticipated_objection_to_our_evidence → our_response_short_version
 *     MUST be a non-empty (non-whitespace) string; throws if absent.
 *   - direction=our_objection_to_their_evidence → our_response_short_version MUST be
 *     absent (null/empty/whitespace); throws if a non-empty response is present.
 * Other direction values are out of the invariant's scope (schema enum guards them).
 */
export function assertCrossExaminationOpinionInvariants(
  opinion: CrossExaminationInvariantInput,
): void {
  const present = hasResponse(opinion.our_response_short_version);
  if (opinion.direction === DIRECTION_REQUIRES_RESPONSE && !present) {
    throw new CrossExaminationInvariantError(
      `our_response_short_version must be a non-empty string when direction === ${JSON.stringify(DIRECTION_REQUIRES_RESPONSE)}`,
    );
  }
  if (opinion.direction === DIRECTION_FORBIDS_RESPONSE && present) {
    throw new CrossExaminationInvariantError(
      `our_response_short_version must be null/empty when direction === ${JSON.stringify(DIRECTION_FORBIDS_RESPONSE)} (a prepared response is not applicable when objecting to their evidence)`,
    );
  }
}

// Re-export the type alias for downstream type-narrowing convenience.
export type { CaseBoxCrossExaminationOpinion };
