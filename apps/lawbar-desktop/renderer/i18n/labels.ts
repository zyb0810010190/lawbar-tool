// renderer/i18n/labels.ts — typed enum-label facade (shared across migrated surfaces).
// Per dev-memo/plan-i18n-impl-00.md §2 / §6A. Single source for enum→display-label, replacing the
// English helpers in ../format.ts as each screen migrates. Consumed by migrated screens; more surfaces
// adopt it as they migrate.
//
// Exhaustiveness: the small closed unions use an exhaustive `switch` + `assertNever(x)` with an
// explicit `string` return type, so a new enum member fails the TypeScript build (enforced by the
// `pretest` build). The large audit-event-kind set uses a `Record<CaseBoxAuditEventKind, CatalogId>`,
// which is likewise compile-time exhaustive (a missing/extra kind fails the build).
//
// `eventKindLabel` TYPE-imports `CaseBoxAuditEventKind` only — no value import from `case-box-contract`
// (keeps `scripts/check-renderer-imports.mjs` green; value imports from the contract are forbidden).

import type {
  ConfidentialityClass,
  LedgerCategory,
  MatterStatus,
  MatterType,
} from "../types.js";
import type { DeadlineUrgency } from "../format.js";
import type { CaseBoxAuditEventKind } from "case-box-contract";
import { t } from "./t.js";
import type { CatalogId } from "./catalog.js";

function assertNever(x: never): never {
  throw new Error(`i18n: unhandled enum member: ${String(x)}`);
}

export function matterTypeLabel(type: MatterType): string {
  switch (type) {
    case "litigation":
      return t("matterType.litigation");
    case "arbitration":
      return t("matterType.arbitration");
    case "advisory":
      return t("matterType.advisory");
    case "due_diligence":
      return t("matterType.due_diligence");
    case "criminal_defense":
      return t("matterType.criminal_defense");
    case "other":
      return t("matterType.other");
    default:
      return assertNever(type);
  }
}

export function confidentialityLabel(c: ConfidentialityClass): string {
  switch (c) {
    case "normal":
      return t("confidentiality.normal");
    case "heightened":
      return t("confidentiality.heightened");
    case "sealed":
      return t("confidentiality.sealed");
    default:
      return assertNever(c);
  }
}

export function statusLabel(s: MatterStatus): string {
  switch (s) {
    case "active":
      return t("status.active");
    case "archived":
      return t("status.archived");
    default:
      return assertNever(s);
  }
}

export function deadlineUrgencyLabel(u: DeadlineUrgency): string {
  switch (u) {
    case "overdue":
      return t("deadlineUrgency.overdue");
    case "due-soon":
      return t("deadlineUrgency.due-soon");
    case "none":
      return t("deadlineUrgency.none");
    default:
      return assertNever(u);
  }
}

// Party role / kind + link source-type are open `string` unions at the renderer
// boundary (renderer/types.ts Party.role/party_kind are `string`), so these use a
// lookup map with a raw-value fallback rather than an exhaustive switch: an
// unrecognized enum value renders its raw code instead of throwing, so a future
// schema enum extension can never crash the render.
const PARTY_ROLE_ID: Readonly<Record<string, CatalogId>> = {
  client: "party.role.client",
  opposing: "party.role.opposing",
  third_party: "party.role.third_party",
};
export function partyRoleLabel(role: string): string {
  const id = PARTY_ROLE_ID[role];
  return id === undefined ? role : t(id);
}

const PARTY_KIND_ID: Readonly<Record<string, CatalogId>> = {
  individual: "party.kind.individual",
  organization: "party.kind.organization",
  government: "party.kind.government",
  court: "party.kind.court",
  other: "party.kind.other",
};
export function partyKindLabel(kind: string): string {
  const id = PARTY_KIND_ID[kind];
  return id === undefined ? kind : t(id);
}

const LINK_SOURCE_TYPE_ID: Readonly<Record<string, CatalogId>> = {
  evidence: "links.sourceType.evidence",
  note: "links.sourceType.note",
  question: "links.sourceType.question",
  calcTerm: "links.sourceType.calcTerm",
  claimElement: "links.sourceType.claimElement",
};
export function linkSourceTypeLabel(type: string): string {
  const id = LINK_SOURCE_TYPE_ID[type];
  return id === undefined ? type : t(id);
}

// Row-display enum labels (WI-DESKTOP-ZH-CN-I18N-COMPLETE-01). Same open-string
// lookup + raw-value fallback rationale as partyRoleLabel above — these values
// arrive as service data typed `string` at the renderer boundary.
const DEADLINE_KIND_ID: Readonly<Record<string, CatalogId>> = {
  statute_of_limitations: "deadlineKind.statute_of_limitations",
  court_order: "deadlineKind.court_order",
  discovery: "deadlineKind.discovery",
  filing: "deadlineKind.filing",
  hearing: "deadlineKind.hearing",
  internal: "deadlineKind.internal",
  payment: "deadlineKind.payment",
  evidence_submission: "deadlineKind.evidence_submission",
  appeal: "deadlineKind.appeal",
};
// Shared by the deadline row (d.kind) AND the docket proposed_kind (same contract enum).
export function deadlineKindLabel(kind: string): string {
  const id = DEADLINE_KIND_ID[kind];
  return id === undefined ? kind : t(id);
}

const DEADLINE_STATUS_ID: Readonly<Record<string, CatalogId>> = {
  pending: "deadlineStatus.pending",
  met: "deadlineStatus.met",
  missed: "deadlineStatus.missed",
  withdrawn: "deadlineStatus.withdrawn",
};
export function deadlineStatusLabel(status: string): string {
  const id = DEADLINE_STATUS_ID[status];
  return id === undefined ? status : t(id);
}

const DOCKET_SOURCE_TYPE_ID: Readonly<Record<string, CatalogId>> = {
  manual: "docketSourceType.manual",
  court_order_excerpt: "docketSourceType.court_order_excerpt",
  llm_extraction: "docketSourceType.llm_extraction",
  imported: "docketSourceType.imported",
};
export function docketSourceTypeLabel(sourceType: string): string {
  const id = DOCKET_SOURCE_TYPE_ID[sourceType];
  return id === undefined ? sourceType : t(id);
}

const REMINDER_KIND_ID: Readonly<Record<string, CatalogId>> = {
  advance_notice: "reminderKind.advance_notice",
  final_notice: "reminderKind.final_notice",
};
export function reminderKindLabel(kind: string): string {
  const id = REMINDER_KIND_ID[kind];
  return id === undefined ? kind : t(id);
}

const AUDIT_ENTITY_TYPE_ID: Readonly<Record<string, CatalogId>> = {
  matter: "auditEntityType.matter",
  document: "auditEntityType.document",
  deadline: "auditEntityType.deadline",
  evidence_item: "auditEntityType.evidence_item",
  ocr_link: "auditEntityType.ocr_link",
  fact: "auditEntityType.fact",
  privilege_marker: "auditEntityType.privilege_marker",
  confidentiality_classification: "auditEntityType.confidentiality_classification",
  docket_entry: "auditEntityType.docket_entry",
  link: "auditEntityType.link",
};
export function auditEntityTypeLabel(entityType: string): string {
  const id = AUDIT_ENTITY_TYPE_ID[entityType];
  return id === undefined ? entityType : t(id);
}

export function ledgerCategoryLabel(c: LedgerCategory): string {
  switch (c) {
    case "litigation":
      return t("ledgerCategory.litigation");
    case "counsel":
      return t("ledgerCategory.counsel");
    case "non_litigation":
      return t("ledgerCategory.non_litigation");
    default:
      return assertNever(c);
  }
}

// Compile-time exhaustive over every audit event kind (a missing/extra key fails the TS build).
const EVENT_KIND_ID: Record<CaseBoxAuditEventKind, CatalogId> = {
  MATTER_REGISTERED: "eventKind.MATTER_REGISTERED",
  MATTER_ARCHIVED: "eventKind.MATTER_ARCHIVED",
  MATTER_UNARCHIVED: "eventKind.MATTER_UNARCHIVED",
  DOCUMENT_REGISTERED: "eventKind.DOCUMENT_REGISTERED",
  DOCUMENT_OCR_SUBMITTED: "eventKind.DOCUMENT_OCR_SUBMITTED",
  DOCUMENT_OCR_COMPLETE: "eventKind.DOCUMENT_OCR_COMPLETE",
  DOCUMENT_OCR_FAILED: "eventKind.DOCUMENT_OCR_FAILED",
  DOCUMENT_TRIAGED: "eventKind.DOCUMENT_TRIAGED",
  DOCUMENT_TAGGED: "eventKind.DOCUMENT_TAGGED",
  DOCUMENT_REVIEWED: "eventKind.DOCUMENT_REVIEWED",
  DOCUMENT_SOFT_DELETED: "eventKind.DOCUMENT_SOFT_DELETED",
  OCR_LINK_SNAPSHOTTED: "eventKind.OCR_LINK_SNAPSHOTTED",
  OCR_LINK_REFRESHED: "eventKind.OCR_LINK_REFRESHED",
  DEADLINE_REGISTERED: "eventKind.DEADLINE_REGISTERED",
  DEADLINE_MET: "eventKind.DEADLINE_MET",
  DEADLINE_MISSED: "eventKind.DEADLINE_MISSED",
  DEADLINE_WITHDRAWN: "eventKind.DEADLINE_WITHDRAWN",
  DEADLINE_MISSED_TO_MET: "eventKind.DEADLINE_MISSED_TO_MET",
  EVIDENCE_PROPOSED: "eventKind.EVIDENCE_PROPOSED",
  EVIDENCE_ACCEPTED: "eventKind.EVIDENCE_ACCEPTED",
  EVIDENCE_REJECTED: "eventKind.EVIDENCE_REJECTED",
  EVIDENCE_SUPERSEDED: "eventKind.EVIDENCE_SUPERSEDED",
  FACT_PROPOSED: "eventKind.FACT_PROPOSED",
  FACT_REVIEWED: "eventKind.FACT_REVIEWED",
  FACT_ACCEPTED: "eventKind.FACT_ACCEPTED",
  FACT_REJECTED: "eventKind.FACT_REJECTED",
  FACT_REPLACEMENT_ACCEPTED: "eventKind.FACT_REPLACEMENT_ACCEPTED",
  PRIVILEGE_MARKER_PROPOSED: "eventKind.PRIVILEGE_MARKER_PROPOSED",
  PRIVILEGE_MARKER_CONFIRMED: "eventKind.PRIVILEGE_MARKER_CONFIRMED",
  PRIVILEGE_MARKER_DISMISSED: "eventKind.PRIVILEGE_MARKER_DISMISSED",
  PRIVILEGE_MARKER_WAIVED: "eventKind.PRIVILEGE_MARKER_WAIVED",
  EXTERNAL_OCR_AUTHORIZED: "eventKind.EXTERNAL_OCR_AUTHORIZED",
  EXTERNAL_OCR_REVOKED: "eventKind.EXTERNAL_OCR_REVOKED",
  SYNC_GRANT_GRANTED: "eventKind.SYNC_GRANT_GRANTED",
  SYNC_GRANT_REVOKED: "eventKind.SYNC_GRANT_REVOKED",
  LLM_EXTRACTION_OPT_IN: "eventKind.LLM_EXTRACTION_OPT_IN",
  LLM_EXTRACTION_OPT_OUT: "eventKind.LLM_EXTRACTION_OPT_OUT",
  PRIVILEGE_LOG_EXPORTED: "eventKind.PRIVILEGE_LOG_EXPORTED",
  CASE_DATA_EXPORTED: "eventKind.CASE_DATA_EXPORTED",
  DOCUMENT_ACCESSED: "eventKind.DOCUMENT_ACCESSED",
  DOCUMENT_PRINTED: "eventKind.DOCUMENT_PRINTED",
  DOCUMENT_SHARED: "eventKind.DOCUMENT_SHARED",
  CLASSIFICATION_SET: "eventKind.CLASSIFICATION_SET",
  CLASSIFICATION_UPGRADED: "eventKind.CLASSIFICATION_UPGRADED",
  CLASSIFICATION_DOWNGRADED: "eventKind.CLASSIFICATION_DOWNGRADED",
  CLASSIFICATION_RESET_TO_UNCLASSIFIED: "eventKind.CLASSIFICATION_RESET_TO_UNCLASSIFIED",
  DOCKET_ENTRY_PROPOSED: "eventKind.DOCKET_ENTRY_PROPOSED",
  DOCKET_ENTRY_CONFIRMED: "eventKind.DOCKET_ENTRY_CONFIRMED",
  DOCKET_ENTRY_DISMISSED: "eventKind.DOCKET_ENTRY_DISMISSED",
  DOCKET_ENTRY_REVISED: "eventKind.DOCKET_ENTRY_REVISED",
  LINK_CREATED: "eventKind.LINK_CREATED",
  LINK_UNLINKED: "eventKind.LINK_UNLINKED",
  LINK_RELINKED: "eventKind.LINK_RELINKED",
};

// Label for a KNOWN audit event kind. (Screen-side handling of null/unknown/missing kinds — the
// action·entity_type fallback — stays in the screen layer and lands with the audit-screen migration WI.)
export function eventKindLabel(kind: CaseBoxAuditEventKind): string {
  return t(EVENT_KIND_ID[kind]);
}
