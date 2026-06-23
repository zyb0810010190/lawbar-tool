#!/bin/bash
# a07-marker.test.sh — tests for the A0.7 marker write/validate core + guard integration (WI-ENA11).
# Uses an EPHEMERAL temp HMAC key + temp project dirs; writes NO real marker/key into the repo, and
# binds markers to the committed fixture/oracle (read-only). Run: bash scripts/workflow/a07-marker.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
MARK="$HERE/a07_marker.py"; GUARD="$HERE/check-marker-guard.sh"
REPO="$(cd "$HERE/../.." && pwd)"
FX="$REPO/native/evidence-core-swift/Tests/EvidenceCoreSmokeTests/Fixtures/synthetic-twopage.pdf"
OR="$REPO/native/evidence-core-swift/Tests/EvidenceCoreSmokeTests/Fixtures/a07-renderer-conformance/oracle.json"
GOODKEY="ephemeral-test-key-0123456789-abcdefghij"   # >= 32 chars
pass=0; fail=0; failed=""
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); failed="$failed\n  $1"; }

# write_marker <out-root> <repo-commit> [extra args...] -> echoes marker path (key = GOODKEY)
write_marker() {
  local root="$1" commit="$2"; shift 2
  LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" python3 "$MARK" write \
    --fixture "$FX" --oracle "$OR" --status pass --classification ok --page-count 2 \
    --tolerance 1e-9 --command "test" --platform "test-offline" \
    --out-root "$root" --repo-commit "$commit" --repo-tree "tree-$commit" \
    --harness-commit "$commit" --produced-at "2026-06-23T00:00:00Z" "$@"
}
rc_of() { "$@" >/dev/null 2>&1; echo $?; }

# 1. write fails closed without a key
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="" rc_of python3 "$MARK" write --fixture "$FX" --oracle "$OR" --status pass --classification ok --page-count 2 --tolerance 1e-9 --command c --platform p --out-root /tmp/na --repo-commit x --repo-tree y --harness-commit x)" = 3 ] && ok || bad "write without key should exit 3"
# 2. write fails closed with a weak (short) key
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="short" rc_of python3 "$MARK" write --fixture "$FX" --oracle "$OR" --status pass --classification ok --page-count 2 --tolerance 1e-9 --command c --platform p --out-root /tmp/na --repo-commit x --repo-tree y --harness-commit x)" = 3 ] && ok || bad "write with weak key should exit 3"
# 3. write refuses a non-eligible verdict (status=fail / class_2 etc.)
T=$(mktemp -d)
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of python3 "$MARK" write --fixture "$FX" --oracle "$OR" --status fail --classification class_2_geometry_source_instability --page-count 2 --tolerance 1e-9 --command c --platform p --out-root "$T" --repo-commit x --repo-tree y --harness-commit x)" = 4 ] && ok || bad "write non-eligible (fail/class_2) should exit 4"
[ ! -e "$T/a07" ] && ok || bad "non-eligible write must not create a marker"
rm -rf "$T"

# 3b. write refuses a path-traversal repo-commit (must not escape --out-root)
T=$(mktemp -d)
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of python3 "$MARK" write --fixture "$FX" --oracle "$OR" --status pass --classification ok --page-count 2 --tolerance 1e-9 --command c --platform p --out-root "$T" --repo-commit "../../escape" --repo-tree y --harness-commit x)" = 5 ] && ok || bad "traversal repo-commit should exit 5"
{ [ ! -e "$T/../escape.marker.json" ] && [ ! -e "$T/a07" ]; } && ok || bad "traversal write must not create any file outside out-root/a07"
rm -rf "$T"

# 4-5. genuine write + validate
T=$(mktemp -d); OUT="$T/dev-memo/run/evidence"
MKPATH="$(write_marker "$OUT" aa11bb22)"; wrc=$?
{ [ "$wrc" = 0 ] && [ -f "$MKPATH" ] && [ -f "$OUT/ledger.jsonl" ]; } && ok || bad "genuine write should produce marker + ledger"
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of python3 "$MARK" validate --marker "$MKPATH" --ledger "$OUT/ledger.jsonl")" = 0 ] && ok || bad "genuine marker should validate (exit 0)"
# 5b. (WI-ENA11-FIX1) flipping ONLY isMarker true -> false fails validation (bound + checked)
cp "$MKPATH" "$T/ismarker-flip.json"
python3 -c "import json,sys;m=json.load(open(sys.argv[1]));assert m['isMarker'] is True;m['isMarker']=False;json.dump(m,open(sys.argv[1],'w'))" "$T/ismarker-flip.json"
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of python3 "$MARK" validate --marker "$T/ismarker-flip.json" --ledger "$OUT/ledger.jsonl")" != 0 ] && ok || bad "isMarker true->false must fail validation"

# 6. touched marker fails
cp "$MKPATH" "$T/touched.json"; python3 -c "import json,sys;m=json.load(open(sys.argv[1]));m['observedPageCount']=99;json.dump(m,open(sys.argv[1],'w'))" "$T/touched.json"
# validate the touched copy against the ledger entry's path? touched.json runId still matches but path differs -> reject anyway
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of python3 "$MARK" validate --marker "$T/touched.json" --ledger "$OUT/ledger.jsonl")" != 0 ] && ok || bad "touched marker should fail validation"
# 7. copied marker (same runId, different path) fails the ledger path binding
cp "$MKPATH" "$OUT/a07/copy.marker.json"
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of python3 "$MARK" validate --marker "$OUT/a07/copy.marker.json" --ledger "$OUT/ledger.jsonl")" != 0 ] && ok || bad "copied marker should fail (ledger path binding)"
rm -f "$OUT/a07/copy.marker.json"
# 8. schema-only marker (no provenance) fails
echo '{"gateId":"A07-GATE-00","schemaVersion":"a07-marker/1.0.0"}' > "$T/schema-only.marker.json"
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of python3 "$MARK" validate --marker "$T/schema-only.marker.json" --ledger "$OUT/ledger.jsonl")" != 0 ] && ok || bad "schema-only marker should fail"
# 9. invalid HMAC (validate with a different key) fails
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="a-different-ephemeral-key-0123456789zzzz" rc_of python3 "$MARK" validate --marker "$MKPATH" --ledger "$OUT/ledger.jsonl")" != 0 ] && ok || bad "wrong-key (invalid HMAC) should fail"
# 10. duplicate runId in ledger -> ambiguous -> fail
RID="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['runId'])" "$MKPATH")"
cp "$OUT/ledger.jsonl" "$T/dup-ledger.jsonl"; tail -n1 "$OUT/ledger.jsonl" >> "$T/dup-ledger.jsonl"
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of python3 "$MARK" validate --marker "$MKPATH" --ledger "$T/dup-ledger.jsonl")" != 0 ] && ok || bad "duplicate runId in ledger should fail (non-replay ambiguity)"

# 11-12. guard --scan over a temp project root with the genuine marker.
TP=$(mktemp -d); ( cd "$TP" && git init -q && git config user.email t@t && git config user.name t )
mkdir -p "$TP/dev-memo/run"; printf 'x\n' > "$TP/dev-memo/run/queue.md"
write_marker "$TP/dev-memo/run/evidence" aa11bb22 >/dev/null
[ "$(CLAUDE_PROJECT_DIR="$TP" LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of bash "$GUARD" --scan)" = 0 ] && ok || bad "guard --scan should ACCEPT a genuine local marker when key+ledger present"
[ "$(CLAUDE_PROJECT_DIR="$TP" rc_of bash "$GUARD" --scan)" = 2 ] && ok || bad "guard --scan should FAIL closed for a local marker when key is absent"
rm -rf "$T" "$TP"

if [ "$fail" -eq 0 ]; then echo "a07-marker.test.sh: ALL $pass PASS"; exit 0
else echo "a07-marker.test.sh: $fail FAIL / $pass PASS"; printf '%b\n' "$failed"; exit 1; fi
