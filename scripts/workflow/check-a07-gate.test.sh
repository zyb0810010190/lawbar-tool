#!/bin/bash
# check-a07-gate.test.sh — tests for the EVW5 A0.7 hard gate (WI-EVW5). Builds throwaway temp project
# dirs + an ephemeral HMAC key; writes NO real marker/key into the repo. Binds markers to the
# committed fixture/oracle (read-only). Run: bash scripts/workflow/check-a07-gate.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/check-a07-gate.sh"; MARK="$HERE/a07_marker.py"
REPO="$(cd "$HERE/../.." && pwd)"
FX="$REPO/native/evidence-core-swift/Tests/EvidenceCoreSmokeTests/Fixtures/synthetic-twopage.pdf"
OR="$REPO/native/evidence-core-swift/Tests/EvidenceCoreSmokeTests/Fixtures/a07-renderer-conformance/oracle.json"
KEY="ephemeral-test-key-0123456789-abcdefghij"
pass=0; fail=0; failed=""
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); failed="$failed\n  $1"; }

# Sets global T to a fresh temp project; ABORTS the whole test (exit 1) on any setup failure, so a
# denied mktemp/git/mkdir can never leave T empty and cause writes to /dev-memo/... (fail fast).
require_project() {
  T=$(mktemp -d) || { echo "FATAL: mktemp failed (writable temp required)"; exit 1; }
  ( cd "$T" && git init -q && git config user.email t@t && git config user.name t ) \
    || { echo "FATAL: git init failed in $T"; exit 1; }
  mkdir -p "$T/dev-memo/run" || { echo "FATAL: mkdir failed in $T"; exit 1; }
  printf '## WI-x\nType: IMPL\n' > "$T/dev-memo/run/queue.md"
}
seed_marker() {
  LAWBAR_A07_MARKER_HMAC_KEY="$KEY" python3 "$MARK" write --fixture "$FX" --oracle "$OR" \
    --status pass --classification ok --page-count 2 --tolerance 1e-9 --command t --platform t \
    --out-root "$1/dev-memo/run/evidence" --repo-commit aa11bb22 --repo-tree cc33dd44 \
    --harness-commit aa11bb22 --produced-at 2026-06-23T00:00:00Z >/dev/null
}
run_gate() { # <project> <required?0/1> <withKey?0/1> -> rc
  local T="$1" req="$2" wk="$3"; local -a envs=("CLAUDE_PROJECT_DIR=$T")
  [ "$req" = 1 ] && envs+=("A07_REQUIRED=1")
  [ "$wk" = 1 ] && envs+=("LAWBAR_A07_MARKER_HMAC_KEY=$KEY")
  env "${envs[@]}" bash "$GATE" >/dev/null 2>&1; echo $?
}

# 1. not required + clean tree -> pass
require_project; [ "$(run_gate "$T" 0 0)" = 0 ] && ok || bad "not-required clean tree should pass"; rm -rf "$T"
# 2. required (env) + no marker -> fail closed
require_project; [ "$(run_gate "$T" 1 1)" = 2 ] && ok || bad "required + no marker should fail closed"; rm -rf "$T"
# 3. required + genuine marker + NO key -> fail closed (unverifiable)
require_project; seed_marker "$T"; [ "$(run_gate "$T" 1 0)" = 2 ] && ok || bad "required + marker + no key should fail closed"; rm -rf "$T"
# 4. required + genuine marker + key -> pass
require_project; seed_marker "$T"; [ "$(run_gate "$T" 1 1)" = 0 ] && ok || bad "required + genuine marker + key should pass"; rm -rf "$T"
# 5. required + fabricated marker + key -> fail (guard rejects fabricated)
require_project; mkdir -p "$T/dev-memo/run/evidence/a07"; echo '{"fabricated":true}' > "$T/dev-memo/run/evidence/a07/x.marker.json"
[ "$(run_gate "$T" 1 1)" = 2 ] && ok || bad "required + fabricated marker should fail"; rm -rf "$T"
# 6. not required + fabricated marker + key -> fail (fabricated always rejected)
require_project; mkdir -p "$T/dev-memo/run/evidence/a07"; echo '{"fabricated":true}' > "$T/dev-memo/run/evidence/a07/x.marker.json"
[ "$(run_gate "$T" 0 1)" = 2 ] && ok || bad "not-required + fabricated marker should still fail"; rm -rf "$T"
# 7. not required + genuine marker + key -> pass
require_project; seed_marker "$T"; [ "$(run_gate "$T" 0 1)" = 0 ] && ok || bad "not-required + genuine marker + key should pass"; rm -rf "$T"
# 8. required via queue "Requires-A07: true" (no env) + genuine marker + key -> pass
require_project; printf 'Requires-A07: true\n' >> "$T/dev-memo/run/queue.md"; seed_marker "$T"
[ "$(CLAUDE_PROJECT_DIR="$T" LAWBAR_A07_MARKER_HMAC_KEY="$KEY" bash "$GATE" >/dev/null 2>&1; echo $?)" = 0 ] && ok || bad "queue Requires-A07 + genuine marker + key should pass"; rm -rf "$T"
# 9. required via queue line + no marker -> fail closed
require_project; printf 'Requires-A07: yes\n' >> "$T/dev-memo/run/queue.md"
[ "$(CLAUDE_PROJECT_DIR="$T" LAWBAR_A07_MARKER_HMAC_KEY="$KEY" bash "$GATE" >/dev/null 2>&1; echo $?)" = 2 ] && ok || bad "queue Requires-A07 + no marker should fail closed"; rm -rf "$T"
# 10. committed (tracked) marker material -> fail unconditionally (even if not required)
require_project; mkdir -p "$T/dev-memo/run/evidence/a07"; echo '{}' > "$T/dev-memo/run/evidence/a07/c.marker.json"
( cd "$T" && git add -f dev-memo/run/evidence/a07/c.marker.json >/dev/null 2>&1 )
[ "$(run_gate "$T" 0 1)" = 2 ] && ok || bad "committed/tracked marker material should fail unconditionally"; rm -rf "$T"
# 11. gate does not create the namespace on a clean not-required run
require_project; run_gate "$T" 0 0 >/dev/null; { [ ! -e "$T/dev-memo/run/evidence" ]; } && ok || bad "gate must not create the marker namespace"; rm -rf "$T"
# 12. genuine marker present but isMarker tampered true->false -> fail (ENA11-FIX1 binding)
require_project; seed_marker "$T"
MF=$(ls "$T"/dev-memo/run/evidence/a07/*.marker.json)
python3 -c "import json,sys;m=json.load(open(sys.argv[1]));m['isMarker']=False;json.dump(m,open(sys.argv[1],'w'))" "$MF"
[ "$(run_gate "$T" 1 1)" = 2 ] && ok || bad "isMarker-tampered marker must fail the gate (required)"; rm -rf "$T"

if [ "$fail" -eq 0 ]; then echo "check-a07-gate.test.sh: ALL $pass PASS"; exit 0
else echo "check-a07-gate.test.sh: $fail FAIL / $pass PASS"; printf '%b\n' "$failed"; exit 1; fi
