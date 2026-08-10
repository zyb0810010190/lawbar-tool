#!/bin/bash
# mark-queue-reviewed.test.sh — spec for the BROKER-BOUND queue-review attestation
# (WI-QREVIEW-BIND, audit finding S4).
#
# The defect this suite pins: mark-queue-reviewed.sh used to accept ANY readable file whose only
# requirement was a single line `QUEUE_REVIEW_VERDICT=PASS`. The agent could write that line into a
# file anywhere, run the script, then govern-queue.sh, and batch-commit-guard.sh would see a
# governed queue — the closed self-authorizing loop AGENTS.md §"Queue governance" forbids.
#
# The fix mirrors the two sibling paths that already bind to the cc-suite broker
# (scripts/workflow/batch-closeout.mjs verifyBrokerRangeBound() and batch-commit-guard.sh
# rem_authorize()): the review artifact must name a REAL cc-suite review-plan job whose stored
# rawOutput hashes to the declared digest, carries the PASS verdict ITSELF, and declares the sha256
# of the exact queue.md being marked.
#
# Every case runs against a scratch CLAUDE_PROJECT_DIR + a scratch HOME (so the real
# dev-memo/run/** and the real cc-suite state store are never touched).
#
# Run: bash scripts/workflow/mark-queue-reviewed.test.sh   (exit 0 = all pass)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/mark-queue-reviewed.sh"
# The script's shebang is #!/bin/bash — macOS bash 3.2 in production. Re-run with
# MQR_TEST_BASH=/bin/bash to prove 3.2 compatibility.
GBASH=$(command -v "${MQR_TEST_BASH:-bash}")

T=$(mktemp -d 2>/dev/null || mktemp -d -t mqr)
T=$(cd "$T" && pwd)
trap 'rm -rf "$T"' EXIT

RUNDIR="$T/dev-memo/run"; mkdir -p "$RUNDIR"
HOMEDIR="$T/home"
SLUG=${T##*/}
STATE="$HOMEDIR/.claude/plugins/data/cc-suite-xiaolai/state/$SLUG-deadbeef/jobs"
mkdir -p "$STATE"
ART="$T/review.md"

pass=0; fail=0; failed=""
chk() { # chk <label> <want> <got>
  if [ "$3" = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [$1] want '$2' got '$3'"; fi
}

t_sha_file() { # mirrors the script's resolution order
  local f=$1 h=""
  if command -v shasum >/dev/null 2>&1; then h=$(shasum -a 256 "$f" 2>/dev/null | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum "$f" 2>/dev/null | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then h=$(openssl dgst -sha256 "$f" 2>/dev/null | awk '{print $NF}')
  fi
  printf '%s' "$h"
}

# --- fixtures ---------------------------------------------------------------------------------
setqueue() { printf '## WI-X\nType: WORKFLOW\nScope: %s\n' "$1" > "$RUNDIR/queue.md"; QHASH=$(t_sha_file "$RUNDIR/queue.md"); }

# mkjob <jobid> <line>... -> writes $STATE/<jobid>.json, echoes sha256 of the rawOutput bytes.
mkjob() {
  local id=$1; shift
  local raw="$T/.raw.$id.txt" l
  : > "$raw"
  for l in "$@"; do printf '%s\n' "$l" >> "$raw"; done
  python3 - "$raw" "$STATE/$id.json" <<'PY'
import json, sys
raw = open(sys.argv[1], encoding="utf-8").read()
json.dump({"rawOutput": raw, "threadId": "thread-x"}, open(sys.argv[2], "w", encoding="utf-8"))
PY
  t_sha_file "$raw"
}

# mkart <line>... -> writes the local review artifact from explicit lines.
mkart() { : > "$ART"; local l; for l in "$@"; do printf '%s\n' "$l" >> "$ART"; done; }

# runm [artifact] -> ACCEPT|REJECT (exit status of the script).
runm() {
  local a=${1-$ART} rc
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" HOME="$HOMEDIR" "$GBASH" "$SCRIPT" ${a:+"$a"} ) >"$T/.out" 2>&1; rc=$?
  [ "$rc" -eq 0 ] && printf ACCEPT || printf REJECT
}
runm_noargs() {
  local rc
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" HOME="$HOMEDIR" "$GBASH" "$SCRIPT" ) >"$T/.out" 2>&1; rc=$?
  [ "$rc" -eq 0 ] && printf ACCEPT || printf REJECT
}
# runm_nojq -> same, but with a PATH that contains every tool the script needs EXCEPT a JSON reader.
NOJQ="$T/nojqbin"; mkdir -p "$NOJQ"
for t in grep awk tr date mv rm cat head shasum sha256sum openssl sed; do
  p=$(command -v "$t" 2>/dev/null) && ln -sf "$p" "$NOJQ/$t"
done
runm_nojq() {
  local rc
  ( cd "$T" && CLAUDE_PROJECT_DIR="$T" HOME="$HOMEDIR" PATH="$NOJQ" "$GBASH" "$SCRIPT" "$ART" ) >"$T/.out" 2>&1; rc=$?
  [ "$rc" -eq 0 ] && printf ACCEPT || printf REJECT
}
reviewedstate() { [ -f "$RUNDIR/queue.reviewed" ] && printf present || printf absent; }
reset() { rm -f "$RUNDIR/queue.reviewed"; }

setqueue "queue-v1"
GOODSHA=$(mkjob review-plan-mqrgood \
  "Reviewed the proposed queue over 5 dimensions." \
  "QUEUE_REVIEW_SHA256=$QHASH" \
  "QUEUE_REVIEW_VERDICT=PASS" \
  "No blocking findings.")

good_art() {
  mkart "# queue-review-attestation v1" \
        "broker_job_id=review-plan-mqrgood" \
        "broker_output_sha256=$GOODSHA" \
        "queue_sha256=$QHASH" \
        "QUEUE_REVIEW_VERDICT=PASS"
}

# ==============================================================================================
# THE BUG — a hand-written file carrying only the verdict line must NOT authorize.
# ==============================================================================================
reset; mkart "QUEUE_REVIEW_VERDICT=PASS"
chk "BUG bare PASS line -> reject"            REJECT "$(runm)"
chk "BUG bare PASS line writes no attestation" absent "$(reviewedstate)"

# ==============================================================================================
# HAPPY PATH — valid artifact + real job + PASS in rawOutput + matching queue hash.
# ==============================================================================================
reset; good_art
chk "OK valid broker-bound artifact -> accept" ACCEPT "$(runm)"
chk "OK attestation written"                   present "$(reviewedstate)"
chk "OK attestation records the broker job"    yes "$(grep -qE '^broker_job_id=review-plan-mqrgood$' "$RUNDIR/queue.reviewed" && echo yes || echo no)"
chk "OK attestation records the output digest" yes "$(grep -qE "^broker_output_sha256=$GOODSHA\$" "$RUNDIR/queue.reviewed" && echo yes || echo no)"
chk "OK attestation records the queue digest"  yes "$(grep -qE "^queue_sha256=$QHASH\$" "$RUNDIR/queue.reviewed" && echo yes || echo no)"

# ==============================================================================================
# PRE-EXISTING CHECKS — unchanged (nothing weakened).
# ==============================================================================================
reset
chk "PRE no argument -> reject"                REJECT "$(runm_noargs)"
chk "PRE nonexistent artifact -> reject"       REJECT "$(runm "$T/nope.md")"
reset; mkart "# no verdict at all" "broker_job_id=review-plan-mqrgood" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH"
chk "PRE artifact with no verdict -> reject"   REJECT "$(runm)"
reset; mkart "broker_job_id=review-plan-mqrgood" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=FAIL"
chk "PRE artifact verdict FAIL -> reject"      REJECT "$(runm)"
reset; mkart "broker_job_id=review-plan-mqrgood" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" \
             "QUEUE_REVIEW_VERDICT=FAIL" "QUEUE_REVIEW_VERDICT=PASS"
chk "PRE artifact mixed FAIL+PASS -> reject"   REJECT "$(runm)"

# ==============================================================================================
# BROKER JOB IDENTITY — missing / malformed / traversal.
# ==============================================================================================
reset; mkart "broker_job_id=review-plan-doesnotexist" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "JOB nonexistent job id -> reject"         REJECT "$(runm)"
reset; mkart "broker_job_id=audit-mqrgood" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "JOB wrong job kind (audit-) -> reject"    REJECT "$(runm)"
reset; mkart "broker_job_id=review-plan-bad id" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "JOB malformed job id (space) -> reject"   REJECT "$(runm)"
# Traversal: the id is interpolated into <state>/jobs/<id>.json, so a path-bearing id must be refused
# by the regex pin, not merely fail to resolve. Plant a real file at the traversal target first.
printf '{"rawOutput":"QUEUE_REVIEW_VERDICT=PASS\\n"}' > "$HOMEDIR/.claude/plugins/data/cc-suite-xiaolai/state/$SLUG-deadbeef/evil.json"
reset; mkart "broker_job_id=../evil" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "JOB traversal '../evil' -> reject"        REJECT "$(runm)"
reset; mkart "broker_job_id=review-plan-/../../evil" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "JOB traversal inside a valid prefix -> reject" REJECT "$(runm)"

# ==============================================================================================
# OUTPUT DIGEST — the artifact must hash-bind to the stored rawOutput.
# ==============================================================================================
reset; mkart "broker_job_id=review-plan-mqrgood" "broker_output_sha256=$(printf '%064d' 0)" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "SHA output digest mismatch -> reject"     REJECT "$(runm)"
reset; mkart "broker_job_id=review-plan-mqrgood" "broker_output_sha256=notahash" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "SHA malformed output digest -> reject"    REJECT "$(runm)"

# ==============================================================================================
# THE VERDICT MUST COME FROM THE REVIEWER — not from the local file.
# ==============================================================================================
NOVERDICT=$(mkjob review-plan-mqrnoverdict "Reviewed the queue." "QUEUE_REVIEW_SHA256=$QHASH" "Looks fine to me.")
reset; mkart "broker_job_id=review-plan-mqrnoverdict" "broker_output_sha256=$NOVERDICT" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "VERDICT PASS local, absent in job -> reject" REJECT "$(runm)"

FAILJOB=$(mkjob review-plan-mqrfail "Reviewed the queue." "QUEUE_REVIEW_SHA256=$QHASH" "QUEUE_REVIEW_VERDICT=FAIL")
reset; mkart "broker_job_id=review-plan-mqrfail" "broker_output_sha256=$FAILJOB" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "VERDICT job records FAIL -> reject"       REJECT "$(runm)"

MIXJOB=$(mkjob review-plan-mqrmixed "QUEUE_REVIEW_SHA256=$QHASH" "QUEUE_REVIEW_VERDICT=FAIL" "retry:" "QUEUE_REVIEW_VERDICT=PASS")
reset; mkart "broker_job_id=review-plan-mqrmixed" "broker_output_sha256=$MIXJOB" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "VERDICT job mixes FAIL+PASS -> reject"    REJECT "$(runm)"

PROSEJOB=$(mkjob review-plan-mqrprose "QUEUE_REVIEW_SHA256=$QHASH" "Do not write QUEUE_REVIEW_VERDICT=PASS until the gaps are closed.")
reset; mkart "broker_job_id=review-plan-mqrprose" "broker_output_sha256=$PROSEJOB" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "VERDICT in-prose mention is not a verdict -> reject" REJECT "$(runm)"

# ==============================================================================================
# QUEUE BINDING — the review cannot be transplanted onto a queue it never reviewed.
# ==============================================================================================
reset; mkart "broker_job_id=review-plan-mqrgood" "broker_output_sha256=$GOODSHA" "queue_sha256=$(printf '%064d' 0)" "QUEUE_REVIEW_VERDICT=PASS"
chk "QUEUE artifact queue hash mismatch -> reject" REJECT "$(runm)"

NOQHASH=$(mkjob review-plan-mqrnoqh "Reviewed the queue." "QUEUE_REVIEW_VERDICT=PASS")
reset; mkart "broker_job_id=review-plan-mqrnoqh" "broker_output_sha256=$NOQHASH" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "QUEUE job declares no queue hash -> reject" REJECT "$(runm)"

OTHERQ=$(mkjob review-plan-mqrotherq "QUEUE_REVIEW_SHA256=$(printf '%064d' 7)" "QUEUE_REVIEW_VERDICT=PASS")
reset; mkart "broker_job_id=review-plan-mqrotherq" "broker_output_sha256=$OTHERQ" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "QUEUE job reviewed a different queue -> reject" REJECT "$(runm)"

# Transplant, end to end: the job that legitimately PASSed queue-v1 must not mark queue-v2.
OLDQ=$QHASH
setqueue "queue-v2-edited-after-review"
reset; mkart "broker_job_id=review-plan-mqrgood" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "QUEUE v1 review cannot mark an edited v2 queue" REJECT "$(runm)"
reset; mkart "broker_job_id=review-plan-mqrgood" "broker_output_sha256=$GOODSHA" "queue_sha256=$OLDQ" "QUEUE_REVIEW_VERDICT=PASS"
chk "QUEUE stale queue hash in artifact -> reject"   REJECT "$(runm)"
setqueue "queue-v1"   # restore; QHASH is back to the reviewed queue

reset; rm -f "$RUNDIR/queue.md"; good_art
chk "QUEUE missing queue.md -> reject"         REJECT "$(runm)"
setqueue "queue-v1"

# ==============================================================================================
# JOB ARTIFACT INTEGRITY — unreadable / errored / empty.
# ==============================================================================================
printf 'not json at all' > "$STATE/review-plan-mqrbadjson.json"
reset; mkart "broker_job_id=review-plan-mqrbadjson" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "JSON unparseable job artifact -> reject"  REJECT "$(runm)"
printf '{"error":"spawnSync codex ETIMEDOUT"}' > "$STATE/review-plan-mqrerror.json"
reset; mkart "broker_job_id=review-plan-mqrerror" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "JSON errored job -> reject"               REJECT "$(runm)"
printf '{"rawOutput":""}' > "$STATE/review-plan-mqrempty.json"
reset; mkart "broker_job_id=review-plan-mqrempty" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "JSON empty rawOutput -> reject"           REJECT "$(runm)"

# ==============================================================================================
# ARTIFACT FIELD HYGIENE — missing / duplicated / whitespace-padded.
# ==============================================================================================
reset; mkart "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "FIELD missing broker_job_id -> reject"    REJECT "$(runm)"
reset; mkart "broker_job_id=review-plan-mqrgood" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "FIELD missing output digest -> reject"    REJECT "$(runm)"
reset; mkart "broker_job_id=review-plan-mqrgood" "broker_output_sha256=$GOODSHA" "QUEUE_REVIEW_VERDICT=PASS"
chk "FIELD missing queue digest -> reject"     REJECT "$(runm)"
reset; mkart "broker_job_id=review-plan-mqrgood" "broker_job_id=review-plan-mqrfail" \
             "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "FIELD duplicate broker_job_id -> reject"  REJECT "$(runm)"
reset; mkart "  broker_job_id = review-plan-mqrgood" "broker_output_sha256=$GOODSHA" "queue_sha256=$QHASH" "QUEUE_REVIEW_VERDICT=PASS"
chk "FIELD whitespace-padded key -> reject"    REJECT "$(runm)"

# ==============================================================================================
# FAIL-CLOSED ENVIRONMENT — no JSON reader means no authorization (never a skip).
# ==============================================================================================
reset; good_art
chk "ENV jq unavailable -> reject"             REJECT "$(runm_nojq)"
chk "ENV jq unavailable writes nothing"        absent "$(reviewedstate)"

# ==============================================================================================
# STALE ATTESTATION — a refusal must not leave a previous queue.reviewed standing.
# ==============================================================================================
reset; good_art
runm >/dev/null
mkart "QUEUE_REVIEW_VERDICT=PASS"
chk "STALE refusal clears a prior attestation" REJECT "$(runm)"
chk "STALE prior attestation removed"          absent "$(reviewedstate)"

printf 'mark-queue-reviewed: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
