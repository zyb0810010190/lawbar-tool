# Plan — WI-DESKTOP-RC1-ARTIFACT-HANDOFF-06

**Type**: DOC (release handoff). **No product source change.** Follows PRs #236–#241 (zh-CN i18n lane +
release smoke matrix). **`main` @** `16a8f85`.

## Goal

A repeatable release-candidate handoff for the macOS desktop app: build artifacts, checksums, install/open
instructions, data location, dev-run, and honest signing/notarization status.

## What was done

1. Ran the full verification sequence from clean `main`: `git status --short`, `npm test`,
   `npm run test:smoke-matrix`, `npm run dist` — all green (819 unit pass; smoke M1–M9 1 pass; dist success).
2. Inventoried `apps/lawbar-desktop/release/`: two `.app` bundles (`mac-arm64` arm64 318 MB, `mac` x86_64
   328 MB) via `target: dir` (no `.dmg`/`.zip`); `builder-*.{yml,yaml}`.
3. Recorded per-arch content SHA256 (the `.app` is a directory bundle → checksummed `app.asar` + the
   arch-specific electron stub) in `dev-memo/release/rc1-checksums.txt`.
4. Confirmed which artifact to open per arch; signing = **adhoc/linker-signed only, NOT notarized**
   (`identity: null`; `spctl` rejects); documented Gatekeeper open steps; data dir
   `~/Library/Application Support/lawbar`; dev-mode run (`LAWBAR_MODE=dev …/MacOS/lawbar`); and the zh-CN
   launch checklist (auto-covered by the smoke matrix).

## Deliverables (docs only)

- `dev-memo/desktop-rc1-artifact-handoff.md` — the handoff (9 sections + blockers/caveats).
- `dev-memo/release/rc1-checksums.txt` — checksum manifest.
- `dev-memo/plan-desktop-rc1-artifact-handoff-06.md` — this plan.

`release/**` is gitignored (300 MB+ bundles) → the `.app`s are NOT committed; the docs point to the
locally-built path + how to rebuild/transfer.

## Honest caveats (documented, not solved here per WI scope)

Unsigned/not-notarized (separate signing WI — Stop-and-Ask); production launch requires FileVault ON;
`target: dir` (no `.dmg`); checksums are per-build not reproducible; app version 0.1.0 placeholder.

## Governance

Doc-only, low-risk; no product/schema/enum/i18n change; user-facing English still 0; self-review recorded
(the verification sequence + artifact inspection ARE the evidence). Includes the Layer-B batch-audit
closeout for the WI-05 window.

## Guard conditions (satisfied)

`.mcp.json` untouched · pre-existing untracked clutter untouched · no signing/auto-update/backend/schema/UI
implementation · signing absence documented honestly as a caveat.

## Out of scope

Signing/notarization implementation, auto-update, `.dmg` packaging, version bump, backend, schema, UI redesign.
