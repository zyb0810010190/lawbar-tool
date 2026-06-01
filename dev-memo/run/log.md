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
Commit: b5891bd
Next: WI-002 (canary)

## WI-002  (2026-05-31)
Plan: record gate command note (npm --prefix apps/lawbar-desktop test) from check-gates.sh.
Review: low-risk doc WI; Codex unavailable (ETIMEDOUT) → recorded self-review fallback.
Gates: check-gates.sh 245 pass / 0 fail.
Commit: 06519cd
Files: dev-memo/gate-command-note.md
Next: WI-003 — BLOCKED at batch-audit-due breaker (count b632c98..HEAD = 3 >= BATCH_AUDIT_EVERY=3).
  last-batch-audit (b632c98) takes precedence over the reset batch-start (b5891bd), so the
  window counted b5891bd + 7609d79 + 06519cd. Fixed under WI-SCAFFOLD-003 below.

## WI-SCAFFOLD-003  (2026-05-31, user-authorized; not a canary-queue WI)
Plan: fix BATCH-COUNTER-001 — batch-commit-guard.sh now derives the count from the NEWER of
  batch-start / last-batch-audit (was: last-batch-audit always overrode batch-start, so a
  forward reset had no effect and pre-audit commits kept counting). Also drops invalid refs
  (closes a fail-open where an unresolvable last-batch-audit gave COUNT=0).
Tests: .claude/hooks/tests/batch-commit-guard-base.test.sh — 14/14 (incl. the exact bug +
  fail-open closure). bash -n OK. Redirect-hook suite still green.
Review: enforcement-breaker change; Codex unavailable this session (ETIMEDOUT) → recorded
  self-review fallback = the 14-case BASE harness + live verification (BASE=b5891bd, count 2
  vs old 3). Independent /cc-suite:audit recommended later.
Effect (live): BASE now = b5891bd (newer batch-start), count b5891bd..06519cd = 2 < 3.
Commit: 9b7b52d
Next: WI-003 (canary) — after batch-start was reset to 9b7b52d (now effective via newer-wins),
  the window cleared and WI-003 ran.

## WI-003  (2026-05-31)
Plan: record UI baseline pointer (dev-memo/ui-baseline-pointer.md) -> dev-memo/ui-baseline.md.
Review: low-risk EVIDENCE doc; Codex unavailable (ETIMEDOUT) → recorded self-review fallback.
Gates: check-gates.sh 245 pass / 0 fail.
Commit: 8328b07
Files: dev-memo/ui-baseline-pointer.md
Next: NONE — canary queue (WI-001/002/003) complete.

## WI-SCAFFOLD-004  (2026-05-31, user-authorized; not a canary-queue WI)
Plan: harden batch-commit-guard.sh git-detection per independent audit audit-mpuesqmt-4zzpxr.
  FIXED (scope-limited per user): (1) path-prefixed command word /usr/bin/git; (2) git global
  options before subcommand (git -c k=v, git --no-pager); (3) leading env assignment FOO=bar git;
  (4) multiple git-commit invocations in one Bash call -> deny; (5) rev-list runtime error
  fail-open -> deny on non-zero/non-numeric. Detection is now statement-aware (awk split; the
  command word of each statement must itself be git), so `echo "git commit"` / `git config
  commit.x` are not counted.
Scope extension (user-authorized after independent audit audit-mpufm338-2gtelo): (6) command-
  prefix wrappers `\git` / `command` / `exec` / `time` / `env [-i] FOO=bar git`; (7) divergent-
  base helper rev-list calls now fail-closed too (completes item 5). DEFERRED per user: Bash
  path-indirection, token-nonce, git-alias resolution (BCG-8), quote-aware splitting (BCG-9),
  arg-taking wrapper-flag residual (BCG-10) — dev-memo/deferred-audit-findings.md (19 open, 3 closed).
Bug found+fixed mid-impl: BSD sed drops an unterminated final line -> the first detector
  miscounted single-statement commands as 0 (guard silently allowed). Switched split to awk +
  printf '%s\n'. Caught by the test suite before commit.
Tests: .claude/hooks/tests/batch-commit-guard-detect.test.sh — 28/28 (incl. wrappers + divergent
  selection); base suite 14/14; block-run-control suite 45/45. bash -n OK. Live: normal /
  `/usr/bin/git` / `\git` / `command git` / multi-commit all DENY at breaker; `git status`,
  `nohup ls` ALLOW.
Review: enforcement-breaker change. Independent Codex audit RAN: audit-mpufm338-2gtelo (2m46s,
  NEEDS WORK) — confirmed all 5 base fixes work; surfaced wrappers (#1, FIXED), divergent
  fail-open (#4, FIXED), git-alias (#2, deferred BCG-8), quote-split (#3, deferred BCG-9).
Findings recorded: dev-memo/deferred-audit-findings.md (WI-SCAFFOLD-004 section).
Commit: <pending — blocked at batch-audit-due, count 9b7b52d..HEAD = 3; needs checkpoint>
Next: NONE new. Per user: do NOT run another autonomous batch until this fix lands.
