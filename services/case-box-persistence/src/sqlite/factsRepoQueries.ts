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
import { SqliteBackedIdSet } from "./sqliteBackedIdSet.js";
import {
  createFactState,
  factCanonicalProjection,
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

// SqliteBackedIdSet — targeted PK existence check for append-path
// duplicate-id guards. Shared with B7 docket + deadline shims. See
// `./sqliteBackedIdSet.ts`.

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
    new SqliteBackedIdSet(db, "case_box_facts") as unknown as Set<string>;
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
  // Atomic-consistency hardening (M-2): scope to the resolved row's own
  // tenant_id + matter_id and assert exactly one affected row.
  const info = db
    .prepare(
      `UPDATE case_box_facts
       SET status = ?, supersedes_fact_id = ?, payload_json = ?
     WHERE id = ? AND tenant_id = ? AND matter_id = ?`,
    )
    .run(
      f.status,
      (f as { supersedes_fact_id?: string | null }).supersedes_fact_id ?? null,
      JSON.stringify(f),
      f.id,
      f.tenant_id,
      f.matter_id,
    );
  if (info.changes !== 1) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `fact scoped update affected ${info.changes} rows, expected 1 (tenant/matter scope drift for id=${f.id})`,
    );
  }
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
// applyAppendFactOnceSqlite — replay-safe append (Phase B11)
//
// Per B11 plan §1.2 (READY at commit 3937f36). Mirrors in-memory
// `applyAppendFactOnce` (inMemoryFact.ts line ~602) 3-branch logic
// verbatim. `factCanonicalProjection` reused verbatim from in-memory.
//
// Branches:
//   1. REPLAY (same id + same tenant + byte-identical canonical
//      projection): return stored row; NO INSERT, NO audit emission.
//   2. CROSS-TENANT defense (same id + different tenant_id): fall
//      through to strict `applyAppendFactSqlite` (NEVER short-circuit
//      cross-tenant read; security invariant per in-memory audit
//      Dim 5 #1).
//   3. CANONICALIZATION-THROW (hostile payload, depth>64, cycles):
//      catch + fall through to strict, which surfaces invalid_payload.
//   4. SAME-ID-DIFFERENT-PAYLOAD: fall through to strict, which
//      throws duplicate_id (A4 semantics).
//   5. NO PRIOR ROW or missing id: fall through to strict.
// ---------------------------------------------------------------------------

export function applyAppendFactOnceSqlite(
  db: Database,
  input: unknown,
  deps: AppendDeps,
): CaseBoxFact {
  if (input !== null && typeof input === "object") {
    const candidateId = (input as { id?: unknown }).id;
    if (typeof candidateId === "string" && candidateId.length > 0) {
      const priorRow = db
        .prepare("SELECT payload_json FROM case_box_facts WHERE id = ?")
        .get(candidateId) as { payload_json: string } | undefined;
      if (priorRow !== undefined) {
        const stored = JSON.parse(priorRow.payload_json) as CaseBoxFact;
        // Tenant defense: never short-circuit into a cross-tenant read.
        const inputTenant = (input as { tenant_id?: unknown }).tenant_id;
        if (typeof inputTenant === "string" && inputTenant !== stored.tenant_id) {
          return applyAppendFactSqlite(db, input, deps);
        }
        // Byte-identical canonical projection → REPLAY.
        try {
          if (factCanonicalProjection(stored) === factCanonicalProjection(input)) {
            return stored;
          }
        } catch {
          return applyAppendFactSqlite(db, input, deps);
        }
        // Same id, different payload → fall through to strict (throws duplicate_id).
      }
    }
  }
  return applyAppendFactSqlite(db, input, deps);
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

  // Tenant-scope the fact rows themselves, not just the matter. requireMatterTenant
  // above proves the MATTER belongs to query.tenant_id, but the SELECT must also
  // filter fact rows by tenant_id so a row whose own tenant_id differs from its
  // matter's (a data-integrity violation) cannot leak. Matches getFactSqlite and
  // listDocumentsSqlite. (cc-suite audit-mpxoq4ma-dn3m0h, FACTS-AUD-1.)
  const params: unknown[] = [query.tenant_id, query.matter_id];
  const whereParts: string[] = ["tenant_id = ?", "matter_id = ?"];
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
