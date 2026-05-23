# Plan: Legacy `docs/release/go-live-plan.md` Reconciliation (PLAN-ONLY)

> **ENUMERATION + ANALYSIS ONLY.** This document identifies conflicts, obsolescence, missing gates, and required updates between the legacy `docs/release/go-live-plan.md` and the current product state. It does NOT rewrite the legacy plan, does NOT start any gate-clearing WI, does NOT make legal / vendor / signing / deployment / migration / external-exposure decisions. Each amendment proposed below requires a SEPARATE explicit user authorization to land.

**Status**: READY (revision 2 — Path 1 native --background rev-1 review returned READY (Low-risk clarifications) with 2 Mediums + 3 Lows; rev-2 applies all 5: WI-09a relabeled "artifact-verified" not "commit-verified"; gate #9 clarified (CLEARED by WI-03d only; WI-04 stays UNVERIFIED); WI count drift fixed (23 not 22); gate roll-up split to add "cleared without legacy coverage" bucket; §4 reordered (post-pivot architecture WI moves to #2, before per-WI edits); explicit "do NOT edit legacy in this lane" sentence added at §4 head; §5 "verbatim" replaced with "by reference without modification".).
**Date**: 2026-05-23.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Lane**: plan-only gate-clearing — legacy go-live-plan reconciliation (corresponds to WI #9 in `dev-memo/plan-go-live-readiness-00.md` §5, which the rev-3 review of that blueprint flagged as a MANDATORY predecessor to the FINAL audit WI #14).
**Predecessor**: blueprint `1b92c58` on `origin/main`.

## Review packet (compact)

### Active plan summary

The legacy `docs/release/go-live-plan.md` (1901 lines, organized around WI-00..WI-13) was authored BEFORE the project pivoted to a Mac-desktop single-lawyer local-first product. Its framing assumes the **OCR worker is the v1 product**, with "case-box layer" listed under §"Deferred To Post-v1". The current product state at HEAD `1b92c58` has INVERTED this framing:

- **Case-box layer is the v1 product** (Mac desktop client over case-box-persistence; Phase A in-memory + Phase B SQLite both shipped + pushed; B1-B11 complete at `98446aa`).
- **OCR pipeline is one supporting input** to case-box ingestion (still required for v1 but not the product itself).
- **Project brief** (`docs/product/project-requirements-brief.md` status READY revision 5) is the new product-direction source of truth.
- **Go-live readiness blueprint** (`dev-memo/plan-go-live-readiness-00.md` status READY revision 4, commit `1b92c58`) enumerates the 21 readiness gates against the current architecture.

This reconciliation report does THREE things:

1. **§1 Conflicts matrix** — every legacy claim that contradicts the current state, with the contradiction explicit.
2. **§2 Obsolete-assumption inventory** — legacy assumptions that are no longer load-bearing.
3. **§3 Missing-gate map** — categories in the blueprint that have NO corresponding legacy section.
4. **§4 Required updates** — proposed amendments to the legacy plan, each as a separate future WI (this reconciliation does NOT execute them).

Plan-only file: `dev-memo/plan-go-live-plan-reconcile-00.md` (THIS FILE).

### Exact target files (THIS plan-WI)

CREATED (single file):
- `dev-memo/plan-go-live-plan-reconcile-00.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `docs/release/go-live-plan.md` (THE legacy file under analysis; PRESERVED unchanged).
- `docs/release/go-live-readiness-report.md`.
- `docs/release/wi-03-security-signoff.md`.
- `docs/release/operator-checklist.md` / `docs/release/ocr-worker-runbook.md` (scaffolds).
- `docs/product/project-requirements-brief.md`.
- `docs/product/product-target-architecture.md`.
- `docs/adr/**`.
- `dev-memo/plan-go-live-readiness-00.md` (the blueprint).
- `services/**`, `docs/contracts/**`, AGENTS.md.

### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. §1 conflicts matrix enumerates every legacy claim that contradicts current state.
3. §2 obsolete-assumption inventory documents every legacy assumption no longer load-bearing.
4. §3 missing-gate map covers all 21 blueprint gates and identifies which have legacy coverage vs. which do not.
5. §4 proposed amendments are bounded WIs (NOT executed by this reconciliation).
6. Plan respects authority hierarchy per `.claude/rules/project-brief.md` §"Authority hierarchy" + blueprint §2.
7. Plan does NOT propose any change to ADRs without explicit user authorization for each one.
8. Plan does NOT propose any change to brief (brief is READY; amendments use `/project-brief` skill).
9. Plan does NOT propose silent edits to legacy file (per `.claude/rules/staging-hygiene.md`).
10. cc-suite review-plan returns READY (or only Low-risk clarifications remain) via Path 1 native `--background`.

### Exact out-of-scope list

- **Implementing any amendment** to the legacy plan (each is a separate authorized WI).
- **Editing `docs/release/go-live-plan.md`** (this reconciliation produces only THIS reconciliation report).
- **Producing `docs/release/go-live-readiness-report.md` content** (still gate #21 from the blueprint).
- **Modifying the brief or any ADR**.
- **Touching any service code, test, or contract**.
- **Auth provider / cloud vendor / signing / migration / production deployment / LLM execution / external document exposure** — all hard-stops; user-only.
- **`git push`** (separate explicit authorization).

### Essential references

- `docs/release/go-live-plan.md` (THE legacy file; 1901 lines).
- `dev-memo/plan-go-live-readiness-00.md` (blueprint; status READY revision 4 at `1b92c58`).
- `docs/product/project-requirements-brief.md` (status READY revision 5).
- `docs/product/product-target-architecture.md` (derived view per brief §"Authority hierarchy").
- `docs/release/wi-03-security-signoff.md` (HTTPS DNS-pinning sign-off; commit `ce3f287`).
- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (umbrella; COMPLETE at `98446aa`).
- `dev-memo/plan-client-00.md` (client-surface reconciliation).
- `dev-memo/deferred-audit-findings.md` (open Lows from B5-B11).
- `.claude/rules/autonomy.md` §"Hard-stop list".
- `.claude/rules/security-boundary.md` §"Go-live independence".
- AGENTS.md §"Go-live rule".

### Review questions for the reviewer

1. **Framing inversion**: §1 #1 documents that the legacy plan treats OCR as the v1 product and case-box as "deferred post-v1", while current state has case-box as v1 core. Is this the load-bearing finding? Should the reconciliation propose a top-of-file reframing note BEFORE WI-level edits?

2. **WI status determination**: §1 lists each of WI-00..WI-13 with a current-state classification (DONE / IN-SCOPE-UNCHANGED / IN-SCOPE-REFRAMED / DEFERRED-CONFIRMED / SUPERSEDED). The DONE classifications need EVIDENCE pointers. Should every "DONE" row require a commit hash citation?

3. **Brief §20 vs WI-11**: legacy WI-11a..d (paddleocr bakeoff) is v1-blocking under the OCR-as-product framing; brief §20 marks "Document text-extraction engine choice" as STOP-AND-ASK post-v1. Direct conflict — §1 marks WI-11 as REFRAME-OR-DEFER pending user decision.

4. **WI-12 test scope**: legacy WI-12 lists "five core packages" without enumerating them. Today's package set is: case-box-persistence, case-box-contract, ocr-worker-contract (docs/contracts), ocr-persistence, ocr-worker. The blueprint's gate #5 covers all five plus a SIGINT flake gate. §1 marks WI-12 as IN-SCOPE-REFRAMED.

5. **WI-13 vs blueprint**: blueprint gate #21 (final readiness report) IS the content of legacy WI-13. The reconciliation should NOT propose two separate "final readiness report" WIs — the blueprint's WI #15 is the canonical successor. §4 documents this supersession.

6. **No silent edits**: §"Required updates" §4 lists 8 proposed amendment WIs. Each must be a separately-authorized commit per `.claude/rules/staging-hygiene.md`. Confirmed?

7. **Hard-stop coverage**: §3 missing-gate map shows 5 blueprint gates with NO legacy coverage (distribution signing, legal compliance, supply-chain, telemetry, license/privacy). Each requires a NEW section in the legacy file (or in a new doc). Plan picks: defer to per-WI authorization, do NOT lump into one amendment.

---

## §1 Conflicts matrix

Every legacy claim that contradicts the current state.

### §1.1 Framing-level conflicts (foundational)

| # | Legacy claim | Source in legacy | Current state | Conflict severity |
|---|---|---|---|---|
| 1 | "Case-box layer: defer to its own ADR series because confidentiality, privilege, audit, deadline, and multi-user data shape are larger than OCR go-live hardening." | §"Deferred To Post-v1" bullet 5 | Case-box layer is the **v1 core product**. Phase A (memory) + Phase B (SQLite B1-B11) BOTH SHIPPED. | **CRITICAL** — entire legacy framing assumes OCR-as-product; current state has case-box-as-product. |
| 2 | "v1 assumes local SQLite and a single-tenant worker host posture." | §"Deferred To Post-v1" bullet 8 | v1 is Mac-desktop single-lawyer client per brief §3-§5; "worker host" framing is post-v1 OCR-service context, not v1. | **HIGH** — v1 "host" model is desktop app, not worker host. |
| 3 | "Cloud OCR backend and cloud authorization schema: local OCR remains default; cloud opt-in per document is post-v1." | §"Deferred To Post-v1" bullet 7 | Brief §6 LOCKS local-first per document/per matter/per explicit-sync. Consistent with legacy; **NO conflict** but worth flagging the policy consistency. | NONE — confirms direction. |

### §1.2 WI-level conflicts (WI-00..WI-13 against current state)

| WI | Legacy bucket | Current-state classification | Conflict detail |
|---|---|---|---|
| WI-00 (autonomous loop preflight) | v1-blocking | **IN-SCOPE-UNCHANGED** | Still required; re-run against current HEAD. |
| WI-00b (preflight evidence record) | v1-blocking | **IN-SCOPE-UNCHANGED** | Same. |
| WI-01 (HTTPS DNS-pinning TLS prototype) | v1-blocking | **DONE** at `f96be47` | Shipped per `docs/release/wi-03-security-signoff.md`. |
| WI-02t (regression test spec) | v1-blocking | **DONE** at `4dfc612` | Shipped. |
| WI-02 (fetcher seam) | v1-blocking | **DONE** at `df81b43` | Shipped. |
| WI-03a (HTTPS transport core) | v1-blocking | **DONE** at `0c8211f` | Shipped. |
| WI-03b (runtime address validation) | v1-blocking | **DONE** at `1a9f55c` | Shipped. |
| WI-03c (response adapter) | v1-blocking | **DONE** at `74ac1db` | Shipped. |
| WI-03d (TLS test harness) | v1-blocking | **DONE** at `ce3f287` | Shipped + signed off. |
| WI-04 (DNS-pinning regression + operator docs) | v1-blocking | **STATUS UNVERIFIED** | Operator-doc portion may overlap blueprint gate #13 (Mac-client operator section). Needs verification WI before reframing. |
| WI-05 (monotonic pending-retry writes) | v1-required-but-deferrable | **STATUS UNVERIFIED** | Needs verification against current ocr-worker / ocr-persistence state. |
| WI-06 (orphaned pending-retry reconciler) | v1-required-but-deferrable | **STATUS UNVERIFIED** | Same. |
| WI-07 (retry-storm observability) | v1-blocking | **STATUS UNVERIFIED** | Same. |
| WI-08 (coordinator L2/L3 refactor) | v1-deferred | **DEFERRED-CONFIRMED** | Unchanged. |
| WI-09a (release doc scaffold) | v1-blocking | **DONE — artifact-verified** (NOT commit-verified; per rev-1 reviewer M D1#1) — scaffolds exist: `docs/release/go-live-plan.md`, `go-live-readiness-report.md`, `operator-checklist.md`, `ocr-worker-runbook.md`, `wi-03-security-signoff.md`, `test-and-audit-report.md`. | Shipped. Commit-hash citation deferred to amendment WI #3 (per-WI status annotation) — research WI may surface specific commit if reviewer requires. |
| WI-09b (operator runbook + deployment docs) | v1-blocking | **IN-SCOPE-REFRAMED** | Legacy scope is OCR worker production runbook; current need adds a Mac-client operator section. Blueprint gate #13. |
| WI-10 (production fail-closed release probe) | v1-blocking | **IN-SCOPE-REFRAMED** | Legacy scope is OCR worker exit-2; current Mac-client equivalent is app-launch fail-closed (no fake worker, valid config). Different artifact shape. |
| WI-11a (fixture acquisition gate) | v1-blocking | **REFRAME-OR-DEFER** | Brief §20 marks "Document text-extraction engine choice" as STOP-AND-ASK post-v1. Direct conflict with v1-blocking status. User decision required. |
| WI-11b (bakeoff harness) | v1-blocking-conditional | **REFRAME-OR-DEFER** | Same conflict as WI-11a. |
| WI-11c (full measurement run) | v1-blocking-conditional | **REFRAME-OR-DEFER** | Same. |
| WI-11d (ADR-11A.1 v1.0 verdict) | v1-blocking | **REFRAME-OR-DEFER** | Same. |
| WI-12 (full test matrix + audit sweep) | v1-blocking | **IN-SCOPE-REFRAMED** | Legacy mentions "five core packages" without enumerating them. Current set: case-box-persistence, case-box-contract, ocr-worker-contract, ocr-persistence, ocr-worker. Blueprint gate #5/#6 covers this; WI-12 should be widened to include the case-box packages explicitly. |
| WI-13 (final readiness report) | v1-blocking | **SUPERSEDED-BY-BLUEPRINT** | Blueprint `dev-memo/plan-go-live-readiness-00.md` is the new framework. Blueprint gate #21 (and WI #15 in blueprint §5) IS the legacy WI-13. NOT two separate WIs — one canonical successor. |

Summary (23 WIs total per rev-1 reviewer M D2#1; legacy plan enumerates WI-00, WI-00b, WI-09a, WI-01, WI-02t, WI-02, WI-03a, WI-03b, WI-03c, WI-03d, WI-04, WI-05, WI-06, WI-07, WI-08, WI-09b, WI-10, WI-11a, WI-11b, WI-11c, WI-11d, WI-12, WI-13 = 23 entries; WI-03 "split (overview)" is a header NOT a separate WI):
- DONE (commit-verified except WI-09a artifact-verified): WI-01, WI-02t, WI-02, WI-03a, WI-03b, WI-03c, WI-03d, WI-09a (8 WIs).
- IN-SCOPE-UNCHANGED: WI-00, WI-00b (2 WIs).
- IN-SCOPE-REFRAMED: WI-09b, WI-10, WI-12 (3 WIs).
- STATUS-UNVERIFIED (needs verification WI): WI-04, WI-05, WI-06, WI-07 (4 WIs).
- REFRAME-OR-DEFER (user decision required): WI-11a, WI-11b, WI-11c, WI-11d (4 WIs).
- DEFERRED-CONFIRMED: WI-08 (1 WI).
- SUPERSEDED-BY-BLUEPRINT: WI-13 (1 WI).

Total: 8 + 2 + 3 + 4 + 4 + 1 + 1 = **23 WIs**.

---

## §2 Obsolete-assumption inventory

Legacy assumptions no longer load-bearing.

| # | Assumption | Where it appears | Why obsolete |
|---|---|---|---|
| 1 | "OCR worker is the v1 product." | Implicit throughout WI-00..WI-13 framing | Phase B SQLite case-box layer shipped at `98446aa`; brief §3 locks v1 product to Mac-desktop client over case-box. |
| 2 | "Operator runbook is for an OCR worker service running on a host." | WI-09b acceptance criteria | v1 ships as a Mac desktop app; "operator" maps to the lawyer using the app. The OCR worker may still run as a sidecar/subprocess but is NOT the operator-facing surface. |
| 3 | "Five core packages" (unenumerated). | WI-12 acceptance criteria | Current set is 5: case-box-persistence (NEW), case-box-contract (NEW), ocr-worker-contract, ocr-persistence, ocr-worker. Legacy WI-12 predates the case-box-* packages. |
| 4 | "Production deployment" implies remote/server target. | Recurring phrasing | v1 production = lawyer installs the Mac app. There is no remote production environment in v1 scope (brief §6 + §16). |
| 5 | "Single-tenant worker host posture" as v1 baseline. | §"Deferred To Post-v1" | Brief §3 / §13: single-lawyer Mac client. `tenant_id` retained in schemas for forward compatibility, NOT because of multi-tenant v1. |
| 6 | "Auto-update mechanism" not addressed; legacy plan assumes service deployment cadence. | (silent omission) | Brief §4 explicitly: NO auto-update v1 (manual download). Auto-update mechanism is post-v1 STOP-AND-ASK. |
| 7 | OCR engine choice locked in WI-11d. | WI-11d v1-blocking | Brief §20 marks engine choice STOP-AND-ASK post-v1. |
| 8 | Case-box deferred. | §"Deferred To Post-v1" bullet 5 | Shipped. |

---

## §3 Missing-gate map (blueprint 21 gates → legacy coverage)

| Blueprint gate | Legacy coverage | Gap |
|---|---|---|
| #1 case-box persistence | NONE (case-box was deferred) | NO gap (gate CLEARED) — but legacy file should note the case-box layer is now in scope. |
| #2 OCR pipeline | WI-05, WI-06, WI-07, WI-08 (status-unverified) | Verification WI needed. |
| #3 Mac-client surface | NONE | **GAP — needs new legacy section OR new doc**. |
| #4 Distribution + signing | NONE | **GAP**. |
| #5 All-package tests | WI-12 (partial) | Widen scope to include case-box packages. |
| #6 Full audit clean | WI-12 (partial) | Re-run after case-box scope inclusion. |
| #7 Robustness policy | NONE | **GAP**. |
| #8 Deferred-Low triage | NONE | **GAP** (legacy plan predates the B5-B11 Lows). |
| #9 SSRF / TLS | WI-01..WI-03d (CLEARED per `wi-03-security-signoff.md`). WI-04 is **NOT** part of the SSRF/TLS clearance — it remains STATUS-UNVERIFIED for the operator-doc + regression-test scope per rev-1 reviewer M D1#2. | CLEARED for WI-03d only. |
| #10 Case-box security boundary | NONE | **GAP**. |
| #11 律师法 compliance | NONE | **GAP** (legal/business STOP-AND-ASK). |
| #12 Audit chain integrity | NONE | **GAP** (operational backup of audit chain). |
| #13 Operator + runbook | WI-09b | REFRAME for Mac client. |
| #14 Backup + recovery | NONE | **GAP** (local SQLite file backup). |
| #15 Rollback drill | NONE | **GAP** (legacy mentions rollback discipline but not a drill). |
| #16 Brief READY + reconciliation log | NONE | **GAP** (brief itself is the new surface). |
| #17 LICENSE + privacy notice | NONE | **GAP**. |
| #18 Data export certification | NONE | **GAP**. |
| #19 Supply-chain | WI-00 (partial: CVE triage only) | Widen to include license review + native-binary provenance. |
| #20 Telemetry / crash-reporting | NONE | **GAP** (brief §4 default-off; verify in code). |
| #21 Final readiness report | WI-13 | SUPERSEDED by blueprint WI #15. |

Legacy coverage roll-up (per rev-1 reviewer M D2#2 — gate #1 cleared-without-legacy-coverage gets its own bucket):
- CLEARED but NOT covered by any legacy WI: 1 (gate #1 case-box persistence — shipped outside the legacy plan's scope).
- FULLY COVERED + CLEARED: 1 (gate #9 SSRF/TLS).
- PARTIALLY COVERED (needs widening / reframing): 5 (gates #2 OCR, #5 tests, #6 audit, #13 runbook, #19 supply-chain).
- SUPERSEDED: 1 (gate #21 final report).
- GAP (no legacy coverage; v1 gate that needs new content): 13 of 21 gates.

Total: 1 + 1 + 5 + 1 + 13 = 21 gates.

**Most of the legacy file is OCR-pipeline content; most of the blueprint gates are not addressed at all in the legacy file.** A reframing amendment is the right vehicle, NOT line-by-line edits.

---

## §4 Required updates (proposed amendment WIs; NOT executed here)

Each row below is a SEPARATE bounded amendment WI the user may authorize. This reconciliation does NOT execute any of them.

**Do NOT edit `docs/release/go-live-plan.md` in this reconciliation lane.** All edits live in their own SEPARATELY-AUTHORIZED amendment WIs.

The order below is the recommended sequence (rev-1 reviewer L D3#1 reorder: post-pivot architecture section lands after the banner, BEFORE per-WI edits, so legacy-plan readers see the reframing before per-WI status changes); the user may pick or skip any.

| # | Amendment WI (plan-only) | Touches | Risk | Predecessors |
|---|---|---|---|---|
| 1 | Add a top-of-file "Reconciliation status" banner to `docs/release/go-live-plan.md` documenting the case-box-shipped pivot + pointer to the blueprint at `dev-memo/plan-go-live-readiness-00.md`. | `docs/release/go-live-plan.md` (top) | Low | None |
| 2 | Add a new top-level section "v1 Architecture (Post-Pivot)" describing the Mac-client-local-first product over case-box layer with OCR as one supporting input. Cite brief §3-§7. | `docs/release/go-live-plan.md` new section | Low | WI 1 |
| 3 | Update §"Deferred To Post-v1" — remove the "Case-box layer" bullet; replace with "Case-box layer SHIPPED at `98446aa` (Phase B SQLite complete)". | `docs/release/go-live-plan.md` §"Deferred To Post-v1" | Low | WI 2 |
| 4 | Add per-WI status annotations (DONE / IN-SCOPE-REFRAMED / STATUS-UNVERIFIED / REFRAME-OR-DEFER / SUPERSEDED) to each WI heading. | `docs/release/go-live-plan.md` WI-00..WI-13 sections | Low | WI 2 |
| 5 | Run verification on WI-04, WI-05, WI-06, WI-07 — **per rev-1 reviewer L D3#2 this WI may split into 4 per-WI research WIs** OR remain as one grouped research lane if the user explicitly authorizes grouping. Produces evidence rows + per-WI status flip in legacy plan. | `docs/release/go-live-plan.md` WI-04..WI-07 status flip | Medium (research) | WI 4 |
| 6 | Open a user-decision lane on WI-11a..d: ACCEPT the post-v1-defer per brief §20 (recommended) OR ACCEPT a v1-blocking carve-out. Recording lands in legacy plan + brief §20-link. | `docs/release/go-live-plan.md` WI-11 split + brief reference | **STOP-AND-ASK** (brief §20 conflict) | WI 4 |
| 7 | Widen WI-12 to enumerate the 5 packages (case-box-persistence, case-box-contract, ocr-worker-contract, ocr-persistence, ocr-worker) + reference the Sqlite-Final no-filter sweep at `tests/sqlite-final.conformance.test.mjs`. | `docs/release/go-live-plan.md` WI-12 acceptance criteria | Low | WI 4 |
| 8 | Mark WI-13 SUPERSEDED-BY-BLUEPRINT — add a pointer to `dev-memo/plan-go-live-readiness-00.md` gate #21 / WI #15 as the canonical successor; preserve legacy WI-13 acceptance criteria as content guidance for the final report. | `docs/release/go-live-plan.md` WI-13 + blueprint cross-ref | Low | WI 4, blueprint READY |

All amendments use **explicit-staging** per `.claude/rules/staging-hygiene.md` (one file per commit; per-WI commit messages). None of them touch services / contracts / brief / ADRs.

After all 8 amendments land, the legacy `docs/release/go-live-plan.md` becomes a **reframed v1 plan** consistent with the blueprint. The blueprint remains the gate-matrix source of truth; the legacy plan retains WI-level execution detail.

---

## §5 Hard-stop gates inherited from blueprint §4

All 23 items in `dev-memo/plan-go-live-readiness-00.md` §4 are inherited **by reference without modification** (per rev-1 reviewer L D5#2 — earlier "verbatim" wording overstated since this section summarizes selectively rather than copy-pasting all 23 entries). This reconciliation does NOT relax any of them. The full canonical list lives in the blueprint; the items below are the ones likely to surface in future amendment WIs:

- **§4.1 item #5** (Electron / Tauri / native runtime dependency) — triggered if amendment WI #8 above proposes a specific framework. Plan-only references DO NOT trigger; impl WIs DO.
- **§4.1 item #10** (new runtime dependencies) — same.
- **§4.1 item #18** (redaction ADR) — NOT triggered by any amendment here.
- **§4.2 item #21** (document text-extraction engine choice) — triggered by amendment WI #5 (WI-11a..d decision).
- **§4.2 item #22** (auto-update mechanism) — triggered if WI #8 above proposes a specific update mechanism. Plan-only references DO NOT trigger.
- **§4.3 item #23** (final GO/NO-GO verdict) — NOT triggered until blueprint WI #15.

---

## §6 Execution-discipline compliance

### §6.1 Think before coding
- WI scope: **PLAN ONLY**. No service code, no test, no infra, no legacy-file edits.
- Assumptions:
  - Phase B SQLite is COMPLETE at `98446aa` (verified).
  - Blueprint is READY at `1b92c58` (verified).
  - Legacy plan content read in full (1901 lines surveyed).
- Hard stops cross-checked: none in this WI itself (just documentation analysis).

### §6.2 Simplicity first
- Single file output. No structural changes to legacy plan.
- No new abstractions.

### §6.3 Surgical changes
- Touches only `dev-memo/plan-go-live-plan-reconcile-00.md`.
- Does NOT propose ANY silent edit to legacy plan; every amendment is a SEPARATE WI with its own commit.

### §6.4 Goal-driven execution
- Acceptance criteria testable.
- cc-suite review-plan on this file.

### §6.5 Relationship to existing rules
- Honors `.claude/rules/autonomy.md` §"Hard-stop list".
- Honors `.claude/rules/staging-hygiene.md` (no `git add .`; one file per commit).
- Honors `.claude/rules/project-brief.md` §"Authority hierarchy".
- Inherits blueprint §2 + §4 verbatim.

---

## §7 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Reconciliation is read as "approval to edit legacy plan in one sweep". | §4 explicit: each amendment is SEPARATE; top-of-file ENUMERATION-ONLY banner; per-row STOP-AND-ASK markers. |
| 2 | Medium | WI-04..WI-07 status-unverified rows are speculative without code-level verification. | §1 explicitly marks STATUS-UNVERIFIED and §4 WI #4 calls for a research WI to flip the rows. |
| 3 | Medium | WI-11a..d defer-vs-keep decision is on the user, not the assistant. | §4 WI #5 STOP-AND-ASK explicit; brief §20 cited. |
| 4 | Low | Reconciliation may miss legacy details inside WI bodies (only surveyed headings + key sections). | §"Essential references" lists legacy file as the source of truth; future amendment WIs read full WI body before authoring. |
| 5 | Low | A user instruction may want to skip a STOP-AND-ASK item flagged in §5. | Hard-stop list does not permit skipping; recorded for traceability. |

No Critical / High risks.

---

## §8 References

- `docs/release/go-live-plan.md` (1901 lines; THE legacy file).
- `dev-memo/plan-go-live-readiness-00.md` (blueprint; status READY rev-4 at `1b92c58`).
- `docs/product/project-requirements-brief.md` (status READY revision 5).
- `docs/release/wi-03-security-signoff.md` (commit `ce3f287`).
- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (umbrella; COMPLETE at `98446aa`).
- `dev-memo/plan-client-00.md`.
- `.claude/rules/autonomy.md` §"Hard-stop list".
- `.claude/rules/security-boundary.md` §"Go-live independence".
- `.claude/rules/staging-hygiene.md` §"Explicit-staging discipline".
- AGENTS.md §"Go-live rule".

---

## §9 Stop condition

This reconciliation report is stale or superseded when:
- All 8 amendment WIs in §4 land (or are explicitly declined per a recorded user decision).
- The legacy `docs/release/go-live-plan.md` reaches a state consistent with the blueprint (no more conflicts; no more missing-gate gaps).
- This file is moved to `dev-memo/superseded/` once gate #21 (blueprint) ships.
