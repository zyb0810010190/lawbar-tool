// Shared primitives for the case-box IPC handlers. Extracted mechanically from
// handlers.ts (no behavior change) so each entity's handlers live in their own
// sibling module and handlers.ts stays a thin barrel under the loc-guardian
// limit. CHANNEL, the provider/clock types, and the payload-shape guards are
// used by every handler module.

import type {
  CaseBoxPersistence,
  SqliteCaseBoxPersistence,
  OpenSqliteCaseBoxPersistenceResult,
} from "case-box-persistence";

import { makeInvalidPayload } from "./errorMap.js";
import type { IpcEnvelope } from "./dto.js";

// The raw better-sqlite3 Database handle, sourced through the persistence
// package's already-typed surface (OpenSqliteCaseBoxPersistenceResult.db) rather
// than a direct `better-sqlite3` import — the desktop app does not ship
// @types/better-sqlite3 and adding a dependency is out of scope for this WI.
type Database = OpenSqliteCaseBoxPersistenceResult["db"];

export const CHANNEL = {
  matterCreate: "casebox:matter:create",
  matterGet: "casebox:matter:get",
  matterList: "casebox:matter:list",
  matterArchive: "casebox:matter:archive",
  auditChainHead: "casebox:audit:chainHead",
  auditListEvents: "casebox:audit:listEvents",
  documentList: "casebox:document:list",
  documentGet: "casebox:document:get",
  documentRegister: "casebox:document:register",
  deadlineList: "casebox:deadline:list",
  deadlineTransition: "casebox:deadline:transition",
  docketCreate: "casebox:docket:create",
  docketConfirm: "casebox:docket:confirm",
  docketList: "casebox:docket:list",
  docketDismiss: "casebox:docket:dismiss",
  docketEdit: "casebox:docket:edit",
  factList: "casebox:fact:list",
  factCreate: "casebox:fact:create",
  factTransition: "casebox:fact:transition",
  linkCreate: "casebox:link:create",
  linkUnlink: "casebox:link:unlink",
  linkRelink: "casebox:link:relink",
  linkList: "casebox:link:list",
  linkExport: "casebox:link:export",
} as const;

export type PersistenceProvider = () => { readonly persistence: CaseBoxPersistence };
export type ClockFn = () => Date;

// The Evidence link lifecycle is SQLite-only: the concrete
// SqliteCaseBoxPersistence methods (createLink / unlinkLink / relinkLink) plus
// the standalone resolveLinkStatuses / buildExportCitations which read the raw
// Database. The link provider therefore surfaces BOTH the concrete persistence
// and the raw better-sqlite3 handle (the InMemory fallback has no link support).
export type LinkPersistenceProvider = () => {
  readonly persistence: SqliteCaseBoxPersistence;
  readonly db: Database;
};

export function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint" || typeof v === "undefined") {
      return false;
    }
    if (v instanceof Date || v instanceof Map || v instanceof Set) return false;
  }
  return true;
}

export function shapeGuardFailure<T>(): IpcEnvelope<T> {
  return {
    ok: false,
    error: makeInvalidPayload("DTO must be a plain JSON-shaped object"),
  };
}

export function forbiddenFieldFailure<T>(field: string): IpcEnvelope<T> {
  return {
    ok: false,
    error: makeInvalidPayload("DTO contains a server-authority field", { schemaPath: field }),
  };
}

// Response-projection helpers (FACTS-AUD-3). Persistence rows carry
// server-authority identity fields that must not cross the IPC boundary:
// tenant_id + actor_user_id on every entity, plus reviewer_actor_user_id
// (facts) and custody_chain (documents — the append-only actor audit trail).
// These are exactly the fields the per-entity *_RESPONSE_FIELDS allowlists
// EXCLUDE. (Document storage/provenance metadata — content_hash / storage_uri /
// ocr_job_id / submission_hash — is NOT actor identity and is intentionally
// retained, because the document detail view reads it.)
// `renderer/api.ts` only strips outgoing REQUEST DTOs, not responses, so the
// list handlers MUST project every row through a renderer-safe allowlist in the
// main process BEFORE returning. Projection lives here (not in persistence) so
// the source of truth keeps the full entity.

// Returns a new object containing only the allowlisted keys present on `row`.
// Keys absent from `row` are skipped (no `undefined` holes are introduced).
export function projectRow<Out extends object>(
  row: Record<string, unknown>,
  allow: ReadonlyArray<string>,
): Out {
  const out: Record<string, unknown> = {};
  for (const k of allow) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      out[k] = row[k];
    }
  }
  return out as Out;
}

// Projects every row of a `{ rows, next_cursor }` page through the allowlist,
// preserving `next_cursor` unchanged.
export function projectPage<Row extends object>(
  page: { readonly rows: ReadonlyArray<Record<string, unknown>>; readonly next_cursor: string | null },
  allow: ReadonlyArray<string>,
): { readonly rows: ReadonlyArray<Row>; readonly next_cursor: string | null } {
  return {
    rows: page.rows.map((r) => projectRow<Row>(r, allow)),
    next_cursor: page.next_cursor,
  };
}
