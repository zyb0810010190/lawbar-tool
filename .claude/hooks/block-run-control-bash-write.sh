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

# --- helpers --- token classifiers: does a single (quote-stripped) token name an authority file?
tok_auth()  { local t=$1; t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}
  case "$t" in *dev-memo/run/*) printf '%s' "${t##*/}" | grep -qE "^($AUTH)$" ;; *) return 1 ;; esac; }
tok_logmd() { local t=$1; t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}
  case "$t" in *dev-memo/run/log.md) return 0 ;; *) return 1 ;; esac; }

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

# --- pass 2/3: write VERBS targeting an authority file (statement-aware, command-word gated) ---
# A write-like word only counts when it is the COMMAND WORD of a ;/&&/||/|/&-separated statement
# (after unwrapping env-assignments + wrappers + a leading backslash). So a write word in prose
# (echo "...touch..."), or an authority path named by a read-only tool (cat / grep / gh / ls),
# no longer false-denies (BRCBW-5). Only an authority path in a WRITE-TARGET position denies: for
# cp/install/rsync the destination (a source may be read); for dd the of= file (not if=); for
# mv/ln/rm/unlink/truncate/touch/chmod/chown/shred and tee/sed-i any target operand. log.md stays
# append-only. This NARROWS false-positives without weakening any real write (every write form
# above stays covered, and redirection is handled by pass 1).
set -f
while IFS= read -r stmt; do
  set -- $stmt
  while [ $# -gt 0 ]; do                          # unwrap env assignments + wrappers + \cmd
    w=$1; w=${w#\"}; w=${w#\'}; w=${w#\\}
    case "$w" in
      [A-Za-z_]*=*) shift ;;
      command|exec|time|env|nice|nohup|stdbuf|setsid)
        shift; while [ $# -gt 0 ]; do case "$1" in -*) shift ;; [A-Za-z_]*=*) shift ;; *) break ;; esac; done ;;
      *) break ;;
    esac
  done
  [ $# -gt 0 ] || continue
  cmd0=$1; cmd0=${cmd0#\"}; cmd0=${cmd0#\'}; cmd0=${cmd0#\\}
  vbase=${cmd0##*/}                               # strip any path prefix (/bin/rm -> rm)
  shift                                           # $@ now = the command's arguments

  case "$vbase" in
    rm|unlink|truncate|touch|chmod|chown|shred|mv|ln)
      # mutation/removal/link/rename: ANY authority operand is a write target.
      for a in "$@"; do
        [ "$a" = "--" ] && break
        tok_auth  "$a" && { set +f; emit_deny "Run-control guard: '$vbase' targets dev-memo/run/${a##*/} — governance/audit state changes only via the workflow scripts or a deliberate human action."; }
        tok_logmd "$a" && { set +f; emit_deny "Run-control guard: '$vbase' on dev-memo/run/log.md is forbidden — the audit trail is append-only."; }
      done ;;
    cp|install|rsync)
      # destination = value of -t/--target-directory if given, else the last non-flag operand.
      dest=""; tdir=""
      while [ $# -gt 0 ]; do
        case "$1" in
          -t|--target-directory) shift; tdir=$1 ;;
          --target-directory=*) tdir=${1#--target-directory=} ;;
          --) shift; while [ $# -gt 0 ]; do dest=$1; shift; done; break ;;
          -*) : ;;
          *) dest=$1 ;;
        esac
        [ $# -gt 0 ] && shift
      done
      [ -n "$tdir" ] && dest=$tdir
      tok_auth  "$dest" && { set +f; emit_deny "Run-control guard: '$vbase' writes dev-memo/run/${dest##*/} (destination) — change run-control state via the workflow scripts or a deliberate human action."; }
      tok_logmd "$dest" && { set +f; emit_deny "Run-control guard: '$vbase' overwriting dev-memo/run/log.md is forbidden — the audit trail is append-only."; } ;;
    dd)
      for a in "$@"; do
        case "$a" in
          of=*) ofv=${a#of=}
                tok_auth  "$ofv" && { set +f; emit_deny "Run-control guard: 'dd of=' writes dev-memo/run/${ofv##*/} — forbidden."; }
                tok_logmd "$ofv" && { set +f; emit_deny "Run-control guard: 'dd of=' on dev-memo/run/log.md is forbidden — append-only."; } ;;
        esac
      done ;;
    tee)
      appendf=""; for a in "$@"; do case "$a" in -a|--append) appendf=1 ;; esac; done
      for a in "$@"; do
        case "$a" in -*) continue ;; esac
        tok_auth "$a" && { set +f; emit_deny "Run-control guard: 'tee' writes dev-memo/run/${a##*/} — forbidden."; }
        if tok_logmd "$a" && [ -z "$appendf" ]; then set +f; emit_deny "Run-control guard: 'tee' without -a to dev-memo/run/log.md would truncate the append-only audit trail. Use 'tee -a'."; fi
      done ;;
    sed|perl)
      has_i=""; for a in "$@"; do case "$a" in -i|-i*|--in-place|--in-place=*) has_i=1 ;; esac; done
      if [ -n "$has_i" ]; then
        for a in "$@"; do
          tok_auth  "$a" && { set +f; emit_deny "Run-control guard: in-place edit (sed -i / perl -i) of dev-memo/run/${a##*/} is forbidden."; }
          tok_logmd "$a" && { set +f; emit_deny "Run-control guard: in-place edit of dev-memo/run/log.md is forbidden — append-only."; }
        done
      fi ;;
  esac
done < <(printf '%s\n' "$CMD" | awk '{gsub(/&&|\|\||[;|&]/, "\n"); print}')
set +f

exit 0
