// SQL helpers for SqliteCaseBoxPersistence — extracted from
// SqliteCaseBoxPersistence.ts to keep the class under the LOC-01
// extraction trigger (B1 plan §5; rev-1 audit Dim-4 #1). Each helper
// is single-statement; sequencing + transactionality is the caller's
// responsibility.

import type { Database } from "better-sqlite3";

import type { StoredAuditEvent } from "../auditChain.js";
import type { CaseBoxMatter } from "case-box-contract";

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
  db.prepare(
    `UPDATE case_box_matters
       SET status = ?, archived_at = ?, payload_json = ?
     WHERE id = ?`,
  ).run(m.status, m.archived_at ?? null, JSON.stringify(m), m.id);
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
