#!/bin/bash
# block-run-control-bash-write.sh — PreToolUse(Bash) hook.
# Denies DIRECT Bash writes to the dev-memo/run/ AUTHORITY/STATE files (governance + audit
# state), closing the High-severity tamper path that protect-run-control.sh leaves open:
# that hook covers Write|Edit|MultiEdit but NOT Bash, so `echo X > dev-memo/run/config`,
# `tee dev-memo/run/queue.governed`, `ln dev-memo/run/human.ack ...`, `sed -i ... config`,
# `rm dev-memo/run/queue.reviewed`, etc. can forge governance/override/audit state and bypass
# batch-commit-guard.sh. Evidence: dev-memo/hook-audit-canary-01.md (BASH-WRITE-BYPASS, High).
#
# Policy:
#   - Authority/state files (mirror protect-run-control.sh): ALL Bash writes denied
#     (redirection, tee, cp, mv, install, ln, truncate, dd of=, sed -i, rm, unlink, touch).
#     These change only via the workflow scripts (which name script paths, not the state
#     files, on the command line) or a deliberate human action.
#   - log.md (the audit trail): APPEND-ONLY. `>>` / `tee -a` allowed; truncate/overwrite (`>`),
#     rm, mv, cp, ln, dd, sed -i denied. This preserves the agent-appended audit trail that
#     batch-commit-guard.sh and the workflow lifecycle rely on.
#   - queue.md (authored), README.md, queue.example.md, reviews/ are NOT authority state —
#     writes allowed.
#
# Fails SAFE: an unparseable command that appears to write into dev-memo/run/ is denied.
# BSD/macOS-portable: no GNU-only regex idioms (see dev-memo/hook-audit-canary-01.md).
# This hook is conservative — a write verb co-occurring with an authority path is denied even
# if that path is only a read source; the legitimate workflow scripts never name state files
# directly, so they are unaffected.

INPUT=$(cat)

emit_deny() {
  esc=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"
  exit 0
}

# --- parse .tool_input.command (jq preferred; portable fallback) ---
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  CMD=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

# Authority/state basenames. Keep in sync with protect-run-control.sh.
AUTH='config|batch-start|last-batch-audit|queue\.governed|queue\.linted|queue\.reviewed|risk\.flag|human\.ack|human\.override|override-reason\.md|forbidden-paths\.txt'

# --- fast exit / fail-safe when nothing references dev-memo/run/ ---
if [ -z "$CMD" ]; then
  # No parsed command. If the raw payload looks like it writes into run/, fail safe.
  if printf '%s' "$INPUT" | grep -qE 'dev-memo/run/' \
     && printf '%s' "$INPUT" | grep -qE '(>|tee|sed[[:space:]]+-i|[[:space:]](cp|mv|ln|rm|unlink|install|truncate|dd)[[:space:]])'; then
    emit_deny "Run-control guard: could not parse a Bash command that appears to write into dev-memo/run/; denying as a precaution. Re-issue an explicit, parseable command."
  fi
  exit 0
fi
printf '%s' "$CMD" | grep -qE 'dev-memo/run/' || exit 0

# --- helpers ---
ref_auth() { printf '%s' "$CMD" | grep -qE "dev-memo/run/($AUTH)([^A-Za-z0-9._/-]|$)"; }
ref_log()  { printf '%s' "$CMD" | grep -qE 'dev-memo/run/log\.md([^A-Za-z0-9._/-]|$)'; }
has_verb() { printf '%s' "$CMD" | grep -qE "(^|[;&|(\`[:space:]])$1([[:space:]]|$)"; }
is_sed_i() {
  printf '%s' "$CMD" | grep -qE "(^|[;&|[:space:]])(sed|perl)([[:space:]]|$)" \
    && printf '%s' "$CMD" | grep -qE "[[:space:]]-i([[:space:]'\"=]|$)"
}

# --- pass 1: redirection targets (handles > >> >| and fd-prefixed forms) ---
# Normalize redirection operators into word markers, longest first.
NORM=$(printf '%s' "$CMD" | sed -E 's/[0-9]*>>/ __APPEND__ /g; s/[0-9]*>[|]/ __TRUNC__ /g; s/[0-9]*>/ __TRUNC__ /g')
set -f
mode=""
for tok in $NORM; do
  if [ "$mode" = "APP" ] || [ "$mode" = "TRUNC" ]; then
    t=$tok
    t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}   # strip one layer of surrounding quotes
    case "$t" in
      *dev-memo/run/*)
        base=${t##*/}
        if printf '%s' "$base" | grep -qE "^($AUTH)$"; then
          set +f
          emit_deny "Run-control guard: Bash redirection into dev-memo/run/$base is forbidden. Governance/audit state changes only via the workflow scripts or a deliberate human action (protect-run-control.sh covers Write/Edit; this hook covers Bash)."
        fi
        if [ "$base" = "log.md" ] && [ "$mode" = "TRUNC" ]; then
          set +f
          emit_deny "Run-control guard: dev-memo/run/log.md is the append-only audit trail; truncating/overwriting it with '>' is forbidden. Append with '>>' instead."
        fi
        ;;
    esac
    mode=""
    continue
  fi
  case "$tok" in
    __APPEND__) mode="APP" ;;
    __TRUNC__)  mode="TRUNC" ;;
  esac
done
set +f

# --- pass 2: write verbs targeting an AUTHORITY file (any write verb => deny) ---
if ref_auth; then
  for v in tee cp mv install ln rsync truncate dd rm unlink touch chmod chown; do
    has_verb "$v" && emit_deny "Run-control guard: '$v' touching a dev-memo/run/ authority file is forbidden — governance/audit state changes only via the workflow scripts or a deliberate human action."
  done
  is_sed_i && emit_deny "Run-control guard: in-place edit (sed -i / perl -i) of a dev-memo/run/ authority file is forbidden."
fi

# --- pass 3: log.md is append-only under write verbs (tee allowed only with -a) ---
if ref_log; then
  if has_verb tee; then
    printf '%s' "$CMD" | grep -qE 'tee[[:space:]]+(-a|--append)([[:space:]]|$)' \
      || emit_deny "Run-control guard: 'tee' without -a to dev-memo/run/log.md would truncate the append-only audit trail. Use 'tee -a'."
  fi
  for v in rm unlink truncate mv cp ln rsync dd; do
    has_verb "$v" && emit_deny "Run-control guard: '$v' on dev-memo/run/log.md is forbidden — the audit trail is append-only."
  done
  is_sed_i && emit_deny "Run-control guard: in-place edit of dev-memo/run/log.md is forbidden — the audit trail is append-only."
fi

exit 0
