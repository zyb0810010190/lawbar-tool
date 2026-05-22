/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * Case-scoped deadline. Computation engine is post-MVP; v1 carries the shape only.
 */
export type CaseBoxDeadline = {
  [k: string]: unknown;
} & {
  id: Ulid;
  tenant_id: string;
  actor_user_id: string;
  matter_id: Ulid;
  kind:
    | "statute_of_limitations"
    | "court_order"
    | "discovery"
    | "filing"
    | "hearing"
    | "internal"
    | "payment"
    | "evidence_submission"
    | "appeal";
  source_rule_citation?: string;
  due_at: string;
  owner_user_id: string;
  status: "pending" | "met" | "missed" | "withdrawn";
  met_at?: null | string;
  /**
   * Optional record of the prior status. When the current status is met and previous_status was missed, a transition_reason is required.
   */
  previous_status?: "pending" | "met" | "missed" | "withdrawn";
  /**
   * Required when transitioning missed → met. Captured in the same write that flips the status.
   */
  transition_reason?: string;
  [k: string]: unknown;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
