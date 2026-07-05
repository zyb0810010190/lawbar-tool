# Go-Live Readiness Report — INTERIM SNAPSHOT

> **STATUS: INTERIM SNAPSHOT — NO FINAL GO-LIVE VERDICT.** This is a mid-flight readiness
> refresh against `main` @ `febbaf2` (2026-07-04), produced by `WI-GOLIVE-READINESS-REFRESH-00`
> (Type: EVIDENCE). It is **NOT** the final go-live gate. The **final GO / NO-GO verdict is
> blueprint gate 21, which remains BLOCKED** until every v1-blocking gate clears and the three
> user hard-stops are resolved. Emitting a GO here would be false; none is emitted.
> Authoritative gate list: `dev-memo/plan-go-live-readiness-00.md` §1 (21 gates) + §4 (STOP-AND-ASK).

## Verdict

**NO FINAL VERDICT (interim).** Final GO / NO-GO is blocked pending the three user hard-stops
(§4 below) and closure of the OPEN gates.

## 1. Refreshed 21-gate matrix (as of `main` @ `febbaf2`, 2026-07-04)

Refreshed against the rev-4 blueprint baseline. Material deltas since that baseline are flagged **[Δ]**.

| # | Gate | Status | Evidence (current) | Blocker / next action |
|---|---|---|---|---|
| 1 | Case-box persistence (memory + SQLite) | **CLEARED** | `CURRENT_SCHEMA_VERSION=12` (`services/case-box-persistence/src/sqlite/schema.ts:51`); persistence tests 573+273+288/0 (this refresh) | — |
| 2 | OCR pipeline (worker/queue/persistence/ingestion/review) | **PARTIAL (verify)** | `services/ocr-*` packages present + prior sweeps | Per-package test sweep + integration confirmation |
| 3 | Client surface (Mac desktop app) | **PARTIAL [Δ]** — was "NOT STARTED"; corrected by evidence inventory; self-declaration blocker now closed (WI-GATE3) | **12 renderer screens** (`renderer/screens/`: listMatters/createMatter/archiveMatter/viewMatter + viewMatter{Audit,Deadlines,DocketProposals,Documents,Facts,Links,T3Catalog} + auditEventLabels); **26 case-box IPC channels** (`src/caseBox/handlerShared.ts`); electron `main.ts` + `preload.mts` present; **forms-T3 证据目录及说明 preview + DOCX export** shipped (`t3*.ts`; channels `casebox:t3:previewCatalog`/`exportDocx`); the stale `package.json` "fixture only / NOT product UI / NOT for distribution" self-declaration is **corrected** (WI-GATE3-CLIENT-RELEASE-HARDENING-00) to an accurate v1 local-first case-box client framing that preserves the honest gate-4 signing/distribution deferral | **Substantial functional case-box UI is built + now accurately self-described.** Residual (gate 3 stays PARTIAL — see `docs/release/gate3-client-release-readiness-00.md`): **R1** signing/notarization/public-distribution/release-posture → gate 4 STOP-AND-ASK (user); **R2** the *global* overdue-deadline dashboard banner (brief §10 — app-open/cross-matter; the per-matter urgency banner + overdue list already exist in `viewMatterDeadlines.ts`, brief §18) → separate design-artifact-gated `Type: UI` WI; **R3** bounded error/empty-state polish follow-ups. Depends on gate 4 (STOP-AND-ASK). |
| 4 | Distribution + signing + manual download (v1) | **STOP-AND-ASK** | brief §4/§16 | **User decision**: Apple Developer ID + code-sign + notarization for PUBLIC release; framework confirm. Dev-mode signing is acceptable-deferred; public distribution cannot clear without this. |
| 5 | All package tests pass | **CLEARED [Δ]** | contract 455/0, persistence 573+273+288/0; desktop 791/0 (last verified @ PR #175 merge; app code unchanged since); ocr-worker **472/0** (3 pre-existing engine skips) — the prior SIGINT idle-loop spawn flake is **deterministically resolved** (WI-GATE5-OCR-WORKER-SIGINT-FLAKE-00: a child-side stderr readiness marker emitted after the SIGINT/SIGTERM handlers are armed, with the spawn test waiting for it before sending SIGINT; 15/15 targeted + 5/5 full-file repeated-run determinism; broker audit CLEAN `audit-mr7f42oq-jaqa51`) | — (gate 5 CLEARED; does NOT imply go-live — the final GO/NO-GO verdict + the three STOP-AND-ASK hard-stops remain the user's) |
| 6 | Full audit clean (no C/H/M) | **OPEN** | per-WI cc-suite audit logs; batch-audit closeout chain (all BATCH-PASS C0H0M0L0 through batch-210); `dev-memo/deferred-audit-findings.md` | Full-project cc-suite audit sweep against current HEAD (legacy WI-12 scope). |
| 7 | Mutation-test / robustness policy | **OPEN** | `.claude/rules/cc-suite.md`; tdd-guardian | Robustness-policy decision WI (accept v1 without mutation testing OR bounded sweep). |
| 8 | Deferred Lows triage | **PARTIAL [Δ]** | `dev-memo/deferred-audit-findings.md`: **37 open, ALL Low, ALL Safe=YES, 0 Medium+** (this refresh) | Re-confirm each Safe=YES at gate-close; none are M0-product blockers. |
| 9 | SSRF / TLS / DNS-pinning (OCR fetcher) | **CLEARED** | `docs/release/wi-03-security-signoff.md` (WI-03d `ce3f287`) | — |
| 10 | Case-box persistence security boundary | **OPEN** | per-WI B1-B11 audits; `.claude/rules/security-boundary.md` | Full security-scope audit WI against case-box-persistence + contract. |
| 11 | 律师法 confidentiality compliance | **STOP-AND-ASK** | brief §15 | **User/legal decision**: legal review of audit log + privilege markers + classification model. |
| 12 | Tamper-evidence / audit-chain integrity | **PARTIAL** | `auditChain.ts`; case-box-step-4-audit-log-shape ADR | Operational: backup-format certification + recovery procedure (gate 14). |
| 13 | Operator checklist + runbook | **OPEN** | `docs/release/operator-checklist.md` (scaffold); `ocr-worker-runbook.md` | Documentation WIs (OCR runbook content + NEW Mac-client operator section). |
| 14 | Backup + recovery procedure | **OPEN** | brief §14 | Document SQLite-file backup + audit-chain recovery. |
| 15 | Rollback procedure tested | **PARTIAL** | `dev-memo/rollback-00.md`; the git-revert / closeout discipline exercised repeatedly | Dry-run rollback of a non-critical v1 artifact. |
| 16 | Project brief READY + reconciliation log | **PARTIAL (verify) [Δ]** | brief `status: READY`; the T4 brief-vs-PRD reconciliation is now RESOLVED as accepted divergence (`docs/adr/ADR-forms-t4-proof-model-scope.md`) | Inspect the brief's reconciliation log for any residual unresolved entries. |
| 17 | License + copyright + privacy notice | **OPEN** | brief §17 | Add LICENSE/NOTICE + privacy notice; license choice is a legal/business STOP-AND-ASK. |
| 18 | Data export / backup format certification | **OPEN** | brief §14 | Certify export format + fidelity (overlaps gate 14). |
| 19 | Supply-chain posture | **OPEN [Δ]** | current runtime deps: `better-sqlite3` (native), `docx@9.7.1` (NEW this session — MIT/pure-JS; dependency-risk-review ACCEPTABLE, job `audit-mr63d6y7`), + two internal committed tarballs | Dependency inventory + license review + `npm audit` sweep + native-binary provenance for `better-sqlite3` + OCR engine; SBOM optional. |
| 20 | Telemetry / crash-reporting policy | **PARTIAL** | brief §4 (no telemetry; crash reporting OFF default) | Verify the Mac-client code ships no telemetry + crash-reporting disabled. |
| 21 | Final go-live readiness report | **OPEN — this doc is INTERIM, not the final gate** | this file | Fill the FINAL report only AFTER every other gate clears + the hard-stops resolve. **BLOCKED.** |

### Refreshed roll-up (vs rev-4 baseline)
- **CLEARED**: 1, 9 (2).
- **PARTIAL / residual**: 2, 3 **[Δ up from OPEN]**, 5 **[Δ]**, 8, 12, 15, 16, 20 (8).
- **OPEN (needs WI)**: 6, 7, 10, 13, 14, 17, 18, 19, 21 (9).
- **STOP-AND-ASK (user)**: 4, 11 (2).
- Net delta vs rev-4: gate 3 moved OPEN → PARTIAL (real functional client surface exists, contradicting the stale "NOT STARTED"); gates 5/8/16/19 refreshed with current evidence; forms-T3 shipped as a new M0 case-box feature.

## 2. M0-ready surfaces (built + evidenced)
- Case-box persistence + contract (SQLite, schema v12, deterministic tests green).
- OCR pipeline packages present (verify-pending).
- Append-only hash-chained audit log.
- Case-box functional UI: matters (list/create/view/archive), documents, deadlines, docket, facts, links, audit, **forms-T3 证据目录及说明 preview + DOCX export** — 12 screens, 26 IPC channels.
- HTTPS/SSRF/TLS/DNS-pinning security sign-off (gate 9 CLEARED).

## 3. M0 blockers (must clear before go-live)
1. **Client release-hardening** (gate 3, PARTIAL): the functional client is built but self-declared not-product/not-signed/not-for-distribution; needs product-grade hardening + release posture (gated by gate 4).
2. **Test-matrix + full-audit closure** (gates 5, 6, 10): resolve/quarantine the ocr-worker SIGINT flake; full-scope cc-suite audit; case-box security-boundary audit.
3. **Release documentation** (gates 13, 14, 15, 17, 18, 19, 20): operator/runbook, backup+recovery, rollback drill, license/privacy, data-export certification, supply-chain posture, telemetry verification.

## 4. STOP-AND-ASK decisions (user-owned; NOT resolved here)
1. **Framework confirm + public distribution + code-sign/notarization** (gate 4) — Apple Developer ID, signing identity, notarization profile, distribution channel. Dev-mode signing is acceptable-deferred; public release cannot clear without this.
2. **律师法 confidentiality / legal-compliance sign-off** (gate 11).
3. **Final go-live sign-off** (gate 21) — engineering + legal.

## 5. Non-blocking deferred findings
`dev-memo/deferred-audit-findings.md`: **37 open, ALL Low, ALL `Safe=YES`, 0 Medium+**. Categories: shell/git-hook guard refinements, case-box barrel/enum convention drift, SQLite-schema LOC hygiene, one FileVault smoke-test gap. **None are M0-product blockers.**

## 6. Post-v1 exclusions (not blocking M0)
Sync bridge + WeChat mini-program; remote+local LLM extraction; document text-extraction engine; auto-update; multi-user/tenant; encryption beyond FileVault; backup/export tooling (signed bundle, PDF chronology, privilege log, **proof matrix = T4**); redaction; lawyer-letter/contract-review lifecycle state machines. (brief §5/§8/§12/§14/§20 + reconciliation WIs.)

## 7. Forms track release status
- **T3 (证据目录及说明)**: **COMPLETE (M0 feature)** — S0 contract fields → S1 logical model → S2 preview → S3 DOCX export, all on `main`.
- **T4 (举证质证表)**: **DECIDED post-v1**, issue-centric proof model (`docs/adr/ADR-forms-t4-proof-model-scope.md`); data foundation not built. Not M0.
- **T5 (质证意见/质证记录)**: **design-gated** (narrative-vs-structured fork); no governed WI. Not M0.

## 8. Recommended next governable WI (after this refresh)
A **case-box-persistence security-boundary audit WI** (gate 10) — ready-to-author, review-only (no code), MEDIUM risk, no user decision needed — is the highest-value non-STOP-AND-ASK M0 gate to close next; OR resolve the ocr-worker SIGINT flake (gate 5). The three STOP-AND-ASK hard-stops (§4) are the true release gates and require your decisions before the client-release + final-verdict gates can close.

## Audience
Engineering Lead + On-Call + Legal (per the blueprint's gate-21 audience). This interim snapshot is decision-support, NOT a release authorization.
