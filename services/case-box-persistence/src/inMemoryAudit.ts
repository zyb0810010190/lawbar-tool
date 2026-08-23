// Audit-read extraction for Phase A6 LOC discipline.
//
// Moves listAuditEvents / getAuditChainHead / verifyAuditChainForMatter
// helpers out of inMemoryRepo.ts so the repo class stays under the 800
// pure-LOC fail threshold after A6's evidence delegates land. Behavior
// is unchanged.

import {
  verifyAuditChain,
  type CaseBoxAuditEvent,
  type CaseBoxMatter,
} from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";
import { assertAuditChainNotErased } from "./auditChainInvariant.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "./cursor.js";
import {
  eventHashFn,
  type StoredAuditEvent,
} from "./auditChain.js";
import type {
  AuditChainHead,
  ListAuditEventsPage,
  ListAuditEventsQuery,
  VerifyAuditChainResult,
} from "./types.js";
import { InMemoryAuditLog } from "./auditHeadAnchor.js";

export function listAuditEventsHelper(
  matters: Map<string, CaseBoxMatter>,
  audit: InMemoryAuditLog,
  query: ListAuditEventsQuery,
): ListAuditEventsPage {
  const matter = matters.get(query.matter_id);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${query.matter_id}`);
  }
  if (matter.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const limit = resolveLimit(query.limit);
  const filters = { tenant_id: query.tenant_id, matter_id: query.matter_id };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "audit_events_by_matter", filters_hash })
      : null;

  const stored = audit.get(query.matter_id);
  let filtered = stored;
  if (cursor !== null) {
    const [tSeq] = cursor.last_sort_tuple as [number];
    filtered = stored.filter((s) => s.sequence > tSeq);
  }
  const hasMore = filtered.length > limit;
  const slice = hasMore ? filtered.slice(0, limit) : filtered;
  const last = slice[slice.length - 1];
  const next_cursor =
    hasMore && last !== undefined
      ? encodeCursor({
          v: 1,
          kind: "audit_events_by_matter",
          filters_hash,
          last_sort_tuple: [last.sequence],
        })
      : null;
  return {
    rows: slice.map((s) => structuredClone(s.event) as CaseBoxAuditEvent),
    next_cursor,
  };
}

export function getAuditChainHeadHelper(
  matters: Map<string, CaseBoxMatter>,
  audit: InMemoryAuditLog,
  matterId: string,
): AuditChainHead {
  const matter = matters.get(matterId);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
  }
  const stored = audit.get(matterId);
  // WI-05: the matter exists (checked above), so zero events is a deleted chain, not a fresh
  // one. Same shared invariant the SQLite path uses — written once so the two cannot drift.
  assertAuditChainNotErased(matterId, stored.length);
  const last = stored[stored.length - 1]!;
  return {
    headHash: eventHashFn(last.event),
    lastEventId: last.event.id,
    count: stored.length,
  };
}

export function verifyAuditChainForMatterHelper(
  matters: Map<string, CaseBoxMatter>,
  audit: InMemoryAuditLog,
  matterId: string,
): VerifyAuditChainResult {
  const matter = matters.get(matterId);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
  }
  const stored = audit.get(matterId);
  const events = stored.map((s) => s.event);
  // Genesis guard — see the matching comment in sqlite/auditRepoQueries.ts. Kept
  // in both implementations because impl-parity tests assert they agree.
  if (events.length === 0) {
    return {
      ok: false,
      errorIndex: 0,
      errorReason: "missing_genesis_event",
      detail: `matter ${matterId} exists but holds zero audit events; its MATTER_REGISTERED genesis event is missing, which means the audit history was deleted`,
    };
  }
  // Genesis SHAPE guard (Codex audit finding D1, 2026-08-22). The length check above only
  // catches TOTAL erasure. Deleting the genesis and RE-CHAINING the survivors yields a
  // chain that is internally perfect and verified ok — but it necessarily now BEGINS with
  // a non-genesis event, and `createMatter` is the only writer of a matter's first event.
  // This is the one part of the otherwise-undetectable re-forge class that IS checkable.
  // Predicate uses action/entity_type/before_state_hash, NOT the v2-only event_kind, so
  // legacy v1 rows carrying no event_kind are not rejected.
  // events.length === 0 returned above, so index 0 exists; the explicit check keeps
  // noUncheckedIndexedAccess satisfied without a non-null assertion.
  const first = events[0];
  if (
    first === undefined ||
    first.action !== "create" ||
    first.entity_type !== "matter" ||
    (first.before_state_hash ?? null) !== null
  ) {
    return {
      ok: false,
      errorIndex: 0,
      errorReason: "missing_genesis_event",
      detail: `matter ${matterId}: the chain does not begin with a matter-create genesis event (first event action=${String(first?.action)}, entity_type=${String(first?.entity_type)}), which means the original genesis was removed`,
    };
  }

  // Head-anchor cross-check — WI-06, mirroring sqlite/auditRepoQueries.ts step 4 including
  // its errorReason, so the two implementations return the SAME verdict for the same
  // corruption. This is what catches LAST-EVENT tampering: the in-chain prev_event_hash link
  // cannot, because the last event has no successor carrying its hash. The twin had no anchor
  // at all until now, so it modelled a strictly weaker corruption class than the store it
  // stands in for — a double that is not merely incomplete but WRONG about a security
  // invariant, which is the kind of gap that makes a parity suite lie.
  const result = verifyAuditChain(events, { eventHashFn });
  if (result.ok) {
    const persistedHead = audit.anchor(matterId)?.headHash ?? null;
    if (persistedHead !== result.headHash) {
      return {
        ok: false,
        errorIndex: Math.max(0, result.verifiedCount - 1),
        errorReason: "prev_event_hash_mismatch",
        detail: `head-anchor mismatch: recorded head anchor (${String(persistedHead)}) does not equal verifier headHash (${String(result.headHash)}); last-event payload likely tampered`,
      };
    }
  }
  return result;
}
