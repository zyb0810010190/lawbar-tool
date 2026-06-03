#!/bin/bash
# block-run-control-bash-write.test.sh — case suite for the run-control Bash-write guard.
#
# Closes the High-severity gap found in dev-memo/hook-audit-canary-01.md
# (BASH-WRITE-BYPASS): protect-run-control.sh blocks Write|Edit|MultiEdit on the
# dev-memo/run/ authority files but NOT Bash redirection, so `echo X > dev-memo/run/config`
# forges governance state. This suite is the executable spec for the guard hook.
#
# Each case feeds a PreToolUse(Bash) JSON payload on stdin to the hook and asserts the
# decision: DENY (stdout contains permissionDecision:"deny") or ALLOW (no deny emitted).
#
# Run: bash .claude/hooks/tests/block-run-control-bash-write.test.sh   (exit 0 = all pass)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../block-run-control-bash-write.sh"

pass=0; fail=0; failed_cases=""

# decide CMD -> prints "DENY" or "ALLOW" by running the hook with a JSON payload.
decide() {
  local cmd="$1" out
  # Build the JSON with jq so embedded quotes/specials in the command are encoded safely.
  local payload
  if command -v jq >/dev/null 2>&1; then
    payload=$(jq -nc --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}')
  else
    payload="{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$cmd\"}}"
  fi
  out=$(printf '%s' "$payload" | bash "$HOOK" 2>/dev/null)
  case "$out" in
    *'"permissionDecision":"deny"'*) printf 'DENY' ;;
    *) printf 'ALLOW' ;;
  esac
}

expect() { # expect <DENY|ALLOW> <label> <command>
  local want="$1" label="$2" cmd="$3" got
  got=$(decide "$cmd")
  if [ "$got" = "$want" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); failed_cases="$failed_cases\n  [want $want got $got] $label :: $cmd"
  fi
}

# --- BRCBW-6: controlled "jq unavailable" harness ----------------------------
# Build a temp bin with absolute-path symlinks to every external tool the hook needs EXCEPT jq,
# then run the hook with PATH set to ONLY that dir (and an absolute /bin/bash, since bash itself
# is not in the temp bin). `command -v jq` then fails inside the hook, exercising the fail-closed
# fallback — without depending on the developer machine actually lacking jq. RAW is the exact
# JSON payload bytes (so JSON escapes like \/ are preserved verbatim, not re-encoded by jq).
NOJQ_BIN=""
nojq_setup() {
  NOJQ_BIN=$(mktemp -d)
  local t p
  for t in grep sed tr head awk cat; do
    p=""
    [ -x "/usr/bin/$t" ] && p="/usr/bin/$t"
    [ -z "$p" ] && [ -x "/bin/$t" ] && p="/bin/$t"
    [ -n "$p" ] && ln -s "$p" "$NOJQ_BIN/$t"
  done
}
nojq_teardown() { [ -n "$NOJQ_BIN" ] && rm -rf "$NOJQ_BIN"; NOJQ_BIN=""; }
decide_rawnojq() { # decide_rawnojq <raw-json-payload> -> DENY/ALLOW with jq absent
  local out
  out=$(printf '%s' "$1" | PATH="$NOJQ_BIN" /bin/bash "$HOOK" 2>/dev/null)
  case "$out" in *'"permissionDecision":"deny"'*) printf 'DENY' ;; *) printf 'ALLOW' ;; esac
}
decide_rawjq() { # same payload, jq present (normal PATH) -> DENY/ALLOW
  local out
  out=$(printf '%s' "$1" | bash "$HOOK" 2>/dev/null)
  case "$out" in *'"permissionDecision":"deny"'*) printf 'DENY' ;; *) printf 'ALLOW' ;; esac
}
expect_raw() { # expect_raw <DENY|ALLOW> <jq|nojq> <label> <raw-json-payload>
  local want="$1" mode="$2" label="$3" raw="$4" got
  if [ "$mode" = "nojq" ]; then got=$(decide_rawnojq "$raw"); else got=$(decide_rawjq "$raw"); fi
  if [ "$got" = "$want" ]; then pass=$((pass+1))
  else fail=$((fail+1)); failed_cases="$failed_cases\n  [want $want got $got] ($mode) $label :: $raw"; fi
}

# ---------------------------------------------------------------------------
# DENY — direct Bash writes to authority/state files (the forge-governance set)
# ---------------------------------------------------------------------------
expect DENY  "overwrite config"            'echo AUTO_ADVANCE_MAX=99 > dev-memo/run/config'
expect DENY  "append config"               'echo X >> dev-memo/run/config'
expect DENY  "no-space redirect config"    'echo X>dev-memo/run/config'
expect DENY  "overwrite batch-start"       'git rev-parse HEAD > dev-memo/run/batch-start'
expect DENY  "truncate last-batch-audit"   ': > dev-memo/run/last-batch-audit'
expect DENY  "printf risk.flag"            'printf x > dev-memo/run/risk.flag'
expect DENY  "create human.override"       'echo go > dev-memo/run/human.override'
expect DENY  "touch human.ack token"       'touch dev-memo/run/human.ack'
expect DENY  "touch human.override token"  'touch dev-memo/run/human.override'
expect DENY  "cat-heredoc queue.governed"  'cat > dev-memo/run/queue.governed'
expect DENY  "tee queue.reviewed"          'echo PASS | tee dev-memo/run/queue.reviewed'
expect DENY  "tee -a queue.linted"         'echo X | tee -a dev-memo/run/queue.linted'
expect DENY  "sed -i config (bsd)"         "sed -i '' s/3/99/ dev-memo/run/config"
expect DENY  "sed -i config (gnu)"         'sed -i s/3/99/ dev-memo/run/config'
expect DENY  "rm queue.reviewed"           'rm dev-memo/run/queue.reviewed'
expect DENY  "rm -f governed"              'rm -f dev-memo/run/queue.governed'
expect DENY  "unlink risk.flag"            'unlink dev-memo/run/risk.flag'
expect DENY  "mv into governed"            'mv /tmp/x dev-memo/run/queue.governed'
expect DENY  "cp into batch-start"         'cp /tmp/x dev-memo/run/batch-start'
expect DENY  "hardlink human.ack reuse"    'ln dev-memo/run/human.ack /tmp/ack'
expect DENY  "symlink override"            'ln -s /tmp/x dev-memo/run/human.override'
expect DENY  "truncate authority"          'truncate -s0 dev-memo/run/forbidden-paths.txt'
expect DENY  "dd of= authority"            'dd if=/tmp/x of=dev-memo/run/config'
expect DENY  "absolute path overwrite"     'echo X > /Users/zhongyibao/ClaudeProjects/lawbar-tool/dev-memo/run/config'
expect DENY  "dotslash path overwrite"     'echo X > ./dev-memo/run/config'
expect DENY  "chained after &&"            'true && echo X > dev-memo/run/config'
expect DENY  "fd-prefixed redirect"        'foo 1> dev-memo/run/risk.flag'

# log.md: append OK, but overwrite / truncate / delete is tamper
expect DENY  "overwrite log.md"            'echo X > dev-memo/run/log.md'
expect DENY  "truncate log.md"             'truncate -s0 dev-memo/run/log.md'
expect DENY  "rm log.md"                   'rm dev-memo/run/log.md'
expect DENY  "sed -i log.md"              'sed -i s/a/b/ dev-memo/run/log.md'

# ---------------------------------------------------------------------------
# ALLOW — appends to the audit trail, reads, and the legitimate workflow scripts
# ---------------------------------------------------------------------------
expect ALLOW "append log.md (audit trail)" 'echo "## WI-002" >> dev-memo/run/log.md'
expect ALLOW "printf append log.md"        'printf "%s\n" entry >> dev-memo/run/log.md'
expect ALLOW "tee -a log.md"               'echo entry | tee -a dev-memo/run/log.md'
expect ALLOW "read config (cat)"           'cat dev-memo/run/config'
expect ALLOW "read config (grep)"          'grep AUTO_ADVANCE_MAX dev-memo/run/config'
expect ALLOW "config as source not target" 'cat dev-memo/run/config > /tmp/snapshot'
expect ALLOW "source script (sets state)"  'bash scripts/workflow/govern-queue.sh'
expect ALLOW "run check-queue script"      'bash scripts/workflow/check-queue.sh'
expect ALLOW "ls run dir"                  'ls -la dev-memo/run/'
expect ALLOW "edit queue.md (authored)"    'echo "## WI-004" >> dev-memo/run/queue.md'
expect ALLOW "write README.md (doc)"       'echo X > dev-memo/run/README.md'
expect ALLOW "unrelated redirect"          'echo X > /tmp/scratch'
expect ALLOW "git status"                  'git status --short'
expect ALLOW "non-run dev-memo write"      'echo X > dev-memo/canary-start.md'

# --- BRCBW-5: narrow to actual write operations (command-word gated + write-target only) ---
# actual writes to protected paths STILL deny (no weakening):
expect DENY  "rm authority"                'rm dev-memo/run/config'
expect DENY  "path-prefixed rm authority"  '/usr/bin/rm dev-memo/run/config'
expect DENY  "env-wrapped rm authority"    'env FOO=bar rm dev-memo/run/batch-start'
expect DENY  "cp to authority dest"        'cp /tmp/x dev-memo/run/last-batch-audit'
expect DENY  "cp dest after trailing flag" 'cp /tmp/x dev-memo/run/config -v'
expect DENY  "mv any operand authority"    'mv /tmp/x dev-memo/run/risk.flag'
expect DENY  "dd of= authority"            'dd if=/tmp/x of=dev-memo/run/config'
expect DENY  "sed -i.bak authority"        "sed -i.bak s/a/b/ dev-memo/run/config"
# --- BRCBW-4: perl in-place edits (clustered -pi etc.) on protected paths deny ---
expect DENY  "perl -pi authority"          "perl -pi -e s/a/b/ dev-memo/run/config"
expect DENY  "perl -p -i authority"        "perl -p -i -e s/a/b/ dev-memo/run/config"
expect DENY  "perl -i.bak -pe authority"   "perl -i.bak -pe s/a/b/ dev-memo/run/config"
expect DENY  "/usr/bin/perl -pi authority" "/usr/bin/perl -pi -e s/a/b/ dev-memo/run/config"
expect DENY  "env perl -pi authority"      "env perl -pi -e s/a/b/ dev-memo/run/config"
expect DENY  "perl -pi log.md"             "perl -pi -e s/a/b/ dev-memo/run/log.md"
expect DENY  "perl -ni authority"          "perl -ni -e print dev-memo/run/config"
# perl WITHOUT in-place that only READS a protected path allows:
expect ALLOW "perl -ne read authority"     "perl -ne print dev-memo/run/config"
expect ALLOW "perl -pe read authority"     "perl -pe s/a/b/ dev-memo/run/config"
# prose / read-only mentions of perl -pi + protected path allow (not actual write targets):
expect ALLOW "echo prose perl -pi+path"    'echo "perl -pi dev-memo/run/config to patch"'
expect ALLOW "grep prose perl -pi+path"    'grep "perl -pi dev-memo/run/config" somefile'
expect DENY  "tee authority (not log)"     'echo X | tee dev-memo/run/queue.reviewed'
# read-only commands mentioning protected paths ALLOW (the BRCBW-5 fix):
expect ALLOW "cp authority as SOURCE"      'cp dev-memo/run/config /tmp/x'
expect ALLOW "dd if= authority (read)"     'dd if=dev-memo/run/config of=/tmp/x'
expect ALLOW "cat read authority"          'cat dev-memo/run/last-batch-audit'
expect ALLOW "grep read authority"         'grep -n pattern dev-memo/run/config'
expect ALLOW "gh diff naming authority"    'gh pr diff 21 -- dev-memo/run/config'
expect ALLOW "ls authority"                'ls -la dev-memo/run/config'
# write-like words in PROSE allow (the observed friction):
expect ALLOW "echo prose with touch+path"  'echo "does the diff touch dev-memo/run/config"'
expect ALLOW "grep pattern with rm+path"   'grep "rm dev-memo/run/config" somefile'
expect ALLOW "echo prose cp+path"          'echo "cp dev-memo/run/config to backup"'

# --- BRCBW-3: per-invocation tee (the -a exception is per statement, not global) ---
expect DENY  "tee -a /tmp then tee log.md"     'tee -a /tmp/ok; tee dev-memo/run/log.md'
expect DENY  "tee log.md then tee -a /tmp"     'tee dev-memo/run/log.md; tee -a /tmp/ok'
expect DENY  "tee log.md (no -a) via pipe"     'echo X | tee dev-memo/run/log.md'
expect DENY  "tee -a /tmp/ok && tee log.md"    'echo X | tee -a /tmp/ok && echo Y | tee dev-memo/run/log.md'
expect ALLOW "tee -a /tmp/ok alone"            'echo X | tee -a /tmp/ok'
expect ALLOW "tee -a log.md (append)"          'echo X | tee -a dev-memo/run/log.md'
expect ALLOW "prose: 'use tee -a for log.md'"  'echo "use tee -a for dev-memo/run/log.md"'
expect ALLOW "grep prose tee+authority"        'grep "tee dev-memo/run/config" somefile'

# --- BRCBW-7: read-only Bash test/conditional expressions do not false-deny ---
# == / != / = forms: cmd word is [[ / [ / test (not a write verb) -> allow (BRCBW-5 gating).
expect ALLOW "[[ == authority ]]"          '[[ "$x" == dev-memo/run/config ]]'
expect ALLOW "[[ != authority ]]"          '[[ "$x" != dev-memo/run/config ]]'
expect ALLOW "[ = authority ]"             '[ "$x" = dev-memo/run/config ]'
expect ALLOW "test = authority"            'test "$x" = dev-memo/run/config'
expect ALLOW "if [[ == ]]; then …"         'if [[ "$x" == dev-memo/run/config ]]; then echo hi; fi'
# write-like words quoted INSIDE a test expression still allow (not a command word):
expect ALLOW "[[ == \"rm …path\" ]]"        '[[ "$x" == "rm dev-memo/run/config" ]]'
expect ALLOW "[[ == \"tee …path\" ]]"       '[[ "$x" == "tee dev-memo/run/config" ]]'
# the literal recorded BRCBW-7 form: > / < are string comparisons inside [[ ]], not redirection:
expect ALLOW "[[ > authority ]] (compare)" '[[ "$x" > dev-memo/run/config ]]'
expect ALLOW "[[ < authority ]] (compare)" '[[ "$x" < dev-memo/run/config ]]'
# a REAL write after a test expression still denies (no weakening):
expect DENY  "[[ == ]] && rm authority"    '[[ "$x" == dev-memo/run/config ]] && rm dev-memo/run/config'
expect DENY  "[[ -f ]] && echo > authority" '[[ -f dev-memo/run/config ]] && echo X > dev-memo/run/config'
expect DENY  "[[ ]] || tee authority"      '[[ -f /tmp/x ]] || echo P | tee dev-memo/run/queue.reviewed'
# a redirect ATTACHED to the compound (> after ]]) is a real write -> still denies:
expect DENY  "[[ -f ]] > authority"        '[[ -f /tmp/x ]] > dev-memo/run/config'
# command substitution EXECUTES even inside [[ ]] — a write within one is real, must DENY:
expect DENY  "[[ \$(echo > auth) == ]]"     '[[ "$(echo X > dev-memo/run/config)" == "" ]]'
expect DENY  "[[ \$(tee auth) == ]]"        '[[ "$(tee dev-memo/run/config <<< X)" == "" ]]'
expect DENY  "[[ backtick echo > auth ]]"   '[[ `echo X > dev-memo/run/config` == "" ]]'
expect DENY  "if [[ \$(echo > auth) ]]"     'if [[ "$(echo X > dev-memo/run/config)" == "" ]]; then true; fi'
expect DENY  "[[ \$(echo > auth ) ]] space" '[[ "$(echo X > dev-memo/run/config )" == y ]]'
expect DENY  "[[ \$(rm auth) == ]]"         '[[ "$(rm dev-memo/run/config)" == "" ]]'
# command substitution that only READS a protected path still allows:
expect ALLOW "[[ \$(cat auth) == ]]"        '[[ "$(cat dev-memo/run/config)" == "" ]]'
expect ALLOW "grep \$(cat auth)"            'grep "$(cat dev-memo/run/config)" /tmp/x'

# --- BRCBW-8: NESTED command substitutions — inner write at any depth denies (WI-A) ---
expect DENY  "nested sub tee (in [[]])"    '[[ "$(echo $(tee dev-memo/run/config))" = y ]]'
expect DENY  "nested sub tee (bare)"       'echo $(echo $(tee dev-memo/run/config))'
expect DENY  "nested sub redirect (bare)"  'echo $(echo X > dev-memo/run/config)'
expect DENY  "nested sub redirect deep"    'echo $(echo $(echo X > dev-memo/run/config))'
expect DENY  "triple-nested write verb"    'echo $(echo $(echo $(rm dev-memo/run/config)))'
expect DENY  "nested backtick inside \$()"  'echo $(echo `tee dev-memo/run/config`)'
expect DENY  "nested sub rm (in [[]])"     '[[ "$(echo $(rm dev-memo/run/config))" = y ]]'
# nested READ-ONLY substitutions still allow (false-positive guard):
expect ALLOW "nested sub cat (bare)"       'echo $(echo $(cat dev-memo/run/config))'
expect ALLOW "nested sub cat (in [[]])"    '[[ "$(echo $(cat dev-memo/run/config))" = y ]]'
expect ALLOW "nested grep read"            'echo $(grep x $(printf dev-memo/run/config))'
# spec Option 1: escaped/single-quoted literal $(...) over-denies (fail-closed; unchanged) ---
expect DENY  "single-quoted literal sub"   "echo '\$(rm dev-memo/run/config)'"
# comparison operators OUTSIDE any substitution must NOT regress to deny (BRCBW-7 floor):
expect ALLOW "[[ \$(echo) > auth ]] cmp"    '[[ "$(echo X)" > dev-memo/run/config ]]'

# --- BRCBW-8 audit findings (audit-mpxebdwd-4vuouz) — fail-closed backstop ---
# Finding 1: nesting beyond the peel cap must NOT allow an outer-substitution write.
expect DENY  "deep-nested redirect >cap"   '[[ "$(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo X))))))))))))))))) > dev-memo/run/config)" == "" ]]'
# Finding 2: a substitution body with a literal ( or backtick that also writes must DENY.
expect DENY  "literal-paren body + rm"     '[[ "$(printf "("; rm dev-memo/run/config)" == "" ]]'
expect DENY  "literal-paren body + redir"  'echo $(printf "("; echo X > dev-memo/run/config)'
# An UNPARSEABLE sub (literal paren/backtick body) that names a protected file fails CLOSED —
# deny whether it reads or writes (pass-0 posture; over-deny of the read form is accepted).
expect DENY  "literal-paren body + cat"    '[[ "$(printf "("; cat dev-memo/run/config)" == "" ]]'
# verify-mpxehbp8: write verb with NO leading space (right after ; or $() must DENY.
expect DENY  "no-space ;rm in paren body"  '[[ "$(printf "(";rm dev-memo/run/config)" == "" ]]'
expect DENY  "verb first in paren body"    '[[ "$(rm dev-memo/run/config; printf "(")" == "" ]]'
# verify-mpxelds9: sed/perl in-place variants in a literal-paren body must DENY.
expect DENY  "paren body + perl -0pi"      '[[ "$(printf "(";perl -0pi -e s/a/b/ dev-memo/run/config)" == "" ]]'
expect DENY  "paren body + sed -n -i"      '[[ "$(printf "(";sed -n -i s/a/b/ dev-memo/run/config)" == "" ]]'
expect DENY  "paren body + sed --in-place" '[[ "$(printf "(";sed --in-place s/a/b/ dev-memo/run/config)" == "" ]]'
expect DENY  "paren body + sed -E -i"      '[[ "$(printf "(";sed -E -i s/a/b/ dev-memo/run/config)" == "" ]]'
# backstop must NOT fire when the unresolved sub names a NON-authority path (queue.md authored).
expect ALLOW "paren body + queue.md read"  '[[ "$(printf "("; cat dev-memo/run/queue.md)" == "" ]]'

# --- BRCBW-6: jq-unavailable fail-closed (raw payloads; jq simulated absent via temp PATH) ---
# Sanity: with jq AVAILABLE, valid protected writes still DENY and non-protected ops still ALLOW.
expect_raw DENY  jq   "jq-present protected redirect" '{"tool_name":"Bash","tool_input":{"command":"echo X > dev-memo/run/config"}}'
expect_raw DENY  jq   "jq-present escaped redirect"   '{"tool_name":"Bash","tool_input":{"command":"echo X > dev-memo\/run\/config"}}'
expect_raw ALLOW jq   "jq-present normal cmd"         '{"tool_name":"Bash","tool_input":{"command":"echo hello"}}'
expect_raw ALLOW jq   "jq-present read protected"     '{"tool_name":"Bash","tool_input":{"command":"cat dev-memo/run/config"}}'
nojq_setup
# THE BYPASS (BRCBW-6): jq absent + JSON-escaped protected path must now DENY (was ALLOW).
expect_raw DENY  nojq "nojq \/-escaped redirect"     '{"tool_name":"Bash","tool_input":{"command":"echo X > dev-memo\/run\/config"}}'
expect_raw DENY  nojq "nojq \/-escaped rm"           '{"tool_name":"Bash","tool_input":{"command":"rm dev-memo\/run\/config"}}'
expect_raw DENY  nojq "nojq partial \/-escape"       '{"tool_name":"Bash","tool_input":{"command":"echo X > dev-memo/run\/config"}}'
# \uXXXX-encoded path chars must also DENY when jq absent. Built from a backslash var so the
# literal "backslash-u" never appears contiguously in source (some editors fold it to a char).
bs=$(printf '%s' '\')
u_slashes='{"tool_name":"Bash","tool_input":{"command":"echo X > dev-memo'"${bs}u002f"'run'"${bs}u002f"'config"}}'
u_dot='{"tool_name":"Bash","tool_input":{"command":"echo X > dev-memo/run/risk'"${bs}u002e"'flag"}}'
expect_raw DENY  nojq "nojq u002f-escaped slashes"   "$u_slashes"
expect_raw DENY  nojq "nojq u002e-escaped dot risk"  "$u_dot"
# audit-mpxi9cp3: \\ and \" escapes also defeat a narrow allow-list — Bash strips the backslash
# (r\\un -> run) or splices quotes; any backslash in the payload must fail closed when jq absent.
bb='{"tool_name":"Bash","tool_input":{"command":"echo X > dev-memo/r'"${bs}${bs}"'un/config"}}'
qq='{"tool_name":"Bash","tool_input":{"command":"echo X > dev-memo/'"${bs}"'"run'"${bs}"'"/config"}}'
expect_raw DENY  nojq "nojq backslash-spliced path"  "$bb"
expect_raw DENY  nojq "nojq quote-spliced path"      "$qq"
# jq absent, NO escapes: the plain fallback still works — protected writes DENY, reads/normal ALLOW.
expect_raw DENY  nojq "nojq plain protected redirect" '{"tool_name":"Bash","tool_input":{"command":"echo X > dev-memo/run/config"}}'
expect_raw DENY  nojq "nojq plain protected rm"       '{"tool_name":"Bash","tool_input":{"command":"rm dev-memo/run/config"}}'
expect_raw ALLOW nojq "nojq normal cmd"               '{"tool_name":"Bash","tool_input":{"command":"echo hello"}}'
expect_raw ALLOW nojq "nojq read protected"           '{"tool_name":"Bash","tool_input":{"command":"cat dev-memo/run/config"}}'
expect_raw ALLOW nojq "nojq append log.md"            '{"tool_name":"Bash","tool_input":{"command":"echo x >> dev-memo/run/log.md"}}'
# denial message names jq / unsafe parsing (actionable).
nojq_msg=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"echo X > dev-memo\/run\/config"}}' | PATH="$NOJQ_BIN" /bin/bash "$HOOK" 2>/dev/null)
case "$nojq_msg" in *"jq"*) pass=$((pass+1)) ;; *) fail=$((fail+1)); failed_cases="$failed_cases\n  [want msg-mentions-jq] nojq denial message :: $nojq_msg" ;; esac
nojq_teardown

# ---------------------------------------------------------------------------
printf 'block-run-control-bash-write: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then
  printf 'FAILED CASES:%b\n' "$failed_cases"
  exit 1
fi
echo "ALL PASS"
exit 0
