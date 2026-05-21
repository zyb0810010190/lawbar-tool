// Pagination cursor protocol for case-box-persistence cross-entity reads.
//
// LOCAL COPY of services/ocr-persistence/src/cursor.ts adapted for the
// case-box kinds (`documents_by_matter`, `audit_events_by_matter`). Do
// not re-import; future shared extraction may move this to a
// contract-level helper. Errors map to typed CaseBoxPersistenceError
// codes per A1 §1.1 and §6.1 conformance:
//   - malformed / wrong-version / wrong-kind / filters-hash mismatch
//     all throw `code: "invalid_argument"`.

import { createHash } from "node:crypto";
import { CaseBoxPersistenceError } from "./errors.js";

export type CaseBoxCursorKind = "documents_by_matter" | "audit_events_by_matter";

export interface CursorPayload {
  v: 1;
  kind: CaseBoxCursorKind;
  filters_hash: string;
  last_sort_tuple: unknown[];
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function resolveLimit(limit: unknown): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    throw new CaseBoxPersistenceError("invalid_argument", `invalid limit: ${String(limit)}`);
  }
  if (!Number.isInteger(limit)) {
    throw new CaseBoxPersistenceError("invalid_argument", `invalid limit: ${limit} (not an integer)`);
  }
  if (limit <= 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `invalid limit: ${limit} (must be > 0)`);
  }
  if (limit > MAX_LIMIT) {
    throw new CaseBoxPersistenceError("invalid_argument", `invalid limit: ${limit} (max ${MAX_LIMIT})`);
  }
  return limit;
}

export function computeFiltersHash(filters: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(filters).sort()) {
    const v = filters[k];
    if (v === undefined) continue;
    normalized[k] = v;
  }
  const json = JSON.stringify(normalized);
  return createHash("sha256").update(json).digest("hex");
}

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(
  cursor: string,
  expected: { kind: CaseBoxCursorKind; filters_hash: string },
): CursorPayload {
  if (typeof cursor !== "string" || cursor.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", "malformed cursor: not a non-empty string");
  }
  let json: string;
  try {
    json = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new CaseBoxPersistenceError("invalid_argument", "malformed cursor: bad base64url");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CaseBoxPersistenceError("invalid_argument", "malformed cursor: bad JSON");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new CaseBoxPersistenceError("invalid_argument", "malformed cursor: not an object");
  }
  const p = parsed as Record<string, unknown>;
  if (p.v !== 1) {
    throw new CaseBoxPersistenceError("invalid_argument", `malformed cursor: unsupported version ${String(p.v)}`);
  }
  if (p.kind !== "documents_by_matter" && p.kind !== "audit_events_by_matter") {
    throw new CaseBoxPersistenceError("invalid_argument", `malformed cursor: invalid kind ${String(p.kind)}`);
  }
  if (p.kind !== expected.kind) {
    throw new CaseBoxPersistenceError("invalid_argument", `wrong-kind cursor: expected ${expected.kind}, got ${p.kind}`);
  }
  if (typeof p.filters_hash !== "string") {
    throw new CaseBoxPersistenceError("invalid_argument", "malformed cursor: filters_hash not a string");
  }
  if (p.filters_hash !== expected.filters_hash) {
    throw new CaseBoxPersistenceError("invalid_argument", "cursor filters_hash does not match current query filters");
  }
  if (!Array.isArray(p.last_sort_tuple)) {
    throw new CaseBoxPersistenceError("invalid_argument", "malformed cursor: last_sort_tuple not an array");
  }
  // Per-kind tuple shape (audit Dim 4 #1): documents → [received_at:string, id:string];
  // audit_events → [sequence:integer]. Reject malformed tuples so they cannot
  // silently return empty pages or skip valid rows.
  if (p.kind === "documents_by_matter") {
    if (
      p.last_sort_tuple.length !== 2 ||
      typeof p.last_sort_tuple[0] !== "string" ||
      typeof p.last_sort_tuple[1] !== "string"
    ) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `malformed cursor: documents_by_matter requires last_sort_tuple [received_at:string, id:string]`,
      );
    }
  } else if (p.kind === "audit_events_by_matter") {
    if (
      p.last_sort_tuple.length !== 1 ||
      typeof p.last_sort_tuple[0] !== "number" ||
      !Number.isFinite(p.last_sort_tuple[0]) ||
      !Number.isInteger(p.last_sort_tuple[0])
    ) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `malformed cursor: audit_events_by_matter requires last_sort_tuple [sequence:integer]`,
      );
    }
  }
  return {
    v: 1,
    kind: p.kind,
    filters_hash: p.filters_hash,
    last_sort_tuple: p.last_sort_tuple,
  };
}
