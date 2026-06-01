#!/bin/bash
# check-staged-files.sh — verify the staged set is exactly what this WI intends.
# Fails if staging is empty, or if any staged path intersects forbidden-paths.txt.
# (Pairs with the git-add/commit hooks: those block broad staging; this checks the result.)
set -u
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 1
DENY="dev-memo/run/forbidden-paths.txt"

staged=$(git diff --cached --name-only)
[ -n "$staged" ] || { echo "STAGED FAIL: nothing staged"; exit 1; }

if [ -r "$DENY" ]; then
  hit=0
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    base=${pat%%\**}
    if [ -n "$base" ] && printf '%s\n' "$staged" | grep -qF "$base"; then
      echo "STAGED FAIL: a staged path intersects forbidden path '$pat':"
      printf '%s\n' "$staged" | grep -F "$base"
      hit=1
    fi
  done < "$DENY"
  [ "$hit" -eq 1 ] && exit 1
fi

echo "STAGED OK:"; printf '  %s\n' $staged
exit 0
