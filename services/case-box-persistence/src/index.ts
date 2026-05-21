// Public surface of case-box-persistence (Phase A1 + A2 + A3).

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
  GetEffectiveClassificationQuery,
  EffectiveClassificationResult,
  ListConfidentialityClassificationsQuery,
  ListConfidentialityClassificationsPage,
  ConfidentialityChangeReasonCode,
  ConfidentialityLevel,
  CaseBoxPrivilegeMarker,
  PrivilegeResolution,
  PrivilegeTransitionOpts,
  GetPrivilegeStatusQuery,
  ListPrivilegeMarkersQuery,
  ListPrivilegeMarkersPage,
  CaseBoxFact,
  FactTransitionOpts,
  GetFactQuery,
  ListFactsQuery,
  ListFactsPage,
} from "./types.js";
