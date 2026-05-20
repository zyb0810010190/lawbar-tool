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
    | "privilege-waive";
  /**
   * v1 case-box entity vocabulary. Tightened from free-string to enum in Step 4 (case-box-step-4-audit-log-shape). Future entities require a coordinated schema update + TS CASE_BOX_AUDIT_ENTITY_TYPES update.
   */
  entity_type:
    | "matter"
    | "document"
    | "deadline"
    | "evidence_item"
    | "ocr_link"
    | "fact"
    | "privilege_marker";
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
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
