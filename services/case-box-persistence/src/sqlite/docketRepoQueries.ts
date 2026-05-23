// SQL helpers for SqliteCaseBoxPersistence docket-entry methods (Phase B7).
// Mirrors the sibling-file pattern of matter/document/audit/classification/
// privilege/facts RepoQueries. Per B7 plan §1.2 (READY at commit adae300).
//
// Five exports:
//   - applyAppendDocketEntrySqlite (Mode A — propose docket entry).
//   - applyConfirmDocketEntrySqlite (Mode B — atomic entry UPDATE +
//     deadline INSERT + 2 audit events).
//   - applyDismissDocketEntrySqlite.
//   - getDocketEntrySqlite (pure read).
//   - listDocketEntriesSqlite (paginated read with confirmation_state
//     + source_type filters per ListDocketEntriesQuery).
//
// Transaction-scope rule (per B7 plan §1.4 transaction-scope constraint
// + cc-suite rule §"Background-invocation discipline"): every helper
// here runs INSIDE the caller's `#runImmediateWrite` transaction. None
// of these helpers opens its own transaction.

import type { Database } from "better-sqlite3";

import type {
  CaseBoxDeadline,
  CaseBoxDocketEntry,
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
  createDeadlineState,
  type DeadlineState,
} from "../inMemoryDeadline.js";
import {
  createDocketState,
  prepareAppendDocketEntry,
  prepareConfirmDocketEntry,
  prepareDismissDocketEntry,
  type ConfirmDocketEntryOpts,
  type DismissDocketEntryOpts,
  type DocketState,
} from "../inMemoryDocket.js";
import type {
  GetDocketEntryQuery,
  ListDocketEntriesPage,
  ListDocketEntriesQuery,
} from "../types.js";
import { SqliteBackedIdSet } from "./sqliteBackedIdSet.js";

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

/**
 * Shadow `DocketState` for append. Uses `SqliteBackedIdSet` for
 * `docketIds` (verified: `prepareAppendDocketEntry` reads only
 * `.has(id)` / `.add(id)`).
 */
function buildShadowAppendDocketState(db: Database): DocketState {
  const state = createDocketState();
  (state as { docketIds: Set<string> }).docketIds =
    new SqliteBackedIdSet(db, "case_box_docket_entries") as unknown as Set<string>;
  return state;
}

/**
 * Shadow `DocketState` + `DeadlineState` for confirm / dismiss. Both
 * states loaded matter-scoped via two SELECTs inside the caller's
 * transaction. `prepareConfirmDocketEntry` reads docket-by-id +
 * deadline-by-id + tests deadline duplicate, so both states need
 * the matter's full row set.
 *
 * Matter resolution: targeted PK lookup
 * `SELECT matter_id FROM case_box_docket_entries WHERE id = ?` —
 * NOT a global scan (per B7 plan §1.2 + rev-1 reviewer M D3#1).
 */
function buildShadowConfirmStates(
  db: Database,
  entryId: string,
): { docket: DocketState; deadline: DeadlineState; matterId: string | null } {
  const docket = createDocketState();
  const deadline = createDeadlineState();
  const matterRow = db
    .prepare("SELECT matter_id FROM case_box_docket_entries WHERE id = ?")
    .get(entryId) as { matter_id: string } | undefined;
  if (matterRow === undefined) {
    return { docket, deadline, matterId: null };
  }
  const matterId = matterRow.matter_id;
  // Load docket entries for the matter.
  const docketRows = db
    .prepare("SELECT payload_json FROM case_box_docket_entries WHERE matter_id = ?")
    .all(matterId) as { payload_json: string }[];
  const docketEntries = docketRows.map((r) => JSON.parse(r.payload_json) as CaseBoxDocketEntry);
  docket.entriesByMatter.set(matterId, docketEntries);
  for (const e of docketEntries) {
    docket.docketIds.add(e.id);
    docket.docketIndex.set(e.id, matterId);
    docket.docketById.set(e.id, e);
  }
  // Load deadlines for the matter (for idempotent-replay via
  // deadlineById). For cross-matter duplicate-deadline detection,
  // SWAP the matter-scoped deadlineIds Set for a GLOBAL SqliteBackedIdSet
  // (per B7 audit M D1#1): prepareConfirmDocketEntry's duplicate-id
  // check at inMemoryDocket.ts:296 must catch deadline_ids that exist
  // in OTHER matters too — otherwise the PK constraint surfaces as
  // raw SQLITE_CONSTRAINT_PRIMARYKEY instead of the contract's
  // duplicate_id error. Verified prepareConfirmDocketEntry reads only
  // .has() on deadlineIds (NOT .size / iteration), so a SqliteBackedIdSet
  // is safe — if the helper signature drifts, swap back to a real Set
  // and re-flag the global-scan deferred Low.
  const deadlineRows = db
    .prepare("SELECT payload_json FROM case_box_deadlines WHERE matter_id = ?")
    .all(matterId) as { payload_json: string }[];
  const deadlines = deadlineRows.map((r) => JSON.parse(r.payload_json) as CaseBoxDeadline);
  deadline.deadlinesByMatter.set(matterId, deadlines);
  for (const d of deadlines) {
    deadline.deadlineIndex.set(d.id, matterId);
    deadline.deadlineById.set(d.id, d);
  }
  (deadline as { deadlineIds: Set<string> }).deadlineIds =
    new SqliteBackedIdSet(db, "case_box_deadlines") as unknown as Set<string>;
  return { docket, deadline, matterId };
}

// ---------------------------------------------------------------------------
// Row writers
// ---------------------------------------------------------------------------

export function insertDocketEntryRow(db: Database, e: CaseBoxDocketEntry): void {
  db.prepare(
    `INSERT INTO case_box_docket_entries
       (id, tenant_id, matter_id, source_document_id, source_type,
        proposed_kind, confirmation_state, proposed_at,
        confirmed_deadline_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.id,
    e.tenant_id,
    e.matter_id,
    e.source_document_id ?? null,
    e.source_type,
    (e as { proposed_kind: string }).proposed_kind,
    e.confirmation_state,
    (e as { proposed_at: string }).proposed_at,
    e.confirmed_deadline_id ?? null,
    JSON.stringify(e),
  );
}

export function updateDocketEntryRow(db: Database, e: CaseBoxDocketEntry): void {
  db.prepare(
    `UPDATE case_box_docket_entries
       SET confirmation_state = ?, confirmed_deadline_id = ?, payload_json = ?
     WHERE id = ?`,
  ).run(
    e.confirmation_state,
    e.confirmed_deadline_id ?? null,
    JSON.stringify(e),
    e.id,
  );
}

export function insertDeadlineRow(
  db: Database,
  d: CaseBoxDeadline,
  sourceDocketEntryId: string,
): void {
  db.prepare(
    `INSERT INTO case_box_deadlines
       (id, tenant_id, matter_id, source_docket_entry_id, kind, status,
        due_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    d.id,
    d.tenant_id,
    d.matter_id,
    sourceDocketEntryId,
    d.kind,
    d.status,
    d.due_at,
    JSON.stringify(d),
  );
}

// ---------------------------------------------------------------------------
// Shared write deps (mirror of `SqliteWriteDeps` in
// SqliteCaseBoxPersistence.ts; duplicated here to keep the helper
// signatures stable without a circular import).
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
// applyAppendDocketEntrySqlite — Mode A
// ---------------------------------------------------------------------------

export function applyAppendDocketEntrySqlite(
  db: Database,
  input: unknown,
  deps: WriteDeps,
): CaseBoxDocketEntry {
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

  const shadow = buildShadowAppendDocketState(db);

  const prepared = prepareAppendDocketEntry(shadow, input, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: () => deps.storedAuditEventsForMatter(matterIdFromInput ?? ""),
    getDocument: (documentId) => loadDocumentForResolve(db, documentId),
  });

  // Tenant + matter consistency mirror of inMemoryRepo's applyAppendDocketEntry wrapper.
  const matterTenantRow = db
    .prepare("SELECT tenant_id FROM case_box_matters WHERE id = ?")
    .get(prepared.matterId) as { tenant_id: string } | undefined;
  if (matterTenantRow === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${prepared.matterId}`);
  }
  if (matterTenantRow.tenant_id !== prepared.row.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `docket-entry.tenant_id (${prepared.row.tenant_id}) does not match matter.tenant_id (${matterTenantRow.tenant_id})`,
    );
  }

  const eventHash = eventHashFn(prepared.audit.event);
  insertDocketEntryRow(db, prepared.row);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHash);
  return prepared.row;
}

// ---------------------------------------------------------------------------
// applyConfirmDocketEntrySqlite — MODE B atomic
//
// Step ordering (per B7 plan §1.4):
//   1. Build matter-scoped shadow DocketState + DeadlineState.
//   2. Call prepareConfirmDocketEntry → produces {entry, deadline,
//      audits, idempotent}.
//   3. If idempotent: return existing pair (no writes).
//   4. UPDATE docket entry row (status → "confirmed").
//   5. CRASH-INJECTION SEAM (env-var CASE_BOX_B7_CRASH_AFTER=
//      "after_docket_update") — throw HERE to exercise rollback proof.
//   6. INSERT deadline row.
//   7. Write 2 audit events + chain-head updates.
//   8. Return {entry, deadline, idempotent: false}.
//
// All steps run inside the caller's `#runImmediateWrite` transaction.
// ---------------------------------------------------------------------------

export function applyConfirmDocketEntrySqlite(
  db: Database,
  entryId: string,
  opts: ConfirmDocketEntryOpts,
  deps: WriteDeps,
): { entry: CaseBoxDocketEntry; deadline: CaseBoxDeadline; idempotent: boolean } {
  const { docket, deadline } = buildShadowConfirmStates(db, entryId);
  const prepared = prepareConfirmDocketEntry(docket, deadline, entryId, opts, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: (matterId) => deps.storedAuditEventsForMatter(matterId),
  });
  if (prepared.idempotent) {
    return { entry: prepared.entry, deadline: prepared.deadline, idempotent: true };
  }

  // 4. Docket entry UPDATE.
  updateDocketEntryRow(db, prepared.entry);

  // 5. CRASH-INJECTION SEAM. Active only when the env var matches the
  //    canonical value; production code path costs ~1 string compare.
  //    Per B7 plan §1.5 + umbrella §9 risk #2 mandatory test.
  if (process.env.CASE_BOX_B7_CRASH_AFTER === "after_docket_update") {
    throw new Error("crash-injection: after_docket_update (B7 plan §1.5)");
  }

  // 6. Deadline INSERT. source_docket_entry_id derived from the
  //    docket entry's id (per B7 plan §1.1 column-derivation note).
  insertDeadlineRow(db, prepared.deadline, prepared.entry.id);

  // 7. Two audit events + chain-head update.
  const audit0 = prepared.audits[0]!;
  const audit1 = prepared.audits[1]!;
  deps.writeAuditEventAndUpdateHead(audit0, eventHashFn(audit0.event));
  deps.writeAuditEventAndUpdateHead(audit1, eventHashFn(audit1.event));

  return { entry: prepared.entry, deadline: prepared.deadline, idempotent: false };
}

// ---------------------------------------------------------------------------
// applyDismissDocketEntrySqlite — caller-transaction-wrapped
// ---------------------------------------------------------------------------

export function applyDismissDocketEntrySqlite(
  db: Database,
  entryId: string,
  opts: DismissDocketEntryOpts,
  deps: WriteDeps,
): CaseBoxDocketEntry {
  const { docket } = buildShadowConfirmStates(db, entryId);
  const prepared = prepareDismissDocketEntry(docket, entryId, opts, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: (matterId) => deps.storedAuditEventsForMatter(matterId),
  });
  updateDocketEntryRow(db, prepared.next);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHashFn(prepared.audit.event));
  return prepared.next;
}

// ---------------------------------------------------------------------------
// getDocketEntrySqlite — pure read
// ---------------------------------------------------------------------------

export function getDocketEntrySqlite(
  db: Database,
  query: GetDocketEntryQuery,
): CaseBoxDocketEntry | null {
  requireMatterTenant(db, query.matter_id, query.tenant_id);
  const row = db
    .prepare(
      `SELECT payload_json FROM case_box_docket_entries
       WHERE id = ? AND tenant_id = ? AND matter_id = ?`,
    )
    .get((query as { entry_id: string }).entry_id, query.tenant_id, query.matter_id) as
    | { payload_json: string }
    | undefined;
  if (row === undefined) return null;
  return JSON.parse(row.payload_json) as CaseBoxDocketEntry;
}

// ---------------------------------------------------------------------------
// listDocketEntriesSqlite — paginated read with filters
// ---------------------------------------------------------------------------

export function listDocketEntriesSqlite(
  db: Database,
  query: ListDocketEntriesQuery,
): ListDocketEntriesPage {
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  // Filter shape: confirmation_state + source_type per ListDocketEntriesQuery
  // (per B7 plan rev-1 reviewer M D1#3 + B7 audit L D1#2 / D3#1:
  // source_document_id is NOT a public filter; the lifted column
  // exists for future expansion only and no SQLite-side validation
  // runs against it).

  const limit = resolveLimit((query as { limit?: number }).limit);

  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    confirmation_state: (query as { confirmation_state?: string }).confirmation_state,
    source_type: (query as { source_type?: string }).source_type,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    (query as { cursor?: string }).cursor !== undefined
      ? decodeCursor((query as { cursor: string }).cursor, { kind: "docket_entries_by_matter", filters_hash })
      : null;

  const params: unknown[] = [query.matter_id];
  const whereParts: string[] = ["matter_id = ?"];
  if (filters.confirmation_state !== undefined) {
    whereParts.push("confirmation_state = ?");
    params.push(filters.confirmation_state);
  }
  if (filters.source_type !== undefined) {
    whereParts.push("source_type = ?");
    params.push(filters.source_type);
  }
  if (cursor !== null) {
    const [tProposedAt, tId] = cursor.last_sort_tuple as [string, string];
    whereParts.push("(proposed_at > ? OR (proposed_at = ? AND id > ?))");
    params.push(tProposedAt, tProposedAt, tId);
  }
  params.push(limit + 1);
  const sql =
    `SELECT proposed_at, id, payload_json FROM case_box_docket_entries
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
          kind: "docket_entries_by_matter",
          filters_hash,
          last_sort_tuple: [lastSliceRow.proposed_at, lastSliceRow.id],
        })
      : null;
  return {
    rows: slice.map((r) => JSON.parse(r.payload_json) as CaseBoxDocketEntry),
    next_cursor,
  };
}
