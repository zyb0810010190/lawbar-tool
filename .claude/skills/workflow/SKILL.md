---
name: workflow
description: Use when implementing, fixing, refactoring, or committing changes in this repo — runs the Work Item protocol end to end: baseline, source-of-truth, scoped edit, gates, review, exact-path commit, post-push report. Not needed for read-only questions.
---

# Workflow

The governing contract is `AGENTS.md` (operating model, source hierarchy, gates, commit
policy, delegation, hard stops). This skill is the executable lifecycle. Do not restate the
contract — apply it.

## Lifecycle

1. **Name the WI.** Type (PLAN/SOURCE/ASSET/IMPL/TEST/REVIEW/EVIDENCE/CLOSURE/SCAFFOLD/
   WORKFLOW/MEMORY) and scope in one line. Confirm explicit authorization — a prior WI does
   not authorize this one. After a gap, or for a MEMORY WI, recover prior context with
   `echo-sleuth` (search past sessions, build a timeline, extract decisions) before acting.
2. **Verify baseline.** `scripts/workflow/check-baseline.sh`. Stop on a dirty tree, wrong
   branch, or unexplained mismatch.
3. **Confirm source of truth** per the `AGENTS.md` hierarchy. On conflict, stop and report
   — do not choose silently.
4. **Declare file boundaries.** Allowed files/categories and forbidden files. Touching a
   forbidden file is a hard stop.
5. **Implement only the authorized scope.** No adjacent refactors. No mixing product with
   scaffold/workflow changes. No inferring missing assets or specs without authorization.
   For code (IMPL/TEST WIs): drive correctness test-first with `tdd-guardian`; after edits,
   check file size with `loc-guardian` (flags files over its pure-LOC limit and proposes
   extractions) so changes don't grow god-files.
6. **Run gates.** `scripts/workflow/check-gates.sh`. A failing gate whose fix is outside
   scope opens a separate WI.
7. **Run the delegation chain** (see "Delegation chain" below) — the core review loop.
   Also: `grill` for adversarial multi-angle review on architecture/security/error-handling
   changes; `docs-guardian` when the WI changes public APIs, user-facing behavior, or setup
   docs.
8. **Reconcile findings.** Each is Fixed, Deferred (with a follow-up WI), or Rejected
   (with reason).
9. **Report before commit** (format below). In **gated mode**, request commit authorization
   if not already explicit (a `dev-memo/run/human.ack`). In **autonomous batch mode**, a
   governed queue plus successful per-WI checks provide commit authority for this queued WI
   only — the `batch-commit-guard.sh` hook enforces the breaker/audit/risk limits.
10. **Stage exact paths only** (`git add <path> <path>`; never `git add .`/`-A` without
    explicit authorization). This is also enforced by `.claude/hooks/block-git-add-all.sh`;
    if the hook denies a command, obey the denial and use exact paths — it is policy, not
    an incidental tool failure.
11. **Verify staged files.** `scripts/workflow/check-staged-files.sh`.
12. **Commit by mode.** Batch mode may commit locally; **push is never automatic** — push
    only after explicit authorization. After committing in batch mode, append the run-log
    entry. The commit count is git-derived from `batch-start`/`last-batch-audit`; do not
    maintain a counter file.
13. **Post-push report** (format below).
14. **Stop or advance by mode.** Gated mode: stop. Batch mode: continue only to the next
    *governed-queue* WI, within `AUTO_ADVANCE_MAX`, unless a hard stop, risk trigger, or due
    batch audit fires.

## Delegation chain (autonomous within a task)

This is the plan→review→fix→verify→execute→audit→fix→verify loop, run automatically within a
WI via cc-suite. Behavior at the WI boundary depends on `AUTO_ADVANCE_MAX` (`dev-memo/run/
config`): `1` stops for human review; `3`/`10` commit and advance to the next *queued* WI.
In every mode the agent advances only through WIs already in `dev-memo/run/queue.md` and
never invents the next task; a Codex PASS authorizes a queued WI to proceed, never new work.

1. Claude writes the plan.
2. Codex reviews it — `/review-plan`.
3. Claude fixes the plan per findings.
4. Codex verifies the fix — `/verify`. **If Codex returns FAIL → HARD STOP, report, wait.**
5. Claude executes the plan.
6. Codex audits the execution — `/audit`.
7. Claude fixes any audit findings.
8. Codex verifies the fixes — `/verify`. **If Codex returns FAIL → HARD STOP, report, wait.**
9. On all-PASS: run the per-WI gates (tests/lint/typecheck/build; UI gates if UI), append the
   audit-trail entry to `dev-memo/run/log.md`, produce the pre-commit report, stage exact
   paths, and commit. Then: if `AUTO_ADVANCE_MAX=1`, stop for human review. Otherwise, if the
   commit count hit `BATCH_AUDIT_EVERY` or any Layer-C risk trigger fired, run the batch audit
   (`BATCH-AUDIT.md`) + echo-sleuth study packet and continue only on PASS; else pick up the
   next queued WI (within the breaker) and restart. On any Codex FAIL/stall, halt the batch.

**Hard-stop rule (non-negotiable):** any Codex `FAIL` / stall / unavailability — or a gate
failure, forbidden-file touch, queue ambiguity, scope conflict, or breaker limit — halts the
**whole batch** and waits for a human. Mark the lane `CODEX-FAILED` | `CODEX-STALLED` |
`CODEX-UNAVAILABLE`, preserve output, report. A Codex `PASS` lets a queued WI commit and the
next queued WI begin; it is never authority to create new work, and never overrides a hard
stop. Two LLMs agreeing is not independent verification — that is why study-after-ship relies
on the revertable per-WI audit trail, not on the agents' own confidence. Never treat a stall
as a pass.

## UI lane (for UI/UX Work Items)

1. **Design** in Claude Design (Anthropic Labs) — produce the visual direction / prototype.
2. **Implement** by handing the design to Claude Code's built-in `frontend-design` skill.
3. **Audit responsiveness** with `ui-responsive` (xiaolai): an advisory coach that flags
   off-catalog breakpoints, bare `100vh`, and fixed widths without `max-width` via a
   PostToolUse hook. Note this is responsive-layout only — it does not cover accessibility,
   contrast, or palette; add a dedicated a11y check separately if you need it.
4. **Enforce tokens** with `ui-tokenize` (xiaolai): its PreToolUse hook rewrites hardcoded
   UI literals to design-token references on the way to disk. This is enforcement, not
   advice — treat its rewrites/denials as policy.
5. **Regression gates** (autonomous-grade, see `UI-GATES.md`): Playwright `toHaveScreenshot`
   (visual), `@axe-core/playwright` (a11y), Lighthouse 13 (performance). These are a floor —
   they are partial regression catchers, not accessibility certification (see UI-GATES.md);
   any gate failure is a Layer-C risk trigger that stops the batch.
6. Then re-enter the delegation chain above for review/audit before commit.

## Pre-commit report

changed files · behavior implemented · source of truth used · gates run and results ·
review chain · findings disposition · `git status --short` · exact paths proposed.

## Post-push report

commit hash · push output · `git status --short` · `git log --oneline -4` · exact files
committed · next lane status.

## Tools by Work Item type

Plugins are capabilities the lifecycle invokes when relevant — not auto-run. Match tool to
WI type; exact command names are in each plugin's `/help` (verify on this machine, since
command surfaces change):

- **IMPL / TEST** — `tdd-guardian` (test-first, coverage), `loc-guardian` (file-size limit).
- **REVIEW** (or review step of any WI) — `grill` (adversarial), cc-suite Codex (`/audit`),
  `docs-guardian` (doc accuracy/coverage) when docs are affected.
- **SCAFFOLD / WORKFLOW / MEMORY** — `nlpm` (`/nlpm:score`, `/nlpm:check`, `/nlpm:fix`) to
  lint the NL artifacts you're editing (AGENTS.md, this skill, rules, hooks). NLPM's
  PostToolUse hook only *reminds*; run the score explicitly.
- **MEMORY / start-of-WI-after-a-gap** — `echo-sleuth` to recover context. Which command:
  short gap → `/echo-sleuth:recap 5`; long gap → `/echo-sleuth:timeline --since <date> --limit 50`;
  a specific past decision → `/echo-sleuth:recall "<topic>" --scope current --limit 10`;
  durable lessons after a completed change (under a MEMORY WI) → `/echo-sleuth:extract`;
  memory cleanup → `/echo-sleuth:dashboard` then `/echo-sleuth:prune --dry-run`.
  Recovered memory is advisory only (source hierarchy) — never authority.
- **UI / UX** — Claude Design → `frontend-design` (built-in) → `ui-responsive` advisory +
  `ui-tokenize` enforcement (both xiaolai). See "UI lane" above.
- **Docs/diagrams** — `mermaid-preview` (xiaolai) auto-previews Mermaid on write/edit.

## Promotion

Keep this skill lean. When a sub-procedure grows its own branching, tools, or repeated
checks, split it into a separate skill. Path-specific constraints go in `.claude/rules/`
only when a real path-scoped need exists.
