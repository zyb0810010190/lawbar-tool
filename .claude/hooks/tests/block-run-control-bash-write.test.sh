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
# WI-BATCH-REMEDIATION-LANE-00: the remediation token is agent-uncreatable, same class as the
# override token. Every write channel must deny — otherwise the agent could self-authorize a
# commit past a FAILED batch audit.
expect DENY  "create remediation token"    'echo x > dev-memo/run/remediation.authorized'
expect DENY  "append remediation token"    'echo x >> dev-memo/run/remediation.authorized'
expect DENY  "heredoc remediation token"   'cat > dev-memo/run/remediation.authorized'
expect DENY  "touch remediation token"     'touch dev-memo/run/remediation.authorized'
expect DENY  "tee remediation token"       'echo x | tee dev-memo/run/remediation.authorized'
expect DENY  "cp into remediation token"   'cp /tmp/x dev-memo/run/remediation.authorized'
expect DENY  "mv into remediation token"   'mv /tmp/x dev-memo/run/remediation.authorized'
expect DENY  "symlink remediation token"   'ln -s /tmp/x dev-memo/run/remediation.authorized'
expect DENY  "rm remediation token"        'rm -f dev-memo/run/remediation.authorized'
expect DENY  "sed -i remediation token"    'sed -i s/a/b/ dev-memo/run/remediation.authorized'
expect DENY  "dd of= remediation token"    'dd if=/tmp/x of=dev-memo/run/remediation.authorized'
expect DENY  "node -e writes remediation"  'node -e "require(\"fs\").writeFileSync(\"dev-memo/run/remediation.authorized\",\"x\")"'
expect DENY  "obfuscated remediation path" 'echo x > dev-memo/r\un/remediation.authorized'
expect DENY  "cd + bare remediation token" 'cd dev-memo/run && echo x > remediation.authorized'
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

# --- BRCBW-11: the redirection TARGET is terminated by an unquoted metacharacter, not only by
# whitespace. `for tok in $norm` splits on whitespace alone, so these forms used to yield tokens
# like `…/config;echo` / `…/human.override;` / `…/config|cat` whose BASENAME never matched $AUTH —
# and the write was ALLOWED. Genuine red-before cases for EVERY protected file. ---
expect DENY  "redirect + ';' + cmd"        'echo X > dev-memo/run/config; echo done'
expect DENY  "redirect + ';' no space"     'echo X > dev-memo/run/config;echo done'
expect DENY  "no-space redirect + ';'"     'echo X>dev-memo/run/queue.governed;ls'
expect DENY  "redirect + '|' no space"     'echo X > dev-memo/run/config|cat'
expect DENY  "append + ';' + cmd"          'echo X >> dev-memo/run/last-batch-audit; ls'
expect DENY  "redirect override + ';'"     'echo go > dev-memo/run/human.override; echo ok'
expect DENY  "redirect ack + ';'"          'echo go > dev-memo/run/human.ack;true'
expect DENY  "redirect remediation + ';'"  'echo go > dev-memo/run/remediation.authorized; echo ok'
expect DENY  "redirect risk.flag + '|'"    'echo go > dev-memo/run/risk.flag|cat'
expect DENY  "quoted target + ';'"         'echo X > "dev-memo/run/config";ls'
expect DENY  "redirect + ')' subshell end" '(echo X > dev-memo/run/config)'
expect DENY  "truncate log.md + ';'"       'echo X > dev-memo/run/log.md; ls'
# the same metacharacter AFTER a legitimate append must stay ALLOWED (no new false positive)
expect ALLOW "append log.md + ';' + cmd"   'echo entry >> dev-memo/run/log.md; ls'
expect ALLOW "append log.md + '&&' + cmd"  'echo entry >> dev-memo/run/log.md && ls'

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

# --- BRCBW-1 + BRCBW-10: Bash path-indirection hardening (plan-brcbw-1-10-path-indirection.md) ---
# BRCBW-10: lexical shell-word obfuscation (backslash + balanced-quote) of the path.
expect DENY  "BRCBW-10 backslash run"         'echo X > dev-memo/r\un/config'
expect DENY  "BRCBW-10 quoted run"            'echo X > dev-memo/"run"/config'
expect DENY  "BRCBW-10 empty-quote run"       "echo X > dev-memo/ru''n/config"
expect DENY  "BRCBW-10 backslash devmemo"     'echo X > d\ev-memo/run/config'
expect DENY  "BRCBW-10 rm quoted run"         'rm dev-memo/"run"/config'
# BRCBW-1: cd-relative (literal cd, no trailing slash) reaches the operand.
expect DENY  "BRCBW-1 cd then redirect bare"  'cd dev-memo/run && echo x > config'
expect DENY  "BRCBW-1 cd then rm bare"        'cd dev-memo/run && rm config'
expect DENY  "BRCBW-1 cd then tee bare"       'cd dev-memo/run && echo X | tee config'
expect DENY  "BRCBW-1 paren subshell cd"      '(cd dev-memo/run; rm config)'
expect DENY  "BRCBW-1 cd then subshell cd .." 'cd dev-memo/run && (cd ..; rm config)'
# BRCBW-1/2: literal-var redirect/operand (the shared literal-var resolver path).
expect DENY  "BRCBW-1/2 var redirect target"  'p=dev-memo/run/config; echo x > "$p"'
expect DENY  "BRCBW-1/2 var rm operand"       'p=dev-memo/run/config; rm "$p"'
expect DENY  "BRCBW-1/2 var braced redirect"  'p=dev-memo/run/config; echo x > "${p}"'
# Must remain ALLOW — read-source / false-positive floor (BRCBW-5 discipline).
expect ALLOW "cd then cat bare"               'cd dev-memo/run && cat config'
expect ALLOW "var cat operand"                'p=dev-memo/run/config; cat "$p"'
expect ALLOW "cd then write other file"       'cd dev-memo/run && echo x > scratch.txt'
expect ALLOW "grep authority co-occur"        'grep config dev-memo/run/queue.md'
expect ALLOW "bare config write no cd"        'echo x > config'
expect ALLOW "bare rm config no cd"           'rm config'
expect ALLOW "leading env-assign on command"  'FOO=bar rm config'
expect ALLOW "use-before-assign"              'rm "$p"; p=dev-memo/run/config'
expect ALLOW "cd absolute then rm config"     'cd /tmp && rm config'
# Documented Mechanism-C non-goal (computed) -> ALLOW (known residual, not a silent miss).
expect ALLOW "computed var residual non-goal" 'p=$(printf dev-memo/run/config); echo x > "$p"'
# --- audit-mpzlb7b3 remediation: verb completeness + mixed-obfuscation + substitution + [[]] ---
# H1: indirected cp/dd/sed-i/perl-pi destinations.
expect DENY  "ind cp dest after cd"           'cd dev-memo/run && cp /tmp/x config'
expect DENY  "ind dd of= after cd"            'cd dev-memo/run && dd if=/dev/null of=config'
expect DENY  "ind sed -i after cd"            'cd dev-memo/run && sed -i s/a/b/ config'
expect DENY  "ind cp dest via var"            'p=dev-memo/run/config; cp /tmp/x "$p"'
expect ALLOW "ind cp SOURCE after cd (read)"  'cd dev-memo/run && cp config /tmp/x'
# H2: mixed de-obfuscation + cd/var indirection.
expect DENY  "mixed obf cd + redirect"        'cd dev-memo/r\un && echo x > config'
expect DENY  "mixed obf cd + rm"              'cd dev-memo/"run" && rm config'
expect DENY  "mixed obf var redirect"         'p=dev-memo/"run"/config; echo x > "$p"'
# H3: indirection inside a command substitution body.
expect DENY  "subst body cd + rm"             'echo $(cd dev-memo/run; rm config)'
expect DENY  "subst body var rm"              'echo $(p=dev-memo/run/config; rm "$p")'
# M: [[ ]] comparison under a tracked cwd must NOT be a write.
expect ALLOW "cd then [[ > ]] comparison"     'cd dev-memo/run && [[ "$x" > config ]]'
# Regression floor — existing direct protections still DENY.
expect DENY  "regression direct redirect"     'echo x > dev-memo/run/config'
expect DENY  "regression direct rm"           'rm dev-memo/run/config'

# --- BRCBW-12: target-word termination at ANY shell metacharacter + per-token quote handling ---
# Two VERIFIED bypass classes (each confirmed by feeding crafted JSON to the hook's stdin; no
# real write to a protected file was ever attempted):
#
#   (A) A redirection / write-verb target word is terminated by an unquoted shell metacharacter,
#       but the truncation set was only `; | & )` — it omitted `<`, `>` and `(`. So a protected
#       path glued directly to one of those left a token whose BASENAME (`config<foo`,
#       `config(foo`) matched nothing in $AUTH, and the write was ALLOWED. In the redirection
#       scan `>` happened to be neutralised already by the `__TRUNC__` normalisation, but `<`
#       and `(` were live; in the VERB scan (tok_auth / tok_logmd) there is no normalisation at
#       all, so BOTH `<` and `>` were live for rm/cp/mv/tee/touch/sed -i/dd of=.
#   (B) deobf() gated quote-stripping on the parity of the quote counts over the WHOLE command:
#       an ODD count ANYWHERE left every token unstripped — fail-OPEN. So a protected path with
#       an internally quoted segment (dev-memo/"run"/config) was revealed and denied on its own,
#       but ALLOWED as soon as an unrelated apostrophe (don't / it's / can't) appeared elsewhere
#       in the command.
#
# The fix terminates a candidate target at any of `; | & ( ) < >` (plus whitespace) in BOTH
# scans, replaces the parity heuristic with a per-token quote state machine, and treats
# UNBALANCED quotes as DENY (fail-closed) instead of "leave unchanged".
expect DENY  "redir target + '<' + path"     'echo X > dev-memo/run/config<foo'
expect DENY  "redir target + '<' no space"   'echo X >dev-memo/run/config<foo'
expect DENY  "redir target + '>' + path"     'echo X > dev-memo/run/config>foo'
expect DENY  "redir target + '>' no space"   'echo X >dev-memo/run/config>foo'
expect DENY  "redir override + '<'"          'echo X > dev-memo/run/human.override<foo'
expect DENY  "redir remediation + '<'"       'echo X > dev-memo/run/remediation.authorized<foo'
expect DENY  "redir governed + '<' fd"       'echo X > dev-memo/run/queue.governed<0'
expect DENY  "truncate log.md + '<'"         'echo X > dev-memo/run/log.md<foo'
expect DENY  "redir target + '(' glued"      'echo X > dev-memo/run/config(foo'
# same class through the write-VERB scan (tok_auth / tok_logmd) — no `>` normalisation there:
expect DENY  "rm authority + '<'"            'rm dev-memo/run/config<foo'
expect DENY  "rm authority + '>'"            'rm dev-memo/run/config>foo'
expect DENY  "cp dest authority + '<'"       'cp /tmp/x dev-memo/run/config<foo'
expect DENY  "cp dest authority + '>'"       'cp /tmp/x dev-memo/run/config>foo'
expect DENY  "tee authority + '<'"           'tee dev-memo/run/config<foo'
expect DENY  "tee authority + '>'"           'tee dev-memo/run/config>foo'
expect DENY  "tee log.md + '<'"              'tee dev-memo/run/log.md<foo'
expect DENY  "mv dest ack + '<'"             'mv /tmp/x dev-memo/run/human.ack<foo'
expect DENY  "touch remediation + '<'"       'touch dev-memo/run/remediation.authorized<foo'
expect DENY  "sed -i authority + '<'"        'sed -i s/a/b/ dev-memo/run/config<foo'
expect DENY  "dd of= authority + '<'"        'dd if=/tmp/x of=dev-memo/run/config<foo'
# same class through the indirection resolver (cd-relative + literal-var operands):
expect DENY  "cd + rm bare + '<'"            'cd dev-memo/run && rm config<foo'
expect DENY  "cd + redirect bare + '<'"      'cd dev-memo/run && echo x > config<foo'
expect DENY  "cd target glued '<'"           'cd dev-memo/run<x && rm config'
expect DENY  "var rm operand + '<'"          'p=dev-memo/run/config; rm "$p"<foo'
expect DENY  "var redirect target + '<'"     'p=dev-memo/run/config; echo x > "$p"<foo'
# (B) the parity fail-open: an unrelated apostrophe must NOT disable quote de-obfuscation.
expect DENY  "quoted seg + stray apostrophe" "echo it's X > dev-memo/\"run\"/config"
expect DENY  "quoted seg + rm + apostrophe"  "rm dev-memo/\"run\"/config; echo don't"
expect DENY  "apostrophe then quoted rm"     "echo don't && rm dev-memo/'run'/config"
expect DENY  "empty-quote seg + apostrophe"  "echo it's X > dev-memo/ru''n/config"
# unbalanced quotes over a run-control reference are UNPARSEABLE -> fail closed (DENY).
expect DENY  "unbalanced sq + quoted seg"    "echo X > 'dev-memo/\"run\"/config"
expect DENY  "unbalanced sq + rm"            "rm 'dev-memo/\"run\"/config"
expect DENY  "unbalanced sq override"        "echo can't > dev-memo/\"run\"/human.override"
expect DENY  "unbalanced sq direct path"     "echo X > 'dev-memo/run/config"
# --- BRCBW-12 false-positive floor: no new over-denial on reads / appends / unrelated work ---
expect ALLOW "cat authority + '<' glued"     'cat dev-memo/run/config<foo'
expect ALLOW "cd + cat bare + '<'"           'cd dev-memo/run && cat config<foo'
expect ALLOW "append log.md + '<' glued"     'echo entry >> dev-memo/run/log.md<foo'
expect ALLOW "unrelated redirect + '<'"      'echo X > /tmp/scratch<foo'
# an unbalanced quote in a command that does NOT reference run-control must still ALLOW —
# the fail-closed deny is bounded to commands that reference dev-memo/run.
expect ALLOW "unbalanced sq, no run ref"     "echo it's fine"
expect ALLOW "unbalanced sq, other path"     "echo can't > /tmp/scratch"
# a BALANCED apostrophe inside double quotes is data, not a quote -> no deny, no parity trip.
expect ALLOW "apostrophe inside dquotes"     'git commit -m "do not touch dev-memo/run/config"'
expect ALLOW "prose apostrophe + run ref"    'echo "the queue.governed under dev-memo/run is fine"'

# --- BRCBW-12 sweep: the SAME defect (whole-string shell-syntax matching that ignores quoting)
# in two other places. Both were verified ALLOWs before the fix.
#   (i)  the `[[ ... ]]` blanking sed: `>` inside a Bash test is a comparison, so those spans are
#        blanked before the redirection scan. A QUOTED literal bracket pair drags a REAL
#        redirection into the blanked span and the write disappears.
#   (ii) the awk statement splitter `gsub(/&&|\|\||[;|&]/)`: a QUOTED metacharacter inside an
#        argument ends the statement early, so the real target lands in a fragment whose first
#        word is not a write verb, and the write-verb scan never sees it.
expect DENY  "quoted [[ hides redirect"      'echo "[[" > dev-memo/run/config; echo "]]"'
expect DENY  "quoted [[ hides redirect (sq)" "echo '[[' > dev-memo/run/config; echo ']]'"
expect DENY  "quoted [[ + trailing ]]"       'echo "[[" > dev-memo/run/human.override ]]'
expect DENY  "rm + quoted ';' in operand"    "rm 'a;b' dev-memo/run/config"
expect DENY  "rm + quoted ';' (dquotes)"     'rm "a;b" dev-memo/run/config'
expect DENY  "rm + quoted '|' in operand"    "rm 'a|b' dev-memo/run/config"
expect DENY  "rm + quoted '&' in operand"    "rm 'a&b' dev-memo/run/config"
expect DENY  "cp dest + quoted ';' operand"  "cp /tmp/x 'a;b' dev-memo/run/config"
expect DENY  "tee + quoted ';' operand"      "tee 'a;b' dev-memo/run/config"
expect DENY  "touch remediation + quoted ';'" "touch 'a;b' dev-memo/run/remediation.authorized"
expect DENY  "sed -i + quoted ';' operand"   "sed -i s/a/b/ 'a;b' dev-memo/run/config"
expect DENY  "rm + escaped ';' in operand"   'rm a\;b dev-memo/run/config'
# floor: a genuine test expression and a genuine read must not start denying.
expect ALLOW "real [[ > ]] still compares"   '[[ "$x" > dev-memo/run/config ]]'
expect ALLOW "cat + quoted ';' operand"      "cat 'a;b' dev-memo/run/config"
expect ALLOW "grep + quoted ';' operand"     "grep -n 'a;b' dev-memo/run/config"

# --- PRC-4-FU: emit_deny() must emit VALID JSON for control chars / quotes / backslashes ---
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
  if [ "$got" = "OK" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed_cases="$failed_cases\n  [PRC-4-FU invalid emit_deny JSON] $label :: $(printf '%s' "$out" | head -c 120)"; fi
}
FU_NL=$(printf 'reason with\nnewline');   FU_TAB=$(printf 'reason\twith tab')
FU_CR=$(printf 'reason\rwith cr');        FU_QB='reason with "quote" and \backslash'
FU_MIX=$(printf 'mix\n\t"q"\\b\rend');     FU_NORMAL='plain ascii reason'
FU_STUB=$(mktemp -d); printf '#!/bin/sh\nexit 1\n' > "$FU_STUB/jq"; chmod +x "$FU_STUB/jq"
for variant in "jq-present:$PATH" "jq-fallback:$FU_STUB:$PATH"; do
  vlabel=${variant%%:*}; vpath=${variant#*:}
  fu_check "emit_deny $vlabel newline"  "$FU_NL"     "$vpath"
  fu_check "emit_deny $vlabel tab"      "$FU_TAB"    "$vpath"
  fu_check "emit_deny $vlabel CR"       "$FU_CR"     "$vpath"
  fu_check "emit_deny $vlabel quote+bs" "$FU_QB"     "$vpath"
  fu_check "emit_deny $vlabel mixed"    "$FU_MIX"    "$vpath"
  fu_check "emit_deny $vlabel normal"   "$FU_NORMAL" "$vpath"
done
rm -rf "$FU_STUB"

# ---------------------------------------------------------------------------
printf 'block-run-control-bash-write: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then
  printf 'FAILED CASES:%b\n' "$failed_cases"
  exit 1
fi
echo "ALL PASS"
exit 0
