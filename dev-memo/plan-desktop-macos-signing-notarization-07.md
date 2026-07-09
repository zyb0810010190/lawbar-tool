# Plan — WI-DESKTOP-MACOS-SIGNING-NOTARIZATION-07

**Type**: RELEASE (config + docs). Follows `WI-DESKTOP-RC1-ARTIFACT-HANDOFF-06` (merged `1fd8151`).
**Outcome**: the signing/notarization lane is **made READY** — it was **not executed** (no Developer-ID cert
/ notary credentials present). No secrets committed. Default unsigned build untouched.

## Goal

Prepare the macOS Developer-ID signing + notarization lane without committing secrets or fabricating signing
success. Stop-and-ask for the credentials that are absent.

## What was done

1. Inspected the electron-builder config (`apps/lawbar-desktop/package.json` `build`): `identity: null`,
   `target: dir` (arm64+x64), `asarUnpack` better-sqlite3.
2. Confirmed current state by command: `security find-identity` → **0 identities**; `codesign` → adhoc;
   `spctl` → rejected; all signing/notary env vars **unset** ⇒ credentials absent.
3. Added credential-free config/scripts (no secrets; default `npm run dist` unchanged):
   - `electron-builder.signed.cjs` — extends the package.json `build`, drops `identity:null` (→ auto-detect),
     adds `hardenedRuntime`, `forceCodeSigning:true`, `entitlements`, `dmg`+`zip` targets, env-gated `notarize`.
     Non-default name → the plain `electron-builder` ignores it.
   - `build/entitlements.release.mac.plist` — hardened-runtime entitlements (allow-jit / allow-unsigned-
     executable-memory / disable-library-validation); not App Sandbox, no network entitlement. Non-magic
     filename so it can never couple to the default unsigned build.
   - `scripts/release-preflight.sh` — **fail-closed** credential check run by `dist:release`.
   - `scripts/verify-macos-signing.sh` — credential-free `codesign`/`spctl`/`stapler` verifier.
   - `package.json` scripts: `dist:release`, `postdist:release`, `verify:signing`.
4. Documented the lane: `dev-memo/desktop-macos-signing-notarization.md` (state, target, required creds,
   command sequences, verification, stop-and-ask) + `dev-memo/release-checklist.md`.

## Recommended target

`dir` for dev/smoke (unchanged); **`dmg` (primary) + `zip`** for the signed release (drag-install + smaller
transferable; both notarizable/staple-able). Per-arch (universal binary deferred).

## Required credentials / env vars (supplied at build time, never committed)

Developer ID Application cert (keychain or `CSC_LINK`+`CSC_KEY_PASSWORD`); notarization via
`APPLE_ID`+`APPLE_APP_SPECIFIC_PASSWORD`+`APPLE_TEAM_ID` OR `APPLE_API_KEY`+`APPLE_API_KEY_ID`+`APPLE_API_ISSUER`+`APPLE_TEAM_ID`.

## Verification (post-change; secret-free)

- `plutil -lint build/entitlements.release.mac.plist` → OK.
- `node -e "require('./electron-builder.signed.cjs')"` → resolves (hardenedRuntime, dmg+zip, identity dropped, notarize false).
- `npm run verify:signing` on the current build → confirms adhoc/unsigned (as expected).
- `npm test` / `test:smoke-matrix` / `dist` → green; default `dist` still `skipped … identity is set to null` (unchanged).

## cc-suite audit

Job `audit-mrd7idvu-18bq91` — **PASS** (no committed secrets; no fabricated signing; default `dist` unaffected;
release config structurally correct). Dispositions:
- **Medium (dist:release not fail-closed)** → FIXED: added `forceCodeSigning: true` to the release config +
  `scripts/release-preflight.sh` (aborts unless a Developer ID identity + complete notary creds are present).
  Verified: the preflight exits 1 on this credential-less machine.
- **Low (entitlements broad for Electron 39)** → accepted + documented as compatibility entitlements; narrow
  once a real signed build proves which are removable.
- **Low (magic entitlements filename could couple to the default build)** → FIXED: renamed to
  `build/entitlements.release.mac.plist` (not the auto-discovered `entitlements.mac.plist`).

## Governance

Low-risk config/doc; **did not** implement signing, choose credentials, or touch secrets — matches the
`.claude/rules/autonomy.md` hard-stop posture (auth/credential material is Stop-and-Ask). No product/schema/
i18n/UI change; user-facing English still 0. Self-review recorded (the verification commands ARE the evidence).

## Guard conditions (satisfied)

`.mcp.json` untouched · clutter untouched · no `release/**` / certs / `.p12` / `.p8` / passwords committed ·
i18n guard + smoke unchanged · not broadened into auto-update/backend/schema/UI/cloud · no fabricated signing
(`codesign` output shows adhoc; the doc states NOT signed / NOT notarized).

## Signing/notarization completed? **NO — made READY only.** See the signing doc §6 for exactly what to supply.

## Out of scope

Actual signing/notarization execution (needs credentials — Stop-and-Ask), auto-update, `.dmg` cosmetics
(background/icon), universal binary, version bump, cloud/CI secret provisioning.
