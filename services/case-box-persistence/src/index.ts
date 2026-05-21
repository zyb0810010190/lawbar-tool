// Public surface of case-box-persistence (Phase A1).

export { InMemoryCaseBoxPersistence } from "./inMemoryRepo.js";
export type { InMemoryCaseBoxPersistenceOptions } from "./inMemoryRepo.js";

export { CaseBoxPersistenceError } from "./errors.js";
export type { CaseBoxPersistenceErrorCode } from "./errors.js";

export type {
  CaseBoxPersistence,
  ArchiveMatterOpts,
  ListDocumentsQuery,
  ListDocumentsPage,
  ListAuditEventsQuery,
  ListAuditEventsPage,
  AuditChainHead,
  VerifyAuditChainResult,
  ChainVerifyOk,
  ChainVerifyErr,
  AuditEventHash,
} from "./types.js";
