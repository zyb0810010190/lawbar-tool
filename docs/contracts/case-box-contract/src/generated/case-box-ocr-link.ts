/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * This interface was referenced by `CaseBoxOcrLink`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;

/**
 * Read-only snapshot of an OCR job's state as known to case-box. OCR is a subordinate data feed; case-box never writes to ocr-persistence.
 */
export interface CaseBoxOcrLink {
  document_id: Ulid;
  tenant_id: string;
  actor_user_id: string;
  /**
   * Opaque external reference to ocr-persistence; case-box never FKs.
   */
  ocr_job_id: string;
  /**
   * Contractually enforced. OCR is a subordinate data feed into case-box; case-box never writes back.
   */
  direction: "read-only";
  /**
   * Mirrors OCR job state values. Not cross-$ref'd to avoid schema-build-time coupling.
   */
  status_snapshot:
    | "queued"
    | "claimed"
    | "processing"
    | "succeeded"
    | "failed"
    | "partial_succeeded"
    | "cancelled"
    | "dead_lettered";
  /**
   * When case-box last polled / synced this status from ocr-persistence.
   */
  last_seen_at: string;
  [k: string]: unknown;
}
