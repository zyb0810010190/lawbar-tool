#!/bin/bash
# govern-queue.sh — writes dev-memo/run/queue.governed ONLY when the queue is fully governed.
# This is the file the batch-commit-guard requires. It is the single place governed is created.
#
# An agent-proposed queue is governed when BOTH exist:
#   queue.linted    (written by check-queue.sh)
#   queue.reviewed  (written by mark-queue-reviewed.sh after Codex /review-plan passes)
# A human-authored queue may be governed with:  check-queue.sh && govern-queue.sh --human-approved
#
# WI-GOVERN-LINT: --human-approved waives the REVIEW leg ONLY — queue.linted is REQUIRED on EVERY
# path to queue.governed. See the comment on the --human-approved branch below for why.
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

# Absolute path to queue.governed (for verbose success output). $RUN may be relative when
# CLAUDE_PROJECT_DIR is unset (defaults to "."), so resolve against $(pwd) in that case.
gov_abspath() {
  case "$GOV" in
    /*) printf '%s' "$GOV" ;;
    *)  printf '%s/%s' "$(pwd)" "${GOV#./}" ;;
  esac
}

# Write queue.governed with the content hash, or fail closed if queue.md cannot be hashed.
# Hardened (WI-GQ1): ATOMIC write (temp-in-$RUN + mv) so a reader never sees a partial file,
# then POST-WRITE SELF-VERIFY (re-read the written file, recompute sha256(queue.md), fail loud
# + rm on absent/mismatch) so a future silent-stale queue.governed becomes a loud writer
# failure rather than a guard-only catch. On success, sets GOVERNED_HASH for verbose output.
write_governed() {
  local kind=$1 h tmp recorded recomputed
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
  # Build the content with `date` guarded explicitly: a date failure must NOT yield a file that
  # carries the hash line but is missing the `governed=` line yet still self-verifies on the hash.
  local ts content canon_count
  if ! ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ"); then
    rm -f "$GOV"; echo "NOT governed: failed to read the current time; fail-closed."; exit 1
  fi
  content=$(printf 'governed=%s %s\nqueue_sha256=%s' "$kind" "$ts" "$h")
  # ATOMIC WRITE: write to a govern-queue-private dotfile temp in the SAME directory ($RUN) so the
  # mv is atomic on one filesystem; the temp name is NOT a protected run-control name. The trap
  # removes a leftover temp on interruption (signal between create and mv).
  tmp="$RUN/.queue.governed.tmp.$$"
  trap 'rm -f "$tmp"' EXIT HUP INT TERM
  if ! printf '%s\n' "$content" > "$tmp"; then
    rm -f "$GOV"
    echo "NOT governed: failed to write the governed temp file (disk/permission); fail-closed."
    exit 1
  fi
  if ! mv -f "$tmp" "$GOV"; then
    rm -f "$GOV"
    echo "NOT governed: failed to move the governed temp into place; fail-closed."
    exit 1
  fi
  # POST-WRITE SELF-VERIFY: re-read what we just wrote and require EXACTLY the shape
  # batch-commit-guard.sh enforces — exactly one canonical `^queue_sha256=[0-9a-f]{64}$` line
  # plus a `governed=` line — then confirm the recorded hash equals a fresh recompute. Fail loud
  # (rm + exit 1) on any deviation, so the writer never claims success on a file the guard rejects.
  canon_count=$(grep -cE '^queue_sha256=[0-9a-f]{64}$' "$GOV" 2>/dev/null)
  recorded=$(sed -n 's/^queue_sha256=\([0-9a-f]\{64\}\)$/\1/p' "$GOV" | head -n1)
  recomputed=$(queue_sha256 "$QUEUE")
  if [ "$canon_count" != "1" ] || [ -z "$recorded" ] || ! grep -qE '^governed=' "$GOV"; then
    rm -f "$GOV"
    echo "NOT governed: self-verify expected exactly one canonical queue_sha256 line + a governed= line in queue.governed (found hash-lines=${canon_count:-0}); fail-closed."
    exit 1
  fi
  if [ "$recorded" != "$recomputed" ]; then
    rm -f "$GOV"
    echo "NOT governed: self-verify hash mismatch (recorded=$recorded recomputed=$recomputed); fail-closed."
    exit 1
  fi
  trap - EXIT HUP INT TERM
  GOVERNED_HASH=$recorded
}

if [ "${1:-}" = "--human-approved" ]; then
  # WI-GOVERN-LINT (audit finding X1). --human-approved waives the REVIEW leg ONLY. Governance has
  # two independent legs: LINT (check-queue.sh -> queue.linted) is MECHANICAL field validation of
  # queue.md; REVIEW (mark-queue-reviewed.sh -> queue.reviewed) is an independent reviewer's
  # judgement. A human approving a queue substitutes for the reviewer — it is not a reason to skip
  # mechanical validation. check-queue.sh is also the ONLY place the `Type: UI` -> concrete
  # `Design artifact:` requirement (AGENTS.md §"Operating model", UI-GATES.md §"Queue entry gate")
  # is enforced, so a lint-less --human-approved govern used to put a UI WI into a governed queue
  # with zero design proof. queue.linted is therefore required on EVERY path to queue.governed.
  if [ ! -f "$RUN/queue.linted" ]; then
    rm -f "$GOV"
    echo "missing queue.linted (run check-queue.sh)"
    echo "NOT governed. --human-approved waives the Codex review, not the queue lint — run check-queue.sh first."
    exit 1
  fi
  write_governed "human-approved"
  echo "Queue governed by explicit human approval (content-bound to queue.md)."
  echo "  queue_sha256=$GOVERNED_HASH"
  echo "  queue.governed=$(gov_abspath)"
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
echo "  queue_sha256=$GOVERNED_HASH"
echo "  queue.governed=$(gov_abspath)"
exit 0
