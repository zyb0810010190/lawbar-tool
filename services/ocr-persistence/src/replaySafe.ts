// Replay-safe helpers shared by InMemoryOcrPersistence and
// SqliteOcrPersistence (Step 10A).
//
// Both implementations expose two replay-safe methods alongside the strict
// ones:
//
//   - `appendOcrStatusOnce(jobId, transition)` — idempotent transition append
//   - `saveOcrResultOnce(jobId, result)`       — idempotent result write
//
// Strict methods (`appendOcrStatus`, `saveOcrResult`) keep their existing
// semantics: they reject any duplicate, even an exact one. Strict is right
// for the normal single-pass write path (ingestion + first-time outcome
// persistence).
//
// Replay-safe methods exist for the "at-least-once queue redelivery"
// boundary: a job can be persisted, then the queue ack can fail, and the
// queue can redeliver — replaying the *exact* same outcome must be a no-op,
// while a *conflicting* replay must still be rejected so the operator can
// see the divergence.
//
// Equality model
// --------------
// Two values are "exactly equal" iff their canonical JSON serializations
// match. Canonical JSON sorts object keys lexicographically so that
// `{a:1,b:2}` and `{b:2,a:1}` compare equal. Persistence-only metadata
// (`seq`, `persisted_at`) is NOT part of the equality check — those are
// store-assigned and would otherwise make every replay look "conflicting".

import type { TransitionRecord } from "ocr-worker-contract";

/**
 * Stable, key-sorted JSON serialization. Two values compare equal iff
 * their `canonicalJSON()` strings are identical.
 *
 * Notes:
 *   - `undefined` values inside objects are dropped (matching JSON.stringify).
 *   - Arrays preserve order — array equality is positional.
 *   - Non-finite numbers (NaN/Infinity) serialize as `null`, matching JSON.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k]))
      .join(",") +
    "}"
  );
}

/** True iff `a` and `b` produce identical canonical JSON. */
export function deepEquals(a: unknown, b: unknown): boolean {
  return canonicalJSON(a) === canonicalJSON(b);
}

/**
 * Strip persistence-only metadata from a stored transition before comparing
 * against an incoming `TransitionRecord`. The contract `TransitionRecord`
 * does not carry `seq` or `persisted_at`; stored events do. We compare the
 * transition payload only.
 */
export function stripStatusMeta(t: TransitionRecord & {
  seq?: number;
  persisted_at?: string;
}): TransitionRecord {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) {
    if (k === "seq" || k === "persisted_at") continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as unknown as TransitionRecord;
}

/**
 * True iff `incoming` is canonically-equal to `stored`'s transition payload.
 * Used by `appendOcrStatusOnce` to detect already-applied replays.
 */
export function transitionEquals(
  stored: TransitionRecord & { seq?: number; persisted_at?: string },
  incoming: TransitionRecord,
): boolean {
  return deepEquals(stripStatusMeta(stored), stripStatusMeta(incoming));
}
