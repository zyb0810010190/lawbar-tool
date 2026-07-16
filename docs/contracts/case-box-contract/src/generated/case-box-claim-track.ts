/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * This interface was referenced by `CaseBoxClaimTrack`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;

/**
 * Pre-trial/trial-mode claim track (frozen spec §1): the reasoning spine for one claim — a main claim OR a counterclaim. Records who is claimant/respondent and whether OUR side is asserting or responding (the our_role abstraction that supports all four plaintiff/defendant × asserting/responding scenarios A-D without hardcoded workflows). A matter may carry one main_claim plus one or more counterclaim tracks; this schema imposes no maximum-counterclaim constraint. Anchor/link, evidence-preparation, cross-examination and legal-opinion-card models attach to a claim track in later WIs (PTA-05+). This WI is contract-only: no persistence, IPC, renderer, or referential (party-in-matter) validation.
 */
export interface CaseBoxClaimTrack {
  id: Ulid;
  tenant_id: string;
  actor_user_id: string;
  matter_id: Ulid;
  /**
   * Whether this track is the matter's main claim or a counterclaim. A matter may hold one main_claim and any number of counterclaim tracks (no schema-level maximum).
   */
  track_type: "main_claim" | "counterclaim";
  /**
   * The party asserting this claim (references a party ULID; referential existence against the matter's parties is a later handler preflight, NOT a schema constraint).
   */
  claimant_party_id: string;
  /**
   * The party defending this claim (references a party ULID; referential existence is a later handler preflight, NOT a schema constraint).
   */
  respondent_party_id: string;
  /**
   * Whether OUR client's side is asserting (claimant) or responding (respondent) on this track. Independent of plaintiff/defendant: all four track_type × our_role combinations are valid (scenarios A-D).
   */
  our_role: "asserting" | "responding";
  /**
   * Lawyer-entered display name for the claim track. Non-empty.
   */
  title: string;
  /**
   * The claim as stated. type string; empty string allowed so a responding track can leave this empty while the key stays present (no null, no cross-field invariant).
   */
  claim_summary: string;
  /**
   * The response/defense as stated. type string; empty string allowed so an asserting track can leave this empty while the key stays present (no null, no cross-field invariant).
   */
  response_summary: string;
  /**
   * The legal basis for the claim/response. type string; empty string allowed.
   */
  legal_basis: string;
  /**
   * Damages/relief calculation summary. type string; empty string allowed.
   */
  calculation_summary: string;
  /**
   * Lifecycle status of the claim track.
   */
  status: "active" | "withdrawn" | "resolved";
  /**
   * Lawyer-controlled display order within the matter's claim tracks.
   */
  sort_order: number;
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}
