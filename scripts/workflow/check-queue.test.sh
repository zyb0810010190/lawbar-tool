#!/bin/bash
# check-queue.test.sh — tests for check-queue.sh, focused on the UI design-artifact gate
# (WI: require design artifact for UI WIs). Builds a temp CLAUDE_PROJECT_DIR per case.
# Run: bash scripts/workflow/check-queue.test.sh   (exit 0 = all pass)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; CHECK="$HERE/check-queue.sh"
pass=0; fail=0; failed=""

# run_queue <queue-content> -> echoes PASS|FAIL (check-queue.sh exit 0 = PASS)
run_queue() {
  local T; T=$(mktemp -d)
  mkdir -p "$T/dev-memo/run"
  printf '%s\n' "$1" > "$T/dev-memo/run/queue.md"
  : > "$T/dev-memo/run/forbidden-paths.txt"
  local rc; CLAUDE_PROJECT_DIR="$T" bash "$CHECK" >/dev/null 2>&1 && rc=PASS || rc=FAIL
  rm -rf "$T"; printf '%s' "$rc"
}
expect() { local want="$1" label="$2" content="$3" got; got=$(run_queue "$content"); if [ "$got" = "$want" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [want $want got $got] $label"; fi; }

NONUI='## WI-001: add inline email validation
Type: IMPL
Scope: validate email format before submit
Source of truth: specs/signup.md
Allowed files: src/signup.js
Forbidden files: none
Gates: npm test
Acceptance criteria: invalid emails show an inline error and block submit
Risk flags: none
Depends on: none
Commit boundary: one local commit'

UI_WITH='## WI-010: matter-list empty state
Type: UI
Scope: render an empty-state card when no matters exist
Source of truth: dev-memo/ui-baseline.md
Design artifact: dev-memo/design/2026-06-01-empty-state.md (Claude Design export)
Allowed files: apps/lawbar-desktop/renderer/screens/listMatters.ts
Forbidden files: none
Gates: npm --prefix apps/lawbar-desktop run test:ui-list-matters
Acceptance criteria: the empty-state card renders when the list is empty
Risk flags: none
Depends on: none
Commit boundary: one local commit'

# UI block WITHOUT the Design artifact field
UI_WITHOUT=$(printf '%s\n' "$UI_WITH" | grep -v '^Design artifact:')
# UI block WITH a placeholder Design artifact
UI_TBD=$(printf '%s\n' "$UI_WITH" | sed 's#^Design artifact:.*#Design artifact: TBD#')

expect PASS "non-UI WI lints as before"                 "$NONUI"
expect PASS "UI WI WITH a concrete Design artifact"     "$UI_WITH"
expect FAIL "UI WI WITHOUT a Design artifact"           "$UI_WITHOUT"
expect FAIL "UI WI with placeholder Design artifact"    "$UI_TBD"
# mixed queue: one good non-UI + one UI missing design -> whole lint FAILs
expect FAIL "mixed queue, UI missing design fails all"  "$NONUI

$UI_WITHOUT"
# UI is now a valid Type (was rejected as 'invalid Type' before this WI)
expect PASS "Type UI is accepted (with design)"         "$UI_WITH"

printf 'check-queue: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
