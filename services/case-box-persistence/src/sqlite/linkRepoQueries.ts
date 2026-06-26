// SQL helpers for SqliteCaseBoxPersistence Evidence link unlink/relink
// (WI-A3-UNLINK-T1). Per dev-memo/plan-batch-casebox-evidence-a3-unlink-operation-00.md
// (review-plan review-plan-mqujz9pi-brq8ob READY).
//
// The durable unlink/relink OPERATION over case_box_links: an explicit
// unlink sets the V12 marker columns (unlinked_at + unlink_reason); a
// relink clears both. Each operation appends EXACTLY ONE tamper-evident
// v2 audit chain event in the SAME transaction as the row UPDATE
// (LINK_UNLINKED on unlink, LINK_RELINKED on relink — the kinds shipped
// contract-only in PR #136). Mirrors applyTransitionDeadlineSqlite.
//
// Transaction-scope rule: every helper runs INSIDE the caller's
// `#runImmediateWrite` transaction. None opens its own transaction.
//
// SQLite-only: links are an A3 SQLite-only feature; the methods live on
// the concrete SqliteCaseBoxPersistence class, NOT the shared
// CaseBoxPersistence interface (InMemoryCaseBoxPersistence has no link
// support). Marker-only UPDATE: never `status` (resolver-owned), never
// `payload_json`, never a DELETE — the link row is preserved.

import type { Database } from "better-sqlite3";

import { buildCaseBoxAuditEvent } from "case-box-contract";

import { entityStateHash, eventHashFn, priorHeadOf, type StoredAuditEvent } from "../auditChain.js";
import { CaseBoxPersistenceError } from "../errors.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The persisted case_box_links row (all durable columns incl. the V12
 *  marker columns). This is the public return type of unlinkLink/relinkLink
 *  (review Low L1: name an EXPORTED type, never a non-exported public return
 *  type). `status` is resolver-derived (written by resolveLinkStatuses), not
 *  by these operations. */
export interface CaseBoxLinkRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly anchor_id: string;
  readonly status: string;
  readonly created_at: string;
  readonly payload_json: string;
  readonly unlinked_at: string | null;
  readonly unlink_reason: string | null;
}

/** Options for unlinkLink: an explicit unlink REQUIRES a non-empty reason
 *  (mirrors the V12 app-layer unlink_reason-required-iff-unlinked_at
 *  invariant; LINK_UNLINKED.reasonRequired === true). */
export interface UnlinkLinkOptions {
  readonly actor_user_id: string;
  readonly unlink_reason: string;
}

/** Options for relinkLink: relink restores the link to active and clears
 *  unlink_reason, so it takes NO reason (LINK_RELINKED.reasonRequired ===
 *  false). */
export interface RelinkLinkOptions {
  readonly actor_user_id: string;
}

/** Input for createLink: insert a durable, active case_box_links row + emit
 *  LINK_CREATED. The id is GENERATED (never caller-supplied); status starts
 *  provisional `needs_review` (the resolver computes the authoritative status
 *  afterward). */
export interface CreateLinkInput {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly anchor_id: string;
  readonly actor_user_id: string;
}

/** Shared write deps (structurally identical to SqliteWriteDeps). */
export interface LinkWriteDeps {
  readonly generateId: () => string;
  readonly nowIso: () => string;
  readonly storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
  readonly writeAuditEventAndUpdateHead: (audit: StoredAuditEvent, eventHash: string) => void;
}

interface PrepareLinkResult {
  readonly next: CaseBoxLinkRow;
  readonly audit: StoredAuditEvent;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const LINK_COLUMNS =
  "id, tenant_id, matter_id, source_type, source_id, anchor_id, status, created_at, payload_json, unlinked_at, unlink_reason";

function loadLinkForUpdate(db: Database, linkId: string): CaseBoxLinkRow | undefined {
  return db
    .prepare(`SELECT ${LINK_COLUMNS} FROM case_box_links WHERE id = ?`)
    .get(linkId) as CaseBoxLinkRow | undefined;
}

function updateLinkMarkerRow(
  db: Database,
  linkId: string,
  unlinkedAt: string | null,
  unlinkReason: string | null,
): void {
  // Marker columns ONLY — never status (resolver-owned), never payload_json,
  // never a DELETE.
  db.prepare(
    "UPDATE case_box_links SET unlinked_at = ?, unlink_reason = ? WHERE id = ?",
  ).run(unlinkedAt, unlinkReason, linkId);
}

/** The authoritative persisted link state hashed for before/after_state_hash.
 *  EXCLUDES the resolver-derived `status` (non-authoritative), so the audit
 *  hash is independent of resolver timing (review C). */
function linkStateForHash(row: CaseBoxLinkRow): Record<string, unknown> {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    matter_id: row.matter_id,
    source_type: row.source_type,
    source_id: row.source_id,
    anchor_id: row.anchor_id,
    created_at: row.created_at,
    payload_json: row.payload_json,
    unlinked_at: row.unlinked_at,
    unlink_reason: row.unlink_reason,
  };
}

/** Operation-boundary validation common to unlink + relink (review Low L3):
 *  `invalid_argument` is the right boundary error for malformed caller input,
 *  ahead of (and in addition to) the contract builder's reasonRequired guard. */
function requireActor(opts: unknown): string {
  if (typeof opts !== "object" || opts === null) {
    throw new CaseBoxPersistenceError("invalid_argument", "opts must be an object");
  }
  const actor = (opts as { actor_user_id?: unknown }).actor_user_id;
  if (typeof actor !== "string" || actor.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", "opts.actor_user_id must be a non-empty string");
  }
  return actor;
}

// ---------------------------------------------------------------------------
// createLink — insert a durable active row + emit LINK_CREATED
// ---------------------------------------------------------------------------

// The case_box_links.source_type CHECK set (V11 schema). Validated at the
// operation boundary; the schema CHECK is the second guard.
const SOURCE_TYPES = ["evidence", "note", "question", "calcTerm", "claimElement"];

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `${field} must be a non-empty string`);
  }
  return value;
}

function existsScoped(db: Database, table: string, id: string, tenantId: string, matterId: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM ${table} WHERE id = ? AND tenant_id = ? AND matter_id = ?`)
      .get(id, tenantId, matterId) !== undefined
  );
}

function insertLinkRow(db: Database, row: CaseBoxLinkRow): void {
  db.prepare(
    `INSERT INTO case_box_links (${LINK_COLUMNS})
     VALUES (@id, @tenant_id, @matter_id, @source_type, @source_id, @anchor_id, @status, @created_at, @payload_json, @unlinked_at, @unlink_reason)`,
  ).run(row);
}

function prepareCreateLink(db: Database, input: CreateLinkInput, deps: LinkWriteDeps): PrepareLinkResult {
  // Operation-boundary validation — all BEFORE any write, so a rejection leaves
  // no row and no event.
  if (typeof input !== "object" || input === null) {
    throw new CaseBoxPersistenceError("invalid_argument", "input must be an object");
  }
  const tenant_id = requireNonEmpty(input.tenant_id, "input.tenant_id");
  const matter_id = requireNonEmpty(input.matter_id, "input.matter_id");
  const source_id = requireNonEmpty(input.source_id, "input.source_id");
  const anchor_id = requireNonEmpty(input.anchor_id, "input.anchor_id");
  const actor_user_id = requireNonEmpty(input.actor_user_id, "input.actor_user_id");
  const source_type = requireNonEmpty(input.source_type, "input.source_type");
  if (!SOURCE_TYPES.includes(source_type)) {
    throw new CaseBoxPersistenceError("invalid_argument", `input.source_type must be one of ${SOURCE_TYPES.join(", ")}`);
  }

  // Matter exists + tenant match.
  const matterRow = db
    .prepare("SELECT tenant_id FROM case_box_matters WHERE id = ?")
    .get(matter_id) as { tenant_id: string } | undefined;
  if (matterRow === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matter_id}`);
  }
  if (matterRow.tenant_id !== tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `input.tenant_id (${tenant_id}) does not match matter.tenant_id (${matterRow.tenant_id})`,
    );
  }

  // Anchor must exist in the same tenant+matter (require-exists, ADR D4a).
  if (!existsScoped(db, "case_box_anchors", anchor_id, tenant_id, matter_id)) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown anchor: ${anchor_id}`);
  }

  // Evidence-existence (ADR-EXTENSION, review B): for source_type 'evidence' the
  // evidence_item must exist in the same tenant+matter. The other source_types
  // (note/question/calcTerm/claimElement) have no backing table yet — a recorded
  // known gap; only their non-empty source_id is validated above.
  if (source_type === "evidence" && !existsScoped(db, "case_box_evidence_items", source_id, tenant_id, matter_id)) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown evidence item: ${source_id}`);
  }

  const id = deps.generateId();
  // Generated-id collision -> duplicate_id with no row/event (review Low; mirrors
  // createMatter's duplicate check). ULID makes this astronomically rare.
  if (db.prepare("SELECT 1 FROM case_box_links WHERE id = ?").get(id) !== undefined) {
    throw new CaseBoxPersistenceError("duplicate_id", `link id collision: ${id}`);
  }

  // SINGLE operation timestamp: one stamp for BOTH created_at AND the audit event
  // timestamp (the WI-A3-UNLINK-T1 single-stamp rule).
  const stamp = deps.nowIso();
  const payload_json = JSON.stringify({ id, tenant_id, matter_id, source_type, source_id, anchor_id, created_at: stamp });
  const next: CaseBoxLinkRow = {
    id,
    tenant_id,
    matter_id,
    source_type,
    source_id,
    anchor_id,
    status: "needs_review", // provisional; the resolver computes the real status (valid is never a default).
    created_at: stamp,
    payload_json,
    unlinked_at: null,
    unlink_reason: null,
  };

  const stored = deps.storedAuditEventsForMatter(matter_id);
  const built = buildCaseBoxAuditEvent({
    kind: "LINK_CREATED",
    id: deps.generateId(),
    tenant_id,
    actor_user_id,
    matter_id,
    entity_id: id,
    before_state_hash: null, // create: no prior state.
    after_state_hash: entityStateHash(linkStateForHash(next)),
    prev_event_hash: priorHeadOf(stored),
    timestamp: stamp,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected LINK_CREATED: ${built.summary}`);
  }
  return { next, audit: { sequence: stored.length + 1, event: built.value } };
}

export function applyCreateLinkSqlite(db: Database, input: CreateLinkInput, deps: LinkWriteDeps): CaseBoxLinkRow {
  // Build the event + validate BEFORE the row INSERT; insert the row; append the
  // audit event — all in the caller's one BEGIN IMMEDIATE. No row without a chain
  // event, no chain event without a row.
  const prepared = prepareCreateLink(db, input, deps);
  insertLinkRow(db, prepared.next);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHashFn(prepared.audit.event));
  return prepared.next;
}

// ---------------------------------------------------------------------------
// prepareUnlinkLink / prepareRelinkLink — build next row + audit event
// ---------------------------------------------------------------------------

function prepareUnlinkLink(
  row: CaseBoxLinkRow,
  opts: UnlinkLinkOptions,
  deps: LinkWriteDeps,
): PrepareLinkResult {
  const actor = requireActor(opts);
  const reason = (opts as { unlink_reason?: unknown }).unlink_reason;
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      "opts.unlink_reason must be a non-empty, non-blank string",
    );
  }
  if (row.unlinked_at !== null) {
    throw new CaseBoxPersistenceError(
      "illegal_transition",
      `link ${row.id} is already unlinked (unlinked_at is set)`,
    );
  }
  // SINGLE operation timestamp: one stamp for BOTH unlinked_at AND the audit
  // event timestamp (review Medium — the injected clock advances per call).
  const stamp = deps.nowIso();
  const next: CaseBoxLinkRow = { ...row, unlinked_at: stamp, unlink_reason: reason };
  return buildLinkAudit(row, next, "LINK_UNLINKED", actor, stamp, reason, deps);
}

function prepareRelinkLink(
  row: CaseBoxLinkRow,
  opts: RelinkLinkOptions,
  deps: LinkWriteDeps,
): PrepareLinkResult {
  const actor = requireActor(opts);
  // Relink mandates NO reason (LINK_RELINKED.reasonRequired === false) and clears
  // unlink_reason. Reject a reason passed by a JS/IPC caller rather than silently
  // ignoring it — otherwise the caller could believe the reason was audited (audit L1).
  const extra = opts as { unlink_reason?: unknown; reason?: unknown };
  if (extra.unlink_reason !== undefined || extra.reason !== undefined) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      "relink takes no reason; do not pass unlink_reason/reason",
    );
  }
  if (row.unlinked_at === null) {
    throw new CaseBoxPersistenceError(
      "illegal_transition",
      `link ${row.id} is already active (unlinked_at is null)`,
    );
  }
  const stamp = deps.nowIso();
  const next: CaseBoxLinkRow = { ...row, unlinked_at: null, unlink_reason: null };
  // Relink takes no reason and clears unlink_reason (reasonRequired false).
  return buildLinkAudit(row, next, "LINK_RELINKED", actor, stamp, undefined, deps);
}

function buildLinkAudit(
  row: CaseBoxLinkRow,
  next: CaseBoxLinkRow,
  kind: "LINK_UNLINKED" | "LINK_RELINKED",
  actor: string,
  stamp: string,
  reason: string | undefined,
  deps: LinkWriteDeps,
): PrepareLinkResult {
  const stored = deps.storedAuditEventsForMatter(row.matter_id);
  const built = buildCaseBoxAuditEvent({
    kind,
    id: deps.generateId(),
    tenant_id: row.tenant_id,
    actor_user_id: actor,
    matter_id: row.matter_id,
    entity_id: row.id,
    before_state_hash: entityStateHash(linkStateForHash(row)),
    after_state_hash: entityStateHash(linkStateForHash(next)),
    prev_event_hash: priorHeadOf(stored),
    timestamp: stamp,
    ...(reason !== undefined ? { reason } : {}),
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError(
      "invalid_payload",
      `audit-event builder rejected ${kind}: ${built.summary}`,
    );
  }
  return { next, audit: { sequence: stored.length + 1, event: built.value } };
}

// ---------------------------------------------------------------------------
// applyUnlinkLinkSqlite / applyRelinkLinkSqlite — caller-transaction-wrapped
// ---------------------------------------------------------------------------

function applyLink(
  db: Database,
  linkId: string,
  prepare: (row: CaseBoxLinkRow) => PrepareLinkResult,
  deps: LinkWriteDeps,
): CaseBoxLinkRow {
  if (typeof linkId !== "string" || linkId.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", "linkId must be a non-empty string");
  }
  const row = loadLinkForUpdate(db, linkId);
  if (row === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown link: ${linkId}`);
  }
  // Build the event BEFORE the row UPDATE; write the marker; then append the
  // audit event — all in the caller's one BEGIN IMMEDIATE. No marker mutation
  // without a chain event, no chain event without a marker mutation.
  const prepared = prepare(row);
  updateLinkMarkerRow(db, linkId, prepared.next.unlinked_at, prepared.next.unlink_reason);
  deps.writeAuditEventAndUpdateHead(prepared.audit, eventHashFn(prepared.audit.event));
  return prepared.next;
}

export function applyUnlinkLinkSqlite(
  db: Database,
  linkId: string,
  opts: UnlinkLinkOptions,
  deps: LinkWriteDeps,
): CaseBoxLinkRow {
  return applyLink(db, linkId, (row) => prepareUnlinkLink(row, opts, deps), deps);
}

export function applyRelinkLinkSqlite(
  db: Database,
  linkId: string,
  opts: RelinkLinkOptions,
  deps: LinkWriteDeps,
): CaseBoxLinkRow {
  return applyLink(db, linkId, (row) => prepareRelinkLink(row, opts, deps), deps);
}
