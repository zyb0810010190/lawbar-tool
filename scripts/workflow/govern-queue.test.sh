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
# queue.linted mirrors check-queue.sh's real output (a bare `linted=<ts>` line — note it carries NO
# queue digest; see the GQ-LINT-NOBIND characterization case below).
mkrun() {
  local T; T=$(mktemp -d)
  mkdir -p "$T/dev-memo/run"
  printf '## WI-X\nType: WORKFLOW\nScope: scratch %s%s\n' "$RANDOM" "$RANDOM" > "$T/dev-memo/run/queue.md"
  date -u +"linted=%Y-%m-%dT%H:%M:%SZ" > "$T/dev-memo/run/queue.linted"
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

# --human-approved path is also content-bound. It waives the REVIEW leg only (queue.reviewed
# absent here); queue.linted is still required — see the WI-GOVERN-LINT block below.
human_check() {
  local T expect got rc
  T=$(mkrun); rm -f "$T/dev-memo/run/queue.reviewed"
  expect=$(sha "$T/dev-memo/run/queue.md")
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" --human-approved ) >/dev/null 2>&1; rc=$?
  got=$(gov_hash "$T/dev-memo/run/queue.governed")
  if [ "$rc" -eq 0 ] && [ "$got" = "$expect" ]; then ok; else no "[--human-approved content-bind] rc=$rc want=$expect got=${got:-<none>}"; fi
  rm -rf "$T"
}
human_check

# =============================================================================================
# WI-GOVERN-LINT (audit finding X1) — the LINT leg is mandatory on EVERY path to queue.governed.
#
# Governance has two independent legs answering different questions:
#   lint   (check-queue.sh -> queue.linted)    MECHANICAL field validation of queue.md — every WI
#                                              has a concrete scope / allowed+forbidden files /
#                                              gates / acceptance criteria, and a `Type: UI` WI
#                                              carries a concrete `Design artifact:`.
#   review (mark-queue-reviewed.sh -> queue.reviewed)  an INDEPENDENT REVIEWER judged it sound.
#
# `--human-approved` exists so a human can govern without a Codex review — that legitimately
# replaces the REVIEW leg. It must NOT waive the LINT leg: check-queue.sh is the ONLY place the
# `Type: UI` -> `Design artifact:` requirement of AGENTS.md:21 / UI-GATES.md §"Queue entry gate"
# is enforced, so a lint-less --human-approved govern puts a UI WI into a governed queue with
# zero design proof — exactly the enforcement AGENTS.md claims exists.
# =============================================================================================

# THE BUG: --human-approved with NO queue.linted must REFUSE and write NO queue.governed
# (fail-closed: a refused govern also clears any pre-existing/stale attestation, same posture as
# every other refusal branch in the script).
human_no_lint_check() {
  local T rc out
  T=$(mkrun); rm -f "$T/dev-memo/run/queue.linted" "$T/dev-memo/run/queue.reviewed"
  out=$( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" --human-approved 2>&1 ); rc=$?
  if [ "$rc" -ne 0 ] && [ ! -f "$T/dev-memo/run/queue.governed" ]; then ok
  else no "[--human-approved without queue.linted] must refuse: rc=$rc gov-exists=$([ -f "$T/dev-memo/run/queue.governed" ] && echo yes || echo no) out=$out"; fi
  # the refusal must name the missing artifact + its remediation
  if printf '%s' "$out" | grep -qF 'missing queue.linted (run check-queue.sh)'; then ok
  else no "[--human-approved without queue.linted] refusal must cite 'missing queue.linted (run check-queue.sh)', got: $out"; fi
  rm -rf "$T"
}
human_no_lint_check

# --human-approved WITH a valid queue.linted governs, and records kind=human-approved.
human_with_lint_check() {
  local T expect got rc kind
  T=$(mkrun); rm -f "$T/dev-memo/run/queue.reviewed"
  expect=$(sha "$T/dev-memo/run/queue.md")
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" --human-approved ) >/dev/null 2>&1; rc=$?
  got=$(gov_hash "$T/dev-memo/run/queue.governed")
  kind=$(sed -n 's/^governed=\([a-z+-]*\) .*/\1/p' "$T/dev-memo/run/queue.governed" 2>/dev/null | head -n1)
  if [ "$rc" -eq 0 ] && [ "$got" = "$expect" ] && [ "$kind" = "human-approved" ]; then ok
  else no "[--human-approved with queue.linted] rc=$rc kind=${kind:-<none>} want=$expect got=${got:-<none>}"; fi
  rm -rf "$T"
}
human_with_lint_check

# The NORMAL path (lint + reviewed) is unchanged: governs, content-bound, kind=lint+review.
normal_path_check() {
  local T expect got rc kind
  T=$(mkrun); expect=$(sha "$T/dev-memo/run/queue.md")
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" ) >/dev/null 2>&1; rc=$?
  got=$(gov_hash "$T/dev-memo/run/queue.governed")
  kind=$(sed -n 's/^governed=\([a-z+-]*\) .*/\1/p' "$T/dev-memo/run/queue.governed" 2>/dev/null | head -n1)
  if [ "$rc" -eq 0 ] && [ "$got" = "$expect" ] && [ "$kind" = "lint+review" ]; then ok
  else no "[normal lint+review path] rc=$rc kind=${kind:-<none>} want=$expect got=${got:-<none>}"; fi
  rm -rf "$T"
}
normal_path_check

# --human-approved still fails CLOSED when queue.md cannot be hashed (lint present, queue gone):
# the lint gate must not shadow the content-binding fail-closed branch.
human_lint_but_no_queue_check() {
  local T rc out
  T=$(mkrun); rm -f "$T/dev-memo/run/queue.reviewed" "$T/dev-memo/run/queue.md"
  out=$( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" --human-approved 2>&1 ); rc=$?
  if [ "$rc" -ne 0 ] && [ ! -f "$T/dev-memo/run/queue.governed" ] \
     && printf '%s' "$out" | grep -qF 'NOT governed: dev-memo/run/queue.md is missing or unreadable; cannot content-bind governance (fail-closed).'; then ok
  else no "[--human-approved lint present, queue.md missing] rc=$rc gov-exists=$([ -f "$T/dev-memo/run/queue.governed" ] && echo yes || echo no) out=$out"; fi
  rm -rf "$T"
}
human_lint_but_no_queue_check

# Every PRE-EXISTING refusal on the normal path still refuses with its EXACT message, and leaves
# no queue.governed behind. $2 = files to remove; $3.. = exact substrings the output must carry.
refusal_check() {
  local label=$1 rmlist=$2; shift 2
  local T rc out msg
  T=$(mkrun)
  for f in $rmlist; do rm -f "$T/dev-memo/run/$f"; done
  out=$( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" 2>&1 ); rc=$?
  if [ "$rc" -ne 0 ] && [ ! -f "$T/dev-memo/run/queue.governed" ]; then ok
  else no "[$label] must refuse + remove governed: rc=$rc gov-exists=$([ -f "$T/dev-memo/run/queue.governed" ] && echo yes || echo no)"; fi
  for msg in "$@"; do
    if printf '%s' "$out" | grep -qF "$msg"; then ok; else no "[$label] missing exact message '$msg' in: $out"; fi
  done
  rm -rf "$T"
}
refusal_check "normal: no queue.linted" "queue.linted" \
  'missing queue.linted (run check-queue.sh)' \
  'NOT governed. Lint alone is not sufficient — Codex review is also required.'
refusal_check "normal: no queue.reviewed" "queue.reviewed" \
  'missing queue.reviewed (run Codex /review-plan, then mark-queue-reviewed.sh)' \
  'NOT governed. Lint alone is not sufficient — Codex review is also required.'
refusal_check "normal: neither artifact" "queue.linted queue.reviewed" \
  'missing queue.linted (run check-queue.sh)' \
  'missing queue.reviewed (run Codex /review-plan, then mark-queue-reviewed.sh)' \
  'NOT governed. Lint alone is not sufficient — Codex review is also required.'

# GQ-LINT-NOBIND (characterization, NOT an endorsement). check-queue.sh writes queue.linted as a
# bare `linted=<timestamp>` line with NO queue digest, so — unlike queue.reviewed, which carries
# queue_sha256 verified at mark time — the lint artifact does NOT bind to queue.md content.
# Consequence: a queue linted as v1 and then EDITED to v2 still satisfies the lint leg. Requiring
# queue.linted therefore closes "no lint ran at all", not "lint ran against THIS text". This case
# records the real behaviour (governs) and pins the two facts that produce it, so a future WI that
# adds a digest to queue.linted has a failing test telling it exactly what changed. What is NOT
# fooled: queue.governed still records sha256 of the CURRENT queue.md, which is what
# batch-commit-guard.sh (BCG-6) recomputes at commit time.
stale_lint_characterization() {
  local T rc got expect bind
  T=$(mkrun)
  bind=$(grep -cE 'queue_sha256' "$T/dev-memo/run/queue.linted" 2>/dev/null)
  # lint + review recorded, THEN queue.md is edited (the "stale artifact" situation)
  printf '## WI-Y\nType: UI\nScope: mutated after lint %s\n' "$RANDOM" >> "$T/dev-memo/run/queue.md"
  expect=$(sha "$T/dev-memo/run/queue.md")
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" bash "$GQ" ) >/dev/null 2>&1; rc=$?
  got=$(gov_hash "$T/dev-memo/run/queue.governed")
  if [ "${bind:-0}" -eq 0 ]; then ok
  else no "[GQ-LINT-NOBIND] queue.linted now carries a queue digest ($bind line(s)) — govern-queue.sh should verify it; update this test and add the check"; fi
  if [ "$rc" -eq 0 ] && [ "$got" = "$expect" ]; then ok
  else no "[GQ-LINT-NOBIND] expected govern to succeed content-bound to the CURRENT queue.md: rc=$rc want=$expect got=${got:-<none>}"; fi
  rm -rf "$T"
}
stale_lint_characterization

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
