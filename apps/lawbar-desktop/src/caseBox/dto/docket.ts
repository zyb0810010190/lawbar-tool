// Docket-entry IPC DTOs / allowlists / response projections / result types
// (create/confirm/list/dismiss) (WI-DTO1 split from dto.ts).
import type { CaseBoxDocketEntry, CaseBoxDeadline } from "case-box-contract";
import type { IpcEnvelope } from "./shared.js";


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
  // WI-DPE4: the optional edit timestamp (renderer-safe; a timestamp, not an
  // actor/tenant identity). Absent on never-edited entries.
  "revised_at",
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


// WI-D2 (BATCH-CASEBOX-DOCKET-LIFECYCLE-00): docket-entry DISMISS (cancel a
// PROPOSED proposal). Renderer supplies only the scope (matterId), the entry,
// and the required human reason; the server injects the dismissal actor +
// timestamp and the handler enforces proposed-only + fail-closed scoping.
// Confirmed-entry dismissal is OUT of scope (it would orphan a materialized
// deadline) — the handler rejects any non-proposed entry.
export interface DismissDocketEntryDto {
  readonly matterId: string;
  readonly entryId: string;
  readonly dismissal_reason: string;
}

export const DISMISS_DOCKET_DTO_FIELDS = Object.freeze([
  "matterId",
  "entryId",
  "dismissal_reason",
] as const);

// Server-authority / server-injected / lifecycle fields forbidden from the
// renderer dismiss DTO (the server constructs/derives them). The unknown-field
// guard already rejects any non-DTO key; this list gives a precise schemaPath
// for the named authority/timestamp/state fields.
export const DISMISS_DOCKET_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
  "dismissal_actor_user_id",
  "dismissed_at",
  "confirmation_state",
  "confirmation_actor_user_id",
  "confirmed_at",
  "confirmed_deadline_id",
] as const);

// Dismiss returns the projected (now-dismissed) docket entry.
export type DismissDocketEntryResult = IpcEnvelope<RendererDocketEntryRow>;


// WI-DPE4 (BATCH-CASEBOX-DOCKET-PROPOSAL-EDIT-IPC-00): docket-entry EDIT (in-place
// content edit of a PROPOSED proposal). Renderer supplies only the scope
// (matterId/entryId, camelCase like confirm/dismiss) + the SIX editable content
// fields (snake_case, matching create + the contract). The server derives all
// trusted fields (tenant_id, matter_id, entry_id, editor_actor_user_id) and the
// persistence layer server-derives revised_at. Mirrors the confirm/dismiss
// scoped-preflight + proposed-only discipline (DPE3 persistence is the final
// authority; the handler preflight is read-only defense-in-depth).
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

export const EDIT_DOCKET_DTO_FIELDS = Object.freeze([
  "matterId",
  "entryId",
  "proposed_kind",
  "proposed_due_at",
  "proposed_due_at_kind",
  "proposed_due_at_timezone",
  "proposed_owner_user_id",
  "reminder_offsets",
] as const);

// INPUT-REJECT list (the handler REJECTS any present key; it never "strips" input).
// The complement of the six editable content fields over the docket-entry surface,
// PLUS the snake_case scope aliases (tenant_id/matter_id/entry_id — the camelCase
// matterId/entryId are the only accepted scope form) + the server-derived authority
// fields editor_actor_user_id + revised_at. "Strip" applies ONLY to the OUTPUT
// projection (DOCKET_ENTRY_RESPONSE_FIELDS).
export const EDIT_DOCKET_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "matter_id",
  "entry_id",
  "actor_user_id",
  "editor_actor_user_id",
  "revised_at",
  "id",
  "source_type",
  "source_rule_citation",
  "extractor_name",
  "extractor_version",
  "extraction_confidence",
  "source_document_id",
  "source_page_number",
  "source_excerpt",
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

// Edit returns the projected (now-revised) docket entry (incl. revised_at).
export type EditDocketEntryResult = IpcEnvelope<RendererDocketEntryRow>;
