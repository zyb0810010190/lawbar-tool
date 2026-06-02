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
Commit: 059e7f6 (after user recorded last-batch-audit=4cefe67 checkpoint)
Next: NONE new. Per user: do NOT run another autonomous batch until this fix lands.

## WI-SCAFFOLD-005  (2026-06-01, user-authorized; not a canary-queue WI)
Plan: remove the narrow `if` filters (Bash(git add*) / Bash(git commit*)) from the three git
  guard hook entries in .claude/settings.json so block-git-add-all.sh, block-commit-stage-all.sh,
  and batch-commit-guard.sh run on EVERY Bash call. Each script self-inspects and exits 0 for
  irrelevant commands -> the safe pattern is broad invocation + script-level detection. Without
  this, the WI-SCAFFOLD-004 hardening was dead code for /usr/bin/git, env/command wrappers, etc.
  (the `if` prefix-glob never matched them).
Files: .claude/settings.json (hooks; staging-hygiene carve-out), dev-memo/run/log.md.
Tests: settings JSON valid; carve-out diff = only the 3 `if` lines removed; base 14/14, detect
  28/28, block-run-control 45/45; gates 245/0. Smoke: benign (ls/echo/cat/npm) ALLOW on all
  three guards; `git add -A` and `env git add .` DENY via block-git-add-all.
FLAGGED GAP (not fixed — out of scope; recommend follow-up WI): block-git-add-all.sh and
  block-commit-stage-all.sh still use substring/boundary detection, so `/usr/bin/git add -A`
  (path-prefixed) still slips them even when invoked. batch-commit-guard.sh is the only one with
  the statement-aware command-word detection from WI-SCAFFOLD-004. Follow-up: port that detection
  to the two staging guards (new deferred class BGAA/BCSA-detection-hardening).
Review: low-risk wiring change; self-review = JSON validity + carve-out diff + suites + smoke.
Commit: 68944e8
Next: WI-SCAFFOLD-006 closes the flagged gap.

## WI-SCAFFOLD-006  (2026-06-01, user-authorized; not a canary-queue WI)
Plan: port batch-commit-guard.sh's statement-aware command-word detection into the two staging
  guards so they catch broad staging across path-prefixed git (/usr/bin/git, ./git), wrappers
  (env/command/exec/time/...), \git, env assignments, and git global options (-c/-C/--no-pager) —
  not just the literal `git add`/`git commit` prefix. Closes the WI-SCAFFOLD-005 flagged gap.
  block-git-add-all preserves the broad-pathspec deny set (-A/--all/-u/--update/./././/:/'*');
  also now catches quoted `"*"`/`"."`. block-commit-stage-all preserves -a/--all/clustered-flag
  (-am/-va/-aF) detection and strips quoted message content first (so -a in a message + message
  separators are ignored). emit_deny runs in the main shell via process substitution so a deny
  terminates the whole hook.
Files: .claude/hooks/block-git-add-all.sh, .claude/hooks/block-commit-stage-all.sh,
  .claude/hooks/tests/block-git-add-all.test.sh, .claude/hooks/tests/block-commit-stage-all.test.sh,
  dev-memo/deferred-audit-findings.md, dev-memo/run/log.md.
Tests: block-git-add-all 30/30, block-commit-stage-all 26/26 (incl. all 6 user-required cases:
  /usr/bin/git add -A, git -c x=y add ., command git add ., /usr/bin/git commit -am x,
  git -c x=y commit -am x, irrelevant ALLOW). Regression: base 14, detect 28, block-run 45 green.
  gates 245/0. Live smoke: benign ALLOW; path-prefixed/wrapper/global-option broad forms DENY.
Findings: dev-memo/deferred-audit-findings.md — BGAA-1 + BCSA-1 closed; BGAA/BCSA-2 (cmd-subst /
  arg-taking-wrapper) deferred consistent with the rest of the guard suite.
Review: enforcement change; self-review = the 56 new test cases + regression + live smoke.
  Independent /cc-suite:audit available if desired (Codex responsive).
Commit: 93ce672
Next: NONE. Per user: do not push until reviewed.

## WI-TEST-001  (2026-06-01, user-authorized; apps/ change, not a canary-queue WI)
Plan: fix false positives in the lawbar-desktop no-real-data gate. The scanner read binary
  .woff2 fonts under renderer/fonts/ as UTF-8, so byte runs (e.g. "qx@V.uh") matched the email
  pattern -> FAIL on a clean tree (full sweep). Added a general BINARY_EXTS skip list (fonts /
  images / archives / binaries / media / db; .svg deliberately kept as text), applied at BOTH
  isInScope (binary never enters scope) and scanFile (defense-in-depth). Verified the root cause:
  the gate passed during the canary because the tree had changes (scanner scanned only changed
  files, not the unchanged fonts); on a clean tree it does the full sweep and hit the fonts.
Files: apps/lawbar-desktop/scripts/check-no-real-data.mjs,
  apps/lawbar-desktop/tests/check-no-real-data.test.mjs, dev-memo/run/log.md.
Tests: check-no-real-data.test.mjs 11/11 (5 new: isBinaryAsset, scanFile skips .woff2, scanFile
  still flags a real email in .ts, isInScope excludes fonts but keeps renderer text). Explicit
  scan of the 3 real fonts -> OK (was FAIL). npm test / check-gates.sh: 245 pass / 0 fail.
Review: low-risk false-positive fix to a data-hygiene gate; the change only EXCLUDES binary
  extensions and preserves all text detection (proven by the positive email-in-.ts test). Codex
  available; not requested. Self-review = the unit tests + explicit font scan + full gate.
Commit: 9122f9d (on main — migration branch was merged via PR #1)
Next: NONE. Per user: do not push.

## WI-SCAFFOLD-007  (2026-06-01, user-authorized; not a canary-queue WI)
Plan: add the UI Design gate — a Type: UI WI may enter a governed queue only with a concrete
  'Design artifact:' reference. check-queue.sh: added UI to VALID_TYPES (was rejected as invalid
  Type, yet the gates check already referenced UI — inconsistency fixed) + a gate that fails the
  lint when a UI WI omits Design artifact or uses a placeholder (none/TBD/pending/empty). Non-UI
  WIs lint unchanged; the legacy UI baseline (dev-memo/ui-baseline.md) is evidence not a queued
  WI, so no retroactive proof. This adds the gate mechanism + docs only — NOT full UI automation.
Files: scripts/workflow/check-queue.sh, scripts/workflow/check-queue.test.sh (new),
  dev-memo/run/queue.example.md (UI example w/ Design artifact), UI-GATES.md (queue-entry gate
  section), UI-LANE-INSTALL.md (pointer), AGENTS.md (UI added to WI types + note),
  dev-memo/run/log.md.
Tests: scripts/workflow/check-queue.test.sh 6/6 — non-UI passes, UI-with-design passes,
  UI-without-design FAILS, UI-with-placeholder FAILS, mixed-queue FAILS, Type UI accepted.
  Real queue.md still lints PASS (non-UI). AGENTS.md 12974 B (<32 KiB). check-gates 245/0.
  Mid-impl bug caught by tests: empty Design field slipped (`printf '%s' ""` gives grep no line);
  fixed with an explicit `[ -z "$design" ]` check.
Review: scaffold/workflow gate change; self-review = the 6-case check-queue harness + real-queue
  lint + gates. Independent /cc-suite:audit available if desired.
Commit: <pending>
Next: NONE. Per user: do not push until reviewed.

## Workflow note — GitHub private-repo branch protection limitation

- UI design artifact PR-time workflow installed and canary-tested.
- Positive canary: non-UI PR ran the check and passed without `Design artifact:`.
- Negative canary: UI implementation PR touching `apps/lawbar-desktop/renderer/index.css` ran the check and failed without `Design artifact:`.
- Attempted GitHub rulesets and classic branch protection for required status checks on `main`.
- GitHub UI indicated enforcement is unavailable for this private repository under the current account state.
- Decision: keep repo private; do not make legal/case-box repository public for merge gating. Treat the check as advisory until account/repo enforcement changes.
