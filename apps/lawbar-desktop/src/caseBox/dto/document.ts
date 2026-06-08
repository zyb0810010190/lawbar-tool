// Document IPC DTOs / allowlists / response projections / result types (WI-DTO1).
import type { CaseBoxDocument } from "case-box-contract";
import type { IpcEnvelope } from "./shared.js";


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


export const LIST_DOCUMENTS_RESPONSE_FIELDS = Object.freeze([
  "id",
  "filename",
  "doc_type",
  "status",
  "received_at",
  "content_hash",
  "storage_uri",
  "page_count",
  "language",
  "mime_type",
  "byte_size",
  "matter_id",
  "source",
  "ocr_job_id",
  "submission_hash",
  "purpose",
  "work_order_status",
  "supersedes_document_id",
  "letter_date",
  "service_status",
  "client_authorization_summary",
  "preliminary_evidence_summary",
  "review_date",
  "final_version_marker",
  "manual_extracted_text",
] as const);


// GET-AUD-1: the get-document channel (`getDocumentHandler`) returns a SINGLE
// document; it carries the same server-authority identity fields as the list
// rows (tenant_id / actor_user_id / custody_chain) and must be projected the
// same way before crossing the IPC boundary. This allowlist is deliberately a
// SEPARATE constant from LIST_DOCUMENTS_RESPONSE_FIELDS — get (detail view) and
// list (row view) are distinct view contracts that may diverge later — even
// though they currently enumerate the same non-authority document fields. The
// document detail view reads a strict SUBSET of these (content_hash /
// storage_uri / page_count / language / mime_type / byte_size, plus the list
// columns), so no field beyond the list set is needed today.
export const GET_DOCUMENT_RESPONSE_FIELDS = Object.freeze([
  "id",
  "filename",
  "doc_type",
  "status",
  "received_at",
  "content_hash",
  "storage_uri",
  "page_count",
  "language",
  "mime_type",
  "byte_size",
  "matter_id",
  "source",
  "ocr_job_id",
  "submission_hash",
  "purpose",
  "work_order_status",
  "supersedes_document_id",
  "letter_date",
  "service_status",
  "client_authorization_summary",
  "preliminary_evidence_summary",
  "review_date",
  "final_version_marker",
  "manual_extracted_text",
] as const);

export type RendererDocumentRow = Pick<
  CaseBoxDocument,
  (typeof LIST_DOCUMENTS_RESPONSE_FIELDS)[number]
>;

// GET-AUD-1: renderer-safe projected SINGLE document for the get-document
// channel — same Pick-over-allowlist pattern, closed type tied to the runtime
// GET_DOCUMENT_RESPONSE_FIELDS allowlist.
export type RendererDocumentDetail = Pick<
  CaseBoxDocument,
  (typeof GET_DOCUMENT_RESPONSE_FIELDS)[number]
>;

// REGDOC-AUD-1: response projection for the document:register write channel. A
// SEPARATE constant from GET_DOCUMENT_RESPONSE_FIELDS (write- vs detail-view
// contracts may diverge) though it currently enumerates the same renderer-safe
// document fields. Excludes the authority/internal fields tenant_id /
// actor_user_id / custody_chain (+ the open index, via the projectRow allowlist).
// The renderer only null-checks the register result, so a minimal mirror suffices.
export const REGISTER_DOCUMENT_RESPONSE_FIELDS = Object.freeze([
  "id",
  "filename",
  "doc_type",
  "status",
  "received_at",
  "content_hash",
  "storage_uri",
  "page_count",
  "language",
  "mime_type",
  "byte_size",
  "matter_id",
  "source",
  "ocr_job_id",
  "submission_hash",
  "purpose",
  "work_order_status",
  "supersedes_document_id",
  "letter_date",
  "service_status",
  "client_authorization_summary",
  "preliminary_evidence_summary",
  "review_date",
  "final_version_marker",
  "manual_extracted_text",
] as const);

export type RendererRegisteredDocument = Pick<
  CaseBoxDocument,
  (typeof REGISTER_DOCUMENT_RESPONSE_FIELDS)[number]
>;

export interface ListDocumentsPage {
  readonly rows: ReadonlyArray<RendererDocumentRow>;
  readonly next_cursor: string | null;
}

export type ListDocumentsResult = IpcEnvelope<ListDocumentsPage>;

// value === null signals the document is absent / out of matter+tenant scope.
export type GetDocumentResult = IpcEnvelope<RendererDocumentDetail | null>;

// value === null signals the user cancelled the file-chooser dialog.
export type RegisterDocumentResult = IpcEnvelope<RendererRegisteredDocument | null>;
