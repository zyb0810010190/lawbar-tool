#!/bin/bash
# batch-commit-guard.sh — PreToolUse(Bash) hook on `git commit*`.
# Enforces the autonomous-batch boundary mechanically (not by instruction). Fails SAFE.
#
# Gated mode (AUTO_ADVANCE_MAX<=1): every commit requires a single-use dev-memo/run/human.ack.
# Batch mode (AUTO_ADVANCE_MAX>1): denies the commit unless the queue is GOVERNED, no risk
#   flag is pending, a batch audit is not due, and the git-derived auto-commit count is under
#   the breaker. The only batch escape is a single-use, logged human.override + reason file.
# Authority: this hook is the enforcement truth for the commit boundary (see README Authority
#   map). It does NOT own staging/secrets checks — those are the other two commit hooks.

INPUT=$(cat)
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  CMD=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

deny() {
  esc=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"
  exit 0
}

# Only act on git commit. If we can't read the command but it mentions commit, fail safe.
if [ -z "$CMD" ]; then
  printf '%s' "$INPUT" | grep -qE 'git[[:space:]]+(-C[[:space:]]+[^ ]+[[:space:]]+)?commit' \
    && deny "Batch guard: could not parse the git commit to verify batch limits; denying as a precaution."
  exit 0
fi
echo "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?commit([[:space:]]|$)' || exit 0

RUN="${CLAUDE_PROJECT_DIR}/dev-memo/run"

# Read config FIRST — authorization rules depend on mode. Missing/unreadable = fail safe.
[ -r "$RUN/config" ] || deny "Batch guard: dev-memo/run/config unreadable; cannot verify batch limits. Restore run state or use a gated-mode human.ack."
# BRE \+ is GNU-only; BSD/macOS sed treats it as a literal '+'. Use [0-9][0-9]* for portability.
MAX=$(sed -n 's/^AUTO_ADVANCE_MAX=\([0-9][0-9]*\).*/\1/p' "$RUN/config" | head -1)
EVERY=$(sed -n 's/^BATCH_AUDIT_EVERY=\([0-9][0-9]*\).*/\1/p' "$RUN/config" | head -1)
[ -n "$MAX" ] || deny "Batch guard: AUTO_ADVANCE_MAX not set in config; denying."
[ -n "$EVERY" ] || EVERY=$MAX

# --- Gated mode (MAX<=1): every commit needs a single-use human.ack. Nothing else applies. ---
if [ "$MAX" -le 1 ]; then
  if [ -f "$RUN/human.ack" ]; then rm -f "$RUN/human.ack" 2>/dev/null; exit 0; fi
  deny "Batch guard: gated mode (AUTO_ADVANCE_MAX=$MAX) requires a single-use dev-memo/run/human.ack for every commit."
fi

# --- Batch mode (MAX>1). human.ack does NOT apply here (it's a gated-mode token). ---
# The only batch-mode escape is a deliberate, logged human.override + non-empty reason file.
# It still does NOT bypass the staging/secrets checks enforced by the other commit hooks.
OVERRIDE=0
if [ -f "$RUN/human.override" ] && [ -s "$RUN/override-reason.md" ]; then
  OVERRIDE=1
  printf '%s override consumed: %s\n' "$(date -u +%FT%TZ)" "$(head -1 "$RUN/override-reason.md")" >> "$RUN/log.md" 2>/dev/null
  rm -f "$RUN/human.override" 2>/dev/null   # single-use; reason file kept for the audit trail
fi

if [ "$OVERRIDE" -eq 0 ]; then
  # Risk trigger pending → must be cleared (audited) before any further commit.
  [ -f "$RUN/risk.flag" ] && deny "Batch guard: a Layer-C risk trigger is pending ($(cat "$RUN/risk.flag" 2>/dev/null)). Run the batch audit and clear dev-memo/run/risk.flag first."

  # Queue must be GOVERNED. governed is written ONLY by govern-queue.sh, which requires BOTH
  # queue.linted (check-queue.sh) AND queue.reviewed (Codex /review-plan) — or human approval.
  [ -f "$RUN/queue.governed" ] || deny "Batch guard: queue is not governed. Need queue.linted + queue.reviewed (then govern-queue.sh), or explicit human approval. Lint alone is not sufficient."

  # Counter is GIT-DERIVED, not agent-maintained: commits since the current window start.
  # BASE = the NEWER of batch-start and last-batch-audit (BATCH-COUNTER-001 fix).
  #   - batch-start defines the current batch window (reset when a new batch begins).
  #   - last-batch-audit advances the window when a Layer-B audit is recorded mid-batch.
  # The newer commit is the live boundary; a stale predecessor must NOT override it (the old
  # code always preferred last-batch-audit, so resetting batch-start forward had no effect and
  # non-batch commits before the stale audit kept counting). Moving batch-start forward is a
  # privileged act — protect-run-control.sh + block-run-control-bash-write.sh restrict those
  # files to the workflow scripts or a deliberate human action — so newer-wins is not an
  # agent-exploitable escape. Invalid/garbage refs are dropped (closes a fail-open where an
  # unresolvable last-batch-audit yielded COUNT=0 and the breaker never fired).
  GIT() { git -C "$CLAUDE_PROJECT_DIR" "$@"; }
  valid_ref() { [ -n "$1" ] && GIT cat-file -e "${1}^{commit}" 2>/dev/null; }
  BS=""; LBA=""
  [ -r "$RUN/batch-start" ]      && BS=$(tr -dc '0-9a-f' < "$RUN/batch-start")
  [ -r "$RUN/last-batch-audit" ] && LBA=$(tr -dc '0-9a-f' < "$RUN/last-batch-audit")
  valid_ref "$BS"  || BS=""
  valid_ref "$LBA" || LBA=""
  BASE=""
  if [ -n "$BS" ] && [ -n "$LBA" ]; then
    if [ "$BS" = "$LBA" ]; then
      BASE=$BS
    elif GIT merge-base --is-ancestor "$BS" "$LBA" 2>/dev/null; then
      BASE=$LBA   # batch-start is an ancestor of the audit checkpoint -> audit is newer
    elif GIT merge-base --is-ancestor "$LBA" "$BS" 2>/dev/null; then
      BASE=$BS    # audit checkpoint is an ancestor of batch-start -> reset batch-start is newer
    else
      # Divergent/unrelated history: fail SAFE toward auditing sooner (larger count = older base).
      cbs=$(GIT rev-list --count "${BS}..HEAD" 2>/dev/null);  cbs=${cbs:-0}
      clba=$(GIT rev-list --count "${LBA}..HEAD" 2>/dev/null); clba=${clba:-0}
      if [ "$cbs" -ge "$clba" ]; then BASE=$BS; else BASE=$LBA; fi
    fi
  elif [ -n "$BS" ]; then
    BASE=$BS
  elif [ -n "$LBA" ]; then
    BASE=$LBA
  fi
  [ -n "$BASE" ] || deny "Batch guard: no valid last-batch-audit or batch-start commit recorded; cannot derive the auto-commit count. Record dev-memo/run/batch-start (current HEAD) before auto-committing."
  COUNT=$(GIT rev-list --count "${BASE}..HEAD" 2>/dev/null)
  COUNT=${COUNT:-0}

  [ "$COUNT" -ge "$EVERY" ] && deny "Batch guard: batch audit DUE ($COUNT commits since last audit >= BATCH_AUDIT_EVERY=$EVERY). Run the batch audit and record new HEAD in dev-memo/run/last-batch-audit, then commit."
  [ "$COUNT" -ge "$MAX" ] && deny "Batch guard: AUTO_ADVANCE_MAX=$MAX reached ($COUNT consecutive auto-commits). Stop for human review; use a logged human.override to continue."
fi

# Allowed. Count is git-derived — no counter file to maintain.
exit 0
