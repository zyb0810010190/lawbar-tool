#!/bin/bash
# batch-commit-guard-base.test.sh — BASE-selection spec for batch-commit-guard.sh.
#
# Covers BATCH-COUNTER-001 (dev-memo/hook-audit-canary-01.md): the guard must derive the
# commit count from the NEWER of dev-memo/run/{batch-start,last-batch-audit}, so resetting
# batch-start forward after scaffold/hardening commits actually moves the window — instead of
# a stale last-batch-audit silently overriding it. Also checks the fail-open closure (an
# unresolvable ref must not yield COUNT=0).
#
# Builds a throwaway git repo C0..C4 (HEAD=C4) and drives the hook with a git-commit payload.
# Run: bash .claude/hooks/tests/batch-commit-guard-base.test.sh   (exit 0 = all pass)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../batch-commit-guard.sh"

T=$(mktemp -d 2>/dev/null || mktemp -d -t bcgtest)
trap 'rm -rf "$T"' EXIT

git -C "$T" init -q
git -C "$T" config user.email t@t >/dev/null
git -C "$T" config user.name  t   >/dev/null
declare -a C
for i in 0 1 2 3 4; do
  echo "$i" > "$T/f$i"; git -C "$T" add "f$i"; git -C "$T" commit -qm "C$i"
  C[$i]=$(git -C "$T" rev-parse HEAD)
done
# Counts from HEAD=C4:  C4..C4=0  C3..C4=1  C2..C4=2  C1..C4=3  C0..C4=4
mkdir -p "$T/dev-memo/run"
: > "$T/dev-memo/run/queue.governed"   # batch mode requires a governed queue

pass=0; fail=0; failed=""

# run <batch-start> <last-batch-audit> <max> <every>  -> echoes DENY|ALLOW
run() {
  printf 'AUTO_ADVANCE_MAX=%s\nBATCH_AUDIT_EVERY=%s\n' "$3" "$4" > "$T/dev-memo/run/config"
  rm -f "$T/dev-memo/run/batch-start" "$T/dev-memo/run/last-batch-audit"
  [ -n "$1" ] && printf '%s\n' "$1" > "$T/dev-memo/run/batch-start"
  [ -n "$2" ] && printf '%s\n' "$2" > "$T/dev-memo/run/last-batch-audit"
  local out
  out=$(printf '{"tool_input":{"command":"git commit -m x"}}' | CLAUDE_PROJECT_DIR="$T" bash "$HOOK" 2>/dev/null)
  case "$out" in *'"permissionDecision":"deny"'*) printf DENY ;; *) printf ALLOW ;; esac
}
expect() { # expect <want> <label> <bs> <lba> <max> <every>
  local want="$1" label="$2" got
  got=$(run "$3" "$4" "$5" "$6")
  if [ "$got" = "$want" ]; then pass=$((pass+1)); else
    fail=$((fail+1)); failed="$failed\n  [want $want got $got] $label (bs=$3 lba=$4 max=$5 every=$6)"
  fi
}

GARBAGE="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

# --- the BATCH-COUNTER-001 bug: stale last-batch-audit must NOT override a newer batch-start ---
# user's case: batch-start reset to C3 (newer), stale audit at C1. newer=C3 -> count 1 < 3 -> ALLOW.
# (old precedence used C1 -> count 3 -> DENY.)
expect ALLOW "newer batch-start wins over stale audit"      "${C[3]}" "${C[1]}" 10 3
expect ALLOW "newer batch-start (C2) over stale audit (C0)" "${C[2]}" "${C[0]}" 10 3
# prove it really uses C3 (count 1), not C1 (count 3): tighten every=2 -> still ALLOW iff base=C3
expect ALLOW "uses newer base not stale (every=2)"          "${C[3]}" "${C[1]}" 10 2

# --- audit checkpoint newer than batch-start: audit advances the window ---
expect ALLOW "newer audit (C3) over older batch-start (C1)" "${C[1]}" "${C[3]}" 10 2
# prove it uses C3 (count 1) not C1 (count 3): every=2 ALLOW; if it used C1 it would DENY.

# --- audit-due still fires correctly on the chosen base ---
expect DENY  "audit due: only last-batch-audit C1 count3>=3" ""        "${C[1]}" 10 3
expect DENY  "audit due: only batch-start C1 count3>=3"       "${C[1]}" ""        10 3
expect DENY  "audit due: both at C1, count3>=3"               "${C[1]}" "${C[1]}" 10 3
expect ALLOW "not due: both at C3, count1<3"                  "${C[3]}" "${C[3]}" 10 3
expect ALLOW "not due: window at HEAD C4, count0"            "${C[4]}" "${C[4]}" 10 3

# --- AUTO_ADVANCE_MAX breaker independent of audit ---
expect DENY  "max reached: C0 count4>=max3"                  "${C[0]}" ""        3  10

# --- invalid-ref handling (fail-open closure) ---
# garbage audit + NO batch-start -> no valid base -> DENY (old code: COUNT=0 -> ALLOW, fail-open).
expect DENY  "no valid base (garbage audit, no bs) -> deny"  ""        "$GARBAGE" 10 3
# garbage audit + valid batch-start C0 -> drop garbage, use C0 (count4) -> audit due DENY.
expect DENY  "garbage audit dropped, falls back to bs C0"    "${C[0]}" "$GARBAGE" 10 3
# garbage audit + valid bs C3 -> use C3 (count1) -> ALLOW.
expect ALLOW "garbage audit dropped, bs C3 count1<3"         "${C[3]}" "$GARBAGE" 10 3
# both missing -> deny.
expect DENY  "neither file -> deny"                          ""        ""         10 3

printf 'batch-commit-guard-base: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
