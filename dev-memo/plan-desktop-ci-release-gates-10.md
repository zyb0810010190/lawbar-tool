# Plan — WI-DESKTOP-CI-RELEASE-GATES-10

**Type**: CI/release-governance (workflow + docs). **No product source change.** Follows the release-readiness
lane (PRs #241–#245). **`main` @** `c61bbc9`.

## Goal

Add an automated macOS CI gate that runs the meaningful desktop release checks (unit/renderer/electron suite,
unsigned packaged build, packaged M1–M9 smoke) on every PR, so regressions are caught before merge. No signing.

## What was done

1. Investigated setup: Node engine `>=22 <26`; internal deps (`case-box-contract`, `case-box-persistence`) are
   **committed tarballs** under `dist-tarballs/` → CI can `npm ci` without the `bootstrap` rebuild; `package-lock.json`
   is committed; the packaged-smoke wrapper is **CI-aware** (enforces strict crash attribution + 30s settle when `CI=true`).
2. Added `.github/workflows/desktop-release-gates.yml` (job `desktop-release-gates`): `macos-14`, Node 22 + npm
   cache, `contents: read`, concurrency-cancel, `LAWBAR_CI=true`; steps `npm ci` → `test` → `dist` → `test:smoke-matrix`.
   No Apple credentials; `release/**` not uploaded/committed.
3. Left `check-ui-design-artifact` untouched.
4. Verified the exact sequence locally: `npm ci` exit 0; `test` 819 pass; `dist` success (unsigned); CI-mode
   `test:smoke-matrix` M1–M9 pass with `0 UNATTRIBUTED`.
5. Docs: `dev-memo/desktop-ci-release-gates.md` + this plan.

## Decisions

- **Runner = macos-14 (arm64):** electron-builder mac `.app` + GUI packaged smoke need macOS; arm64 is the v1 target.
- **`npm ci` (not the full `bootstrap`):** the internal tarballs are committed + the lock is in sync → reproducible,
  fast, no contract/persistence rebuild. (If a future dep bump desyncs the lock, switch to `bootstrap` or refresh the lock.)
- **Full packaged smoke IN CI (not a subset):** the wrapper is designed for CI (strict attribution enforced, not
  blocked); a clean run is `0 UNATTRIBUTED`. So no subset/deferral is needed.
- **No signing in CI:** default `dist` is `identity: null`; `dist:release` is not invoked (and fail-closes without creds).

## Verification loop

The workflow file is in this PR's path filter, so the PR **self-runs** the new gate. Merge only if the
`desktop-release-gates` check passes (per the WI + guard conditions). If CI exposes an environment-only issue
(GUI/Gatekeeper/lock), iterate on the workflow (or fall back to the strongest safe subset `test` + `dist`) and document.

## Governance

Low-risk CI/doc; no product/schema/backend/UI/auto-update/notarization change; existing tests / i18n guard /
smoke / FileVault enforcement / signing fail-closed behavior unchanged (the gate runs them); no secrets; no
`release/**` committed; `.mcp.json` untouched. Batch-audit closeout per the standard cadence.

## Acceptance (met locally; CI validated on the PR)

`git status --short` clean of unintended paths · workflow `Desktop release gates` · CI runs `npm ci`/`test`/`dist`/
`test:smoke-matrix` on `macos-14` Node 22 · npm cache · packaged smoke runs in CI · `dist` runs in CI · local
`test`/`smoke-matrix`/`dist` green · no product behavior changed. **PR check status:** reported after push.

## Out of scope

Product source, schema, backend, UI redesign, auto-update, actual notarization, artifact publishing, Linux/Windows CI.
