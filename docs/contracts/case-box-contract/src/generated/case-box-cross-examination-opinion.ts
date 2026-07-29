/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * This interface was referenced by `CaseBoxCrossExaminationOpinion`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
/**
 * This interface was referenced by `CaseBoxCrossExaminationOpinion`'s JSON-Schema
 * via the `definition` "dimensionStatus".
 */
export type DimensionStatus = "admitted" | "denied" | "conditional" | "reserved" | "not_applicable";

/**
 * Pre-trial/trial-mode cross-examination opinion (frozen spec §3): a lawyer's structured cross-examination position on one EXISTING evidence item within one claim track, in one of two directions — our_objection_to_their_evidence (we object to opposing evidence) or their_anticipated_objection_to_our_evidence (their anticipated objection to our evidence PLUS our prepared response). Captures the four courtroom dimensions (authenticity, legality, relevance, probative-force) each as a structured status + free-text reason, an overall opinion, a courtroom-ready short version, and (direction-2 only) our short response, under a preparation lifecycle. The cross-field rule 'our_response_short_version required iff direction=their_anticipated_objection_to_our_evidence' is enforced by a SEPARATE TS helper (src/cross-exam-invariants.ts, assertCrossExaminationOpinionInvariants), NOT by this schema — the schema stays flat (no if/then), mirroring the fact-invariants.ts precedent. This WI (PTA-06) is contract-only: claim_track_id/evidence_id are ULID SHAPE refs; referential existence, the (claim_track_id, evidence_id, direction) DB uniqueness, and audit emission are deferred to later WIs (PTA-09/11). No rebuttal_evidence_ids (rebuttal is a LegalOpinionCard concern, PTA-07); no authored_by_side (direction is the only side-expression).
 */
export interface CaseBoxCrossExaminationOpinion {
  id: Ulid;
  tenant_id: string;
  actor_user_id: string;
  matter_id: Ulid;
  /**
   * The claim track this opinion attaches to. Coarse by-value ULID ref; referential existence is a later handler preflight, NOT a schema constraint.
   */
  claim_track_id: string;
  /**
   * References an EXISTING CaseBoxEvidenceItem.id. Coarse by-value ULID ref; existence + matter/track membership are later handler preflights, NOT schema constraints.
   */
  evidence_id: string;
  /**
   * The cross-examination direction (frozen §3). our_objection_to_their_evidence: we object to opposing evidence. their_anticipated_objection_to_our_evidence: their anticipated objection to our evidence, for which our_response_short_version is required (enforced by the TS invariant). Frozen §3 forbids an ambiguous authored_by_side field — direction is the only side-expression.
   */
  direction: "our_objection_to_their_evidence" | "their_anticipated_objection_to_our_evidence";
  /**
   * Authenticity dimension status.
   */
  authenticity_status: "admitted" | "denied" | "conditional" | "reserved" | "not_applicable";
  /**
   * Authenticity reasoning. type string; empty string allowed (required key).
   */
  authenticity_reason: string;
  /**
   * Legality dimension status.
   */
  legality_status: "admitted" | "denied" | "conditional" | "reserved" | "not_applicable";
  /**
   * Legality reasoning. type string; empty string allowed.
   */
  legality_reason: string;
  /**
   * Relevance dimension status.
   */
  relevance_status: "admitted" | "denied" | "conditional" | "reserved" | "not_applicable";
  /**
   * Relevance reasoning. type string; empty string allowed.
   */
  relevance_reason: string;
  /**
   * Probative-force / evidentiary-purpose dimension status.
   */
  probative_force_status: "admitted" | "denied" | "conditional" | "reserved" | "not_applicable";
  /**
   * Probative-force reasoning. type string; empty string allowed.
   */
  probative_force_reason: string;
  /**
   * Overall cross-examination opinion. type string; empty string allowed (required key).
   */
  overall_opinion: string;
  /**
   * Courtroom-ready short version of the opinion. type string; empty string allowed.
   */
  courtroom_short_version: string;
  /**
   * Our prepared short response to their anticipated objection against OUR evidence. Nullable (required key). CROSS-FIELD RULE (enforced by src/cross-exam-invariants.ts, NOT this schema): MUST be a non-empty string when direction=their_anticipated_objection_to_our_evidence, and MUST be null/empty otherwise (strict iff). Not applicable when we are objecting to their evidence.
   */
  our_response_short_version: string | null;
  /**
   * Preparation lifecycle (frozen §3; shared enum with LegalOpinionCard).
   */
  preparation_status: "draft" | "review_needed" | "ready_for_trial";
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}
