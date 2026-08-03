// SQL helpers for SqliteCaseBoxPersistence claim-track methods (WI-PTA-VS1).
//
// Mirrors {facts,evidence}RepoQueries.ts sibling pattern. Three exports:
//   - applyCreateClaimTrackSqlite (caller-tx-wrapped create + audit).
//   - getClaimTrackSqlite (pure read; tenant + matter scope).
//   - listClaimTracksSqlite (pure read; unpaginated, deterministic order).
// Plus insertClaimTrackRow (row writer).
//
// Transaction-scope rule: applyCreateClaimTrackSqlite runs INSIDE the caller's
// `#runImmediateWrite` transaction (it does not open its own). The shared
// `prepareCreateClaimTrack` (inMemoryClaimTrack.ts) owns validation, the
// create-path guards, and audit-event construction so the SQLite and in-memory
// paths cannot diverge; this file only supplies the SQL-backed dependencies +
// row I/O and writes the prepared row + audit event.

import type { Database } from "better-sqlite3";

import type { CaseBoxClaimTrack, CaseBoxMatter } from "case-box-contract";

import { eventHashFn, type StoredAuditEvent } from "../auditChain.js";
import { CaseBoxPersistenceError } from "../errors.js";
import {
  createClaimTrackState,
  matterPartyRefOf,
  prepareCreateClaimTrack,
  type ClaimTrackState,
  type MatterPartyRef,
} from "../inMemoryClaimTrack.js";
import type { GetClaimTrackQuery, ListClaimTracksQuery } from "../types.js";
import { SqliteBackedIdSet } from "./sqliteBackedIdSet.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Matter existence + tenant preflight for read/list (mirror of facts/evidence). */
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
 * Load the referenced matter's tenant + party-id set for prepareCreateClaimTrack's
 * tenant-consistency + O3 layer-2 `unknown_party` existence check. Unlike
 * `requireMatterTenant` (which reads only tenant_id), the create path must READ +
 * PARSE the matter payload_json to recover the party ids — VS-0 stamped a ULID on
 * every party, so a claimant/respondent reference absent from parties[] is a
 * genuine error. Returns null when the matter is unknown.
 */
function loadMatterPartyRef(db: Database, matterId: string): MatterPartyRef | null {
  const row = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(matterId) as { payload_json: string } | undefined;
  if (row === undefined) return null;
  const matter = JSON.parse(row.payload_json) as CaseBoxMatter;
  return matterPartyRefOf(matter);
}

/**
 * Shadow `ClaimTrackState` for create. Uses `SqliteBackedIdSet` on
 * claimTrackIds (prepareCreateClaimTrack reads only `.has(id)` for the
 * duplicate-id guard — verified); the per-matter maps are empty (create needs
 * only the id set). Targeted PK existence check, NO global scan.
 */
function buildShadowCreateClaimTrackState(db: Database): ClaimTrackState {
  const state = createClaimTrackState();
  (state as { claimTrackIds: Set<string> }).claimTrackIds =
    new SqliteBackedIdSet(db, "case_box_claim_tracks") as unknown as Set<string>;
  return state;
}

// ---------------------------------------------------------------------------
// Row writer
// ---------------------------------------------------------------------------

export function insertClaimTrackRow(db: Database, c: CaseBoxClaimTrack): void {
  db.prepare(
    `INSERT INTO case_box_claim_tracks
       (id, tenant_id, matter_id, track_type, status, sort_order, created_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    c.id,
    c.tenant_id,
    c.matter_id,
    c.track_type,
    c.status,
    c.sort_order,
    c.created_at,
    JSON.stringify(c),
  );
}

// ---------------------------------------------------------------------------
// Shared write deps (mirror of SqliteWriteDeps).
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
// applyCreateClaimTrackSqlite — caller-tx-wrapped create
// ---------------------------------------------------------------------------

export function applyCreateClaimTrackSqlite(
  db: Database,
  input: unknown,
  deps: WriteDeps,
): CaseBoxClaimTrack {
  const matterIdFromInput = input !== null && typeof input === "object"
    ? (input as { matter_id?: unknown }).matter_id
    : undefined;

  const shadow = buildShadowCreateClaimTrackState(db);

  const prepared = prepareCreateClaimTrack(shadow, input, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: () =>
      deps.storedAuditEventsForMatter(typeof matterIdFromInput === "string" ? matterIdFromInput : ""),
    getMatterPartyRef: (matterId) => loadMatterPartyRef(db, matterId),
  });

  const eventHash = eventHashFn(prepared.audit.event);
  insertClaimTrackRow(db, prepared.row);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHash);
  return prepared.row;
}

// ---------------------------------------------------------------------------
// getClaimTrackSqlite — pure read (mirror of getEvidenceItemSqlite)
// ---------------------------------------------------------------------------

export function getClaimTrackSqlite(
  db: Database,
  query: GetClaimTrackQuery,
): CaseBoxClaimTrack | null {
  // Parity with in-memory getClaimTrack: unknown matter returns null, but a
  // tenant mismatch on a KNOWN matter throws.
  const matterRow = db
    .prepare("SELECT tenant_id FROM case_box_matters WHERE id = ?")
    .get(query.matter_id) as { tenant_id: string } | undefined;
  if (matterRow === undefined) return null;
  if (matterRow.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `query.tenant_id (${query.tenant_id}) does not match matter.tenant_id (${matterRow.tenant_id})`,
    );
  }
  const row = db
    .prepare(
      `SELECT payload_json FROM case_box_claim_tracks
       WHERE id = ? AND tenant_id = ? AND matter_id = ?`,
    )
    .get(query.claim_track_id, query.tenant_id, query.matter_id) as
    | { payload_json: string }
    | undefined;
  if (row === undefined) return null;
  return JSON.parse(row.payload_json) as CaseBoxClaimTrack;
}

// ---------------------------------------------------------------------------
// listClaimTracksSqlite — unpaginated, deterministic order
// ---------------------------------------------------------------------------

export function listClaimTracksSqlite(
  db: Database,
  query: ListClaimTracksQuery,
): ReadonlyArray<CaseBoxClaimTrack> {
  requireMatterTenant(db, query.matter_id, query.tenant_id);

  // Row-level tenant predicate (matches the facts/evidence precedent): the
  // preflight proves the MATTER belongs to query.tenant_id, but the child
  // SELECT must also filter claim-track rows by their own tenant_id so a row
  // whose tenant_id differs from its matter's cannot leak. ORDER BY matches the
  // (matter_id, sort_order, created_at, id) index + the in-memory comparator.
  const rows = db
    .prepare(
      `SELECT payload_json FROM case_box_claim_tracks
       WHERE tenant_id = ? AND matter_id = ?
       ORDER BY sort_order ASC, created_at ASC, id ASC`,
    )
    .all(query.tenant_id, query.matter_id) as { payload_json: string }[];
  return rows.map((r) => JSON.parse(r.payload_json) as CaseBoxClaimTrack);
}
