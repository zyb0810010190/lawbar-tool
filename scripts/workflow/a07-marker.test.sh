#!/bin/bash
# a07-marker.test.sh — tests for the A0.7 marker write/validate core + guard integration
# (WI-ENA11; WI-ENA11-FIX1; harness-attestation binding added in WI-A07-MARKER-BIND).
#
# Uses an EPHEMERAL temp HMAC key + temp project dirs; writes NO real marker/key into the repo, never
# reads ~/.lawbar-a07-key, and never touches dev-memo/run/**. The committed fixture/oracle are
# READ-ONLY inputs: mutation cases bind markers to throwaway COPIES instead.
# Run: bash scripts/workflow/a07-marker.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
MARK="$HERE/a07_marker.py"; GUARD="$HERE/check-marker-guard.sh"; WRITER="$HERE/a07-marker-write.sh"
REPO="$(cd "$HERE/../.." && pwd)"
PKG="$REPO/native/evidence-core-swift"
FX="$PKG/Tests/EvidenceCoreSmokeTests/Fixtures/synthetic-twopage.pdf"
OR="$PKG/Tests/EvidenceCoreSmokeTests/Fixtures/a07-renderer-conformance/oracle.json"
GOODKEY="ephemeral-test-key-0123456789-abcdefghij"   # >= 32 chars, throwaway; the real key is never read
export A07_HERE="$HERE"
# The re-sign helper imports a07_marker as a module; keep it from leaving a __pycache__ in the repo.
export PYTHONDONTWRITEBYTECODE=1
pass=0; fail=0; failed=""; skipped=""
ok()   { pass=$((pass+1)); }
bad()  { fail=$((fail+1)); failed="$failed\n  $1"; }
skip() { skipped="$skipped\n  $1"; }

# The fixture/oracle a write binds to. Mutation cases repoint these at throwaway copies.
WFX="$FX"; WOR="$OR"

rc_of() { "$@" >/dev/null 2>&1; echo $?; }
sha_of() { python3 -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$1"; }
field()  { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$1" "$2"; }

# stub_harness <path> <status> <classification> <pageCount>
# Runnable stand-in for a07-harness-cli: prints the SAME one-line TSV contract on stdout and exits 0
# iff status=pass. The marker binds this file's sha256, so editing/rebuilding it must invalidate the
# markers it produced.
stub_harness() {
  mkdir -p "$(dirname "$1")"
  cat > "$1" <<EOF
#!/bin/sh
printf '%s\t%s\t%s\n' '$2' '$3' '$4'
[ '$2' = pass ] && exit 0
exit 1
EOF
  chmod +x "$1"
}

# capture <bin> <fixture> <oracle> <stdout-file> -> echoes the harness exit code.
# stdout is redirected to a FILE, never captured through $(...): command substitution strips trailing
# newlines and would silently break the byte-exact stdout binding.
capture() { "$1" "$2" "$3" >"$4" 2>/dev/null; echo $?; }

# seed_run <dir> <status> <classification> <pageCount> -> sets SBIN / SOUT / SRC
seed_run() {
  SBIN="$1/harness/a07-harness-cli"; SOUT="$1/harness/stdout.bin"
  stub_harness "$SBIN" "$2" "$3" "$4"
  SRC="$(capture "$SBIN" "$WFX" "$WOR" "$SOUT")"
}

# write_marker <out-root> <repo-commit> <harness-bin> <stdout-file> <harness-exit> [extra args...]
# -> prints the marker path (key = GOODKEY). NO --status/--classification exists: the verdict is
# derived from the harness's own captured stdout bytes.
write_marker() {
  local root="$1" commit="$2" bin="$3" hout="$4" hrc="$5"; shift 5
  LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" python3 "$MARK" write \
    --fixture "$WFX" --oracle "$WOR" \
    --harness-bin "$bin" --harness-stdout "$hout" --harness-exit "$hrc" \
    --command "test" --platform "test-offline" \
    --out-root "$root" --repo-commit "$commit" --repo-tree "tree-$commit" \
    --harness-commit "$commit" --produced-at "2026-06-23T00:00:00Z" "$@"
}

# val_rc <marker> <ledger> [key] -> echoes the validate exit code
val_rc() {
  local k="${3-$GOODKEY}"
  LAWBAR_A07_MARKER_HMAC_KEY="$k" python3 "$MARK" validate --marker "$1" --ledger "$2" >/dev/null 2>&1
  echo $?
}

# resign <marker> <ledger> <python-mutation> — mutate the marker payload and RE-SIGN it with the good
# key (refreshing the ledger row). These cases prove the SEMANTIC checks bite: anyone holding the key
# can mint a well-formed HMAC, so validity must never rest on the HMAC alone.
resign() {
  LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" python3 - "$1" "$2" "$3" <<'PY'
import base64, hashlib, json, os, sys
sys.path.insert(0, os.environ["A07_HERE"])
import a07_marker as A
mk, ledger, mutation = sys.argv[1], sys.argv[2], sys.argv[3]
with open(mk, encoding="utf-8") as f:
    m = json.load(f)
exec(mutation, {"m": m, "base64": base64, "hashlib": hashlib})
canon = A._canonical({k: m[k] for k in A.PAYLOAD_FIELDS})
m["provenancePayloadHash"] = A._payload_hash(canon)
m["provenance"] = A._hmac_hex(os.environ["LAWBAR_A07_MARKER_HMAC_KEY"], canon)
with open(mk, "w", encoding="utf-8") as f:
    json.dump(m, f, indent=2, sort_keys=True); f.write("\n")
with open(ledger, encoding="utf-8") as f:
    rows = [json.loads(l) for l in f if l.strip()]
for r in rows:
    if r.get("runId") == m["runId"]:
        for k in list(r):
            if k in m and k != "markerPath":
                r[k] = m[k]
        r["provenancePayloadHash"] = m["provenancePayloadHash"]
with open(ledger, "w", encoding="utf-8") as f:
    for r in rows:
        f.write(json.dumps(r, separators=(",", ":"), ensure_ascii=True) + "\n")
PY
}

# broken_toolchain <dir> — plants a PYTHONPATH shim whose sha256 returns a WRONG digest, so the
# module's hashing self-check must fail closed rather than sign/verify with a broken primitive.
broken_toolchain() {
  mkdir -p "$1"
  cat > "$1/hashlib.py" <<'PY'
class _H:
    def update(self, b): return None
    def hexdigest(self): return "0" * 64
    def digest(self): return b"\x00" * 32
def sha256(data=b""): return _H()
def new(name, data=b""): return _H()
PY
}

# ---------------------------------------------------------------------------------------------
# Key custody: write fails closed without / with a weak key.
# ---------------------------------------------------------------------------------------------
T=$(mktemp -d); seed_run "$T" pass ok 2
# 1.
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="" rc_of python3 "$MARK" write --fixture "$FX" --oracle "$OR" \
   --harness-bin "$SBIN" --harness-stdout "$SOUT" --harness-exit "$SRC" --command c --platform p \
   --out-root "$T/na" --repo-commit aa11bb22 --repo-tree y --harness-commit aa11bb22)" = 3 ] \
   && ok || bad "write without key should exit 3"
# 2.
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="short" rc_of python3 "$MARK" write --fixture "$FX" --oracle "$OR" \
   --harness-bin "$SBIN" --harness-stdout "$SOUT" --harness-exit "$SRC" --command c --platform p \
   --out-root "$T/na" --repo-commit aa11bb22 --repo-tree y --harness-commit aa11bb22)" = 3 ] \
   && ok || bad "write with weak key should exit 3"
# 3. no marker namespace may be created by a fail-closed write
[ ! -e "$T/na" ] && ok || bad "fail-closed write must not create the out-root"
rm -rf "$T"

# ---------------------------------------------------------------------------------------------
# THE DEFECT (WI-A07-MARKER-BIND): a caller-asserted verdict with NO harness attestation.
# ---------------------------------------------------------------------------------------------
# 4. the old caller-asserted form (--status/--classification/--page-count/--tolerance) is REFUSED.
T=$(mktemp -d)
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of python3 "$MARK" write --fixture "$FX" --oracle "$OR" \
   --status pass --classification ok --page-count 2 --tolerance 1e-9 --command c --platform p \
   --out-root "$T" --repo-commit aa11bb22 --repo-tree y --harness-commit aa11bb22)" != 0 ] \
   && ok || bad "caller-asserted --status pass with no harness run must be REFUSED"
# 5.
[ ! -e "$T/a07" ] && ok || bad "caller-asserted write must not create a marker"
# 6. omitting the harness attestation entirely is REFUSED (no default/optional path)
[ "$(LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of python3 "$MARK" write --fixture "$FX" --oracle "$OR" \
   --command c --platform p --out-root "$T" --repo-commit aa11bb22 --repo-tree y \
   --harness-commit aa11bb22)" != 0 ] && ok || bad "write without harness attestation must be REFUSED"
# 7.
[ ! -e "$T/a07" ] && ok || bad "attestation-less write must not create a marker"
rm -rf "$T"

# ---------------------------------------------------------------------------------------------
# The verdict is DERIVED from the harness's own stdout — non-pass verdicts write NO marker.
# (evidence-genie.md inv.10: not_implemented / inconclusive are FAILURES, never a pass.)
# ---------------------------------------------------------------------------------------------
non_eligible() { # <label> <status> <classification>
  local T; T=$(mktemp -d); seed_run "$T" "$2" "$3" 2
  [ "$(rc_of write_marker "$T/out" aa11bb22 "$SBIN" "$SOUT" "$SRC")" = 4 ] && ok || bad "$1 should exit 4"
  [ ! -e "$T/out/a07" ] && ok || bad "$1 must not create a marker"
  rm -rf "$T"
}
# 8-9.
non_eligible "harness fail/class_2" fail class_2_geometry_source_instability
# 10-11.
non_eligible "harness fail/class_1" fail class_1_normalization_math_bug
# 12-13.
non_eligible "harness not_implemented" fail not_implemented
# 14-15.
non_eligible "harness inconclusive" inconclusive inconclusive_no_checkable_assertions

# ---------------------------------------------------------------------------------------------
# Fail closed on an exit code inconsistent with the parsed verdict, or unusable harness output.
# ---------------------------------------------------------------------------------------------
T=$(mktemp -d); seed_run "$T" pass ok 2
# 16. a pass verdict claimed with a non-zero harness exit is incoherent
[ "$(rc_of write_marker "$T/out" aa11bb22 "$SBIN" "$SOUT" 1)" = 7 ] && ok || bad "pass verdict + exit 1 should exit 7"
# 17.
[ ! -e "$T/out/a07" ] && ok || bad "inconsistent exit code must not create a marker"
rm -rf "$T"
T=$(mktemp -d); seed_run "$T" fail class_2_geometry_source_instability 2
# 18. a non-pass verdict claimed with exit 0 is incoherent (checked BEFORE eligibility)
[ "$(rc_of write_marker "$T/out" aa11bb22 "$SBIN" "$SOUT" 0)" = 7 ] && ok || bad "fail verdict + exit 0 should exit 7"
rm -rf "$T"

bad_stdout() { # <label> <printf-format> [args...]
  local T; T=$(mktemp -d); seed_run "$T" pass ok 2
  local f="$1"; shift
  printf "$@" > "$SOUT"
  [ "$(rc_of write_marker "$T/out" aa11bb22 "$SBIN" "$SOUT" 0)" = 7 ] && ok || bad "$f should exit 7"
  [ ! -e "$T/out/a07" ] && ok || bad "$f must not create a marker"
  rm -rf "$T"
}
# 19-20.
bad_stdout "empty harness stdout" ''
# 21-22.
bad_stdout "two-field harness stdout" 'pass\tok\n'
# 23-24.
bad_stdout "multi-line harness stdout" 'pass\tok\t2\npass\tok\t2\n'
# 25-26.
bad_stdout "non-integer page count" 'pass\tok\ttwo\n'
# 27-28.
bad_stdout "status outside the harness vocabulary" 'green\tok\t2\n'
# 29-30.
bad_stdout "classification outside the harness vocabulary" 'pass\tgreat\t2\n'

T=$(mktemp -d); seed_run "$T" pass ok 2
# 31. missing stdout file
[ "$(rc_of write_marker "$T/out" aa11bb22 "$SBIN" "$T/harness/absent.bin" 0)" = 7 ] \
  && ok || bad "missing harness stdout should exit 7"
# 32. missing harness binary
[ "$(rc_of write_marker "$T/out" aa11bb22 "$T/harness/absent-cli" "$SOUT" 0)" = 7 ] \
  && ok || bad "missing harness binary should exit 7"
# 33. non-executable harness binary
cp "$SOUT" "$T/harness/not-exec"; chmod -x "$T/harness/not-exec"
[ "$(rc_of write_marker "$T/out" aa11bb22 "$T/harness/not-exec" "$SOUT" 0)" = 7 ] \
  && ok || bad "non-executable harness binary should exit 7"
# 34. path-traversal repo-commit still refused (must never escape --out-root)
[ "$(rc_of write_marker "$T/out" "../../escape" "$SBIN" "$SOUT" 0)" = 5 ] \
  && ok || bad "traversal repo-commit should exit 5"
# 35.
{ [ ! -e "$T/escape.marker.json" ] && [ ! -e "$T/out/a07" ]; } \
  && ok || bad "traversal write must not create any file outside out-root/a07"
rm -rf "$T"

# ---------------------------------------------------------------------------------------------
# Genuine (stub-harness) write + validate, and what the marker actually binds.
# ---------------------------------------------------------------------------------------------
T=$(mktemp -d); OUT="$T/dev-memo/run/evidence"; seed_run "$T" pass ok 2
MKPATH="$(write_marker "$OUT" aa11bb22 "$SBIN" "$SOUT" "$SRC")"; wrc=$?
# 36.
{ [ "$wrc" = 0 ] && [ -f "$MKPATH" ] && [ -f "$OUT/ledger.jsonl" ]; } \
  && ok || bad "genuine write should produce marker + ledger"
# 37.
[ "$(val_rc "$MKPATH" "$OUT/ledger.jsonl")" = 0 ] && ok || bad "genuine marker should validate (exit 0)"
# 38. the verdict recorded is the one the harness printed (not one the caller chose)
{ [ "$(field "$MKPATH" resultStatus)" = pass ] && [ "$(field "$MKPATH" resultClassification)" = ok ] \
  && [ "$(field "$MKPATH" observedPageCount)" = 2 ]; } \
  && ok || bad "marker verdict must be derived from the harness stdout"
# 39. the exact stdout bytes are bound
[ "$(field "$MKPATH" harnessStdoutSha256)" = "$(sha_of "$SOUT")" ] \
  && ok || bad "marker must bind the sha256 of the exact harness stdout bytes"
# 40. the producing binary is bound
[ "$(field "$MKPATH" harnessBinarySha256)" = "$(sha_of "$SBIN")" ] \
  && ok || bad "marker must bind the sha256 of the harness binary"
# 41-42. fixture/oracle hashes are COMPUTED by the writer, not asserted by the caller
[ "$(field "$MKPATH" fixtureSha256)" = "$(sha_of "$FX")" ] && ok || bad "marker must bind the computed fixture sha256"
[ "$(field "$MKPATH" oracleSha256)" = "$(sha_of "$OR")" ] && ok || bad "marker must bind the computed oracle sha256"
# 43. the harness exit code is bound
[ "$(field "$MKPATH" harnessExitCode)" = 0 ] && ok || bad "marker must bind the harness exit code"

# ---------------------------------------------------------------------------------------------
# Tamper / replay (retained coverage).
# ---------------------------------------------------------------------------------------------
# 44. flipping ONLY isMarker true -> false fails validation (WI-ENA11-FIX1)
cp "$MKPATH" "$T/ismarker-flip.json"
python3 -c "import json,sys;m=json.load(open(sys.argv[1]));assert m['isMarker'] is True;m['isMarker']=False;json.dump(m,open(sys.argv[1],'w'))" "$T/ismarker-flip.json"
[ "$(val_rc "$T/ismarker-flip.json" "$OUT/ledger.jsonl")" != 0 ] && ok || bad "isMarker true->false must fail validation"
# 45. touched marker fails
cp "$MKPATH" "$T/touched.json"
python3 -c "import json,sys;m=json.load(open(sys.argv[1]));m['observedPageCount']=99;json.dump(m,open(sys.argv[1],'w'))" "$T/touched.json"
[ "$(val_rc "$T/touched.json" "$OUT/ledger.jsonl")" != 0 ] && ok || bad "touched marker should fail validation"
# 46. copied marker (same runId, different path) fails the ledger path binding
cp "$MKPATH" "$OUT/a07/copy.marker.json"
[ "$(val_rc "$OUT/a07/copy.marker.json" "$OUT/ledger.jsonl")" != 0 ] && ok || bad "copied marker should fail (ledger path binding)"
rm -f "$OUT/a07/copy.marker.json"
# 47. schema-only marker (no provenance) fails
echo '{"gateId":"A07-GATE-00","schemaVersion":"a07-marker/1.0.0"}' > "$T/schema-only.marker.json"
[ "$(val_rc "$T/schema-only.marker.json" "$OUT/ledger.jsonl")" != 0 ] && ok || bad "schema-only marker should fail"
# 48. wrong key fails
[ "$(val_rc "$MKPATH" "$OUT/ledger.jsonl" "a-different-ephemeral-key-0123456789zzzz")" != 0 ] \
  && ok || bad "wrong-key (invalid HMAC) should fail"
# 49. missing key at validate fails closed
[ "$(val_rc "$MKPATH" "$OUT/ledger.jsonl" "")" != 0 ] && ok || bad "validate without a key should fail closed"
# 50. short key at validate fails closed
[ "$(val_rc "$MKPATH" "$OUT/ledger.jsonl" "short")" != 0 ] && ok || bad "validate with a weak key should fail closed"
# 51. duplicate runId in ledger -> ambiguous -> fail
cp "$OUT/ledger.jsonl" "$T/dup-ledger.jsonl"; tail -n1 "$OUT/ledger.jsonl" >> "$T/dup-ledger.jsonl"
[ "$(val_rc "$MKPATH" "$T/dup-ledger.jsonl")" != 0 ] && ok || bad "duplicate runId in ledger should fail (non-replay ambiguity)"

# ---------------------------------------------------------------------------------------------
# NEW: a marker may not silently outlive the inputs/outputs it attests to.
# ---------------------------------------------------------------------------------------------
# 52. an older marker schema (no harness attestation) is refused even when correctly re-signed
cp "$MKPATH" "$T/v1.marker.json"; cp "$OUT/ledger.jsonl" "$T/v1-ledger.jsonl"
resign "$T/v1.marker.json" "$T/v1-ledger.jsonl" "m['schemaVersion']='a07-marker/1.0.0'"
python3 -c "import json,sys;rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
for r in rows: r['markerPath']=sys.argv[2]
open(sys.argv[1],'w').write(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in rows))" \
  "$T/v1-ledger.jsonl" "$T/v1.marker.json"
[ "$(val_rc "$T/v1.marker.json" "$T/v1-ledger.jsonl")" != 0 ] && ok || bad "a pre-attestation marker schema must be refused"
# 53. verdict desynced from the recorded harness stdout (re-signed with the good key) is refused
cp "$MKPATH" "$T/desync.marker.json"; cp "$OUT/ledger.jsonl" "$T/desync-ledger.jsonl"
resign "$T/desync.marker.json" "$T/desync-ledger.jsonl" \
  "raw=b'fail\tclass_2_geometry_source_instability\t2\n';m['harnessStdoutBase64']=base64.b64encode(raw).decode();m['harnessStdoutSha256']=hashlib.sha256(raw).hexdigest()"
python3 -c "import json,sys;rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
for r in rows: r['markerPath']=sys.argv[2]
open(sys.argv[1],'w').write(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in rows))" \
  "$T/desync-ledger.jsonl" "$T/desync.marker.json"
[ "$(val_rc "$T/desync.marker.json" "$T/desync-ledger.jsonl")" != 0 ] \
  && ok || bad "a verdict desynced from the recorded harness stdout must be refused"
# 54. a wrong recorded stdout hash (re-signed) is refused
cp "$MKPATH" "$T/hash-desync.marker.json"; cp "$OUT/ledger.jsonl" "$T/hash-desync-ledger.jsonl"
resign "$T/hash-desync.marker.json" "$T/hash-desync-ledger.jsonl" "m['harnessStdoutSha256']='0'*64"
python3 -c "import json,sys;rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
for r in rows: r['markerPath']=sys.argv[2]
open(sys.argv[1],'w').write(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in rows))" \
  "$T/hash-desync-ledger.jsonl" "$T/hash-desync.marker.json"
[ "$(val_rc "$T/hash-desync.marker.json" "$T/hash-desync-ledger.jsonl")" != 0 ] \
  && ok || bad "a wrong recorded harness-stdout hash must be refused"
# 55. the harness binary rebuilt/edited after the marker -> refuse (no replay across binaries)
cp "$SBIN" "$T/harness/orig-cli"; printf '# rebuilt\n' >> "$SBIN"
[ "$(val_rc "$MKPATH" "$OUT/ledger.jsonl")" != 0 ] && ok || bad "a rebuilt/edited harness binary must invalidate the marker"
cp "$T/harness/orig-cli" "$SBIN"; chmod +x "$SBIN"
# 56. restoring the exact binary restores validity (the check is the bytes, not a timestamp)
[ "$(val_rc "$MKPATH" "$OUT/ledger.jsonl")" = 0 ] && ok || bad "restoring the exact harness binary should re-validate"
# 57. the harness binary deleted after the marker -> refuse
mv "$SBIN" "$T/harness/moved-cli"
[ "$(val_rc "$MKPATH" "$OUT/ledger.jsonl")" != 0 ] && ok || bad "a missing harness binary must invalidate the marker"
mv "$T/harness/moved-cli" "$SBIN"
rm -rf "$T"

# 58-59. fixture / oracle mutated after the write -> refuse (bound to throwaway COPIES; the committed
# fixture and oracle are never modified by this suite).
mutated_input() { # <label> <which: fixture|oracle>
  local T; T=$(mktemp -d); local OUT="$T/evidence"
  cp "$FX" "$T/fixture.pdf"; cp "$OR" "$T/oracle.json"
  WFX="$T/fixture.pdf"; WOR="$T/oracle.json"
  seed_run "$T" pass ok 2
  local mk; mk="$(write_marker "$OUT" aa11bb22 "$SBIN" "$SOUT" "$SRC")"
  if [ "$(val_rc "$mk" "$OUT/ledger.jsonl")" = 0 ]; then ok; else bad "$1: baseline marker should validate"; fi
  if [ "$2" = fixture ]; then printf 'x' >> "$T/fixture.pdf"; else printf ' ' >> "$T/oracle.json"; fi
  [ "$(val_rc "$mk" "$OUT/ledger.jsonl")" != 0 ] && ok || bad "$1: mutated $2 must invalidate the marker"
  WFX="$FX"; WOR="$OR"; rm -rf "$T"
}
mutated_input "bound fixture" fixture
mutated_input "bound oracle" oracle

# ---------------------------------------------------------------------------------------------
# Fail closed when the hashing / JSON toolchain is unavailable or wrong.
# ---------------------------------------------------------------------------------------------
T=$(mktemp -d); seed_run "$T" pass ok 2; broken_toolchain "$T/shim"
# 62. write with a broken sha256 must NOT sign anything
[ "$(rc_of env PYTHONPATH="$T/shim" LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" python3 "$MARK" write \
   --fixture "$FX" --oracle "$OR" --harness-bin "$SBIN" --harness-stdout "$SOUT" --harness-exit "$SRC" \
   --command c --platform p --out-root "$T/out" --repo-commit aa11bb22 --repo-tree y \
   --harness-commit aa11bb22)" != 0 ] && ok || bad "broken hashing toolchain must fail the write closed"
# 63.
[ ! -e "$T/out/a07" ] && ok || bad "broken hashing toolchain must not create a marker"
# 64. and a genuine marker must NOT validate under a broken sha256
OUT="$T/evidence"; MK2="$(write_marker "$OUT" aa11bb22 "$SBIN" "$SOUT" "$SRC")"
[ "$(rc_of env PYTHONPATH="$T/shim" LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" python3 "$MARK" validate \
   --marker "$MK2" --ledger "$OUT/ledger.jsonl")" != 0 ] \
   && ok || bad "broken hashing toolchain must fail validation closed"
rm -rf "$T"

# 65-66. the writer entrypoint fails closed when python3 (JSON/hashing) is unusable, and writes nothing
T=$(mktemp -d); mkdir -p "$T/bin"
printf '#!/bin/sh\nexit 127\n' > "$T/bin/python3"; chmod +x "$T/bin/python3"
WRC=$(PATH="$T/bin:$PATH" CLAUDE_PROJECT_DIR="$REPO" A07_MARKER_OUT_ROOT="$T/evidence" \
      LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" bash "$WRITER" >/dev/null 2>&1; echo $?)
[ "$WRC" != 0 ] && ok || bad "writer must fail closed when python3 is unusable"
[ ! -e "$T/evidence" ] && ok || bad "writer must not create the out-root when failing closed"
rm -rf "$T"

# ---------------------------------------------------------------------------------------------
# End-to-end through the REAL harness (a07-marker-write.sh -> a07-harness-cli).
# ---------------------------------------------------------------------------------------------
if command -v swift >/dev/null 2>&1; then
  T=$(mktemp -d); OUT="$T/evidence"
  ERC=$(CLAUDE_PROJECT_DIR="$REPO" A07_MARKER_OUT_ROOT="$OUT" LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" \
        bash "$WRITER" >"$T/writer.out" 2>"$T/writer.err"; echo $?)
  EMK="$(tail -n1 "$T/writer.out" 2>/dev/null)"
  # 67.
  { [ "$ERC" = 0 ] && [ -n "$EMK" ] && [ -f "$EMK" ]; } \
    && ok || bad "real-harness writer should produce a marker (rc=$ERC): $(tail -n2 "$T/writer.err" 2>/dev/null)"
  # 68.
  { [ -n "$EMK" ] && [ "$(val_rc "$EMK" "$OUT/ledger.jsonl")" = 0 ]; } \
    && ok || bad "real-harness marker should validate"
  # 69. it binds the REAL CLI binary that produced it
  { [ -n "$EMK" ] && [ "$(field "$EMK" harnessBinarySha256)" = "$(sha_of "$PKG/.build/debug/a07-harness-cli")" ]; } \
    && ok || bad "real-harness marker must bind the built a07-harness-cli sha256"
  rm -rf "$T"
else
  skip "swift unavailable: end-to-end a07-marker-write.sh case not run"
fi

# ---------------------------------------------------------------------------------------------
# Guard integration over a temp project root.
# ---------------------------------------------------------------------------------------------
TP=$(mktemp -d); ( cd "$TP" && git init -q && git config user.email t@t && git config user.name t )
mkdir -p "$TP/dev-memo/run"; printf 'x\n' > "$TP/dev-memo/run/queue.md"
seed_run "$TP" pass ok 2
write_marker "$TP/dev-memo/run/evidence" aa11bb22 "$SBIN" "$SOUT" "$SRC" >/dev/null
# 70.
[ "$(CLAUDE_PROJECT_DIR="$TP" LAWBAR_A07_MARKER_HMAC_KEY="$GOODKEY" rc_of bash "$GUARD" --scan)" = 0 ] \
  && ok || bad "guard --scan should ACCEPT a genuine local marker when key+ledger present"
# 71.
[ "$(CLAUDE_PROJECT_DIR="$TP" rc_of bash "$GUARD" --scan)" = 2 ] \
  && ok || bad "guard --scan should FAIL closed for a local marker when key is absent"
rm -rf "$TP"

[ -n "$skipped" ] && printf 'a07-marker.test.sh: SKIPPED:%b\n' "$skipped"
if [ "$fail" -eq 0 ]; then echo "a07-marker.test.sh: ALL $pass PASS"; exit 0
else echo "a07-marker.test.sh: $fail FAIL / $pass PASS"; printf '%b\n' "$failed"; exit 1; fi
