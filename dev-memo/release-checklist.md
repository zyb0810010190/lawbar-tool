# Lawbar desktop — release checklist

A repeatable pre-release checklist for the macOS desktop app. Tick top-to-bottom. Companion docs:
`dev-memo/desktop-rc1-artifact-handoff.md` (artifacts + open steps), `dev-memo/desktop-macos-signing-notarization.md`
(signing/notarization lane), `dev-memo/desktop-release-smoke-matrix.md` (smoke matrix).

## 0. Preconditions
- [ ] On a clean `main` (or the release branch): `git status --short` shows no unexpected changes.
- [ ] Node 22+/24.x (contract + `ocr-persistence` require it; `better-sqlite3` ABI smoke passes).
- [ ] Decide the version (`apps/lawbar-desktop/package.json` `version`) — currently `0.1.0` (placeholder).

## 1. Quality gates
- [ ] `npm --prefix apps/lawbar-desktop test` → all pass.
- [ ] i18n guard green (user-facing English = 0) — part of the suite.
- [ ] `npm --prefix apps/lawbar-desktop run dist` → succeeds (arm64 + x64; `postdist` restores host binding).
- [ ] `npm --prefix apps/lawbar-desktop run test:smoke-matrix` → M1–M9 pass against the fresh build.

## 2. Artifacts
- [ ] `apps/lawbar-desktop/release/` contains the intended bundles for the chosen target (dev: `mac-arm64`/`mac` `.app`; release: `.dmg` + `.zip`).
- [ ] Record filenames, sizes, arch, SHA256 → refresh `dev-memo/release/rc1-checksums.txt` (or a versioned copy).
- [ ] Confirm `release/**` is NOT committed (gitignored).

## 3. Signing / notarization (release builds only)
- [ ] Credentials present (see `dev-memo/desktop-macos-signing-notarization.md` §4): Developer ID cert (keychain or `CSC_LINK`/`CSC_KEY_PASSWORD`) + notary creds (`APPLE_ID`+`APPLE_APP_SPECIFIC_PASSWORD`+`APPLE_TEAM_ID`, or `APPLE_API_KEY*`+`APPLE_TEAM_ID`).
- [ ] `npm --prefix apps/lawbar-desktop run dist:release` → signs + notarizes + staples.
- [ ] `npm --prefix apps/lawbar-desktop run verify:signing -- release/mac-arm64/lawbar.app`:
  - [ ] `Authority=Developer ID Application: <Name> (<TEAMID>)`
  - [ ] `codesign verify: OK`
  - [ ] `spctl … : accepted` (source = Notarized Developer ID)
  - [ ] `stapler … : validated`
- [ ] `xcrun stapler validate release/lawbar-<ver>-arm64.dmg` → validated (dmg ticket stapled).
- [ ] NEVER commit certs / `.p12` / `.p8` / passwords / Team ID / generated `release/**`.

> If credentials are absent, STOP: the build is adhoc-signed only (Gatekeeper friction off-machine). Do not
> claim signed/notarized. See the signing doc §6.

## 4. Manual sanity (packaged app)
- [ ] Launch (dev): `LAWBAR_MODE=dev …/release/mac-arm64/lawbar.app/Contents/MacOS/lawbar`.
- [ ] UI is Chinese: 案件台账 / 案件 / 新建案件 / 设置; New-matter dropdowns (委托人 / 个人 …).
- [ ] Create → appears in list → detail → archive works; 设置 shows 版本 / 数据位置 / FileVault / 不收集遥测数据.
- [ ] Data lives only under `~/Library/Application Support/lawbar/`; nothing written into the repo tree.
- [ ] Production launch (Finder open, no `LAWBAR_MODE=dev`) enforces FileVault ON (blocks if off).

## 5. Security / posture
- [ ] Local-first / offline: no network surface added; no telemetry / crash reporting.
- [ ] `OcrQueueError` codes unchanged; no schema/contract enum value localized or renamed.
- [ ] No secrets in the repo/diff.

## 6. Sign-off
- [ ] Commit hash + `git log --oneline -4` recorded.
- [ ] Handoff doc + checksums refreshed for this build.
- [ ] Known caveats listed (unsigned? FileVault requirement? version placeholder?).
- [ ] Go / No-go recorded. (Sub-WI completion never implies go-live; go-live is an explicit user decision.)
