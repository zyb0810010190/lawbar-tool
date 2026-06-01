#!/bin/bash
# protect-run-control.sh — PreToolUse(Write|Edit|MultiEdit) hook.
# Blocks DIRECT writes/edits to run-control authority files. These files must be changed
# only through the intended scripts (check-queue.sh, mark-queue-reviewed.sh, govern-queue.sh)
# or a deliberate human action — not written directly by the agent mid-task, which would let
# it forge governance/override/audit state and bypass batch-commit-guard.sh.
#
# Honest scope: this raises tamper-resistance from "cooperative agent" to "cooperative agent
# + direct-write block." It is NOT cryptographic. An agent that can run arbitrary bash could
# still echo into these files; pair with a permissions.deny on Bash writes to dev-memo/run/
# control files if you need a firmer boundary. Fails SAFE (deny) on parse failure.

INPUT=$(cat)
if command -v jq >/dev/null 2>&1; then
  P=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
else
  P=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"(file_path|path)"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi
[ -z "$P" ] && exit 0   # no path → not a file write we recognize; let other hooks/permissions handle it

deny(){ esc=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"; exit 0; }

# Match the protected control files by basename under dev-memo/run/.
case "$P" in
  *dev-memo/run/queue.governed|*dev-memo/run/queue.linted|*dev-memo/run/queue.reviewed\
  |*dev-memo/run/human.ack|*dev-memo/run/human.override|*dev-memo/run/override-reason.md\
  |*dev-memo/run/batch-start|*dev-memo/run/last-batch-audit|*dev-memo/run/risk.flag\
  |*dev-memo/run/config|*dev-memo/run/forbidden-paths.txt)
    deny "Run-control file is protected: change $(basename "$P") only via the workflow scripts (check-queue.sh / mark-queue-reviewed.sh / govern-queue.sh) or a deliberate human action — not a direct agent write. This prevents forging governance/override/audit state." ;;
esac
exit 0
