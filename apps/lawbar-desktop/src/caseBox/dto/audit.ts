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
  // v2 (ADR audit-event-kind-preservation): the normalized, emitter-chosen kind the audit panel maps
  // to a humanized label. Display metadata, NOT a server-authority field — safe to project. The v2
  // audit_schema_version stays INTERNAL (hash-format selector) and is deliberately NOT projected.
  "event_kind",
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


export interface VerifyChainDto {
  readonly matterId: string;
}


export const VERIFY_CHAIN_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);


export const VERIFY_CHAIN_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);

// GAP-2: renderer-facing projection of the persistence `VerifyAuditChainResult`.
//
// The persistence result is `ChainVerifyOk | ChainVerifyErr`. ChainVerifyErr carries a free-text
// `detail` built by the contract verifier, and two of its nine branches INTERPOLATE SERVER-AUTHORITY
// FIELDS into that string:
//
//   event[i].tenant_id (...) does not match prior chain tenant_id (...)
//   event[i].matter_id (...) does not match prior chain matter_id (...)
//
// LIST_AUDIT_EVENTS_RESPONSE_FIELDS above deliberately EXCLUDES tenant_id / matter_id from the
// neighbouring channel; passing `detail` through verbatim would reintroduce exactly those values
// via a string the allowlist cannot inspect. So `detail` is DROPPED at the boundary, not forwarded.
//
// Nothing diagnostic is lost to the user: `errorReason` names which of the nine invariants broke and
// `errorIndex` names the offending event's position, which is what the UI renders. The unprojected
// `detail` remains available to a forensic examiner through the persistence API and the database —
// the two places an expert would actually look, and neither of which crosses this boundary.
export type RendererChainVerifyResult =
  | { readonly ok: true; readonly verifiedCount: number; readonly headHash: string | null }
  | { readonly ok: false; readonly errorIndex: number; readonly errorReason: string };

// NOTE the deliberate double envelope: a DETECTED TAMPER IS A SUCCESSFUL CALL. The outer
// IpcEnvelope reports whether verification RAN; the inner `ok` reports what it FOUND. Collapsing
// the two would render a broken chain — the one result this feature exists to surface — as a
// generic IPC failure, indistinguishable from a bug.
export type VerifyChainResult = IpcEnvelope<RendererChainVerifyResult>;
