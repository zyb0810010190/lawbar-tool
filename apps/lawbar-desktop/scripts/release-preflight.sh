#!/bin/bash
# release-preflight.sh — fail-closed credential check for `npm run dist:release`
# (WI-DESKTOP-MACOS-SIGNING-NOTARIZATION-07). Reads NO secret values; only checks
# for the PRESENCE of a Developer ID identity + a complete notarization credential
# set, so a release build can never silently produce an unsigned / un-notarized
# artifact. Exits non-zero (with guidance) when anything is missing.
set -u
fail=0
note() { echo "  - $1"; }

# present VALUE — true only when VALUE holds at least one non-whitespace character.
# A whitespace-only value is a misconfiguration, not a credential; `[ -n " " ]` is
# true and would let one through. Same posture as the audited-reason guards.
present() { [ -n "${1//[[:space:]]/}" ]; }

# has_developer_id — true only when `security find-identity -v` lists a clean
# Developer ID Application row. The regex is anchored at BOTH ends, and that is
# load-bearing at each end:
#   ^  a bare substring match also fires on the "0 valid identities found" trailer,
#      and a count-based check fires on an Apple Development identity that cannot
#      sign a release at all;
#   $  a row for an unusable certificate carries a trailing parenthetical after the
#      closing quote, e.g. `… "Developer ID Application: Org (TEAM)" (CSSMERR_TP_CERT_EXPIRED)`.
#      Requiring the line to end at the quote rejects that row, and rejects any
#      future error marker printed in the same position — a blacklist of known
#      CSSMERR codes would not.
has_developer_id() {
  security find-identity -v -p codesigning 2>/dev/null |
    grep -Eq '^[[:space:]]*[0-9]+\)[[:space:]]+[0-9A-Fa-f]+[[:space:]]+"Developer ID Application:[^"]*"[[:space:]]*$'
}

echo "== release preflight: signing + notarization credentials =="

# 1) Signing source. CSC_LINK WINS when set — it is not merely an alternative.
#    app-builder-lib's macPackager builds a TEMPORARY keychain from CSC_LINK and
#    never consults the login keychain; only when CSC_LINK is unset does it fall
#    back to the default keychain. So a keychain identity must not excuse a missing
#    CSC_KEY_PASSWORD: that combination signs from CSC_LINK and fails at build time,
#    after this gate has already said OK.
if present "${CSC_LINK:-}"; then
  echo "[ok] CSC_LINK is set (electron-builder will sign from this certificate, not the keychain)."
  present "${CSC_KEY_PASSWORD:-}" || { echo "[MISSING] CSC_KEY_PASSWORD (password for the CSC_LINK cert)."; fail=1; }
elif has_developer_id; then
  echo "[ok] Developer ID Application identity found in the keychain."
else
  echo "[MISSING] no Developer ID Application identity in the keychain and CSC_LINK is unset."
  note "import the cert into the login keychain, OR set CSC_LINK + CSC_KEY_PASSWORD."
  fail=1
fi

# 2) Notarization credentials: APPLE_TEAM_ID + one complete method.
present "${APPLE_TEAM_ID:-}" || { echo "[MISSING] APPLE_TEAM_ID."; fail=1; }
if present "${APPLE_ID:-}" && present "${APPLE_APP_SPECIFIC_PASSWORD:-}"; then
  echo "[ok] notary method: Apple-ID (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD)."
elif present "${APPLE_API_KEY:-}" && present "${APPLE_API_KEY_ID:-}" && present "${APPLE_API_ISSUER:-}"; then
  echo "[ok] notary method: App Store Connect API key (APPLE_API_KEY + KEY_ID + ISSUER)."
else
  echo "[MISSING] notarization credentials: set APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD, OR APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER."
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "release preflight FAILED — signing/notarization credentials are incomplete."
  echo "See docs/product/product-plan.md -> 'macOS Developer-ID signing + notarization' section 6."
  echo "Aborting the release build (the unsigned dev build is 'npm run dist')."
  exit 1
fi
echo "release preflight OK — proceeding with the signed + notarized build."
