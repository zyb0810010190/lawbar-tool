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

// A3 headless export-citation builder (WI-A3-EXPORT-T1) — resolver-first, deterministic, idempotent.
export { buildExportCitations } from "./sqlite/exportCitationQueries.js";
export type {
  ExportCitationFlag,
  ExportCitation,
  ExportCitationResult,
} from "./sqlite/exportCitationQueries.js";

// A3 referenced-anchor-delete refusal guard (WI-A3-DELETE-T1) — negative-path; no physical delete.
export { assertCanDeleteAnchor } from "./sqlite/anchorDeleteGuardQueries.js";
export type { AnchorDeleteGuardScope } from "./sqlite/anchorDeleteGuardQueries.js";

// A3 audited durable unlink/relink operation (WI-A3-UNLINK-T1) — SQLite-only;
// methods ship on SqliteCaseBoxPersistence. The result/opts types are public.
export type {
  CaseBoxLinkRow,
  UnlinkLinkOptions,
  RelinkLinkOptions,
  CreateLinkInput,
} from "./sqlite/linkRepoQueries.js";

export { CaseBoxPersistenceError } from "./errors.js";
export type { CaseBoxPersistenceErrorCode } from "./errors.js";

export type {
  CaseBoxPersistence,
  ArchiveMatterOpts,
  EnsureMatterPartyIdsOpts,
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
