# Queue review — WI-RELEASE-G7-CRASH-RECOVERY-DRILL-00 (EXECUTION lane)

Lane: M0 gate-7 crash-recovery-drill **execution** (Type: EVIDENCE, release-governance MEDIUM risk). Runs the governed drill as an evidence exercise on a DISPOSABLE fixture, records the result, updates the gate-7 evidence row. Changes NO product source/test/config; clears NO gate; decides NEITHER user risk-decision (D-G7-1/D-G7-2).
Date: 2026-07-06. Branch: `release-g7-crash-recovery-drill-exec` (from synced `main` @ `65fda03`). Batch: window 1/3 since marker `49d22af` — no batch closeout this lane.

## What this is
The execution lane of the governed WI-RELEASE-G7-CRASH-RECOVERY-DRILL-00 (governed commit `5d2680e`, queue.governed sha256 `fa62f895…`, PR #194 merge `49d22af`). It EXECUTED the gate-7 crash-recovery drill required as closure evidence for the robustness policy's criteria 1/2/4 (`docs/release/gate7-robustness-policy-00.md` §2/§3, user-decision D-G7-2), driving the REAL `case-box-persistence` layer (built `dist/`, `openSqliteCaseBoxPersistence`) against a **disposable `/tmp` fixture data directory** (no real user data, no `~/Library` path, no network). The `/tmp` drill driver is NOT committed (a drill artifact, not a product harness; no new dependency; no product source/test/config change).

Deliverables (exactly two tracked files + this review artifact):
1. NEW `docs/release/gate7-crash-recovery-drill-00.md` — the evidence record: fixture/data-dir; backup-as-directory + restore; the `SIGKILL` mid-write crash boundary; `PRAGMA integrity_check=ok`; the audit `event_count==COUNT==MAX(sequence)` invariant across crash + restore; the recovery result; the required artifacts (fixture-only); the explicit PASS/FAIL conclusion (PASS); the D-G7-2-evidence framing; why gate 7 stays blocked; residual follow-ups (incl. the single-file finding).
2. `docs/release/go-live-readiness-report.md` — the gate-7 evidence ROW ONLY: `OPEN — policy authored [Δ]` → `OPEN — policy authored + crash-recovery drill PASS [Δ]`, still non-cleared. No other row / no roll-up line changed (gate 7 stays in the OPEN roll-up bucket).

## Drill result (summary)
PASS. Seed 3 matters (real API) → backup-as-directory → child holds `BEGIN IMMEDIATE` + 5000 uncommitted rows → `SIGKILL(9)` mid-write → reopen: `integrity_check=ok`, in-flight rows rolled back to 0, counts preserved `{3,3,3}`, audit invariant holds for all 3 matters → restore-from-backup: `integrity_check=ok`, counts preserved, invariant holds. Env: macOS 15.6.1 · Node v24.14.0 · better-sqlite3 12.10.0 · `CURRENT_SCHEMA_VERSION=12`. Honest finding surfaced: v1 uses a SINGLE `case-box.sqlite` (audit tables inside it), not the brief §14 two-file model → residual reconciliation follow-up (R-DRILL-1).

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`, retrievable YES, no failure class, no fallback. Docs-evidence convention: review-plan on the PRODUCED drill doc + the gate-7 row (a code-diff audit is not applicable — the drill driver is a disposable /tmp artifact, not committed). The full drill doc + the gate-7 row diff were inlined into the prompt. Completed first attempt, no timeout.

### /cc-suite:review-plan (gpt-5.5/medium/read-only; on the produced drill evidence)
- `review-plan-mr8wp8jh-oc4ldw` · **READY (Low finding)** (no Critical/High/Medium). All five questions answered YES/none: (1) the PASS follows honestly from the recorded results (integrity ok, inflight→0, invariant holds after crash+restore, counts preserved); (2) disposable fixture, no real data, no committed harness, no dependency; (3) gate 7 kept NOT CLEARED, D-G7-1/D-G7-2 left to the user; (4) the single-file finding surfaced as a residual, not hidden; (5) no over-claim / unilateral clear / user-risk-decision / gate-6 audit / go-live smuggled in. One **Low**: "power-loss equivalent" over-stated the boundary (the parent observed `case-box.sqlite-wal=0` bytes at kill, so the drill proves abrupt-process-death recovery, not persisted-uncommitted-WAL / torn-write / storage-level power-loss recovery) — **applied**: tightened to "process-kill crash boundary" in §3 + §9 and added the explicit scope caveat (cross-referenced to residual R-DRILL-2). · rawOutput sha256 `5456f72c0c1854ee522b56877b45ea41f7d608496b4aaff5e9f6eae9c382129a`.

## Verdict: READY (drill executed, PASS; evidence honest; gate 7 non-cleared; go-live-independent)

QUEUE_REVIEW_VERDICT=PASS

## Gates (this execution lane)
- `scripts/workflow/check-queue.sh` → PASS.
- `scripts/workflow/check-contract-integrity.sh` → PASS.
- `CURRENT_SCHEMA_VERSION` unchanged (12); no product source/test/package/schema/contract change — only the NEW drill doc + the gate-7 evidence row + this review artifact. The persistence `dist/` was rebuilt to run the drill (gitignored — no tracked change). The `/tmp` drill driver is not committed. No gate-6 run, no risk-acceptance decided, no unilateral gate-7 clear, no go-live decision.

## Deferred findings
None deferred as open — the one Low was applied (boundary wording tightened + scope caveat). Residual follow-ups recorded in the drill doc §10 (separate future WIs, not run here): R-DRILL-1 (reconcile brief §14 two-file backup manifest vs the shipped single-file v1 layout; overlaps gates 14/18); R-DRILL-2 (optional stronger crash boundary forcing a pre-kill fsync/checkpoint); R-DRILL-3 (gate-15 can cite this drill as an exercised recovery path). Gate 7's clear depends on USER decisions D-G7-1 (accept v1 without mutation testing) + D-G7-2 (require the drill — now PASS); this drill supplies evidence, it does NOT decide those or imply go-live; the final GO/NO-GO verdict + the three STOP-AND-ASK hard-stops (4/11/21) remain the user's.
