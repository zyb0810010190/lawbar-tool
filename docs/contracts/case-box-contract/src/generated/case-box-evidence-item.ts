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
  created_at: string;
  [k: string]: unknown;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
