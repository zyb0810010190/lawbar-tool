#!/bin/bash
# release-preflight.sh — fail-closed credential check for `npm run dist:release`
# (WI-DESKTOP-MACOS-SIGNING-NOTARIZATION-07). Reads NO secret values; only checks
# for the PRESENCE of a Developer ID identity + a complete notarization credential
# set, so a release build can never silently produce an unsigned / un-notarized
# artifact. Exits non-zero (with guidance) when anything is missing.
set -u
fail=0
note() { echo "  - $1"; }

echo "== release preflight: signing + notarization credentials =="

# 1) Developer ID Application signing identity: keychain OR CSC_LINK.
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
  echo "[ok] Developer ID Application identity found in the keychain."
elif [ -n "${CSC_LINK:-}" ]; then
  echo "[ok] CSC_LINK is set (certificate provided as a file)."
  [ -n "${CSC_KEY_PASSWORD:-}" ] || { echo "[MISSING] CSC_KEY_PASSWORD (password for the CSC_LINK cert)."; fail=1; }
else
  echo "[MISSING] no Developer ID Application identity in the keychain and CSC_LINK is unset."
  note "import the cert into the login keychain, OR set CSC_LINK + CSC_KEY_PASSWORD."
  fail=1
fi

# 2) Notarization credentials: APPLE_TEAM_ID + one complete method.
[ -n "${APPLE_TEAM_ID:-}" ] || { echo "[MISSING] APPLE_TEAM_ID."; fail=1; }
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]; then
  echo "[ok] notary method: Apple-ID (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD)."
elif [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_KEY_ID:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ]; then
  echo "[ok] notary method: App Store Connect API key (APPLE_API_KEY + KEY_ID + ISSUER)."
else
  echo "[MISSING] notarization credentials: set APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD, OR APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER."
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "release preflight FAILED — signing/notarization credentials are incomplete."
  echo "See dev-memo/desktop-macos-signing-notarization.md §4. Aborting the release build"
  echo "(the unsigned dev build is 'npm run dist')."
  exit 1
fi
echo "release preflight OK — proceeding with the signed + notarized build."
