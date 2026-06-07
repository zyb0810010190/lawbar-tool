QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-GOVERN-QUEUE-HARDENING-00 (WI-GQ1): defensive hardening of govern-queue.sh

- One WORKFLOW WI: harden `scripts/workflow/govern-queue.sh` with (1) atomic write (temp-in-`$RUN` + `mv`), (2) post-write self-verify (re-read + recompute `sha256(queue.md)`, fail loud + `rm` on mismatch/absent), (3) verbose success (recorded hash + absolute path). Defense-in-depth so a future silent-stale `queue.governed` becomes a LOUD failure of the writer — the script is NOT buggy (scratch reproduction refreshed across standalone/piped/compound/sh shapes) and the WI-G1 content-binding guard already fails closed; this reduces operator friction without changing the guard, the queue semantics, or the content-bound model. Adds `scripts/workflow/govern-queue.test.sh`.
- Proposal: `dev-memo/plan-batch-govern-queue-hardening-00.md` (untracked; queue is authority).
- cc-suite review-plan:
  - Attempt 1 `review-plan-mq3wvg1y-hi3okg` (compact packet): **NEEDS-FIX** — one Medium: the WI gate ran only `govern-queue.test.sh`, insufficient for a governance-tooling hardening whose top risk is output-format compatibility with `batch-commit-guard.sh`'s reader + downstream workflow breakage; it must also run the no-regression workflow tests.
  - Fix applied: Gates → `bash scripts/workflow/govern-queue.test.sh && bash scripts/workflow/check-queue.test.sh && node scripts/workflow/batch-closeout.test.mjs` (the latter drives the real guard against content-bound fixtures).
  - Re-review `review-plan-mq3wxhbn-32kj5b`: **PASS, no C/H/M** — gate now sufficient; WI feasible without Forbidden touches; no product-scope/queue-semantics/guard change; hard-stops explicit. (Residual non-finding: the proposal memo gate line was stale; updated for accuracy — the active WI controls per the source hierarchy.)
  - Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only.

# Confirmations
- Queue-lint PASSED on the amended queue (1 WI: WI-GQ1).
- Output format preserved byte-compatible with `batch-commit-guard.sh`'s `^queue_sha256=[0-9a-f]{64}$` reader (one `governed=` line + one canonical `queue_sha256=` line); both `--human-approved` + lint+review paths via `write_governed`; all fail-closed branches retained.
- Forbidden enforces no guard/hook/settings/product/queue-semantics change: `batch-commit-guard.sh`, `block-run-control-bash-write.sh`, `.claude/hooks/**`, `.claude/settings.json`, `apps/**`, `services/**`, `docs/contracts/**`, `check-queue.sh`, `batch-closeout.mjs`, `mark-queue-reviewed.sh`.
- The `block-run-control-bash-write.sh` substring-match tightening is explicitly OUT of scope (separate future finding).
- Allowed files do not intersect `dev-memo/run/forbidden-paths.txt`.
