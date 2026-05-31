# Auto-advance audit trail (append-only)

One block per completed WI. The runner appends before advancing. Designed so a run can be
reverted task-by-task: each commit hash here maps to one revertable commit.

<!-- Block format:
## WI-001  (2026-05-31T14:22Z)
Plan: <summary>
Codex review: PASS | Codex audit: PASS | Codex verify: PASS
Commit: <hash>
Files: <exact paths committed>
Next: WI-002
-->

## WI-SCAFFOLD-001  (2026-05-31, user-authorized; not a canary-queue WI)
Plan: fix batch-commit-guard.sh config parse — GNU `\+` → BSD-portable `[0-9][0-9]*`.
Codex review: queue-governance covers scaffold n/a | Codex audit: STALL ~27min (no verdict, classified TIMEOUT) → self-review fallback (LOW risk) | Codex verify: n/a
Commit: 40c000e
Files: .claude/hooks/batch-commit-guard.sh
Next: WI-001 (canary)

## WI-001  (2026-05-31)
Plan: record first non-UI canary start note grounded in HANDOVER.md.
Codex review: queue governed (lint+review) | Codex audit: PASS (job audit-mptxbm0u-q5odob, no findings) | Codex verify: ALL CLOSED
Commit: b632c98
Files: dev-memo/canary-start.md
Next: WI-002 — BLOCKED at batch-audit-due breaker (3 commits since batch-start >= BATCH_AUDIT_EVERY=3)

## Layer-B checkpoint  (2026-05-31, user-recorded)
Audit studied: independent enforcement-hook audit (workflow run wh750k0v0, 39 agents) +
  prior Codex hook audit (ETIMEDOUT). Report: dev-memo/hook-audit-canary-01.md.
last-batch-audit recorded at b632c98 by deliberate human action → breaker cleared, count→0.

## WI-SCAFFOLD-002  (2026-05-31, user-authorized; not a canary-queue WI)
Plan: close BASH-WRITE-BYPASS (High) — new PreToolUse(Bash) hook denying direct Bash writes to
  dev-memo/run/ authority files; log.md kept append-only. Test-first, 45/45 cases.
Review: self-test suite green (45/45); Codex unavailable (ETIMEDOUT this session) → recorded.
Files: .claude/hooks/block-run-control-bash-write.sh, .claude/hooks/tests/block-run-control-bash-write.test.sh,
  .claude/settings.json (hooks wiring), .claude/rules/staging-hygiene.md (carve-out),
  dev-memo/hook-audit-canary-01.md, dev-memo/run/last-batch-audit
Commit: <pending>
Next: still WI-002 (canary) — NOT advanced; awaiting user.
