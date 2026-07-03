/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * v1-simplified evidence shape: exhibit binding to a matter with optional source document + page range + lawyer weight. The full fact-binding-to-element model is a later case-box step.
 */
export type CaseBoxEvidenceItem = {
  [k: string]: unknown;
} & {
  id: Ulid;
  tenant_id: string;
  actor_user_id: string;
  matter_id: Ulid;
  source_document_id?: null | Ulid;
  exhibit_page_range?: null | string;
  lawyer_weight: "weak" | "moderate" | "strong";
  status: "proposed" | "accepted" | "rejected" | "superseded";
  /**
   * Required when status is "superseded".
   */
  supersedes_evidence_id?: null | Ulid;
  notes?: string;
  /**
   * Lawyer-entered display name for the evidence item (T3 证据名称). Optional; absent on legacy rows. NOT derivable from a document filename. FORMS-T3-S0-SCHEMA-00 §4 Option A.
   */
  evidence_title?: string;
  /**
   * Lawyer-entered proof statement (T3 证明内容). Optional; blank content is expressed by ABSENCE — persistence normalizes whitespace-only input to absent, never stores an empty string. FORMS-T3-S0-SCHEMA-00 §4 Option A.
   */
  proof_statement?: string;
  /**
   * Optional lawyer-controlled catalogue order (absence-only: present or absent, no null). Absent rows sort after ordered rows by created_at ASC, id ASC. FORMS-T3-S0-SCHEMA-00 §4 Option A.
   */
  display_order?: number;
  created_at: string;
  /**
   * Optional marker for which party introduced the evidence. v1 supports §7.A 'evidence list for both parties'. R-5(g).
   */
  party_side?: null | ("our" | "opposing");
  [k: string]: unknown;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
