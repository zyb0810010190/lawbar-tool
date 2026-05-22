/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * Docket-entry proposal companion to CaseBoxDeadline. Carries provenance + confirmation lifecycle + authoritative date-only/timezone semantics. CaseBoxDeadline (Step 1) becomes a materialized-view projection; the docket entry is the authoritative source for legal date semantics. ALL entries start as proposed; lawyer must explicitly confirm or dismiss. date_only confirmation is FORBIDDEN in v1 (no jurisdiction/timezone resolver). See docs/adr/case-box-step-6-deadline-docketing-rules.md.
 */
export type CaseBoxDocketEntry = {
  [k: string]: unknown;
} & {
  id: Ulid;
  tenant_id: string;
  /**
   * Proposer.
   */
  actor_user_id: string;
  matter_id: Ulid;
  source_type: "manual" | "court_order_excerpt" | "llm_extraction" | "imported";
  proposed_kind:
    | "statute_of_limitations"
    | "court_order"
    | "discovery"
    | "filing"
    | "hearing"
    | "internal"
    | "payment"
    | "evidence_submission"
    | "appeal";
  proposed_due_at: string;
  proposed_due_at_kind: "datetime" | "date_only";
  /**
   * IANA timezone (semantic IANA validity enforced by assertValidIanaTimezone TS helper). Required non-null when proposed_due_at_kind === datetime (D7).
   */
  proposed_due_at_timezone: null | string;
  proposed_owner_user_id: string;
  source_rule_citation: null | string;
  /**
   * Required for llm_extraction (D2) + imported (D3). MUST be null for manual (D1).
   */
  extractor_name: null | string;
  extractor_version: null | string;
  extraction_confidence: null | number;
  /**
   * Required for court_order_excerpt (D4).
   */
  source_document_id: null | Ulid;
  source_page_number: null | number;
  source_excerpt: null | string;
  /**
   * v1 shape-only; no notification execution.
   */
  reminder_offsets:
    | null
    | {
        /**
         * Days BEFORE the due date. Non-negative; after-due-date semantics deferred.
         */
        offset_days: number;
        kind: "advance_notice" | "final_notice";
      }[];
  confirmation_state: "proposed" | "confirmed" | "dismissed";
  proposed_at: string;
  confirmation_actor_user_id: null | string;
  confirmed_at: null | string;
  confirmed_deadline_id: null | Ulid;
  dismissal_actor_user_id: null | string;
  dismissed_at: null | string;
  dismissal_reason: null | string;
  created_at: string;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
