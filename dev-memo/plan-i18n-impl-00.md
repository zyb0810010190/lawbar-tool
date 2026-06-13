# Plan — WI-i18n-1: i18n infrastructure (catalog + t() + facade + guard), NO screen migration

**Status**: PLAN WI (non-authorizing). DRAFT — not implementation-authorizing until it passes
`/cc-suite:review-plan` (READY). **No code in this turn.**
**Date**: 2026-06-13. **Author**: Claude Code. **Type**: IMPL (renderer infra) — but doc-only at draft stage.
**Parent**: `dev-memo/plan-i18n-00.md` (READY, `review-plan-mqcki7ca-0kptfz`); D1–D4 resolved there
(zh-CN; no runtime switch v1; TypeScript catalog; catalog+t()+guard first, screens later).

## Review packet (compact)

1. **Summary**: Build the renderer i18n **infrastructure only** — a TypeScript message catalog, a `t(id,
   params?)` resolver, a consolidated typed enum-label facade, and an exact-occurrence anti-drift guard
   test — all **NEW and UNWIRED**. No screen consumes them yet; **no visible UI copy changes**. This is the
   first WI of the i18n migration per parent §6 D4.
2. **Exact target files (all new except package.json)**:
   - `apps/lawbar-desktop/renderer/i18n/catalog.ts` — `zh-CN` message map keyed by stable string IDs;
     seeded with the **enum-label entries** (finite) + a small set of shared keys needed to test `t()`.
     Per-screen free-text chrome keys are added by each later screen-migration WI.
   - `apps/lawbar-desktop/renderer/i18n/t.ts` — `t(id, params?)` (active `LOCALE = "zh-CN"` const).
   - `apps/lawbar-desktop/renderer/i18n/labels.ts` — typed enum-label facade (`matterTypeLabel`,
     `confidentialityLabel`, `statusLabel`, `deadlineUrgencyLabel`, `ledgerCategoryLabel`, `eventKindLabel`),
     each an **exhaustive `switch`** returning `t("enum.…")`.
   - `apps/lawbar-desktop/renderer/i18n/ui-strings-allowlist.json` (or `.ts`) — the exact-occurrence
     allowlist, **seeded to ALL current user-facing literals** in the scan set so the guard is green at
     introduction (zero forced migration).
   - `apps/lawbar-desktop/tests/renderer-i18n.test.mjs` — catalog/`t()`/facade unit tests.
   - `apps/lawbar-desktop/tests/renderer-i18n-guard.test.mjs` — the anti-drift guard + its own
     white-box/negative test.
   - `apps/lawbar-desktop/package.json` — register the two test files (+ `test:ui-i18n` script).
3. **Exact acceptance criteria** (all must hold; each is testable):
   - `t("known.key")` returns its zh-CN value; **named** interpolation works (`t("k", {n})`); a **missing
     key OR missing required param FAILS loudly** (throws in dev / returns a visible marker) — asserted.
   - The facade returns `t()` values for every enum member; **adding a new enum member fails the TS build**
     (exhaustive switch) — documented + covered by a type-level/compile assertion.
   - The guard scans `renderer/screens/**`, `renderer/index.ts`, `renderer/index.html`; flags el()/setText/
     aria-label/title/placeholder/`<legend>`/template/CJK user-facing literals; exempts the §6A set
     (i18n catalog, raw contract passthrough, attrs like class/role/href/id/data-*, comments, tests); uses
     the **exact-occurrence allowlist**; **passes with the seeded allowlist**; and **FAILS on an injected
     new literal** (negative test proves it bites).
   - **No screen renders differently**: `format.ts`, `listMatters.ts`, and every `screens/**` file are
     UNCHANGED; the full suite stays green (smoke h1/empty-copy assertions unchanged).
4. **Exact out-of-scope** (forbidden in this WI):
   - Any `renderer/screens/**`, `renderer/index.ts`, `renderer/index.html` content/DOM/label change
     (the guard READS them; it does not edit them).
   - Deleting/repointing `format.ts` enum helpers or `listMatters.ts` `*Zh` helpers (screens still use
     them; repointing them to the zh-CN facade would change visible copy → that is a later screen-migration WI).
   - Translating create / detail / archive / materials or any screen; changing any visible UI copy.
   - Runtime locale switching / switcher UI.
   - Any third-party i18n dependency (hand-rolled only — a new dep is an `autonomy.md` hard stop).
   - Any contract/IPC/DTO/enum-value change.
5. **Essential refs**: parent `dev-memo/plan-i18n-00.md` §2 (inventory), §6/§6A (structure + guard/`t()`/
   facade spec), §7 (risks); `.claude/rules/client-local-first.md`; `.claude/rules/autonomy.md`
   (no-new-dependency hard stop); `tests/renderer-no-hardcoded-color.test.mjs` (block-level lint precedent).
6. **Review questions**: (a) Is "unwired infra + seeded allowlist + zero visible change" the right
   non-breaking boundary for WI-1? (b) Should the catalog ship only enum-label keys in WI-1, with screen
   chrome keys added per migration WI (recommended), or be fully populated upfront? (c) Is the exact-occurrence
   allowlist format (line/string patterns) implementable as a stable, reviewable seed?

## Gates
- `npm --prefix apps/lawbar-desktop test` (full suite stays green; new i18n + guard tests pass).
- `npm --prefix apps/lawbar-desktop run test:ui-i18n` (targeted).
- `loc-guardian:scan` (new files are small; well under thresholds).

## Acceptance / verification
- New behavior proved RED→GREEN by the guard negative test (injected literal fails) and the `t()`
  missing-key/param failure tests; existing behavior proved unchanged by the full suite (no screen diff).
- cc-suite audit on the impl diff; verify if fixes applied.

## Out-of-scope (restated, authoritative)
Screen migration; translating create/detail/archive/materials; changing visible UI copy; runtime locale
switching; third-party i18n dependency.

## Downstream (later, separate WIs — NOT this WI)
- `WI-i18n-2…N`: per-area screen migration (list → detail → create → archive → sub-sections → shell),
  each switching that area to the facade/catalog, accepting its zh-CN copy, and **burning down** the
  guard allowlist; each gated + audited.

## Stop condition
- Promoted/approved → implement WI-i18n-1 (separate authorized turn). Superseded if parent plan changes.

> Not authorized for implementation until promoted + `/cc-suite:review-plan` READY + any Critical/High
> findings fixed. No code until then.
