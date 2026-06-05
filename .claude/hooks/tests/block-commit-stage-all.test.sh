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

# --- PRC-4-FU2: emit_deny() must emit VALID JSON for control chars / quotes / backslashes ---
# Extract emit_deny() in isolation (depends only on $1, jq, sed, tr, printf) and assert the output
# parses as JSON with permissionDecision=deny — for both the jq-present and jq-fallback branches.
EMITDENY_DEF=$(sed -n '/^emit_deny() {/,/^}/p' "$HOOK")
fu_valid() { printf '%s' "$1" | python3 -c "import json,sys
try:
  d=json.load(sys.stdin); print('OK' if d.get('hookSpecificOutput',{}).get('permissionDecision')=='deny' else 'BAD')
except Exception: print('BAD')" 2>/dev/null; }
fu_check() { # fu_check <label> <reason> [path]
  local label=$1 reason=$2 pth=${3:-$PATH} out got
  out=$(PATH="$pth" bash -c "$EMITDENY_DEF"$'\n''emit_deny "$1"' _ "$reason" 2>/dev/null)
  got=$(fu_valid "$out")
  if [ "$got" = "OK" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [PRC-4-FU2 invalid emit_deny JSON] $label :: $(printf '%s' "$out" | head -c 120)"; fi
}
# Red-before evidence: the OLD sed-only body emits INVALID JSON on a newline reason.
OLD_DEF='emit_deny() { esc=$(printf '"'"'%s'"'"' "$1" | sed '"'"'s/\\/\\\\/g; s/"/\\"/g'"'"'); printf '"'"'{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n'"'"' "$esc"; }'
old_out=$(bash -c "$OLD_DEF"$'\n''emit_deny "$1"' _ "$(printf 'a\nb')" 2>/dev/null)
if [ "$(fu_valid "$old_out")" = "BAD" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [PRC-4-FU2 red-before expected OLD body to emit INVALID JSON] got: $old_out"; fi
FU_NL=$(printf 'reason with\nnewline');   FU_TAB=$(printf 'reason\twith tab')
FU_CR=$(printf 'reason\rwith cr');        FU_QB='reason with "quote" and \backslash'
FU_MIX=$(printf 'mix\n\t"q"\\b\rend');     FU_NORMAL='plain ascii reason'
stub_ok=0; FU_STUB=""
if FU_STUB=$(mktemp -d) && printf '#!/bin/sh\nexit 1\n' > "$FU_STUB/jq" && chmod +x "$FU_STUB/jq"; then
  # The stub is effective ONLY if, under the stub PATH, `jq` (a) RESOLVES to our stub and (b) exits
  # nonzero. stub_ok defaults to 0, so any earlier write/chmod failure (which skips this block) or a
  # failed identity/probe leaves it 0 — closing the verify hole where a half-built stub still ran the
  # "jq-fallback" cases against the REAL jq while reporting ALL PASS.
  if [ "$(PATH="$FU_STUB:$PATH" command -v jq)" = "$FU_STUB/jq" ] \
     && ! PATH="$FU_STUB:$PATH" jq -Rs . </dev/null >/dev/null 2>&1; then
    stub_ok=1
  fi
fi
# The jq-fallback variant is only meaningful if the stub is effective; otherwise register a failure
# and run only jq-present rather than pretend the fallback was exercised.
if [ "$stub_ok" -eq 1 ]; then
  fu_variants=("jq-present:$PATH" "jq-fallback:$FU_STUB:$PATH")
else
  fail=$((fail+1)); failed="$failed\n  [PRC-4-FU2 jq stub ineffective — jq-fallback branch NOT exercised; check mktemp/write/chmod]"
  fu_variants=("jq-present:$PATH")
fi
for variant in "${fu_variants[@]}"; do
  vlabel=${variant%%:*}; vpath=${variant#*:}
  fu_check "emit_deny $vlabel newline"  "$FU_NL"     "$vpath"
  fu_check "emit_deny $vlabel tab"      "$FU_TAB"    "$vpath"
  fu_check "emit_deny $vlabel CR"       "$FU_CR"     "$vpath"
  fu_check "emit_deny $vlabel quote+bs" "$FU_QB"     "$vpath"
  fu_check "emit_deny $vlabel mixed"    "$FU_MIX"    "$vpath"
  fu_check "emit_deny $vlabel normal"   "$FU_NORMAL" "$vpath"
done
[ -n "$FU_STUB" ] && rm -rf "$FU_STUB"

printf 'block-commit-stage-all: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
