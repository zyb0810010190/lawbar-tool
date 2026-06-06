#!/bin/bash
# govern-queue.sh — writes dev-memo/run/queue.governed ONLY when the queue is fully governed.
# This is the file the batch-commit-guard requires. It is the single place governed is created.
#
# An agent-proposed queue is governed when BOTH exist:
#   queue.linted    (written by check-queue.sh)
#   queue.reviewed  (written by mark-queue-reviewed.sh after Codex /review-plan passes)
# A human-authored queue may be governed directly with:  govern-queue.sh --human-approved
#
# BCG-6 / GOVERNANCE-CHAIN-001: governance is CONTENT-BOUND. Besides the `governed=...` line,
# this script records `queue_sha256=<64-hex>` = sha256(dev-memo/run/queue.md) into queue.governed.
# batch-commit-guard.sh recomputes that hash at commit time and denies on absent/malformed/
# mismatch, so a queue.md edited AFTER governance no longer authorizes commits. The digest is
# written on BOTH the lint+review and the --human-approved path. If queue.md is missing/unreadable
# or cannot be hashed, governance FAILS CLOSED (queue.governed is removed and exit is non-zero).
#
# Exit 0 = governed (file written), 1 = not governed (file removed).

set -u
RUN="${CLAUDE_PROJECT_DIR:-.}/dev-memo/run"
GOV="$RUN/queue.governed"
QUEUE="$RUN/queue.md"

# Portable sha256 of a file's bytes -> 64 lowercase hex, or empty string on any failure.
# Resolution order matches batch-commit-guard.sh's verifier so the two digests are comparable.
queue_sha256() {
  local f=$1 h=""
  if command -v shasum >/dev/null 2>&1; then
    h=$(shasum -a 256 "$f" 2>/dev/null | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    h=$(sha256sum "$f" 2>/dev/null | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then
    h=$(openssl dgst -sha256 "$f" 2>/dev/null | awk '{print $NF}')
  fi
  printf '%s' "$h"
}

# Write queue.governed with the content hash, or fail closed if queue.md cannot be hashed.
write_governed() {
  local kind=$1 h
  if [ ! -r "$QUEUE" ]; then
    rm -f "$GOV"
    echo "NOT governed: dev-memo/run/queue.md is missing or unreadable; cannot content-bind governance (fail-closed)."
    exit 1
  fi
  h=$(queue_sha256 "$QUEUE")
  case "$h" in
    *[!0-9a-f]* | "") rm -f "$GOV"; echo "NOT governed: could not compute a valid sha256 of queue.md (no hash tool or read error); fail-closed."; exit 1 ;;
  esac
  if [ "${#h}" -ne 64 ]; then
    rm -f "$GOV"; echo "NOT governed: sha256(queue.md) is not 64 hex chars; fail-closed."; exit 1
  fi
  if ! { date -u +"governed=$kind %Y-%m-%dT%H:%M:%SZ"; printf 'queue_sha256=%s\n' "$h"; } > "$GOV"; then
    rm -f "$GOV"
    echo "NOT governed: failed to write queue.governed (disk/permission); fail-closed."
    exit 1
  fi
}

if [ "${1:-}" = "--human-approved" ]; then
  write_governed "human-approved"
  echo "Queue governed by explicit human approval (content-bound to queue.md)."
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

write_governed "lint+review"
echo "Queue governed: lint + Codex review both present (content-bound to queue.md)."
exit 0
