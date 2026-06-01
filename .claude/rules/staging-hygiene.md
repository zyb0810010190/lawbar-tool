---
description: Explicit git staging only; classify include/exclude; show cached diff before commit
applies-to: "**"
---

# Staging Hygiene

Dangerous-mode execution removes the permission prompt safety net. Staging must be explicit and auditable.

## Hard rules

- **Never** `git add .` or `git add -A` or `git add -u` without per-path review.
- **Never** stage any of the following:
  - `.cc-suite/**` — plugin cache/state.
  - `.claude/settings.json` — local-machine plugin enablement / personal config. **Carve-out:** may be staged ONLY by a SCAFFOLD/WORKFLOW WI whose cached diff is confined to project-enforcement wiring (the `hooks` and `permissions` keys). Never stage it for plugin-enablement, theme, model, or other personal toggles. See §"settings.json enforcement carve-out".
  - `.claude/settings.local.json` — local-machine personal config (no carve-out; never staged).
  - `.claude/tdd-guardian/**` — tdd-guardian local state.
  - `.claude-english-buddy.json` — local english-buddy config.
  - `.env`, `.env.*` (except `.env.example`).
  - `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`.
  - Unrelated dev-memo clutter from prior unrelated sessions.
- **Always** use `git add <explicit-path>...` listing each file.
- **Always** show `git diff --cached --name-only` before committing — confirm only intended files are staged.
- **Never** `git push` autonomously. Push is on the hard-stop list ([[autonomy]]).

## settings.json enforcement carve-out

`.claude/settings.json` is git-tracked because it carries the project's **enforcement wiring**
— the PreToolUse `hooks` array (`block-git-add-all.sh`, `block-commit-stage-all.sh`,
`batch-commit-guard.sh`, `protect-run-control.sh`, `block-run-control-bash-write.sh`) and any
`permissions` deny/allow rules. The same file also holds local-machine state (plugin
enablement, theme, model). The original blanket "never stage settings.json" was **overbroad**:
it would have left the scaffold's own hook wiring uncommittable, so a new enforcement hook
could never become part of the tracked, reproducible scaffold.

Reconciled posture (authorized by the user on 2026-05-31, during WI-SCAFFOLD-002, superseding
the prior blanket rule):

- `settings.json` **may** be staged **only** by a SCAFFOLD or WORKFLOW WI, and **only** when the
  cached diff is confined to the `hooks` / `permissions` enforcement keys.
- Before staging it, run `git diff --cached .claude/settings.json` and confirm **no**
  plugin-enablement, theme, model, or other personal key changed. If a personal key is in the
  diff, unstage and split it out — never let a personal toggle ride a scaffold commit.
- All other staging-hygiene rules still apply (explicit paths, cached-diff review, no push).
- `.claude/settings.local.json` keeps the blanket ban — it is personal-only, never tracked.

This carve-out narrows, never weakens: the file is stageable for a strictly-bounded enforcement
diff, and remains forbidden for everything else.

## Pre-commit checklist

1. `git status --short` — observe untracked + modified set.
2. Classify each entry: **include** (part of the current WI), **exclude** (local clutter / unrelated / ignored leak).
3. `git add <paths>` — explicit list.
4. `git diff --cached --name-only` — verify the staged set matches the classification.
5. `git diff --cached --stat` — sanity-check magnitude.
6. Commit with a focused message describing the WI scope.

## Repair rules

- If an excluded file slipped into the index: `git restore --staged <path>` before commit.
- If a commit accidentally included excluded files: do **not** force-push to fix. Create a follow-up commit removing them and notify the user.
- If a local-only file keeps reappearing: add to `.gitignore`, do not commit-then-delete.

## Uncommitted rollback (active-WI scope only)

Per `dev-memo/rollback-00.md` §2 — when Claude needs to discard ACTIVE-WI changes before commit, the operation is targeted, transparent, and never broad. Fix-forward is the default (`dev-memo/rollback-00.md` §1); uncommitted rollback is a recovery step, not a routine path.

**Allowed (active-WI scope only)**:

- `git restore <path>` — single file, full path enumerated.
- `git checkout -- <path>` — single file, full path enumerated.
- `git restore --staged <path>` — unstage a slipped file (already covered above).

**Forbidden**:

- `git restore .` / `git checkout -- .` — broad working-tree restore.
- `git reset --hard <ref>` — silently rewrites history + working tree (see [[autonomy]] hard-stop list).
- `git clean -fd` / any `git clean` flag combination — deletes untracked files (forbidden under all flags).
- Restoring files that were NOT touched by the active WI (the active WI's file list is the only legal restore scope).
- Restoring untracked files the user has not acknowledged (e.g., a half-drafted plan, a fixture in progress).

**Pre-restore checklist**:

1. Print the exact `git restore <path>` line(s) Claude is about to run, one per file.
2. Confirm each path is in the active WI's authored or modified file list.
3. Confirm no path is an untracked user draft.
4. Run the restore commands ONE AT A TIME, not as a glob.
5. Re-run `git status --short` after to verify only the intended files were restored.

## Committed rollback — `git revert`, never `git reset`

When a commit needs to be rolled back, the only legal mechanism is `git revert <hash>`. `git reset --hard` is forbidden ([[autonomy]] hard-stop list). See `dev-memo/rollback-00.md` §3 for rationale + §6 for the 7-field rollback recording required when reverting a cc-suite-recorded high-risk WI.

During overnight / `/loop` / `/project-autopilot` runs, Claude MUST NOT auto-revert committed work. The autopilot loop stops with `STOP-FOR-ROLLBACK` and emits the report block per [[../skills/project-autopilot/SKILL]] §"Stop output". See `dev-memo/rollback-00.md` §4 for the 7-field stop-and-report.

Related: [[autonomy]], [[security-boundary]], [[cc-suite]], [[execution-discipline]], `dev-memo/rollback-00.md`, `dev-memo/night-run-00.md`.
