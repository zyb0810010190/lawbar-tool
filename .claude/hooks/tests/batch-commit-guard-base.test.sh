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

# --- WI-301 / BCG-7: fail-closed validation of malformed batch config ---
# All on a CLEAN window (bs=C4 -> count 0), so a VALID config ALLOWs and only the config validation
# distinguishes DENY vs ALLOW. Genuine red-before (pre-fix ALLOW): MAX=5, MAX=huge, EVERY=abc,
# EVERY=huge, EVERY=101. Already-deny-today (kept as regression): MAX=abc, EVERY=0.
expect DENY  "BCG-7 MAX out-of-set (5)"             "${C[4]}" "" 5 3
expect DENY  "BCG-7 MAX non-numeric (abc)"          "${C[4]}" "" abc 3
expect DENY  "BCG-7 MAX huge-digit"                 "${C[4]}" "" 99999999999999999999 3
expect DENY  "BCG-7 EVERY non-numeric (abc)"        "${C[4]}" "" 10 abc
expect DENY  "BCG-7 EVERY huge-digit (fail-open)"   "${C[4]}" "" 10 99999999999999999999
expect DENY  "BCG-7 EVERY zero"                     "${C[4]}" "" 10 0
expect DENY  "BCG-7 EVERY over-100 (101)"           "${C[4]}" "" 10 101
expect ALLOW "BCG-7 valid MAX=3 EVERY=3 clean"      "${C[4]}" "" 3 3
expect ALLOW "BCG-7 valid MAX=10 EVERY=100 clean"   "${C[4]}" "" 10 100
expect ALLOW "BCG-7 EVERY empty -> defaults to MAX" "${C[4]}" "" 10 ""
# Comment-stripping must be whitespace-separated only (audit Low): `VAR=3#junk` is a literal, not a
# comment -> fail-closed; `VAR=3 # note` IS an inline comment -> normalized to 3 -> valid.
expect DENY  "BCG-7 MAX=3#junk (no-ws # is literal)"   "${C[4]}" "" "3#junk" 3
expect DENY  "BCG-7 EVERY=3#junk (no-ws # is literal)" "${C[4]}" "" 10 "3#junk"
expect DENY  "BCG-7 EVERY=#junk (no-ws # is literal)"  "${C[4]}" "" 10 "#junk"
expect ALLOW "BCG-7 EVERY=3 # note (ws comment ok)"    "${C[4]}" "" 10 "3 # note"

# --- WI-302 / BCG-4 + BCG-5: atomic (consume-on-success) gated-token consumption ---
# Permission-forced failure simulates rm/append failure; skipped (not failed) under root (perms bypassed).
ROOT=0; [ "$(id -u 2>/dev/null)" = 0 ] && ROOT=1
RUNDIR="$T/dev-memo/run"
chk() { # chk <label> <expected> <got>
  if [ "$3" = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [$1 want '$2' got '$3']"; fi
}

# BCG-4: gated mode (MAX=1) human.ack — consume ONLY if removal succeeds.
ack_run() { # ack_run <lockdir:yes|no> -> "DENY|ALLOW ack=present|absent"
  printf 'AUTO_ADVANCE_MAX=1\nBATCH_AUDIT_EVERY=1\n' > "$RUNDIR/config"
  rm -f "$RUNDIR/batch-start" "$RUNDIR/last-batch-audit"
  : > "$RUNDIR/human.ack"
  [ "$1" = yes ] && chmod 0555 "$RUNDIR"
  local out; out=$(printf '{"tool_input":{"command":"git commit -m x"}}' | CLAUDE_PROJECT_DIR="$T" bash "$HOOK" 2>/dev/null)
  [ "$1" = yes ] && chmod 0755 "$RUNDIR"
  local d a; case "$out" in *'"permissionDecision":"deny"'*) d=DENY ;; *) d=ALLOW ;; esac
  [ -f "$RUNDIR/human.ack" ] && a=present || a=absent
  rm -f "$RUNDIR/human.ack" "$RUNDIR/config"
  printf '%s ack=%s' "$d" "$a"
}
chk "BCG-4 ack happy (consumed once)" "ALLOW ack=absent" "$(ack_run no)"
# (BCG-4 ack rm-fail runs in the consolidated root-skip block below, with BCG-5 rm-fail)
# post-consume single-use: no ack present -> deny (not reusable)
printf 'AUTO_ADVANCE_MAX=1\nBATCH_AUDIT_EVERY=1\n' > "$RUNDIR/config"; rm -f "$RUNDIR/human.ack"
o=$(printf '{"tool_input":{"command":"git commit -m x"}}' | CLAUDE_PROJECT_DIR="$T" bash "$HOOK" 2>/dev/null)
case "$o" in *'"permissionDecision":"deny"'*) chk "BCG-4 no-ack gated -> deny" DENY DENY ;; *) chk "BCG-4 no-ack gated -> deny" DENY ALLOW ;; esac
rm -f "$RUNDIR/config"

# BCG-5: batch mode (MAX=10) human.override — grant ONLY if reason non-empty AND removed AND logged.
# Window bs=C0 -> count 4 >= EVERY 3 -> audit DUE, so WITHOUT a valid override the commit DENYs.
ovr_run() { # ovr_run <mode: none|rmfail|appendfail|blankreason|unreadable> -> "DENY|ALLOW ovr=present|absent log=N"
  printf 'AUTO_ADVANCE_MAX=10\nBATCH_AUDIT_EVERY=3\n' > "$RUNDIR/config"
  printf '%s\n' "${C[0]}" > "$RUNDIR/batch-start"; rm -f "$RUNDIR/last-batch-audit"
  : > "$RUNDIR/human.override"; : > "$RUNDIR/log.md"
  case "$1" in
    blankreason) printf '\nactual reason on line 2\n' > "$RUNDIR/override-reason.md" ;;
    *)           printf 'deliberate override reason\n'  > "$RUNDIR/override-reason.md" ;;
  esac
  # Root-portable failure injection: a DIRECTORY at the target makes `head`/`>>` fail "is a directory"
  # for ANY uid (incl root), unlike chmod which root bypasses. unreadable-reason + append-fail use it;
  # only rm-fail still needs a chmod-unwritable dir (not enforceable for root -> root-skipped below).
  [ "$1" = unreadable ] && { rm -f "$RUNDIR/override-reason.md"; mkdir "$RUNDIR/override-reason.md"; }
  [ "$1" = appendfail ] && { rm -f "$RUNDIR/log.md"; mkdir "$RUNDIR/log.md"; }
  [ "$1" = rmfail ]     && chmod 0555 "$RUNDIR"
  local out; out=$(printf '{"tool_input":{"command":"git commit -m x"}}' | CLAUDE_PROJECT_DIR="$T" bash "$HOOK" 2>/dev/null)
  [ "$1" = rmfail ]     && chmod 0755 "$RUNDIR"
  local d o l; case "$out" in *'"permissionDecision":"deny"'*) d=DENY ;; *) d=ALLOW ;; esac
  [ -f "$RUNDIR/human.override" ] && o=present || o=absent
  l=$(grep -c 'override consumed' "$RUNDIR/log.md" 2>/dev/null); l=${l:-0}
  rm -rf "$RUNDIR/human.override" "$RUNDIR/override-reason.md" "$RUNDIR/log.md" "$RUNDIR/batch-start" "$RUNDIR/config"
  printf '%s ovr=%s log=%s' "$d" "$o" "$l"
}
# Root-portable cases (always run):
chk "BCG-5 override happy (consume+log)"               "ALLOW ovr=absent log=1" "$(ovr_run none)"
chk "BCG-5 blank-reason -> deny, not spent"            "DENY ovr=present log=0" "$(ovr_run blankreason)"
chk "BCG-5 unreadable-reason (dir) -> deny, not spent" "DENY ovr=present log=0" "$(ovr_run unreadable)"
chk "BCG-5 append-fail (log dir) -> deny, spent, no log" "DENY ovr=absent log=0" "$(ovr_run appendfail)"
# chmod-unwritable rm-fail cases: not enforceable for root -> explicit SKIP (no silent green).
if [ "$ROOT" -eq 0 ]; then
  chk "BCG-4 ack rm-fail -> deny, token persists"        "DENY ack=present"       "$(ack_run yes)"
  chk "BCG-5 rm-fail -> deny, token persists, no false log" "DENY ovr=present log=0" "$(ovr_run rmfail)"
else
  echo "  [SKIP under root: BCG-4 ack rm-fail + BCG-5 rm-fail — chmod-unwritable dir not enforceable for root; non-root runs cover these]"
fi

# --- PRC-4-FU: deny() must emit VALID JSON for control chars / quotes / backslashes ---
# Extract deny() in isolation (depends only on $1, jq, sed, tr, printf) and assert the output
# parses as JSON with permissionDecision=deny — for both the jq-present and jq-fallback branches.
DENY_DEF=$(sed -n '/^deny() {/,/^}/p' "$HOOK")
fu_valid() { printf '%s' "$1" | python3 -c "import json,sys
try:
  d=json.load(sys.stdin); print('OK' if d.get('hookSpecificOutput',{}).get('permissionDecision')=='deny' else 'BAD')
except Exception: print('BAD')" 2>/dev/null; }
fu_check() { # fu_check <label> <reason> [path]
  local label=$1 reason=$2 pth=${3:-$PATH} out got
  out=$(PATH="$pth" bash -c "$DENY_DEF"$'\n''deny "$1"' _ "$reason" 2>/dev/null)
  got=$(fu_valid "$out")
  if [ "$got" = "OK" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [PRC-4-FU invalid deny JSON] $label :: $(printf '%s' "$out" | head -c 120)"; fi
}
FU_NL=$(printf 'reason with\nnewline');   FU_TAB=$(printf 'reason\twith tab')
FU_CR=$(printf 'reason\rwith cr');        FU_QB='reason with "quote" and \backslash'
FU_MIX=$(printf 'mix\n\t"q"\\b\rend');     FU_NORMAL='plain ascii reason'
FU_STUB=$(mktemp -d); printf '#!/bin/sh\nexit 1\n' > "$FU_STUB/jq"; chmod +x "$FU_STUB/jq"
for variant in "jq-present:$PATH" "jq-fallback:$FU_STUB:$PATH"; do
  vlabel=${variant%%:*}; vpath=${variant#*:}
  fu_check "deny $vlabel newline"  "$FU_NL"     "$vpath"
  fu_check "deny $vlabel tab"      "$FU_TAB"    "$vpath"
  fu_check "deny $vlabel CR"       "$FU_CR"     "$vpath"
  fu_check "deny $vlabel quote+bs" "$FU_QB"     "$vpath"
  fu_check "deny $vlabel mixed"    "$FU_MIX"    "$vpath"
  fu_check "deny $vlabel normal"   "$FU_NORMAL" "$vpath"
done
rm -rf "$FU_STUB"

printf 'batch-commit-guard-base: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
