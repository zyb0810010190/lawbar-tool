#!/bin/bash
# check-baseline.sh — verify the repo is in a clean, known state before starting a WI.
# Stops on a dirty tree or detached HEAD. Customize the "wrong branch" check per project.
set -u
cd "${CLAUDE_PROJECT_DIR:-.}" || { echo "BASELINE FAIL: cannot cd to project"; exit 1; }

# 1. Inside a git repo?
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "BASELINE FAIL: not a git repo"; exit 1; }

# 2. Clean working tree (no uncommitted changes) — a WI must start from a known state.
if [ -n "$(git status --porcelain)" ]; then
  echo "BASELINE FAIL: working tree is dirty. Commit, stash, or clean before starting a WI:"
  git status --short
  exit 1
fi

# 3. Not in detached HEAD (so commits land on a branch).
git symbolic-ref -q HEAD >/dev/null || { echo "BASELINE FAIL: detached HEAD; checkout a branch first"; exit 1; }

echo "BASELINE OK: clean tree on $(git branch --show-current)"
exit 0
