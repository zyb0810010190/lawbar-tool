#!/bin/bash
# check-queue.sh — queue LINT only. Validates dev-memo/run/queue.md content quality.
# On PASS writes dev-memo/run/queue.linted. Does NOT write queue.governed (see govern-queue.sh).
# Exit 0 = pass, 1 = fail.

set -u
RUN="${CLAUDE_PROJECT_DIR:-.}/dev-memo/run"
Q="$RUN/queue.md"
LINTED="$RUN/queue.linted"
DENY="$RUN/forbidden-paths.txt"
VALID_TYPES="PLAN SOURCE ASSET IMPL TEST REVIEW EVIDENCE CLOSURE SCAFFOLD WORKFLOW MEMORY"
problems=(); fail=0
note(){ problems+=("$1"); fail=1; }

[ -r "$Q" ] || { echo "FAIL: $Q not found"; rm -f "$LINTED"; exit 1; }

# Split into per-WI blocks by writing each block to a temp file. A block starts at '## WI-'
# (with optional leading whitespace) and runs until the next such header or EOF.
tmp=$(mktemp -d)
awk -v dir="$tmp" '
  /^[[:space:]]*##[[:space:]]*WI-/ { n++; f=sprintf("%s/%03d", dir, n) }
  n>0 { print > f }
' "$Q"

nblocks=$(ls "$tmp" 2>/dev/null | wc -l | tr -d ' ')
[ "$nblocks" -gt 0 ] || note "no '## WI-<id>' blocks found"

# field value: tolerate leading whitespace, strip trailing inline '# comment', trim.
fieldval(){
  sed -n "s/^[[:space:]]*$1:[[:space:]]*//p" "$2" | head -1 | sed 's/[[:space:]]*#.*$//' | sed 's/[[:space:]]*$//'
}

seen_ids=""
for bf in $(ls "$tmp" 2>/dev/null | sort); do
  B="$tmp/$bf"
  id=$(sed -n 's/^[[:space:]]*##[[:space:]]*WI-\([^:[:space:]]*\).*/\1/p' "$B" | head -1)
  id=${id:-"#$bf"}
  printf '%s\n' "$seen_ids" | grep -qx "$id" && note "duplicate id: WI-$id"
  seen_ids="$seen_ids
$id"

  for f in "Type" "Scope" "Source of truth" "Allowed files" "Forbidden files" "Gates" \
           "Acceptance criteria" "Risk flags" "Depends on" "Commit boundary"; do
    v=$(fieldval "$f" "$B")
    [ -n "$v" ] || note "WI $id: field '$f' missing or empty"
  done

  typ=$(fieldval "Type" "$B")
  scope=$(fieldval "Scope" "$B")
  gates=$(fieldval "Gates" "$B")
  allowed=$(fieldval "Allowed files" "$B")
  accept=$(fieldval "Acceptance criteria" "$B")

  if [ -n "$typ" ] && ! printf '%s ' $VALID_TYPES | grep -qw "$typ"; then
    note "WI $id: invalid Type '$typ'"
  fi
  printf '%s' "$scope" | grep -qiE '^(cleanup|refactor|improve|fix stuff)$' && note "WI $id: vague scope '$scope'"
  case "$typ" in
    IMPL|TEST|UI) printf '%s' "$gates" | grep -qiE '^(none|n/a)?$' && note "WI $id: $typ work needs real Gates, got '$gates'";;
  esac
  [ -n "$accept" ] && ! printf '%s' "$accept" | grep -qiE '(show|block|return|equal|match|pass|fail|render|exist|reject|contain|display|>=|<=|==|output)' \
    && note "WI $id: Acceptance criteria not observable/checkable: '$accept'"
  if [ -r "$DENY" ] && [ -n "$allowed" ]; then
    while IFS= read -r pat; do
      [ -z "$pat" ] && continue
      base=${pat%%\**}
      [ -n "$base" ] && printf '%s' "$allowed" | grep -qF "$base" && note "WI $id: Allowed files intersects forbidden path '$pat'"
    done < "$DENY"
  fi
  dep=$(fieldval "Depends on" "$B")
  if [ -n "$dep" ] && [ "$dep" != "none" ]; then
    dn=$(printf '%s' "$dep" | grep -oE '[0-9]+' | head -1)
    sn=$(printf '%s' "$id" | grep -oE '[0-9]+' | head -1)
    [ -n "$dn" ] && [ -n "$sn" ] && [ "$dn" -gt "$sn" ] && note "WI $id: depends on later WI ($dep)"
  fi
done
rm -rf "$tmp"

if [ "$fail" -ne 0 ]; then
  echo "QUEUE LINT FAILED:"; printf '  - %s\n' "${problems[@]}"; rm -f "$LINTED"; exit 1
fi
echo "QUEUE LINT PASSED"
date -u +"linted=%Y-%m-%dT%H:%M:%SZ" > "$LINTED"
echo "Wrote $LINTED. Governance still requires Codex review (queue.reviewed) + govern-queue.sh."
exit 0
