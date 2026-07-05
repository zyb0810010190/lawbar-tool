# Design artifact — Global overdue-deadline dashboard banner (Gate 3 R2)

**Status:** design spec (the "noun" the `Type: UI` WI implements against, per `UI-GATES.md`). Not implementation-authorizing on its own; the governed WI `WI-GATE3-R2-OVERDUE-DASHBOARD-BANNER-00` implements against it.
**Date:** 2026-07-05. **Author:** Claude Code. **Source:** brief §10 ("dashboard banner when any deadline is overdue or due within 7 days … the lawyer sees overdue deadlines whenever the case-box UI opens"); gate-3 residual R2 (`docs/release/gate3-client-release-readiness-00.md` §2/§3).

## 1. Problem / gap

Brief §10 requires a **global dashboard banner** surfaced **when the case-box UI opens**, warning whenever **any** deadline in **any** matter is overdue or due within 7 days. Today the client has only a **per-matter** urgency surface: `renderer/screens/viewMatterDeadlines.ts` renders a `role="status"` banner + per-row pills for a single matter's deadlines, classified by the shared `classifyDeadlineUrgency` (brief §18, tested in `renderer-deadline-urgency.test.mjs`). The **cross-matter / app-open** banner does not exist. This design specifies ONLY that missing global banner; the per-matter banner is unchanged and MUST NOT be rebuilt.

## 2. Surface (where it mounts)

The **matter-list home** (`renderer/screens/listMatters.ts`) is the app-open landing (it renders on launch and after nav-home). The global banner mounts **at the top of the matter-list home surface**, above the matter list, so it is visible whenever the UI opens / returns home. (A shell-level mount — `renderer/index.ts`/`nav.ts` chrome, visible on every screen — is an acceptable alternative the implementer may choose IF it does not duplicate the per-matter banner; the home-surface mount is the v1 default for minimal scope.)

## 3. Data-source boundary (UI-ONLY — no new IPC/persistence)

The banner aggregates **client-side** over the **existing** per-matter deadline channel — it introduces **NO** new IPC channel, contract, DTO, or persistence query:

- Read the matters the home already lists via the existing `casebox:matter:list` (`deps.api.listMatters`).
- For each listed matter, read its deadlines via the **existing** `casebox:deadline:list` (`casebox:deadline:list` per-matter channel), then classify each `pending` deadline with the **reused** `classifyDeadlineUrgency(dueAt, status, nowMs)` + `DEADLINE_DUE_SOON_WINDOW_MS` from `renderer/format.ts` — **do NOT reimplement the urgency rule**.
- Sum `overdue` and `due-soon` counts across matters.

**Scope guard:** this is a UI-layer aggregation over existing channels. It MUST NOT add a cross-matter deadline-summary IPC channel or a persistence aggregation — that would be persistence/IPC/contract work outside a `Type: UI` WI. If the implementer finds N per-matter calls unacceptable at the target matter scale (v1 is single-lawyer, few matters — expected fine), that is a **STOP**: a separate persistence/IPC aggregation WI is required, not an in-scope expansion here.

## 4. States

| State | Behaviour |
|---|---|
| overdue > 0 or due-soon > 0 | Banner shown: a concise summary, e.g. "N overdue · M due within 7 days" (counts from §3). |
| both zero | Banner hidden (no empty "all clear" chrome for v1 — minimal). |
| loading | The banner area stays absent until the aggregation resolves (no flash / no spinner churn on the home). |
| error (a matter/deadline read fails) | Non-blocking **degraded** state: a quiet "couldn't check deadlines" message; the home matter list still renders. The banner MUST NOT crash or block the home screen. |

## 5. Accessibility

`role="status"` (polite live region), consistent with the existing per-matter banner in `viewMatterDeadlines.ts`. NOT `role="alert"` (overdue deadlines are important but not an interrupting emergency; brief §10 is "visible … only", no escalation). Text is real text (not colour-only); any urgency colour uses the existing design tokens (no hard-coded colour — `renderer-no-hardcoded-color.test.mjs` convention).

## 6. i18n

All banner strings go through the existing i18n catalog (`renderer/i18n/`), mirroring the per-matter banner's i18n pattern; no hard-coded user-facing English (the `renderer-i18n-guard` convention applies).

## 7. Distinction from the existing per-matter urgency UI (do NOT rebuild)

- **Existing (unchanged):** `viewMatterDeadlines.ts` — per-matter, on a single matter's deadlines screen: a `role="status"` count banner + per-row pills, `classifyDeadlineUrgency`, brief §18.
- **This WI (new):** a **global / cross-matter** banner at the **app-open home**, summarising urgency across ALL matters. It **reuses** `classifyDeadlineUrgency` and matches the per-matter banner's a11y/i18n idioms; it does **not** modify, move, or duplicate the per-matter banner.

## 8. Tests required before gate 3 is reassessed

- A renderer test (peer of `renderer-deadline-urgency.test.mjs` / `renderer-list-matters.test.mjs`) asserting, with an injected clock + mock api: (a) the aggregation counts overdue + due-soon across mock matters using `classifyDeadlineUrgency`; (b) the banner **renders** the correct counts when > 0; (c) the banner is **hidden** when both counts equal 0; (d) a failed per-matter read yields the **degraded** state and the home still renders; (e) the banner carries `role="status"`; (f) i18n labels resolve (no raw English).
- Full `npm --prefix apps/lawbar-desktop test` green.

## 9. Non-goals

- No new IPC/contract/persistence/DTO (client-side aggregation over existing channels only).
- No change to the per-matter `viewMatterDeadlines.ts` banner or to `format.ts`'s urgency rule (reuse only).
- No escalation / push / email / SMS (brief §10 explicitly excludes these; v1 UX is "visible … only").
- No gate-4 (signing/distribution) decision; no release-doc finalization; no gate-6 audit; no go-live decision.

## 10. Gate-3 effect

Implementing this closes gate-3 residual **R2**. Gate 3 may then advance but **still depends on gate 4** (signing/notarization/public distribution — a user STOP-AND-ASK) and R3 (bounded polish); the implementer records whether gate 3 remains PARTIAL or advances **without** collapsing the gate-4 STOP-AND-ASK, and never implies go-live.
