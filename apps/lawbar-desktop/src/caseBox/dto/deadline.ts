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
