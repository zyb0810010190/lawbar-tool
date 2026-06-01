#!/bin/bash
# check-ui-design-artifact.sh — PR-time UI design proof guard.
# Fails when app UI paths changed but the PR body lacks a concrete "Design artifact:" line.
#
# Usage:
#   PR_BODY="..." bash scripts/workflow/check-ui-design-artifact.sh --base <base> --head <head>
#   PR_BODY="..." bash scripts/workflow/check-ui-design-artifact.sh --changed-files <file>
#
# Exit 0 = pass, 1 = fail.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" || exit 1

base=""
head=""
changed_file=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) base="${2:-}"; shift 2 ;;
    --head) head="${2:-}"; shift 2 ;;
    --changed-files) changed_file="${2:-}"; shift 2 ;;
    *) echo "usage: check-ui-design-artifact.sh [--base <sha> --head <sha> | --changed-files <file>]"; exit 1 ;;
  esac
done

if [ -n "$changed_file" ]; then
  [ -r "$changed_file" ] || { echo "UI DESIGN FAIL: changed-files list not readable: $changed_file"; exit 1; }
  changed=$(cat "$changed_file")
elif [ -n "$base" ] && [ -n "$head" ]; then
  changed=$(git diff --name-only "$base...$head")
else
  echo "UI DESIGN FAIL: provide --base/--head or --changed-files"
  exit 1
fi

is_ui_path() {
  case "$1" in
    apps/*/renderer/*) return 0 ;;
    apps/*/renderer/**/*) return 0 ;;
    apps/**/*.tsx|apps/**/*.jsx|apps/**/*.css|apps/**/*.scss|apps/**/*.svg|apps/**/*.png) return 0 ;;
    *) return 1 ;;
  esac
}

ui_paths=""
while IFS= read -r path; do
  [ -z "$path" ] && continue
  if is_ui_path "$path"; then
    ui_paths="${ui_paths}${path}
"
  fi
done <<EOF_CHANGED
$changed
EOF_CHANGED

if [ -z "$ui_paths" ]; then
  echo "UI DESIGN OK: no app UI paths changed"
  exit 0
fi

body="${PR_BODY:-}"

design=$(
  printf '%s\n' "$body" |
    sed -n 's/^[[:space:]]*[-*]*[[:space:]]*Design artifact:[[:space:]]*//Ip' |
    head -1 |
    sed 's/[[:space:]]*$//'
)

if [ -z "$design" ] || printf '%s' "$design" | grep -qiE '^(none|n/a|na|tbd|todo|pending|tba)$'; then
  echo "UI DESIGN FAIL: app UI paths changed but PR body lacks a concrete 'Design artifact:' line."
  echo
  echo "Changed UI paths:"
  printf '  %s\n' $ui_paths
  echo
  echo "Add a PR body line like:"
  echo "  Design artifact: dev-memo/design/2026-06-01-empty-state.md (Claude Design export)"
  exit 1
fi

echo "UI DESIGN OK: app UI paths changed and PR body includes Design artifact: $design"
exit 0
