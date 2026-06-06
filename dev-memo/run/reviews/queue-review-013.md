QUEUE_REVIEW_VERDICT=PASS

# Queue review — WORKFLOW-GOVERNANCE-INTEGRITY-00 (WI-G1 + WI-G2): governance-chain integrity hardening

- Fresh governed queue (the closed WI-806 queue replaced). Two WORKFLOW/SCAFFOLD WIs closing the only open High + the open Medium in `dev-memo/deferred-audit-findings.md`:
  - **WI-G1** closes **BCG-6 / GOVERNANCE-CHAIN-001** (High): bind `queue.governed` to `sha256(dev-memo/run/queue.md)` — `govern-queue.sh` records the digest (lint+review AND `--human-approved` paths); `batch-commit-guard.sh` recomputes + denies (fail-closed) on absent/malformed/mismatched hash or unreadable queue, strictly AFTER the existing `-f queue.governed` presence check (additive deny only).
  - **WI-G2** closes **BCG-9** (Medium): make `count_git_commits()` quote-aware so a single commit whose quoted `-m` message contains a separator + the literal `git commit` is no longer split and over-denied, while genuine chained `git commit && git commit` still counts 2 (deny preserved); fall back to the current global split on quote ambiguity (over-deny, never under-count).
- Proposal: `dev-memo/plan-workflow-governance-integrity-00.md` (left untracked; the governed queue is the authority).
- cc-suite review-plan job: review-plan-mq1yykph-48tr82 (Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only).
- Codex verdict: READY TO GOVERN — **no Critical / High / Medium**. All 5 dimensions PASS per-WI and overall:
  - Internal consistency: coherent; both WIs touch `batch-commit-guard.sh` but writer ownership (`govern-queue.sh`) sits only in WI-G1, which WI-G2 forbids.
  - Completeness: specified deny cases are fail-closed; both authorization paths bind the digest.
  - Feasibility: implementable in bash without a general shell parser (portable sha helper text-identical in writer + guard; conservative quote-neutralization state machine).
  - Ambiguity: fail-closed direction unambiguous; the "fallback to current global split" requirement is the key guard against a WI-G2 under-count regression.
  - Risk & sequencing: bootstrapping + breaker handled by the interim-closeout cadence (execution constraint, not a plan defect). No secrets/deps/contract/settings change.

# Non-blocking reviewer note (carried to the WI-G1 implementer; NOT a gate)
- Reviewer suggested WI-G1 also add an explicit **"unreadable queue.md → deny"** test case to `batch-commit-guard-base.test.sh` (the acceptance text covers it as fail-closed behavior; a dedicated test would prove it). RECOMMENDED for the WI-G1 implementation to include. Not added to the queue now because the queue must not be edited after the review hash is taken (the very drift WI-G1 closes); the implementer adds the test within WI-G1's existing Allowed test file.

# Confirmations
- Queue-lint (check-queue.sh) PASSED on the live queue (2 WIs: WI-G1, WI-G2).
- Both WIs Type WORKFLOW (not UI) → no Design-artifact gate.
- Allowed files do not intersect `dev-memo/run/forbidden-paths.txt` (secrets/infra/migrations only).
- No product/renderer/contract/persistence/`settings.json` change; no new runtime dependency; no migrations.
- BCG-6 and BCG-9 are both represented (WI-G1 ↔ BCG-6; WI-G2 ↔ BCG-9).
