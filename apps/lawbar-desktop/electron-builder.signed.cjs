"use strict";
/*
 * Signed + notarized macOS RELEASE config
 * (WI-DESKTOP-MACOS-SIGNING-NOTARIZATION-07).
 *
 * NOT used by the default `npm run dist` (which stays unsigned / target:dir so
 * the dev launch + packaged smoke keep working). Run via `npm run dist:release`.
 *
 * NO secrets are in this file. Signing identity + notary credentials are read
 * from the environment / login keychain at build time by electron-builder +
 * Apple `notarytool`:
 *   - Developer ID Application cert: CSC_LINK (+ CSC_KEY_PASSWORD), OR present
 *     in the login keychain (auto-detected).
 *   - Notarization: APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, OR
 *     an App Store Connect API key (APPLE_API_KEY + APPLE_API_KEY_ID +
 *     APPLE_API_ISSUER).
 * See dev-memo/desktop-macos-signing-notarization.md.
 *
 * It reuses the package.json `build` config as the base so app id / files /
 * asarUnpack never drift; it only overrides the mac signing + target surface.
 */
const base = require("./package.json").build;

// Drop the base mac `identity: null` (which hard-disables signing) so
// electron-builder auto-detects the Developer ID identity; drop the dir-only
// target in favour of distributable dmg + zip.
const { identity, target, ...macBase } = base.mac;

module.exports = {
  ...base,
  mac: {
    ...macBase,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    // Fail the RELEASE build if a valid signing identity is not found, so a
    // command named `dist:release` can never silently emit an unsigned artifact.
    forceCodeSigning: true,
    entitlements: "build/entitlements.release.mac.plist",
    entitlementsInherit: "build/entitlements.release.mac.plist",
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    // Env-gated: only notarize when a Team ID is supplied. notarytool picks up
    // APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD or APPLE_API_KEY* from the env.
    notarize: process.env.APPLE_TEAM_ID ? { teamId: process.env.APPLE_TEAM_ID } : false,
  },
};
