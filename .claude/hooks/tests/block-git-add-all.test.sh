#!/bin/bash
# block-git-add-all.test.sh — detection spec for block-git-add-all.sh (WI-SCAFFOLD-006).
# Proves the staging guard catches broad `git add` across path-prefixed git, wrappers, and git
# global options — not just the literal `git add` prefix. No git repo needed (pure parse).
# Run: bash .claude/hooks/tests/block-git-add-all.test.sh   (exit 0 = all pass)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; HOOK="$HERE/../block-git-add-all.sh"
pass=0; fail=0; failed=""
decide() {
  local out; out=$(printf '%s' "$1" | python3 -c "import json,sys;print(json.dumps({'tool_input':{'command':sys.stdin.read()}}))" | bash "$HOOK" 2>/dev/null)
  case "$out" in *'"permissionDecision":"deny"'*) printf DENY ;; *) printf ALLOW ;; esac
}
expect() { local want="$1" cmd="$2" got; got=$(decide "$cmd"); if [ "$got" = "$want" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [want $want got $got] :: $cmd"; fi; }

# --- DENY: broad pathspecs in every recognised git form ---
expect DENY "git add -A"
expect DENY "git add --all"
expect DENY "git add -u"
expect DENY "git add --update"
expect DENY "git add ."
expect DENY "git add ./"
expect DENY "git add :/"
expect DENY "git add *"
expect DENY 'git add "*"'
expect DENY 'git add "."'
# path-prefixed / wrappers / global options (the WI-SCAFFOLD-006 gap)
expect DENY "/usr/bin/git add -A"
expect DENY "./git add ."
expect DENY '\git add .'
expect DENY "git -c x=y add ."
expect DENY "git -C dir add -A"
expect DENY "git --no-pager add -A"
expect DENY "command git add ."
expect DENY "env FOO=b git add -u"
expect DENY "time git add ."
expect DENY "git add foo && git add -A"

# --- ALLOW: explicit paths, non-add, mentions-in-args, unrelated ---
expect ALLOW "git add file.txt"
expect ALLOW "git add src/ lib/main.ts"
expect ALLOW "git add path/to/file"
expect ALLOW "git status"
expect ALLOW "git commit -m x"
expect ALLOW "git log --oneline"
expect ALLOW 'echo "git add -A"'
expect ALLOW "echo git add ."
expect ALLOW "ls -la"
expect ALLOW "npm run build"

printf 'block-git-add-all: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
