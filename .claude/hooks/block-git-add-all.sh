#!/bin/bash
# block-git-add-all.sh — PreToolUse(Bash) hook.
# Enforces AGENTS.md commit policy: "stage exact paths only."
# Hard-denies broad git staging. Fails SAFE: if it cannot parse the command on a machine
# without jq, it denies a git-add-shaped command rather than letting it through.
#
# Deny set: -A  --all  --all=*  -u  --update  .  ./  ./.  :/  '*'

INPUT=$(cat)

emit_deny() {
  esc=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"
  exit 0
}

# Extract .tool_input.command. jq is bundled with Claude Code; prefer it.
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
  PARSED=ok
else
  # Fallback: non-greedy capture up to the first unescaped closing quote.
  CMD=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
  PARSED=fallback
fi

# If we have no command but the raw input mentions `git add`, fail safe.
if [ -z "$CMD" ]; then
  if printf '%s' "$INPUT" | grep -qE 'git[[:space:]]+(-C[[:space:]]+[^ ]+[[:space:]]+)?add'; then
    emit_deny "Commit policy (AGENTS.md): could not parse the git command to confirm it stages exact paths; denying as a precaution. Re-issue an explicit 'git add <path>'."
  fi
  exit 0
fi

# Only inspect commands that invoke `git add` (allow an optional `git -C <dir>`).
echo "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?add([[:space:]]|$)' || exit 0

# Disable globbing so a literal '*' stays '*' rather than expanding to filenames.
set -f
# Strip an optional `-C <dir>` so its directory arg isn't scanned as a pathspec.
ADDARGS=$(echo "$CMD" | sed -E 's/.*git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?add[[:space:]]*//')
for tok in $ADDARGS; do
  case "$tok" in
    -A|--all|--all=*|-u|--update|.|./|./.|:/|'*')
      emit_deny "Commit policy (AGENTS.md): stage exact paths only. \"$tok\" stages broadly and is forbidden. Use: git add <path> <path>." ;;
  esac
done
set +f
exit 0
