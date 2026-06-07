// Matter IPC DTOs / allowlists / result types (WI-DTO1 split from dto.ts).
import type { ListMattersPage } from "case-box-persistence";
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


export type CreateMatterResult = IpcEnvelope<CaseBoxMatter>;

export type GetMatterResult = IpcEnvelope<CaseBoxMatter | null>;

export type ListMattersResult = IpcEnvelope<ListMattersPage>;

export type ArchiveMatterResult = IpcEnvelope<CaseBoxMatter>;
