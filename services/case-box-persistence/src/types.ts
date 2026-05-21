// Public types for case-box-persistence (Phase A1 + A2 + A3).
//
// The interface declares the 17 methods shipped through A3 (10 from A1 + 3
// from A2 + 4 from A3). Future-phase methods are NOT declared on the
// interface to avoid leaky stubs.

import type {
  CaseBoxAuditEvent,
  CaseBoxConfidentialityClassification,
  CaseBoxDocument,
  CaseBoxFact,
  CaseBoxMatter,
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
  CaseBoxFact,
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

  // Facts (Phase A4)
  appendFact(input: unknown): Promise<CaseBoxFact>;
  transitionFact(factId: string, opts: FactTransitionOpts): Promise<CaseBoxFact>;
  getFact(query: GetFactQuery): Promise<CaseBoxFact | null>;
  listFacts(query: ListFactsQuery): Promise<ListFactsPage>;
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
