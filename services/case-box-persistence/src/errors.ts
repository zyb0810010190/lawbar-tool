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
  | "not_implemented";

export class CaseBoxPersistenceError extends Error {
  readonly code: CaseBoxPersistenceErrorCode;
  constructor(code: CaseBoxPersistenceErrorCode, message: string) {
    super(message);
    this.name = "CaseBoxPersistenceError";
    this.code = code;
  }
}
