# Design artifact — Audit event-kind humanized labels

**WI**: WI-U2 (ASSET) of `BATCH-CASEBOX-AUDIT-EVENT-KIND-V2-UI-00`. **Date**: 2026-06-08.
**Status**: design artifact (authoritative for WI-U3). Renderer-only display; no contract/persistence change.
**Relates to**: `docs/adr/audit-event-kind-preservation.md` §8 (renderer maps kind→label; honest fallback).

This artifact specifies how WI-U3 renders the Batch-1 `event_kind` (projected to the audit DTO in WI-U1)
as a humanized label in the audit-history panel (`apps/lawbar-desktop/renderer/screens/viewMatterAudit.ts`,
`renderAuditEventRow`).

## 1. Render rule (replace-vs-augment)
- **Known `event_kind`** → the humanized label REPLACES the raw `action` text in the existing
  `view-audit-action` span (the row's primary, screen-reader-visible text). The entity detail
  (`entity_type · ulidShort(entity_id)`) and the optional `reason` line are UNCHANGED.
- **Null / missing / unknown `event_kind`** → the `view-audit-action` span shows the raw `action`
  (today's behaviour); together with the unchanged `entity_type · id` detail this is exactly the ADR
  `action · entity_type` fallback. **No inference** — never guess `DEADLINE_MET` vs `DEADLINE_MISSED`
  (or any transition) from `action`/`entity_type`; only a stored `event_kind` produces a label.

## 2. Accessibility
- The label is plain text inside the `view-audit-action` span → part of the accessible row name (not
  color/title-only).
- The audit list already carries `aria-live="polite"` (from the earlier a11y batch); appended rows —
  including their labels — are announced. No focus change.

## 3. Honest-wording constraint
Labels describe the recorded action only; they imply no fact not stored in the event (e.g.
`DEADLINE_MET` → "Deadline marked met", a record of the lawyer's action, not a court finding).

## 4. The label table (all 49 `CASE_BOX_AUDIT_EVENT_KINDS` keys)

| event_kind | label | (declared action · entity_type) |
|---|---|---|
| MATTER_REGISTERED | Matter created | create · matter |
| MATTER_ARCHIVED | Matter archived | update · matter |
| MATTER_UNARCHIVED | Matter unarchived | update · matter |
| DOCUMENT_REGISTERED | Document registered | create · document |
| DOCUMENT_OCR_SUBMITTED | Document OCR submitted | update · document |
| DOCUMENT_OCR_COMPLETE | Document OCR completed | update · document |
| DOCUMENT_OCR_FAILED | Document OCR failed | update · document |
| DOCUMENT_TRIAGED | Document triaged | update · document |
| DOCUMENT_TAGGED | Document tagged | update · document |
| DOCUMENT_REVIEWED | Document reviewed | update · document |
| DOCUMENT_SOFT_DELETED | Document deleted | delete-soft · document |
| OCR_LINK_SNAPSHOTTED | OCR link snapshotted | create · ocr_link |
| OCR_LINK_REFRESHED | OCR link refreshed | update · ocr_link |
| DEADLINE_REGISTERED | Deadline registered | create · deadline |
| DEADLINE_MET | Deadline marked met | update · deadline |
| DEADLINE_MISSED | Deadline marked missed | update · deadline |
| DEADLINE_WITHDRAWN | Deadline withdrawn | update · deadline |
| DEADLINE_MISSED_TO_MET | Missed deadline marked met | update · deadline |
| EVIDENCE_PROPOSED | Evidence proposed | create · evidence_item |
| EVIDENCE_ACCEPTED | Evidence accepted | update · evidence_item |
| EVIDENCE_REJECTED | Evidence rejected | update · evidence_item |
| EVIDENCE_SUPERSEDED | Evidence superseded | update · evidence_item |
| FACT_PROPOSED | Fact proposed | create · fact |
| FACT_REVIEWED | Fact reviewed | update · fact |
| FACT_ACCEPTED | Fact accepted | update · fact |
| FACT_REJECTED | Fact rejected | update · fact |
| FACT_REPLACEMENT_ACCEPTED | Replacement fact accepted | create · fact |
| PRIVILEGE_MARKER_PROPOSED | Privilege marker proposed | create · privilege_marker |
| PRIVILEGE_MARKER_CONFIRMED | Privilege marker confirmed | update · privilege_marker |
| PRIVILEGE_MARKER_DISMISSED | Privilege marker dismissed | update · privilege_marker |
| PRIVILEGE_MARKER_WAIVED | Privilege waived | privilege-waive · privilege_marker |
| EXTERNAL_OCR_AUTHORIZED | External OCR authorized | update · matter |
| EXTERNAL_OCR_REVOKED | External OCR revoked | update · matter |
| SYNC_GRANT_GRANTED | Sync grant granted | update · matter |
| SYNC_GRANT_REVOKED | Sync grant revoked | update · matter |
| LLM_EXTRACTION_OPT_IN | LLM extraction opted in | update · matter |
| LLM_EXTRACTION_OPT_OUT | LLM extraction opted out | update · matter |
| PRIVILEGE_LOG_EXPORTED | Privilege log exported | export · matter |
| CASE_DATA_EXPORTED | Case data exported | export · matter |
| DOCUMENT_ACCESSED | Document accessed | access · document |
| DOCUMENT_PRINTED | Document printed | print · document |
| DOCUMENT_SHARED | Document shared | share · document |
| CLASSIFICATION_SET | Confidentiality set | create · confidentiality_classification |
| CLASSIFICATION_UPGRADED | Confidentiality upgraded | create · confidentiality_classification |
| CLASSIFICATION_DOWNGRADED | Confidentiality downgraded | create · confidentiality_classification |
| CLASSIFICATION_RESET_TO_UNCLASSIFIED | Confidentiality reset to unclassified | create · confidentiality_classification |
| DOCKET_ENTRY_PROPOSED | Docket proposal created | create · docket_entry |
| DOCKET_ENTRY_CONFIRMED | Docket proposal confirmed | update · docket_entry |
| DOCKET_ENTRY_DISMISSED | Docket proposal dismissed | update · docket_entry |

(The `(action · entity_type)` column is reference only — it is the fallback shown when the kind is
null/unknown; it is NOT appended when a label is shown.)

## 5. WI-U3 implementation shape
- `apps/lawbar-desktop/renderer/screens/auditEventLabels.ts` (new): `export const EVENT_KIND_LABELS:
  Record<string, string>` with the 49 rows above + `export function auditEventLabel(ev): string` that
  returns `EVENT_KIND_LABELS[ev.event_kind]` when present/known, else `ev.action` (the raw action; the
  entity detail supplies the `· entity_type`).
- The map MUST stay in sync with `CASE_BOX_AUDIT_EVENT_KINDS`; WI-U3 adds a test asserting every map key
  is a valid kind (and, ideally, that every current kind has a label).

## 6. Out of scope
No `audit_schema_version` display; no audit filtering/search; no inference of transitions; no
contract/persistence/Electron change.

## Stop condition
Promoted to WI-U3 (renderer implementation); artifact retired once WI-U3 ships.
