// Renderer-side DTO + IPC envelope type declarations.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §"NEW (impl WI)" types.ts row.
//
// Renderer cannot `import` from `src/caseBox/dto.ts` (renderer-import lint
// `FORBIDDEN_RELATIVE_RESOLVED_PREFIX` includes `src/caseBox`). Field-name
// drift between this file and the canonical `src/caseBox/dto.ts` is caught by
// `tests/renderer-dto-sync.test.mjs`.

export type MatterType =
  | "litigation"
  | "arbitration"
  | "advisory"
  | "due_diligence"
  | "criminal_defense"
  | "other";

export type ConfidentialityClass = "normal" | "heightened" | "sealed";

export type MatterStatus = "active" | "archived";

// Display-only ledger category derived from `MatterType`. Per
// dev-memo/plan-casebox-ui-design-hardening-00.md §3 row 9 + handoff §03 Task 5.
// Mapping lives in renderer/format.ts; this type is additive ONLY and does NOT
// change any DTO interface or RENDERER_*_DTO_FIELDS array — the DTO sync test
// continues passing unchanged.
export type LedgerCategory = "litigation" | "counsel" | "non_litigation";

export interface Party {
  readonly role: string;
  readonly display_name: string;
  readonly party_kind: string;
  readonly notes?: string;
}

export interface Jurisdiction {
  readonly value: string;
  readonly locked: boolean;
}

export interface CreateMatterDto {
  readonly name: string;
  readonly matter_type: MatterType;
  readonly jurisdiction: Jurisdiction;
  readonly parties: ReadonlyArray<Party>;
  readonly confidentiality_class: ConfidentialityClass;
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
  readonly status?: MatterStatus;
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

// Renderer-supplied fields for casebox:docket:create (WI-702). The server injects
// every authority / provenance / lifecycle field; the renderer forwards only these.
// proposed_due_at is an ISO-8601 datetime; proposed_due_at_timezone is an IANA zone
// (constrained to the host zone for this slice).
export interface CreateDocketEntryDto {
  readonly matterId: string;
  readonly proposed_kind: string;
  readonly proposed_due_at: string;
  readonly proposed_due_at_timezone: string;
  readonly proposed_owner_user_id?: string;
}

// Renderer-supplied fields for casebox:docket:confirm (WI-702): the scope (matterId)
// + the entry to confirm (entryId, from the create response). The server injects the
// confirmation actor, timestamp, and materialized deadline id.
export interface ConfirmDocketEntryDto {
  readonly matterId: string;
  readonly entryId: string;
}

// Renderer-supplied fields for casebox:docket:list (WI-D4): the scope (matterId)
// + optional filters/pagination. The renderer surfaces pending proposals with
// confirmation_state="proposed". The server injects tenant_id and projects rows.
export interface ListDocketEntriesDto {
  readonly matterId: string;
  readonly confirmation_state?: "proposed" | "confirmed" | "dismissed";
  readonly source_type?: "manual" | "court_order_excerpt" | "llm_extraction" | "imported";
  readonly limit?: number;
  readonly cursor?: string;
}

// Renderer-supplied fields for casebox:docket:dismiss (WI-D4): the scope, the entry
// to dismiss, and the required human reason. The server injects the dismissal actor
// + timestamp and enforces proposed-only + fail-closed scoping.
export interface DismissDocketEntryDto {
  readonly matterId: string;
  readonly entryId: string;
  readonly dismissal_reason: string;
}

// Renderer-supplied fields for casebox:docket:edit (WI-DPE5): the scope (matterId/entryId,
// camelCase) + the SIX editable content fields (snake_case, mirroring the contract + create).
// The server derives every trusted field (tenant_id, matter_id, entry_id, editor_actor_user_id)
// and persistence server-derives revised_at — none are renderer inputs. This mirrors the
// canonical EDIT_DOCKET_DTO_FIELDS in src/caseBox/dto/docket.ts (asserted by renderer-dto-sync).
export interface EditDocketEntryDto {
  readonly matterId: string;
  readonly entryId: string;
  readonly proposed_kind: string;
  readonly proposed_due_at: string;
  readonly proposed_due_at_kind: "datetime" | "date_only";
  readonly proposed_due_at_timezone: string | null;
  readonly proposed_owner_user_id: string;
  readonly reminder_offsets:
    | null
    | ReadonlyArray<{ readonly offset_days: number; readonly kind: "advance_notice" | "final_notice" }>;
}

// Fact-transition targets (WI-804). The renderer offers only the legal edges for a
// fact's current status; persistence owns the state machine.
export type FactTransitionTarget = "reviewed" | "accepted" | "rejected";

// Renderer-supplied fields for casebox:fact:transition (WI-804). The server injects
// reviewer_actor_user_id + the timestamp and computes the lifecycle fields; the
// renderer forwards only these. rejection_reason is sent ONLY when to === "rejected".
export interface TransitionFactDto {
  readonly matterId: string;
  readonly factId: string;
  readonly to: FactTransitionTarget;
  readonly rejection_reason?: string;
}

// casebox:deadline:transition target (WI-DT3). Mirrors the main-process IPC DTO;
// persistence owns the edge set (pending→met/missed/withdrawn, missed→met). The
// server injects actor + timestamp; the renderer forwards only the fields below.
// transition_reason is sent ONLY for the missed→met edge (required there).
export type DeadlineTransitionTarget = "met" | "missed" | "withdrawn";

export interface TransitionDeadlineDto {
  readonly matterId: string;
  readonly deadlineId: string;
  readonly to: DeadlineTransitionTarget;
  readonly transition_reason?: string;
}

// R-5 fact purpose enum (case-box-fact.schema.json). Absent ⇒ server defaults to "other".
export type FactPurpose =
  | "claim"
  | "defense"
  | "counterclaim"
  | "timeline_event"
  | "work_order_result"
  | "consultation_q"
  | "consultation_a"
  | "other";

// Renderer-supplied fields for casebox:fact:create (WI-701). The server injects
// every authority / status / provenance field; the renderer forwards only these.
// `as_of_date` is date-only (YYYY-MM-DD) and only forwarded for timeline_event facts.
export interface CreateFactDto {
  readonly matterId: string;
  readonly statement_text: string;
  readonly purpose?: FactPurpose;
  readonly as_of_date?: string;
}

export interface IpcErrorEnvelope {
  readonly kind: "case_box_persistence_error";
  readonly code: string;
  readonly message: string;
  readonly details?: { readonly schemaPath?: string; readonly keyword?: string };
}

export type IpcEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IpcErrorEnvelope };

// Field-name allowlists. Sync-tested against `src/caseBox/dto.ts` by
// `tests/renderer-dto-sync.test.mjs`.

export const RENDERER_CREATE_MATTER_DTO_FIELDS = Object.freeze([
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

export const RENDERER_GET_MATTER_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);

export const RENDERER_LIST_MATTERS_DTO_FIELDS = Object.freeze([
  "status",
  "limit",
  "cursor",
] as const);

export const RENDERER_ARCHIVE_MATTER_DTO_FIELDS = Object.freeze([
  "matterId",
  "reason",
] as const);

export const RENDERER_CHAIN_HEAD_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);

export const RENDERER_LIST_AUDIT_EVENTS_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);

export const RENDERER_LIST_DOCUMENTS_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);

export const RENDERER_GET_DOCUMENT_DTO_FIELDS = Object.freeze([
  "matterId",
  "documentId",
] as const);

export const RENDERER_REGISTER_DOCUMENT_DTO_FIELDS = Object.freeze([
  "matterId",
  "doc_type",
] as const);

export const RENDERER_LIST_DEADLINES_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);

export const RENDERER_LIST_FACTS_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);

export const RENDERER_CREATE_FACT_DTO_FIELDS = Object.freeze([
  "matterId",
  "statement_text",
  "purpose",
  "as_of_date",
] as const);

export const RENDERER_CREATE_DOCKET_DTO_FIELDS = Object.freeze([
  "matterId",
  "proposed_kind",
  "proposed_due_at",
  "proposed_due_at_timezone",
  "proposed_owner_user_id",
] as const);

export const RENDERER_CONFIRM_DOCKET_DTO_FIELDS = Object.freeze([
  "matterId",
  "entryId",
] as const);

export const RENDERER_LIST_DOCKET_DTO_FIELDS = Object.freeze([
  "matterId",
  "confirmation_state",
  "source_type",
  "limit",
  "cursor",
] as const);

export const RENDERER_DISMISS_DOCKET_DTO_FIELDS = Object.freeze([
  "matterId",
  "entryId",
  "dismissal_reason",
] as const);

// WI-DPE5: the edit bridge allowlist — exactly the 8 EDIT_DOCKET_DTO_FIELDS (scope
// matterId/entryId + the six editable content fields). Authority/provenance/lifecycle/
// revised_at are absent, so stripDtoFields drops them before the IPC call (defense-in-depth;
// main's EDIT_DOCKET_FORBIDDEN_FIELDS remains the authority).
export const RENDERER_EDIT_DOCKET_DTO_FIELDS = Object.freeze([
  "matterId",
  "entryId",
  "proposed_kind",
  "proposed_due_at",
  "proposed_due_at_kind",
  "proposed_due_at_timezone",
  "proposed_owner_user_id",
  "reminder_offsets",
] as const);

export const RENDERER_TRANSITION_FACT_DTO_FIELDS = Object.freeze([
  "matterId",
  "factId",
  "to",
  "rejection_reason",
] as const);

export const RENDERER_TRANSITION_DEADLINE_DTO_FIELDS = Object.freeze([
  "matterId",
  "deadlineId",
  "to",
  "transition_reason",
] as const);

// ---------------------------------------------------------------------------
// Evidence link lifecycle (WI-A3-LINK-UI-T1). Renderer-side mirrors of the
// canonical link DTOs in src/caseBox/dto/link.ts (renderer cannot import from
// src/caseBox — renderer-import lint forbids it; field-name parity is asserted
// by tests/renderer-dto-sync.test.mjs). The server injects every authority field
// (tenant_id / actor_user_id); persistence owns id / status / created_at / the
// unlink markers; the renderer forwards only the camelCase fields below.
// ---------------------------------------------------------------------------

// The 5 source kinds an evidence link may attach (case_box_links CHECK enum). The
// server re-validates; the create select offers exactly these.
export type LinkSourceType = "evidence" | "note" | "question" | "calcTerm" | "claimElement";

// Resolver-computed link status (resolveLinkStatuses). A LIST-row property.
export type RendererLinkStatus = "valid" | "needs_review" | "broken";

// Export-citation degradation flags (exportLinkCitations). `null` ⇒ a clean
// citation (CLEAN). These appear ONLY in the export-citations panel, never on a
// list row.
export type RendererExportCitationFlag =
  | "NEEDS_REVIEW"
  | "BROKEN"
  | "NON_CITABLE"
  | "AMBIGUOUS"
  | "UNLINKED";

export interface CreateLinkDto {
  readonly matterId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly anchorId: string;
}

export interface UnlinkLinkDto {
  readonly matterId: string;
  readonly linkId: string;
  readonly unlinkReason: string;
}

export interface RelinkLinkDto {
  readonly matterId: string;
  readonly linkId: string;
}

export interface ListLinksDto {
  readonly matterId: string;
}

export interface ExportLinkCitationsDto {
  readonly matterId: string;
}

// The renderer-facing link ROW (mirrors the canonical LINK_RESPONSE_FIELDS, which
// EXCLUDES tenant_id + payload_json). It carries resolver status + lifecycle ONLY
// — there is intentionally NO exportFlag on a row (export flags live only in the
// RendererExportCitationResult, surfaced in the export-citations panel).
export interface RendererLink {
  readonly id: string;
  readonly matter_id: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly anchor_id: string;
  readonly status: RendererLinkStatus;
  readonly created_at: string;
  readonly unlinked_at: string | null;
  readonly unlink_reason: string | null;
}

// Renderer-LOCAL export-citation shapes. The renderer MUST NOT import
// ExportCitationResult / ExportCitation from case-box-persistence (or any type
// from src/caseBox) — check-renderer-imports forbids it. These mirror the
// IPC-returned shape structurally, for read-only rendering in the export panel.
export interface RendererExportCitation {
  readonly linkId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly documentId: string | null;
  readonly physicalPageIndex: number | null;
  readonly linkStatus: string;
  readonly exportFlag: RendererExportCitationFlag | null;
  readonly citation:
    | { readonly citationVolume: string; readonly citationPageLabel: string; readonly text: string }
    | null;
}

export interface RendererExportCitationResult {
  readonly citations: ReadonlyArray<RendererExportCitation>;
  // Count of links by their export classification ("CLEAN" + each flag).
  readonly byFlag: Readonly<Record<string, number>>;
}

// Field-name allowlists for the 5 link channels. Each set-equals its canonical
// *_LINK_DTO_FIELDS counterpart in src/caseBox/dto/link.ts (renderer-dto-sync).
export const RENDERER_CREATE_LINK_DTO_FIELDS = Object.freeze([
  "matterId",
  "sourceType",
  "sourceId",
  "anchorId",
] as const);

export const RENDERER_UNLINK_LINK_DTO_FIELDS = Object.freeze([
  "matterId",
  "linkId",
  "unlinkReason",
] as const);

export const RENDERER_RELINK_LINK_DTO_FIELDS = Object.freeze([
  "matterId",
  "linkId",
] as const);

export const RENDERER_LIST_LINKS_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);

export const RENDERER_EXPORT_LINK_CITATIONS_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);

// ---------------------------------------------------------------------------
// T3 证据目录及说明 preview (WI-FORMS-T3-S2-CATALOG-PREVIEW-00). Renderer-side
// structural MIRROR of the main-built T3CatalogModel
// (src/caseBox/export/t3CatalogModel.ts). The renderer cannot import that module
// (it imports node:crypto); these read-only shapes mirror the IPC-returned model
// for rendering ONLY. No model logic is re-implemented here — S1 is the single
// source of truth. The request DTO mirrors the canonical T3PreviewCatalogDto in
// src/caseBox/dto/t3.ts.
// ---------------------------------------------------------------------------

export interface T3PreviewCatalogDto {
  readonly matterId: string;
  readonly submitterSelection?: { readonly partyIndex: number; readonly displayNameEcho: string };
}

// The four S1 submitter-refusal codes (T3CatalogRefusal). A refusal is an expected
// review state surfaced in the success value, never an error.
export type T3RefusalCode =
  | "submitter_selection_required"
  | "submitter_index_out_of_range"
  | "submitter_not_client"
  | "submitter_selection_stale";

// A resolved display value XOR an explicit lawyer-review marker (never a fabricated
// or substituted value). Mirrors T3TextCell / T3ReviewNeededCell / T3Cell.
export interface T3TextCell {
  readonly text: string;
}
export interface T3ReviewNeededCell {
  readonly reviewNeeded: true;
}
export type T3Cell = T3TextCell | T3ReviewNeededCell;
// 提交人诉讼地位: a procedural position XOR a needs-review marker.
export type T3PositionCell = { readonly value: "plaintiff" | "defendant" } | T3ReviewNeededCell;

export interface T3CatalogRow {
  readonly sequence: number;
  readonly evidenceId: string;
  readonly evidenceName: T3Cell;
  readonly proofStatement: T3Cell;
  readonly pageRange: T3Cell;
}

export interface T3CatalogModelView {
  readonly formType: string;
  readonly matterId: string;
  readonly litigationPosition: T3PositionCell;
  readonly submitterName: T3TextCell;
  readonly rows: ReadonlyArray<T3CatalogRow>;
}

// Discriminated success value returned by casebox:t3:previewCatalog (never null).
export type T3PreviewCatalogValue =
  | { readonly kind: "model"; readonly model: T3CatalogModelView; readonly modelSha256?: string }
  | { readonly kind: "refusal"; readonly code: T3RefusalCode };

export const RENDERER_T3_PREVIEW_DTO_FIELDS = Object.freeze([
  "matterId",
  "submitterSelection",
] as const);

// ---------------------------------------------------------------------------
// T3 DOCX export (WI-FORMS-T3-S3-DOCX-EXPORT-00). Renderer-side mirror of the
// canonical T3ExportDocxDto in src/caseBox/dto/t3.ts. Field-name parity is
// asserted by tests/renderer-dto-sync.test.mjs. The main process delivers the
// `.docx` via a save dialog; the renderer receives ONLY the structured status
// value below (a save outcome XOR a refusal) — NEVER raw `.docx` bytes.
// ---------------------------------------------------------------------------

export interface T3ExportDocxDto {
  readonly matterId: string;
  readonly submitterSelection?: { readonly partyIndex: number; readonly displayNameEcho: string };
}

// Discriminated success value returned by casebox:t3:exportDocx. `written: false` is a
// no-op success (the user cancelled the save dialog); a refusal produces NO document.
export type T3ExportDocxValue =
  | { readonly written: boolean }
  | { readonly exported: false; readonly refusal: { readonly code: T3RefusalCode } };

export const RENDERER_T3_EXPORT_DTO_FIELDS = Object.freeze([
  "matterId",
  "submitterSelection",
] as const);
