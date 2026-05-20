---
description: Report branch / HEAD / working-tree state and classify dirty entries; decide whether next WI is safe to start
allowed-tools:
  - Bash
  - Read
---

# /branch-clean

Read-only diagnostic. Never mutates state. Used before starting a new WI or as the first step of [[../skills/project-autopilot]].

## Steps

1. Capture identity:
   ```
   git rev-parse --show-toplevel
   git branch --show-current
   git rev-parse --short HEAD
   git log --oneline --decorate -5
   ```
2. Capture working-tree state:
   ```
   git status --short
   git status --branch --short --porcelain=2 | head -40
   ```
3. Classify every entry under `git status --short` into:
   - **WI-relevant** — clearly belongs to in-progress WI work.
   - **Local clutter / ignored leak** — `.cc-suite/**`, `.claude/settings*.json`, `.claude-english-buddy.json`, `.claude/tdd-guardian/**`, IDE turds, OS files.
   - **Unrelated stale work** — files from prior unrelated sessions still uncommitted.
   - **Unknown** — needs a `Read` to decide.
4. Confirm none of the staged or modified paths violate [[../rules/staging-hygiene]] exclude list.
5. Decide:
   - **SAFE** — working tree clean OR only WI-relevant changes for the current WI present.
   - **DIRTY-RECOVERABLE** — clutter / ignored leaks present; quarantine via `.gitignore` update or `git restore` before next WI.
   - **DIRTY-BLOCKING** — unrelated stale work present; surface to user before continuing.
6. Output a short report:
   - Branch + HEAD.
   - Counts per classification.
   - Decision (`SAFE` / `DIRTY-RECOVERABLE` / `DIRTY-BLOCKING`).
   - Recommended next step.

## Non-goals

- Do **not** run `git clean`, `git restore`, `git checkout --`, `git reset`, or any branch mutation here. Report only.
- Do **not** stage or commit.

Related: [[commit-gate]], [[continue-project]].
