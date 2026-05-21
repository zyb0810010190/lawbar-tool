// Public surface of the case-box-contract package.
//
// Importers (case-box-ingestion, case-box-persistence, case-box-review, future
// desktop app, future sync bridge) should depend on this entry point. The JSON
// schemas under docs/contracts/case-box-contract/schemas/ remain the source of
// truth; everything exported here is derived from them.

// --- Validators ---
export { validateMatter } from "./validateMatter.js";
export { validateDocument } from "./validateDocument.js";
export { validateParty } from "./validateParty.js";
export { validateDeadline } from "./validateDeadline.js";
export { validateEvidenceItem } from "./validateEvidenceItem.js";
export { validateOcrLink, assertCaseBoxIsSubordinateToOcr } from "./validateOcrLink.js";
export { validateAuditEvent } from "./validateAuditEvent.js";
export { validateFact } from "./validateFact.js";
export { validatePrivilegeMarker } from "./validatePrivilegeMarker.js";
export { validateConfidentialityClassification } from "./validateConfidentialityClassification.js";
export { validateDocketEntry } from "./validateDocketEntry.js";

// --- State machines + transition helpers ---
export {
  MATTER_STATES,
  TERMINAL_MATTER_STATES,
  isTerminalMatterState,
  DOCUMENT_STATES,
  TERMINAL_DOCUMENT_STATES,
  isTerminalDocumentState,
  EVIDENCE_STATES,
  TERMINAL_EVIDENCE_STATES,
  isTerminalEvidenceState,
  DEADLINE_STATES,
  TERMINAL_DEADLINE_STATES,
  isTerminalDeadlineState,
  FACT_STATES,
  TERMINAL_FACT_STATES,
  isTerminalFactState,
  PRIVILEGE_MARKER_STATES,
  TERMINAL_PRIVILEGE_MARKER_STATES,
  isTerminalPrivilegeMarkerState,
  DOCKET_ENTRY_STATES,
  TERMINAL_DOCKET_ENTRY_STATES,
  isTerminalDocketEntryState,
  ALLOWED_MATTER_EDGES,
  ALLOWED_DOCUMENT_EDGES,
  ALLOWED_EVIDENCE_EDGES,
  ALLOWED_DEADLINE_EDGES,
  ALLOWED_FACT_EDGES,
  ALLOWED_PRIVILEGE_MARKER_EDGES,
  ALLOWED_DOCKET_ENTRY_EDGES,
  isAllowedMatterTransition,
  isAllowedDocumentTransition,
  isAllowedEvidenceTransition,
  isAllowedDeadlineTransition,
  isAllowedFactTransition,
  isAllowedPrivilegeMarkerTransition,
  isAllowedDocketEntryTransition,
  assertValidMatterTransition,
  assertValidDocumentTransition,
  assertValidEvidenceTransition,
  assertValidDeadlineTransition,
  assertValidFactTransition,
  assertValidPrivilegeMarkerTransition,
  assertValidDocketEntryTransition,
  IllegalTransitionError,
  OcrSubordinationError,
  type MatterState,
  type DocumentState,
  type EvidenceState,
  type DeadlineState,
  type FactState,
  type PrivilegeMarkerState,
  type DocketEntryState,
  type CaseBoxActor,
  type AllowedEdge,
} from "./transitions.js";

// --- Semantic invariants ---
export {
  LOCAL_ONLY_ACTOR_USER_ID,
  isLocalOnlyActor,
  defaultsAreLocalFirst,
  classAllowsExternal,
} from "./invariants.js";

// --- Fact-specific invariants and creation rule ---
export {
  assertFactPromotionInvariants,
  assertValidNewFact,
  isFactCandidateOnly,
  factWasMachineExtracted,
  isMachineExtractedCandidate,
  FactPromotionInvariantError,
  FactCreationInvariantError,
} from "./fact-invariants.js";

// --- Privilege-marker invariants and resolver ---
export {
  assertValidNewPrivilegeMarker,
  assertPrivilegeMarkerTimestamps,
  effectivePrivilegeStatus,
  isMarkerProtective,
  isMarkerLifecycleTerminal,
  isMachineSuggestedMarker,
  PrivilegeMarkerCreationError,
  type PrivilegeResolution,
} from "./privilege-invariants.js";

// --- Confidentiality classification (Step 5) ---
export {
  CONFIDENTIALITY_LEVELS,
  LATTICE_ORDINAL,
  CONFIDENTIALITY_CHANGE_REASON_CODES,
  isFirstClassification,
  isResetToUnclassified,
  isDowngrade,
  assertValidConfidentialityTransition,
  assertValidNewConfidentialityClassification,
  effectiveConfidentialityLevel,
  assertExternalHandlingAllowed,
  ConfidentialityTransitionError,
  ConfidentialityCreationError,
  type ConfidentialityLevel,
  type ConfidentialityChangeReasonCode,
  type ExternalAction,
  type PrivilegeReviewState,
  type HandlingDenialReason,
  type HandlingEvidence,
  type HandlingDecision,
  type AssertExternalHandlingInput,
} from "./confidentiality-invariants.js";

// --- Docket entry helpers (Step 6) ---
export {
  assertValidNewDocketEntry,
  assertValidDocketEntryConfirmation,
  assertValidIanaTimezone,
  interpretDocketEntryDueAt,
  isDocketEntryProposalOnly,
  docketEntryWasMachineExtracted,
  requiresHumanConfirmation,
  DocketEntryCreationError,
  DocketEntryConfirmationError,
  InvalidIanaTimezoneError,
  type DocketEntryDueAtInterpretation,
} from "./docket-invariants.js";

// --- Audit log helpers (Step 4) ---
export {
  CASE_BOX_AUDIT_ENTITY_TYPES,
  CASE_BOX_AUDIT_EVENT_KINDS,
  isKnownAuditEntityType,
  canonicalAuditEventHashInput,
  assertReasonForAuditEventKind,
  buildCaseBoxAuditEvent,
  verifyAuditChain,
  asAuditEventHash,
  AuditEventReasonRequiredError,
  type CaseBoxAuditEntityType,
  type CaseBoxAuditEventKind,
  type BuildAuditEventInput,
  type ChainVerifyOk,
  type ChainVerifyErr,
  type ChainVerifyErrorReason,
  type AuditEventHash,
  type EventHashFn,
} from "./audit-log.js";

// --- Shared validation result types ---
export type {
  ValidationResult,
  ValidationOk,
  ValidationErr,
} from "./result-types.js";

export type { AjvErrorObject } from "./ajv-instance.js";

// --- Schema-derived data types ---
export type { CaseBoxMatter } from "./generated/case-box-matter.js";
export type { CaseBoxDocument } from "./generated/case-box-document.js";
export type { CaseBoxParty } from "./generated/case-box-party.js";
export type { CaseBoxDeadline } from "./generated/case-box-deadline.js";
export type { CaseBoxEvidenceItem } from "./generated/case-box-evidence-item.js";
export type { CaseBoxOcrLink } from "./generated/case-box-ocr-link.js";
export type { CaseBoxAuditEvent } from "./generated/case-box-audit-event.js";
export type { CaseBoxFact } from "./generated/case-box-fact.js";
export type { CaseBoxPrivilegeMarker } from "./generated/case-box-privilege-marker.js";
export type { CaseBoxConfidentialityClassification } from "./generated/case-box-confidentiality-classification.js";
export type { CaseBoxDocketEntry } from "./generated/case-box-docket-entry.js";

// --- Deep-frozen public schemas ---
//
// Re-export the schemas in case callers want to validate elsewhere (e.g. in a
// different runtime, with a different Ajv config). Deep-frozen at the public
// boundary so a downstream consumer cannot weaken process-wide validation by
// mutating schema internals.
import {
  matterSchema as rawMatterSchema,
  documentSchema as rawDocumentSchema,
  partySchema as rawPartySchema,
  deadlineSchema as rawDeadlineSchema,
  evidenceItemSchema as rawEvidenceItemSchema,
  ocrLinkSchema as rawOcrLinkSchema,
  auditEventSchema as rawAuditEventSchema,
  factSchema as rawFactSchema,
  privilegeMarkerSchema as rawPrivilegeMarkerSchema,
  confidentialityClassificationSchema as rawConfidentialityClassificationSchema,
  docketEntrySchema as rawDocketEntrySchema,
} from "./loadSchemas.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const k of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[k]);
    }
    Object.freeze(value);
  }
  return value;
}

export const matterSchema = deepFreeze(structuredClone(rawMatterSchema));
export const documentSchema = deepFreeze(structuredClone(rawDocumentSchema));
export const partySchema = deepFreeze(structuredClone(rawPartySchema));
export const deadlineSchema = deepFreeze(structuredClone(rawDeadlineSchema));
export const evidenceItemSchema = deepFreeze(structuredClone(rawEvidenceItemSchema));
export const ocrLinkSchema = deepFreeze(structuredClone(rawOcrLinkSchema));
export const auditEventSchema = deepFreeze(structuredClone(rawAuditEventSchema));
export const factSchema = deepFreeze(structuredClone(rawFactSchema));
export const privilegeMarkerSchema = deepFreeze(structuredClone(rawPrivilegeMarkerSchema));
export const confidentialityClassificationSchema = deepFreeze(structuredClone(rawConfidentialityClassificationSchema));
export const docketEntrySchema = deepFreeze(structuredClone(rawDocketEntrySchema));
