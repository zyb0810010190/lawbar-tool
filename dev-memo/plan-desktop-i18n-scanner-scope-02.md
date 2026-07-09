# Plan — WI-DESKTOP-I18N-SCANNER-SCOPE-02

**Type**: SCAFFOLD/test-hardening (no product source change). Follows `WI-DESKTOP-ZH-CN-I18N-COMPLETE-01`
(merged `9d5db4d`); closes deferred finding `I18N-GUARD-H2`.

## Goal

Keep the invariant **"user-facing English occurrences = 0"** durable by covering the guard's blind spot:
user-visible copy produced by a HELPER that returns a string/template literal (rendered at its call site),
which the idiom-position scan (el children / setText / textContent / aria) could not see.

## Investigation (no live leak found)

A whole-file extract of every renderer string/template literal, classified via `classifyLiteral`, found
**no user-visible English leak**. The English-shaped strings are all NON-rendered:

- `renderer/format.ts` pre-i18n label helpers — **dead** (no screen imports them; screens use
  `renderer/i18n/labels.ts`). Retained under `renderer-format-ledger.test.mjs`. Utility module, outside
  the DOM-constructing scan set.
- `renderer/screens/auditEventLabels.ts` `EVENT_KIND_LABELS` — used **only for keys** (membership check);
  values never read for display. Not a literal return.
- class lists / `data-test-id` / selectors / import paths / an `Error()` message — non-UI code strings.

Per the WI charter ("if no real leak is found, make only scanner/test/doc changes"), **no renderer source
was modified.**

## Changes (scanner/test/doc only)

- `tests/_i18n-ui-scan.mjs`: new `scanReturnLiterals(rel, content)` + `scanReturnAll()` — a return-literal
  pass over the same DOM-constructing scan set (`renderer/screens/**.ts` + `renderer/index.ts`). Fed to the
  classifier, NOT to the flat allowlist (which stays scoped to idiom occurrences). Classifier refined so
  all-lowercase kebab tokens (`not-found`, `due-soon`) are `identifier-or-enum` while a hyphenated English
  label with a capital (`Non-litigation`) still flags `user-facing`.
- `tests/renderer-i18n-guard.test.mjs`: the "no user-facing English" guard now checks
  `scanAll() ∪ scanReturnAll()`; new bite test proves a helper returning English fails the build while
  route/code tokens do not.
- Docs: `dev-memo/i18n-allowlist-classification-00.md` (helper-return coverage + investigation result);
  `dev-memo/deferred-audit-findings.md` (I18N-GUARD-H2 → closed; new low-priority `I18N-DEAD-LABELS-03`
  to eventually delete the dead English reservoirs — deliberately out of scope here).

## Acceptance (met)

- `git status --short` clean of unintended paths (only WI files; `.mcp.json` untouched).
- Allowlist count: **100 → 100** (return pass does not feed the allowlist). `user-facing` count: **0 → 0**
  (now covered by an additional pass). Remaining English classified: 52 identifier-or-enum, 47
  interpolation-or-separator, + 7 return-literals all exempt (route tokens + `UTC`).
- `npm --prefix apps/lawbar-desktop test` → 819 pass / 0 fail.
- No packaged behavior / app-source change → packaged smoke + `dist` not required (test/doc-only WI).

## Out of scope

Deleting the dead English reservoirs (tracked `I18N-DEAD-LABELS-03`); UI/redesign/settings/schema/backend
work; converting enum values to Chinese; broad allowlist additions.
