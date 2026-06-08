#!/bin/bash
# check-contract-integrity.sh — standalone integrity checker for always-loaded CONTRACT DOCS
# (WI-CI1, BATCH-WORKFLOW-CONTRACT-INTEGRITY-GUARD-00).
#
# Greps the contract docs for v1 markdown-autofix corruption markers and exits nonzero if any are
# present. This is the COMPLEMENTARY layer to the PreToolUse guard .claude/hooks/block-contract-
# corruption.sh: it is independent of git-command parsing, so it catches corruption regardless of how
# it would be committed (run it as a pre-push / CI gate). It NEVER mutates files.
#
# Contract docs: AGENTS.md, CLAUDE.md, GEMINI.md, .claude/rules/*.md.
# v1 markers: numeric HTML entity &#x..; , literal **** , prose backslash-escaped underscore \_ .
#
# Usage:
#   scripts/workflow/check-contract-integrity.sh                 # check this repo's contract docs
#   scripts/workflow/check-contract-integrity.sh <file>...       # check explicit files (e.g. a temp copy)
# Exit 0 = clean; exit 1 = corruption marker(s) found (listed); exit 2 = usage/IO error.

set -u

ENTITY='&#x[0-9A-Fa-f]+;'
QUAD='\*\*\*\*'
ESC_US='\\_'

scan_file() {
  # $1 = path; prints "<path>: <marker>" lines for each marker present; returns 0 if any found.
  local f=$1 found=1
  [ -r "$f" ] || { echo "check-contract-integrity: cannot read $f" >&2; return 2; }
  if LC_ALL=C grep -nE "$ENTITY" -- "$f" >/dev/null 2>&1; then
    echo "$f: numeric HTML character entity (&#x..;)"; found=0
  fi
  if LC_ALL=C grep -nF '****' -- "$f" >/dev/null 2>&1; then
    echo "$f: stray quad-asterisk (****)"; found=0
  fi
  if LC_ALL=C grep -nE "$ESC_US" -- "$f" >/dev/null 2>&1; then
    echo "$f: backslash-escaped underscore (\\_)"; found=0
  fi
  return $found
}

# Build the target file list.
files=()
if [ "$#" -gt 0 ]; then
  files=("$@")
else
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root=.
  cd "$repo_root" || { echo "check-contract-integrity: cannot cd to repo root" >&2; exit 2; }
  for f in AGENTS.md CLAUDE.md GEMINI.md; do
    [ -e "$f" ] && files+=("$f")
  done
  if [ -d .claude/rules ]; then
    while IFS= read -r -d '' f; do files+=("$f"); done \
      < <(find .claude/rules -maxdepth 1 -type f -name '*.md' -print0 2>/dev/null)
  fi
fi

if [ "${#files[@]}" -eq 0 ]; then
  echo "check-contract-integrity: no contract docs found to check" >&2
  exit 0
fi

rc=0
io=0
for f in "${files[@]}"; do
  scan_file "$f"
  s=$?
  if [ "$s" -eq 0 ]; then rc=1; elif [ "$s" -eq 2 ]; then io=2; fi
done

if [ "$io" -eq 2 ] && [ "$rc" -eq 0 ]; then
  exit 2
fi
if [ "$rc" -ne 0 ]; then
  echo "check-contract-integrity: FAIL — corruption marker(s) found above. Restore the file(s) from a clean version." >&2
  exit 1
fi
echo "check-contract-integrity: PASS — ${#files[@]} contract doc(s) clean."
exit 0
