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

## Default merge-delegate mode

**Enabled by default for low-risk, non-UI PRs** (validated in practice by the merge-delegate
canary runs — PR #16 detector-pattern-doc scanner exemption and PR #17 provenance supersession).
Claude may auto-merge the PR for the WI it just executed **only when ALL of these hold**:

1. `gh auth status` succeeds.
2. Local tree is clean.
3. PR is open, not draft, base is `main`.
4. PR head branch and head commit match the branch/commit Claude pushed.
5. `gh pr checks <PR> --watch --fail-fast` passes.
6. `gh pr view <PR> --json mergeable,mergeStateStatus` reports clean/mergeable — re-query if a
   transient `UNSTABLE` appears mid-check; require `CLEAN` once checks settle.
7. Changed files match the chosen WI scope.
8. No manual-merge category (below) is triggered.
9. Merge is done ONLY through GitHub PR tooling: `gh pr merge <PR> --merge --delete-branch`.
10. Claude never pushes directly to `main`.

If any condition cannot be verified, Claude stops before merge and reports. After an auto-merge,
run the **Post-merge cleanup phase** above (the breaker-baseline write stays human-gated).

Forbidden in all modes: merging via `git push origin main`; bypassing or merging red / skipped /
flaky / ambiguous checks; merging if the PR changed since Claude's last validation.

## Manual-merge categories

Claude MUST stop before merge and report to the human if the PR touches or involves:

* renderer/app UI paths, visual copy, layout, interaction, design artifacts, or user-facing UI behavior;
* security, confidentiality, encryption, authentication, authorization, or data-retention logic;
* migrations, destructive persistence changes, schema rewrites, or data-loss risk;
* dependency upgrades, native-module/ABI changes, Electron packaging changes, or build-system changes with runtime impact;
* workflow-gate weakening, bypasses, ignore rules, or scanner exemptions — UNLESS the human explicitly enabled merge-delegate for that specific PR;
* failed, skipped, flaky, cancelled, missing, or ambiguous checks;
* multiple active PRs/branches, or unclear branch/PR identity;
* unclear source of truth or scope expansion.

## UI rule

UI PRs are **never auto-merged by default.** For a UI PR Claude may still create the design
artifact, edit, validate, commit, push, open the PR, verify the PR body carries a standalone
concrete `Design artifact:` line, and report the PR is ready — but Claude **stops before merge**
and hands the merge to the human.

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
