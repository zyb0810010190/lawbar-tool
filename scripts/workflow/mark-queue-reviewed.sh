#!/bin/bash
# mark-queue-reviewed.sh — records that Codex /review-plan PASSED for the current queue.
# Writes dev-memo/run/queue.reviewed, which govern-queue.sh requires alongside queue.linted.
#
# REQUIRES a saved review artifact whose verdict is a STRICT machine-readable line:
#   QUEUE_REVIEW_VERDICT=PASS
# A bare ref string is NOT sufficient (it would let a missing/negative review through).
# Loose prose like "approved" / "no blockers" is intentionally NOT accepted, because
# substrings of negative verdicts ("NOT APPROVED", "Do not pass") would slip past a grep.
#
# Usage: mark-queue-reviewed.sh <path-to-codex-review-artifact>
set -u
RUN="${CLAUDE_PROJECT_DIR:-.}/dev-memo/run"
REF="${1:-}"
[ -n "$REF" ]  || { echo "usage: mark-queue-reviewed.sh <path-to-review-artifact>"; echo "refusing: no artifact."; exit 1; }
[ -f "$REF" ]  || { echo "refusing: '$REF' is not a readable file. Save the Codex review to a file with a QUEUE_REVIEW_VERDICT line."; exit 1; }

# Strict: the artifact must carry EXACTLY ONE verdict line, and it must be PASS.
# (Requiring only that a PASS line exists would accept a mixed FAIL+PASS artifact — e.g. a
# merged/appended/retried review — which must never authorize.)
verdicts=$(grep -E '^QUEUE_REVIEW_VERDICT=' "$REF" 2>/dev/null)
count=$(printf '%s' "$verdicts" | grep -c .)
if [ "$count" -ne 1 ]; then
  echo "refusing: expected exactly one QUEUE_REVIEW_VERDICT line in '$REF', found $count."
  [ -n "$verdicts" ] && printf '  %s\n' $verdicts
  exit 1
fi
if [ "$verdicts" != "QUEUE_REVIEW_VERDICT=PASS" ]; then
  echo "refusing: the single verdict is not PASS: $verdicts"
  exit 1
fi

date -u +"reviewed=%Y-%m-%dT%H:%M:%SZ artifact=$REF" > "$RUN/queue.reviewed"
echo "Recorded queue.reviewed (artifact: $REF). Run govern-queue.sh to finalize governance."
