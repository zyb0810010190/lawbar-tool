#!/bin/bash
# check-gates.sh — lawbar-tool quality gates. Exit non-zero on any failure.
set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" || exit 1

echo "== lawbar-tool gates =="
echo "Running desktop app test suite..."
npm --prefix apps/lawbar-desktop test || exit 1

echo "GATES OK"
exit 0
