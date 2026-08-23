# Electron Runtime-Advisory Remediation — R-G19-1 (WI-RELEASE-ELECTRON-RUNTIME-ADVISORY-BUMP-00)

> **Provenance note (2026-08-22).** The governance queue, review tree and autonomy rules
> cited below were removed together with the agent-governance layer in commits `49dd7ad`
> and `e67b047`. Those citations — queue and review paths, sha256 digests, PR numbers —
> are retained deliberately as the audit trail of what authorized this work. They record
> provenance; they are not paths you can follow today. Current authority for hard stops
> is `docs/product/product-definition.md` §20.


**Status:** **FULL-REMEDIATION PASS.** The v1 Mac client's Electron runtime is bumped **34.5.8 → 39.8.5** (the minimal published version above the advisory's vulnerable range), which **clears the R-G19-1 HIGH advisories**; the desktop test suite is green (**801/0**), `npm run dist` **packaging is green** on both mac arches, and the `better-sqlite3` native binding is rebuilt + validated for the new Electron ABI. **Gate 19 stays `OPEN`** (a remediation is not a go-live sign-off); this is **NOT** a clearance of gates 4/6/12/13/17/20 and **NOT** a signing/notarization/distribution (gate 4) or license (gate 17) or GO/NO-GO (gate 21) decision. **Date:** 2026-07-08. **Environment:** Node `v24.14.0`, npm `11.9.0`, electron-builder `25.1.8`, macOS (arm64 host). **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `812e4590…`, amended rev 1, PR #221 merge `6af416d`), review `dev-memo/run/reviews/queue-review-167.md`.

---

## 1. Before state (from gate 19, re-verified this lane)
- Declared `electron: ^34.0.0` (`apps/lawbar-desktop/package.json` devDeps), resolved **34.5.8**.
- `npm audit` (dev-inclusive) reported **13 advisories (1 moderate, 12 high)**; the `electron` package entry carried the R-G19-1 HIGH advisories (ASAR integrity bypass; macOS AppleScript injection; use-after-free in permission/PowerMonitor/offscreen callbacks; renderer command-line-switch injection; …). `npm audit` combined vulnerable range for electron: **`<=39.8.4`**; `fixAvailable: electron@43.1.0` (semver-major).
- Ref: `docs/release/gate19-supply-chain-posture-00.md` §4 (R-G19-1) + §9.

## 2. Target-version selection (governed method — NOT hard-coded to 43.1.0)
Per the amended WI requirement #2, the exec lane tested the **lowest published version strictly above the vulnerable range first**, not npm's `fixAvailable`.
- **Candidate source:** `npm view electron versions` (npm registry) — 1045 stable versions; the lowest per major above `39.8.4`: `39.8.5`, `40.0.0`, `41.0.0`, `42.0.0`, `43.0.0`; latest `43.1.0`.
- **Lowest candidate above the vulnerable range = `39.8.5`** (a security patch in the 39.x line). npm's `fixAvailable: 43.1.0` was reporting the **latest**, not the minimal.
- **Chosen: `electron@^39.8.5`.** Rationale: `39.8.5` is the minimal published version above the `<=39.8.4` vulnerable range, and it **clears the electron advisory** (§3) — so no higher version was needed. This avoids a 34→43 nine-major jump in favour of a 34→39 jump, minimising breaking-change surface while fully clearing R-G19-1. No lower version could be chosen (39.8.4 and below are in the vulnerable range).

## 3. Bump applied + advisory re-verification
- **Command:** `npm --prefix apps/lawbar-desktop install electron@39.8.5 --save-dev` → `apps/lawbar-desktop/package.json` `electron` `^34.0.0` → `^39.8.5`; `package-lock.json` resolved `electron` `34.5.8` → `39.8.5`.
- **`npm audit --omit=dev` (production surface):** **found 0 vulnerabilities.**
- **`npm audit` (dev-inclusive):** **12 advisories (1 moderate, 11 high)** — the **`electron` entry is CLEARED** (no electron advisory remains; the R-G19-1 HIGH set is resolved). The remaining 11 high + 1 moderate are the **`electron-builder` build/packaging toolchain** (`tar`, `node-gyp`, `dmg-builder`, `cacache`, `tmp`, `form-data`, `js-yaml`, …) — build-time only, not shipped in the packaged app, advisory-only (unchanged from before minus electron; tracked as gate-19 dev-toolchain residual, a future toolchain-bump concern).

## 4. Lockfile confinement proof (governed requirement #3)
- `git diff apps/lawbar-desktop/package.json` → **only** the `electron` devDep line changed (the incidental `npm`-introduced `mac.target` JSON reformatting was reverted so the diff is electron-only).
- `apps/lawbar-desktop/package-lock.json` changed entries (enumerated + justified):
  - `node_modules/electron` — **34.5.8 → 39.8.5** (the bump itself). Electron-owned. ✓
  - `node_modules/electron/node_modules/@types/node` — **removed** (electron 39 no longer nests its own `@types/node@20.19.41`). Electron-owned transitive. ✓
  - **No non-Electron package moved** (`better-sqlite3`, `docx`, `playwright`, `typescript`, `electron-builder`, and the first-party tarballs are all unchanged). Confinement holds — no HARD-STOP triggered.

## 5. `better-sqlite3` native rebuild + ABI validation (governed requirement #7)
- An Electron major bump changes the Electron ABI. The `better-sqlite3` binding was rebuilt for electron 39.8.5 via `electron-builder install-app-deps` (`@electron/rebuild electronVersion=39.8.5 arch=arm64 buildFromSource=false`).
- **ABI-validation signal:** BEFORE the rebuild, the dev-Electron smoke tests failed with the `AGENTS.md`-documented **~30 s `firstWindow` launch timeout** (stale binding → main-process crash → no window). AFTER `install-app-deps`, the smoke tests **launch in ~1.9 s and pass 4/4** — confirming the binding is correct for electron 39. This was the governed native-rebuild step, not a bump-caused unfixable failure.
- During `run dist`, `better-sqlite3` was rebuilt for both `arm64` and `x64`; the `postdist` hook (`electron-builder install-app-deps`) restored the host `arm64` binding, and a post-dist re-smoke confirmed the host tests still pass (4/4).

## 6. Desktop test/build gate (governed requirement #6 — `run dist` is LOAD-BEARING)
- **`npm --prefix apps/lawbar-desktop test`:** **801 pass / 0 fail** (incl. the Electron smoke/main tests + all IPC/renderer/T3/A10 unit tests) under electron 39.8.5.
- **`npm --prefix apps/lawbar-desktop run dist`** (electron-builder packaging): **GREEN.** Packaged `platform=darwin arch=arm64 electron=39.8.5` → `release/mac-arm64` and `platform=darwin arch=x64 electron=39.8.5` → `release/mac`; both native rebuilds completed; `postdist install-app-deps` restored the host binding. macOS code signing was skipped (`identity: null` in the v1 config — signing/notarization is **gate 4, user-owned**, not this lane). `run dist` proves the electron 39 ↔ electron-builder 25.1.8 compatibility + the arch-specific native rebuild — so **no electron-builder upgrade was required** (no HARD-STOP).

## 7. Result: FULL-REMEDIATION PASS
All requirement-10 FULL-PASS conditions hold: R-G19-1 HIGH advisories CLEARED (§3) AND desktop test suite green (§6) AND **`run dist` packaging green** (§6) AND `better-sqlite3` rebuilt + ABI-validated (§5) AND the lockfile diff confined to the electron subtree (§4). This is a **FULL-REMEDIATION PASS** — not the PARTIAL tier (which would apply only if `run dist` could not run for a genuine environment reason; `run dist` ran and passed).

## 8. Rollback plan (documented; not exercised — the bump PASSED)
Had the bump failed: `git restore apps/lawbar-desktop/package.json apps/lawbar-desktop/package-lock.json` (back to `electron ^34.0.0` / resolved `34.5.8`), `electron-builder install-app-deps` to rebuild `better-sqlite3` for electron 34, re-run the desktop gate to confirm green, and record R-G19-1 as "remediation attempted; blocked — needs a larger Electron-migration WI". Post-rollback verification would confirm the two files' `git diff` empty vs pre-bump. Not needed here (FULL PASS).

## 9. How this feeds gate 19 / gate 4 without clearing gate 4/17/6/go-live
Gate 19's R-G19-1 residual is UPDATED to **remediated** (the shipped-runtime HIGH advisories are cleared + packaging-verified). Per the governed WI, **gate 19 stays `OPEN`** — a remediation is evidence, not a gate clearance; the row's roll-up bucket is unchanged. This does **NOT** clear gate 4 (signing/notarization/distribution — still user-owned; the packaged `release/` artifacts here are unsigned dev builds), gate 17 (license — electron stays MIT; no decision), gate 6 (the full-project audit, later), or gates 12/13/20. The final GO/NO-GO + the STOP-AND-ASK hard-stops (4/11/17/21) remain the user's.

## 10. Residual / follow-up
- **Dev/build toolchain advisories** (the 11 high + 1 moderate in the `electron-builder` chain) — advisory-only, build-time, not shipped; a future toolchain-bump WI (post-v1). Tracked as a gate-19 dev-toolchain residual.
- **`electron-builder` currency** — `25.1.8` packages electron 39 fine today; a future toolchain refresh may bump it (separate WI).
- Gate-4 signing/notarization of the packaged runtime remains user-owned.
- The posture is a snapshot; a future electron/electron-builder change or a new advisory re-triggers this check.
