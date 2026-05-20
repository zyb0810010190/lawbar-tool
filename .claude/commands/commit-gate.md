---
description: Evidence-gated commit with explicit staging and cached-diff confirmation; never pushes
allowed-tools:
  - Bash
  - Read
---

# /commit-gate

One-shot commit flow. Pre-authorized by [[../rules/autonomy]] for routine bounded-WI commits. Must satisfy [[../rules/staging-hygiene]]. **Never pushes.**

## Required evidence

Before staging anything, the active WI must have:

1. **Tests run** — at least one relevant `npm --prefix <package> test` invocation in this session, with the result captured.
2. **Audit / verify** — `/audit-fix` or `/audit` + `/verify` on the changed scope when the change touches code (skippable for docs-only commits per WI).
3. **No security-boundary surface change** without sign-off per [[../rules/security-boundary]].
4. **No hard-stop trigger** per [[../rules/autonomy]].

If any required evidence is missing, **abort** and report what's missing instead of staging.

## Flow

1. `git status --short` — full untracked + modified set.
2. Classify per [[branch-clean]] step 3.
3. Build explicit include list. **Never** `git add .` / `-A` / `-u`.
4. `git add <path>...` — one path per arg or a tight glob; no broad wildcards.
5. `git diff --cached --name-only` — print and visually confirm the staged set matches the intended include list.
6. `git diff --cached --stat` — print magnitude for the record.
7. Compose commit message:
   - Subject ≤ 72 chars, imperative, `<type>: <subject>` (chore / feat / fix / refactor / docs / test).
   - Body bullets describe scope + reasoning, not file list.
   - Cite WI id when applicable (e.g. `WI-03d`, `WORKSPACE-00`).
8. `git commit -m "$(cat <<'EOF' ... EOF)"` — heredoc form for multi-line.
9. `git log --oneline --decorate -5` — confirm commit landed.
10. **Stop.** Do **not** push, do **not** open PR, do **not** create or move tags.

## Forbidden

- `git push` (any form, any remote).
- `--no-verify`, `--no-gpg-sign`.
- `--amend` on an already-pushed commit.
- Auto-staging by directory.
- Staging any path in the [[../rules/staging-hygiene]] exclude list.

Related: [[branch-clean]], [[continue-project]].
