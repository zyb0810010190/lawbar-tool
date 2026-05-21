// Public types for case-box-persistence (Phase A1).
//
// The interface declares the 10 A1 methods only. Future-phase methods are
// NOT declared on the interface to avoid leaky stubs.

import type {
  CaseBoxAuditEvent,
  CaseBoxDocument,
  CaseBoxMatter,
  ChainVerifyErr,
  ChainVerifyOk,
  AuditEventHash,
} from "case-box-contract";

export type { ChainVerifyErr, ChainVerifyOk, AuditEventHash } from "case-box-contract";

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
}

export { CaseBoxPersistenceError } from "./errors.js";
export type { CaseBoxPersistenceErrorCode } from "./errors.js";
