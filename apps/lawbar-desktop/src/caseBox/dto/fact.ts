// Fact IPC DTOs / allowlists / response projections / result types
// (list/create/transition) (WI-DTO1 split from dto.ts).
import type { CaseBoxFact } from "case-box-contract";
import type { IpcEnvelope } from "./shared.js";


export interface ListFactsDto {
  readonly matterId: string;
  readonly limit?: number;
  readonly cursor?: string;
}


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


// Projected (renderer-safe) page shapes returned by the list handlers. Same
// `{ rows, next_cursor }` shape as the persistence pages, but with authority
// fields stripped from every row.
export interface ListFactsPage {
  readonly rows: ReadonlyArray<RendererFactRow>;
  readonly next_cursor: string | null;
}

export type ListFactsResult = IpcEnvelope<ListFactsPage>;


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
