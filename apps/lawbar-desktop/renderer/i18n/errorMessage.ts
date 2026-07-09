// renderer/i18n/errorMessage.ts — safe zh-CN display message for an IPC error
// envelope (WI-DESKTOP-ZH-CN-ERROR-SURFACES-04).
//
// The main process returns `{ kind, code, message }` where `code` is a STABLE
// English CaseBoxPersistenceErrorCode and `message` is a generic English safe
// string kept for main-side diagnostics/logs. The renderer must NOT display the
// English `message`; it maps the stable `code` to a generic zh-CN safe message
// via the catalog (`error.<code>`), with `error.unknown` as the fallback for any
// unrecognized code. This preserves the safe-message contract — no raw
// err.message, stack, SQL, filesystem path, or identifier reaches the user; only
// the code-keyed generic string does.
//
// `t()` throws on a missing key, so an unknown code is routed to `error.unknown`
// rather than `error.<unknown-code>` (which would not exist).

import { t } from "./t.js";
import type { CatalogId } from "./catalog.js";

// The stable IPC error codes (case-box-persistence CaseBoxPersistenceErrorCode +
// the mapThrownError fallback). Each has an `error.<code>` catalog entry.
// Exported so a contract-sync test can assert it stays in step with the
// persistence CaseBoxPersistenceErrorCode union (a type-only export at runtime)
// and the catalog `error.*` keys — catching drift when a new code is added.
export const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  "duplicate_id",
  "unknown_matter",
  "unknown_document",
  "tenant_mismatch",
  "matter_id_mismatch",
  "illegal_transition",
  "local_only_external_flag_rejected",
  "invalid_payload",
  "invalid_initial_state",
  "invalid_argument",
  "anchor_referenced",
  "not_implemented",
]);

// The renderer error envelope carries at least a `code`; `message` is ignored for
// display (logs only). Accept a minimal shape so every call site can pass its
// `env.error` directly.
export function errorMessage(error: { readonly code?: string }): string {
  const code = error.code;
  if (code !== undefined && KNOWN_ERROR_CODES.has(code)) {
    return t(`error.${code}` as CatalogId);
  }
  return t("error.unknown");
}
