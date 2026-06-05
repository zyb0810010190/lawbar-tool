#!/bin/bash
# block-git-add-all.sh — PreToolUse(Bash) hook.
# Enforces AGENTS.md commit policy: "stage exact paths only." Hard-denies broad git staging.
#
# Statement-aware command-word detection (WI-SCAFFOLD-006): the hook now runs on EVERY Bash
# call (no `if` filter), so it must recognise git regardless of form — path-prefixed
# (/usr/bin/git add, ./git add), command-prefix wrappers (env / command / exec / time / nice /
# nohup / stdbuf / setsid), a backslash-escaped `\git`, leading env assignments, and git global
# options before the subcommand (git -C dir add, git -c k=v add, git --no-pager add). The
# command WORD of each ;/&&/||/|/&-separated statement must itself resolve to git, so
# `echo "git add ."` is ignored. Irrelevant commands exit 0.
#
# Deny set (broad pathspecs): -A  --all  --all=*  -u  --update  .  ./  ./.  :/  '*'
# Fails SAFE: an unparseable git-add-shaped command is denied.
# Out of scope (bounded, mirrors batch-commit-guard.sh): command-substitution / variable-
# indirected forms, full quote-aware parsing, arg-taking wrapper flags (env -u NAME).

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

# Fail safe: could not parse, but the raw payload smells like a git add.
if [ -z "$CMD" ]; then
  if printf '%s' "$INPUT" | grep -qE 'git' && printf '%s' "$INPUT" | grep -qE 'add'; then
    emit_deny "Commit policy (AGENTS.md): could not parse the git command to confirm it stages exact paths; denying as a precaution. Re-issue an explicit 'git add <path>'."
  fi
  exit 0
fi

# For each statement whose command word resolves to git with subcommand `add`, inspect the
# pathspecs for broad forms. Process substitution keeps the loop in the main shell so
# emit_deny's exit terminates the whole hook (not just a pipe subshell).
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
  [ "$sub" = "add" ] || continue
  shift                                            # consume 'add'; the rest are pathspecs/flags
  for tok in "$@"; do
    t=$tok; t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}   # strip surrounding quotes: "*" / "." are as broad as * / .
    case "$t" in
      --) break ;;
      -A|--all|--all=*|-u|--update|.|./|./.|:/|'*')
        emit_deny "Commit policy (AGENTS.md): stage exact paths only. \"$tok\" stages broadly and is forbidden. Use: git add <path> <path>." ;;
    esac
  done
done < <(printf '%s\n' "$CMD" | awk '{gsub(/&&|\|\||[;|&]/, "\n"); print}')
set +f
exit 0
