// Public types for case-box-persistence (Phase A1 + A2).
//
// The interface declares the 13 methods shipped through A2 (10 from A1 + 3
// new in A2). Future-phase methods are NOT declared on the interface to
// avoid leaky stubs.

import type {
  CaseBoxAuditEvent,
  CaseBoxConfidentialityClassification,
  CaseBoxDocument,
  CaseBoxMatter,
  ChainVerifyErr,
  ChainVerifyOk,
  AuditEventHash,
  ConfidentialityChangeReasonCode,
  ConfidentialityLevel,
} from "case-box-contract";

export type {
  ChainVerifyErr,
  ChainVerifyOk,
  AuditEventHash,
  ConfidentialityChangeReasonCode,
  ConfidentialityLevel,
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
}

export { CaseBoxPersistenceError } from "./errors.js";
export type { CaseBoxPersistenceErrorCode } from "./errors.js";
