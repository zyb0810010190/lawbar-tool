#!/bin/bash
# block-commit-stage-all.test.sh — detection spec for block-commit-stage-all.sh (WI-SCAFFOLD-006).
# Proves the guard catches `git commit -a/--all/-am…` across path-prefixed git, wrappers, and git
# global options, while ignoring -a inside a quoted message. No git repo needed (pure parse).
# Run: bash .claude/hooks/tests/block-commit-stage-all.test.sh   (exit 0 = all pass)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; HOOK="$HERE/../block-commit-stage-all.sh"
pass=0; fail=0; failed=""
decide() {
  local out; out=$(printf '%s' "$1" | python3 -c "import json,sys;print(json.dumps({'tool_input':{'command':sys.stdin.read()}}))" | bash "$HOOK" 2>/dev/null)
  case "$out" in *'"permissionDecision":"deny"'*) printf DENY ;; *) printf ALLOW ;; esac
}
expect() { local want="$1" cmd="$2" got; got=$(decide "$cmd"); if [ "$got" = "$want" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [want $want got $got] :: $cmd"; fi; }

# --- DENY: implicit stage-all in every recognised git form ---
expect DENY "git commit -a"
expect DENY "git commit --all"
expect DENY "git commit -am x"
expect DENY "git commit -va"
expect DENY "git commit -aF file"
# path-prefixed / wrappers / global options (the WI-SCAFFOLD-006 gap)
expect DENY "/usr/bin/git commit -am x"
expect DENY "./git commit -a"
expect DENY '\git commit -a'
expect DENY "git -c x=y commit -am x"
expect DENY "git -C dir commit -a"
expect DENY "git --no-pager commit -a"
expect DENY "command git commit -a"
expect DENY "env FOO=b git commit -a"
expect DENY "time git commit -am x"
expect DENY "git commit -m x && git commit -a"

# --- ALLOW: explicit-path commits, -a inside message, -m value 'a', non-commit, unrelated ---
expect ALLOW "git commit -m msg"
expect ALLOW 'git commit -m "fix -a bug then commit"'
expect ALLOW "git commit -F /tmp/msg"
expect ALLOW "git commit -ma x"
expect ALLOW "git commit"
expect ALLOW "git commit -v"
expect ALLOW "git status"
expect ALLOW "git add ."
expect ALLOW 'echo "git commit --all"'
expect ALLOW "echo git commit -a"
expect ALLOW "ls -la"

printf 'block-commit-stage-all: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
