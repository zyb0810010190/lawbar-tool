#!/bin/bash
# verify-macos-signing.sh — credential-free verification of a built macOS .app's
# signature + notarization/stapling status (WI-DESKTOP-MACOS-SIGNING-NOTARIZATION-07).
# Reads nothing secret; just runs codesign / spctl / stapler on the given bundle.
#
# Usage: bash scripts/verify-macos-signing.sh [--report] [path-to.app]
#   default path: release/mac-arm64/lawbar.app (resolved against the CWD)
#
# EXIT CONTRACT — this is the reason the script exists. `verify:signing && ship`
# must be safe by construction, so the DEFAULT is a gate and only release-readiness
# exits 0. Opting out of the gate requires typing --report.
#   0  release-ready: Developer ID authority, deep-strict verify OK, Gatekeeper
#      accepted, notarization ticket stapled.
#   1  usage / bundle-path / tooling error — nothing was assessed.
#   2  assessed and signed, but NOT release-ready (not notarized, not stapled,
#      Gatekeeper rejected, or no Developer ID authority).
#   3  assessed, and the bundle is unsigned or adhoc-signed — the `npm run dist` default.
# --report suppresses verdicts 2 and 3 (exit 0 instead) for the everyday "what is
# this dev build?" question. A usage/path error still exits 1. See
# `npm run verify:signing` (gate) and `npm run verify:signing:report` (diagnostic).
set -u

REPORT=0
APP=""
for arg in "$@"; do
  case "$arg" in
    --report) REPORT=1 ;;
    -*)
      echo "verify: unknown option: $arg"
      echo "usage: verify-macos-signing.sh [--report] [path-to.app]"
      exit 1
      ;;
    *) APP="$arg" ;;
  esac
done
[ -n "$APP" ] || APP="release/mac-arm64/lawbar.app"

# Bundle guard. `-d` alone accepts any directory, including an empty one, and then
# reports on nothing. Require the two structural members that make a directory an
# app bundle. The `.app` suffix is deliberately NOT required: the name is a
# convention, the structure is the thing, and rejecting a validly-structured bundle
# for its name adds a failure mode without adding safety.
guard_fail() { echo "verify: $1"; exit 1; }
[ -d "$APP" ] || guard_fail "bundle not found: $APP  (run 'npm run dist' or 'npm run dist:release' first)"
[ -f "$APP/Contents/Info.plist" ] || guard_fail "not an app bundle (no Contents/Info.plist): $APP"
[ -d "$APP/Contents/MacOS" ] || guard_fail "not an app bundle (no Contents/MacOS): $APP"

# Every tool below is run with its status captured BEFORE any pipe. Piping straight
# into `sed` discards the tool's exit status and hands back sed's instead, which is
# always 0 — so a failing codesign, a rejecting spctl and a missing ticket all used
# to look identical to success. The verdict is computed from statuses; the text is
# for humans.
indent() { [ -n "$1" ] && printf '%s\n' "$1" | sed 's/^/  /'; return 0; }

# A missing tool is a tooling error (exit 1, "nothing was assessed"), NOT evidence about
# the bundle. Without this, an absent `codesign` produced exit 3 — telling a machine with
# no Command Line Tools that its release build was an adhoc dev build — and the shell's
# own "command not found" was indented into the report as though it were tool output.
require_tool() {
  [ "$2" -ne 127 ] || guard_fail "$1 unavailable (exit 127) — nothing was assessed. Install the Xcode Command Line Tools."
}

echo "== bundle: $APP =="
echo
echo "-- codesign -dv (signature identity) --"
dv_out="$(codesign -dv --verbose=2 "$APP" 2>&1)"; dv_rc=$?
require_tool codesign "$dv_rc"
indent "$dv_out"

adhoc=0
devid=0
printf '%s\n' "$dv_out" | grep -q '^Signature=adhoc' && adhoc=1
printf '%s\n' "$dv_out" | grep -q '^Authority=Developer ID Application:' && devid=1
# The authority check is a verdict input exactly like the three tools below, so it needs
# its own reported line. Without one, a bundle failing ONLY on authority printed three
# successes and then pointed at a failing section that did not exist.
if [ "$devid" -eq 1 ]; then
  echo "  authority: Developer ID Application"
elif [ "$adhoc" -eq 1 ]; then
  echo "  authority: none (adhoc signature)"
else
  echo "  authority: NOT Developer ID (a release build requires a Developer ID Application certificate)"
fi

echo
echo "-- codesign --verify --deep --strict (integrity) --"
cs_out="$(codesign --verify --deep --strict --verbose=2 "$APP" 2>&1)"; cs_rc=$?
indent "$cs_out"
if [ "$cs_rc" -eq 0 ]; then
  echo "  codesign verify: OK"
else
  echo "  codesign verify: FAILED (adhoc/unsigned builds fail deep-strict verify)"
fi

echo
echo "-- spctl -a -vv -t exec (Gatekeeper assessment) --"
sp_out="$(spctl -a -vv -t exec "$APP" 2>&1)"; sp_rc=$?
require_tool spctl "$sp_rc"
indent "$sp_out"
if [ "$sp_rc" -eq 0 ]; then
  echo "  spctl: accepted"
else
  echo "  spctl: rejected"
fi

echo
echo "-- stapler validate (notarization ticket stapled?) --"
# Probe the tool that is actually invoked. The old condition accepted a standalone
# `stapler` on PATH and then ran `xcrun stapler` regardless — reporting on a tool it
# never consulted. `xcrun -f` resolves the tool without executing it.
if xcrun -f stapler >/dev/null 2>&1; then
  st_out="$(xcrun stapler validate "$APP" 2>&1)"; st_rc=$?
  indent "$st_out"
  if [ "$st_rc" -eq 0 ]; then
    echo "  stapler: ticket stapled"
  else
    echo "  stapler: no ticket stapled (expected for unsigned / un-notarized builds)"
  fi
else
  st_rc=127
  echo "  stapler: xcrun stapler unavailable"
fi

echo
if [ "$dv_rc" -ne 0 ] || [ "$adhoc" -eq 1 ]; then
  verdict=3
  echo "VERDICT: UNSIGNED / adhoc dev build (exit 3) — this is what 'npm run dist' produces."
elif [ "$devid" -eq 1 ] && [ "$cs_rc" -eq 0 ] && [ "$sp_rc" -eq 0 ] && [ "$st_rc" -eq 0 ]; then
  verdict=0
  echo "VERDICT: release-ready (exit 0) — Developer ID signed, Gatekeeper accepted, ticket stapled."
else
  verdict=2
  echo "VERDICT: signed but NOT release-ready (exit 2) — see the failing check(s) above."
fi

if [ "$REPORT" -eq 1 ]; then
  echo "(--report: exiting 0 regardless of the verdict above)"
  exit 0
fi
exit "$verdict"
