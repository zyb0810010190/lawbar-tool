# Gate 3 — Client Release-Readiness Assessment — 00

**WI:** `WI-GATE3-CLIENT-RELEASE-HARDENING-00` (Type: IMPL, release/client-hardening).
**M0 go-live gate:** gate 3 — "Client surface (Mac desktop app)" (`docs/release/go-live-readiness-report.md` §1 gate 3).
**Date:** 2026-07-05. **Branch:** `gate3-client-release-hardening` (from `main` @ `84de3ce`).
**Result:** **Gate 3 remains PARTIAL** — this WI closes the one bounded, auditable, non-STOP-AND-ASK blocker (the stale package self-declaration) and documents the residual. Gate 3 cannot fully CLEAR here: its release posture depends on **gate 4** (signing / notarization / public distribution — a user STOP-AND-ASK) and one product-UI residual (the global overdue-deadline dashboard banner). This assessment does **NOT** imply go-live approval.

---

## 1. What this WI fixes (auditable, non-STOP-AND-ASK)

**The stale desktop package self-declaration.** `apps/lawbar-desktop/package.json` `description` previously read:

> "First UI shell — Electron app + theme-token foundation. Token-compliance fixture only; NOT product UI; NOT signed; NOT for distribution."

That framing was **factually stale**: the app is a substantial functional local-first case-box client, not a token-compliance fixture. Evidence (readiness report §1 gate 3): **12 renderer screens** (`renderer/screens/`: listMatters / createMatter / archiveMatter / viewMatter + viewMatter{Audit,Deadlines,DocketProposals,Documents,Facts,Links,T3Catalog}), **26 case-box IPC channels** (`src/caseBox/handlerShared.ts`), electron `main.ts` + `preload.mts`, and the shipped forms-T3 证据目录/说明 preview + DOCX export.

The `description` field (only) is reframed to accurately describe the **v1 local-first, offline-first Mac desktop case-box client** per `.claude/rules/client-local-first.md`, **while preserving the honest release deferral** — the build is not yet code-signed or notarized, and public distribution remains a pending gate-4 decision (no claim of signed or distributable). No other package field changed (no version, scripts, dependencies, `engines`, or the electron-builder `build` block).

## 2. What remains residual (gate 3 stays PARTIAL)

| # | Residual | Why it is NOT closed here | Disposition |
|---|---|---|---|
| R1 | **Signing / notarization / public distribution / release posture** | Requires an Apple Developer ID, code-signing identity, notarization profile, and a distribution-channel choice — all **user decisions**. | **Gate 4 STOP-AND-ASK** (`go-live-readiness-report.md` §1 gate 4, §4). Dev-mode signing is acceptable-deferred; public release cannot clear without the user's gate-4 decision. |
| R2 | **Global overdue-deadline dashboard banner** (brief §10 — "dashboard banner when any deadline is overdue or due within 7 days … whenever the case-box UI opens") | This is a NEW cross-matter product-UI feature on the app-open / matter-list surface. It is **product-UI buildout**, out of scope for this hardening WI, and a `Type: UI` change requires a design artifact per `UI-GATES.md`. | **Separate `Type: UI` WI** (design-artifact-gated). See §3 for the precise gap — the per-matter urgency surfacing already exists; only the *global/dashboard* banner is missing. |
| R3 | **Product-grade error / empty-state / resilience hardening** (beyond the self-declaration) | Bounded polish items (empty-state copy, error-toast consistency, etc.) not required to make gate 3's client *functional* claim accurate; no single blocker identified. | Bounded follow-up WIs as prioritized; none is an M0 correctness blocker. |

## 3. Overdue-deadline surfacing — precise gap (brief §10 vs §18)

To avoid over- or under-claiming R2: the deadline **urgency surfacing already exists at the per-matter level**. `renderer/screens/viewMatterDeadlines.ts` classifies each pending deadline overdue / due-soon (≤7 days) against an injected clock, renders a `role="status"` banner summarising the counts, and marks urgent rows with a pill (`classifyDeadlineUrgency` / `deadlineUrgencyLabel`, unit-tested in `tests/renderer-deadline-urgency.test.mjs`, brief §18). A visible overdue **list** is therefore present on the deadlines screen.

What is **missing** is the brief §10 **global dashboard banner** — a cross-matter warning surfaced when *any* deadline (in any matter) is overdue or due within 7 days, visible **whenever the case-box UI opens** (e.g. on the `listMatters` home surface), not only after navigating into a specific matter's deadlines screen. That global banner is R2's separate `Type: UI` WI.

## 4. Verification (this WI)

- `apps/lawbar-desktop/package.json` diff touches **only** the `description` string (one field); no version / scripts / dependencies / `engines` / `build` block change.
- `npm --prefix apps/lawbar-desktop test` — expected PASS (a `description`-only metadata change does not affect the build or tests).
- `check-queue` PASS, `check-contract-integrity` PASS, `CURRENT_SCHEMA_VERSION` = 12 (untouched).
- No renderer/UI source change, no electron-builder / signing / packaging config change, no dependency, no schema / contract / persistence change, no OCR / Forms work.

## 5. Gate 3 status

**Gate 3 remains PARTIAL.** The self-declaration blocker is closed; the functional client claim is now accurately described. The residual is R1 (gate-4 STOP-AND-ASK — user decision) + R2 (the global overdue-deadline dashboard banner — a separate design-artifact-gated `Type: UI` WI) + R3 (bounded polish follow-ups). Per `.claude/rules/security-boundary.md` §"Go-live independence" and the readiness report §4, this does **NOT** imply go-live readiness — the final GO/NO-GO verdict (blueprint gate 21) and the three STOP-AND-ASK hard-stops (framework / public-distribution / signing = gate 4; 律师法 confidentiality compliance = gate 11; final sign-off = gate 21) remain the user's.
