// Shared primitives for the case-box IPC handlers. Extracted mechanically from
// handlers.ts (no behavior change) so each entity's handlers live in their own
// sibling module and handlers.ts stays a thin barrel under the loc-guardian
// limit. CHANNEL, the provider/clock types, and the payload-shape guards are
// used by every handler module.

import type { CaseBoxPersistence } from "case-box-persistence";

import { makeInvalidPayload } from "./errorMap.js";
import type { IpcEnvelope } from "./dto.js";

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
  factList: "casebox:fact:list",
} as const;

export type PersistenceProvider = () => { readonly persistence: CaseBoxPersistence };
export type ClockFn = () => Date;

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
