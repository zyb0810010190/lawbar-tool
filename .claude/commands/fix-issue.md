---
description: Lawbar issue-remediation orchestration — drive ONE bounded bug/issue through root-cause -> plan -> test design -> fix -> review via the least-privilege agents, getting gates green for a human commit decision. Explicitly NOT a bypass around planning or review; never auto-commits or pushes.
allowed-tools:
  - Task
  - Read
  - Grep
  - Glob
  - Bash
---

# /fix-issue

Issue-remediation orchestration for ONE bounded bug/issue. It composes the least-privilege agents under
`.claude/agents/` and the existing governance in `AGENTS.md` + `.claude/rules/`. It **preserves, never
bypasses** the project's controls.

## This is NOT a shortcut around planning or review
`/fix-issue` does **not** authorize skipping plan review or test design, and is **not** a fast path that
bypasses planning, review, or queue governance. A "quick fix" still goes through the same disciplined chain
below. If the fix is non-trivial or touches a high-risk surface, it requires the same plan review / cc-suite
broker gates as any other WI (`.claude/rules/cc-suite.md`, `.claude/rules/security-boundary.md`).

## Sequence (least-privilege — separation of duties enforced by each agent's `tools:` grant)

1. **planner** (read-only) — reproduce and root-cause the issue; restate the bounded remediation scope
   (target files, acceptance criteria, out-of-scope); name the regression the fix must close. No writes.
2. **test-designer** (read-only) — **test design precedes implementation.** Design a regression test that
   reproduces the bug (red before the fix) plus the fixed-behavior assertion; emit them as a proposed diff.
3. **implementer** (write) — the ONLY writer. Apply the regression test (red), then the smallest fix
   (green); touch only the WI's Allowed files; keep existing tests green; run the WI's gates.
4. **reviewer** (read-only) — review the fix against the root-cause + approved tests; confirm the regression
   is genuinely closed and no invariant/gate weakened. (Evidence-touching fixes also consult
   `evidence-invariant-reviewer`.)
5. **release-steward** (git, **only on explicit human request**) — see "Commits" below.

## Test design precedes implementation
The regression test that reproduces the bug must exist and fail BEFORE the fix, and pass AFTER. No fix
lands without a test that would have caught the bug. Reject wiring-only tests.

## Commits are human-controlled (the workflow does NOT decide to commit)
- **The workflow's job is to get the gates green. The human decides whether to commit.** Different steps.
- **No autonomous `git commit`.** **Never `git push`** (push is an `AGENTS.md` hard-stop).
- Staging is **exact paths only**, and only when the human explicitly instructs a commit (`git add <path>`;
  never `git add .`/`-A`). Confirm `git diff --cached --name-only` first.
- **Stop on guard denial.** If a PreToolUse hook denies an action, STOP and report — never retry to evade it.

## Queue governance is preserved
- No self-authorizing queue edits. A governed WI is added/advanced only through the review -> lint -> govern
  chain (`check-queue.sh` + Codex `/cc-suite:review-plan` + `mark-queue-reviewed.sh` + `govern-queue.sh`),
  with `govern-queue.sh` run standalone, never bundled with the commit.

## Gate reporting: classify hard vs soft
Report each gate as **HARD** (tests/typecheck/build/contract-integrity/`exit 2`/`deny` hooks — blocking) vs
**SOFT** (advisory — loc-guardian warn zone, self-review fallback). Soft warnings do not block; hard
failures do.

## Hard stops
Defer to `AGENTS.md` and `.claude/rules/autonomy.md`. Stop and ask on any hard-stop. During overnight /
`/loop` / `/project-autopilot` runs, do not auto-revert committed work (`STOP-FOR-ROLLBACK`).
