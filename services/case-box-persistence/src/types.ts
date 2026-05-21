// Public types for case-box-persistence (Phase A1 + A2 + A3).
//
// The interface declares the 17 methods shipped through A3 (10 from A1 + 3
// from A2 + 4 from A3). Future-phase methods are NOT declared on the
// interface to avoid leaky stubs.

import type {
  CaseBoxAuditEvent,
  CaseBoxConfidentialityClassification,
  CaseBoxDeadline,
  CaseBoxDocketEntry,
  CaseBoxDocument,
  CaseBoxEvidenceItem,
  CaseBoxFact,
  CaseBoxMatter,
  CaseBoxOcrLink,
  CaseBoxPrivilegeMarker,
  ChainVerifyErr,
  ChainVerifyOk,
  AuditEventHash,
  ConfidentialityChangeReasonCode,
  ConfidentialityLevel,
  PrivilegeResolution,
} from "case-box-contract";

export type {
  ChainVerifyErr,
  ChainVerifyOk,
  AuditEventHash,
  CaseBoxDeadline,
  CaseBoxDocketEntry,
  CaseBoxEvidenceItem,
  CaseBoxFact,
  CaseBoxOcrLink,
  CaseBoxPrivilegeMarker,
  ConfidentialityChangeReasonCode,
  ConfidentialityLevel,
  PrivilegeResolution,
} from "case-box-contract";

/** Union of the contract's verify-chain result variants. */
export type VerifyAuditChainResult = ChainVerifyOk | ChainVerifyErr;

export interface ListDocumentsQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly status?: "registered" | "ocr_pending" | "ocr_complete" | "ocr_failed" | "triaged" | "tagged" | "reviewed";
  readonly doc_type?: "pleading" | "contract" | "correspondence" | "transcript" | "exhibit" | "other";
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListDocumentsPage {
  readonly rows: ReadonlyArray<CaseBoxDocument>;
  readonly next_cursor: string | null;
}

export interface ListAuditEventsQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListAuditEventsPage {
  readonly rows: ReadonlyArray<CaseBoxAuditEvent>;
  readonly next_cursor: string | null;
}

export interface AuditChainHead {
  readonly headHash: AuditEventHash | null;
  readonly lastEventId: string | null;
  readonly count: number;
}

export interface ArchiveMatterOpts {
  readonly actor_user_id: string;
  readonly reason: string;
}

export interface GetEffectiveClassificationQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly target_type: "document";
  readonly target_id: string;
}

export interface EffectiveClassificationResult {
  readonly effectiveLevel: ConfidentialityLevel;
  readonly history: ReadonlyArray<CaseBoxConfidentialityClassification>;
}

export interface ListConfidentialityClassificationsQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly target_type?: "document" | "fact";
  readonly target_id?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListConfidentialityClassificationsPage {
  readonly rows: ReadonlyArray<CaseBoxConfidentialityClassification>;
  readonly next_cursor: string | null;
}

/**
 * Trust boundary for CaseBoxPersistence.
 *
 * This interface assumes its callers have ALREADY authenticated the
 * acting principal and have authority for the tenant_id values passed in
 * payloads and queries. Persistence enforces tenant ISOLATION (no cross-
 * tenant reads/writes given the supplied tenant_id) but NOT caller
 * AUTHORIZATION (it does not independently verify the caller is allowed
 * to act as the supplied tenant_id).
 *
 * For v1, this is sound because the only client is the single-user local
 * Mac desktop application per `dev-memo/plan-client-00.md` D2 and
 * `.claude/rules/client-local-first.md` — there is no multi-tenant
 * external surface. If a future deployment introduces multi-tenant
 * callers (e.g. a gateway with cross-tenant routing), an authorization
 * layer MUST sit above CaseBoxPersistence and reject tenant_id values
 * the caller is not authorized to act for. That layer is out of scope
 * for the in-memory A-series (A1-A9).
 *
 * This affects all methods that accept a `tenant_id` in their input or
 * query, including `appendFactOnce` (A9): a caller who knows the exact
 * stored row contents AND the correct tenant_id is treated as a valid
 * redelivery, not a leak — the trust assumption is that knowing the
 * tenant_id is itself an authorization signal at this layer.
 */
export interface CaseBoxPersistence {
  // Matter lifecycle
  createMatter(matter: unknown): Promise<CaseBoxMatter>;
  getMatter(matterId: string): Promise<CaseBoxMatter | null>;
  archiveMatter(matterId: string, opts: ArchiveMatterOpts): Promise<CaseBoxMatter>;
  unarchiveMatter(matterId: string, opts: ArchiveMatterOpts): Promise<CaseBoxMatter>;

  // Document lifecycle
  registerDocument(matterId: string, document: unknown): Promise<CaseBoxDocument>;
  getDocument(documentId: string): Promise<CaseBoxDocument | null>;
  listDocuments(query: ListDocumentsQuery): Promise<ListDocumentsPage>;

  // Audit observability
  listAuditEvents(query: ListAuditEventsQuery): Promise<ListAuditEventsPage>;
  getAuditChainHead(matterId: string): Promise<AuditChainHead>;
  verifyAuditChainForMatter(matterId: string): Promise<VerifyAuditChainResult>;

  // Confidentiality classification (Phase A2)
  appendConfidentialityClassification(input: unknown): Promise<CaseBoxConfidentialityClassification>;
  getEffectiveClassification(query: GetEffectiveClassificationQuery): Promise<EffectiveClassificationResult>;
  listConfidentialityClassifications(query: ListConfidentialityClassificationsQuery): Promise<ListConfidentialityClassificationsPage>;

  // Privilege markers (Phase A3)
  appendPrivilegeMarker(input: unknown): Promise<CaseBoxPrivilegeMarker>;
  transitionPrivilegeMarker(markerId: string, opts: PrivilegeTransitionOpts): Promise<CaseBoxPrivilegeMarker>;
  getPrivilegeStatus(query: GetPrivilegeStatusQuery): Promise<PrivilegeResolution>;
  listPrivilegeMarkers(query: ListPrivilegeMarkersQuery): Promise<ListPrivilegeMarkersPage>;

  // Facts (Phase A4 + A9 replay-safe Once)
  appendFact(input: unknown): Promise<CaseBoxFact>;
  appendFactOnce(input: unknown): Promise<CaseBoxFact>;
  transitionFact(factId: string, opts: FactTransitionOpts): Promise<CaseBoxFact>;
  getFact(query: GetFactQuery): Promise<CaseBoxFact | null>;
  listFacts(query: ListFactsQuery): Promise<ListFactsPage>;

  // Docket entries + deadline materialization (Phase A5)
  appendDocketEntry(input: unknown): Promise<CaseBoxDocketEntry>;
  confirmDocketEntry(entryId: string, opts: ConfirmDocketEntryOpts): Promise<ConfirmDocketEntryResult>;
  dismissDocketEntry(entryId: string, opts: DismissDocketEntryOpts): Promise<CaseBoxDocketEntry>;
  getDocketEntry(query: GetDocketEntryQuery): Promise<CaseBoxDocketEntry | null>;
  listDocketEntries(query: ListDocketEntriesQuery): Promise<ListDocketEntriesPage>;
  transitionDeadline(deadlineId: string, opts: DeadlineTransitionOpts): Promise<CaseBoxDeadline>;

  // Evidence items (Phase A6)
  appendEvidenceItem(input: unknown): Promise<CaseBoxEvidenceItem>;
  transitionEvidenceItem(evidenceId: string, opts: EvidenceTransitionOpts): Promise<CaseBoxEvidenceItem>;
  getEvidenceItem(query: GetEvidenceItemQuery): Promise<CaseBoxEvidenceItem | null>;
  listEvidenceItems(query: ListEvidenceItemsQuery): Promise<ListEvidenceItemsPage>;

  // OCR links (Phase A7)
  upsertOcrLink(input: unknown): Promise<UpsertOcrLinkResult>;
  getOcrLink(query: GetOcrLinkQuery): Promise<CaseBoxOcrLink | null>;
  listOcrLinks(query: ListOcrLinksQuery): Promise<ListOcrLinksPage>;

  // Read-side aggregations (Phase A8)
  listMatters(query: ListMattersQuery): Promise<ListMattersPage>;
  getMatterSummary(query: GetMatterSummaryQuery): Promise<MatterSummary | null>;
  getDocumentDetail(query: GetDocumentDetailQuery): Promise<DocumentDetail | null>;
  getDeadline(query: GetDeadlineQuery): Promise<CaseBoxDeadline | null>;
  listDeadlines(query: ListDeadlinesQuery): Promise<ListDeadlinesPage>;
  getDeadlineCalendar(query: DeadlineCalendarQuery): Promise<ReadonlyArray<CaseBoxDeadline>>;
  getFactSupersessionChain(query: GetFactSupersessionChainQuery): Promise<ReadonlyArray<CaseBoxFact>>;
}

export interface ListMattersQuery {
  readonly tenant_id: string;
  readonly status?: "active" | "archived";
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListMattersPage {
  readonly rows: ReadonlyArray<CaseBoxMatter>;
  readonly next_cursor: string | null;
}

export interface GetMatterSummaryQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
}

export interface MatterSummary {
  readonly matter: CaseBoxMatter;
  readonly counts: {
    readonly documents: number;
    readonly facts_by_status: { candidate: number; reviewed: number; accepted: number; rejected: number };
    readonly deadlines_by_status: { pending: number; met: number; missed: number; withdrawn: number };
    readonly privilege_markers: number;
    readonly docket_entries_by_state: { proposed: number; confirmed: number; dismissed: number };
    readonly confidentiality_classifications: number;
    readonly evidence_items_by_status: { proposed: number; accepted: number; rejected: number; superseded: number };
    readonly ocr_links: number;
  };
}

export interface GetDocumentDetailQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly document_id: string;
}

export interface DocumentDetail {
  readonly document: CaseBoxDocument;
  readonly ocr_link: CaseBoxOcrLink | null;
  readonly effective_classification: EffectiveClassificationResult;
  readonly privilege_status: PrivilegeResolution;
  readonly fact_candidates: ReadonlyArray<CaseBoxFact>;
}

export interface GetDeadlineQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly deadline_id: string;
}

export interface ListDeadlinesQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly status?: "pending" | "met" | "missed" | "withdrawn";
  readonly kind?: "statute_of_limitations" | "court_order" | "discovery" | "filing" | "hearing" | "internal";
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListDeadlinesPage {
  readonly rows: ReadonlyArray<CaseBoxDeadline>;
  readonly next_cursor: string | null;
}

export interface DeadlineCalendarQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly from?: string;
  readonly to?: string;
}

export interface GetFactSupersessionChainQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly fact_id: string;
}

export interface UpsertOcrLinkResult {
  readonly link: CaseBoxOcrLink;
  readonly created: boolean;
}

export interface GetOcrLinkQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly document_id: string;
}

export interface ListOcrLinksQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly status_snapshot?: CaseBoxOcrLink["status_snapshot"];
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListOcrLinksPage {
  readonly rows: ReadonlyArray<CaseBoxOcrLink>;
  readonly next_cursor: string | null;
}

export interface EvidenceTransitionOpts {
  readonly to: "accepted" | "rejected" | "superseded";
  readonly actor_user_id: string;
  readonly replacement_evidence_id?: string;
}

export interface GetEvidenceItemQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly evidence_id: string;
}

export interface ListEvidenceItemsQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly status?: "proposed" | "accepted" | "rejected" | "superseded";
  readonly source_document_id?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListEvidenceItemsPage {
  readonly rows: ReadonlyArray<CaseBoxEvidenceItem>;
  readonly next_cursor: string | null;
}

export interface ConfirmDocketEntryOpts {
  readonly confirmation_actor_user_id: string;
  readonly confirmed_at: string;
  readonly deadline_id: string;
}

export interface ConfirmDocketEntryResult {
  readonly entry: CaseBoxDocketEntry;
  readonly deadline: CaseBoxDeadline;
  /** True iff Mode B's idempotency preflight fired (no audit emitted). */
  readonly idempotent: boolean;
}

export interface DismissDocketEntryOpts {
  readonly dismissal_actor_user_id: string;
  readonly dismissed_at: string;
  readonly dismissal_reason: string;
}

export interface GetDocketEntryQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly entry_id: string;
}

export interface ListDocketEntriesQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly confirmation_state?: "proposed" | "confirmed" | "dismissed";
  readonly source_type?: "manual" | "court_order_excerpt" | "llm_extraction" | "imported";
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListDocketEntriesPage {
  readonly rows: ReadonlyArray<CaseBoxDocketEntry>;
  readonly next_cursor: string | null;
}

export interface DeadlineTransitionOpts {
  readonly to: "met" | "missed" | "withdrawn";
  readonly actor_user_id: string;
  readonly at: string;
  readonly transition_reason?: string;
}

export interface GetFactQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly fact_id: string;
}

export interface FactTransitionOpts {
  readonly to: "reviewed" | "accepted" | "rejected";
  readonly reviewer_actor_user_id: string;
  readonly at: string;
  readonly rejection_reason?: string;
  readonly supersedes_fact_id?: string;
}

export interface ListFactsQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly status?: "candidate" | "reviewed" | "accepted" | "rejected";
  readonly source_type?: "lawyer_authored" | "llm_extraction" | "ocr_excerpt" | "imported";
  readonly source_document_id?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListFactsPage {
  readonly rows: ReadonlyArray<CaseBoxFact>;
  readonly next_cursor: string | null;
}

export interface PrivilegeTransitionOpts {
  readonly to: "confirmed" | "dismissed" | "waived";
  readonly actor_user_id: string;
  readonly at: string;
  readonly reason?: string;
}

export interface GetPrivilegeStatusQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly target_type: "document";
  readonly target_id: string;
}

export interface ListPrivilegeMarkersQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly target_type?: "document" | "fact";
  readonly target_id?: string;
  readonly status?: "proposed" | "confirmed" | "dismissed" | "waived";
  readonly kind?: "attorney_client" | "work_product" | "joint_defense" | "common_interest";
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListPrivilegeMarkersPage {
  readonly rows: ReadonlyArray<CaseBoxPrivilegeMarker>;
  readonly next_cursor: string | null;
}

export { CaseBoxPersistenceError } from "./errors.js";
export type { CaseBoxPersistenceErrorCode } from "./errors.js";
