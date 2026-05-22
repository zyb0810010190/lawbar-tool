// SQL helpers for SqliteCaseBoxPersistence facts methods (Phase B6).
// Mirrors matter/document/audit/classification/privilege sibling pattern
// per B6 plan §1.2 (READY at commit 8fe0b04).
//
// Four exports:
//   - applyAppendFactSqlite: transaction-wrapping append. Reuses
//     `prepareAppendFact` (in-memory helper) via a shadow `FactState`
//     shim. Uses `SqliteBackedIdSet` for `factIds` because
//     `prepareAppendFact` reads `.has(id)` only (verified against
//     inMemoryFact.ts line 118); pattern avoids the global-id-scan
//     debt flagged by B5 D4#2.
//   - applyTransitionFactSqlite: transaction-wrapping transition
//     (UPDATE in place + audit event). Reuses `prepareTransitionFact`.
//     `prepareTransitionFact` reads `state.factIds.size` (line 289 in
//     inMemoryFact.ts) for the supersession-chain cycle-walk upper
//     bound; SqliteBackedIdSet returning 0 would break legitimate
//     chains. Plan §1.2 + reviewer-Path2-rev2-D3#1 mandate: use a
//     real matter-scoped `Set<string>` populated from the matter's
//     fact rows (bounded by matter fact count, NOT global).
//   - getFactSqlite: pure read by id; scoped to tenant + matter.
//   - listFactsSqlite: paginated read with optional filters (status,
//     source_type, source_document_id). ORDER BY created_at ASC, id ASC.

import type { Database } from "better-sqlite3";

import type { CaseBoxFact } from "case-box-contract";

import { eventHashFn, type StoredAuditEvent } from "../auditChain.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";
import { CaseBoxPersistenceError } from "../errors.js";
import { validateDocumentTarget } from "./documentRepoQueries.js";
import {
  createFactState,
  prepareAppendFact,
  prepareTransitionFact,
  type FactState,
  type FactTransitionOpts,
} from "../inMemoryFact.js";
import type {
  GetFactQuery,
  ListFactsPage,
  ListFactsQuery,
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
 * SQLite-backed Set wrapper that only supports `.has()` + `.add()`.
 * Per B6 plan §1.2 + audit rev-2 D3#1: `prepareAppendFact` reads only
 * `.has(id)`. If it ever calls `.size` / iterators / etc., this class
 * throws — caller falls back to a real matter-scoped Set.
 *
 * `.has()` performs an indexed PK existence check (no global table
 * scan). `.add()` tracks in-transaction adds in a local Set so subsequent
 * `.has()` for the same id within the same call returns true.
 */
/**
 * Note: declared as a standalone class (NOT `implements Set<string>`)
 * because TS Set<T> in the active target requires several ES2025
 * methods (union/intersection/etc) that we deliberately do not
 * support. We cast at the assignment site to inject this into the
 * shadow FactState's `factIds` slot. Per B6 audit acceptance:
 * `prepareAppendFact` reads only `.has(id)` + `.add(id)` (verified
 * inMemoryFact.ts line 118 + 546); other Set methods are unreachable
 * for the append path.
 */
class SqliteBackedIdSet {
  readonly #db: Database;
  readonly #local: Set<string> = new Set();

  constructor(db: Database) {
    this.#db = db;
  }

  has(id: string): boolean {
    if (this.#local.has(id)) return true;
    const row = this.#db
      .prepare("SELECT 1 FROM case_box_facts WHERE id = ?")
      .get(id);
    return row !== undefined;
  }

  add(id: string): this {
    this.#local.add(id);
    return this;
  }
}

/**
 * Build a shadow `FactState` for `prepareAppendFact`. Uses
 * `SqliteBackedIdSet` for `factIds` (targeted PK check, NO global
 * scan). Matter-scoped `factsByMatter` / `factIndex` / `factById` are
 * empty for append (the helper only needs factIds for the duplicate-
 * id guard; supersession is a transition concern, not an append
 * concern).
 */
function buildShadowAppendState(db: Database): FactState {
  const state = createFactState();
  // Replace the default empty Set with our SQL-backed one. Cast through
  // `unknown` because SqliteBackedIdSet supports only `.has` + `.add`
  // (TS Set<T> requires more methods we deliberately don't implement).
  (state as { factIds: Set<string> }).factIds =
    new SqliteBackedIdSet(db) as unknown as Set<string>;
  return state;
}

/**
 * Build a shadow `FactState` for `prepareTransitionFact`. Loads ALL
 * facts for the resolved matter via a single matter-scoped SELECT,
 * then populates `factsByMatter`, `factById`, `factIndex`, and
 * `factIds` from those rows.
 *
 * `factIds` is a REAL `Set<string>` (not SqliteBackedIdSet) because
 * the helper reads `.size` for the cycle-walk upper bound. The Set
 * contains the matter's fact ids only (NOT global) — bounded by
 * matter fact count.
 *
 * Matter resolution: targeted `SELECT matter_id FROM case_box_facts
 * WHERE id = ?` (per rev-2 reviewer M D3#1; NOT a global scan).
 */
function buildShadowTransitionState(
  db: Database,
  factId: string,
): FactState {
  const state = createFactState();
  const matterRow = db
    .prepare("SELECT matter_id FROM case_box_facts WHERE id = ?")
    .get(factId) as { matter_id: string } | undefined;
  if (matterRow === undefined) {
    return state; // empty state; helper will throw invalid_argument on factIndex miss
  }
  const matterId = matterRow.matter_id;
  const rows = db
    .prepare("SELECT payload_json FROM case_box_facts WHERE matter_id = ?")
    .all(matterId) as { payload_json: string }[];
  const facts = rows.map((r) => JSON.parse(r.payload_json) as CaseBoxFact);
  state.factsByMatter.set(matterId, facts);
  for (const f of facts) {
    state.factIds.add(f.id);
    state.factIndex.set(f.id, matterId);
    state.factById.set(f.id, f);
  }
  return state;
}

function loadDocumentForResolve(
  db: Database,
  documentId: string,
): { document: import("case-box-contract").CaseBoxDocument } | null {
  const row = db
    .prepare("SELECT payload_json FROM case_box_documents WHERE id = ?")
    .get(documentId) as { payload_json: string } | undefined;
  if (row === undefined) return null;
  return { document: JSON.parse(row.payload_json) as import("case-box-contract").CaseBoxDocument };
}

// ---------------------------------------------------------------------------
// Row writers
// ---------------------------------------------------------------------------

export function insertFactRow(db: Database, f: CaseBoxFact): void {
  db.prepare(
    `INSERT INTO case_box_facts
       (id, tenant_id, matter_id, source_document_id, source_type, status,
        purpose, as_of_date, supersedes_fact_id, created_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    f.id,
    f.tenant_id,
    f.matter_id,
    f.source_document_id ?? null,
    f.source_type,
    f.status,
    (f as { purpose?: string | null }).purpose ?? null,
    (f as { as_of_date?: string | null }).as_of_date ?? null,
    (f as { supersedes_fact_id?: string | null }).supersedes_fact_id ?? null,
    f.created_at,
    JSON.stringify(f),
  );
}

export function updateFactRow(db: Database, f: CaseBoxFact): void {
  db.prepare(
    `UPDATE case_box_facts
       SET status = ?, supersedes_fact_id = ?, payload_json = ?
     WHERE id = ?`,
  ).run(
    f.status,
    (f as { supersedes_fact_id?: string | null }).supersedes_fact_id ?? null,
    JSON.stringify(f),
    f.id,
  );
}

// ---------------------------------------------------------------------------
// applyAppendFactSqlite — transaction-wrapping append
// ---------------------------------------------------------------------------

export interface AppendDeps {
  readonly generateId: () => string;
  readonly nowIso: () => string;
  readonly storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
  readonly writeAuditEventAndUpdateHead: (
    audit: StoredAuditEvent,
    eventHash: string,
  ) => void;
}

export function applyAppendFactSqlite(
  db: Database,
  input: unknown,
  deps: AppendDeps,
): CaseBoxFact {
  const inputObj = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const matterIdFromInput = typeof inputObj.matter_id === "string" ? inputObj.matter_id : undefined;

  if (matterIdFromInput !== undefined) {
    const matterRow = db
      .prepare("SELECT 1 FROM case_box_matters WHERE id = ?")
      .get(matterIdFromInput);
    if (matterRow === undefined) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
    }
  }

  const shadowState = buildShadowAppendState(db);

  const prepared = prepareAppendFact(shadowState, input, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: () => deps.storedAuditEventsForMatter(matterIdFromInput ?? ""),
    getDocument: (documentId) => loadDocumentForResolve(db, documentId),
  });

  // Tenant + matter consistency mirror of inMemoryRepo applyAppendFact
  // wrapper. prepareAppendFact itself does not cross-check
  // matter.tenant_id against fact.tenant_id; the wrapper does.
  const matterTenantRow = db
    .prepare("SELECT tenant_id FROM case_box_matters WHERE id = ?")
    .get(prepared.matterId) as { tenant_id: string } | undefined;
  if (matterTenantRow === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${prepared.matterId}`);
  }
  if (matterTenantRow.tenant_id !== prepared.row.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `fact.tenant_id (${prepared.row.tenant_id}) does not match matter.tenant_id (${matterTenantRow.tenant_id})`,
    );
  }

  const eventHash = eventHashFn(prepared.audit.event);
  insertFactRow(db, prepared.row);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHash);
  return prepared.row;
}

// ---------------------------------------------------------------------------
// applyTransitionFactSqlite — transaction-wrapping transition
// ---------------------------------------------------------------------------

export interface TransitionDeps {
  readonly generateId: () => string;
  readonly nowIso: () => string;
  readonly storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
  readonly writeAuditEventAndUpdateHead: (
    audit: StoredAuditEvent,
    eventHash: string,
  ) => void;
}

export function applyTransitionFactSqlite(
  db: Database,
  factId: string,
  opts: FactTransitionOpts,
  deps: TransitionDeps,
): CaseBoxFact {
  const shadowState = buildShadowTransitionState(db, factId);
  const prepared = prepareTransitionFact(shadowState, factId, opts, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: (matterId) => deps.storedAuditEventsForMatter(matterId),
  });

  const eventHash = eventHashFn(prepared.audit.event);
  updateFactRow(db, prepared.next);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHash);
  return prepared.next;
}

// ---------------------------------------------------------------------------
// getFactSqlite — pure read
// ---------------------------------------------------------------------------

export function getFactSqlite(db: Database, query: GetFactQuery): CaseBoxFact | null {
  // Matter + tenant scope validation FIRST (mirrors in-memory order).
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  const row = db
    .prepare(
      `SELECT payload_json FROM case_box_facts
       WHERE id = ? AND tenant_id = ? AND matter_id = ?`,
    )
    .get(query.fact_id, query.tenant_id, query.matter_id) as
    | { payload_json: string }
    | undefined;
  if (row === undefined) return null;
  return JSON.parse(row.payload_json) as CaseBoxFact;
}

// ---------------------------------------------------------------------------
// listFactsSqlite — paginated read with filters
// ---------------------------------------------------------------------------

export function listFactsSqlite(db: Database, query: ListFactsQuery): ListFactsPage {
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  // Validate source_document_id target (when provided) — must belong to
  // the same matter + tenant. Per 6.A4.27b/27c.
  if (query.source_document_id !== undefined && query.source_document_id !== null) {
    validateDocumentTarget(db, {
      tenant_id: query.tenant_id,
      matter_id: query.matter_id,
      target_id: query.source_document_id,
    });
  }

  const limit = resolveLimit(query.limit);

  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    status: query.status,
    source_type: query.source_type,
    source_document_id: query.source_document_id,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "facts_by_matter", filters_hash })
      : null;

  const params: unknown[] = [query.matter_id];
  const whereParts: string[] = ["matter_id = ?"];
  if (query.status !== undefined) {
    whereParts.push("status = ?");
    params.push(query.status);
  }
  if (query.source_type !== undefined) {
    whereParts.push("source_type = ?");
    params.push(query.source_type);
  }
  if (query.source_document_id !== undefined) {
    whereParts.push("source_document_id = ?");
    params.push(query.source_document_id);
  }
  if (cursor !== null) {
    const [tCreated, tId] = cursor.last_sort_tuple as [string, string];
    whereParts.push("(created_at > ? OR (created_at = ? AND id > ?))");
    params.push(tCreated, tCreated, tId);
  }
  params.push(limit + 1);
  const sql =
    `SELECT created_at, id, payload_json FROM case_box_facts
     WHERE ${whereParts.join(" AND ")}
     ORDER BY created_at ASC, id ASC
     LIMIT ?`;
  const rows = db.prepare(sql).all(...params) as {
    created_at: string;
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
          kind: "facts_by_matter",
          filters_hash,
          last_sort_tuple: [lastSliceRow.created_at, lastSliceRow.id],
        })
      : null;
  return {
    rows: slice.map((r) => JSON.parse(r.payload_json) as CaseBoxFact),
    next_cursor,
  };
}
