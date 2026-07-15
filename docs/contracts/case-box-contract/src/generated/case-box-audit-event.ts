/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * Append-only audit event with hash-chain shape. Chain integrity (replay-tamper-detection) is enforced by case-box-persistence; the contract carries the SHAPE only.
 */
export type CaseBoxAuditEvent = {
  [k: string]: unknown;
} & {
  id: Ulid;
  tenant_id: string;
  actor_user_id: string;
  matter_id: Ulid;
  action:
    | "create"
    | "update"
    | "delete-soft"
    | "access"
    | "export"
    | "print"
    | "share"
    | "privilege-waive"
    | "delete-hard";
  /**
   * v1 case-box entity vocabulary. Tightened from free-string to enum in Step 4. Extended in Step 5 (confidentiality_classification), Step 6 (docket_entry), and WI-A3-UNLINK-AUDIT-KINDS (link — the A3 evidence anchor/link, for unlink/relink audit). Future entities require a coordinated schema update + TS CASE_BOX_AUDIT_ENTITY_TYPES update.
   */
  entity_type:
    | "matter"
    | "document"
    | "deadline"
    | "evidence_item"
    | "ocr_link"
    | "fact"
    | "privilege_marker"
    | "confidentiality_classification"
    | "docket_entry"
    | "link"
    | "claim_track"
    | "evidence_preparation"
    | "cross_examination_opinion"
    | "legal_opinion_card";
  entity_id: Ulid;
  /**
   * Null on create; non-null otherwise.
   */
  before_state_hash?: null | string;
  /**
   * sha256 of canonicalized post-state.
   */
  after_state_hash: string;
  /**
   * Null only on the first audit event for a matter. Non-null otherwise.
   */
  prev_event_hash?: null | string;
  timestamp: string;
  /**
   * Required when action is "privilege-waive". Optional otherwise.
   */
  reason?: string;
  /**
   * v2 normalized audit-event kind (ADR audit-event-kind-preservation) — a CASE_BOX_AUDIT_EVENT_KINDS key. Present iff audit_schema_version is present (v2 events); absent on legacy v1 events. Hashed in the v2 canonicalization. The chain verifier (verifyAuditChain) additionally enforces that the kind's declared {action, entity_type, reasonRequired} matches the event.
   */
  event_kind?:
    | "MATTER_REGISTERED"
    | "MATTER_ARCHIVED"
    | "MATTER_UNARCHIVED"
    | "DOCUMENT_REGISTERED"
    | "DOCUMENT_OCR_SUBMITTED"
    | "DOCUMENT_OCR_COMPLETE"
    | "DOCUMENT_OCR_FAILED"
    | "DOCUMENT_TRIAGED"
    | "DOCUMENT_TAGGED"
    | "DOCUMENT_REVIEWED"
    | "DOCUMENT_SOFT_DELETED"
    | "OCR_LINK_SNAPSHOTTED"
    | "OCR_LINK_REFRESHED"
    | "DEADLINE_REGISTERED"
    | "DEADLINE_MET"
    | "DEADLINE_MISSED"
    | "DEADLINE_WITHDRAWN"
    | "DEADLINE_MISSED_TO_MET"
    | "EVIDENCE_PROPOSED"
    | "EVIDENCE_ACCEPTED"
    | "EVIDENCE_REJECTED"
    | "EVIDENCE_SUPERSEDED"
    | "FACT_PROPOSED"
    | "FACT_REVIEWED"
    | "FACT_ACCEPTED"
    | "FACT_REJECTED"
    | "FACT_REPLACEMENT_ACCEPTED"
    | "PRIVILEGE_MARKER_PROPOSED"
    | "PRIVILEGE_MARKER_CONFIRMED"
    | "PRIVILEGE_MARKER_DISMISSED"
    | "PRIVILEGE_MARKER_WAIVED"
    | "EXTERNAL_OCR_AUTHORIZED"
    | "EXTERNAL_OCR_REVOKED"
    | "SYNC_GRANT_GRANTED"
    | "SYNC_GRANT_REVOKED"
    | "LLM_EXTRACTION_OPT_IN"
    | "LLM_EXTRACTION_OPT_OUT"
    | "PRIVILEGE_LOG_EXPORTED"
    | "CASE_DATA_EXPORTED"
    | "DOCUMENT_ACCESSED"
    | "DOCUMENT_PRINTED"
    | "DOCUMENT_SHARED"
    | "CLASSIFICATION_SET"
    | "CLASSIFICATION_UPGRADED"
    | "CLASSIFICATION_DOWNGRADED"
    | "CLASSIFICATION_RESET_TO_UNCLASSIFIED"
    | "DOCKET_ENTRY_PROPOSED"
    | "DOCKET_ENTRY_CONFIRMED"
    | "DOCKET_ENTRY_DISMISSED"
    | "DOCKET_ENTRY_REVISED"
    | "LINK_UNLINKED"
    | "LINK_RELINKED"
    | "LINK_CREATED"
    | "CLAIM_TRACK_CREATED"
    | "CLAIM_TRACK_UPDATED"
    | "CLAIM_TRACK_WITHDRAWN"
    | "CLAIM_TRACK_RESOLVED"
    | "CLAIM_TRACK_DELETED"
    | "EVIDENCE_PREPARATION_CREATED"
    | "EVIDENCE_PREPARATION_UPDATED"
    | "EVIDENCE_PREPARATION_DELETED"
    | "CROSS_EXAM_OPINION_CREATED"
    | "CROSS_EXAM_OPINION_UPDATED"
    | "CROSS_EXAM_OPINION_DELETED"
    | "LEGAL_OPINION_CARD_CREATED"
    | "LEGAL_OPINION_CARD_UPDATED"
    | "LEGAL_OPINION_CARD_DELETED"
    | "LEGAL_OPINION_CARD_USED_IN_TRIAL_SET"
    | "LEGAL_OPINION_CARD_USED_IN_TRIAL_CLEARED"
    | "LEGAL_OPINION_CARD_FOLLOW_UP_SET"
    | "LEGAL_OPINION_CARD_FOLLOW_UP_CLEARED";
  /**
   * Audit-event canonicalization version. v2 events set this to 2 (the value is hashed in the v2 canonicalization); absent on legacy v1 events. Present iff event_kind is present.
   */
  audit_schema_version?: 2;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
