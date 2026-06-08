// Humanized audit event-kind labels (WI-U3, BATCH-CASEBOX-AUDIT-EVENT-KIND-V2-UI-00).
// Per dev-memo/design/2026-06-08-audit-event-kind-labels.md + ADR §8. Renderer-only display: maps the
// Batch-1 projected `event_kind` to a human label; null / missing / UNKNOWN kinds fall back to the raw
// `action` (the row's entity detail supplies the "· entity_type" half of the action·entity_type
// fallback). Honest wording only — a label records the action, never a fact not stored in the event,
// and the renderer NEVER infers a transition (e.g. met vs missed) from action/entity_type.
//
// Keep in sync with CASE_BOX_AUDIT_EVENT_KINDS (docs/contracts/case-box-contract/src/audit-log.ts);
// renderer-audit-labels.test.mjs asserts every contract kind has a label and every label key is valid.

export const EVENT_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  MATTER_REGISTERED: "Matter created",
  MATTER_ARCHIVED: "Matter archived",
  MATTER_UNARCHIVED: "Matter unarchived",
  DOCUMENT_REGISTERED: "Document registered",
  DOCUMENT_OCR_SUBMITTED: "Document OCR submitted",
  DOCUMENT_OCR_COMPLETE: "Document OCR completed",
  DOCUMENT_OCR_FAILED: "Document OCR failed",
  DOCUMENT_TRIAGED: "Document triaged",
  DOCUMENT_TAGGED: "Document tagged",
  DOCUMENT_REVIEWED: "Document reviewed",
  DOCUMENT_SOFT_DELETED: "Document deleted",
  OCR_LINK_SNAPSHOTTED: "OCR link snapshotted",
  OCR_LINK_REFRESHED: "OCR link refreshed",
  DEADLINE_REGISTERED: "Deadline registered",
  DEADLINE_MET: "Deadline marked met",
  DEADLINE_MISSED: "Deadline marked missed",
  DEADLINE_WITHDRAWN: "Deadline withdrawn",
  DEADLINE_MISSED_TO_MET: "Missed deadline marked met",
  EVIDENCE_PROPOSED: "Evidence proposed",
  EVIDENCE_ACCEPTED: "Evidence accepted",
  EVIDENCE_REJECTED: "Evidence rejected",
  EVIDENCE_SUPERSEDED: "Evidence superseded",
  FACT_PROPOSED: "Fact proposed",
  FACT_REVIEWED: "Fact reviewed",
  FACT_ACCEPTED: "Fact accepted",
  FACT_REJECTED: "Fact rejected",
  FACT_REPLACEMENT_ACCEPTED: "Replacement fact accepted",
  PRIVILEGE_MARKER_PROPOSED: "Privilege marker proposed",
  PRIVILEGE_MARKER_CONFIRMED: "Privilege marker confirmed",
  PRIVILEGE_MARKER_DISMISSED: "Privilege marker dismissed",
  PRIVILEGE_MARKER_WAIVED: "Privilege waived",
  EXTERNAL_OCR_AUTHORIZED: "External OCR authorized",
  EXTERNAL_OCR_REVOKED: "External OCR revoked",
  SYNC_GRANT_GRANTED: "Sync grant granted",
  SYNC_GRANT_REVOKED: "Sync grant revoked",
  LLM_EXTRACTION_OPT_IN: "LLM extraction opted in",
  LLM_EXTRACTION_OPT_OUT: "LLM extraction opted out",
  PRIVILEGE_LOG_EXPORTED: "Privilege log exported",
  CASE_DATA_EXPORTED: "Case data exported",
  DOCUMENT_ACCESSED: "Document accessed",
  DOCUMENT_PRINTED: "Document printed",
  DOCUMENT_SHARED: "Document shared",
  CLASSIFICATION_SET: "Confidentiality set",
  CLASSIFICATION_UPGRADED: "Confidentiality upgraded",
  CLASSIFICATION_DOWNGRADED: "Confidentiality downgraded",
  CLASSIFICATION_RESET_TO_UNCLASSIFIED: "Confidentiality reset to unclassified",
  DOCKET_ENTRY_PROPOSED: "Docket proposal created",
  DOCKET_ENTRY_CONFIRMED: "Docket proposal confirmed",
  DOCKET_ENTRY_DISMISSED: "Docket proposal dismissed",
});

/**
 * Humanized label for an audit row. Returns the mapped label for a known `event_kind`; for a null /
 * missing / unknown kind returns the raw `action` (the caller's entity detail supplies "· entity_type",
 * giving the ADR action·entity_type fallback). Never infers a transition kind from action/entity_type.
 */
export function auditEventLabel(ev: { readonly action: string; readonly event_kind?: string }): string {
  const kind = ev.event_kind;
  if (kind !== undefined && kind !== null) {
    const label = EVENT_KIND_LABELS[kind];
    if (label !== undefined) return label;
  }
  return ev.action;
}
