# Plan — WI-DESKTOP-ZH-CN-I18N-COMPLETE-01

**Type**: UI (i18n hardening). **Design artifact**: `dev-memo/design/2026-07-09-desktop-zh-cn-settings-entry.md`
(same Chinese-first intent; this WI completes per-surface coverage + adds the regression guard).
Follows `WI-DESKTOP-ZH-CN-SETTINGS-ENTRY-00` (merged `d369e36`).

## Scope

Complete the fully-Chinese user-facing interface and add a guard that fails on user-facing-English
regressions. Renderer-only: no schema/contract/persistence/boundary change; contract enum VALUES stay
English (only their display LABELS become Chinese).

- **Rendered raw-enum gaps closed** (the static-literal scan could not see these): deadline `kind·status`,
  docket `proposed_kind·source_type`, docket reminder `kind`, audit `entity_type` — now rendered via new
  `renderer/i18n/labels.ts` facades (`deadlineKindLabel`, `deadlineStatusLabel`, `docketSourceTypeLabel`,
  `reminderKindLabel`, `auditEntityTypeLabel`), each an open-string lookup with raw-value fallback.
- **Guard**: `classifyLiteral()` in `tests/_i18n-ui-scan.mjs` + tests in `renderer-i18n-guard.test.mjs`
  that FAIL the build if any scanned renderer literal is user-facing English. Every allowlist entry is
  classified; the `user-facing` class must stay empty.
- **Classification artifact**: `dev-memo/i18n-allowlist-classification-00.md` (52 identifier-or-enum /
  47 interpolation-or-separator / 0 user-facing).

## Acceptance (all met)

- `npm --prefix apps/lawbar-desktop test` → 818 pass / 0 fail (incl. the new guard tests).
- `npm run test:ui-packaged` → 1 pass (Chinese flow + Settings boundary).
- `npm run dist` → success (arm64 + x64).
- Allowlist **197 (pre-Lane-2) → 100 (Lane 2) → 100 (this WI)**; the this-WI delta is text-only (raw-enum
  templates now call label facades), and the `user-facing` count is **0** and guarded.

## cc-suite audit record

- **Kind**: audit. **Scope**: `labels.ts` + `viewMatterDeadlines/DocketProposals/Audit.ts` + `_i18n-ui-scan.mjs` (inlined diff).
- **Runner**: `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (Path 1, foreground).
- **Model/effort/sandbox**: `gpt-5.5` / `high` / `read-only`. **Job ID**: `audit-mrcur0ez-2ow96i`. Retrievable: YES.
- **Verdict**: label wiring PASS (no enum VALUE changed, display semantics preserved); the guard was flagged for precision. Dispositions:
  - **High #1 (English hidden inside `${…}` interpolations bypasses the classifier)** → **FIXED**: `classifyLiteral` now classifies quoted literals inside interpolations too (dotted catalog keys stay exempt); bite test added.
  - **High #2 (scanner does not cover UI copy returned by a helper outside the el/setText/textContent/aria idioms)** → **ESCALATED to user + tracked** as a guard-precision limitation, NOT a defect in the delivered UI (the migration routes all display text through `t()`/facades; the `user-facing` scan is empty; the packaged smoke is Chinese end-to-end). Backstopped by the scan==allowlist exactness test. Follow-up: `WI-DESKTOP-I18N-SCANNER-SCOPE-02` (scanner idiom-coverage). Recorded in `dev-memo/deferred-audit-findings.md`.
  - **Medium (a lone single English word classifies as identifier-or-enum)** → accepted + documented; single-word copy goes through `t()`, and the exactness test still trips on a new lone word.
  - **Low (raw-value fallback renders English for an unknown future enum value)** → accepted (schema-safe / debuggable); a new enum value needs catalog+facade coverage.

## Out of scope

Redesign; backend/contract change; translating enum VALUES; deep main-process `errorMap.ts` messages
(abnormal IPC-failure path only); scanner idiom-coverage enhancement (tracked follow-up).
