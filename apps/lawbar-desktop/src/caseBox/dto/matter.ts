// Matter IPC DTOs / allowlists / result types (WI-DTO1 split from dto.ts).
import type { CaseBoxMatter } from "case-box-contract";
import type { IpcEnvelope } from "./shared.js";


export interface CreateMatterDto {
  readonly name: string;
  readonly matter_type:
    | "litigation"
    | "arbitration"
    | "advisory"
    | "due_diligence"
    | "criminal_defense"
    | "other";
  readonly jurisdiction: { readonly value: string; readonly locked: boolean };
  readonly parties: ReadonlyArray<{
    readonly role: string;
    readonly display_name: string;
    readonly party_kind: string;
    readonly notes?: string;
  }>;
  readonly confidentiality_class: "normal" | "heightened" | "sealed";
  readonly retainer_scope?: string;
  readonly case_type_text?: string;
  readonly case_progress_text?: string;
  readonly court_contact_text?: string;
  readonly contention_summary_text?: string;
}


export interface GetMatterDto {
  readonly matterId: string;
}


export interface ListMattersDto {
  readonly status?: "active" | "archived";
  readonly limit?: number;
  readonly cursor?: string;
}


export interface ArchiveMatterDto {
  readonly matterId: string;
  readonly reason: string;
}


export const CREATE_MATTER_DTO_FIELDS = Object.freeze([
  "name",
  "matter_type",
  "jurisdiction",
  "parties",
  "confidentiality_class",
  "retainer_scope",
  "case_type_text",
  "case_progress_text",
  "court_contact_text",
  "contention_summary_text",
] as const);


export const CREATE_MATTER_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenant_id",
  "actor_user_id",
  "created_at",
  "status",
  "archived_at",
  "successor_matter_id",
  "custody_chain",
  "external_ocr_authorized",
  "sync_grant_present",
  "llm_extraction_opt_in",
  "litigation_position",
] as const);


export const LIST_MATTERS_DTO_FIELDS = Object.freeze([
  "status",
  "limit",
  "cursor",
] as const);


export const LIST_MATTERS_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
] as const);


export const ARCHIVE_MATTER_DTO_FIELDS = Object.freeze([
  "matterId",
  "reason",
] as const);


export const ARCHIVE_MATTER_FORBIDDEN_FIELDS = Object.freeze([
  "actor_user_id",
  "tenant_id",
] as const);


export const GET_MATTER_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);


export const GET_MATTER_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
  "id",
  "status",
  "archived_at",
  "successor_matter_id",
] as const);


// MATTER-AUD-1 / REGDOC-AUD-1 sweep: response projection for the matter channels
// (create / get / list / archive), mirroring the FACTS-AUD-3 list-channel projection.
// Raw CaseBoxMatter carries server-authority fields (tenant_id, actor_user_id) and an
// open `[k: string]: unknown` index; the main process MUST project every returned
// matter through this allowlist BEFORE returning. ONE shared allowlist covers all four
// channels (each renderer screen reads a subset; the union is the viewMatter detail
// set). It is exactly the renderer-consumed display fields — `id` is REQUIRED (routing /
// data-matter-id / nested API calls; a stable identifier, not authority) — and NOTHING
// else (projectRow copies only allowlisted keys, so the open index cannot leak extras).
// EXCLUDES tenant_id / actor_user_id and the non-consumed opt-in/successor flags.
export const MATTER_RESPONSE_FIELDS = Object.freeze([
  "id",
  "name",
  "matter_type",
  "jurisdiction",
  "parties",
  "confidentiality_class",
  "status",
  "created_at",
  "archived_at",
  "retainer_scope",
  "case_type_text",
  "case_progress_text",
  "court_contact_text",
  "contention_summary_text",
] as const);

export type RendererMatter = Pick<
  CaseBoxMatter,
  (typeof MATTER_RESPONSE_FIELDS)[number]
>;

export interface RendererMattersPage {
  readonly rows: ReadonlyArray<RendererMatter>;
  readonly next_cursor: string | null;
}

export type CreateMatterResult = IpcEnvelope<RendererMatter>;

export type GetMatterResult = IpcEnvelope<RendererMatter | null>;

export type ListMattersResult = IpcEnvelope<RendererMattersPage>;

export type ArchiveMatterResult = IpcEnvelope<RendererMatter>;
