# Local build provenance — owner-only, unsigned

> **STATUS: NOT A RELEASE.** This records an **owner-only local build** produced on and for the
> author's own machine. It is **not signed**, **not notarized**, and **not distributable**. Gate 4
> (distribution + signing) and gate 21 (final go/no-go) are unaffected by this document and remain
> where they were. Nothing here should be read as clearing either.

## Why this document exists

Until 2026-08-24 the only built `.app` on the machine was **six weeks and 251 commits old**, and its
signature check failed. In practice that meant the software could only be run as
`npm run build && electron .` from a source checkout — a developer workflow, from a terminal, in a
repo.

The consequence is the point: every change merged in those six weeks — including the in-app
audit-chain viewer and the one-click chain verification — existed in no application the author could
open. Real usage stood at 2 matters and 3 audit events, and an uninstallable tool is a sufficient
explanation for that on its own.

This build makes the current system reachable as an application. The provenance below exists so a
record created with it can later be tied to exactly what produced it.

## The build

| | |
|---|---|
| Commit | `09e97f2ff413d68048c196de5ab335efb9ddfa4e` |
| Built | 2026-08-24 |
| Electron | 39.8.5 |
| Architectures | `arm64` (`release/mac-arm64/`) and `x64` (`release/mac/`) |
| Bundle size | 316 MB (arm64) |
| Produced by | `npm --prefix apps/lawbar-desktop run dist` |

Identity, arm64 bundle:

```
Contents/MacOS/lawbar      sha256  352199cc20deb0c84a9df2974a56c56a1f0eab6211fc082477c8a42ad344200b
Contents/Resources/app.asar sha256 7fa016a469761869294a18bd7fc68f1267d557f96baf2a9c508e7cd1246d047d
```

Recompute with `shasum -a 256` against those two paths. They identify the build; the rest of the
bundle is the Electron runtime.

## Signing status, stated plainly

`identity` is `null` in the unsigned build configuration, so **electron-builder does not re-sign the
bundle**. The app therefore carries the prebuilt Electron binary's own ad-hoc signature, which does
not cover the resources electron-builder added. Both checks report this:

```
codesign --verify --deep --strict → code has no resources but signature indicates they must be present
spctl -a -vv                      → same
```

Two things follow, and neither should be overstated:

- **This is not a corrupted artifact.** A fresh build reproduces it exactly. An earlier assumption
  that the stale June build was merely broken was wrong — the condition is inherent to building with
  `identity: null`.
- **It does not prevent use.** Verified by launching through LaunchServices (the Finder path, where
  Gatekeeper actually applies) against a throwaway profile: the app started and ran. macOS does not
  quarantine a bundle produced locally on the same machine.

Signed and notarized distribution is not currently possible regardless: the machine holds **zero**
`Developer ID Application` identities. That is a separate decision (gate 4) and is untouched here.

## What was verified before this was recorded

- `npm run dist` — clean, both architectures, exit 0.
- `npm run test:packaged` — 3/3 pass against the packaged binary: it exists, it launches and renders
  the case-box shell, and theme switching works. The crash-detector wrapper attributed **zero**
  diagnostic reports.
- LaunchServices launch — starts and runs under a throwaway `--user-data-dir`.
- `npm test` — desktop lane 1161 pass / 0 fail / 0 todo at this commit.

## The defect this exposed

The first `test:packaged` run failed on "renders case-box list shell". The cause was not the build.
`tests/smoke.packaged.electron.test.mjs` launched with `args: []` — no `--user-data-dir` — so the
packaged app resolved the **real** profile at `~/Library/Application Support/lawbar`.

This is the same defect corrected in `smoke.electron.test.mjs` earlier, and this sibling was missed
because it does not run in the default lane; it runs only under `npm run test:packaged`. Its file
header had described the shared real profile as the design, mitigating only `theme-preference.json`
on the assumption that was the sole shared state — and `clearPref()` accordingly deleted a file from
inside the litigator's own directory.

Measured when found: `case-box.sqlite` was **not** written — 294912 bytes, mtime unchanged since
2026-08-04, and no `-wal` or `-shm` were ever created. It survived because the app failed before
reaching it. That is luck, not isolation.

All three launches now go through `launchIsolatedPackaged()`, which supplies a temp profile and
refuses to proceed if the resolved path is the real one. With isolation the suite passes 3/3, and
the shell test drops from 8.8s to 2.1s — it had been waiting out a marker that could never appear.

## Installing it

```bash
cp -R apps/lawbar-desktop/release/mac-arm64/lawbar.app /Applications/
```

Deliberately left as a manual step. Copying into `/Applications` is a change to the machine rather
than to this repository, and it is the author's to make.

## The honest claim

> Locally built from commit `09e97f2`, hashes above, used only by the author on the machine that
> produced it.

Not "released software". Not "signed". Not "verified by a third party". If a record created with
this build is ever relied on, that sentence — with the commit and the hashes — is what can be said
about its provenance, and nothing broader.
