// Deadline (read) IPC DTOs / allowlist / projected row + result types (WI-DTO1).
import type { CaseBoxDeadline } from "case-box-contract";
import type { IpcEnvelope } from "./shared.js";


export interface ListDeadlinesDto {
  readonly matterId: string;
  readonly limit?: number;
  readonly cursor?: string;
}


export const LIST_DEADLINES_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);


export const LIST_DEADLINES_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);


export const LIST_DEADLINES_RESPONSE_FIELDS = Object.freeze([
  "id",
  "matter_id",
  "kind",
  "source_rule_citation",
  "due_at",
  "owner_user_id",
  "status",
  "met_at",
  "previous_status",
  "transition_reason",
] as const);

export type RendererDeadlineRow = Pick<
  CaseBoxDeadline,
  (typeof LIST_DEADLINES_RESPONSE_FIELDS)[number]
>;

export interface ListDeadlinesPage {
  readonly rows: ReadonlyArray<RendererDeadlineRow>;
  readonly next_cursor: string | null;
}

export type ListDeadlinesResult = IpcEnvelope<ListDeadlinesPage>;


// --- Deadline status transition (WI-DT1) ---
// Targets the persistence deadline edges: pending -> met|missed|withdrawn, and
// missed -> met (audit-reason-required). The renderer never sends an edge it is
// not entitled to; persistence is the authority and surfaces illegal_transition.
export type DeadlineTransitionTarget = "met" | "missed" | "withdrawn";


export interface TransitionDeadlineDto {
  readonly matterId: string;
  readonly deadlineId: string;
  readonly to: DeadlineTransitionTarget;
  readonly transition_reason?: string;
}


export const TRANSITION_DEADLINE_DTO_FIELDS = Object.freeze([
  "matterId",
  "deadlineId",
  "to",
  "transition_reason",
] as const);


// Server-authority / lifecycle / persistence-computed fields forbidden from the
// renderer transition DTO (the server injects actor_user_id + at; persistence
// computes status / met_at / previous_status). matter_id is forbidden because the
// renderer uses matterId. transition_reason is the one legit optional input and is
// therefore NOT forbidden (its required/forbidden-by-edge rule lives in the handler).
export const TRANSITION_DEADLINE_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenant_id",
  "actor_user_id",
  "matter_id",
  "at",
  "status",
  "met_at",
  "previous_status",
] as const);


// Dedicated transition-response allowlist (a SEPARATE constant from
// LIST_DEADLINES_RESPONSE_FIELDS — write-response contracts may diverge — though it
// currently enumerates the same non-authority deadline fields). STRIPS the authority
// identities tenant_id / actor_user_id.
export const TRANSITION_DEADLINE_RESPONSE_FIELDS = Object.freeze([
  "id",
  "matter_id",
  "kind",
  "source_rule_citation",
  "due_at",
  "owner_user_id",
  "status",
  "met_at",
  "previous_status",
  "transition_reason",
] as const);

export type RendererTransitionedDeadlineRow = Pick<
  CaseBoxDeadline,
  (typeof TRANSITION_DEADLINE_RESPONSE_FIELDS)[number]
>;

export type TransitionDeadlineResult = IpcEnvelope<RendererTransitionedDeadlineRow>;
