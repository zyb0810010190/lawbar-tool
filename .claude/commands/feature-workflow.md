---
description: Generic Lawbar feature orchestration — drive ONE reviewed work item through the least-privilege agent chain (planner -> test-designer -> implementer -> reviewer), getting gates green for a human commit decision. Not Evidence-specific; never auto-commits or pushes.
allowed-tools:
  - Task
  - Read
  - Grep
  - Glob
  - Bash
---

# /feature-workflow

Generic Lawbar workflow orchestration for ONE bounded, reviewed work item. This command is **not**
Evidence-specific (Evidence work uses `/evidence-workflow`, a future WI). It composes the least-privilege
agents under `.claude/agents/` and the existing governance in `AGENTS.md` + `.claude/rules/`. It
**preserves, never bypasses** the project's controls.

## Sequence (least-privilege — separation of duties is enforced by each agent's `tools:` grant)

1. **planner** (read-only) — restate WI scope (target files, acceptance criteria, out-of-scope), produce a
   numbered plan with dependencies/risks. No writes.
2. **test-designer** (read-only) — **test design precedes implementation.** Produce the testing-gate fields
   and the proposed test/spec content as a diff in text. It is read-only by design (path-scoped write is
   not hard-enforceable at the agent level), so the implementer applies its diffs.
3. **implementer** (write) — the ONLY writer. Apply the proposed tests (red) then the smallest code change
   (green); touch only the WI's Allowed files; run the WI's gates.
4. **reviewer** (read-only) — review the diff against the approved plan + tests; scope/simplicity/style; no
   invariant or gate weakened. (For Evidence-touching work, also consult `evidence-invariant-reviewer`.)
5. **release-steward** (git, **only on explicit human request**) — see "Commits" below.

## Test design precedes implementation
No implementation begins before the test design exists and is approved. New tests must fail before the
change (red) and pass after (green); existing tests stay green. Reject wiring-only tests.

## Commits are human-controlled (the workflow does NOT decide to commit)
- **The workflow's job is to get the gates green. The human decides whether to commit.** These are
  different steps; do not conflate them.
- **No autonomous `git commit`.** **Never `git push`** (push is an `AGENTS.md` hard-stop).
- Staging is **exact paths only**, and only when the human explicitly instructs a commit (`git add <path>`;
  never `git add .`/`-A`). Confirm `git diff --cached --name-only` before committing.
- **Stop on guard denial.** If a PreToolUse hook (`batch-commit-guard`, `block-git-add-all`,
  `block-commit-stage-all`, contract-corruption guard) denies an action, STOP and report — do not retry to
  evade it.

## Queue governance is preserved
- This command does NOT make self-authorizing queue edits. Adding/advancing a governed WI happens only
  through the review -> lint -> govern chain (`check-queue.sh` + Codex `/cc-suite:review-plan` +
  `mark-queue-reviewed.sh` + `govern-queue.sh`), with `govern-queue.sh` run standalone, never bundled with
  the commit.

## Gate reporting: classify hard vs soft
When reporting gate results, classify each gate **HARD** (cannot pass without — e.g. tests, typecheck,
build, contract-integrity, `exit 2`/`deny` hooks) vs **SOFT** (advisory — e.g. loc-guardian warn zone,
self-review fallback). A soft warning does not block; a hard failure does.

## Hard stops
Defer to `AGENTS.md` and `.claude/rules/autonomy.md`. Stop and ask on any hard-stop (push, secrets, new
dependency, public-API/schema/CLI break, cloud/auth choice, etc.). For high-risk WIs, cc-suite
review/audit/verify via the broker is required (`.claude/rules/cc-suite.md`).
