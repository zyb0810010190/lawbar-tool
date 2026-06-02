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
