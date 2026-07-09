# macOS Developer-ID signing + notarization — lane (READY, not executed)

**WI**: `WI-DESKTOP-MACOS-SIGNING-NOTARIZATION-07`. **Status**: config + docs prepared; **NOT signed / NOT
notarized** — no Developer-ID certificate or notary credentials are present on this machine (verified below).
No secrets are committed. This doc + the env-gated config make the lane runnable the moment credentials are supplied.

## 1. Current state (verified by command)

```
security find-identity -v -p codesigning     # → 0 valid identities found
codesign -dv --verbose=2 release/mac-arm64/lawbar.app
#   → CodeDirectory flags=0x20002(adhoc,linker-signed); Signature=adhoc; TeamIdentifier=not set
spctl -a -vv -t exec release/mac-arm64/lawbar.app   # → rejected (Gatekeeper cannot assess)
```

⇒ the default build is **adhoc-signed only** (unsigned for distribution). Env vars `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_API_KEY*` are all **unset**.

Run `npm --prefix apps/lawbar-desktop run verify:signing` any time to re-check a build.

## 2. Recommended artifact target: **dmg (primary) + zip**

- Keep `target: dir` for the **dev / smoke** path (direct `.../MacOS/lawbar` launch; unchanged default build).
- The **release** config produces **`dmg`** (standard macOS drag-to-Applications install; notarizable + staple-able)
  **+ `zip`** (smaller transferable; the notarization ticket staples to the `.app` inside). Both arm64 + x64.
- Rationale: a `.dmg` is the least-friction install for a non-technical lawyer; the `.zip` is a convenient
  fallback / CI artifact. A universal (single fat) binary is deferred (larger; per-arch is fine for a small team).

## 3. What was added (no secrets, default build untouched)

| File | Purpose |
|---|---|
| `apps/lawbar-desktop/electron-builder.signed.cjs` | Release config — **extends** the package.json `build` (no drift), drops `identity:null` (→ auto-detect Developer ID), adds `hardenedRuntime`, `forceCodeSigning: true` (release build FAILS if no valid identity), entitlements, `dmg`+`zip` targets, **env-gated** `notarize`. Not the default-named config, so plain `electron-builder` ignores it. |
| `apps/lawbar-desktop/build/entitlements.release.mac.plist` | Hardened-runtime entitlements (allow-jit, allow-unsigned-executable-memory, disable-library-validation) — required for Electron V8 + the `better-sqlite3` native module. **Not** App Sandbox; **no** network entitlement. Named `entitlements.release.*` (not the magic auto-discovered `entitlements.mac.plist`) so it can NEVER couple to the default unsigned build. |
| `apps/lawbar-desktop/scripts/release-preflight.sh` | **Fail-closed** credential check run by `dist:release` — aborts (exit 1) unless a Developer ID identity + a complete notarization credential set are present. Reads no secret values. |
| `apps/lawbar-desktop/scripts/verify-macos-signing.sh` | Credential-free `codesign`/`spctl`/`stapler` verifier. |
| `package.json` scripts | `dist:release` (preflight → build → sign/notarize), `postdist:release`, `verify:signing`. |

> **Fail-closed release** (cc-suite audit `audit-mrd7idvu-18bq91`, Medium — resolved): `dist:release` runs
> `release-preflight.sh` first (aborts on missing creds) AND the config sets `forceCodeSigning: true`, so a
> command named "release" can never silently emit an unsigned / un-notarized artifact. The hardened-runtime
> entitlements are the standard Electron-with-native-module compatibility set (audit Low, accepted); they
> may be narrowed once a real signed build proves which are removable.

## 4. Required credentials / env vars (NOT committed; supplied at build time)

**A. Developer ID Application certificate** (Apple Developer Program membership required):
- Either import the `Developer ID Application: <Name> (<TEAMID>)` cert into the **login keychain**
  (electron-builder auto-detects it), OR provide it as a file:
  - `CSC_LINK` = path to (or base64 of) the `.p12` export of the cert+key.
  - `CSC_KEY_PASSWORD` = the `.p12` export password.

**B. Notarization credentials** — one of:
- **Apple-ID method**: `APPLE_ID` (Apple account email), `APPLE_APP_SPECIFIC_PASSWORD`
  (an app-specific password from appleid.apple.com), `APPLE_TEAM_ID` (10-char Team ID).
- **App Store Connect API key** (preferred for CI): `APPLE_API_KEY` (path to the `AuthKey_XXXX.p8`),
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` — plus `APPLE_TEAM_ID`.

`APPLE_TEAM_ID` is what gates notarization in `electron-builder.signed.cjs` (`notarize: { teamId }`).

> ⚠️ Never commit the `.p12`, `.p8`, passwords, Team ID, Apple ID, or generated `release/**`. In CI, inject
> these as masked secrets; locally, export them in the shell only.

## 5. Command sequences

**Unsigned dev build (current default — no creds needed):**
```
npm --prefix apps/lawbar-desktop run dist
LAWBAR_MODE=dev apps/lawbar-desktop/release/mac-arm64/lawbar.app/Contents/MacOS/lawbar
```

**Signed + notarized release build (requires §4 credentials in the env):**
```
# export CSC_LINK=… CSC_KEY_PASSWORD=…  (or cert in login keychain)
# export APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=…   (or APPLE_API_KEY* + APPLE_TEAM_ID)
npm --prefix apps/lawbar-desktop run dist:release
# → release-preflight.sh checks creds (fail-closed), then signs with Developer ID + hardened
#   runtime (forceCodeSigning), submits to Apple notary, staples the ticket,
#   emits release/lawbar-<ver>-<arch>.dmg and .zip
```

**Verification after signing/notarization:**
```
npm --prefix apps/lawbar-desktop run verify:signing -- release/mac-arm64/lawbar.app
# expect:  Authority=Developer ID Application: <Name> (<TEAMID>)
#          codesign verify: OK
#          spctl … : accepted   (source=Notarized Developer ID)
#          stapler … : The validate action worked!
# also verify the .dmg is stapled:
xcrun stapler validate release/lawbar-<ver>-arm64.dmg
```

## 6. STOP-AND-ASK — what is needed to actually sign + notarize

The lane is ready but **cannot be executed here**: there is no Developer-ID certificate in the keychain and
no notary credentials in the environment. To complete real signing + notarization, provide:

1. An **Apple Developer Program** membership (gives the **Team ID** + the ability to create certs).
2. A **Developer ID Application** certificate (`.p12` export + password, or installed in the login keychain).
3. **Notarization credentials** — either an app-specific password (`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`)
   or an App Store Connect **API key** (`.p8` + key id + issuer).
4. The **Team ID** (`APPLE_TEAM_ID`).

Until these are supplied, `npm run dist:release` **aborts at the fail-closed preflight** (exit 1) and
`forceCodeSigning: true` would fail the build anyway — it will **never** silently "succeed" as signed or emit
an unsigned/adhoc artifact from the release command. The only unsigned build is the dev `npm run dist`; do not
distribute that adhoc build to off-machine users without accepting the Gatekeeper friction documented in the
RC1 handoff.

## References
- `dev-memo/desktop-rc1-artifact-handoff.md` — RC1 artifacts + Gatekeeper open steps.
- `dev-memo/release-checklist.md` — the release checklist.
- electron-builder code signing / notarization docs (v25).
