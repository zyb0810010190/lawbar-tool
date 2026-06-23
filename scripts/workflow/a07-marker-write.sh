#!/bin/bash
# a07-marker-write.sh — A0.7 marker writer entrypoint (WI-ENA11).
#
# Runs the REAL A0.7 harness (via the a07-harness-cli Swift binary), and ONLY if the verdict is
# status=pass + classification=ok, writes a provenance-bound LOCAL marker (+ guard ledger entry)
# via scripts/workflow/a07_marker.py. Markers are local-only run-state under dev-memo/run/evidence/**
# (gitignored; never committed). The HMAC key is ENV-supplied (LAWBAR_A07_MARKER_HMAC_KEY, >= 32
# chars); a missing/weak key or a non-pass harness result fails closed with NO marker written.
#
# Env / args (all optional; sensible local-first defaults):
#   A07_MARKER_FIXTURE   default: the committed synthetic fixture
#   A07_MARKER_ORACLE    default: the committed oracle.json
#   A07_MARKER_OUT_ROOT  default: $ROOT/dev-memo/run/evidence   (tests override to a temp dir)
#
# Usage: LAWBAR_A07_MARKER_HMAC_KEY=... bash scripts/workflow/a07-marker-write.sh
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$ROOT/native/evidence-core-swift"

FIXTURE="${A07_MARKER_FIXTURE:-$PKG/Tests/EvidenceCoreSmokeTests/Fixtures/synthetic-twopage.pdf}"
ORACLE="${A07_MARKER_ORACLE:-$PKG/Tests/EvidenceCoreSmokeTests/Fixtures/a07-renderer-conformance/oracle.json}"
OUT_ROOT="${A07_MARKER_OUT_ROOT:-$ROOT/dev-memo/run/evidence}"

# Fail closed early on a missing/weak key (a07_marker.py re-checks authoritatively).
KEY="${LAWBAR_A07_MARKER_HMAC_KEY:-}"
if [ "${#KEY}" -lt 32 ]; then
  echo "a07-marker-write: LAWBAR_A07_MARKER_HMAC_KEY missing/empty/too-weak (need >= 32 chars); fail-closed." >&2
  exit 3
fi
command -v openssl >/dev/null 2>&1 || true   # openssl not required (python hmac is used); informational only
for p in "$FIXTURE" "$ORACLE"; do
  [ -f "$p" ] || { echo "a07-marker-write: input not found: $p" >&2; exit 5; }
done

# Build + run the real harness CLI.
swift build --package-path "$PKG" >/dev/null 2>&1 || { echo "a07-marker-write: swift build failed" >&2; exit 6; }
CLI="$PKG/.build/debug/a07-harness-cli"
[ -x "$CLI" ] || { echo "a07-marker-write: harness CLI not built at $CLI" >&2; exit 6; }
HARNESS_OUT="$("$CLI" "$FIXTURE" "$ORACLE")" || true   # non-pass exits non-zero; we classify below
STATUS="$(printf '%s' "$HARNESS_OUT" | cut -f1)"
CLASS="$(printf '%s' "$HARNESS_OUT" | cut -f2)"
PAGES="$(printf '%s' "$HARNESS_OUT" | cut -f3)"
if [ "$STATUS" != "pass" ] || [ "$CLASS" != "ok" ]; then
  echo "a07-marker-write: harness verdict not marker-eligible (status=$STATUS classification=$CLASS); no marker written." >&2
  exit 4
fi

# Repo/tree/harness bindings + tolerance + command/platform context.
REPO_COMMIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
REPO_TREE="$(git -C "$ROOT" rev-parse HEAD^{tree} 2>/dev/null || echo unknown)"
HARNESS_COMMIT="$REPO_COMMIT"
TOLERANCE="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['tolerance']['absolutePdfPoints'])" "$ORACLE")"
PLATFORM="$(uname -srm) | $(swift --version 2>/dev/null | head -n1) | offline-local"
PRODUCED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMAND="a07-harness-cli $(basename "$FIXTURE") $(basename "$ORACLE")"

python3 "$HERE/a07_marker.py" write \
  --fixture "$FIXTURE" --oracle "$ORACLE" \
  --status "$STATUS" --classification "$CLASS" --page-count "$PAGES" \
  --tolerance "$TOLERANCE" --command "$COMMAND" --platform "$PLATFORM" \
  --out-root "$OUT_ROOT" --repo-commit "$REPO_COMMIT" --repo-tree "$REPO_TREE" \
  --harness-commit "$HARNESS_COMMIT" --produced-at "$PRODUCED_AT"
