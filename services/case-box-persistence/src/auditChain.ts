// Audit-chain helpers for case-box-persistence (Phase A1).
//
// All canonicalization + hashing comes from `case-box-contract` verbatim;
// this module never re-implements either. The persistence-layer concerns
// added here are:
//
//   - Per-matter monotonic `sequence` integer (internal, NOT a contract
//     field, NOT included in canonicalAuditEventHashInput).
//   - SHA-256 of `canonicalAuditEventHashInput` via node:crypto, wrapped
//     in the contract's branded `AuditEventHash` type.
//   - State-hash input for `before_state_hash` / `after_state_hash`:
//     canonical JSON with sorted keys.
//
// All functions are pure / no IO; callers (InMemoryCaseBoxPersistence) own
// the mutation discipline (validate everything, build the event + hash,
// THEN mutate the in-memory Maps in one synchronous step).

import { createHash } from "node:crypto";
import {
  asAuditEventHash,
  canonicalAuditEventHashInput,
  type AuditEventHash,
  type CaseBoxAuditEvent,
  type EventHashFn,
} from "case-box-contract";

/** Internal wrapper. NOT exported from the package's public surface. */
export interface StoredAuditEvent {
  readonly sequence: number;
  readonly event: CaseBoxAuditEvent;
}

/** Hash an audit event with SHA-256 over its canonical input. */
export const eventHashFn: EventHashFn = (event) => {
  const input = canonicalAuditEventHashInput(event);
  const hex = createHash("sha256").update(input).digest("hex");
  return asAuditEventHash(hex);
};

/**
 * Canonical JSON for entity state-hash inputs (`before_state_hash`,
 * `after_state_hash`). Sorted keys, no whitespace, undefined values
 * dropped. Used for matter + document records.
 */
export function canonicalEntityHashInput(record: unknown): string {
  return JSON.stringify(canonicalize(record));
}

/** Compute the entity state-hash (sha256 hex). */
export function entityStateHash(record: unknown): string {
  const input = canonicalEntityHashInput(record);
  return createHash("sha256").update(input).digest("hex");
}

/** Recursively sort object keys; primitives + arrays returned in place. */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    if (v === undefined) continue;
    out[k] = canonicalize(v);
  }
  return out;
}

/** Lookup the prior head hash from a sequence of stored events. */
export function priorHeadOf(
  stored: ReadonlyArray<StoredAuditEvent>,
): AuditEventHash | null {
  if (stored.length === 0) return null;
  const last = stored[stored.length - 1]!;
  return eventHashFn(last.event);
}
