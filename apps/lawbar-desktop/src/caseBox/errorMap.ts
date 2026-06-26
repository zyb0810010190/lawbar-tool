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
  invalid_payload: "invalid payload",
  invalid_initial_state: "invalid initial state",
  invalid_argument: "invalid argument",
  anchor_referenced: "anchor is referenced",
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
