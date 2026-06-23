#!/bin/bash
# check-gates.sh — lawbar-tool quality gates. Exit non-zero on any failure.
set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" || exit 1

echo "== lawbar-tool gates =="

# A0.7 marker tamper/fabrication guard (WI-ENA10): fail-closed over dev-memo/run/evidence/**.
# Until an authorized marker-writer/validator WI lands, ANY file in that namespace fails.
echo "Running A0.7 marker guard (scan + self-test)..."
bash "$ROOT/scripts/workflow/check-marker-guard.sh" --scan || exit 1
bash "$ROOT/scripts/workflow/check-marker-guard.test.sh" || exit 1
echo "Running A0.7 marker write/validate self-test..."
bash "$ROOT/scripts/workflow/a07-marker.test.sh" || exit 1

echo "Running desktop app test suite..."
npm --prefix apps/lawbar-desktop test || exit 1

echo "GATES OK"
exit 0
