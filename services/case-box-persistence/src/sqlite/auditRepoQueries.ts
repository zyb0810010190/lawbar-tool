// SQL helpers for SqliteCaseBoxPersistence audit-read methods (Phase B3).
// Mirrors matterRepoQueries.ts / documentRepoQueries.ts shape.
//
// listAuditEventsSqlite: inlined SELECT walking
// `idx_case_box_audit_events_by_matter` (matter_id, sequence) with
// seek pagination via shared cursor utility.
//
// verifyAuditChainForMatterSqlite: load-all events ASC + reuse contract's
// `verifyAuditChain` VERBATIM (no chain logic re-implementation per B3
// plan §1.1). Final-event tamper is detected by an additional head-anchor
// comparison against case_box_audit_chain_heads.head_hash (B3 plan §1.5
// invariant 1b).

import type { Database } from "better-sqlite3";

import type { CaseBoxAuditEvent } from "case-box-contract";
import { verifyAuditChain } from "case-box-contract";

import { eventHashFn } from "../auditChain.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";
import { CaseBoxPersistenceError } from "../errors.js";
import type {
  ListAuditEventsPage,
  ListAuditEventsQuery,
  VerifyAuditChainResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireMatterTenant(
  db: Database,
  matterId: string,
  queryTenantId?: string,
): { tenant_id: string } {
  const row = db
    .prepare("SELECT tenant_id FROM case_box_matters WHERE id = ?")
    .get(matterId) as { tenant_id: string } | undefined;
  if (row === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
  }
  if (queryTenantId !== undefined && row.tenant_id !== queryTenantId) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${queryTenantId}) does not match matter.tenant_id (${row.tenant_id})`,
    );
  }
  return row;
}

// ---------------------------------------------------------------------------
// listAuditEvents — single SELECT + seek pagination
// ---------------------------------------------------------------------------

export function listAuditEventsSqlite(
  db: Database,
  query: ListAuditEventsQuery,
): ListAuditEventsPage {
  // 1. Matter-existence + tenant check.
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  // 2. resolveLimit (MANDATED shared utility per B3 plan §1.1).
  const limit = resolveLimit(query.limit);

  // 3. Filter hash + cursor decode.
  const filters = { tenant_id: query.tenant_id, matter_id: query.matter_id };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "audit_events_by_matter", filters_hash })
      : null;

  // 4. SELECT walking idx_case_box_audit_events_by_matter (matter_id, sequence).
  const params: unknown[] = [query.matter_id];
  let where = "matter_id = ?";
  if (cursor !== null) {
    const [tSeq] = cursor.last_sort_tuple as [number];
    where += " AND sequence > ?";
    params.push(tSeq);
  }
  params.push(limit + 1);
  // SELECT `sequence` alongside `event_json` so next_cursor can be built
  // without a second round trip (per B3 audit Low D4#1). `sequence` is a
  // persistence column, NOT a contract field on the event payload.
  const sql =
    `SELECT sequence, event_json FROM case_box_audit_events
     WHERE ${where}
     ORDER BY sequence ASC
     LIMIT ?`;
  const rows = db.prepare(sql).all(...params) as { sequence: number; event_json: string }[];

  // 5. Slice + next_cursor (no extra SELECT).
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const events = slice.map((r) => JSON.parse(r.event_json) as CaseBoxAuditEvent);
  const lastSliceRow = slice[slice.length - 1];
  const next_cursor =
    hasMore && lastSliceRow !== undefined
      ? encodeCursor({
          v: 1,
          kind: "audit_events_by_matter",
          filters_hash,
          last_sort_tuple: [lastSliceRow.sequence],
        })
      : null;
  return { rows: events, next_cursor };
}

// ---------------------------------------------------------------------------
// verifyAuditChainForMatter — load all + contract verifier + head-anchor check
// ---------------------------------------------------------------------------

interface HeadAnchorRow {
  head_hash: string | null;
}

export function verifyAuditChainForMatterSqlite(
  db: Database,
  matterId: string,
): VerifyAuditChainResult {
  // 1. Matter-existence check (no tenant filter — verifyAuditChainForMatter
  //    signature takes only matterId; matches in-memory helper).
  requireMatterTenant(db, matterId);

  // 2. Load all events ASC.
  const rows = db
    .prepare(
      "SELECT event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC",
    )
    .all(matterId) as { event_json: string }[];
  const events = rows.map((r) => JSON.parse(r.event_json) as CaseBoxAuditEvent);

  // 3. Contract verifier — REUSED VERBATIM. No chain logic re-implementation.
  const result = verifyAuditChain(events, { eventHashFn });

  // 4. Head-anchor cross-check (B3 plan §1.5 invariant 1b). If the verifier
  //    returned ok, compare its computed headHash against the persisted
  //    case_box_audit_chain_heads.head_hash. A mismatch detects last-event
  //    payload tampering (the in-chain prev_event_hash check cannot see it
  //    because there is no successor event).
  if (result.ok) {
    const anchor = db
      .prepare("SELECT head_hash FROM case_box_audit_chain_heads WHERE matter_id = ?")
      .get(matterId) as HeadAnchorRow | undefined;
    const persistedHead = anchor?.head_hash ?? null;
    if (persistedHead !== result.headHash) {
      return {
        ok: false,
        errorIndex: Math.max(0, result.verifiedCount - 1),
        errorReason: "prev_event_hash_mismatch",
        detail: `head-anchor mismatch: case_box_audit_chain_heads.head_hash (${String(persistedHead)}) does not equal verifier headHash (${String(result.headHash)}); last-event payload likely tampered`,
      };
    }
  }
  return result;
}
