# lawbar-desktop

First UI shell — Electron-based Mac client for the lawbar product.

**Status**: Token-compliance fixture only. NOT product UI. NOT signed. NOT notarized. NOT for distribution beyond the developer's own machine.

## What this is

A minimal Electron application that proves:
1. The Electron substrate ratified at commit `35cd9b6` works on macOS.
2. The night-mode theme foundation (`dev-memo/plan-night-mode-foundation-00.md`) renders 12 semantic tokens in both Light and Dark palettes.
3. System / Light / Dark mode switching responds to user input AND to live macOS appearance changes.
4. Theme preference persists across app launches via `app.getPath("userData")` with `productName: "lawbar"` (path: `~/Library/Application Support/lawbar/theme-preference.json`).

## What this is NOT

- A product feature.
- A case-box-persistence integration (no SQLite, no `better-sqlite3`, no OCR engine, no native modules of any kind).
- A signed or notarized `.app`.
- Suitable for distribution.

See `dev-memo/plan-first-ui-shell-00.md` (commit `f74b2b2` on `origin/main`) for the authoring plan.

## Dev workflow

**Clean-checkout setup** (post tarball-PoC; required because `package.json` declares two internal-package tarball deps that don't exist until built):

```sh
# 1. From repo root: build + stage-pack the two internal-package tarballs.
#    Must run BEFORE `npm install` in apps/lawbar-desktop because
#    package.json points at the produced .tgz files.
node scripts/build-internal-packages.mjs

# 2. Then install the desktop app.
cd apps/lawbar-desktop
npm install
```

**Day-to-day**:

```sh
npm test                # main-process unit tests + Playwright Electron smoke
npm run test:pack-helper  # staging-pack helper tests (5 tests)
npm run test:pkg-arch-poc # packaged-binary tarball-PoC smoke (4 tests)
npm run dev             # build + launch Electron
npm run dist            # build a dev-only .app under dist/ (UNSIGNED)
```

After editing `services/case-box-persistence/` or `docs/contracts/case-box-contract/`:

```sh
# Re-stage-pack from repo root, then reinstall.
node scripts/build-internal-packages.mjs
cd apps/lawbar-desktop && npm install
```

Requires Node 22.x or 24.x (per `engines.node`). Electron downloads a Chromium binary on first `npm install` (~120MB).
