# Plan: Go-Live Readiness Blueprint (PLAN-ONLY)

> **ENUMERATION ONLY.** NO WI, dependency adoption, signing, release, push, migration, external service, or go-live action is authorized by this file. Every hard-stop item per `.claude/rules/autonomy.md` §"Hard-stop list" and `docs/product/project-requirements-brief.md` §20 remains a discrete STOP-AND-ASK gate. **Fix-forward only**, unless STOP-FOR-ROLLBACK is explicitly authorized. The user authorizes each gate-clearing WI separately.

**Status**: READY (revision 4 — Path 1 native --background rev-3 review returned READY (Low-risk clarifications); 2 Lows applied opportunistically: §7 risk #6 mitigation text aligned with §5 WI #14 widened prerequisites; §"Review questions" gate-count + STOP-AND-ASK count normalized to 21 / 23.) rev-3 — Path 1 native --background rev-2 review returned NEEDS-FIX with 1 High + 3 Mediums + 1 Low; rev-3 applies them: §5 WI #14 final-audit prerequisites widened (WIs 4,5,6,7,9,10,11,12,13 + gate #11 legal-compliance); gate-count drift normalized from 18 → 21 across §1, §3 (WI-13 → gate #21), §9 stop-condition; §4 "verbatim" softened to "inherits and enumerates" per rev-2 L D4#1; §4.1 #1 auth-provider cross-ref to gate #11 removed.) rev-2 — Path 1 native --background rev-1 review returned NEEDS-FIX with 2 Highs + 6 Mediums + 4 Lows; rev-2 applies them. Summary of rev-2 changes: header banner added; §2 authority hierarchy split into "product-direction authority" (matches `.claude/rules/project-brief.md` §"Authority hierarchy" verbatim) + "non-bypassable global constraints"; §4 STOP-AND-ASK expanded to mirror brief §20 + autonomy hard-stops in full; gate #4 reframed to brief-correct (manual download v1; auto-update post-v1); gate #5 hardened (flake must be deterministically resolved or quarantined; documented-acceptance not sufficient for GO); gate #7 reclassified as OPEN "robustness policy decision"; new gates #19 supply-chain + #20 telemetry / crash-reporting added; §5 WI ordering revised (baseline audit → Mac client + distribution + docs → FINAL audit); §3 explicit "provisional until WI-11 status verified" note; §7 risk #1 raised to High with header-banner mitigation; §7 missing-gate residual raised to Medium).
**Date**: 2026-05-23.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Lane**: plan-only go-live readiness (opened after Phase B SQLite completion at `98446aa`).
**Scope discipline**: this document is a **blueprint**, NOT an authorization. It enumerates gates, evidence sources, and decision points. It does NOT trigger production deployment, real-data migration, auth provider choice, cloud vendor choice, distribution signing, or any external document exposure. Every hard-stop item per `.claude/rules/autonomy.md` §"Hard-stop list" remains a discrete STOP-AND-ASK gate. The user authorizes each gate-clearing WI separately.

## Review packet (compact)

### Active plan summary

After Phase B SQLite completion (`98446aa`, pushed to `origin/main` `2026-05-23`), the case-box-persistence layer is implementation-complete: B1-B11 shipped; 1692 / 0 deterministic tests; 276 / 0 Sqlite-Final no-filter sweep; 0 C/H/M audit findings. **Phase B SQLite implementation completion ≠ v1 go-live readiness.** Many cross-cutting gates listed in `.claude/rules/autonomy.md` §"Hard-stop list" and in `docs/release/go-live-plan.md` §"Go-Live Readiness Gate" are NOT yet satisfied.

This blueprint reconciles **three pre-existing planning surfaces** into one readiness gate matrix:

1. `docs/release/go-live-plan.md` — OCR-pipeline-focused WI-00..WI-13 list. Pre-dates the Mac-client-local-first pivot. Many WIs are still in scope (security signoffs, fail-closed, runbook); others (e.g., production deployment patterns) need re-framing for a single-lawyer Mac desktop client.
2. `docs/product/project-requirements-brief.md` (status READY, revision 5) — v1 product direction: Mac desktop, single lawyer, local-first, no cloud, no LLM execution.
3. `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (umbrella) — Phase B SQLite implementation. NOW COMPLETE at `98446aa`.

The blueprint does NOT re-author any of these. It maps the current state of each against the readiness gates and identifies the bounded plan-only follow-up WIs the user could authorize (one at a time) to close each gap.

### Exact target files (THIS plan-WI)

CREATED (single file):
- `dev-memo/plan-go-live-readiness-00.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `docs/release/**` (legacy go-live docs; preserved as INPUT to this blueprint).
- `docs/adr/**`.
- `docs/product/**`.
- `services/**`.
- `docs/contracts/**`.
- AGENTS.md.
- Phase B umbrella plan.
- Any B1..B11 plan or related file.

### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. Plan enumerates the **readiness gate matrix** (see §1) — each gate has: gate name; current state; evidence source; what's missing; clearing-WI category (plan-only vs impl vs STOP-AND-ASK); user-decision required (Y/N).
3. Plan classifies each gate as: **CLEARED** / **PARTIALLY-CLEARED (residual)** / **OPEN (needs new WI)** / **STOP-AND-ASK (requires user decision)**.
4. Plan explicitly states: **NOT an authorization** for any hard-stop item.
5. Plan does NOT trigger any cc-suite WI other than `review-plan` for itself.
6. Plan declares execution-discipline compliance per `.claude/rules/execution-discipline.md`.
7. cc-suite review-plan returns READY (or only Low-risk clarifications remain) via Path 1 native `--background`.

### Exact out-of-scope list (this plan-WI)

- **Implementing any gate-clearing WI** (each is a separate authorization).
- **Re-authoring `docs/release/go-live-plan.md`** (preserved as legacy reference; a future reconciliation WI may revise).
- **Producing `docs/release/go-live-readiness-report.md` content** (that report is the OUTPUT of the entire process; this blueprint is the INPUT).
- **Modifying the project brief** (READY at revision 5; amendment-only via `/project-brief`).
- **Modifying any ADR** (each requires its own bounded WI).
- **Touching any service code or test**.
- **Auth provider choice / cloud vendor choice / distribution signing / real-data migration / production deployment / LLM execution / external document exposure** — all hard-stops; user-only.
- **`git push`** (separate explicit authorization per the lane authorization).

### Essential references

- `docs/release/go-live-plan.md` §"Go-Live Readiness Gate" (legacy WI list).
- `docs/release/go-live-readiness-report.md` (template; empty awaiting WI-13).
- `docs/release/wi-03-security-signoff.md` (HTTPS DNS-pinning sign-off; OCR-fetcher scope).
- `docs/release/operator-checklist.md` (scaffold; awaiting WI-09b content).
- `docs/release/ocr-worker-runbook.md` (scaffold; awaiting WI-09b content).
- `docs/product/project-requirements-brief.md` (READY revision 5).
- `docs/product/product-target-architecture.md`.
- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (umbrella; Phase B SQLite COMPLETE).
- `dev-memo/plan-client-00.md` (client surface reconciliation).
- `dev-memo/deferred-audit-findings.md` (open deferred Lows).
- `.claude/rules/autonomy.md` §"Hard-stop list".
- `.claude/rules/cc-suite.md`.
- `.claude/rules/security-boundary.md` §"Go-live independence".
- `.claude/rules/client-local-first.md` (v1 client posture).
- `.claude/rules/project-brief.md` §"Authority hierarchy".
- AGENTS.md §"Go-live rule".

### Review questions for the reviewer

1. **Scope discipline**: is this blueprint correctly framed as a READ-ONLY enumeration of gates (NOT an authorization)? Does the document accidentally imply that ANY hard-stop item is pre-approved?

2. **Gate matrix completeness**: §1 enumerates **21 gate categories** (post rev-3 normalization). Are any missing beyond what rev-1 reviewer added (supply-chain #19, telemetry #20, data-export #18)? Future reviewer candidates to scrutinize:
   - CI/CD posture (intentionally out for local-first product?).
   - Redaction ADR triggering point (per brief §20 hard-stop).
   - Crash-reporting opt-in path if added later.

3. **Authority hierarchy**: §"Authority hierarchy" lists the order in which conflicting sources are resolved. Does it match `.claude/rules/project-brief.md` §"Authority hierarchy"?

4. **Reconciliation of legacy go-live-plan**: §3 explains how the OCR-pipeline-focused WI-00..WI-13 list maps onto the current Mac-client-local-first architecture. Is the mapping defensible? Or does a separate reconciliation WI need to amend the legacy file FIRST before this blueprint can stabilize?

5. **STOP-AND-ASK gates**: §4 lists 23 items across §4.1 (v1; 18 items) / §4.2 (post-v1 only-if-touched; 4 items) / §4.3 (final verdict; 1 item). Each requires the user's discrete decision. Is the list exhaustive vs `.claude/rules/autonomy.md` §"Hard-stop list" + brief §20?

6. **No-revert posture**: Phase B SQLite is COMPLETE; reverting any B-series commit would require explicit STOP-FOR-ROLLBACK. The blueprint MUST NOT propose retroactive changes to B1-B11. Confirmed?

7. **Deferred Lows**: 12+ deferred Lows are open across B5-B11 in `dev-memo/deferred-audit-findings.md`. Plan picks: **none of them block go-live** per their individual "Safe?" YES classification. Acceptable, or should the blueprint require a "deferred-Low triage" gate before go-live?

---

## §1 Readiness gate matrix

**Twenty-one gates** (rev-2: 18 base + 3 added per reviewer M D2#2/D2#3 + L D2#4). Each row: **gate** / **state today** / **evidence source** / **what closes it** / **classification**.

### Code completeness gates

| # | Gate | State today | Evidence | Closure | Classification |
|---|---|---|---|---|---|
| 1 | Case-box persistence (memory + SQLite) | **COMPLETE** | `98446aa`; Sqlite-Final 276/0; B1-B11 shipped | (none) | **CLEARED** |
| 2 | OCR pipeline (worker + queue + persistence + ingestion + review) | LIKELY COMPLETE; needs verification | `docs/release/go-live-plan.md` WI-04..WI-08; ocr-worker / ocr-persistence / ocr-ingestion / ocr-review repos | Per-package test sweep + integration confirmation | **PARTIALLY-CLEARED (verify)** |
| 3 | Client surface (Mac desktop app) | **NOT STARTED** | `dev-memo/plan-client-00.md`; brief §3-§5 | Client app build + bridge to case-box-persistence + UI | **OPEN (needs new plan + impl WIs)** |
| 4 | Distribution + signing + manual download (v1) | **NOT STARTED** | brief §4, §16 | Apple Developer ID; code-sign + notarize; manual download distribution. **Auto-update is POST-v1** per brief §4 (rev-1 reviewer M D1#2) — v1 ships manual download only. | **STOP-AND-ASK** (Developer ID + signing identity + notarization profile + Mac App Store vs direct vs in-firm IT) |

### Test + audit gates

| # | Gate | State today | Evidence | Closure | Classification |
|---|---|---|---|---|---|
| 5 | All package tests pass (5 packages) | **MOSTLY GREEN** (1692/0 deterministic; 1 pre-existing ocr-worker SIGINT flake under hot-system load) | `npm --prefix services/* test` + `npm --prefix docs/contracts test` | Per AGENTS.md "Go-live rule" all package tests must pass — flake must be **deterministically resolved OR explicitly quarantined** (e.g., `t.skip()` with documented justification + tracked follow-up WI). Documented-acceptance is NOT sufficient for GO (rev-1 reviewer M D4#1). | **OPEN (needs flake-resolution WI before GO)** |
| 6 | Full audit clean (no C/H/M) | **CLEAR FOR B1-B11**; legacy WI-12 sweep pending | `dev-memo/deferred-audit-findings.md`; per-WI cc-suite audit logs | Full-project cc-suite audit sweep against current HEAD | **OPEN (needs full-scope audit WI)** |
| 7 | Mutation-test / robustness policy | NOT-DECIDED (brief does not explicitly authorize a v1 waiver; rev-1 reviewer M D4#2) | `.claude/rules/cc-suite.md`; tdd-guardian rules | Open a robustness-policy decision WI: accept v1 ships without mutation testing OR add a bounded sweep on critical modules | **OPEN (robustness policy decision)** |
| 8 | Deferred Lows triage | 12+ open Lows across B5-B11; all classified Safe=YES | `dev-memo/deferred-audit-findings.md` | Confirm each Safe=YES classification still holds; OR triage-fix any that turn into blockers | **PARTIALLY-CLEARED (re-confirm at gate-close)** |

### Security + compliance gates

| # | Gate | State today | Evidence | Closure | Classification |
|---|---|---|---|---|---|
| 9 | SSRF / TLS / DNS-pinning (OCR fetcher) | **SIGNED OFF** | `docs/release/wi-03-security-signoff.md` (WI-03d ce3f287) | (none for WI-03 scope) | **CLEARED** |
| 10 | Case-box persistence security boundary | NOT-YET-AUDITED at full-scope | `.claude/rules/security-boundary.md`; per-WI B1-B11 audits | Full security-scope audit against case-box-persistence + contract | **OPEN (needs security audit WI)** |
| 11 | 律师法 confidentiality compliance | NOT-YET-CERTIFIED | brief §15 (compliance regimes) | Legal review of audit log + privilege markers + classification model | **STOP-AND-ASK** (legal-review acceptance) |
| 12 | Tamper-evidence / audit chain integrity | TECHNICAL DESIGN COMPLETE | `auditChain.ts`; B3 audit observability; case-box-step-4-audit-log-shape.md | Operational: backup format certification + recovery procedure | **PARTIALLY-CLEARED** |

### Operational gates

| # | Gate | State today | Evidence | Closure | Classification |
|---|---|---|---|---|---|
| 13 | Operator checklist + runbook | SCAFFOLD ONLY | `docs/release/operator-checklist.md`; `docs/release/ocr-worker-runbook.md` | WI-09b content (OCR runbook); NEW Mac-client operator section | **OPEN (needs documentation WIs)** |
| 14 | Backup + recovery procedure | NOT STARTED | brief §14 (export / backup / archive); audit log shape | Document backup of SQLite file; document audit-chain recovery | **OPEN** |
| 15 | Rollback procedure tested | **PARTIALLY** (uncommitted rollback rule exists; committed rollback documented but untested on v1 artifacts) | `dev-memo/rollback-00.md`; `.claude/rules/staging-hygiene.md` | Dry-run rollback of a non-critical commit | **OPEN** (drill) |

### Product + business gates

| # | Gate | State today | Evidence | Closure | Classification |
|---|---|---|---|---|---|
| 16 | Project brief READY + reconciliation log empty | **READY at revision 5**; reconciliation log may have residual entries | `docs/product/project-requirements-brief.md` frontmatter; brief's §"Reconciliation log" | Inspect reconciliation log; confirm zero unresolved entries | **PARTIALLY-CLEARED (verify log)** |
| 17 | License + copyright + privacy notice in distribution | NOT STARTED | brief §17 | Add LICENSE / NOTICE files; draft privacy notice for Mac app | **OPEN** (license choice is **legal/business** STOP-AND-ASK per rev-1 reviewer L D3#3) |
| 18 | Data export / backup format certification | NOT STARTED | brief §14 (export / backup / archive); rev-1 reviewer L D2#4 | Certify export format (PDF / signed bundle / plain text per brief §14); document fidelity vs source | **OPEN** (overlaps gate #14) |

### Cross-cutting v1 gates (added per rev-1 reviewer)

| # | Gate | State today | Evidence | Closure | Classification |
|---|---|---|---|---|---|
| 19 | Supply-chain posture | NOT STARTED | brief §15 compliance; rev-1 reviewer M D2#3 | Dependency inventory + license review + `npm audit --omit=dev`-style sweep + native-binary provenance for `better-sqlite3` and OCR engine; SBOM optional | **OPEN** |
| 20 | Telemetry / crash-reporting policy | DEFAULT-OFF per brief §4 | brief §4 ("No telemetry. ... Crash reporting OFF default; opt-in if added.") | Confirm app codebase ships with no telemetry + crash reporting disabled. If opt-in added later, that's a separate WI. | **PARTIALLY-CLEARED** (default-correct per brief; verify Mac-client code when authored) |

### Final report gate

| # | Gate | State today | Evidence | Closure | Classification |
|---|---|---|---|---|---|
| 21 | Final go-live readiness report | EMPTY scaffold | `docs/release/go-live-readiness-report.md` (template only) | Fill all sections AFTER every other gate clears | **OPEN** (LAST WI) |

### Roll-up

- **CLEARED**: 1, 9 (2 gates).
- **PARTIALLY-CLEARED (residual)**: 2, 8, 12, 16, 20 (5 gates — each needs a verification pass).
- **OPEN (needs new WI)**: 3, 5, 6, 7, 10, 13, 14, 15, 17, 18, 19, 21 (12 gates).
- **STOP-AND-ASK**: 4, 11 (2 gates).
- **DEFERRED**: none (gate #7 reclassified to OPEN per rev-1).

**v1 go-live is NOT close.** Closure of the OPEN gates is multi-WI work (estimated 10-15 plan-only WIs + impls). Closure of STOP-AND-ASK gates requires explicit user decisions that this blueprint does NOT pre-empt.

### §1.R Refresh — as of `main` @ `febbaf2` (2026-07-04, WI-GOLIVE-READINESS-REFRESH-00)

The gate rows above are the rev-4 baseline (authored before case-box Phase-B completion + the forms-T3 track). This refresh re-classifies all 21 gates against current `main`; the **authoritative current 21-gate matrix with per-gate evidence + next action lives in `docs/release/go-live-readiness-report.md` §1** (an EXPLICITLY-INTERIM snapshot — NOT a final GO/NO-GO verdict; gate 21 stays BLOCKED). Compact re-classification (material deltas vs rev-4 flagged **[Δ]**):

| Gate | Refreshed status | Key delta / evidence |
|---|---|---|
| 1 | CLEARED | schema v12; persistence 573+273+288/0 |
| 2 | PARTIAL (verify) | ocr-* packages present |
| 3 | **PARTIAL [Δ]** (was NOT STARTED) | evidence inventory: 12 renderer screens + 26 case-box IPC channels + electron main/preload + forms-T3 preview/DOCX shipped; app still self-declares fixture/unsigned/not-for-distribution → release-incomplete, NOT unstarted |
| 4 | STOP-AND-ASK | framework + public distribution + signing (user) |
| 5 | **PARTIAL [Δ]** | contract 455/0 + persistence 573+273+288/0 + desktop 791/0; 1 pre-existing ocr-worker SIGINT flake to resolve/quarantine |
| 6 | OPEN | full-scope audit sweep pending; batch closeouts all BATCH-PASS through batch-210 |
| 7 | OPEN | robustness policy undecided |
| 8 | **PARTIAL [Δ]** | 37 open deferred, ALL Low, ALL Safe=YES, 0 Medium+ |
| 9 | CLEARED | WI-03d security sign-off |
| 10 | OPEN | case-box security-boundary audit pending |
| 11 | STOP-AND-ASK | 律师法 legal sign-off (user) |
| 12 | PARTIAL | audit chain design complete; ops procedure pending |
| 13 | OPEN | operator/runbook scaffold only |
| 14 | OPEN | backup/recovery not started |
| 15 | PARTIAL | rollback rule exists; drill pending |
| 16 | **PARTIAL (verify) [Δ]** | brief READY; T4 brief-vs-PRD reconciliation RESOLVED (accepted divergence, ADR-forms-t4) |
| 17 | OPEN | license/privacy not started |
| 18 | OPEN | export-format certification not started |
| 19 | **OPEN [Δ]** | deps now include `docx@9.7.1` (NEW; MIT/pure-JS; dep-review ACCEPTABLE) + native `better-sqlite3` |
| 20 | PARTIAL | telemetry default-off per brief; verify Mac-client code |
| 21 | OPEN — BLOCKED | final report is the LAST gate; the current report is INTERIM only |

**Refreshed roll-up**: CLEARED 1,9 (2) · PARTIAL/residual 2,3,5,8,12,15,16,20 (8) · OPEN 6,7,10,13,14,17,18,19,21 (9) · STOP-AND-ASK 4,11 (2). Net: gate 3 OPEN→PARTIAL (real functional client exists); forms-T3 shipped as a new M0 case-box feature; `docx` added to the supply-chain surface. v1 go-live remains NOT close; the three STOP-AND-ASK hard-stops (4, 11, 21-verdict) remain the user's.

---

## §2 Authority hierarchy

Per rev-1 reviewer H D1#1: this section splits into TWO parts to mirror `.claude/rules/project-brief.md` §"Authority hierarchy" verbatim AND list global hard-stops as non-bypassable constraints (not as ranked authority entries).

### §2.1 Product-direction authority (verbatim from `.claude/rules/project-brief.md` §"Authority hierarchy")

When two sources disagree on **product direction**, prefer the higher entry:

1. **Reviewed ADRs under `docs/adr/`** that are not marked superseded — authoritative for the technical decision they document.
2. **`docs/product/project-requirements-brief.md` with status `READY`** (currently revision 5) — authoritative for whole-project product direction not yet captured in any ADR.
3. **`docs/product/product-target-architecture.md`** — authoritative product-summary pointer until brief reaches `READY`; afterward derived view.
4. **`dev-memo/plan-client-00.md`** — client-surface reconciliation source; remains valid until folded into the brief.
5. **Brief with status `DRAFT-PENDING-REVIEW` or `AMENDMENT-PENDING-REVIEW`** — non-authoritative INPUT.
6. **spark specs under `dev-memo/spark/`** — non-authoritative; never override anything.

### §2.2 Non-bypassable global constraints (NOT ranked; apply to ALL of §2.1)

These rules layer ON TOP of the product-direction hierarchy. None of them is overridden by any source in §2.1. They are CONSTRAINTS, not ranked authority entries:

- **`.claude/rules/autonomy.md` §"Hard-stop list"** — global hard-stops (push, secrets, deploy, reset --hard, etc.).
- **`.claude/rules/security-boundary.md` §"Go-live independence"** — closing a security WI does NOT imply go-live readiness.
- **`.claude/rules/cc-suite.md`** — review/audit/verify broker discipline.
- **`.claude/rules/staging-hygiene.md`** — explicit-staging discipline.
- **`.claude/rules/execution-discipline.md`** — implementation floor.

### §2.3 Blueprint advisory layer (this file)

`docs/release/go-live-plan.md` (legacy WI list) and **this blueprint** are advisory; neither is in the §2.1 authority chain. They surface required actions; the user authorizes each.

---

## §3 Reconciliation of legacy `docs/release/go-live-plan.md`

The legacy go-live-plan.md is OCR-pipeline-focused (WI-00..WI-13 are heavy on DNS-pinning, fetcher, retry, paddleocr engine, runbook). Many of its WIs are **still in scope** for v1; others are **partially obsolete** because the project pivoted to a Mac-client-local-first single-lawyer product (per `docs/product/project-requirements-brief.md` revision 5).

Mapping (legacy WI → current scope):

| Legacy WI | Scope today | Notes |
|---|---|---|
| WI-00 (preflight) | STILL IN SCOPE | Re-run against current HEAD. |
| WI-00b (preflight evidence) | STILL IN SCOPE | Re-run against current HEAD. |
| WI-01..WI-03d (HTTPS DNS-pinning) | **CLEARED** at `wi-03-security-signoff.md` (ce3f287) | OCR-fetcher scope only. |
| WI-04 (DNS-pinning regression + operator docs) | STILL IN SCOPE | Operator docs section needs Mac-client framing. |
| WI-05..WI-07 (pending-retry + observability) | STILL IN SCOPE | OCR-queue lifecycle. |
| WI-08 (coordinator refactor) | STATUS UNCLEAR | Verify ocr-worker / coordinator state. |
| WI-09a (release doc scaffold) | DONE (`docs/release/*` scaffolds exist) | |
| WI-09b (operator runbook content) | **OPEN** | Mac-client section needs new author. |
| WI-10 (production fail-closed probe) | STILL IN SCOPE for OCR worker | For Mac client: equivalent fail-closed at app launch. |
| WI-11a..WI-11d (paddleocr bakeoff) | STATUS UNCLEAR | Verify; product-brief LLM policy may have changed scope. |
| WI-12 (full test matrix + audit sweep) | STILL IN SCOPE | Required for §1 gate #6. |
| WI-13 (final readiness report) | **§1 gate #21** | The closing WI of the entire process (rev-2 reviewer M D3#1). |

**This blueprint is PROVISIONAL until WI-08 + WI-10 + WI-11 statuses are verified** (rev-1 reviewer M D1#3). Specifically: paddleocr bakeoff outcome (WI-11a..d) may have shifted the v1 OCR-engine commitment relative to brief §20's "Document text-extraction engine choice is post-v1; no v1 commitment". A bounded reconciliation WI (§5 WI #9 below) must run BEFORE the final readiness report (gate #21).

**No re-authoring of legacy go-live-plan.md is proposed by this blueprint.** A separate, bounded reconciliation WI may amend the legacy file later if the user authorizes. Until then, the blueprint cites the legacy file as the source-of-truth for WI numbering and re-frames per the current architecture in this §3 only.

---

## §4 STOP-AND-ASK gates (user decides; NOT pre-approved)

Per rev-1 reviewer H D2#1: this §4 **inherits and enumerates** `docs/product/project-requirements-brief.md` §20 PLUS the autonomy hard-stop list, marking post-v1 items "only if touched" (rev-2 reviewer L D4#1: "verbatim" overstated; entries carry gate cross-links + annotations):

### §4.1 v1 STOP-AND-ASK items (brief §20 inheritance)

1. **Auth provider choice** (brief §20). v1 ships single-lawyer-only with no real auth provider; no specific readiness gate maps directly because no v1 surface depends on a real provider (rev-2 reviewer L D5#1 fix).
2. **Cloud vendor choice** (deferred per brief §6).
3. **External document exposure beyond WI-03-hardened outbound HTTPS** (brief §20).
4. **LLM enablement** in any form, including local on-device (brief §20; deferred per brief §12).
5. **Electron / Tauri / native runtime dependency** (brief §20 + plan-client-00 §6 — gate #3 framework choice).
6. **Renderer UI framework choice** (brief §20 — gate #3 sub-decision).
7. **Public deployment / release / publication** (brief §20; autonomy hard-stop).
8. **Code-signing identity + notarization profile** (brief §20 + §4 — gate #4).
9. **Secret material handling** (brief §20; autonomy hard-stop).
10. **New runtime dependencies** (each individually; brief §20; autonomy hard-stop) — applies to better-sqlite3 native binary, OCR engine binary, and any new dep introduced by Mac client work.
11. **Apple Developer ID acquisition** (brief §20 — gate #4 prerequisite).
12. **Per-document encryption-at-rest scheme** (brief §20 — gate #10 + #12).
13. **Hard-delete retention policy** (brief §20 — gate #11 compliance).
14. **Tenant boundary widening** (brief §20; v1 single-lawyer only).
15. **Any external network surface beyond WI-03-hardened outbound HTTPS** (brief §20).
16. **Real-data migration on live lawyer data** (brief §20; autonomy hard-stop; gate #14 v1 limited to local-file backup).
17. **Monetization decisions** (billing / external accounts; brief §20).
18. **Redaction ADR** (before any redaction code lands; brief §20).

### §4.2 Post-v1 items, only if touched

19. **Mini-program publication / registration** (brief §5, §20 — post-v1).
20. **Sync bridge enablement** (listener ship; brief §20 — post-v1 SYNC reconciliation program R-1/R-2/R-3).
21. **Document text-extraction engine choice** (post-v1 OCR engine commitment; brief §20).
22. **Auto-update mechanism** (Sparkle / electron-updater / custom — brief §4; post-v1 per gate #4).

### §4.3 Final go-live verdict

23. **Final GO/NO-GO verdict** (gate #21; signed by Engineering Lead + On-Call + Legal per AGENTS.md "Go-live rule").

**This blueprint does NOT pre-approve ANY of the above.** Each remains a discrete STOP-AND-ASK gate. A future WI that triggers any item above MUST stop and ask before proceeding.

---

## §5 Suggested follow-up WIs (each requires SEPARATE user authorization)

The blueprint suggests bounded plan-only follow-up WIs for the OPEN gates. Each opens as its own lane; this blueprint does NOT pre-authorize any of them.

Per rev-1 reviewer M D3#1: the previous ordering ran the final cc-suite audit BEFORE the Mac client existed. Revised order separates **baseline** audit (against current HEAD; OCR + persistence scope) from **final** audit (against the v1 surface AFTER Mac client + distribution + backup + docs gates clear).

| Order | Suggested WI (plan-only) | Closes gate(s) | Risk | Predecessors |
|---|---|---|---|---|
| 1 | Plan: full-project test-matrix run (v1 packages + Node pin + skipped count) | #5, #6 (verification stage) | Low | None |
| 2 | Plan: **baseline** cc-suite audit sweep (case-box-persistence + OCR full-scope; security-boundary lens) | #6 partial, #10 baseline | Medium | WI 1 |
| 3 | Plan: deferred-Low triage report (12+ Lows from B5-B11) | #8 | Low | None |
| 4 | Plan: ocr-worker SIGINT flake — deterministic resolution OR documented quarantine | #5 | Medium (test infra surface) | WI 1 |
| 5 | Plan: supply-chain posture (dep inventory + license review + npm audit + native-binary provenance for better-sqlite3 + OCR engine; optional SBOM) | #19 | Medium; **STOP-AND-ASK** on any new runtime dep | None |
| 6 | Plan: Mac-client surface architecture (Electron / Tauri / native; renderer framework; new deps; per brief §4 + §20 + plan-client-00 §6) | #3 | High; **STOP-AND-ASK** on framework + renderer + each new runtime dep (rev-1 reviewer M D3#2) | brief READY |
| 7 | Plan: backup + recovery procedure + data-export format certification | #14, #18 | Low | None |
| 8 | Plan: rollback drill procedure (dry-run on non-critical commit) | #15 | Low | None |
| 9 | **MANDATORY** plan: reconciliation amendment to legacy `docs/release/go-live-plan.md` (per rev-1 reviewer L D4#3 — predecessor to WI #14) | (re-baseline) | Low; **STOP-AND-ASK** if amendment touches an ADR-locked decision | Brief READY |
| 10 | Plan: Mac-client operator section for operator-checklist.md + ocr-worker-runbook.md | #13 | Low | WI 6 |
| 11 | Plan: LICENSE / NOTICE / privacy-notice content for distribution | #17 | **STOP-AND-ASK** on license choice (route to legal/business per rev-1 reviewer L D3#3) | brief READY |
| 12 | Plan: robustness policy decision (mutation testing v1 accept OR bounded sweep) | #7 | Low | WI 2 |
| 13 | Plan: telemetry / crash-reporting verification (confirm default-off in Mac client) | #20 | Low | WI 6 |
| 14 | Plan: **FINAL** cc-suite audit + readiness sweep against the v1 surface AFTER WIs 4, 5, 6, 7, 9, 10, 11, 12, 13 land **AND** gate #11 legal-compliance signoff is recorded (rev-2 reviewer H D1#1) | #6 final, #10 final | High; **STOP-AND-ASK** on any C/H finding | WIs 4, 5, 6, 7, 9, 10, 11, 12, 13 + gate #11 |
| 15 | Plan: final readiness report content (`docs/release/go-live-readiness-report.md`) | #21 (LAST) | High; **STOP-AND-ASK** on GO/NO-GO verdict; legal/business signoff required | ALL other gates clear |

The user picks the next bounded WI to open. The blueprint does NOT execute any of them.

---

## §6 Execution-discipline compliance (per `.claude/rules/execution-discipline.md`)

### §6.1 Think before coding
- WI scope: **PLAN ONLY**. No code, no schema, no tests, no infra.
- Assumptions:
  - Phase B SQLite implementation is COMPLETE at `98446aa` (verified).
  - OCR pipeline state requires verification (gate #2 PARTIALLY-CLEARED).
  - Product brief is authoritative (READY revision 5).
- Hard stops cross-checked: STOP-AND-ASK gates listed §4; no triggers in this WI itself (just documentation).

### §6.2 Simplicity first
- Single file output. No structural changes to legacy go-live-plan.md or readiness-report.md.
- No new abstractions.
- Plain enumeration; gate matrix; reconciliation table; follow-up suggestions.

### §6.3 Surgical changes
- Touches only `dev-memo/plan-go-live-readiness-00.md`.
- Does NOT touch service code, ADRs, brief, legacy go-live docs.

### §6.4 Goal-driven execution
- Acceptance criteria testable via the gate-matrix completeness check.
- cc-suite review-plan on this file.

### §6.5 Relationship to existing rules
- Honors `.claude/rules/autonomy.md` §"Hard-stop list".
- Honors `.claude/rules/security-boundary.md` §"Go-live independence".
- Honors `.claude/rules/project-brief.md` §"Authority hierarchy".
- Does NOT bypass cc-suite for any future gate-closing WI.

---

## §7 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | **High** (raised from Medium per rev-1 reviewer H D5#1) | Blueprint is read as AUTHORIZATION rather than ENUMERATION. | Top-of-file banner ("ENUMERATION ONLY...") + §"Scope discipline" + §4 STOP-AND-ASK list mirroring brief §20 verbatim + §2 splitting authority hierarchy from non-bypassable constraints + every "STOP-AND-ASK" flag in §5 WI table. |
| 2 | Medium | Legacy go-live-plan.md numbering creates confusion (WI-00..WI-13 vs new readiness-WIs from §5). | §3 mapping table + §5 explicitly names suggested WIs without re-using legacy numbers. |
| 3 | **Medium** (raised from Low per rev-1 reviewer L D5#3) | Gate matrix may still be missing categories the reviewer did not surface (e.g., crash-reporting opt-in path if added, CI/CD posture, redaction ADR triggering point). | Future review iterations may discover more. Stop condition (§9) names this. |
| 4 | Low | Gate matrix gets stale as future WIs land. | §9 stop condition. |
| 5 | Low | A future user instruction may want to skip a STOP-AND-ASK gate. | Hard-stop list does NOT permit skipping; recorded explicitly here for traceability. |
| 6 | Low | Final audit might run before all gate-clearing WIs complete. | §5 WI #14 ordering: "AFTER WIs 4, 5, 6, 7, 9, 10, 11, 12, 13 land + gate #11 legal-compliance signoff recorded" explicit (rev-3 reviewer L D1#1 alignment). |

No Critical risks. 1 High (informational; mitigated by header banner + §2 + §4 + §5 STOP-AND-ASK flags + §7 risk #1 row itself).

---

## §8 References

- `docs/release/go-live-plan.md` (legacy WI list).
- `docs/release/go-live-readiness-report.md` (template; output target).
- `docs/release/wi-03-security-signoff.md` (HTTPS DNS-pinning sign-off).
- `docs/product/project-requirements-brief.md` (READY revision 5).
- `docs/product/product-target-architecture.md`.
- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (umbrella; COMPLETE).
- `dev-memo/plan-client-00.md`.
- `dev-memo/deferred-audit-findings.md`.
- `.claude/rules/autonomy.md` §"Hard-stop list".
- `.claude/rules/cc-suite.md`.
- `.claude/rules/security-boundary.md` §"Go-live independence".
- `.claude/rules/client-local-first.md`.
- `.claude/rules/project-brief.md` §"Authority hierarchy".
- AGENTS.md §"Go-live rule".

---

## §9 Stop condition

This blueprint is stale or superseded when:
- All 21 gates flip to CLEARED — go-live readiness report (gate #21) becomes the authoritative successor (rev-2 reviewer M D2#1).
- A future reconciliation WI revises legacy `docs/release/go-live-plan.md` — the new file supersedes §3 of this blueprint.
- The product brief is materially amended (e.g., framework choice locked) — re-review the gate matrix.
- This file is moved to `dev-memo/superseded/` once gate #21 ships.
