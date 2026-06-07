#!/bin/bash
# govern-queue.test.sh — tests for the hardened govern-queue.sh (WI-GQ1). Each case builds a
# scratch CLAUDE_PROJECT_DIR with a governed-ready queue + a STALE queue.governed, then asserts:
#   (a)-(d) standalone / piped-to-tail / compound / `sh` invocations each REFRESH queue.governed
#           to sha256(queue.md);
#   (e) post-write SELF-VERIFY fails LOUD (exit!=0) + leaves NO stale queue.governed when the
#       hash tool is nondeterministic (written hash != recompute), and when queue.md is missing;
#   plus: verbose success prints the recorded hash + absolute path; --human-approved content-binds;
#         no temp file is left behind on success.
# These exercise the same canonical-hash shape batch-commit-guard.sh reads, so a format
# regression here fails the gate (alongside check-queue.test.sh + batch-closeout.test.mjs).
# Run: bash scripts/workflow/govern-queue.test.sh   (exit 0 = all pass)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; GQ="$HERE/govern-queue.sh"
pass=0; fail=0; failed=""

sha()      { shasum -a 256 "$1" | awk '{print $1}'; }
gov_hash() { sed -n 's/^queue_sha256=\([0-9a-f]\{64\}\)$/\1/p' "$1" 2>/dev/null | head -n1; }
ok()       { pass=$((pass+1)); }
no()       { fail=$((fail+1)); failed="$failed\n  $1"; }

# Scratch CLAUDE_PROJECT_DIR with a governed-ready queue and a STALE queue.governed (all-zero hash).
mkrun() {
  local T; T=$(mktemp -d)
  mkdir -p "$T/dev-memo/run"
  printf '## WI-X\nType: WORKFLOW\nScope: scratch %s%s\n' "$RANDOM" "$RANDOM" > "$T/dev-memo/run/queue.md"
  : > "$T/dev-memo/run/queue.linted"
  : > "$T/dev-memo/run/queue.reviewed"
  printf 'governed=lint+review STALE\nqueue_sha256=%064d\n' 0 > "$T/dev-memo/run/queue.governed"
  printf '%s' "$T"
}

GQ_Q="\"$GQ\""

# (a)-(d) invocation shapes — each must refresh queue.governed to sha256(queue.md).
shape_refresh() {  # $1=label  $2=shell command (cwd=$T, CLAUDE_PROJECT_DIR=$T)
  local label=$1 cmd=$2 T expect got rc
  T=$(mkrun); expect=$(sha "$T/dev-memo/run/queue.md")
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash -c "$cmd" ) >/dev/null 2>&1; rc=$?
  got=$(gov_hash "$T/dev-memo/run/queue.governed")
  if [ "$rc" -eq 0 ] && [ "$got" = "$expect" ]; then ok; else no "[$label] rc=$rc want=$expect got=${got:-<none>}"; fi
  rm -rf "$T"
}
shape_refresh "a standalone"    "bash $GQ_Q"
shape_refresh "b piped to tail" "bash $GQ_Q 2>&1 | tail -1"
shape_refresh "c compound"      "true ; bash $GQ_Q 2>&1 | tail -1 ; sed -n s/^queue_sha256=//p dev-memo/run/queue.governed >/dev/null"
shape_refresh "d sh (not bash)" "sh $GQ_Q"

# Verbose success prints the recorded hash AND the absolute queue.governed path.
verbose_check() {
  local T out expect
  T=$(mkrun); expect=$(sha "$T/dev-memo/run/queue.md")
  out=$( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" 2>&1 )
  if printf '%s' "$out" | grep -q "queue_sha256=$expect" \
     && printf '%s' "$out" | grep -q "queue.governed=$T/dev-memo/run/queue.governed"; then ok
  else no "[verbose success] missing hash/abs-path in: $out"; fi
  rm -rf "$T"
}
verbose_check

# --human-approved path is also content-bound (no lint/reviewed required).
human_check() {
  local T expect got rc
  T=$(mkrun); rm -f "$T/dev-memo/run/queue.linted" "$T/dev-memo/run/queue.reviewed"
  expect=$(sha "$T/dev-memo/run/queue.md")
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" --human-approved ) >/dev/null 2>&1; rc=$?
  got=$(gov_hash "$T/dev-memo/run/queue.governed")
  if [ "$rc" -eq 0 ] && [ "$got" = "$expect" ]; then ok; else no "[--human-approved content-bind] rc=$rc want=$expect got=${got:-<none>}"; fi
  rm -rf "$T"
}
human_check

# No temp file (.queue.governed.tmp.*) is left behind after a successful run.
notemp_check() {
  local T leftover
  T=$(mkrun)
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" ) >/dev/null 2>&1
  leftover=$(find "$T/dev-memo/run" -name '.queue.governed.tmp.*' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$leftover" = "0" ]; then ok; else no "[no temp leftover] found $leftover temp file(s)"; fi
  rm -rf "$T"
}
notemp_check

# (e1) forced self-verify MISMATCH: a nondeterministic shasum makes the written hash differ
# from the recompute -> script must exit!=0 AND remove queue.governed (no stale file).
mismatch_check() {
  local T fakedir rc
  T=$(mkrun); fakedir="$T/fakebin"; mkdir -p "$fakedir"
  cat > "$fakedir/shasum" <<'FAKE'
#!/bin/sh
# emit a different valid 64-hex each call (counter) so write != self-verify recompute.
cf="$FAKE_COUNTER"
n=$(cat "$cf" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$cf"
printf '%064d  -\n' "$n"
FAKE
  chmod +x "$fakedir/shasum"
  printf 0 > "$T/ctr"
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" FAKE_COUNTER="$T/ctr" PATH="$fakedir:$PATH" bash "$GQ" ) >/dev/null 2>&1; rc=$?
  if [ "$rc" -ne 0 ] && [ ! -f "$T/dev-memo/run/queue.governed" ]; then ok
  else no "[self-verify mismatch] rc=$rc gov-exists=$([ -f "$T/dev-memo/run/queue.governed" ] && echo yes || echo no)"; fi
  rm -rf "$T"
}
mismatch_check

# (e2) unreadable queue.md: fail-closed leaves NO stale queue.governed.
missing_queue_check() {
  local T rc
  T=$(mkrun); rm -f "$T/dev-memo/run/queue.md"
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" ) >/dev/null 2>&1; rc=$?
  if [ "$rc" -ne 0 ] && [ ! -f "$T/dev-memo/run/queue.governed" ]; then ok
  else no "[missing queue.md] rc=$rc gov-exists=$([ -f "$T/dev-memo/run/queue.governed" ] && echo yes || echo no)"; fi
  rm -rf "$T"
}
missing_queue_check

printf 'govern-queue: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
