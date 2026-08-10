#!/bin/bash
# a07-marker-write.sh — A0.7 marker writer entrypoint (WI-ENA11; WI-A07-MARKER-BIND).
#
# Runs the REAL A0.7 harness (via the a07-harness-cli Swift binary) and hands its EXACT stdout bytes,
# its exit code, and the binary itself to scripts/workflow/a07_marker.py, which DERIVES the verdict
# and writes a provenance-bound LOCAL marker (+ guard ledger entry) only when the harness's own output
# says status=pass + classification=ok. This script no longer parses or asserts the verdict: it never
# passes --status/--classification, so a caller cannot assert a gate result it did not run
# (WI-A07-MARKER-BIND, audit finding S5).
#
# Markers are local-only run-state under dev-memo/run/evidence/** (gitignored; never committed). The
# HMAC key is ENV-supplied (LAWBAR_A07_MARKER_HMAC_KEY, >= 32 chars); a missing/weak key, an
# unusable toolchain, or a non-pass harness result fails closed with NO marker written.
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
# Fail closed BEFORE building/running anything if a required tool is missing, and specifically if the
# hashing/JSON toolchain (python3 + hashlib/hmac/json/base64) is unusable: without it no provenance
# can be computed, and a marker must never be produced on a degraded toolchain.
for tool in git swift python3; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "a07-marker-write: required tool '$tool' unavailable; fail-closed." >&2; exit 6; }
done
python3 -c 'import base64, hashlib, hmac, json' >/dev/null 2>&1 || {
  echo "a07-marker-write: python3 hashing/JSON toolchain (hashlib/hmac/json/base64) unusable; fail-closed." >&2
  exit 6; }
for p in "$FIXTURE" "$ORACLE"; do
  [ -f "$p" ] || { echo "a07-marker-write: input not found: $p" >&2; exit 5; }
done

# Build + run the real harness CLI.
swift build --package-path "$PKG" >/dev/null 2>&1 || { echo "a07-marker-write: swift build failed" >&2; exit 6; }
CLI="$PKG/.build/debug/a07-harness-cli"
[ -x "$CLI" ] || { echo "a07-marker-write: harness CLI not built at $CLI" >&2; exit 6; }

TMP="$(mktemp -d)" || { echo "a07-marker-write: cannot create a temp dir; fail-closed." >&2; exit 6; }
trap 'rm -rf "$TMP"' EXIT
HARNESS_STDOUT="$TMP/harness-stdout.bin"
HARNESS_STDERR="$TMP/harness-stderr.txt"
# Redirect stdout to a FILE — never capture it with $(...): command substitution strips trailing
# newlines, so the bytes the marker binds would not be the bytes the harness actually printed.
"$CLI" "$FIXTURE" "$ORACLE" >"$HARNESS_STDOUT" 2>"$HARNESS_STDERR"
HARNESS_RC=$?

# Repo/tree/harness bindings + command/platform context. The verdict, page count, and tolerance are
# NOT computed here: a07_marker.py derives them from the harness stdout and the oracle.
REPO_COMMIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
REPO_TREE="$(git -C "$ROOT" rev-parse HEAD^{tree} 2>/dev/null || echo unknown)"
HARNESS_COMMIT="$REPO_COMMIT"
PLATFORM="$(uname -srm) | $(swift --version 2>/dev/null | head -n1) | offline-local"
PRODUCED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMAND="a07-harness-cli $(basename "$FIXTURE") $(basename "$ORACLE")"

python3 "$HERE/a07_marker.py" write \
  --fixture "$FIXTURE" --oracle "$ORACLE" \
  --harness-bin "$CLI" --harness-stdout "$HARNESS_STDOUT" --harness-exit "$HARNESS_RC" \
  --command "$COMMAND" --platform "$PLATFORM" \
  --out-root "$OUT_ROOT" --repo-commit "$REPO_COMMIT" --repo-tree "$REPO_TREE" \
  --harness-commit "$HARNESS_COMMIT" --produced-at "$PRODUCED_AT"
WRITE_RC=$?

if [ "$WRITE_RC" -ne 0 ]; then
  # Surface the harness's own diagnosis (stderr detail line) so a refusal is explainable. The detail
  # carries counts/geometry only — never a path, page content, or metadata.
  [ -s "$HARNESS_STDERR" ] && sed 's/^/a07-marker-write: harness /' "$HARNESS_STDERR" >&2
  echo "a07-marker-write: no marker written (harness exit=$HARNESS_RC, marker writer exit=$WRITE_RC)." >&2
fi
exit "$WRITE_RC"
