// SQL helpers for SqliteCaseBoxPersistence privilege marker methods
// (Phase B5). Mirrors matter/document/audit/classification sibling
// pattern.
//
// Four exports:
//   - applyAppendPrivilegeMarkerSqlite: transaction-wrapping append.
//     Reuses prepareAppendPrivilegeMarker (in-memory helper) via a
//     faithful shadow PrivilegeState shim (GLOBAL privilegeIds Set
//     across the entire table; matter-scoped markersByMatter +
//     markerIndex per the helper's invariants).
//   - applyTransitionPrivilegeMarkerSqlite: transaction-wrapping
//     transition (UPDATE in place + audit event). Reuses
//     prepareTransitionPrivilegeMarker.
//   - getPrivilegeStatusSqlite: matter+tenant+target validation +
//     reuse effectivePrivilegeStatus from contract via shadow state.
//   - listPrivilegeMarkersSqlite: filter validation + cursor seek
//     ORDER BY proposed_at ASC, id ASC.
//
// privilege markers are MUTABLE — transitions UPDATE the row in
// place. payload_json is rewritten on each transition; lifted
// columns (status / kind) updated alongside.

import type { Database } from "better-sqlite3";

import type {
  CaseBoxDocument,
  CaseBoxPrivilegeMarker,
  PrivilegeResolution,
} from "case-box-contract";
import { effectivePrivilegeStatus } from "case-box-contract";

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
  createPrivilegeState,
  prepareAppendPrivilegeMarker,
  prepareTransitionPrivilegeMarker,
  type PrivilegeState,
  type PrivilegeTransitionOpts,
} from "../inMemoryPrivilege.js";
import type {
  GetPrivilegeStatusQuery,
  ListPrivilegeMarkersPage,
  ListPrivilegeMarkersQuery,
} from "../types.js";

// ---------------------------------------------------------------------------
// Internal matter+tenant guard
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

function loadDocumentForResolve(
  db: Database,
  documentId: string,
): { document: CaseBoxDocument } | null {
  const row = db
    .prepare("SELECT payload_json FROM case_box_documents WHERE id = ?")
    .get(documentId) as { payload_json: string } | undefined;
  if (row === undefined) return null;
  return { document: JSON.parse(row.payload_json) as CaseBoxDocument };
}

// ---------------------------------------------------------------------------
// Shadow state builders
// ---------------------------------------------------------------------------

/**
 * For appendPrivilegeMarker: GLOBAL privilegeIds Set + (if matter known)
 * the matter's markers array for any helper-internal sanity walks.
 */
function buildShadowAppendState(
  db: Database,
  matterId: string | undefined,
): PrivilegeState {
  const state = createPrivilegeState();
  // GLOBAL ids set.
  const idRows = db
    .prepare("SELECT id, matter_id FROM case_box_privilege_markers")
    .all() as { id: string; matter_id: string }[];
  for (const r of idRows) {
    state.privilegeIds.add(r.id);
    state.markerIndex.set(r.id, r.matter_id);
  }
  if (matterId !== undefined) {
    const rows = db
      .prepare("SELECT payload_json FROM case_box_privilege_markers WHERE matter_id = ?")
      .all(matterId) as { payload_json: string }[];
    if (rows.length > 0) {
      state.markersByMatter.set(
        matterId,
        rows.map((r) => JSON.parse(r.payload_json) as CaseBoxPrivilegeMarker),
      );
    }
  }
  return state;
}

/**
 * For transitionPrivilegeMarker: look up the marker's matter_id; load
 * ALL markers for that matter (for the confirmed-uniqueness scan); also
 * populate the global ids + index. If markerId is unknown, returns a
 * state where the markerIndex lookup will miss and the helper throws
 * invalid_argument.
 */
function buildShadowTransitionState(
  db: Database,
  markerId: string,
): PrivilegeState {
  const state = createPrivilegeState();
  // GLOBAL ids + index.
  const idRows = db
    .prepare("SELECT id, matter_id FROM case_box_privilege_markers")
    .all() as { id: string; matter_id: string }[];
  for (const r of idRows) {
    state.privilegeIds.add(r.id);
    state.markerIndex.set(r.id, r.matter_id);
  }
  const matterId = state.markerIndex.get(markerId);
  if (matterId !== undefined) {
    const rows = db
      .prepare("SELECT payload_json FROM case_box_privilege_markers WHERE matter_id = ?")
      .all(matterId) as { payload_json: string }[];
    state.markersByMatter.set(
      matterId,
      rows.map((r) => JSON.parse(r.payload_json) as CaseBoxPrivilegeMarker),
    );
  }
  return state;
}

// ---------------------------------------------------------------------------
// Row writers
// ---------------------------------------------------------------------------

export function insertPrivilegeMarkerRow(db: Database, row: CaseBoxPrivilegeMarker): void {
  db.prepare(
    `INSERT INTO case_box_privilege_markers
       (id, tenant_id, matter_id, target_type, target_id, kind, status, proposed_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.matter_id,
    row.target_type,
    row.target_id,
    row.kind,
    row.status,
    row.proposed_at,
    JSON.stringify(row),
  );
}

export function updatePrivilegeMarkerRow(db: Database, row: CaseBoxPrivilegeMarker): void {
  // Atomic-consistency hardening (M-2): scope to the resolved row's own
  // tenant_id + matter_id and assert exactly one affected row.
  const info = db
    .prepare(
      `UPDATE case_box_privilege_markers
       SET status = ?, payload_json = ?
     WHERE id = ? AND tenant_id = ? AND matter_id = ?`,
    )
    .run(row.status, JSON.stringify(row), row.id, row.tenant_id, row.matter_id);
  if (info.changes !== 1) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `privilege-marker scoped update affected ${info.changes} rows, expected 1 (tenant/matter scope drift for id=${row.id})`,
    );
  }
}

// ---------------------------------------------------------------------------
// applyAppendPrivilegeMarkerSqlite — transaction-wrapping append
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

export function applyAppendPrivilegeMarkerSqlite(
  db: Database,
  input: unknown,
  deps: AppendDeps,
): CaseBoxPrivilegeMarker {
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

  const shadowState = buildShadowAppendState(db, matterIdFromInput);

  const prepared = prepareAppendPrivilegeMarker(shadowState, input, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: () => deps.storedAuditEventsForMatter(matterIdFromInput ?? ""),
    getDocument: (documentId) => loadDocumentForResolve(db, documentId),
  });

  const eventHash = eventHashFn(prepared.audit.event);
  insertPrivilegeMarkerRow(db, prepared.row);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHash);
  return prepared.row;
}

// ---------------------------------------------------------------------------
// applyTransitionPrivilegeMarkerSqlite — transaction-wrapping transition
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

export function applyTransitionPrivilegeMarkerSqlite(
  db: Database,
  markerId: string,
  opts: PrivilegeTransitionOpts,
  deps: TransitionDeps,
): CaseBoxPrivilegeMarker {
  const shadowState = buildShadowTransitionState(db, markerId);
  const prepared = prepareTransitionPrivilegeMarker(shadowState, markerId, opts, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: (matterId) => deps.storedAuditEventsForMatter(matterId),
  });
  const eventHash = eventHashFn(prepared.audit.event);
  updatePrivilegeMarkerRow(db, prepared.next);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHash);
  return prepared.next;
}

// ---------------------------------------------------------------------------
// getPrivilegeStatusSqlite
// ---------------------------------------------------------------------------

export function getPrivilegeStatusSqlite(
  db: Database,
  query: GetPrivilegeStatusQuery,
): PrivilegeResolution {
  // 1. Matter + tenant.
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  // 2. Target-type validation.
  if (query.target_type !== "document") {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `getPrivilegeStatus accepts target_type "document" only (got ${JSON.stringify(query.target_type)})`,
    );
  }

  // 3. Document target resolution via shared helper (per B4 deferred
  //    Low D2#1 fix; shared with B4 getEffectiveClassificationSqlite).
  validateDocumentTarget(db, {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    target_id: query.target_id,
  });

  // 4. Load all markers for the matter (effectivePrivilegeStatus filters).
  //    Row-level tenant predicate (M-1): re-assert each marker's own tenant_id,
  //    not just the matter's, so a tenant-drifted marker cannot influence the
  //    effective privilege status.
  const rows = db
    .prepare("SELECT payload_json FROM case_box_privilege_markers WHERE tenant_id = ? AND matter_id = ?")
    .all(query.tenant_id, query.matter_id) as { payload_json: string }[];
  const markers = rows.map((r) => JSON.parse(r.payload_json) as CaseBoxPrivilegeMarker);
  return effectivePrivilegeStatus(query.target_type, query.target_id, markers);
}

// ---------------------------------------------------------------------------
// listPrivilegeMarkersSqlite
// ---------------------------------------------------------------------------

export function listPrivilegeMarkersSqlite(
  db: Database,
  query: ListPrivilegeMarkersQuery,
): ListPrivilegeMarkersPage {
  // 1. Matter + tenant.
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  // 2. Filter validation (matches in-memory).
  if (query.target_id !== undefined && query.target_type === undefined) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `target_id without target_type is ambiguous; supply target_type as well`,
    );
  }

  // 3. resolveLimit.
  const limit = resolveLimit(query.limit);

  // 4. Filter hash + cursor.
  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    target_type: query.target_type,
    target_id: query.target_id,
    status: query.status,
    kind: query.kind,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "privilege_markers_by_matter", filters_hash })
      : null;

  // 5. SELECT with WHERE + ORDER BY proposed_at ASC, id ASC + seek.
  //    Row-level tenant predicate (M-1): re-assert the marker row's own
  //    tenant_id alongside matter_id.
  const params: unknown[] = [query.tenant_id, query.matter_id];
  const whereParts: string[] = ["tenant_id = ?", "matter_id = ?"];
  if (query.target_type !== undefined) {
    whereParts.push("target_type = ?");
    params.push(query.target_type);
  }
  if (query.target_id !== undefined) {
    whereParts.push("target_id = ?");
    params.push(query.target_id);
  }
  if (query.status !== undefined) {
    whereParts.push("status = ?");
    params.push(query.status);
  }
  if (query.kind !== undefined) {
    whereParts.push("kind = ?");
    params.push(query.kind);
  }
  if (cursor !== null) {
    const [tProposed, tId] = cursor.last_sort_tuple as [string, string];
    whereParts.push("(proposed_at > ? OR (proposed_at = ? AND id > ?))");
    params.push(tProposed, tProposed, tId);
  }
  params.push(limit + 1);
  const sql =
    `SELECT proposed_at, id, payload_json FROM case_box_privilege_markers
     WHERE ${whereParts.join(" AND ")}
     ORDER BY proposed_at ASC, id ASC
     LIMIT ?`;
  const rows = db.prepare(sql).all(...params) as {
    proposed_at: string;
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
          kind: "privilege_markers_by_matter",
          filters_hash,
          last_sort_tuple: [lastSliceRow.proposed_at, lastSliceRow.id],
        })
      : null;
  return {
    rows: slice.map((r) => JSON.parse(r.payload_json) as CaseBoxPrivilegeMarker),
    next_cursor,
  };
}
