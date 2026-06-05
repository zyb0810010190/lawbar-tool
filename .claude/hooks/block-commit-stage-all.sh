#!/bin/bash
# block-commit-stage-all.sh — PreToolUse(Bash) hook.
# Denies implicit stage-all commits (git commit -a / --all / clustered short flags -am/-va/-aF).
#
# Statement-aware command-word detection (WI-SCAFFOLD-006): the hook now runs on EVERY Bash
# call, so it recognises git regardless of form — path-prefixed (/usr/bin/git commit), wrappers
# (env / command / exec / time / ...), backslash-escaped `\git`, leading env assignments, and
# git global options before `commit` (git -C dir commit, git -c k=v commit, git --no-pager
# commit). The command WORD of each statement must resolve to git, so `echo "git commit -a"` is
# ignored. Quoted message/argument content is stripped FIRST so "-a" inside a message is never
# inspected and message separators don't false-split statements.
#
# Fails SAFE: an unparseable git-commit-shaped command is denied.
# Out of scope (bounded, mirrors batch-commit-guard.sh): command-substitution / variable-
# indirected forms, arg-taking wrapper flags (env -u NAME).

INPUT=$(cat)

# emit_deny <reason>: emit the PreToolUse deny decision as VALID JSON (PRC-4-FU2; mirrors
# protect-run-control.sh deny()). Escaping only `\` and `"` (the old behaviour) left ASCII C0
# control bytes (newline/tab/CR, 0x00-0x1F) UNescaped, which is invalid JSON (RFC 8259 §7) and
# could make the harness fail to register the deny (fail-open). jq -Rs encodes the whole reason as
# a JSON string literal (quotes + all escaping incl C0 + UTF-8). If jq is unavailable OR errors
# (e.g. invalid UTF-8), fall back to stripping C0 controls to spaces + escaping `\`/`"` — still
# valid JSON (non-UTF-8 bytes in that degraded path are a documented residual).
emit_deny() {
  local reason=$1 enc
  if command -v jq >/dev/null 2>&1 && enc=$(printf '%s' "$reason" | jq -Rs . 2>/dev/null) && [ -n "$enc" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$enc"
  else
    enc=$(printf '%s' "$reason" | tr '\000-\037' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$enc"
  fi
  exit 0
}

if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  CMD=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

# Fail safe: could not parse, but the raw payload smells like a git commit.
if [ -z "$CMD" ]; then
  if printf '%s' "$INPUT" | grep -qE 'git' && printf '%s' "$INPUT" | grep -qE 'commit'; then
    emit_deny "Commit policy (AGENTS.md): could not parse the git commit to confirm it does not stage all; denying as a precaution. Stage exact paths, then commit without -a."
  fi
  exit 0
fi

# Strip quoted substrings FIRST so message content is never inspected as flags and message
# separators never false-split a statement.
SCAN=$(printf '%s' "$CMD" | sed -E 's/"[^"]*"//g; s/'"'"'[^'"'"']*'"'"'//g')

# For each statement whose command word resolves to git with subcommand `commit`, inspect the
# commit flags for -a / --all / clustered short flags. Process substitution keeps the loop in
# the main shell so emit_deny's exit terminates the whole hook.
set -f
while IFS= read -r stmt; do
  set -- $stmt
  while [ $# -gt 0 ]; do                          # unwrap env assignments + wrappers + \git
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
  case "$cmd0" in git|*/git) ;; *) continue ;; esac
  shift
  sub=""
  while [ $# -gt 0 ]; do                           # walk git global options to the subcommand
    case "$1" in
      -C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--exec-path) shift; [ $# -gt 0 ] && shift ;;
      -*) shift ;;
      *) sub=$1; break ;;
    esac
  done
  [ "$sub" = "commit" ] || continue
  shift                                            # consume 'commit'; the rest are commit flags
  for tok in "$@"; do
    case "$tok" in
      --) break ;;
      --all|--all=*)
        emit_deny "Commit policy (AGENTS.md): git commit --all stages tracked modifications implicitly and is forbidden. Stage exact paths first, then commit." ;;
      --*) : ;;
      -*)
        rest=${tok#-}
        while [ -n "$rest" ]; do
          ch=${rest%${rest#?}}; rest=${rest#?}
          case "$ch" in
            a) emit_deny "Commit policy (AGENTS.md): \"$tok\" includes -a, which stages tracked modifications implicitly and is forbidden. Stage exact paths first, then commit." ;;
            m|F|C|c|t|S|u|U) [ -n "$rest" ] && break ;;
          esac
        done
        ;;
    esac
  done
done < <(printf '%s\n' "$SCAN" | awk '{gsub(/&&|\|\||[;|&]/, "\n"); print}')
set +f
exit 0
