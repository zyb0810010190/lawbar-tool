import type {
  CaseBoxPersistenceErrorCode,
  AuditChainHead,
  ListAuditEventsPage,
  ListMattersPage,
} from "case-box-persistence";
import type {
  CaseBoxMatter,
  CaseBoxDocument,
  CaseBoxDeadline,
  CaseBoxFact,
} from "case-box-contract";

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

export interface ListFactsDto {
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

export const LIST_FACTS_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);

export const LIST_FACTS_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);

// Renderer-safe RESPONSE-row allowlists (FACTS-AUD-3). Each list handler
// projects every persistence row through the matching allowlist before
// returning, so server-authority fields never cross the IPC boundary. The
// excluded fields are exactly the per-entity authority fields:
//   facts:     tenant_id, actor_user_id, reviewer_actor_user_id
//   documents: tenant_id, actor_user_id, custody_chain
//   deadlines: tenant_id, actor_user_id
// Provenance / lifecycle fields the renderer does not yet read are retained so
// future read-only UI can render them without a contract change. content_hash /
// storage_uri / ocr_job_id / submission_hash stay in the documents allowlist:
// they are not actor identities and the document detail view reads them.

export const LIST_FACTS_RESPONSE_FIELDS = Object.freeze([
  "id",
  "statement_text",
  "status",
  "source_type",
  "source_document_id",
  "source_page_number",
  "source_excerpt",
  "source_ocr_job_id",
  "extractor_name",
  "extractor_version",
  "extraction_confidence",
  "reviewed_at",
  "accepted_at",
  "rejected_at",
  "rejection_reason",
  "supersedes_fact_id",
  "created_at",
  "purpose",
  "as_of_date",
  "matter_id",
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

export const MAX_LIST_LIMIT = 200;
export const MAX_CURSOR_LENGTH = 512;

// Renderer-safe projected row types (FACTS-AUD-3). The list handlers project
// each persistence row through the matching *_RESPONSE_FIELDS allowlist, so the
// renderer-facing row is exactly the allowlisted keys of the contract entity.
// Modelled as `Pick<Entity, (typeof *_RESPONSE_FIELDS)[number]>` — NOT `Omit` —
// because the generated `CaseBox*` contract types carry a `[k: string]: unknown`
// index signature that survives `Omit`, leaving the stripped authority fields
// still reachable (as `unknown`) on the result type. `Pick` over the allowlist
// tuple yields a CLOSED type with no index signature, so an authority field is a
// compile error, and it ties the row type to the single runtime source of truth
// (the allowlist) — type and projection cannot drift apart.
export type RendererFactRow = Pick<CaseBoxFact, (typeof LIST_FACTS_RESPONSE_FIELDS)[number]>;
export type RendererDocumentRow = Pick<
  CaseBoxDocument,
  (typeof LIST_DOCUMENTS_RESPONSE_FIELDS)[number]
>;
export type RendererDeadlineRow = Pick<
  CaseBoxDeadline,
  (typeof LIST_DEADLINES_RESPONSE_FIELDS)[number]
>;
// GET-AUD-1: renderer-safe projected SINGLE document for the get-document
// channel — same Pick-over-allowlist pattern, closed type tied to the runtime
// GET_DOCUMENT_RESPONSE_FIELDS allowlist.
export type RendererDocumentDetail = Pick<
  CaseBoxDocument,
  (typeof GET_DOCUMENT_RESPONSE_FIELDS)[number]
>;

// Projected (renderer-safe) page shapes returned by the list handlers. Same
// `{ rows, next_cursor }` shape as the persistence pages, but with authority
// fields stripped from every row.
export interface ListFactsPage {
  readonly rows: ReadonlyArray<RendererFactRow>;
  readonly next_cursor: string | null;
}
export interface ListDocumentsPage {
  readonly rows: ReadonlyArray<RendererDocumentRow>;
  readonly next_cursor: string | null;
}
export interface ListDeadlinesPage {
  readonly rows: ReadonlyArray<RendererDeadlineRow>;
  readonly next_cursor: string | null;
}

export type CreateMatterResult = IpcEnvelope<CaseBoxMatter>;
export type GetMatterResult = IpcEnvelope<CaseBoxMatter | null>;
export type ListMattersResult = IpcEnvelope<ListMattersPage>;
export type ArchiveMatterResult = IpcEnvelope<CaseBoxMatter>;
export type ChainHeadResult = IpcEnvelope<AuditChainHead>;
export type ListAuditEventsResult = IpcEnvelope<ListAuditEventsPage>;
export type ListDocumentsResult = IpcEnvelope<ListDocumentsPage>;
// value === null signals the document is absent / out of matter+tenant scope.
export type GetDocumentResult = IpcEnvelope<RendererDocumentDetail | null>;
// value === null signals the user cancelled the file-chooser dialog.
export type RegisterDocumentResult = IpcEnvelope<CaseBoxDocument | null>;
export type ListDeadlinesResult = IpcEnvelope<ListDeadlinesPage>;
export type ListFactsResult = IpcEnvelope<ListFactsPage>;
