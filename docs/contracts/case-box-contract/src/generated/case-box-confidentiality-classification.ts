/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * Per-target confidentiality classification. Append-only history; latest row by set_at (id tiebreak) = current effective level. Targets are document or fact ONLY in v1; matter-level confidentiality lives on the Step-1 matter row. See docs/adr/case-box-step-5-confidentiality-classification.md.
 */
export type CaseBoxConfidentialityClassification = {
  [k: string]: unknown;
} & {
  id: Ulid;
  tenant_id: string;
  /**
   * Classifying lawyer.
   */
  actor_user_id: string;
  matter_id: Ulid;
  /**
   * v1 targets. Matter-level classification lives on CaseBoxMatter.confidentiality_class (Step 1), not here.
   */
  target_type: "document" | "fact";
  target_id: Ulid;
  /**
   * Per-item level. unclassified is the legal default (outside the ordinal lattice; operationally most restrictive).
   */
  level: "unclassified" | "normal" | "confidential" | "highly_confidential" | "restricted";
  /**
   * Null only on the first row for this (target_type, target_id). Persistence enforces cross-row consistency.
   */
  prior_level:
    | null
    | ("unclassified" | "normal" | "confidential" | "highly_confidential" | "restricted");
  /**
   * Reason taxonomy. Required non-null for downgrades and resets-to-unclassified (enforced by assertValidConfidentialityTransition validator helper, not by schema).
   */
  change_reason_code:
    | null
    | (
        | "discovery_production"
        | "client_authorization"
        | "court_order"
        | "change_in_legal_assessment"
        | "data_minimization"
        | "reset_to_unset"
        | "other"
      );
  /**
   * Free-text reason. Required when change_reason_code === "other".
   */
  change_reason_text: null | string;
  set_at: string;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
