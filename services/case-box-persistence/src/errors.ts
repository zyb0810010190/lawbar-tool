// Typed persistence error for case-box-persistence (Phase A1).
//
// Unlike the OCR persistence sibling (which carries only a message), this
// class carries a REQUIRED `code` discriminator. Conformance asserts on
// `code` rather than message substring per the A1 reviewed plan.

export type CaseBoxPersistenceErrorCode =
  | "duplicate_id"
  | "unknown_matter"
  | "unknown_document"
  | "tenant_mismatch"
  | "matter_id_mismatch"
  | "illegal_transition"
  | "local_only_external_flag_rejected"
  | "invalid_payload"
  | "invalid_initial_state"
  | "invalid_argument"
  | "anchor_referenced"
  | "audit_chain_desync"
  | "unknown_party"
  // matter-details-edit Phase B (additive; no existing code renamed/removed):
  //   matter_archived    — an edit was attempted on a non-active (archived) matter.
  //   no_editable_change — a details patch left every editable field unchanged
  //                        after canonicalization (no-op → no audit spam).
  | "matter_archived"
  | "no_editable_change"
  | "not_implemented";

export class CaseBoxPersistenceError extends Error {
  readonly code: CaseBoxPersistenceErrorCode;
  constructor(code: CaseBoxPersistenceErrorCode, message: string) {
    super(message);
    this.name = "CaseBoxPersistenceError";
    this.code = code;
  }
}
