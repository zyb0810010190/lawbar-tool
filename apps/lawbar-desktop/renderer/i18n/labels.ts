// renderer/i18n/labels.ts — typed enum-label facade (shared across migrated surfaces).
// Per dev-memo/plan-i18n-impl-00.md §2 / §6A. Single source for enum→display-label, replacing (in
// each screen-migration WI) both the English helpers in ../format.ts and the list-local `*Zh`
// helpers in ../screens/listMatters.ts. Consumed by the matter-list migration (WI-i18n-2); the
// remaining screens adopt it in later WIs.
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
};

// Label for a KNOWN audit event kind. (Screen-side handling of null/unknown/missing kinds — the
// action·entity_type fallback — stays in the screen layer and lands with the audit-screen migration WI.)
export function eventKindLabel(kind: CaseBoxAuditEventKind): string {
  return t(EVENT_KIND_ID[kind]);
}
