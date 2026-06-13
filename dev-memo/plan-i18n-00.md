# Plan — Renderer i18n structure (holistic, drift-preventing)

**Status**: PLAN WI (non-authorizing). Not implementation-authorizing until it passes
`/cc-suite:review-plan` and the open decision points below are resolved by the user.
**Date**: 2026-06-13. **Author**: Claude Code.
**Type**: PLAN (doc-only). **Scope**: diagnosis + proposed structure for renderer localization.
**Explicit non-goal of THIS WI**: translating any screen, editing label values, or touching
create/archive/materials UI. This document only proposes a structure and surfaces decisions.

## 1. Problem statement

The renderer has no i18n layer. As screens were reworked incrementally, the matter **list**
(`#/matters`, PR2) was authored in **Chinese**, while every other surface — matter **detail**
(`#/matters/:id`), **create**, **archive**, and the lazy documents/deadlines/facts/docket/audit
sections — plus the **shell** chrome remain **English**. Clicking a Chinese list row opens an
English detail page. The same enum (`matter_type`, `confidentiality_class`, `status`) now has **two
divergent label sources**. Without a structure, every future screen risks adding a third copy or a
new hardcoded literal, and the list↔detail language gap widens.

## 2. Existing context used (diagnosis — real file references)

- **Shared English enum helpers** — `apps/lawbar-desktop/renderer/format.ts`:
  `matterTypeLabel` (L70), `confidentialityLabel` (L87), `statusLabel` (L98),
  `deadlineUrgencyLabel` (L58), `ledgerCategoryLabel` (L135). All English; consumed by
  viewMatter / createMatter / archiveMatter / sub-sections.
- **Audit-event labels** — `apps/lawbar-desktop/renderer/screens/auditEventLabels.ts`:
  `EVENT_KIND_LABELS` frozen record (English), e.g. `MATTER_REGISTERED: "Matter created"`.
- **Parallel Chinese copies** — `apps/lawbar-desktop/renderer/screens/listMatters.ts`:
  list-local `matterTypeLabelZh` (L41), `confidentialityLabelZh` (L58), `statusLabelZh` (L69),
  plus ~26 hardcoded CJK chrome literals (title `案件台账`, tabs `进行中`/`已归档`, column headers,
  empty copy `…仅保存在本机`, `+ 新建案件`, `加载更多`, loading text).
- **Hardcoded English UI literals (count of `el(...,["…"])` strings)**: viewMatter 18,
  createMatter 13, viewMatterDocketProposals 12, viewMatterAudit 11, viewMatterDeadlines 8,
  viewMatterDocuments 7, archiveMatter 7, viewMatterFacts 6. Shell chrome strings live in
  `apps/lawbar-desktop/renderer/index.html` (titlebar/sidebar/statusbar; English).
- **No locale mechanism**: Phase 0 found none; no `navigator.language`, no catalog, no `t()`.
- **Related guards** (precedent for an anti-drift gate): `tests/renderer-no-hardcoded-color.test.mjs`
  (block-level lint) and `main.test.mjs` palette-sync show the repo's pattern of a test that pins a
  single source of truth.
- `dev-memo/deferred-audit-findings.md` — UISHELL-L1 (closed) noted the i18n gap as out-of-scope for
  per-screen work; the prior PR reports recommended a holistic i18n WI.

## 3. Assumptions

- **Inferred from repo state**: v1 is a single-user **Mac desktop** app (`client-local-first.md`);
  the design source is CJK-first (`dev-memo/design-source/cn-overlay.css`, README `案件台账`), and PR2
  chose Chinese for the list. → The likely v1 primary locale is **zh-CN**, with English as a
  secondary/fallback to add later. (Flagged as a decision in §6, not assumed-final.)
- **Safest local-first assumption**: no new runtime dependency; a tiny hand-rolled catalog + `t()`
  beats pulling an i18n library (local-first, offline, no supply-chain surface).
- **Display-only**: localization touches presentation strings only — never DTOs, IPC, persistence,
  the contract vocabulary, or enum *values*. No product-behavior change.

## 4. Non-goals

- Translating screens in this WI (this is the plan, not the migration).
- Runtime language switching UI (can be a later increment; structure should not preclude it).
- Changing enum values, DTO field names, IPC, or contract vocabulary.
- Any create/archive/materials feature work.
- Adopting a third-party i18n framework (proposed: hand-rolled, dependency-free).

## 5. Options considered

- **A. Per-screen local labels (status quo)** — rejected: this IS the drift source (format.ts EN +
  listMatters Zh). Scales to N copies; no single source of truth.
- **B. Shared catalog + `t(key)` + consolidated enum-label module (recommended)** — one message
  catalog keyed by stable IDs, one resolved locale at runtime, ALL enum labels in a single module
  that returns the active-locale string (replacing both `format.ts` EN helpers and the listMatters
  `*Zh` copies). Free-text chrome strings move into the catalog. A guard test prevents new raw UI
  literals. Single source → drift becomes structurally impossible.
- **C. Third-party i18n lib (e.g. i18next)** — rejected for v1: new runtime dependency (a hard-stop
  per `autonomy.md`), heavier than a single-app, ~150-string surface needs.

## 6. Recommended direction (Option B) + open decisions

Structure (to be implemented in a FOLLOW-UP WI after approval):

1. **`renderer/i18n/catalog.<locale>.ts`** (or one `catalog.ts` keyed by locale) — stable string IDs
   → text. Covers: enum labels (matterType/confidentiality/status/deadlineUrgency/ledgerCategory/
   eventKind) AND chrome strings (titles, tabs, column headers, buttons, empty/loading/error copy,
   shell labels).
2. **`renderer/i18n/index.ts`** — `t(id, params?)` resolving the active locale; a single `LOCALE`
   constant for v1 (no switcher yet). Pure + testable (injectable like `dom.ts`).
3. **Consolidated enum labels** — delete `format.ts` EN enum helpers and `listMatters` `*Zh` copies;
   both become thin `t()` lookups. (`format.ts` keeps non-label pure utils like `formatLocalDateTime`,
   `ulidShort`, `classifyDeadlineUrgency`.) `auditEventLabels.ts` folds into the catalog.
4. **Anti-drift guard** — a test (sibling to the no-hardcoded-color lint) that flags raw user-facing
   string literals (CJK or bare English UI text) in `renderer/screens/**` + `index.html` outside the
   catalog, so a new hardcoded label fails CI.
5. **Shell strings** — move `index.html`'s static chrome text into the catalog applied at bootstrap
   (or keep static but single-locale-consistent), decided with the locale choice.

**Resolved decisions (user, 2026-06-13):**
- **D1. Primary v1 locale = `zh-CN`.** The catalog is keyed by stable IDs so `en` can be added later
  without re-translating; v1 ships zh-CN only.
- **D2. Runtime language switching = NO for v1.** A single `LOCALE = "zh-CN"` constant resolved at
  bootstrap; no switcher UI / setting. Catalog shape still keyed so a switcher is a later additive change.
- **D3. Catalog format = TypeScript** (type-safe string-ID keys; no JSON).
- **D4. Migration sequencing**: the **first WI builds catalog + `t()` + the anti-drift guard ONLY**
  (no screen migration); screen migrations follow as **separate, later WIs**, each gated, burning the
  guard's per-file allowlist down to empty.

## 7. Risks

- **High — test churn**: ~80+ label assertions across `renderer-*-matter`, list, view, sub-section
  tests will move from literal expectations to catalog-driven ones. Mitigation: tests assert via the
  same `t()`/catalog (single source), not duplicated literals.
- **Medium — partial-migration drift during rollout**: if migration is multi-WI, the guard test must
  land EARLY and allow an explicit per-file allowlist that shrinks to empty, so half-migrated state is
  visible and converges. Mitigation: guard + allowlist with a burn-down.
- **Medium — locale choice reversibility**: picking zh-CN-only now and adding en later is cheap IF the
  catalog is keyed by ID from the start; picking en-only would mean re-translating PR2's CN list.
- **Low — `format.ts` consumers**: deleting EN enum helpers touches viewMatter/createMatter/archive/
  sub-sections imports. Mechanical; covered by the migration WI.

## 8. Hard stops

- **New runtime dependency** — AVOIDED by the hand-rolled recommendation; adopting a lib (Option C)
  would trigger the `autonomy.md` hard-stop and needs explicit approval.
- **Locale = product direction** — D1/D2 are product decisions; per `client-local-first.md` +
  `autonomy.md` they are STOP-AND-ASK, not agent-defaulted.
- No contract/IPC/DTO/enum-value change (would be a separate ADR-gated change; this WI forbids it).

## 9. Required downstream artifact

D1–D4 are RESOLVED (§6). Promote to a migration WI plan (`dev-memo/plan-i18n-impl-00.md`) ONLY after
this plan passes `/cc-suite:review-plan`. The first migration WI builds the catalog + `t()` + guard
only (no screen migration); per-screen migration WIs follow per §6 D4.

## 10. Required cc-suite review

> This idea is not authorized for implementation until:
> 1. It is promoted into a tracked migration WI plan.
> 2. The plan includes a `## Review packet (compact)` section if high-risk.
> 3. cc-suite review-plan returns READY or only Low-risk clarifications remain.
> 4. Any Critical/High findings are fixed and re-reviewed.
> 5. The locale/runtime-switch decisions (D1/D2) are authorized by the user — DONE: D1=zh-CN,
>    D2=no runtime switch (user, 2026-06-13).

## 11. Next bounded WI suggestion

`WI-i18n-1: scaffold renderer/i18n/ catalog + t() + anti-drift guard test (no screen migration)` —
build the structure + the failing-on-new-literal guard with an explicit per-file allowlist seeded to
the current screens, so migration WIs burn the allowlist down to empty. Expected paths:
`renderer/i18n/*`, `tests/renderer-i18n*.test.mjs`. No screen DOM/label change in that WI.

## 12. Stop condition

- Promoted to `dev-memo/plan-i18n-impl-00.md` after D1–D4 + review-plan → this plan retired.
- Superseded if the product direction changes the locale strategy.
