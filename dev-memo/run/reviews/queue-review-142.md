# Queue review — WI-RELEASE-G7-ROBUSTNESS-POLICY-00 (authoring/governance)

Lane: M0 gate-7 robustness/mutation-test policy WI **authoring/governance** (Type: EVIDENCE, release-governance MEDIUM risk). Governance-authoring only — this lane produces the governed queue WI so a FUTURE lane authors the robustness-policy decision doc; it implements NOTHING, edits no policy/report, decides NO risk-acceptance, and makes NO go-live decision.
Date: 2026-07-05. Branch: `release-g7-robustness-policy-governance` (from synced `main` @ `52bef31`). Batch: 1/3 since marker `67ae7d4` — no batch closeout this lane.

## What this is
Authorizes (per explicit user authorization 2026-07-05) a FUTURE execution lane to convert M0 go-live **gate 7** (`docs/release/go-live-readiness-report.md` §1 gate 7 = OPEN — "Mutation-test / robustness policy … accept v1 without mutation testing OR bounded sweep") from an ambiguous OPEN blocker into a governed robustness-policy DECISION with explicit closure criteria. The future lane produces `docs/release/gate7-robustness-policy-00.md` defining six closure criteria — (1) crash/data-loss tolerance (crash mid-write must not corrupt the case-box SQLite DBs or the hash-chained audit log; WAL/synchronous better-sqlite3 + the startup schema-integrity check per brief §14); (2) local-first persistence/recovery (backup-as-directory over `~/Library/Application Support/lawbar/` + "drop directory back, run integrity check"); (3) offline/online reconciliation = **N/A for v1** (fully offline, no cloud sync); (4) audit/event integrity under failure (the `event_count==COUNT(*)==MAX(sequence)` invariant holds across crash/restart; overlaps gate 12); (5) failure-mode handling (stable `CaseBoxPersistenceError`/`OcrQueueError` codes + fail-closed + the ocr-worker graceful shutdown); (6) sufficient-evidence-to-clear (DECIDE whether v1's existing deterministic conformance + hardening + impl-parity suites + the audit-chain invariants are sufficient to accept v1 WITHOUT mutation testing + a documented crash-recovery drill, OR a bounded mutation/fuzz sweep — those are SEPARATE future WIs). It RECOMMENDS a v1 policy but SURFACES the accept-without-mutation-testing risk as a USER decision — it does NOT unilaterally clear gate 7. Dependencies mapped (not cleared): gate 6 (full-project audit lens), gate 12 (audit-chain integrity overlap), gate 14/15 (recovery/rollback drills), gate 5 (baseline deterministic evidence). The robustness bar is v1 local-first data survival + recovery + audit integrity — NOT distributed fault-tolerance. NO robustness/mutation/fuzz/crash-injection implementation; NO gate-6 run; NO dependency; NO go-live/STOP-AND-ASK decision.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`, retrievable YES, no failure class, no fallback. Governance-authoring lane → review-plan only (the exec lane's review-plan on the produced policy belongs to the future execution lane).

### /cc-suite:review-plan (gpt-5.5/medium/read-only; on the WI)
- `review-plan-mr8j56kz-hkfo2w` · **READY** (no Critical/High/Medium/Low; all five dimensions sound — internal consistency incl. the forbidden mutation-harness/dependency/gate-6/unilateral-clear list; completeness of the six v1-local-first closure criteria + the gate-6/12/14/15/5 dependency map; feasibility of a policy DECISION doc as the right deliverable; ambiguity control against running gate 6 / unilaterally clearing gate 7 / deciding the risk-acceptance / building a mutation-fuzz-crash harness; risk & sequencing keeping gate 7 non-cleared, offline/online N/A, dependencies unadvanced, go-live independence + STOP-AND-ASK 4/11/21 intact) · sha256 `9b78d589f5cbaf6f6f98db846572fa39648cce8aa84380d7dfc4d57f7469a943`.

## Verdict: READY (governed gate-7 robustness-policy WI; decision-doc-only; no unilateral clear; go-live-independent)

QUEUE_REVIEW_VERDICT=PASS

## Gates (this authoring lane)
- `scripts/workflow/check-queue.sh` → PASS.
- `scripts/workflow/check-contract-integrity.sh` → PASS.
- `CURRENT_SCHEMA_VERSION` unchanged (12); no source/test/policy/report/native/schema/contract/dependency code touched — this lane commits ONLY the queue governance + this review artifact. No policy implementation, no gate-6 run, no risk-acceptance, no go-live decision.

## Deferred findings
None. review-plan READY with no findings. The FUTURE execution lane owes: the policy doc (six closure criteria + dependency map + recommendation + surfaced user risk-acceptance), the gate-7 evidence-row update (non-unilateral), and its own review-plan. Gate 7's clear depends on a USER risk-acceptance (accept v1 without mutation testing) — the policy recommends + surfaces, never decides for the user; this does NOT imply go-live — the final GO/NO-GO verdict + the three STOP-AND-ASK hard-stops (4/11/21) remain the user's.
