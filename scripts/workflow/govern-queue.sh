#!/bin/bash
# govern-queue.sh — writes dev-memo/run/queue.governed ONLY when the queue is fully governed.
# This is the file the batch-commit-guard requires. It is the single place governed is created.
#
# An agent-proposed queue is governed when BOTH exist:
#   queue.linted    (written by check-queue.sh)
#   queue.reviewed  (written by mark-queue-reviewed.sh after Codex /review-plan passes)
# A human-authored queue may be governed directly with:  govern-queue.sh --human-approved
#
# Exit 0 = governed (file written), 1 = not governed (file removed).

set -u
RUN="${CLAUDE_PROJECT_DIR:-.}/dev-memo/run"
GOV="$RUN/queue.governed"

if [ "${1:-}" = "--human-approved" ]; then
  date -u +"governed=human-approved %Y-%m-%dT%H:%M:%SZ" > "$GOV"
  echo "Queue governed by explicit human approval."
  exit 0
fi

ok=1
[ -f "$RUN/queue.linted" ]   || { echo "missing queue.linted (run check-queue.sh)"; ok=0; }
[ -f "$RUN/queue.reviewed" ] || { echo "missing queue.reviewed (run Codex /review-plan, then mark-queue-reviewed.sh)"; ok=0; }

if [ "$ok" -ne 1 ]; then
  rm -f "$GOV"
  echo "NOT governed. Lint alone is not sufficient — Codex review is also required."
  exit 1
fi

date -u +"governed=lint+review %Y-%m-%dT%H:%M:%SZ" > "$GOV"
echo "Queue governed: lint + Codex review both present."
exit 0
