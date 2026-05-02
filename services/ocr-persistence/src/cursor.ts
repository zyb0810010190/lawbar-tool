// Pagination cursor protocol for cross-job read methods.
//
// Cursors are opaque to callers. Internally they are base64url-encoded JSON:
//
//   { v: 1, kind: "jobs_by_document" | "review_pages",
//     filters_hash: string, last_sort_tuple: unknown[] }
//
// `filters_hash` binds a cursor to the exact filter set that produced it,
// so callers cannot accidentally reuse a cursor against a different query
// (e.g. switching tenant_id mid-pagination would silently skip rows in a
// snapshot-isolated DB; here we reject the cursor outright).
//
// Pagination is seek-based, not snapshot-isolated: rows inserted earlier
// than the cursor's tuple won't appear until the caller re-scans from
// scratch. Documented intentionally.

import { createHash } from "node:crypto";
import { OcrPersistenceError } from "./types.js";

export type OcrCursorKind = "jobs_by_document" | "review_pages";

export interface CursorPayload {
  v: 1;
  kind: OcrCursorKind;
  filters_hash: string;
  last_sort_tuple: unknown[];
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/**
 * Validate a caller-supplied limit. Returns a usable integer in [1, MAX_LIMIT].
 * Throws OcrPersistenceError on any invalid input. Undefined returns DEFAULT_LIMIT.
 */
export function resolveLimit(limit: unknown): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    throw new OcrPersistenceError(`invalid limit: ${String(limit)}`);
  }
  if (!Number.isInteger(limit)) {
    throw new OcrPersistenceError(`invalid limit: ${limit} (not an integer)`);
  }
  if (limit <= 0) {
    throw new OcrPersistenceError(`invalid limit: ${limit} (must be > 0)`);
  }
  if (limit > MAX_LIMIT) {
    throw new OcrPersistenceError(
      `invalid limit: ${limit} (max ${MAX_LIMIT})`,
    );
  }
  return limit;
}

/**
 * Compute a stable hash over a filter object. Keys are sorted; undefined
 * values are dropped before hashing. The output is hex-encoded SHA-256.
 */
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

/**
 * Decode and validate a caller-supplied cursor string. Throws
 * OcrPersistenceError on malformed input, wrong version, wrong kind,
 * or filters_hash mismatch.
 */
export function decodeCursor(
  cursor: string,
  expected: { kind: OcrCursorKind; filters_hash: string },
): CursorPayload {
  if (typeof cursor !== "string" || cursor.length === 0) {
    throw new OcrPersistenceError("malformed cursor: not a non-empty string");
  }
  let json: string;
  try {
    json = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new OcrPersistenceError("malformed cursor: bad base64url");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new OcrPersistenceError("malformed cursor: bad JSON");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new OcrPersistenceError("malformed cursor: not an object");
  }
  const p = parsed as Record<string, unknown>;
  if (p.v !== 1) {
    throw new OcrPersistenceError(
      `malformed cursor: unsupported version ${String(p.v)}`,
    );
  }
  if (p.kind !== "jobs_by_document" && p.kind !== "review_pages") {
    throw new OcrPersistenceError(
      `malformed cursor: invalid kind ${String(p.kind)}`,
    );
  }
  if (p.kind !== expected.kind) {
    throw new OcrPersistenceError(
      `wrong-kind cursor: expected ${expected.kind}, got ${p.kind}`,
    );
  }
  if (typeof p.filters_hash !== "string") {
    throw new OcrPersistenceError("malformed cursor: filters_hash not a string");
  }
  if (p.filters_hash !== expected.filters_hash) {
    throw new OcrPersistenceError(
      "cursor filters_hash does not match current query filters",
    );
  }
  if (!Array.isArray(p.last_sort_tuple)) {
    throw new OcrPersistenceError("malformed cursor: last_sort_tuple not an array");
  }
  return {
    v: 1,
    kind: p.kind,
    filters_hash: p.filters_hash,
    last_sort_tuple: p.last_sort_tuple,
  };
}
