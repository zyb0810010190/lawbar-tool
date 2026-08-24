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
| Commit | `c127b4b7c51c567011a0ba2daed2acad68870aa8` |
| Built | 2026-08-24 |
| Electron | 39.8.10 |
| Architectures | `arm64` (`release/mac-arm64/`) and `x64` (`release/mac/`) |
| Bundle size | 316 MB (arm64) |
| Produced by | `npm --prefix apps/lawbar-desktop run dist` |

Identity, arm64 bundle:

```
Contents/MacOS/lawbar      sha256  cf74833a9b0c242e26c177005d7d61819e5bf5ed199acc794fed2eb0cc4f3149
Contents/Resources/app.asar sha256 f9196a8f44a125375947ce05a255f7e76fd810e1ae261129885e7ecac7b595cb
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
- `npm test` — desktop lane 1185 pass / 0 fail / 0 todo at this commit.

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

> Locally built from commit `c127b4b`, hashes above, used only by the author on the machine that
> produced it.

Not "released software". Not "signed". Not "verified by a third party". If a record created with
this build is ever relied on, that sentence — with the commit and the hashes — is what can be said
about its provenance, and nothing broader.

## Rebuilt 2026-08-24 after the first real launch

The first launch of the installed build refused to start: FileVault is off on this machine, and the
production gate blocks on that. The refusal is correct and unchanged. Its wording was not — it was
in English, alone among the main-process refusals, and its second sentence offered `LAWBAR_MODE=dev`
as an apparently co-equal remedy. Both are fixed, and this artifact was rebuilt to carry the
corrected message. Verified by grep against the packaged `app.asar`: the zh-CN text is present and
the old English bypass sentence is gone.

Only `app.asar` changed; the Electron binary hash is identical, as expected for a JS-only change.

**The block still stands, and will keep standing until FileVault is enabled.** That is the intended
behaviour, not a defect to work around. Enabling it is the author's action — it needs the login
password and a decision about where the recovery key is stored, neither of which belongs to this
repository.

## Trying it without enabling FileVault

The production gate still blocks, and should. To trial the workflow before making the FileVault
decision:

```bash
npm --prefix apps/lawbar-desktop run evaluate
```

This runs dev mode against `~/Library/Application Support/lawbar-evaluation` — a separate profile
the run cannot see past. Verified end-to-end at this commit: the app launched with FileVault off,
created its own case store in that profile, and the real `case-box.sqlite` was byte-identical
afterwards (294912 bytes, mtime unchanged since 2026-08-04).

Use SYNTHETIC matters only. Nothing can stop a real client name being typed into that profile; what
is guaranteed is that real use cannot happen silently in the real store while the gate is bypassed.
Dev mode now carries a non-dismissable in-app banner naming the mode and the directory.

`npm run evaluate -- --reset` empties the evaluation profile.

## Rebuilt 2026-08-24 on Electron 39.8.10 (WI-SEC-ELECTRON-3980)

The previous build ran Electron 39.8.5, against which npm reported **15 advisories**. Two of them
attack this app's stated security boundary directly — context-isolation bypass via
`Function.prototype.bind` hijack (CVSS 7.5) and contextBridge object copy honouring prototype
setters (CVSS 5.4) — and the app runs with `sandbox: false`, which makes that boundary load-bearing
rather than one layer among several.

Electron is now 39.8.10 and `fast-uri` is pinned to `^3.1.6` by an override, reaching the app via
`ajv` under `case-box-contract`.

    electron   direct advisories  15 -> 0
    fast-uri   direct advisories   3 -> 0
    shipped packages still carrying a direct advisory: NONE

**The workspace headline barely moved** — 1 critical / 19 high became 1 critical / 18 high — and
that is not a disappointing result, it is the correct one. Every remaining advisory, including the
critical, is in BUILD TOOLCHAIN only (`electron-builder`, `node-gyp`, `tar`, `extract-zip`): code
that runs on this machine during a build and is not present in the packaged `.app`. `electron` is
still listed, but with zero direct advisories — it is flagged transitively through `extract-zip`,
the npm package's install-time unzip helper.

Verified: desktop lane 1185 pass / 0 fail; `test:packaged` 3/3 against the app rebuilt on the new
runtime, with zero attributed crash reports; the real case store untouched throughout.

Two notes for whoever repeats this:

- **`npm install` did not apply the fix.** `fast-uri` 3.1.2 already satisfies ajv's `^3.0.1`, so npm
  saw nothing to do even with the lockfile updated to 3.1.6 and an override in place. Only `npm ci`
  reconciled the tree. The lockfile is a statement of intent; the only check that counts is the
  version on disk.
- **There is no two-sided verification for this change, and none was manufactured.** You cannot
  write a regression test for "a CVE existed". The evidence is the advisory delta above plus green
  lanes and a working packaged build. A contrived failing test here would produce false confidence,
  which is worse than an acknowledged gap.
