#!/bin/bash
# check-marker-guard.test.sh — tests for the fail-closed A0.7 marker tamper/fabrication guard
# (WI-ENA10). Each case exercises the guard WITHOUT committing a real marker file to the repo:
# --paths uses synthetic path strings (no disk), and --scan cases build a throwaway temp
# CLAUDE_PROJECT_DIR. Run: bash scripts/workflow/check-marker-guard.test.sh   (exit 0 = all pass)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; GUARD="$HERE/check-marker-guard.sh"
pass=0; fail=0; failed=""

# expect_rc <want-rc> <label> <args...>
expect_rc() {
  local want="$1" label="$2"; shift 2
  local rc; bash "$GUARD" "$@" >/dev/null 2>&1 && rc=0 || rc=$?
  if [ "$rc" = "$want" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [want rc=$want got rc=$rc] $label"; fi
}

# --- --paths mode (synthetic strings; no disk) ---
# A fabricated marker-looking file under the namespace is rejected (fail-closed).
expect_rc 2 "fabricated marker rejected"            --paths "dev-memo/run/evidence/a07/abc123.marker.json"
# A copied marker-looking file is rejected.
expect_rc 2 "copied marker rejected"                --paths "dev-memo/run/evidence/a07/copy-of-real.marker.json"
# A schema-looking marker without provenance is rejected.
expect_rc 2 "schema-only marker rejected"           --paths "dev-memo/run/evidence/a07/schema-only.json"
# Any nested path under the namespace is rejected.
expect_rc 2 "nested namespace path rejected"        --paths "dev-memo/run/evidence/whatever/deep/x"
# A non-marker path passes.
expect_rc 0 "non-marker path passes"                --paths "native/evidence-core-swift/Sources/x.swift"
# Mixed: one marker-namespace path among others still fails.
expect_rc 2 "mixed set with one marker fails"       --paths "src/a.ts" "dev-memo/run/evidence/a07/m.json" "docs/x.md"
# Empty/no marker paths pass.
expect_rc 0 "no marker paths passes"                --paths "dev-memo/run/queue.md" "docs/adr/x.md"
# Canonicalization (anti-evasion): non-canonical marker paths must still be rejected.
expect_rc 2 "leading ./ does not evade"             --paths "./dev-memo/run/evidence/a07/m.json"
expect_rc 2 "duplicate slashes do not evade"        --paths "dev-memo//run/evidence//a07/m.json"
expect_rc 2 "leading ./ + dup slash combined"       --paths "./dev-memo//run//evidence/m.json"
expect_rc 2 "dotdot segment does not evade"         --paths "dev-memo/run/../run/evidence/a07/m.json"
expect_rc 2 "absolute repo path does not evade"     --paths "$(cd "$HERE/../.." && pwd)/dev-memo/run/evidence/a07/m.json"
# A path that merely contains the namespace as a non-prefix substring is NOT a violation.
expect_rc 0 "namespace as substring not matched"    --paths "docs/dev-memo/run/evidence-notes.md"
expect_rc 0 "sibling evidence-notes not matched"    --paths "dev-memo/run/evidence-notes.md"

# --- --scan mode (throwaway temp project dir; guard must not create the namespace) ---
scan_case() {
  local want="$1" label="$2" kind="$3"   # kind: none | file | symlink
  local T; T=$(mktemp -d) || { fail=$((fail+1)); failed="$failed\n  [setup mktemp failed] $label"; return; }
  if ! { ( cd "$T" && git init -q && git config user.email t@t && git config user.name t ) \
        && mkdir -p "$T/dev-memo/run" && printf 'x\n' > "$T/dev-memo/run/queue.md"; }; then
    fail=$((fail+1)); failed="$failed\n  [setup failed] $label"; rm -rf "$T"; return
  fi
  ( cd "$T" && git add -A >/dev/null 2>&1 && git commit -qm seed >/dev/null 2>&1 )
  case "$kind" in
    file)    mkdir -p "$T/dev-memo/run/evidence/a07"; printf '{"fabricated":true}\n' > "$T/dev-memo/run/evidence/a07/x.marker.json" ;;
    symlink) mkdir -p "$T/dev-memo/run/evidence/a07"; ln -s /tmp/whatever "$T/dev-memo/run/evidence/a07/link.marker.json" ;;
  esac
  local rc; CLAUDE_PROJECT_DIR="$T" bash "$GUARD" --scan >/dev/null 2>&1 && rc=0 || rc=$?
  # Guard must never CREATE the namespace during a clean scan.
  local created=no; [ -e "$T/dev-memo/run/evidence" ] && created=yes
  if [ "$rc" = "$want" ] && { [ "$kind" != "none" ] || [ "$created" = "no" ]; }; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); failed="$failed\n  [want rc=$want got rc=$rc; nsCreated=$created] $label"
  fi
  rm -rf "$T"
}
scan_case 0 "clean tree (no namespace) passes + guard does not create namespace" none
scan_case 2 "tree with a fabricated marker file fails"                            file
scan_case 2 "tree with a fabricated marker SYMLINK fails"                         symlink

if [ "$fail" -eq 0 ]; then
  echo "check-marker-guard.test.sh: ALL $pass PASS"
  exit 0
else
  echo "check-marker-guard.test.sh: $fail FAIL / $pass PASS"; printf '%b\n' "$failed"
  exit 1
fi
