import { CaseBoxPersistenceError } from "case-box-persistence";
import type { CaseBoxPersistenceErrorCode } from "case-box-persistence";

import type { IpcErrorEnvelope } from "./dto.js";

const KIND = "case_box_persistence_error" as const;

// Safe static message allowlist per contract §7. The renderer NEVER sees
// `CaseBoxPersistenceError.message` raw — only the generic string for the
// matching code. Raw `err.message` (which may carry identifiers, tenant
// values, SQL parameter values, etc.) is logged main-side via console.error
// in mapThrownError below.
const SAFE_MESSAGES: Record<CaseBoxPersistenceErrorCode, string> = {
  duplicate_id: "duplicate identifier",
  unknown_matter: "unknown matter",
  unknown_document: "unknown document",
  tenant_mismatch: "tenant mismatch",
  matter_id_mismatch: "matter id mismatch",
  illegal_transition: "illegal state transition",
  local_only_external_flag_rejected: "local-only mode rejects external opt-in",
  // WI-03. Deliberately generic: the raw messages carry the database PATH (which contains
  // the macOS username) and, for a foreign file, its table names. Neither may reach the
  // renderer — that is what this allowlist exists for. The detail is logged main-side.
  database_corrupt: "the case file failed its integrity check and was not opened",
  database_not_case_box: "that file is not a lawbar case file",
  database_locked: "the case file is open elsewhere; close the other window and retry",
  database_unavailable: "the case file could not be opened",
  database_empty: "the case file is empty — it may have been truncated",
  audit_chain_erased: "the audit history for this matter appears to have been deleted",
  invalid_payload: "invalid payload",
  invalid_initial_state: "invalid initial state",
  invalid_argument: "invalid argument",
  anchor_referenced: "anchor is referenced",
  audit_chain_desync: "audit chain desync",
  unknown_party: "unknown party",
  matter_archived: "该案件已归档，需先取消归档再编辑。",
  no_editable_change: "没有需要保存的修改。",
  not_implemented: "operation not implemented",
};

export function safeMessageFor(code: CaseBoxPersistenceErrorCode): string {
  return SAFE_MESSAGES[code];
}

export function makeInvalidPayload(
  message: string,
  details?: { schemaPath?: string; keyword?: string },
): IpcErrorEnvelope {
  return details === undefined
    ? { kind: KIND, code: "invalid_payload", message }
    : { kind: KIND, code: "invalid_payload", message, details };
}

export function makeBoundaryError(
  code: CaseBoxPersistenceErrorCode,
): IpcErrorEnvelope {
  return { kind: KIND, code, message: SAFE_MESSAGES[code] };
}

export function mapThrownError(
  err: unknown,
  context: { channel: string },
): IpcErrorEnvelope {
  if (err instanceof CaseBoxPersistenceError) {
    // Always log main-side so the diagnostic detail (identifiers, sql
    // parameter values, tenant mismatch specifics) is captured in the
    // audit trail. Renderer sees only the static safe message per code.
    console.error(`[casebox-ipc-handler:${context.channel}] ${err.code}:`, err.message);
    return { kind: KIND, code: err.code, message: SAFE_MESSAGES[err.code] };
  }
  console.error(`[casebox-ipc-handler:${context.channel}]`, err);
  return {
    kind: KIND,
    code: "not_implemented",
    message: "internal error (see main log)",
  };
}
