Verified the current files against the prior audit scope.

Findings: none Critical/High/Medium.

Confirmed:
- `CURRENT_SCHEMA_VERSION` is `12`.
- `DDL_STATEMENTS_V12` contains exactly two nullable `ALTER TABLE case_box_links ADD COLUMN` statements:
  - `unlinked_at TEXT COLLATE BINARY`
  - `unlink_reason TEXT`
- `DDL_BY_VERSION` includes `[12, DDL_STATEMENTS_V12]`.
- Git diff for `schema.ts` shows V1-V11 DDL unchanged; only version bump, V12 addition, and map registration changed.
- `case_box_links.anchor_id` remains `TEXT NOT NULL`.
- Link status remains `CHECK (status IN ('valid', 'needs_review', 'broken'))`; no `unlinked`.
- No FK, cascade, marker index, or marker `CHECK` was added.
- `hardening-anchor-delete-guard.test.mjs` change is only the stale version-pin fix to `CURRENT_SCHEMA_VERSION`; no weakened invariant or added assertion.
- `git diff --name-only` is confined to the three requested tracked files.

Note: `git status --short` shows unrelated untracked files in the worktree, but the tracked diff under review is confined to the three specified files.

VERIFY-VERDICT: ALL CLOSED | OPEN: none
