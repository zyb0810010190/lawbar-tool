#!/bin/bash
# verify-macos-signing.sh — credential-free verification of a built macOS .app's
# signature + notarization/stapling status (WI-DESKTOP-MACOS-SIGNING-NOTARIZATION-07).
# Reads nothing secret; just runs codesign / spctl / stapler on the given bundle.
#
# Usage: bash scripts/verify-macos-signing.sh [path-to.app]
#   default: apps/lawbar-desktop/release/mac-arm64/lawbar.app (host-arch bundle)
set -u
APP="${1:-release/mac-arm64/lawbar.app}"
if [ ! -d "$APP" ]; then
  echo "verify: bundle not found: $APP  (run 'npm run dist' or 'npm run dist:release' first)"
  exit 1
fi
echo "== bundle: $APP =="
echo
echo "-- codesign -dv (signature identity) --"
codesign -dv --verbose=2 "$APP" 2>&1 | sed 's/^/  /'
echo
echo "-- codesign --verify --deep --strict (integrity) --"
cs_out="$(codesign --verify --deep --strict --verbose=2 "$APP" 2>&1)"; cs_rc=$?
[ -n "$cs_out" ] && echo "$cs_out" | sed 's/^/  /'
if [ "$cs_rc" -eq 0 ]; then
  echo "  codesign verify: OK"
else
  echo "  codesign verify: FAILED (adhoc/unsigned builds fail deep-strict verify)"
fi
echo
echo "-- spctl -a -vv -t exec (Gatekeeper assessment) --"
spctl -a -vv -t exec "$APP" 2>&1 | sed 's/^/  /'
echo
echo "-- stapler validate (notarization ticket stapled?) --"
if command -v stapler >/dev/null 2>&1 || xcrun stapler --help >/dev/null 2>&1; then
  xcrun stapler validate "$APP" 2>&1 | sed 's/^/  /' || echo "  stapler: no ticket stapled (expected for unsigned / un-notarized builds)"
else
  echo "  stapler: xcrun stapler unavailable"
fi
echo
echo "Interpretation:"
echo "  - 'Signature=adhoc' + spctl 'rejected'  => UNSIGNED dev build (current default)."
echo "  - 'Authority=Developer ID Application: …' + spctl 'accepted' + stapler 'validated' => release-ready."
