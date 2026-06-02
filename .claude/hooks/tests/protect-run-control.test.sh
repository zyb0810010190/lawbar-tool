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
expect ALLOW "valid Write to dev-memo/run/log.md (audit trail, not in protected list)" '{"tool_input":{"file_path":"dev-memo/run/log.md"}}'

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

printf 'protect-run-control: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
