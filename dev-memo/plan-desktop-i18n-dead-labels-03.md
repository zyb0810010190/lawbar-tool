# Plan — WI-DESKTOP-I18N-DEAD-LABELS-03

**Type**: cleanup (dead-code removal; behavior-neutral). Follows `WI-DESKTOP-I18N-SCANNER-SCOPE-02`
(merged `c79894d`); closes deferred finding `I18N-DEAD-LABELS-03`.

## Goal

Remove/neutralize the dead English label reservoirs found during the scanner-scope WI, without changing
product behavior. Contract enum VALUES stay English; display labels stay Chinese via the catalog/facades.

## Investigation (confirmed dead / key-only)

- `renderer/format.ts` label helpers `matterTypeLabel` / `confidentialityLabel` / `statusLabel` /
  `deadlineUrgencyLabel` / `ledgerCategoryLabel` — **not imported by any product code** (screens import
  only `formatLocalDateTime` / `hashTruncate` / `ulidShort` / `classifyDeadlineUrgency` /
  `DEADLINE_DUE_SOON_WINDOW_MS` / `DeadlineUrgency` from `format.js`; labels come from
  `renderer/i18n/labels.ts`). Tested only by their own unit tests.
- `renderer/screens/auditEventLabels.ts` `EVENT_KIND_LABELS` — used **only for its keys** (a membership
  check in `viewMatterAudit.ts`); values never rendered. Redundant with the exhaustive `EVENT_KIND_ID`
  record in `labels.ts`.

## Changes

- `renderer/format.ts`: deleted the 5 dead English label helpers + now-unused type imports
  (`ConfidentialityClass`, `MatterStatus`). Kept `ledgerCategory` (pure token classifier, no English).
- `renderer/i18n/labels.ts`: added `isKnownAuditEventKind(kind): kind is CaseBoxAuditEventKind` (backed by
  `EVENT_KIND_ID`) — the canonical membership guard for `eventKindLabel` (which throws on an unknown key).
- `renderer/screens/viewMatterAudit.ts`: use `isKnownAuditEventKind` (also narrows the type, removing an
  `as CaseBoxAuditEventKind` cast + the now-unused type import); dropped the `EVENT_KIND_LABELS` import.
- **Deleted** `renderer/screens/auditEventLabels.ts` (English map + its unused `auditEventLabel` fn).
- Tests: `renderer-audit-labels.test.mjs` (unit sections re-targeted to `isKnownAuditEventKind` +
  contract-membership sync; integration section unchanged — still asserts zh-CN labels + raw-action
  fallback), `renderer-format-ledger.test.mjs` (dropped `ledgerCategoryLabel` tests; kept `ledgerCategory`),
  `renderer-deadline-urgency.test.mjs` (dropped the `deadlineUrgencyLabel` unit test). Allowlist regenerated
  (viewMatterAudit line-number shift only; count unchanged).
- Docs: classification doc + this plan + `deferred-audit-findings.md` (I18N-DEAD-LABELS-03 → closed).

## Reservoirs: removed / retained / converted

- **Removed**: `format.ts` 5 English label helpers; `auditEventLabels.ts` (whole file, incl. `EVENT_KIND_LABELS`).
- **Converted**: audit key-membership map → `labels.ts isKnownAuditEventKind` predicate.
- **Retained**: `format.ts ledgerCategory` (pure classifier, no English) + the live formatters.

## Acceptance (met)

- Allowlist count **100 → 100**; user-facing English **0 → 0** (guard: `scanAll() ∪ scanReturnAll()`).
- `npm --prefix apps/lawbar-desktop test` → 813 pass / 0 fail (6 dead-label tests removed; predicate/membership tests added).
- `npm run dist` → success; `npm run test:ui-packaged` → 1 pass (behavior-neutral; ran because a rendered screen's code path + a bundled file changed).
- cc-suite audit `audit-mrcw9tqg-670o1k` → PASS (behavior preserved, membership identical, no enum localized).

## Guard conditions (all satisfied)

user-facing English = 0 ✓ · existing i18n guard tests pass ✓ · no schema/contract enum value localized ✓ ·
no rendered Chinese UI regresses (packaged smoke + audit integration tests) ✓ · I18N-DEAD-LABELS-03 closed ✓.

## Out of scope

New i18n surfaces, settings, backend, routing, schema, visual redesign.
