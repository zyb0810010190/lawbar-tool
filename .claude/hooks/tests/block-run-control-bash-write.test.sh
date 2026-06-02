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

# ---------------------------------------------------------------------------
printf 'block-run-control-bash-write: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then
  printf 'FAILED CASES:%b\n' "$failed_cases"
  exit 1
fi
echo "ALL PASS"
exit 0
