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
expect DENY  "valid Edit to .../dev-memo/run/last-batch-audit (absolute)" '{"tool_input":{"file_path":"/Users/x/p/dev-memo/run/last-batch-audit"}}'
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

printf 'protect-run-control: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
