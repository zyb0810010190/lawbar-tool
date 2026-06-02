# Autonomous next-WI protocol

**Status**: codified workflow protocol (canonical). Tracked 2026-06-02 after the protocol was
validated in practice across several autonomous WIs — e.g. `PRODUCT(ui)` empty-state copy fix,
the docs supersession PR, and the matter-not-found copy fix — each run as one bounded
feature-branch WI with validation, push, PR prep, and a stop-before-merge handoff.

Claude may choose and execute the **next single bounded WI** when the human explicitly asks for
autonomous work. This protocol governs that one-WI-at-a-time mode; it is NOT a standing grant
and NOT a continuous loop (for the queue-driven loop see `.claude/skills/project-autopilot/`;
for picking the next unblocked WI from plan docs see `.claude/commands/continue-project.md`).
The authority below applies only within a human-invoked autonomous-next turn.

## Selection priority

Pick the highest-value bounded WI using this order:

1. Product correctness bugs where current behavior/copy is false.
2. Product proof gaps where implementation exists but lacks end-to-end evidence.
3. Small product increments already planned in `dev-memo/`.
4. Documentation/provenance cleanup that prevents future agent confusion.
5. Workflow hardening only if it removes a repeatedly observed failure mode.

Do not pick speculative rewrites, large refactors, new product surfaces without a
source-of-truth plan, or parallel work while an existing PR from this run is open. Ground the
choice in concrete repo signals (a false string, a missing test, a planned `dev-memo/` item) —
do not invent novel scope. State the chosen WI and why before editing.

## Required start state

Before choosing a WI, verify:

- clean working tree (the only tolerated untracked item is gitignored local run-state)
- on `main`
- `HEAD == origin/main`
- `dev-memo/run/last-batch-audit == HEAD` (this file is gitignored local run-state; verify it
  locally, not via origin)
- no active feature branch/PR **from the current run** (pre-existing unrelated branches are fine)

If any precondition fails for an unexpected reason, hard-stop and report instead of guessing.

## Execution authority

Within a human-invoked autonomous-next turn, Claude may:

- create exactly **one** feature branch off `main` (never commit to `main` directly)
- edit files for that one bounded WI
- create a concrete design artifact under `dev-memo/design/` for any change touching
  `apps/*/renderer/*` (or other app UI paths) and include `Design artifact: <path>` in the PR body
- run the relevant validation gates
- commit (exact-path staging) and push the branch
- prepare/open a PR when tooling allows (if `gh` is unavailable, push the branch and hand back
  the compare URL + a ready PR title/body)

Claude must **stop before merge**.

## Hard stops

Stop and report if any occur:

- failing tests or gates
- unclear scope / source of truth
- batch count reaches `BATCH_AUDIT_EVERY`
- Layer-C risk trigger (see AGENTS.md "Autonomy policy")
- native dependency / ABI mismatch
- a renderer/app UI path touched without a concrete `Design artifact:`
- product/workflow scope mixing in one WI
- more than one active branch/PR would be needed

## Report format

Report:

- chosen WI and why it was selected
- branch
- commit hash
- files changed
- validation results
- batch count (`git rev-list --count "$(cat dev-memo/run/last-batch-audit)..HEAD"`)
- PR link, or PR title + body (when `gh` is unavailable)
- risks / deferred issues

## Post-merge cleanup phase

After the human merges a PR, Claude may perform cleanup automatically:

1. Switch to `main`.
2. Pull `origin/main` with `--ff-only`.
3. Delete the merged local feature branch.
4. Delete the corresponding remote feature branch.
5. Run `git fetch --prune`.
6. Record the new `HEAD` into `dev-memo/run/last-batch-audit`.
7. Verify:

   * working tree clean
   * current branch is `main`
   * `HEAD == origin/main`
   * `dev-memo/run/last-batch-audit == HEAD`
   * `dev-memo/run/last-batch-audit` remains ignored local run-state
   * no stale remote feature branch remains

Hard-stop if:

* pull is not fast-forward
* branch deletion fails for an unexpected reason
* remote branch deletion fails for an unexpected reason
* working tree is dirty after cleanup
* `HEAD != origin/main`
* `last-batch-audit != HEAD`

**Constraint on step 6 (by design).** The run-control write-guards
(`block-run-control-bash-write.sh` for Bash, `protect-run-control.sh` for Write/Edit) deny
**agent** writes to `dev-memo/run/last-batch-audit` — that is deliberate: the agent must not be
able to move its own batch-audit breaker baseline. So step 6 is performed by a **deliberate
human action**, not by Claude:

```
! printf '%s\n' "$(git rev-parse HEAD)" > dev-memo/run/last-batch-audit
```

Claude performs steps 1–5, surfaces the exact step-6 command for the human, and reports the
step-7 verification with `last-batch-audit == HEAD` pending that human write (only that one item
is human-gated; everything else is automatic). Do not attempt to bypass the guard.

## Future merge-delegate mode

**Disabled by default.** Claude may merge PRs only after an explicit human opt-in and only
through GitHub PR merge tooling, not by pushing directly to `main`.

Prerequisites before enabling:

* `gh` installed and authenticated, or another auditable GitHub PR merge mechanism available.
* Claude can verify PR state/checks before merge.
* Claude can verify the PR head commit equals the commit it pushed.
* Claude can verify no failing checks.
* Claude can verify UI PRs include a concrete standalone `Design artifact:` line.
* Claude can stop instead of merging on any ambiguity.

Explicitly forbidden:

* Do not merge by `git push origin main`.
* Do not bypass PR checks.
* Do not merge red checks.
* Do not merge if the PR changed since Claude's last validation.
* Do not merge if multiple active PRs/branches create ambiguity.

Until a human explicitly enables this mode, Claude always stops before merge and hands the merge
to the human.

## Relationship to other autonomy surfaces

- `AGENTS.md` "Autonomy policy" / `.claude/rules/autonomy.md` — the global hard-stop list and
  batch policy. This protocol is a SUBSET of what is globally permitted; nothing here overrides
  a global hard stop. Push/PR are permitted here only because the human invoked this protocol.
- `.claude/skills/project-autopilot/` — the queue-driven multi-WI loop. Use that when there is a
  governed `queue.md`. This protocol is for "pick one next bounded WI from repo signals" when
  there is no queued WI.
- `.claude/commands/continue-project.md` — picks the next unblocked WI from active plan docs.
- The UI design-artifact gate (`scripts/workflow/check-queue.sh` for queued UI WIs;
  `scripts/workflow/check-ui-design-artifact.sh` at PR time) — a renderer/UI change here MUST
  carry a `Design artifact:` reference.
