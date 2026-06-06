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

# Portable sha256 of a file's bytes -> 64 lowercase hex, or empty string on any failure.
# Resolution order matches scripts/workflow/govern-queue.sh's writer so the digests are comparable.
# Used by the BCG-6 governance-content-binding check below.
guard_sha256() {
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
  # BCG-9: QUOTE-AWARE statement splitting. The split below treats ;  &&  ||  |  & as statement
  # separators, but those characters are ALSO ordinary text inside a quoted `-m` commit message.
  # A blind global split mis-counted `git commit -m "revert; git commit"` as TWO commits (the
  # in-message `git commit` became a second statement) and over-DENIED a legitimate single commit.
  # The neutralize pass below walks each line with a 3-state quote machine (unquoted / single /
  # double, honoring backslash escapes OUTSIDE single quotes per POSIX) and replaces any
  # ;  |  & that occurs INSIDE a quoted span with `_`, so the subsequent split only breaks on
  # OUT-OF-QUOTE separators. If a line's quotes are UNBALANCED (state != unquoted at EOL) the pass
  # falls back to the ORIGINAL line, preserving the old over-deny behavior — it must never turn a
  # genuine multi-command shell into a single counted statement (over-deny is safe; under-count is
  # a security regression). This is bounded quote handling, NOT a full shell parser; a separator
  # inside a quoted message that SPANS multiple physical lines is out of scope (per-line, like the
  # split itself) and falls back to over-deny.
  printf '%s\n' "$1" \
    | awk '{
        s=$0; out=""; st=0   # st: 0=unquoted 1=single 2=double
        for (i=1;i<=length(s);i++) {
          c=substr(s,i,1)
          if (st==0) {
            if (c=="\\") { out=out c; if(i<length(s)){i++; out=out substr(s,i,1)} continue }
            if (c=="'\''") { st=1; out=out c; continue }
            if (c=="\"") { st=2; out=out c; continue }
            out=out c
          } else if (st==1) {                 # single quotes: literal, only '\'' closes (no escapes)
            if (c=="'\''") { st=0; out=out c; continue }
            if (c==";"||c=="|"||c=="&") { out=out "_"; continue }
            out=out c
          } else {                            # double quotes: backslash escapes next char
            if (c=="\\") { out=out c; if(i<length(s)){i++; out=out substr(s,i,1)} continue }
            if (c=="\"") { st=0; out=out c; continue }
            if (c==";"||c=="|"||c=="&") { out=out "_"; continue }
            out=out c
          }
        }
        if (st!=0) print s; else print out    # unbalanced -> fall back to original (over-deny)
      }' \
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
  # BCG-4: consume-on-success. Authorize ONLY if the single-use ack was actually removed; if removal
  # fails (read-only dir / permission), the token PERSISTS, so allowing would make it reusable — deny.
  if [ -f "$RUN/human.ack" ]; then
    if rm -f "$RUN/human.ack" 2>/dev/null && [ ! -e "$RUN/human.ack" ]; then exit 0; fi
    deny "Batch guard: gated-mode dev-memo/run/human.ack could not be consumed (removal failed); refusing to authorize on a token that still exists (fail-closed)."
  fi
  deny "Batch guard: gated mode (AUTO_ADVANCE_MAX=$MAX) requires a single-use dev-memo/run/human.ack for every commit."
fi

# --- Batch mode (MAX>1). human.ack does NOT apply here (it's a gated-mode token). ---
# The only batch-mode escape is a deliberate, logged human.override + non-empty reason file.
# It still does NOT bypass the staging/secrets checks enforced by the other commit hooks.
# BCG-5: grant the batch-mode override (which bypasses risk/governed/count) ONLY when it is fully
# consumed. Authorization chain, left-to-right: (1) the override REASON (first line of
# override-reason.md) is readable + non-empty — a bypass with no recorded reason is not authorized,
# checked BEFORE removal so a blank/unreadable reason denies WITHOUT spending the token; (2) the token
# is removed and confirmed gone; (3) only THEN is the "consumed" audit line appended. OVERRIDE=1 iff
# all three succeed, so log.md never records a "consumed" override that is still present or had no
# reason. Any failure -> deny (fail-closed; the token is single-use and is spent only if removal ran).
OVERRIDE=0
if [ -f "$RUN/human.override" ] && [ -s "$RUN/override-reason.md" ]; then
  ovreason=$(head -1 "$RUN/override-reason.md" 2>/dev/null)
  if [ -n "$ovreason" ] \
     && rm -f "$RUN/human.override" 2>/dev/null && [ ! -e "$RUN/human.override" ] \
     && { printf '%s override consumed: %s\n' "$(date -u +%FT%TZ)" "$ovreason" >> "$RUN/log.md"; } 2>/dev/null; then
    OVERRIDE=1
  else
    deny "Batch guard: dev-memo/run/human.override could not be atomically consumed+logged — the override reason (first line of dev-memo/run/override-reason.md) is empty/unreadable, or token removal / audit-log append failed. Refusing to authorize (the override is single-use; it is spent only if removal succeeded). Re-create dev-memo/run/human.override + a non-empty override-reason.md and ensure dev-memo/run/log.md is writable (fail-closed)."
  fi
fi

if [ "$OVERRIDE" -eq 0 ]; then
  # Risk trigger pending → must be cleared (audited) before any further commit.
  [ -f "$RUN/risk.flag" ] && deny "Batch guard: a Layer-C risk trigger is pending ($(cat "$RUN/risk.flag" 2>/dev/null)). Run the batch audit and clear dev-memo/run/risk.flag first."

  # Queue must be GOVERNED. governed is written ONLY by govern-queue.sh, which requires BOTH
  # queue.linted (check-queue.sh) AND queue.reviewed (Codex /review-plan) — or human approval.
  [ -f "$RUN/queue.governed" ] || deny "Batch guard: queue is not governed. Need queue.linted + queue.reviewed (then govern-queue.sh), or explicit human approval. Lint alone is not sufficient."

  # BCG-6 / GOVERNANCE-CHAIN-001: governance must be CONTENT-BOUND, not presence-only. The old
  # gate above proved only THAT a governance ceremony happened, never that the queue being
  # committed against is the queue that was linted + reviewed. govern-queue.sh records
  # queue_sha256=sha256(queue.md) into queue.governed; here we recompute it and FAIL CLOSED (deny)
  # when the recorded hash is absent, malformed (not 64 lowercase hex), the queue.md is unreadable
  # / unhashable, or the digests MISMATCH (queue.md edited after governance). This block is
  # STRICTLY ADDITIVE: it can only ADD a denial after the presence check, never authorize a commit
  # the prior checks blocked.
  # STRICT parse: require EXACTLY ONE queue_sha256 assignment line AND that it be the canonical
  # form queue_sha256=<64-lowercase-hex>. A lax `tr -d '[:space:]'` extraction would have normalized
  # embedded whitespace (`queue_sha256= <hash>`) into a "valid" digest, and counting ONLY canonical
  # lines would still ALLOW a valid line accompanied by an EXTRA malformed `queue_sha256=` line.
  # TOTAL counts every queue_sha256 assignment (any form); CANON counts only the canonical form.
  # Require TOTAL==1 AND CANON==1 so any malformed/duplicate/whitespace companion line fails closed.
  TOTAL=$(grep -cE '^[[:space:]]*queue_sha256[[:space:]]*=' "$RUN/queue.governed" 2>/dev/null)
  CANON=$(grep -cE '^queue_sha256=[0-9a-f]{64}$' "$RUN/queue.governed" 2>/dev/null)
  { [ "${TOTAL:-0}" -eq 1 ] && [ "${CANON:-0}" -eq 1 ]; } || deny "Batch guard: queue.governed must contain EXACTLY ONE canonical 'queue_sha256=<64-lowercase-hex>' line and no other queue_sha256 line (found total=${TOTAL:-0}, canonical=${CANON:-0}) — governance absent, legacy, malformed, whitespace-padded, or duplicated. Re-run scripts/workflow/govern-queue.sh on the reviewed queue. Fail-closed (BCG-6 / GOVERNANCE-CHAIN-001)."
  RECORDED=$(grep -E '^queue_sha256=[0-9a-f]{64}$' "$RUN/queue.governed" | head -1 | sed 's/^queue_sha256=//')
  [ -r "$RUN/queue.md" ] || deny "Batch guard: dev-memo/run/queue.md is missing/unreadable; cannot verify the governance content hash. Fail-closed (BCG-6)."
  ACTUAL=$(guard_sha256 "$RUN/queue.md")
  case "$ACTUAL" in
    *[!0-9a-f]* | "" ) deny "Batch guard: could not compute sha256(queue.md) (no hash tool available or read error). Fail-closed (BCG-6)." ;;
  esac
  [ "$ACTUAL" = "$RECORDED" ] || deny "Batch guard: queue.md content hash ($ACTUAL) does not match the governed hash ($RECORDED) — queue.md changed after governance. Re-run scripts/workflow/govern-queue.sh on the reviewed queue before committing. Fail-closed (BCG-6 / GOVERNANCE-CHAIN-001)."

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
