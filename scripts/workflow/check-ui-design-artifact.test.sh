#!/bin/bash
# check-ui-design-artifact.test.sh — tests for PR-time UI design artifact guard.
# Run: bash scripts/workflow/check-ui-design-artifact.test.sh

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/check-ui-design-artifact.sh"
pass=0
fail=0
failed=""

run_case() {
  local changed="$1"
  local body="$2"
  local T
  T=$(mktemp -d)
  printf '%s\n' "$changed" > "$T/changed.txt"
  local rc
  PR_BODY="$body" bash "$CHECK" --changed-files "$T/changed.txt" >/dev/null 2>&1 && rc=PASS || rc=FAIL
  rm -rf "$T"
  printf '%s' "$rc"
}

expect() {
  local want="$1"
  local label="$2"
  local changed="$3"
  local body="$4"
  local got
  got=$(run_case "$changed" "$body")
  if [ "$got" = "$want" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    failed="$failed\n  [want $want got $got] $label"
  fi
}

expect PASS "non-UI change does not require design artifact" \
  "dev-memo/run/README.md" \
  ""

expect PASS "renderer CSS change with concrete design artifact passes" \
  "apps/lawbar-desktop/renderer/index.css" \
  "Design artifact: dev-memo/design/2026-06-01-theme.md (Claude Design export)"

expect PASS "markdown bullet design artifact passes" \
  "apps/lawbar-desktop/renderer/index.css" \
  "- Design artifact: dev-memo/design/2026-06-01-theme.md"

expect FAIL "renderer CSS change without design artifact fails" \
  "apps/lawbar-desktop/renderer/index.css" \
  "Summary only"

expect FAIL "renderer CSS change with placeholder design artifact fails" \
  "apps/lawbar-desktop/renderer/index.css" \
  "Design artifact: TBD"

expect PASS "design-source CSS alone is not an app UI implementation change" \
  "dev-memo/design-source/editorial-tokens.css" \
  ""

printf 'check-ui-design-artifact: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then
  printf 'FAILED:%b\n' "$failed"
  exit 1
fi
echo "ALL PASS"
exit 0
