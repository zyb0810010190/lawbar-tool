/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * This interface was referenced by `CaseBoxEvidencePreparation`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;

/**
 * Pre-trial/trial-mode evidence-preparation metadata (frozen spec §2): links an EXISTING evidence record to a claim track for preparation, WITHOUT replacing the evidence model or minting new evidence IDs. Records who submitted the evidence, its purpose, the facts it is meant to prove, how it is used at trial, a minimal page reference, and a review lifecycle. One evidence item may carry preparation records on multiple claim tracks (main claim + counterclaim) — expressed as distinct records sharing evidence_id. This WI (PTA-05) is contract-only: claim_track_id/evidence_id are validated for ULID SHAPE only — referential existence, the (claim_track_id, evidence_id) DB uniqueness, and the submitted_by_side read-time projection from CaseBoxEvidenceItem.party_side are all deferred to later persistence/handler WIs (PTA-08/11).
 */
export interface CaseBoxEvidencePreparation {
  id: Ulid;
  tenant_id: string;
  actor_user_id: string;
  matter_id: Ulid;
  /**
   * The claim track this preparation attaches to. Coarse by-value ULID ref; referential existence against the matter's claim tracks is a later handler preflight, NOT a schema constraint.
   */
  claim_track_id: string;
  /**
   * References an EXISTING CaseBoxEvidenceItem.id (frozen §2: use existing evidence IDs; do not mint new ones). Coarse by-value ULID ref; existence + matter/track membership are later handler preflights, NOT schema constraints.
   */
  evidence_id: string;
  /**
   * Who submitted the evidence. Nullable (frozen §2 / decision #2): authoritative when explicitly set; when null, a read-time projection from CaseBoxEvidenceItem.party_side is applied downstream (persistence/handler) and NEVER written back into the payload. This schema stores the value verbatim including null; it does NOT implement the projection. Required key: null is a valid value but the key must be present.
   */
  submitted_by_side:
    | "our_side"
    | "opposing_side"
    | "third_party"
    | "court_obtained"
    | "unknown"
    | null;
  /**
   * What this evidence is intended to establish. type string; empty string allowed so a record may be created before the purpose is written (key stays present, no null).
   */
  evidence_purpose: string;
  /**
   * The facts this evidence supports, as an array of SHORT strings (frozen §2 / test #7) — never a single prose blob (preserves future Fact-model migration compatibility). Each item is a non-empty string of at most 500 characters. An empty array is allowed (a record may start with no facts).
   */
  facts_to_prove: string[];
  /**
   * How this evidence should be used at trial. type string; empty string allowed.
   */
  trial_use_summary: string;
  /**
   * Optional 1-based page reference into the evidence document. Nullable (null = no reference / unknown); when present it is an integer >= 1, matching the source_page_number precedent (case-box-fact, case-box-docket-entry). Intentionally minimal — NOT a DocumentPage FK, anchor, bounding box, or OCR span.
   */
  key_page: number | null;
  /**
   * Optional free-text note about the key page (nullable string). Intentionally minimal, paired with key_page.
   */
  key_page_note: string | null;
  /**
   * Preparation review lifecycle (frozen §2).
   */
  review_status: "draft" | "in_review" | "confirmed";
  /**
   * Lawyer-controlled display order within the claim track's preparation records.
   */
  sort_order: number;
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}
