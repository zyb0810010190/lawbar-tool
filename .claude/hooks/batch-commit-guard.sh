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

# deny <reason>: emit the PreToolUse deny decision as VALID JSON (PRC-4-FU; mirrors
# protect-run-control.sh deny()). Escaping only `\` and `"` (the old behaviour) left ASCII C0
# control bytes (newline/tab/CR, 0x00-0x1F) UNescaped, which is invalid JSON (RFC 8259 §7) and
# could make the harness fail to register the deny (fail-open). jq -Rs encodes the whole reason as
# a JSON string literal (quotes + all escaping incl C0 + UTF-8). If jq is unavailable OR errors
# (e.g. invalid UTF-8), fall back to stripping C0 controls to spaces + escaping `\`/`"` — still
# valid JSON (non-UTF-8 bytes in that degraded path are a documented residual).
deny() {
  local reason=$1 enc
  if command -v jq >/dev/null 2>&1 && enc=$(printf '%s' "$reason" | jq -Rs . 2>/dev/null) && [ -n "$enc" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$enc"
  else
    enc=$(printf '%s' "$reason" | tr '\000-\037' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$enc"
  fi
  exit 0
}

# Only act on git commit. If we can't read the command but it smells like a git commit, fail safe.
if [ -z "$CMD" ]; then
  if printf '%s' "$INPUT" | grep -qE 'git' && printf '%s' "$INPUT" | grep -qE 'commit'; then
    deny "Batch guard: could not parse the git commit to verify batch limits; denying as a precaution."
  fi
  exit 0
fi

# Count git-commit invocations robustly (closes bypasses in audit job audit-mpuesqmt-4zzpxr):
#   - absolute/relative path command word:  /usr/bin/git commit ,  ./git commit
#   - git global options before the subcommand:  git -c k=v commit ,  git --no-pager commit
#   - leading environment assignments:  FOO=bar git commit
#   - MULTIPLE commits in one Bash call (one PreToolUse decision must not authorize several)
# Statement-aware: the COMMAND WORD of each ;/&&/||/|/&-separated statement must itself be git
# (optionally path-prefixed), so `echo "git commit"` and `git config commit.x` are NOT counted.
# Out of scope (deferred to a later WI): command-substitution / variable-indirected forms
# such as `git $(echo commit)` or `c=commit; git $c` — see dev-memo/deferred-audit-findings.md.
count_git_commits() {
  # Split on ;  &&  ||  |  & into one statement per line. awk handles the newline replacement
  # and trailing newline portably (BSD sed drops an unterminated final line -> miscount).
  printf '%s\n' "$1" \
    | awk '{gsub(/&&|\|\||[;|&]/, "\n"); print}' \
    | while IFS= read -r stmt; do
        set -f; set -- $stmt; set +f
        # Unwrap leading VAR=value assignments and benign command-prefix wrappers
        # (env / command / exec / time / nice / nohup / stdbuf / setsid) plus a backslash-escaped
        # `\git`, to reach the real command word. Only no-arg wrapper flags + assignments are
        # skipped; exotic arg-taking wrapper forms (env -u NAME, exec -a NAME) remain a recorded
        # gap (dev-memo/deferred-audit-findings.md). This is bounded unwrapping, NOT a shell parser.
        while [ $# -gt 0 ]; do
          w=$1; w=${w#\"}; w=${w#\'}; w=${w#\\}      # strip one quote / backslash-escape
          case "$w" in
            [A-Za-z_]*=*) shift ;;                    # VAR=value assignment
            command|exec|time|env|nice|nohup|stdbuf|setsid)
              shift                                   # drop wrapper, then its flags + assignments
              while [ $# -gt 0 ]; do
                case "$1" in -*) shift ;; [A-Za-z_]*=*) shift ;; *) break ;; esac
              done ;;
            *) break ;;                               # real command word reached
          esac
        done
        [ $# -gt 0 ] || continue
        cmd0=$1; cmd0=${cmd0#\"}; cmd0=${cmd0#\'}; cmd0=${cmd0#\\}   # strip quote / backslash-escape
        case "$cmd0" in git|*/git) ;; *) continue ;; esac
        shift
        sub=""
        while [ $# -gt 0 ]; do                        # walk git global options to the subcommand
          case "$1" in
            -C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--exec-path)
              shift; [ $# -gt 0 ] && shift ;;         # these take a separate argument
            -*) shift ;;                              # other global flags / --opt=val forms
            *) sub=$1; break ;;
          esac
        done
        [ "$sub" = "commit" ] && echo X
      done | grep -c X
}
NCOMMIT=$(count_git_commits "$CMD")
[ "${NCOMMIT:-0}" -eq 0 ] && exit 0
[ "${NCOMMIT:-0}" -ge 2 ] && deny "Batch guard: $NCOMMIT git-commit invocations in one command — a single PreToolUse decision cannot authorize multiple commits. Issue one 'git commit' per command so each is gated."

RUN="${CLAUDE_PROJECT_DIR}/dev-memo/run"

# Read config FIRST — authorization rules depend on mode. Missing/unreadable = fail safe.
[ -r "$RUN/config" ] || deny "Batch guard: dev-memo/run/config unreadable; cannot verify batch limits. Restore run state or use a gated-mode human.ack."
# BCG-7 hardening: read the RAW value (full RHS, trailing inline #comment + surrounding whitespace
# normalized) and validate STRICTLY so a malformed / out-of-set / huge-digit value FAILS CLOSED (deny)
# instead of being captured and then crashing a later bash integer compare ([ COUNT -ge EVERY/MAX ]),
# which returned non-true and SILENTLY SKIPPED the breaker (fail-OPEN). AUTO_ADVANCE_MAX must be one of
# the documented modes {1,3,10}; BATCH_AUDIT_EVERY, WHEN PRESENT, must be a bare integer in [1,100].
# Strip ONLY a whitespace-separated trailing inline comment (`value  # note`), then trim trailing
# whitespace. A `#` with NO preceding whitespace is NOT a comment (shell assignment semantics treat
# `VAR=3#x` as the literal `3#x`), so e.g. `BATCH_AUDIT_EVERY=3#junk` survives as `3#junk` and fails the
# bare-integer check below (fail-closed) rather than being silently normalized to `3` (audit Low).
cfgval(){ sed -n "s/^$1=//p" "$RUN/config" | head -1 | sed 's/[[:space:]][[:space:]]*#.*$//; s/[[:space:]]*$//'; }
RAWMAX=$(cfgval AUTO_ADVANCE_MAX)
RAWEVERY=$(cfgval BATCH_AUDIT_EVERY)
[ -n "$RAWMAX" ] || deny "Batch guard: AUTO_ADVANCE_MAX not set in config; denying."
case "$RAWMAX" in
  1|3|10) MAX=$RAWMAX ;;
  *) deny "Batch guard: AUTO_ADVANCE_MAX='$RAWMAX' is not one of the allowed modes {1,3,10}; refusing to evaluate batch limits on a malformed config (fail-closed)." ;;
esac
if [ -n "$RAWEVERY" ]; then
  # Reject any non-digit first; then bound the digit LENGTH (<=3, since 100 has 3 digits) BEFORE any
  # arithmetic/compare so a huge-digit value cannot overflow/crash the integer compare (the BCG-7 bug).
  case "$RAWEVERY" in
    *[!0-9]*) deny "Batch guard: BATCH_AUDIT_EVERY='$RAWEVERY' is not a bare positive integer; fail-closed." ;;
  esac
  if [ "${#RAWEVERY}" -gt 3 ] || [ "$((10#$RAWEVERY))" -lt 1 ] || [ "$((10#$RAWEVERY))" -gt 100 ]; then
    deny "Batch guard: BATCH_AUDIT_EVERY='$RAWEVERY' is outside the allowed range [1,100]; fail-closed."
  fi
  EVERY=$((10#$RAWEVERY))
else
  EVERY=$MAX   # documented fallback: an unset/empty BATCH_AUDIT_EVERY defaults to the (validated) MAX
fi

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

  # Closeout-in-progress (BATCH-CLOSEOUT-AUTO-00). The verified closeout
  # (scripts/workflow/batch-closeout.mjs) writes dev-memo/run/.closeout-pending BEFORE it mutates
  # the marker and removes it only after its own batch-close commit succeeds. While the sentinel
  # exists the audit window is, by construction, NOT yet cleared — so treat the batch as still
  # audit-DUE and deny every normal agent commit. This is STRICTLY ADDITIVE: it can only ADD a
  # denial (it never permits a commit the count/governed/risk checks already blocked). The
  # closeout's own commit is a child process of node, not a Claude Bash-tool call, so it is not
  # gated here. A crash mid-closeout leaves the sentinel → this deny holds → re-running the
  # closeout reconciles. The sentinel is tamper-protected by protect-run-control.sh +
  # block-run-control-bash-write.sh (only the closeout script may write/remove it).
  [ -f "$RUN/.closeout-pending" ] && deny "Batch guard: a batch-closeout is in progress (dev-memo/run/.closeout-pending present); the audit window is not yet cleared, so commits remain blocked as audit-DUE. Re-run scripts/workflow/batch-closeout.mjs to complete or reconcile the closeout first."

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
      # Fail-closed like the final count: a rev-list failure here must NOT coerce to 0 and let a
      # wrong base be chosen (audit job audit-mpufm338-2gtelo finding #4).
      cbs=$(GIT rev-list --count "${BS}..HEAD" 2>/dev/null);  cbsrc=$?
      clba=$(GIT rev-list --count "${LBA}..HEAD" 2>/dev/null); clbarc=$?
      if [ "$cbsrc" -ne 0 ] || [ "$clbarc" -ne 0 ] \
         || ! printf '%s' "$cbs" | grep -qE '^[0-9]+$' \
         || ! printf '%s' "$clba" | grep -qE '^[0-9]+$'; then
        deny "Batch guard: could not compare divergent batch-start/last-batch-audit (git rev-list failed); denying as a precaution — check repository history integrity."
      fi
      if [ "$cbs" -ge "$clba" ]; then BASE=$BS; else BASE=$LBA; fi
    fi
  elif [ -n "$BS" ]; then
    BASE=$BS
  elif [ -n "$LBA" ]; then
    BASE=$LBA
  fi
  [ -n "$BASE" ] || deny "Batch guard: no valid last-batch-audit or batch-start commit recorded; cannot derive the auto-commit count. Record dev-memo/run/batch-start (current HEAD) before auto-committing."
  # Capture rev-list exit status: a runtime failure (shallow/damaged history) must NOT silently
  # become COUNT=0 and pass the breaker (fail-open closed; audit job audit-mpuesqmt-4zzpxr).
  COUNT=$(GIT rev-list --count "${BASE}..HEAD" 2>/dev/null); rlrc=$?
  if [ "$rlrc" -ne 0 ] || ! printf '%s' "$COUNT" | grep -qE '^[0-9]+$'; then
    deny "Batch guard: could not derive a reliable commit count (git rev-list failed rc=$rlrc or returned non-numeric '$COUNT') for BASE=$BASE. Denying as a precaution — check repository history (shallow/damaged?) and the recorded batch-start/last-batch-audit."
  fi

  [ "$COUNT" -ge "$EVERY" ] && deny "Batch guard: batch audit DUE ($COUNT commits since last audit >= BATCH_AUDIT_EVERY=$EVERY). Run the batch audit and record new HEAD in dev-memo/run/last-batch-audit, then commit."
  [ "$COUNT" -ge "$MAX" ] && deny "Batch guard: AUTO_ADVANCE_MAX=$MAX reached ($COUNT consecutive auto-commits). Stop for human review; use a logged human.override to continue."
fi

# Allowed. Count is git-derived — no counter file to maintain.
exit 0
