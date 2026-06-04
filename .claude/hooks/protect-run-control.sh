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
# control files if you need a firmer boundary.
#
# Fail-closed (PRC-3): if the target path cannot be parsed (malformed / missing payload) AND the
# raw payload references a protected run-control file, this DENIES rather than allowing — an
# unparseable write to a governance file must not slip through. A parse failure with no
# run-control reference is allowed (it is not a recognizable run-control write).

INPUT=$(cat)

deny(){ esc=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"; exit 0; }

# Protected run-control basenames under dev-memo/run/. Keep this regex in sync with the case
# below and with block-run-control-bash-write.sh.
PROTECTED_RE='dev-memo/run/(queue\.governed|queue\.linted|queue\.reviewed|human\.ack|human\.override|override-reason\.md|batch-start|last-batch-audit|risk\.flag|config|forbidden-paths\.txt|\.closeout-pending)'

if command -v jq >/dev/null 2>&1; then
  P=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
else
  P=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"(file_path|path)"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

# Could not parse a target path. Fail CLOSED if the raw payload references a protected file
# (an unparseable write to a governance file must not be allowed through); otherwise allow —
# it is not a recognizable run-control write, so leave it to other hooks/permissions.
if [ -z "$P" ]; then
  if printf '%s' "$INPUT" | grep -qE "$PROTECTED_RE|dev-memo/run/log\.md"; then
    deny "Run-control guard: could not parse the target path of this Write/Edit, but the payload references a protected dev-memo/run/ file (or the append-only audit trail). Denying as a precaution (fail-closed). Re-issue with an explicit file_path, or change run-control state only via the workflow scripts (check-queue.sh / mark-queue-reviewed.sh / govern-queue.sh) or a deliberate human action."
  fi
  exit 0
fi

# Append-only audit trail (PRC-1): dev-memo/run/log.md is intentionally NOT in the blanket deny
# set below — a direct Write/Edit/MultiEdit is allowed ONLY if it preserves the trail
# (append-only: the result keeps the current content as a strict prefix; a Write may only CREATE
# an absent trail). Route any path whose basename mentions log.md to the verifier, which LEXICALLY
# canonicalizes file_path (path.resolve) and enforces the invariant when it resolves to
# dev-memo/run/log.md, exiting 3 (fall through) for any other *log.md* file. Symlink /
# non-"log.md"-named indirection is deferred to PRC-2 (dev-memo/deferred-audit-findings.md).
# Fail-closed: a non-zero verifier exit, or node unavailable for a path that names the trail.
case "$P" in
  *log.md*)
    HOOKDIR="$(cd "$(dirname "$0")" && pwd)"
    if command -v node >/dev/null 2>&1; then
      printf '%s' "$INPUT" | node "$HOOKDIR/logmd-append-guard.mjs"
      case $? in
        0) exit 0 ;;   # canonically dev-memo/run/log.md AND append-only/create -> allow
        3) ;;          # not the audit trail -> fall through to the blanket check below
        *) deny "dev-memo/run/log.md is the append-only audit trail: this Write/Edit would truncate or rewrite existing content (or a Write targets the existing trail). Append a new entry at the end, or use Bash '>>'." ;;
      esac
    else
      # node unavailable: cannot verify append-only NOR lexically canonicalize spellings. A narrow
      # raw-glob (e.g. *dev-memo/run/log.md) would MISS `//`/`../` spellings, which then fall through
      # to the blanket case (where log.md is intentionally unprotected) and ALLOW — a fail-OPEN
      # (audit audit-mpz56jzu-6xiqep, Medium). Fail CLOSED instead: deny EVERY routed *log.md* path.
      # node is a project requirement (Node 22+), so this degraded-mode over-deny of unrelated
      # *log.md* files (e.g. cc-suite-reliability-log.md) is acceptable friction.
      deny "dev-memo/run/log.md append-only check requires node, which is unavailable; denying this *log.md* Write/Edit as a precaution (fail-closed)."
    fi ;;
esac

# Match the protected control files by basename under dev-memo/run/.
case "$P" in
  *dev-memo/run/queue.governed|*dev-memo/run/queue.linted|*dev-memo/run/queue.reviewed\
  |*dev-memo/run/human.ack|*dev-memo/run/human.override|*dev-memo/run/override-reason.md\
  |*dev-memo/run/batch-start|*dev-memo/run/last-batch-audit|*dev-memo/run/risk.flag\
  |*dev-memo/run/config|*dev-memo/run/forbidden-paths.txt|*dev-memo/run/.closeout-pending)
    deny "Run-control file is protected: change $(basename "$P") only via the workflow scripts (check-queue.sh / mark-queue-reviewed.sh / govern-queue.sh) or a deliberate human action — not a direct agent write. This prevents forging governance/override/audit state." ;;
esac
exit 0
