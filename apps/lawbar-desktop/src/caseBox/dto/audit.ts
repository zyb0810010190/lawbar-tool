// Audit (chain-head + list-events) IPC DTOs / allowlists / result types (WI-DTO1).
import type { AuditChainHead, ListAuditEventsPage } from "case-box-persistence";
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

export type ListAuditEventsResult = IpcEnvelope<ListAuditEventsPage>;
