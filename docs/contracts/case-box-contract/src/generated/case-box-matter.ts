/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * Lowercase 26-char ULID. Mirrors ocr-worker-contract's ULID convention.
 *
 * This interface was referenced by `CaseBoxMatter`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;

/**
 * Matter root. v1 local-first; opt-in external flags default false. See docs/adr/case-box-step-0-boundary.md.
 */
export interface CaseBoxMatter {
  id: Ulid;
  /**
   * Retained for forward compatibility; v1 = single tenant.
   */
  tenant_id: string;
  /**
   * v1 sentinel: "local-user" for local-only mode. See isLocalOnlyActor().
   */
  actor_user_id: string;
  name: string;
  jurisdiction: {
    /**
     * Controlled-vocab jurisdiction id.
     */
    value: string;
    /**
     * True once any deadline exists; persistence layer enforces.
     */
    locked: boolean;
    [k: string]: unknown;
  };
  matter_type:
    | "litigation"
    | "arbitration"
    | "advisory"
    | "due_diligence"
    | "criminal_defense"
    | "other";
  /**
   * @minItems 1
   */
  parties: [Party, ...Party[]];
  retainer_scope?: string;
  confidentiality_class: "normal" | "heightened" | "sealed";
  status: "active" | "archived";
  /**
   * Opt-in: per-matter authorization to send documents to external OCR worker. Default false (local OCR only).
   */
  external_ocr_authorized: boolean;
  /**
   * Opt-in: at least one sync grant exists for this matter. Default false (no companion bridge exposure).
   */
  sync_grant_present: boolean;
  /**
   * Opt-in: per-case LLM candidate-fact extraction. Default false (deterministic stub only).
   */
  llm_extraction_opt_in: boolean;
  created_at: string;
  /**
   * Set when status transitions to archived. Reversible per case-box-step-0.
   */
  archived_at?: string;
  /**
   * Optional reference to a successor matter (R-5(h)). Used for counsel→litigation evolution per the matter-type-immutability rule. Persistence enforces same-tenant and successor's matter_type differs from original.
   */
  successor_matter_id?: null | Ulid;
  /**
   * Free-text case-type descriptor. Lawyer-facing only when matter_type = 'litigation'. POST-V1: controlled vocabulary. R-5(j).
   */
  case_type_text?: string;
  /**
   * Free-text current-progress descriptor. Lawyer-facing only when matter_type = 'litigation'. POST-V1: lifecycle state machine. R-5(j).
   */
  case_progress_text?: string;
  /**
   * Free-text court contact info. Lawyer-facing only when matter_type = 'litigation'. POST-V1: structured contact entity. R-5(j).
   */
  court_contact_text?: string;
  /**
   * Free-text summary of parties' main points of contention. Lawyer-facing only when matter_type = 'litigation'. POST-V1: structured sub-entity. R-5(j).
   */
  contention_summary_text?: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `CaseBoxMatter`'s JSON-Schema
 * via the `definition` "party".
 */
export interface Party {
  role: "client" | "opposing" | "third_party";
  display_name: string;
  party_kind: "individual" | "organization" | "government" | "court" | "other";
  notes?: string;
  [k: string]: unknown;
}
