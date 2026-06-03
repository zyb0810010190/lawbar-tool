// SQL helpers for SqliteCaseBoxPersistence deadline lifecycle methods
// (Phase B7). Per B7 plan §1.2 (READY at commit adae300).
//
// Three exports:
//   - applyTransitionDeadlineSqlite (UPDATE in place + audit event).
//   - getDeadlineSqlite (pure read; tenant + matter scope).
//   - listDeadlinesSqlite (paginated read with status + kind filters
//     per ListDeadlinesQuery).
//
// Transaction-scope rule (per B7 plan §1.4 transaction-scope
// constraint): every helper runs INSIDE the caller's
// `#runImmediateWrite` transaction. None opens its own transaction.
//
// Deadline materialization (the INSERT path) lives in
// `docketRepoQueries.ts#applyConfirmDocketEntrySqlite` because deadlines
// are CREATED only via Mode B confirmDocketEntry. This file owns the
// post-materialization lifecycle.

import type { Database } from "better-sqlite3";

import type { CaseBoxDeadline } from "case-box-contract";

import { eventHashFn, type StoredAuditEvent } from "../auditChain.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";
import { CaseBoxPersistenceError } from "../errors.js";
import {
  createDeadlineState,
  prepareTransitionDeadline,
  type DeadlineState,
  type DeadlineTransitionOpts,
} from "../inMemoryDeadline.js";
import type {
  GetDeadlineQuery,
  ListDeadlinesPage,
  ListDeadlinesQuery,
} from "../types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireMatterTenant(
  db: Database,
  matterId: string,
  queryTenantId?: string,
): void {
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
}

/**
 * Shadow `DeadlineState` for transition. Loads ALL deadlines for the
 * resolved matter via a single matter-scoped SELECT. `factIds` /
 * `deadlineIds` is a REAL Set (not SqliteBackedIdSet) because the
 * transition path needs matter-scoped lookup; matter scoping bounds
 * the load (no global scan).
 *
 * Matter resolution: targeted PK lookup
 * `SELECT matter_id FROM case_box_deadlines WHERE id = ?`.
 */
function buildShadowTransitionState(db: Database, deadlineId: string): DeadlineState {
  const state = createDeadlineState();
  const matterRow = db
    .prepare("SELECT matter_id FROM case_box_deadlines WHERE id = ?")
    .get(deadlineId) as { matter_id: string } | undefined;
  if (matterRow === undefined) {
    return state;
  }
  const matterId = matterRow.matter_id;
  const rows = db
    .prepare("SELECT payload_json FROM case_box_deadlines WHERE matter_id = ?")
    .all(matterId) as { payload_json: string }[];
  const deadlines = rows.map((r) => JSON.parse(r.payload_json) as CaseBoxDeadline);
  state.deadlinesByMatter.set(matterId, deadlines);
  for (const d of deadlines) {
    state.deadlineIds.add(d.id);
    state.deadlineIndex.set(d.id, matterId);
    state.deadlineById.set(d.id, d);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Row writers
// ---------------------------------------------------------------------------

export function updateDeadlineRow(db: Database, d: CaseBoxDeadline): void {
  db.prepare(
    `UPDATE case_box_deadlines
       SET status = ?, payload_json = ?
     WHERE id = ?`,
  ).run(d.status, JSON.stringify(d), d.id);
}

// ---------------------------------------------------------------------------
// Shared write deps (mirror of `SqliteWriteDeps`).
// ---------------------------------------------------------------------------

export interface WriteDeps {
  readonly generateId: () => string;
  readonly nowIso: () => string;
  readonly storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
  readonly writeAuditEventAndUpdateHead: (
    audit: StoredAuditEvent,
    eventHash: string,
  ) => void;
}

// ---------------------------------------------------------------------------
// applyTransitionDeadlineSqlite — caller-transaction-wrapped
// ---------------------------------------------------------------------------

export function applyTransitionDeadlineSqlite(
  db: Database,
  deadlineId: string,
  opts: DeadlineTransitionOpts,
  deps: WriteDeps,
): CaseBoxDeadline {
  const state = buildShadowTransitionState(db, deadlineId);
  const prepared = prepareTransitionDeadline(state, deadlineId, opts, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: (matterId) => deps.storedAuditEventsForMatter(matterId),
  });
  updateDeadlineRow(db, prepared.next);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHashFn(prepared.audit.event));
  return prepared.next;
}

// ---------------------------------------------------------------------------
// getDeadlineSqlite — pure read
// ---------------------------------------------------------------------------

export function getDeadlineSqlite(
  db: Database,
  query: GetDeadlineQuery,
): CaseBoxDeadline | null {
  requireMatterTenant(db, query.matter_id, query.tenant_id);
  const row = db
    .prepare(
      `SELECT payload_json FROM case_box_deadlines
       WHERE id = ? AND tenant_id = ? AND matter_id = ?`,
    )
    .get(query.deadline_id, query.tenant_id, query.matter_id) as
    | { payload_json: string }
    | undefined;
  if (row === undefined) return null;
  return JSON.parse(row.payload_json) as CaseBoxDeadline;
}

// ---------------------------------------------------------------------------
// listDeadlinesSqlite — paginated read with filters
// ---------------------------------------------------------------------------

export function listDeadlinesSqlite(
  db: Database,
  query: ListDeadlinesQuery,
): ListDeadlinesPage {
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  const limit = resolveLimit((query as { limit?: number }).limit);

  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    status: (query as { status?: string }).status,
    kind: (query as { kind?: string }).kind,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    (query as { cursor?: string }).cursor !== undefined
      ? decodeCursor((query as { cursor: string }).cursor, { kind: "deadlines_by_matter", filters_hash })
      : null;

  // Tenant-scope the deadline rows themselves, not just the matter (parallels
  // the facts list fix; matches getDeadlineSqlite + listDocumentsSqlite). A
  // deadline row whose own tenant_id differs from its matter's cannot leak.
  // (cc-suite audit-mpxoq4ma-dn3m0h, FACTS-AUD-1.)
  const params: unknown[] = [query.tenant_id, query.matter_id];
  const whereParts: string[] = ["tenant_id = ?", "matter_id = ?"];
  if (filters.status !== undefined) {
    whereParts.push("status = ?");
    params.push(filters.status);
  }
  if (filters.kind !== undefined) {
    whereParts.push("kind = ?");
    params.push(filters.kind);
  }
  if (cursor !== null) {
    const [tDueAt, tId] = cursor.last_sort_tuple as [string, string];
    whereParts.push("(due_at > ? OR (due_at = ? AND id > ?))");
    params.push(tDueAt, tDueAt, tId);
  }
  params.push(limit + 1);
  const sql =
    `SELECT due_at, id, payload_json FROM case_box_deadlines
     WHERE ${whereParts.join(" AND ")}
     ORDER BY due_at ASC, id ASC
     LIMIT ?`;
  const rows = db.prepare(sql).all(...params) as {
    due_at: string;
    id: string;
    payload_json: string;
  }[];

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const lastSliceRow = slice[slice.length - 1];
  const next_cursor =
    hasMore && lastSliceRow !== undefined
      ? encodeCursor({
          v: 1,
          kind: "deadlines_by_matter",
          filters_hash,
          last_sort_tuple: [lastSliceRow.due_at, lastSliceRow.id],
        })
      : null;
  return {
    rows: slice.map((r) => JSON.parse(r.payload_json) as CaseBoxDeadline),
    next_cursor,
  };
}
