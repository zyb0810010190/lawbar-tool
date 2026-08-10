#!/bin/bash
# mark-queue-reviewed.sh — records that a cc-suite /review-plan job PASSED for the CURRENT queue.
# Writes dev-memo/run/queue.reviewed, which govern-queue.sh requires alongside queue.linted.
#
# WI-QREVIEW-BIND (audit finding S4). This script used to accept ANY readable file containing the
# single line `QUEUE_REVIEW_VERDICT=PASS`, with no binding to a real reviewer. That closed the loop
# AGENTS.md §"Queue governance" forbids: the agent could write that line itself, run this script and
# govern-queue.sh, and satisfy batch-commit-guard.sh — i.e. authorize its own queue. The verdict must
# come from the REVIEWER, so the artifact is now bound to the cc-suite broker exactly the way the two
# sibling paths already do it (scripts/workflow/batch-closeout.mjs verifyBrokerRangeBound() and
# .claude/hooks/batch-commit-guard.sh rem_authorize()).
#
# The review artifact MUST carry, on their own lines, in addition to the verdict line:
#   broker_job_id=review-plan-<id>            the cc-suite job that produced the review
#   broker_output_sha256=<64-hex>             sha256 of that job's stored rawOutput bytes
#   queue_sha256=<64-hex>                     sha256(dev-memo/run/queue.md) at mark time
#   QUEUE_REVIEW_VERDICT=PASS                 (unchanged; exactly one verdict line, and it must PASS)
# and the named job's STORED rawOutput must itself declare, on their own lines:
#   QUEUE_REVIEW_SHA256=<the same 64-hex queue digest>
#   QUEUE_REVIEW_VERDICT=PASS                 (exactly one verdict line in the reviewer's own output)
# Requiring the digest INSIDE the hashed reviewer output is what stops a transplant: a PASS issued
# for queue-v1 cannot be replayed onto an edited queue-v2, because the reviewer never saw v2.
# Ask the reviewer for both lines and pass it the digest: shasum -a 256 dev-memo/run/queue.md
#
# Loose prose ("approved", "no blockers") is still intentionally NOT accepted, because substrings of
# negative verdicts ("NOT APPROVED", "Do not pass") would slip past a grep. Every failure is
# fail-closed: missing, malformed, duplicated, unreadable, unresolvable, or mismatched anything —
# including an unavailable JSON reader — refuses, and clears any earlier attestation.
#
# Usage: mark-queue-reviewed.sh <path-to-codex-review-artifact>
set -u

PROJ=$(cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && pwd)
[ -n "$PROJ" ] || { echo "refusing: cannot resolve the project directory (CLAUDE_PROJECT_DIR)."; exit 1; }
RUN="$PROJ/dev-memo/run"
REVIEWED="$RUN/queue.reviewed"
QUEUE="$RUN/queue.md"
REF="${1:-}"
TMPF=""

# refuse <reason> — fail-closed exit. Also removes any PRE-EXISTING queue.reviewed: a refused mark
# must not leave an earlier attestation standing for govern-queue.sh to consume (same posture as
# govern-queue.sh removing queue.governed when it cannot govern).
refuse() {
  echo "refusing: $1"
  [ -n "$TMPF" ] && rm -f "$TMPF" 2>/dev/null
  rm -f "$REVIEWED" 2>/dev/null
  exit 1
}

# Portable sha256 of a file's bytes -> 64 lowercase hex, or empty on failure. Resolution order
# matches govern-queue.sh / batch-commit-guard.sh so all digests in the chain are comparable.
sha256_file() {
  local f=$1 h=""
  if command -v shasum >/dev/null 2>&1; then h=$(shasum -a 256 "$f" 2>/dev/null | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum "$f" 2>/dev/null | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then h=$(openssl dgst -sha256 "$f" 2>/dev/null | awk '{print $NF}')
  fi
  printf '%s' "$h"
}

# Portable sha256 of STDIN's bytes. Used for the broker rawOutput so the bytes are never routed
# through a shell variable (command substitution strips trailing newlines and drops NULs, which
# would change the digest and break the binding to batch-closeout.mjs's sha256(rawOutput)).
sha256_stdin() {
  local h=""
  if command -v shasum >/dev/null 2>&1; then h=$(shasum -a 256 2>/dev/null | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum 2>/dev/null | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then h=$(openssl dgst -sha256 2>/dev/null | awk '{print $NF}')
  else cat >/dev/null 2>&1
  fi
  printf '%s' "$h"
}

# read_field <key> <value-ERE> — STRICT single-assignment read from the artifact into FIELD_VAL.
# TOTAL counts every assignment of the key in ANY form; CANON counts only the canonical
# `key=<value-ERE>` form. Requiring TOTAL==1 AND CANON==1 (the BCG-6 pattern) means a duplicated,
# whitespace-padded, or malformed companion line fails closed instead of being normalized away.
FIELD_VAL=""
read_field() {
  local key=$1 vre=$2 total canon line
  total=$(grep -cE "^[[:space:]]*${key}[[:space:]]*=" "$REF" 2>/dev/null)
  canon=$(grep -cE "^${key}=${vre}$" "$REF" 2>/dev/null)
  { [ "${total:-0}" -eq 1 ] && [ "${canon:-0}" -eq 1 ]; } \
    || refuse "the artifact must carry EXACTLY ONE canonical '${key}=<value>' line and no other ${key} line (found total=${total:-0}, canonical=${canon:-0})."
  line=$(grep -E "^${key}=${vre}$" "$REF" | head -n1)
  FIELD_VAL=${line#"$key="}
}

[ -n "$REF" ]  || { echo "usage: mark-queue-reviewed.sh <path-to-review-artifact>"; echo "refusing: no artifact."; exit 1; }
[ -f "$REF" ] && [ -r "$REF" ] \
  || refuse "'$REF' is not a readable file. Save the cc-suite review to a file with the broker-binding lines + a QUEUE_REVIEW_VERDICT line."

# --- 1. Verdict line in the local artifact (pre-existing check, unchanged) ---------------------
# Strict: the artifact must carry EXACTLY ONE verdict line, and it must be PASS.
# (Requiring only that a PASS line exists would accept a mixed FAIL+PASS artifact — e.g. a
# merged/appended/retried review — which must never authorize.)
verdicts=$(grep -E '^QUEUE_REVIEW_VERDICT=' "$REF" 2>/dev/null)
count=$(printf '%s' "$verdicts" | grep -c .)
if [ "$count" -ne 1 ]; then
  echo "refusing: expected exactly one QUEUE_REVIEW_VERDICT line in '$REF', found $count."
  [ -n "$verdicts" ] && printf '  %s\n' $verdicts
  rm -f "$REVIEWED" 2>/dev/null
  exit 1
fi
if [ "$verdicts" != "QUEUE_REVIEW_VERDICT=PASS" ]; then
  echo "refusing: the single verdict is not PASS: $verdicts"
  rm -f "$REVIEWED" 2>/dev/null
  exit 1
fi

# --- 2. Broker-binding fields (regex-pinned, so no path traversal reaches the job lookup) -------
read_field broker_job_id 'review-plan-[A-Za-z0-9._-]{1,64}'; JOB=$FIELD_VAL
read_field broker_output_sha256 '[0-9a-f]{64}';              OSHA=$FIELD_VAL
read_field queue_sha256 '[0-9a-f]{64}';                      QSHA=$FIELD_VAL

# --- 3. A JSON reader is REQUIRED — no reader means no verified verdict (never a skip) ----------
command -v jq >/dev/null 2>&1 \
  || refuse "jq is unavailable, so the broker job JSON cannot be decoded safely; refusing to record a review that cannot be verified."

# --- 4. Queue binding: the declared digest must be THIS queue.md -------------------------------
[ -r "$QUEUE" ] || refuse "dev-memo/run/queue.md is missing or unreadable; there is no queue to bind the review to."
QACTUAL=$(sha256_file "$QUEUE")
case "$QACTUAL" in
  *[!0-9a-f]* | "") refuse "could not compute sha256(dev-memo/run/queue.md) (no hash tool available or read error)." ;;
esac
[ "${#QACTUAL}" -eq 64 ] || refuse "sha256(dev-memo/run/queue.md) is not 64 hex chars."
[ "$QACTUAL" = "$QSHA" ] \
  || refuse "queue_sha256 ($QSHA) != sha256(dev-memo/run/queue.md) ($QACTUAL) — this review artifact belongs to a different queue, or queue.md changed after the review."

# --- 5. Resolve the cc-suite state store the same way the siblings do --------------------------
# batch-closeout.mjs resolveStateDir() and batch-commit-guard.sh both read
# $HOME/.claude/plugins/data/cc-suite-xiaolai/state/<workspace-slug>-<hash>/jobs/<jobId>.json.
# The path is NOT configurable here: an operator-supplied state dir would reopen the forgery hole
# this WI closes.
SLUG=${PROJ##*/}
JOBF=""
for d in "${HOME:-}/.claude/plugins/data/cc-suite-xiaolai/state/$SLUG"-*; do
  [ -d "$d" ] || continue
  if [ -f "$d/jobs/$JOB.json" ]; then JOBF="$d/jobs/$JOB.json"; break; fi
done
[ -n "$JOBF" ] \
  || refuse "no cc-suite broker job artifact found for '$JOB' — a review that did not RUN through the broker cannot authorize a queue. Run /cc-suite:review-plan (or the Path 1 runner) and cite its jobId."

# --- 6. Job integrity + hash binding -----------------------------------------------------------
jq -e 'type == "object"' "$JOBF" >/dev/null 2>&1 || refuse "broker job artifact for '$JOB' is not readable JSON."
jq -e 'has("error") and (.error != null)' "$JOBF" >/dev/null 2>&1 \
  && refuse "broker job '$JOB' did not complete (it recorded an error), so it carries no review verdict."
RAW_OK=$(jq -r 'if (.rawOutput | type) == "string" and (.rawOutput | length) > 0 then "yes" else "no" end' "$JOBF" 2>/dev/null)
[ "$RAW_OK" = "yes" ] || refuse "broker job '$JOB' has no non-empty rawOutput."
GOT=$(jq -j '.rawOutput' "$JOBF" 2>/dev/null | sha256_stdin)
case "$GOT" in *[!0-9a-f]* | "") refuse "could not hash the broker job's rawOutput (no hash tool available or read error)." ;; esac
[ "$GOT" = "$OSHA" ] \
  || refuse "broker rawOutput sha256 ($GOT) != the artifact's broker_output_sha256 ($OSHA) — the artifact does not describe the job it names."

# --- 7. The VERDICT must be the REVIEWER'S, not the local file's -------------------------------
# Exactly one QUEUE_REVIEW_VERDICT line in the hashed reviewer output, and it must be PASS on its
# OWN full line — so a prose mention ("do not write QUEUE_REVIEW_VERDICT=PASS until …") and a
# retried FAIL+PASS transcript both fail closed.
RTOTAL=$(jq -j '.rawOutput' "$JOBF" 2>/dev/null | grep -cE '^[[:space:]]*QUEUE_REVIEW_VERDICT[[:space:]]*=')
RPASS=$(jq -j '.rawOutput' "$JOBF" 2>/dev/null | grep -cE '^QUEUE_REVIEW_VERDICT=PASS$')
{ [ "${RTOTAL:-0}" -eq 1 ] && [ "${RPASS:-0}" -eq 1 ]; } \
  || refuse "the broker job's rawOutput must declare EXACTLY ONE 'QUEUE_REVIEW_VERDICT=PASS' line and no other verdict line (found total=${RTOTAL:-0}, PASS=${RPASS:-0}) — the verdict must come from the reviewer, not from the local artifact."

# --- 8. The reviewer must have reviewed THIS queue ---------------------------------------------
QTOTAL=$(jq -j '.rawOutput' "$JOBF" 2>/dev/null | grep -cE '^[[:space:]]*QUEUE_REVIEW_SHA256[[:space:]]*=')
QMATCH=$(jq -j '.rawOutput' "$JOBF" 2>/dev/null | grep -cE "^QUEUE_REVIEW_SHA256=$QACTUAL$")
{ [ "${QTOTAL:-0}" -eq 1 ] && [ "${QMATCH:-0}" -eq 1 ]; } \
  || refuse "the broker job's rawOutput must declare EXACTLY ONE 'QUEUE_REVIEW_SHA256=$QACTUAL' line (found total=${QTOTAL:-0}, matching=${QMATCH:-0}) — the reviewer's own output must name the queue it reviewed, so a PASS cannot be transplanted onto a queue it never saw."

# --- 9. Record the attestation (atomic; carries the provenance it was verified against) ---------
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ") || refuse "failed to read the current time."
TMPF="$RUN/.queue.reviewed.tmp.$$"
{ printf 'reviewed=%s artifact=%s\n' "$TS" "$REF"
  printf 'broker_job_id=%s\n' "$JOB"
  printf 'broker_output_sha256=%s\n' "$OSHA"
  printf 'queue_sha256=%s\n' "$QACTUAL"; } > "$TMPF" 2>/dev/null \
  || refuse "failed to write the queue.reviewed temp file (disk/permission)."
mv -f "$TMPF" "$REVIEWED" 2>/dev/null || refuse "failed to move the queue.reviewed temp into place."
TMPF=""
echo "Recorded queue.reviewed (artifact: $REF)."
echo "  broker_job_id=$JOB"
echo "  broker_output_sha256=$OSHA"
echo "  queue_sha256=$QACTUAL"
echo "Run govern-queue.sh to finalize governance."
