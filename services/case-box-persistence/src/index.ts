// Public surface of case-box-persistence (Phase A1 + A2 + A3 + B1).

export { InMemoryCaseBoxPersistence } from "./inMemoryRepo.js";
export type { InMemoryCaseBoxPersistenceOptions } from "./inMemoryRepo.js";

export { SqliteCaseBoxPersistence } from "./sqlite/SqliteCaseBoxPersistence.js";
export type { SqliteCaseBoxPersistenceOptions } from "./sqlite/SqliteCaseBoxPersistence.js";
export {
  openSqliteCaseBoxPersistence,
} from "./sqlite/openSqliteCaseBoxPersistence.js";
export type {
  OpenSqliteCaseBoxPersistenceOptions,
  OpenSqliteCaseBoxPersistenceResult,
} from "./sqlite/openSqliteCaseBoxPersistence.js";
export { applySchema, CURRENT_SCHEMA_VERSION } from "./sqlite/schema.js";

// A3 link-status resolver (WI-A3-T5-RESOLVE) — headless, deterministic, idempotent.
export { resolveLinkStatuses } from "./sqlite/linkStatusResolverQueries.js";
export type {
  ResolvedLinkStatus,
  ResolveLinkStatusScope,
  LinkStatusResolutionResult,
} from "./sqlite/linkStatusResolverQueries.js";

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
  CaseBoxDocketEntry,
  CaseBoxDeadline,
  ConfirmDocketEntryOpts,
  ConfirmDocketEntryResult,
  DismissDocketEntryOpts,
  EditDocketEntryOpts,
  GetDocketEntryQuery,
  ListDocketEntriesQuery,
  ListDocketEntriesPage,
  DeadlineTransitionOpts,
  CaseBoxEvidenceItem,
  EvidenceTransitionOpts,
  GetEvidenceItemQuery,
  ListEvidenceItemsQuery,
  ListEvidenceItemsPage,
  CaseBoxOcrLink,
  UpsertOcrLinkResult,
  GetOcrLinkQuery,
  ListOcrLinksQuery,
  ListOcrLinksPage,
  ListMattersQuery,
  ListMattersPage,
  GetMatterSummaryQuery,
  MatterSummary,
  GetDocumentDetailQuery,
  DocumentDetail,
  GetDeadlineQuery,
  ListDeadlinesQuery,
  ListDeadlinesPage,
  DeadlineCalendarQuery,
  GetFactSupersessionChainQuery,
} from "./types.js";
