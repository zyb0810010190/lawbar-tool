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
  - `.claude/settings.json` — local-machine plugin enablement.
  - `.claude/settings.local.json` — local-machine personal config.
  - `.claude/tdd-guardian/**` — tdd-guardian local state.
  - `.claude-english-buddy.json` — local english-buddy config.
  - `.env`, `.env.*` (except `.env.example`).
  - `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`.
  - Unrelated dev-memo clutter from prior unrelated sessions.
- **Always** use `git add <explicit-path>...` listing each file.
- **Always** show `git diff --cached --name-only` before committing — confirm only intended files are staged.
- **Never** `git push` autonomously. Push is on the hard-stop list ([[autonomy]]).

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

Related: [[autonomy]], [[security-boundary]].
