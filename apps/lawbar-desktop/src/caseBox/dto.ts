import type {
  CaseBoxPersistenceErrorCode,
  AuditChainHead,
  ListAuditEventsPage,
  ListDocumentsPage,
  ListDeadlinesPage,
  ListMattersPage,
} from "case-box-persistence";
import type { CaseBoxMatter, CaseBoxDocument } from "case-box-contract";

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

export interface ChainHeadDto {
  readonly matterId: string;
}

export interface ListAuditEventsDto {
  readonly matterId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ListDocumentsDto {
  readonly matterId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface GetDocumentDto {
  readonly matterId: string;
  readonly documentId: string;
}

export type DocType =
  | "pleading"
  | "contract"
  | "correspondence"
  | "transcript"
  | "exhibit"
  | "other";

// Register a local document into a matter. The file itself is chosen via the
// main-process dialog (the renderer never supplies a filesystem path); the
// renderer only declares the document kind. content_hash, storage_uri,
// received_at, status, source, id, tenant_id, actor_user_id are all computed/
// injected server-side.
export interface RegisterDocumentDto {
  readonly matterId: string;
  readonly doc_type: DocType;
}

export interface ListDeadlinesDto {
  readonly matterId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export type IpcEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IpcErrorEnvelope };

export interface IpcErrorEnvelope {
  readonly kind: "case_box_persistence_error";
  readonly code: CaseBoxPersistenceErrorCode;
  readonly message: string;
  readonly details?: { readonly schemaPath?: string; readonly keyword?: string };
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

export const LIST_DOCUMENTS_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);

export const LIST_DOCUMENTS_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);

export const GET_DOCUMENT_DTO_FIELDS = Object.freeze([
  "matterId",
  "documentId",
] as const);

export const GET_DOCUMENT_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);

export const REGISTER_DOCUMENT_DTO_FIELDS = Object.freeze([
  "matterId",
  "doc_type",
] as const);

// Every server-computed / server-authority document field is forbidden from the
// renderer DTO: identity, scope, content/storage facts, lifecycle, and source.
export const REGISTER_DOCUMENT_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenant_id",
  "actor_user_id",
  "content_hash",
  "storage_uri",
  "received_at",
  "status",
  "source",
  "filename",
  "byte_size",
  "custody_chain",
] as const);

export const LIST_DEADLINES_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);

export const LIST_DEADLINES_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);

export const MAX_LIST_LIMIT = 200;
export const MAX_CURSOR_LENGTH = 512;

export type CreateMatterResult = IpcEnvelope<CaseBoxMatter>;
export type GetMatterResult = IpcEnvelope<CaseBoxMatter | null>;
export type ListMattersResult = IpcEnvelope<ListMattersPage>;
export type ArchiveMatterResult = IpcEnvelope<CaseBoxMatter>;
export type ChainHeadResult = IpcEnvelope<AuditChainHead>;
export type ListAuditEventsResult = IpcEnvelope<ListAuditEventsPage>;
export type ListDocumentsResult = IpcEnvelope<ListDocumentsPage>;
export type GetDocumentResult = IpcEnvelope<CaseBoxDocument | null>;
// value === null signals the user cancelled the file-chooser dialog.
export type RegisterDocumentResult = IpcEnvelope<CaseBoxDocument | null>;
export type ListDeadlinesResult = IpcEnvelope<ListDeadlinesPage>;
