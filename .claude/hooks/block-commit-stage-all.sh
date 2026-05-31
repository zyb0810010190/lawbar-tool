#!/bin/bash
# block-commit-stage-all.sh — PreToolUse(Bash) hook.
# Enforces AGENTS.md commit policy: denies implicit stage-all commits
# (git commit -a / --all / clustered short flags like -am, -va, -aF).
# Fails SAFE: an unparseable git-commit-shaped command is denied as a precaution.
# Quoted message/argument content is stripped first so "-a" inside a message is ignored.

INPUT=$(cat)

emit_deny() {
  esc=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"
  exit 0
}

if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  CMD=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

if [ -z "$CMD" ]; then
  if printf '%s' "$INPUT" | grep -qE 'git[[:space:]]+(-C[[:space:]]+[^ ]+[[:space:]]+)?commit'; then
    emit_deny "Commit policy (AGENTS.md): could not parse the git commit to confirm it does not stage all; denying as a precaution. Stage exact paths, then commit without -a."
  fi
  exit 0
fi

echo "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?commit([[:space:]]|$)' || exit 0

# Strip quoted substrings so message content is never inspected as flags.
SCAN=$(printf '%s' "$CMD" | sed -E 's/"[^"]*"//g; s/'"'"'[^'"'"']*'"'"'//g')
set -f
ARGS=$(echo "$SCAN" | sed -E 's/.*git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?commit[[:space:]]*//')
for tok in $ARGS; do
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
set +f
exit 0
