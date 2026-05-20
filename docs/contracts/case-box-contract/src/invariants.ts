// Semantic helpers that encode v1 case-box invariants for callers (persistence,
// ingestion, review). Pure functions; no IO, no network, no persistence access.
//
// See docs/adr/case-box-step-0-boundary.md.

/**
 * v1 actor-identity sentinel. Persistence MAY accept this value while the
 * workflow is entirely local on the lawyer's Mac AND no sync bridge / LLM
 * remote call / multi-user phase is enabled. The contract itself does not
 * pin the literal — multi-user shape compatibility requires `actor_user_id`
 * to be a free-form string — so this helper is the only sanctioned check.
 */
export const LOCAL_ONLY_ACTOR_USER_ID = "local-user";

export function isLocalOnlyActor(actor_user_id: string): boolean {
  return actor_user_id === LOCAL_ONLY_ACTOR_USER_ID;
}

/**
 * Shape predicate: a matter is configured for the v1 local-first default iff
 * all three opt-in external flags are false. Flipping any flag to true is a
 * deliberate user action recorded as an audit event by persistence.
 */
export function defaultsAreLocalFirst(matter: {
  external_ocr_authorized?: unknown;
  sync_grant_present?: unknown;
  llm_extraction_opt_in?: unknown;
}): boolean {
  return (
    matter.external_ocr_authorized === false &&
    matter.sync_grant_present === false &&
    matter.llm_extraction_opt_in === false
  );
}

/**
 * True iff `confidentiality_class === "normal"`. The case-box-step-0
 * confidentiality posture allows external workers / sync targets / LLM
 * extractors only for `normal` documents. `heightened` and `sealed` documents
 * cannot be opted in without an additional override (out of v1 scope).
 */
export function classAllowsExternal(confidentiality_class: string): boolean {
  return confidentiality_class === "normal";
}
