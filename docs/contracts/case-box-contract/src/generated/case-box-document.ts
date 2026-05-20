/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * This interface was referenced by `CaseBoxDocument`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;

/**
 * Legal document registered to a matter. May reference an OCR job by value (never by FK).
 */
export interface CaseBoxDocument {
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
  [k: string]: unknown;
}
