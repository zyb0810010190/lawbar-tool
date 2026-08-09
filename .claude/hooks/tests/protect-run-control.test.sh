#!/bin/bash
# protect-run-control.test.sh — fail-closed parse spec for protect-run-control.sh (PRC-3).
# A parseable write to a protected dev-memo/run/ file denies (unchanged); a parse failure that
# still references a protected file now denies (was fail-open); unrelated/unparseable writes pass.
# Payloads are passed as literal strings so malformed-JSON cases can be exercised.
# Run: bash .claude/hooks/tests/protect-run-control.test.sh   (exit 0 = all pass)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; HOOK="$HERE/../protect-run-control.sh"
pass=0; fail=0; failed=""

# decide <raw-payload> -> echoes DENY|ALLOW
decide() {
  local out; out=$(printf '%s' "$1" | bash "$HOOK" 2>/dev/null)
  case "$out" in *'"permissionDecision":"deny"'*) printf DENY ;; *) printf ALLOW ;; esac
}
expect() { local want="$1" label="$2" payload="$3" got; got=$(decide "$payload"); if [ "$got" = "$want" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [want $want got $got] $label"; fi; }

# --- valid parse still passes ---
expect ALLOW "valid Write to a non-run-control file"        '{"tool_name":"Write","tool_input":{"file_path":"apps/lawbar-desktop/renderer/x.ts","content":"x"}}'
expect ALLOW "valid Write to dev-memo/run/queue.md (authored, not protected)" '{"tool_input":{"file_path":"dev-memo/run/queue.md"}}'
# NOTE: dev-memo/run/log.md is NO LONGER unconditionally allowed — PRC-1 enforces append-only on it
# (dedicated temp-project-dir cases near the end). A bare path-only payload (no content/edits) on
# log.md now fails-closed (unknown tool shape) — covered by the unit suite.

# --- valid parse of a protected target still denies (unchanged behavior) ---
expect DENY  "valid Write to dev-memo/run/config"           '{"tool_input":{"file_path":"dev-memo/run/config"}}'
# PRC-2 scopes protection to THIS workspace's dev-memo/run/ (canonical match), so a foreign
# absolute path under a DIFFERENT root is correctly not this hook's concern; a repo-relative path
# to the protected file is still denied. (Absolute paths under a known root are covered by the
# temp-project-dir PRC-2 section near the end + the runcontrol-canon.test.mjs unit suite.)
expect DENY  "valid Edit to dev-memo/run/last-batch-audit (relative)" '{"tool_input":{"file_path":"dev-memo/run/last-batch-audit"}}'
expect DENY  "valid Write to dev-memo/run/queue.governed"   '{"tool_input":{"file_path":"dev-memo/run/queue.governed"}}'

# --- NEW: parse failure / missing / malformed referencing a protected file -> FAIL CLOSED ---
expect DENY  "malformed JSON (unterminated) referencing config" '{"tool_input":{"file_path":"dev-memo/run/config'
expect DENY  "missing file_path but payload references batch-start" '{"tool_input":{"old_string":"see dev-memo/run/batch-start"}}'
expect DENY  "empty tool_input mentioning risk.flag in a stray field" '{"foo":"dev-memo/run/risk.flag","tool_input":{}}'
expect DENY  "totally unparseable junk mentioning human.override"   'not json at all dev-memo/run/human.override'

# --- parse failure with NO protected reference must NOT over-block ---
expect ALLOW "malformed JSON, no protected reference"       '{"tool_input":{"file_path":"apps/x.ts'
expect ALLOW "missing file_path, no protected reference"    '{"tool_input":{"old_string":"hello world"}}'
expect ALLOW "empty payload"                                '{}'

# --- failure message is actionable ---
msg=$(printf '%s' '{"tool_input":{"old_string":"dev-memo/run/batch-start"}}' | bash "$HOOK" 2>/dev/null)
if printf '%s' "$msg" | grep -q "could not parse" && printf '%s' "$msg" | grep -q "workflow scripts"; then
  pass=$((pass+1))
else
  fail=$((fail+1)); failed="$failed\n  [fail-closed message not actionable] got: $msg"
fi

# --- PRC-1: dev-memo/run/log.md append-only enforcement (deterministic temp project dirs) ---
# Confirms the hook ROUTES *log.md* to the verifier and maps its exit codes; the verifier's own
# logic is exhaustively covered by .claude/hooks/tests/logmd-append-guard.test.mjs.
mk_pd() { local d; d=$(mktemp -d); mkdir -p "$d/dev-memo/run"; if [ -n "${1:-}" ]; then printf '%b' "$1" > "$d/dev-memo/run/log.md"; fi; printf '%s' "$d"; }
decide_pd() { local pd="$1" payload="$2" out; out=$(printf '%s' "$payload" | CLAUDE_PROJECT_DIR="$pd" bash "$HOOK" 2>/dev/null); case "$out" in *'"permissionDecision":"deny"'*) printf DENY ;; *) printf ALLOW ;; esac; }
expect_pd() { local want="$1" label="$2" pd="$3" payload="$4" got; got=$(decide_pd "$pd" "$payload"); if [ "$got" = "$want" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [want $want got $got] $label"; fi; }

PD_A=$(mk_pd)                 # absent log.md
PD_E=$(mk_pd '# trail\n- e1\n')  # existing log.md = "# trail\n- e1\n"

expect_pd ALLOW "create absent log.md (Write)"            "$PD_A" "{\"tool_input\":{\"file_path\":\"$PD_A/dev-memo/run/log.md\",\"content\":\"# trail\\n\"}}"
expect_pd DENY  "Write to EXISTING log.md (create-only)"  "$PD_E" "{\"tool_input\":{\"file_path\":\"$PD_E/dev-memo/run/log.md\",\"content\":\"# trail\\n- e1\\n- e2\\n\"}}"
expect_pd ALLOW "Edit appending at EOF"                   "$PD_E" "{\"tool_input\":{\"file_path\":\"$PD_E/dev-memo/run/log.md\",\"old_string\":\"- e1\\n\",\"new_string\":\"- e1\\n- e2\\n\"}}"
expect_pd DENY  "Edit truncating the trail"              "$PD_E" "{\"tool_input\":{\"file_path\":\"$PD_E/dev-memo/run/log.md\",\"old_string\":\"# trail\\n- e1\\n\",\"new_string\":\"# trail\\n\"}}"
expect_pd DENY  "lexical ../ spelling truncating log.md"  "$PD_E" "{\"tool_input\":{\"file_path\":\"$PD_E/dev-memo/run/../run/log.md\",\"old_string\":\"# trail\\n- e1\\n\",\"new_string\":\"\"}}"
expect_pd ALLOW "cc-suite-reliability-log.md NOT pulled into the special case" "$PD_E" "{\"tool_input\":{\"file_path\":\"$PD_E/dev-memo/cc-suite-reliability-log.md\",\"content\":\"x\"}}"
expect_pd DENY  "config still blanket-denied (regression)" "$PD_E" "{\"tool_input\":{\"file_path\":\"$PD_E/dev-memo/run/config\",\"content\":\"x\"}}"

# node-absent degraded mode must FAIL CLOSED for every routed *log.md* spelling (audit M-fix).
# PATH=/usr/bin:/bin excludes the nvm node, so `command -v node` fails inside the hook.
decide_nonode() { local pd="$1" payload="$2" out; out=$(printf '%s' "$payload" | CLAUDE_PROJECT_DIR="$pd" PATH=/usr/bin:/bin bash "$HOOK" 2>/dev/null); case "$out" in *'"permissionDecision":"deny"'*) printf DENY ;; *) printf ALLOW ;; esac; }
expect_nonode() { local want="$1" label="$2" pd="$3" payload="$4" got; got=$(decide_nonode "$pd" "$payload"); if [ "$got" = "$want" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [want $want got $got] $label"; fi; }
# only run if node is genuinely absent from the reduced PATH (guard against a /usr/bin/node install)
if ! PATH=/usr/bin:/bin command -v node >/dev/null 2>&1; then
  expect_nonode DENY "node-absent: log.md write denied"        "$PD_E" "{\"tool_input\":{\"file_path\":\"$PD_E/dev-memo/run/log.md\",\"content\":\"x\"}}"
  expect_nonode DENY "node-absent: // spelling denied"         "$PD_E" "{\"tool_input\":{\"file_path\":\"$PD_E/dev-memo/run//log.md\",\"content\":\"x\"}}"
  expect_nonode DENY "node-absent: ../ spelling denied"        "$PD_E" "{\"tool_input\":{\"file_path\":\"$PD_E/dev-memo/run/../run/log.md\",\"content\":\"x\"}}"
else
  printf 'protect-run-control: NOTE node present in /usr/bin:/bin; skipped node-absent cases\n'
fi
rm -rf "$PD_A" "$PD_E"

# --- PRC-2: canonical path matching through the hook (temp project dirs) ---
# The expected protected-basename list is an EXPLICIT table here (NOT imported from
# runcontrol-canon.mjs) so the hook E2E is the tested source of truth for the bash-glob -> Node
# shift (per the review). mk_pd/expect_pd/expect_nonode are defined in the PRC-1 section above.
PD2=$(mk_pd)
for base in queue.governed queue.linted queue.reviewed human.ack human.override override-reason.md \
            remediation.authorized \
            batch-start last-batch-audit risk.flag config forbidden-paths.txt .closeout-pending; do
  expect_pd DENY "PRC-2: protected basename $base (canonical)" "$PD2" "{\"tool_input\":{\"file_path\":\"$PD2/dev-memo/run/$base\",\"content\":\"x\"}}"
done
# lexical spelling bypasses (the PRC-2 bug) now DENY
expect_pd DENY  "PRC-2: dev-memo/run/./config"      "$PD2" "{\"tool_input\":{\"file_path\":\"$PD2/dev-memo/run/./config\",\"content\":\"x\"}}"
expect_pd DENY  "PRC-2: dev-memo/run//config"       "$PD2" "{\"tool_input\":{\"file_path\":\"$PD2/dev-memo/run//config\",\"content\":\"x\"}}"
expect_pd DENY  "PRC-2: dev-memo/run/x/../config"   "$PD2" "{\"tool_input\":{\"file_path\":\"$PD2/dev-memo/run/x/../config\",\"content\":\"x\"}}"
# PRC-5: xdev-memo/run/config is a different file -> ALLOW (no false positive)
expect_pd ALLOW "PRC-2/PRC-5: xdev-memo/run/config not falsely denied" "$PD2" "{\"tool_input\":{\"file_path\":\"$PD2/xdev-memo/run/config\",\"content\":\"x\"}}"
# symlink NAMED OUTSIDE dev-memo/run resolving to a protected file -> DENY (outside-symlink closure)
printf 'x' > "$PD2/dev-memo/run/config"
ln -s "$PD2/dev-memo/run/config" "$PD2/clink" 2>/dev/null
expect_pd DENY  "PRC-2: outside-named symlink -> config DENY" "$PD2" "{\"tool_input\":{\"file_path\":\"$PD2/clink\",\"content\":\"x\"}}"
# DANGLING symlink to an ABSENT protected file (a Write through it would CREATE it) -> DENY (audit High)
ln -s "$PD2/dev-memo/run/human.ack" "$PD2/acklink" 2>/dev/null
expect_pd DENY  "PRC-2: dangling symlink -> absent human.ack DENY" "$PD2" "{\"tool_input\":{\"file_path\":\"$PD2/acklink\",\"content\":\"x\"}}"
# node-absent fallback still denies the raw protected path (degraded, not fail-open)
if ! PATH=/usr/bin:/bin command -v node >/dev/null 2>&1; then
  expect_nonode DENY "PRC-2: node-absent fallback denies config" "$PD2" "{\"tool_input\":{\"file_path\":\"$PD2/dev-memo/run/config\",\"content\":\"x\"}}"
fi
rm -rf "$PD2"

# --- PRC-4: deny() must emit VALID JSON for control chars / quotes / backslashes / newlines ---
# Extract the deny() function in isolation (it depends only on $1, jq, sed, tr, printf) and assert the
# output parses as JSON with permissionDecision=deny — for both the jq-present and jq-absent branches.
DENY_DEF=$(sed -n '/^deny(){/,/exit 0; }/p' "$HOOK")
prc4_valid() { # prc4_valid <output> -> OK iff valid JSON + permissionDecision deny
  printf '%s' "$1" | python3 -c "import json,sys
try:
  d=json.load(sys.stdin); print('OK' if d.get('hookSpecificOutput',{}).get('permissionDecision')=='deny' else 'BAD')
except Exception: print('BAD')" 2>/dev/null
}
prc4_check() { # prc4_check <label> <reason> [path-for-jq-control]
  local label=$1 reason=$2 pth=${3:-$PATH} out got
  out=$(PATH="$pth" bash -c "$DENY_DEF"$'\n''deny "$1"' _ "$reason" 2>/dev/null)
  got=$(prc4_valid "$out")
  if [ "$got" = "OK" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [PRC-4 invalid deny JSON] $label :: $(printf '%s' "$out" | head -c 120)"; fi
}
PRC4_NL=$(printf 'reason with\nnewline');     PRC4_TAB=$(printf 'reason\twith tab')
PRC4_CR=$(printf 'reason\rwith cr');          PRC4_QB='reason with "quote" and \backslash'
PRC4_MIX=$(printf 'mix\n\t"q"\\b\rend');       PRC4_NORMAL='plain ascii reason'
# jq-fallback variant: prepend a `jq` STUB that exits non-zero, so deny() takes the no-jq fallback
# branch (also exercises the "jq errors -> fallback" robustness). The fallback's tr/sed come from the
# rest of PATH. (jq is present system-wide here — /usr/bin/jq — so a PATH-strip cannot force absence.)
PRC4_STUB=$(mktemp -d); printf '#!/bin/sh\nexit 1\n' > "$PRC4_STUB/jq"; chmod +x "$PRC4_STUB/jq"
for variant in "jq-present:$PATH" "jq-fallback:$PRC4_STUB:$PATH"; do
  vlabel=${variant%%:*}; vpath=${variant#*:}
  prc4_check "PRC-4 $vlabel newline"   "$PRC4_NL"     "$vpath"
  prc4_check "PRC-4 $vlabel tab"       "$PRC4_TAB"    "$vpath"
  prc4_check "PRC-4 $vlabel CR"        "$PRC4_CR"     "$vpath"
  prc4_check "PRC-4 $vlabel quote+bs"  "$PRC4_QB"     "$vpath"
  prc4_check "PRC-4 $vlabel mixed"     "$PRC4_MIX"    "$vpath"
  prc4_check "PRC-4 $vlabel normal"    "$PRC4_NORMAL" "$vpath"
done
rm -rf "$PRC4_STUB"

printf 'protect-run-control: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
