# Queue review — WI-RELEASE-G14-BACKUP-RECOVERY-00 (AUTHORING / governance lane)

Lane: M0 gate-14 backup + recovery procedure **authoring/governance** (Type: EVIDENCE, release-governance MEDIUM risk). Governs — does NOT execute — a FUTURE lane that authors `docs/release/gate14-backup-recovery-00.md` (the operator data-survival runbook) + the gate-14 evidence row. Changes NO product source/test/config; runs NO backup; clears NO gate; edits NO brief; decides NO user go-live hard-stop.
Date: 2026-07-07. Branch: `release-g14-backup-recovery-governance` (from synced `main` @ `7202586`). Batch: window 2/3 since marker `592cbd0` (`e978beb` batch-227 closeout + `7202586` deferred-log) — no batch closeout this lane.

## What this is
The authoring lane governs a FUTURE execution lane that will author the gate-14 backup + recovery procedure — the last non-STOP-AND-ASK evidence gap for the "document SQLite-file backup + audit-chain recovery" readiness row. The procedure doc is grounded in the REAL shipped v1 data-directory layout (single `case-box.sqlite` with audit tables inside + `case-box-documents/` blob dir + `theme-preference.json`), which the exec lane re-verifies from source (`caseBoxRuntime.ts` + `main.ts`), and which diverges from brief §14's two-file model — the future doc documents reality and flags the divergence as `RECONCILIATION-NEEDED` without editing the brief (per `AGENTS.md` §"Source hierarchy": generated output beats static doc). The procedure cites the already-executed gate-7 crash-recovery drill (`gate7-crash-recovery-drill-00.md`, PASS) as its verification evidence rather than re-running a live backup. It defers export-format cert (gate 18), rollback dry-run (gate 15), and audit-chain operational recovery (gate 12) to their own lanes, and keeps gate 14 NON-CLEARED.

Deliverable of THIS lane: ONLY the queue governance (`queue.md` / `queue.linted` / `queue.reviewed` / `queue.governed`) + this review artifact.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`, retrievable YES, no failure class, no fallback. The full WI (`queue.md`) was inlined into the prompt (timeout-avoidance convention). Completed first attempt, no timeout.

### /cc-suite:review-plan (gpt-5.5/medium/read-only; on the queue WI)
- `review-plan-mraa9z1a-q67cyl` · **READY (Low-risk clarifications)** (no Critical/High/Medium). All 6 review questions answered YES: (1) scopes a procedure/runbook + verification record, not new backup software or export cert; (2) manifest follows the real shipped layout + flags the brief §14 two-file divergence as `RECONCILIATION-NEEDED` without editing the brief; (3) cites the executed gate-7 drill as evidence, forbids a live backup run this lane; (4) gates 18/15/12 deferred, gates 6/7 mapped not cleared; (5) gate 14 kept non-cleared (OPEN → PARTIAL only), STOP-AND-ASK gates 4/11/21 preserved, no GO/NO-GO; (6) no source/test/schema/dependency/brief-edit/backup-software smuggled in. Two **Low** clarifications, both **applied**: (a) split the acceptance criteria into governance-lane vs future-exec-lane so the WI cannot be read as requiring the procedure doc to exist now → applied (relabeled the "## Acceptance criteria" heading to "(FUTURE execution lane …)" + added an explicit note that the authoring-lane acceptance is the structured `Acceptance criteria:` field, doc does not yet exist); (b) the exec lane should verify the resolved macOS `userData` path from actual app/source behavior, not merely restate → applied (requirement 1 + exec-lane acceptance criterion 2 now require re-verifying the productName→`app.getPath("userData")` resolution + filename joins from `main.ts`/`caseBoxRuntime.ts` at exec time). · rawOutput sha256 `05567a3e0eb2945f03a927191cb454ede9ed370a120bc90076ccadc41d5d377c`.

## Verdict: READY (governs a docs-only backup/recovery procedure WI; manifest grounded in reality; brief divergence flagged not resolved; gates 18/15/12 deferred; gate 14 non-cleared; go-live-independent)

QUEUE_REVIEW_VERDICT=PASS

## Gates (this authoring lane)
- `scripts/workflow/check-queue.sh` → QUEUE LINT PASSED.
- `scripts/workflow/check-contract-integrity.sh` → PASS.
- `CURRENT_SCHEMA_VERSION` unchanged (12); no product source/test/package/schema/contract change — only the queue governance + this review artifact. No backup run, no new backup software, no new dependency, no brief edit, no gate-6 run, no export-format cert, no unilateral gate-14 clear, no go-live decision.

## Deferred findings
None deferred as open — both Lows were applied (acceptance-criteria lane split + userData-path source-verification requirement). The FUTURE exec lane carries the reconciliation duty (brief §14 two-file vs shipped single-file → `RECONCILIATION-NEEDED` follow-up) and the deferrals of gates 18/15/12; gate 14's clearance is not this lane's to grant and does not imply go-live. The final GO/NO-GO + the three STOP-AND-ASK hard-stops (4/11/21) remain the user's.
