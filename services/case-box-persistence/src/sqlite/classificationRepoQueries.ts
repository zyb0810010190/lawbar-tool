// SQL helpers for SqliteCaseBoxPersistence confidentiality classification
// methods (Phase B4). Mirrors matterRepoQueries / documentRepoQueries /
// auditRepoQueries sibling pattern per B4 plan §1.3.
//
// Three exports:
//   - listConfidentialityClassificationsSqlite: inlined SELECT walking
//     idx_case_box_classifications_by_matter_seek (unfiltered) or
//     idx_case_box_classifications_by_matter_target_seek (filtered).
//   - getEffectiveClassificationSqlite: matter+tenant+target validation
//     + walk idx_case_box_classifications_by_target DESC for history.
//   - applyAppendClassificationSqlite: thin SQLite wrapper around
//     prepareAppendClassification + DB writes. Builds a faithful
//     shadow ClassificationState (GLOBAL classificationIds; target-
//     scoped classificationsByMatter) per B4 plan §1.2 + rev-1
//     reviewer High D2#1 + D4#2 + D5#1.

import type { Database } from "better-sqlite3";

import type {
  CaseBoxConfidentialityClassification,
  CaseBoxDocument,
  CaseBoxMatter,
} from "case-box-contract";

import { eventHashFn, type StoredAuditEvent } from "../auditChain.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";
import { CaseBoxPersistenceError } from "../errors.js";
import {
  computeEffectiveLevel,
  createClassificationState,
  prepareAppendClassification,
  type ClassificationState,
} from "../inMemoryClassification.js";
import type {
  EffectiveClassificationResult,
  GetEffectiveClassificationQuery,
  ListConfidentialityClassificationsPage,
  ListConfidentialityClassificationsQuery,
} from "../types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireMatterTenant(
  db: Database,
  matterId: string,
  queryTenantId?: string,
): { tenant_id: string; payload_json: string } {
  const row = db
    .prepare("SELECT tenant_id, payload_json FROM case_box_matters WHERE id = ?")
    .get(matterId) as { tenant_id: string; payload_json: string } | undefined;
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

/**
 * Build a faithful shadow ClassificationState for prepareAppendClassification.
 * Per B4 plan §1.3 + rev-1 reviewer High D2#1:
 *   - classificationIds Set is GLOBAL (across the entire table) — matches the
 *     in-memory ClassificationState.classificationIds invariant exactly, so
 *     a duplicate id from another matter throws via the helper rather than
 *     surfacing as a raw SQLite PK conflict.
 *   - classificationsByMatter Map carries ONE entry keyed by matterId,
 *     containing only the rows matching (target_type, target_id) from the
 *     input. The helper's findLatestForTarget only inspects rows for the
 *     input's specific target; other matters' rows + other targets' rows
 *     are irrelevant.
 */
function buildShadowClassificationState(
  db: Database,
  matterId: string,
  targetType: "document" | "fact",
  targetId: string,
): ClassificationState {
  const state = createClassificationState();
  // Global id set.
  const idRows = db
    .prepare("SELECT id FROM case_box_confidentiality_classifications")
    .all() as { id: string }[];
  for (const r of idRows) {
    state.classificationIds.add(r.id);
  }
  // Target-scoped history for findLatestForTarget.
  const targetRows = db
    .prepare(
      `SELECT payload_json FROM case_box_confidentiality_classifications
       WHERE matter_id = ? AND target_type = ? AND target_id = ?`,
    )
    .all(matterId, targetType, targetId) as { payload_json: string }[];
  if (targetRows.length > 0) {
    const parsed = targetRows.map(
      (r) => JSON.parse(r.payload_json) as CaseBoxConfidentialityClassification,
    );
    state.classificationsByMatter.set(matterId, parsed);
  }
  return state;
}

// ---------------------------------------------------------------------------
// SQL row helpers
// ---------------------------------------------------------------------------

export function insertClassificationRow(
  db: Database,
  row: CaseBoxConfidentialityClassification,
): void {
  db.prepare(
    `INSERT INTO case_box_confidentiality_classifications
       (id, tenant_id, matter_id, target_type, target_id, level, prior_level,
        set_at, actor_user_id, change_reason_code, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.matter_id,
    row.target_type,
    row.target_id,
    row.level,
    row.prior_level ?? null,
    row.set_at,
    row.actor_user_id,
    row.change_reason_code ?? null,
    JSON.stringify(row),
  );
}

// ---------------------------------------------------------------------------
// applyAppendClassificationSqlite — full delegate
// ---------------------------------------------------------------------------

export interface AppendDeps {
  readonly generateId: () => string;
  readonly nowIso: () => string;
  readonly storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
  /**
   * Caller writes the audit event + chain head update after the row is
   * inserted. Called inside the transaction. Signature mirrors how
   * SqliteCaseBoxPersistence handles matter+document audit writes.
   */
  readonly writeAuditEventAndUpdateHead: (
    audit: StoredAuditEvent,
    eventHash: string,
  ) => void;
}

export function applyAppendClassificationSqlite(
  db: Database,
  input: unknown,
  deps: AppendDeps,
): CaseBoxConfidentialityClassification {
  // PRE-flight: read the input's matter_id + target_type + target_id to
  // build the shadow state. The helper does its own validation, so we
  // tolerate malformed inputs by trusting the helper's invalid_payload
  // path; we only need to extract the keys when they're string-shaped.
  const inputObj = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const matterIdFromInput = typeof inputObj.matter_id === "string" ? inputObj.matter_id : undefined;
  // target_type/target_id MAY be undefined (helper rejects); fall back to
  // safe defaults that produce an empty target-scoped history for the
  // helper's findLatestForTarget to see.
  const targetTypeFromInput =
    inputObj.target_type === "document" || inputObj.target_type === "fact"
      ? (inputObj.target_type as "document" | "fact")
      : "document";
  const targetIdFromInput = typeof inputObj.target_id === "string" ? inputObj.target_id : "";

  if (matterIdFromInput !== undefined) {
    const matterRow = db
      .prepare("SELECT 1 FROM case_box_matters WHERE id = ?")
      .get(matterIdFromInput);
    if (matterRow === undefined) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
    }
  }

  const matterIdForShadow = matterIdFromInput ?? "";
  const shadowState = buildShadowClassificationState(
    db,
    matterIdForShadow,
    targetTypeFromInput,
    targetIdFromInput,
  );

  // matterIdForShadow IS the input's matter_id (string) or "" if missing.
  // The helper's storedAuditEventsForMatter callback runs during
  // prepareAppendClassification, so we cannot reference `prepared` yet.
  const prepared = prepareAppendClassification(shadowState, input, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: () => deps.storedAuditEventsForMatter(matterIdForShadow),
    getDocument: (documentId) => loadDocumentForResolve(db, documentId),
  });

  const eventHash = eventHashFn(prepared.audit.event);
  insertClassificationRow(db, prepared.row);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHash);
  return prepared.row;
}

// ---------------------------------------------------------------------------
// getEffectiveClassificationSqlite — full delegate
// ---------------------------------------------------------------------------

export function getEffectiveClassificationSqlite(
  db: Database,
  query: GetEffectiveClassificationQuery,
): EffectiveClassificationResult {
  // 1. Matter + tenant FIRST (matches in-memory validation order; per
  // B4 audit Low D1#1 to preserve error-code parity for combined-invalid
  // inputs).
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  // 2. Target-type validation (per B4 plan §1.2 + rev-1 reviewer High D2#2).
  // The contract TS type narrows to "document"; defend at runtime.
  if (query.target_type !== "document") {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `getEffectiveClassification accepts target_type "document" only (got ${JSON.stringify(query.target_type)})`,
    );
  }

  // 3. Document target resolution (tenant + matter consistency).
  const docEntry = loadDocumentForResolve(db, query.target_id);
  if (docEntry === null) {
    throw new CaseBoxPersistenceError(
      "unknown_document",
      `unknown document target: ${query.target_id}`,
    );
  }
  if (docEntry.document.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `document.tenant_id (${docEntry.document.tenant_id}) does not match query.tenant_id (${query.tenant_id})`,
    );
  }
  if (docEntry.document.matter_id !== query.matter_id) {
    throw new CaseBoxPersistenceError(
      "matter_id_mismatch",
      `document.matter_id (${docEntry.document.matter_id}) does not match query.matter_id (${query.matter_id})`,
    );
  }

  // 4. Walk the target index for the history. Reuse computeEffectiveLevel
  // from the in-memory helper for the sort + level selection — single
  // source for the comparator semantics.
  const shadowState = createClassificationState();
  const rows = db
    .prepare(
      `SELECT payload_json FROM case_box_confidentiality_classifications
       WHERE matter_id = ? AND target_type = ? AND target_id = ?`,
    )
    .all(query.matter_id, query.target_type, query.target_id) as { payload_json: string }[];
  if (rows.length > 0) {
    shadowState.classificationsByMatter.set(
      query.matter_id,
      rows.map((r) => JSON.parse(r.payload_json) as CaseBoxConfidentialityClassification),
    );
  }
  return computeEffectiveLevel(
    shadowState,
    query.matter_id,
    query.target_type,
    query.target_id,
  );
}

// ---------------------------------------------------------------------------
// listConfidentialityClassificationsSqlite — full delegate
// ---------------------------------------------------------------------------

export function listConfidentialityClassificationsSqlite(
  db: Database,
  query: ListConfidentialityClassificationsQuery,
): ListConfidentialityClassificationsPage {
  // 1. Matter + tenant.
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  // 2. Filter validation (matches in-memory helper).
  if (query.target_id !== undefined && query.target_type === undefined) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `target_id without target_type is ambiguous; supply target_type as well`,
    );
  }

  // 3. resolveLimit.
  const limit = resolveLimit(query.limit);

  // 4. Filter hash + cursor decode.
  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    target_type: query.target_type,
    target_id: query.target_id,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "classifications_by_matter", filters_hash })
      : null;

  // 5. SELECT with WHERE + ORDER BY set_at ASC, id ASC + seek pagination.
  const params: unknown[] = [query.matter_id];
  const whereParts: string[] = ["matter_id = ?"];
  if (query.target_type !== undefined) {
    whereParts.push("target_type = ?");
    params.push(query.target_type);
  }
  if (query.target_id !== undefined) {
    whereParts.push("target_id = ?");
    params.push(query.target_id);
  }
  if (cursor !== null) {
    const [tSetAt, tId] = cursor.last_sort_tuple as [string, string];
    whereParts.push("(set_at > ? OR (set_at = ? AND id > ?))");
    params.push(tSetAt, tSetAt, tId);
  }
  params.push(limit + 1);
  const sql =
    `SELECT set_at, id, payload_json FROM case_box_confidentiality_classifications
     WHERE ${whereParts.join(" AND ")}
     ORDER BY set_at ASC, id ASC
     LIMIT ?`;
  const rows = db.prepare(sql).all(...params) as {
    set_at: string;
    id: string;
    payload_json: string;
  }[];

  // 6. Slice + next_cursor (no extra SELECT; columns selected above).
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const lastSliceRow = slice[slice.length - 1];
  const next_cursor =
    hasMore && lastSliceRow !== undefined
      ? encodeCursor({
          v: 1,
          kind: "classifications_by_matter",
          filters_hash,
          last_sort_tuple: [lastSliceRow.set_at, lastSliceRow.id],
        })
      : null;
  return {
    rows: slice.map(
      (r) => JSON.parse(r.payload_json) as CaseBoxConfidentialityClassification,
    ),
    next_cursor,
  };
}
