/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * Legal document registered to a matter. May reference an OCR job by value (never by FK).
 */
export type CaseBoxDocument = {
  [k: string]: unknown;
} & {
  id: Ulid;
  tenant_id: string;
  actor_user_id: string;
  matter_id: Ulid;
  source: "uploaded" | "produced" | "subpoena" | "court_filing" | "third_party";
  /**
   * Append-only chain of custody entries.
   */
  custody_chain?: {
    actor_user_id: string;
    action?: string;
    at: string;
    notes?: string;
    [k: string]: unknown;
  }[];
  filename: string;
  /**
   * Immutable once OCR submitted. Persistence layer enforces immutability.
   */
  content_hash: string;
  /**
   * Local filesystem path or opaque URI.
   */
  storage_uri: string;
  /**
   * External-Ref to ocr-persistence by value; case-box never FKs to OCR tables.
   */
  ocr_job_id?: null | Ulid;
  /**
   * Canonical OCR submission JSON hash; matches OCR dedupe key.
   */
  submission_hash?: string;
  language?: string;
  page_count?: number;
  doc_type: "pleading" | "contract" | "correspondence" | "transcript" | "exhibit" | "other";
  received_at: string;
  status:
    | "registered"
    | "ocr_pending"
    | "ocr_complete"
    | "ocr_failed"
    | "triaged"
    | "tagged"
    | "reviewed";
  /**
   * Workflow-role classification. Orthogonal to doc_type. Absent = 'other' by convention. R-5(a).
   */
  purpose?:
    | "engagement_contract"
    | "payment_record"
    | "decision_record"
    | "court_procedural"
    | "counsel_contract"
    | "work_order"
    | "lawyer_letter"
    | "contract_review_input"
    | "contract_review_final"
    | "screenshot"
    | "other";
  /**
   * Lifecycle of a work-order document. One-way invariant: if present, purpose MUST be 'work_order'. NOT required when purpose='work_order'. R-5(b).
   */
  work_order_status?: "open" | "in_progress" | "answered" | "closed";
  /**
   * Optional reference to a prior document this one supersedes (e.g. contract_review_final supersedes contract_review_input). Persistence enforces same-matter same-tenant. R-5(d).
   */
  supersedes_document_id?: null | Ulid;
  /**
   * Free-text date descriptor for purpose='lawyer_letter'. Deliberately NOT a typed date — captures whatever the lawyer wrote on the letter. POST-V1: structured date once lifecycle state machine ships. R-5(c).
   */
  letter_date?: string;
  /**
   * Free-text service / delivery status for purpose='lawyer_letter'. R-5(c).
   */
  service_status?: string;
  /**
   * Free-text client authorization summary for purpose='lawyer_letter'. R-5(c).
   */
  client_authorization_summary?: string;
  /**
   * Free-text preliminary evidence summary for purpose='lawyer_letter'. R-5(c).
   */
  preliminary_evidence_summary?: string;
  /**
   * Free-text review date descriptor for purpose='contract_review_*'. Deliberately NOT a typed date. POST-V1: structured date. R-5(c).
   */
  review_date?: string;
  /**
   * Free-text marker on the final-revision document for purpose='contract_review_final'. R-5(c).
   */
  final_version_marker?: string;
  [k: string]: unknown;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
