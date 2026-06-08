// Audit (chain-head + list-events) IPC DTOs / allowlists / result types (WI-DTO1).
import type { AuditChainHead } from "case-box-persistence";
import type { CaseBoxAuditEvent } from "case-box-contract";
import type { IpcEnvelope } from "./shared.js";


export interface ChainHeadDto {
  readonly matterId: string;
}


export interface ListAuditEventsDto {
  readonly matterId: string;
  readonly limit?: number;
  readonly cursor?: string;
}


export const CHAIN_HEAD_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);


export const CHAIN_HEAD_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);


export const LIST_AUDIT_EVENTS_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);


export const LIST_AUDIT_EVENTS_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);

export type ChainHeadResult = IpcEnvelope<AuditChainHead>;


// AUDIT-AUD-1: response projection for casebox:audit:listEvents (mirrors the
// FACTS-AUD-3 list-channel projection). The persistence CaseBoxAuditEvent carries
// server-authority fields (tenant_id, actor_user_id, matter_id, the event id) and
// an open `[k: string]: unknown` index; the main process MUST project every row
// through this allowlist BEFORE returning so authority/internal fields never cross
// the IPC boundary. The set is exactly the renderer-consumed display fields
// (timestamp/action/entity_type/entity_id/reason) plus the audit-chain-verification
// hashes — and NOTHING else (projectRow copies only allowlisted keys, so the open
// index cannot leak extras). EXCLUDES tenant_id / actor_user_id / id / matter_id.
export const LIST_AUDIT_EVENTS_RESPONSE_FIELDS = Object.freeze([
  "action",
  "entity_type",
  "entity_id",
  "timestamp",
  "reason",
  "before_state_hash",
  "after_state_hash",
  "prev_event_hash",
] as const);

export type RendererAuditEventRow = Pick<
  CaseBoxAuditEvent,
  (typeof LIST_AUDIT_EVENTS_RESPONSE_FIELDS)[number]
>;

export interface RendererAuditEventsPage {
  readonly rows: ReadonlyArray<RendererAuditEventRow>;
  readonly next_cursor: string | null;
}

export type ListAuditEventsResult = IpcEnvelope<RendererAuditEventsPage>;
