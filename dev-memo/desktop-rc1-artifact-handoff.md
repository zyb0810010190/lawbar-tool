# Lawbar desktop — RC1 artifact handoff

**WI**: `WI-DESKTOP-RC1-ARTIFACT-HANDOFF-06`. **`main` @** `16a8f85`. **App version** 0.1.0 (`io.lawbar.desktop`, productName `lawbar`).
**Status**: internal release candidate. **Docs only — no product change.** ⚠️ **Unsigned / not notarized** (see §Signing).

Repeatable handoff for the macOS desktop build: what to build, what it produces, how to verify it, and how to open + confirm it. The `.app` bundles are **not** committed (`release/` is gitignored — 300 MB+ each); this doc + `dev-memo/release/rc1-checksums.txt` are the committed handoff; the artifacts are produced locally by `npm run dist`.

## 1. Verification sequence (run from clean `main`)

```
cd <repo root>
git status --short                                   # only .mcp.json + pre-existing untracked clutter
npm --prefix apps/lawbar-desktop test                # unit/renderer/electron-in-list suite
npm --prefix apps/lawbar-desktop run test:smoke-matrix# packaged M1-M9 smoke (launches the built .app)
npm --prefix apps/lawbar-desktop run dist            # electron-builder → release/
```

**Recorded results (this RC):** unit **819 pass / 0 fail**; smoke matrix **1 pass** (M1–M9, ~2.5 s); `dist` **success** (arm64 + x64; `postdist` restored the arm64 host binding). user-facing English = **0** (i18n guard). No product behavior changed.

> `test:smoke-matrix` runs against whatever is currently in `release/`; run `dist` first (or after any source change) so the smoke exercises the current build.

## 2. Built artifacts (`apps/lawbar-desktop/release/`)

`electron-builder` is configured `target: dir`, `arch: [arm64, x64]` → it emits **`.app` bundles in per-arch directories** (no `.dmg` / `.zip`). Contents of `release/`:

| Path | Arch | Bundle size | Open on |
|---|---|---|---|
| `release/mac-arm64/lawbar.app` | arm64 (Mach-O arm64) | 318 MB | **Apple Silicon** Macs (M1/M2/M3/M4) |
| `release/mac/lawbar.app` | x86_64 (Mach-O x86_64) | 328 MB | **Intel** Macs |
| `release/builder-effective-config.yaml` | — | — | build config (appId, target, `identity: null`) |
| `release/builder-debug.yml` | — | — | build debug log |

## 3. Checksums (SHA256)

The `.app` is a **directory bundle**, so the manifest checksums its single-file, content-bearing parts (`Contents/Resources/app.asar` — the bundled renderer+main code; and the arch-specific electron launcher stub). Full manifest: **`dev-memo/release/rc1-checksums.txt`**.

| Arch | `app.asar` SHA256 | bytes |
|---|---|---|
| arm64 | `ee07d7c0c8aa47b105813ee4d4dd0fdd5ad95d5013c18eb787c9524853c5ed89` | 40 387 041 |
| x86_64 | `322f0c82a9ee03b24dbea9f0b4e150a454782c24499c8a794dfc624e76b9e00d` | 40 387 041 |

> ⚠️ **Not a reproducible-build hash.** A fresh `npm run dist` yields different hashes (adhoc signature + asar/bundle timestamps). These verify **this specific RC build's transfer integrity** (recipient re-hashes the file they received). For a transferable, checksummed archive:
> ```
> ditto -c -k --keepParent apps/lawbar-desktop/release/mac-arm64/lawbar.app /tmp/lawbar-arm64.app.zip
> shasum -a 256 /tmp/lawbar-arm64.app.zip
> ```

## 4. Which artifact to open

- **Apple Silicon (most Macs since 2020):** `release/mac-arm64/lawbar.app`.
- **Intel:** `release/mac/lawbar.app`.
- Unsure? `uname -m` → `arm64` = Apple Silicon, `x86_64` = Intel.

## 5. Signing / notarization status — ⚠️ UNSIGNED

`identity: null` in the build config → **adhoc / linker-signed only**, **NOT** Developer-ID signed and **NOT** notarized:

```
codesign -dv --verbose=2 release/mac-arm64/lawbar.app   # → Signature=adhoc, flags=…(adhoc,linker-signed)
spctl -a -vv -t exec  release/mac-arm64/lawbar.app      # → REJECTED (Gatekeeper cannot assess)
```

**Consequence:** Gatekeeper will block the app on any Mac other than the build machine, and even locally if the bundle carries the `com.apple.quarantine` attribute (e.g. after AirDrop/download). This is expected for an internal RC. Signing + notarization is a **separate, deliberately-out-of-scope** future WI (needs a Developer-ID identity + Apple notary credentials — a Stop-and-Ask hard-stop, not solved here).

## 6. macOS opening instructions (unsigned app)

Copy the `.app` for your arch to `/Applications` (or anywhere), then:

- **From Finder:** right-click (or Control-click) `lawbar.app` → **Open** → **Open** in the dialog. (Double-clicking an unsigned/quarantined app just shows "cannot be opened".)
- **If macOS still blocks** ("lawbar can't be opened because Apple cannot check it for malicious software"): System Settings → **Privacy & Security** → scroll to the blocked-app notice → **Open Anyway**.
- **If it was downloaded/AirDropped** and Gatekeeper hard-blocks, strip the quarantine flag:
  ```
  xattr -dr com.apple.quarantine /path/to/lawbar.app
  ```
  (Only run this on a build you trust — i.e. one you built or whose checksum matches §3.)

## 7. Where local app data is stored

`app.getPath("userData")` for productName `lawbar` →

```
~/Library/Application Support/lawbar/
    case-box.sqlite           # the local case-box database
    case-box-documents/       # app-managed document storage
```

**Local-first / offline:** the lawyer's data never leaves the Mac unless the user takes a deliberate action. The smoke's post-run scan asserts no DB file is created outside the chosen data dir.

## 8. Run the built `.app` in dev mode (FileVault bypass)

Production launch **requires FileVault ON** (Tier-1 enforcement blocks otherwise). To run the built bundle on a dev machine without FileVault, use dev mode:

```
LAWBAR_MODE=dev apps/lawbar-desktop/release/mac-arm64/lawbar.app/Contents/MacOS/lawbar
```

(Runs the executable directly with the dev env var; logs go to the terminal. A normal Finder open uses production mode and enforces FileVault.)

## 9. Confirm the UI is Chinese after launch

On launch the app should show:
- Sidebar: **案件** / **新建案件** / **设置**.
- Matter list title: **案件台账**; empty state mentions **仅保存在本机**.
- New matter form: **名称 / 案件类型 / 管辖 / 当事人** (role & party-kind are dropdowns: 委托人 / 个人 …) / **保密级别**.
- Settings (设置): **版本 0.1.0**, **数据位置**, **本地优先 / 离线优先**, **FileVault**, **隐私: 不收集遥测数据**.

This is asserted automatically by the packaged smoke matrix (M1/M2/M3/M5/M8/M9): `npm --prefix apps/lawbar-desktop run test:smoke-matrix`.

## Release blockers / caveats

1. **Unsigned / not notarized** (§5) — cannot be distributed outside the build machine without Gatekeeper friction; signing+notarization is a separate WI.
2. **Production launch requires FileVault ON** — deliberate Tier-1 encryption-at-rest enforcement; dev machines use `LAWBAR_MODE=dev`.
3. **`target: dir` (no `.dmg`)** — the handoff is the `.app` directory; wrap with `ditto` (§3) to transfer. A `.dmg`/`.zip` distributable target is a separate packaging decision.
4. **Checksums are per-build, not reproducible** (§3).
5. **App version is 0.1.0** — placeholder RC version; a real release-version bump is a separate decision.
