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

export function listAuditEventsHelper(
  matters: Map<string, CaseBoxMatter>,
  auditByMatter: Map<string, StoredAuditEvent[]>,
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

  const stored = auditByMatter.get(query.matter_id) ?? [];
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
  auditByMatter: Map<string, StoredAuditEvent[]>,
  matterId: string,
): AuditChainHead {
  const matter = matters.get(matterId);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
  }
  const stored = auditByMatter.get(matterId) ?? [];
  if (stored.length === 0) {
    return { headHash: null, lastEventId: null, count: 0 };
  }
  const last = stored[stored.length - 1]!;
  return {
    headHash: eventHashFn(last.event),
    lastEventId: last.event.id,
    count: stored.length,
  };
}

export function verifyAuditChainForMatterHelper(
  matters: Map<string, CaseBoxMatter>,
  auditByMatter: Map<string, StoredAuditEvent[]>,
  matterId: string,
): VerifyAuditChainResult {
  const matter = matters.get(matterId);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
  }
  const stored = auditByMatter.get(matterId) ?? [];
  const events = stored.map((s) => s.event);
  return verifyAuditChain(events, { eventHashFn });
}
