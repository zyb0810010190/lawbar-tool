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
  // WI-03: the database failed its integrity check on open. Refusal is deliberate — a
  // store that cannot be trusted must never be appended to.
  | "database_corrupt"
  // WI-03: the file is valid SQLite but is not a case-box store. Refusal protects the
  // OTHER database — applySchema would otherwise stamp case-box tables into it.
  | "database_not_case_box"
  | "database_locked"
  | "database_unavailable"
  | "database_empty"
  | "audit_chain_erased"
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
