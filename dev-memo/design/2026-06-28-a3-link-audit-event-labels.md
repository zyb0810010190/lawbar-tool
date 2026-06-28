# Design note — A3 link audit-event labels (LINK_CREATED / LINK_UNLINKED / LINK_RELINKED)

**Status:** design note (UI-label scope only). **Date:** 2026-06-28.
**WI:** WI-A3-INTERNAL-DEPS-COMMIT-TARBALLS-T2.
**Governs:** the `Design artifact:` UI-gate reference for the minimal renderer audit-event-label completion bundled with the DESKTOP-DEPS-00 packaging fix.

## Problem
The A3 link lifecycle emits three audit-event kinds — `LINK_CREATED`, `LINK_UNLINKED`, `LINK_RELINKED` — already merged in the `case-box-contract` audit-event vocabulary and persisted by the merged link IPC/persistence. The desktop renderer's audit-log viewer renders a human label per audit-event kind via an **exhaustive** map `renderer/i18n/labels.ts` `EVENT_KIND_ID: Record<CaseBoxAuditEventKind, CatalogId>` (a missing/extra key is a compile error) plus the `eventKind.*` strings in `renderer/i18n/catalog.ts`. These three LINK_* kinds were never given labels — the desktop only compiled because it had been building against a stale bundled contract whose `CaseBoxAuditEventKind` lacked them (the DESKTOP-DEPS-STALE-LOCK-01 defect). Refreshing the bundled contract makes the exhaustive map incomplete → `tsc` fails until the three labels are added.

## UI change (the entire scope)
Add exactly three audit-event labels, mirroring the existing entries:

| Audit kind | Catalog id | English label (proposed, mirrors existing voice) |
|---|---|---|
| `LINK_CREATED` | `eventKind.LINK_CREATED` | "Evidence link created" |
| `LINK_UNLINKED` | `eventKind.LINK_UNLINKED` | "Evidence link unlinked" |
| `LINK_RELINKED` | `eventKind.LINK_RELINKED` | "Evidence link relinked" |

(Final wording follows the established `eventKind.*` style in `catalog.ts`; the entries are added to `EVENT_KIND_ID` in `labels.ts`, the `eventKind.LINK_*` keys in `catalog.ts`, and — only if it independently enumerates kinds — `renderer/screens/auditEventLabels.ts`.)

## Explicitly NOT in scope
- No layout, screen, navigation, filter, or workflow change.
- No audit-event semantics change (the kinds are already defined + persisted).
- No permission, data-exposure, or confidentiality change; no evidence content rendered (these are static labels for already-merged event kinds).
- No new renderer flow, component, or interaction.
- No unrelated i18n/catalog key changes.

## Acceptance
The desktop `tsc` build + `npm test` pass against the refreshed contract with the three labels present; the audit-log viewer shows a human label (not a raw enum) for LINK_* events; the i18n drift-guard / allowlist remains green.
