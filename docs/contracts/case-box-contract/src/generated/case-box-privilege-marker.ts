/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * Privilege marker on a CaseBoxDocument or CaseBoxFact. Single mutable row per marker; status advances proposed → confirmed → waived OR proposed → dismissed. Machine sources (llm_suggested, imported) MUST start as proposed. lawyer_authored MAY start as proposed or confirmed. Unmarked targets (no marker row) are legally undetermined — neither privileged nor cleared-for-disclosure. See docs/adr/case-box-step-3-privilege-marker-model.md.
 */
export type CaseBoxPrivilegeMarker = {
  [k: string]: unknown;
} & {
  id: Ulid;
  tenant_id: string;
  /**
   * Creator. v1 sentinel: "local-user".
   */
  actor_user_id: string;
  matter_id: Ulid;
  /**
   * v1 set. evidence-item / matter / page-range markers are deferred to future evolutions.
   */
  target_type: "document" | "fact";
  /**
   * Opaque ref. Persistence enforces existence and tenant/matter consistency.
   */
  target_id: string;
  /**
   * Legal basis. Required on every row regardless of status (privilege log must reconstruct the basis even from dismissed/waived rows).
   */
  kind: "attorney_client" | "work_product" | "joint_defense" | "common_interest";
  /**
   * Lawyer-authored or extractor-supplied prose explaining the basis. Required non-empty on every row.
   */
  basis_text: string;
  status: "proposed" | "confirmed" | "dismissed" | "waived";
  source_type: "lawyer_authored" | "llm_suggested" | "imported";
  /**
   * Extractor identity for machine sources. Required for llm_suggested + imported. MUST be null for lawyer_authored.
   */
  extractor_name: null | string;
  extractor_version: null | string;
  extraction_confidence: null | number;
  /**
   * Creation timestamp; required NON-NULL on every row. For lawyer-direct-confirmed markers, proposed_at === confirmed_at.
   */
  proposed_at: string;
  /**
   * Set when status reaches confirmed (and persists through waived). MUST be a lawyer; load-bearing for no-auto-privilege.
   */
  confirmed_actor_user_id: null | string;
  confirmed_at: null | string;
  dismissed_actor_user_id: null | string;
  dismissed_at: null | string;
  /**
   * Required non-null when status === dismissed.
   */
  dismissal_reason: null | string;
  waiver_actor_user_id: null | string;
  waived_at: null | string;
  /**
   * Required non-null when status === waived. Legal-trail invariant: waiver MUST cite a reason.
   */
  waiver_reason: null | string;
  created_at: string;
  [k: string]: unknown;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
