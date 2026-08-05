// SQL helpers for SqliteCaseBoxPersistence — extracted from
// SqliteCaseBoxPersistence.ts to keep the class under the LOC-01
// extraction trigger (B1 plan §5; rev-1 audit Dim-4 #1). Each helper
// is single-statement; sequencing + transactionality is the caller's
// responsibility.

import type { Database } from "better-sqlite3";

import type { StoredAuditEvent } from "../auditChain.js";
import type { CaseBoxAuditEvent, CaseBoxMatter } from "case-box-contract";
import { CaseBoxPersistenceError } from "../errors.js";

export function insertMatterRow(db: Database, m: CaseBoxMatter): void {
  db.prepare(
    `INSERT INTO case_box_matters
       (id, tenant_id, actor_user_id, status, archived_at, created_at, matter_type, successor_matter_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    m.id,
    m.tenant_id,
    m.actor_user_id,
    m.status,
    m.archived_at ?? null,
    m.created_at,
    m.matter_type,
    m.successor_matter_id ?? null,
    JSON.stringify(m),
  );
}

export function updateMatterRow(db: Database, m: CaseBoxMatter): void {
  // Atomic-consistency hardening (WI-PTA-VS0): scope to the row's own
  // tenant_id and assert exactly one affected row so a matter-id / tenant
  // drift raises rather than silently no-ops (mirrors the fact / privilege /
  // deadline / evidence / docket scoped-update discipline).
  const info = db
    .prepare(
      `UPDATE case_box_matters
         SET status = ?, archived_at = ?, payload_json = ?
       WHERE id = ? AND tenant_id = ?`,
    )
    .run(m.status, m.archived_at ?? null, JSON.stringify(m), m.id, m.tenant_id);
  if (info.changes !== 1) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `matter scoped update affected ${info.changes} rows, expected 1 (tenant scope drift for id=${m.id})`,
    );
  }
}

/**
 * matter-details-edit Phase B (audit finding H) — SQLite-ONLY write-time
 * head-consistency guard (defense-in-depth, mirroring the VS-0 fail-closed
 * pattern). The SQLite next-sequence is derived from
 * `case_box_audit_chain_heads.event_count` (via `loadSyntheticStoredEvents` →
 * `stored.length + 1`); a stale/corrupted head row whose `event_count` is out of
 * step with the events table would otherwise let an append pick a wrong sequence
 * and advance the head while `event_count != COUNT(*)`. Assert the head agrees
 * with `COUNT(*)` / `MAX(sequence)` (and that the head's `last_event_id` row sits
 * at `event_count`) BEFORE deriving the next sequence, so a mismatch inside
 * `BEGIN IMMEDIATE` rolls the whole transaction back — no event, no head advance,
 * no payload rewrite. The in-memory impl is immune (it derives length from the
 * real event array), so this guard is SQLite-only. The shared write path
 * (`archiveMatter` / `ensureMatterPartyIds`) carries the same gap and is hardened
 * in a SEPARATE follow-up WI; those methods are intentionally left unchanged here.
 */
export function assertMatterAuditHeadConsistent(db: Database, matterId: string): void {
  const agg = db
    .prepare(
      "SELECT COUNT(*) AS c, COALESCE(MAX(sequence), 0) AS m FROM case_box_audit_events WHERE matter_id = ?",
    )
    .get(matterId) as { c: number; m: number };
  const head = db
    .prepare("SELECT event_count, last_event_id FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(matterId) as { event_count: number; last_event_id: string | null } | undefined;
  // A matter under edit always has a MATTER_REGISTERED head row; its absence is
  // itself a corruption (mirrors the pure core's no-prior-matter-event guard).
  if (head === undefined) {
    throw new CaseBoxPersistenceError(
      "audit_chain_desync",
      `matter ${matterId} audit head is missing (event_count/head row absent) — refusing to append`,
    );
  }
  if (head.event_count !== agg.c || head.event_count !== agg.m) {
    throw new CaseBoxPersistenceError(
      "audit_chain_desync",
      `matter ${matterId} audit head is inconsistent ` +
        `(event_count=${head.event_count} != COUNT(*)=${agg.c}/MAX(sequence)=${agg.m}) — refusing to append`,
    );
  }
  // Cheap extra check: the head's declared last event sits at sequence == event_count.
  if (head.last_event_id !== null) {
    const lastSeq = db
      .prepare("SELECT sequence FROM case_box_audit_events WHERE event_id = ?")
      .get(head.last_event_id) as { sequence: number } | undefined;
    if (lastSeq === undefined || lastSeq.sequence !== head.event_count) {
      throw new CaseBoxPersistenceError(
        "audit_chain_desync",
        `matter ${matterId} audit head last_event_id sequence (${lastSeq?.sequence ?? "missing"}) ` +
          `!= event_count (${head.event_count}) — refusing to append`,
      );
    }
  }
}

/**
 * matter-details-edit Phase B (D4a) — the LATEST PRIOR audit event scoped to this
 * matter (entity_type="matter" AND entity_id=matterId), ordered by the per-matter
 * monotonic `sequence` DESC. Read inside the same write transaction that appends
 * the new event, so the continuity baseline cannot race a concurrent update. Note
 * this is NOT `loadSyntheticStoredEvents` (whose padding placeholders copy the
 * GLOBAL head event and would misreport entity_type when the head is a non-matter
 * event); this query filters on the matter entity directly.
 */
export function selectLatestMatterEvent(db: Database, matterId: string): StoredAuditEvent | undefined {
  const row = db
    .prepare(
      `SELECT event_json, sequence FROM case_box_audit_events
        WHERE matter_id = ? AND entity_type = 'matter' AND entity_id = ?
        ORDER BY sequence DESC LIMIT 1`,
    )
    .get(matterId, matterId) as { event_json: string; sequence: number } | undefined;
  if (row === undefined) return undefined;
  return { sequence: row.sequence, event: JSON.parse(row.event_json) as CaseBoxAuditEvent };
}

export function insertAuditEvent(
  db: Database,
  stored: StoredAuditEvent,
  eventHash: string,
): void {
  const e = stored.event;
  db.prepare(
    `INSERT INTO case_box_audit_events
       (event_id, tenant_id, matter_id, sequence, action, entity_type, entity_id,
        actor_user_id, timestamp, before_state_hash, after_state_hash, prev_event_hash,
        event_hash, reason, event_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.id,
    e.tenant_id,
    e.matter_id,
    stored.sequence,
    e.action,
    e.entity_type,
    e.entity_id ?? null,
    e.actor_user_id,
    e.timestamp,
    e.before_state_hash ?? null,
    e.after_state_hash ?? null,
    e.prev_event_hash ?? null,
    eventHash,
    e.reason ?? null,
    JSON.stringify(e),
  );
}

export function upsertAuditChainHead(
  db: Database,
  matterId: string,
  lastEventId: string,
  eventCount: number,
  updatedAt: string,
  headHash: string,
): void {
  // head_hash == event_hash of the just-inserted event (per case-box-step-4
  // ADR + auditChain.ts priorHeadOf). Caller passes the hash computed via
  // eventHashFn so we don't round-trip through the DB.
  db.prepare(
    `INSERT INTO case_box_audit_chain_heads (matter_id, head_hash, last_event_id, event_count, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(matter_id) DO UPDATE SET
       head_hash = excluded.head_hash,
       last_event_id = excluded.last_event_id,
       event_count = excluded.event_count,
       updated_at = excluded.updated_at`,
  ).run(matterId, headHash, lastEventId, eventCount, updatedAt);
}
