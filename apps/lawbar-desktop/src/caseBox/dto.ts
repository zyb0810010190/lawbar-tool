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
  CaseBoxDocketEntry,
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

// ---------------------------------------------------------------------------
// WI-601: docket-entry create + confirm (deadline write path). The renderer
// supplies ONLY the manual-entry fields; the server injects every authority /
// provenance / lifecycle field (the full D1-manual CaseBoxDocketEntry shape).
// ---------------------------------------------------------------------------

// Create (propose) a manual (D1) docket entry. Renderer-supplied fields only.
export interface CreateDocketEntryDto {
  readonly matterId: string;
  readonly proposed_kind: string;
  readonly proposed_due_at: string;
  readonly proposed_due_at_timezone: string;
  readonly proposed_owner_user_id?: string;
}
export const CREATE_DOCKET_DTO_FIELDS = Object.freeze([
  "matterId",
  "proposed_kind",
  "proposed_due_at",
  "proposed_due_at_timezone",
  "proposed_owner_user_id",
] as const);
// Server-authority / server-injected / provenance / lifecycle fields forbidden
// from the renderer create DTO (the server constructs them).
export const CREATE_DOCKET_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenant_id",
  "actor_user_id",
  "source_type",
  "proposed_due_at_kind",
  "source_rule_citation",
  "extractor_name",
  "extractor_version",
  "extraction_confidence",
  "source_document_id",
  "source_page_number",
  "source_excerpt",
  "reminder_offsets",
  "confirmation_state",
  "proposed_at",
  "confirmation_actor_user_id",
  "confirmed_at",
  "confirmed_deadline_id",
  "dismissal_actor_user_id",
  "dismissed_at",
  "dismissal_reason",
  "created_at",
] as const);

// Confirm a proposed docket entry (materializes the deadline). Renderer supplies
// only the scope (matterId) + the entry to confirm; the server injects the
// confirmation actor, timestamp, and new deadline id.
export interface ConfirmDocketEntryDto {
  readonly matterId: string;
  readonly entryId: string;
}
export const CONFIRM_DOCKET_DTO_FIELDS = Object.freeze(["matterId", "entryId"] as const);
export const CONFIRM_DOCKET_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
  "confirmation_actor_user_id",
  "confirmed_at",
  "deadline_id",
  "confirmed_deadline_id",
] as const);

// Renderer-safe docket-entry response allowlist — every CaseBoxDocketEntry field
// EXCEPT the actor/tenant authority identities (tenant_id, actor_user_id,
// confirmation_actor_user_id, dismissal_actor_user_id). Lifecycle markers
// (confirmed_at / confirmed_deadline_id / dismissed_at / dismissal_reason) are
// NOT actor identities and are retained.
export const DOCKET_ENTRY_RESPONSE_FIELDS = Object.freeze([
  "id",
  "matter_id",
  "source_type",
  "proposed_kind",
  "proposed_due_at",
  "proposed_due_at_kind",
  "proposed_due_at_timezone",
  "proposed_owner_user_id",
  "source_rule_citation",
  "extractor_name",
  "extractor_version",
  "extraction_confidence",
  "source_document_id",
  "source_page_number",
  "source_excerpt",
  "reminder_offsets",
  "confirmation_state",
  "proposed_at",
  "confirmed_at",
  "confirmed_deadline_id",
  "dismissed_at",
  "dismissal_reason",
  "created_at",
] as const);

// Dedicated WRITE-response allowlist for the materialized deadline returned by
// confirm. Deliberately a SEPARATE constant from LIST_DEADLINES_RESPONSE_FIELDS
// (list-row vs write-response are distinct contracts that may diverge), even
// though it currently enumerates the same non-authority deadline fields.
export const CONFIRM_DOCKET_DEADLINE_RESPONSE_FIELDS = Object.freeze([
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

export type RendererDocketEntryRow = Pick<
  CaseBoxDocketEntry,
  (typeof DOCKET_ENTRY_RESPONSE_FIELDS)[number]
>;
export type RendererConfirmDeadlineRow = Pick<
  CaseBoxDeadline,
  (typeof CONFIRM_DOCKET_DEADLINE_RESPONSE_FIELDS)[number]
>;
// Confirm returns the projected proposed entry + the materialized deadline.
export interface ConfirmDocketEntryValue {
  readonly entry: RendererDocketEntryRow;
  readonly deadline: RendererConfirmDeadlineRow;
}
export type CreateDocketEntryResult = IpcEnvelope<RendererDocketEntryRow>;
export type ConfirmDocketEntryResult = IpcEnvelope<ConfirmDocketEntryValue>;

// WI-D1 (BATCH-CASEBOX-DOCKET-LIFECYCLE-00): docket-entry LIST (read). Surfaces
// durably-persisted docket entries — especially confirmation_state="proposed"
// proposals that are otherwise invisible after reload (the renderer lists only
// confirmed deadlines). Wraps persistence.listDocketEntries and projects every
// row through DOCKET_ENTRY_RESPONSE_FIELDS so authority identities never cross
// the IPC boundary. Renderer supplies scope + optional filters only.
export interface ListDocketEntriesDto {
  readonly matterId: string;
  readonly confirmation_state?: "proposed" | "confirmed" | "dismissed";
  readonly source_type?: "manual" | "court_order_excerpt" | "llm_extraction" | "imported";
  readonly limit?: number;
  readonly cursor?: string;
}
export const LIST_DOCKET_DTO_FIELDS = Object.freeze([
  "matterId",
  "confirmation_state",
  "source_type",
  "limit",
  "cursor",
] as const);
export const LIST_DOCKET_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);
// Allowed enum values for the optional filters (mirrors the persistence
// ListDocketEntriesQuery union). The handler validates against these so a
// malformed filter fails closed with invalid_payload rather than silently
// reaching persistence.
export const DOCKET_CONFIRMATION_STATES = Object.freeze([
  "proposed",
  "confirmed",
  "dismissed",
] as const);
export const DOCKET_SOURCE_TYPES = Object.freeze([
  "manual",
  "court_order_excerpt",
  "llm_extraction",
  "imported",
] as const);
// Renderer-safe page: same { rows, next_cursor } shape as persistence, but each
// row is the projected RendererDocketEntryRow (authority identities stripped).
export interface ListDocketEntriesPage {
  readonly rows: ReadonlyArray<RendererDocketEntryRow>;
  readonly next_cursor: string | null;
}
export type ListDocketEntriesResult = IpcEnvelope<ListDocketEntriesPage>;

// ---------------------------------------------------------------------------
// WI-602: fact create (claims / timeline write path). The renderer supplies
// ONLY the manual-fact fields; the server injects every authority / provenance
// / review-lifecycle field (the full candidate lawyer-authored CaseBoxFact
// shape — status "candidate", source_type "lawyer_authored", all source_* /
// extractor_* / reviewer_* / review fields null). `purpose` (R-5) is optional;
// `as_of_date` (R-5) is optional but date-only and required when purpose is
// "timeline_event" — both enforced in the handler before the write.
// ---------------------------------------------------------------------------

export interface CreateFactDto {
  readonly matterId: string;
  readonly statement_text: string;
  readonly purpose?: string;
  readonly as_of_date?: string;
}
export const CREATE_FACT_DTO_FIELDS = Object.freeze([
  "matterId",
  "statement_text",
  "purpose",
  "as_of_date",
] as const);
// Server-authority / server-injected / provenance / review-lifecycle fields
// forbidden from the renderer create DTO (the server constructs them).
export const CREATE_FACT_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenant_id",
  "actor_user_id",
  "matter_id",
  "status",
  "source_type",
  "source_document_id",
  "source_page_number",
  "source_excerpt",
  "source_ocr_job_id",
  "extractor_name",
  "extractor_version",
  "extraction_confidence",
  "reviewer_actor_user_id",
  "reviewed_at",
  "accepted_at",
  "rejected_at",
  "rejection_reason",
  "supersedes_fact_id",
  "created_at",
] as const);

// Dedicated WRITE-response allowlist for the created fact. Deliberately a
// SEPARATE constant from LIST_FACTS_RESPONSE_FIELDS (list-row vs write-response
// are distinct view contracts that may diverge), even though it currently
// enumerates the same non-authority fact fields. STRIPS the authority identities
// tenant_id / actor_user_id / reviewer_actor_user_id (same as the fact read
// allowlist).
export const CREATE_FACT_RESPONSE_FIELDS = Object.freeze([
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

export type RendererCreatedFactRow = Pick<
  CaseBoxFact,
  (typeof CREATE_FACT_RESPONSE_FIELDS)[number]
>;
export type CreateFactResult = IpcEnvelope<RendererCreatedFactRow>;

// ---------------------------------------------------------------------------
// WI-802: fact transition (review / accept / reject). The renderer supplies ONLY
// the scope (matterId), the fact (factId), the target status, and — when
// rejecting — a rejection_reason. The server injects reviewer_actor_user_id +
// the `at` timestamp; persistence owns the state machine (candidate → reviewed →
// accepted/rejected, plus candidate → rejected; candidate → accepted is illegal
// and surfaces illegal_transition). reviewed_at/accepted_at/rejected_at/status
// are computed by persistence, never renderer-supplied.
// ---------------------------------------------------------------------------

export type FactTransitionTarget = "reviewed" | "accepted" | "rejected";

export interface TransitionFactDto {
  readonly matterId: string;
  readonly factId: string;
  readonly to: FactTransitionTarget;
  readonly rejection_reason?: string;
}
export const TRANSITION_FACT_DTO_FIELDS = Object.freeze([
  "matterId",
  "factId",
  "to",
  "rejection_reason",
] as const);
// Server-authority / lifecycle / create-only fields forbidden from the renderer
// transition DTO (the server injects the reviewer + timestamps; persistence
// computes status / *_at). matter_id is forbidden (the renderer uses matterId).
export const TRANSITION_FACT_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenant_id",
  "actor_user_id",
  "matter_id",
  "reviewer_actor_user_id",
  "at",
  "status",
  "reviewed_at",
  "accepted_at",
  "rejected_at",
  "supersedes_fact_id",
  "source_type",
  "statement_text",
] as const);
// Dedicated transition-response allowlist (a SEPARATE constant from
// CREATE_FACT_RESPONSE_FIELDS — write-response contracts may diverge — though it
// currently enumerates the same non-authority fact fields). STRIPS the authority
// identities tenant_id / actor_user_id / reviewer_actor_user_id.
export const TRANSITION_FACT_RESPONSE_FIELDS = Object.freeze([
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
export type RendererTransitionedFactRow = Pick<
  CaseBoxFact,
  (typeof TRANSITION_FACT_RESPONSE_FIELDS)[number]
>;
export type TransitionFactResult = IpcEnvelope<RendererTransitionedFactRow>;
