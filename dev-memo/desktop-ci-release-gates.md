# Desktop CI release gates

**WI**: `WI-DESKTOP-CI-RELEASE-GATES-10`. **Docs + CI workflow only — no product change.** Adds an automated
macOS gate so future PRs prove the desktop release path (tests, unsigned packaged build, packaged smoke)
before merge. **No Apple signing/notarization in CI** and no secrets.

## Workflow

`.github/workflows/desktop-release-gates.yml` — job **`desktop-release-gates`**.

- **Triggers:** `pull_request` touching `apps/lawbar-desktop/**` or the workflow file; plus `workflow_dispatch`.
- **Runner:** `macos-14` (Apple Silicon / arm64 — the primary v1 target; GitHub macOS runners are GUI-capable,
  required because electron-builder emits the mac `.app` and the packaged smoke launches a real GUI Electron app).
- **Node/npm:** Node **22** via `actions/setup-node@v4` (Node engine is `>=22 <26`), with **npm cache** keyed on
  `apps/lawbar-desktop/package-lock.json`.
- **Permissions:** `contents: read` (least-privilege; no secrets). **Concurrency:** cancels superseded runs per ref.
- **`LAWBAR_CI: "true"`** — makes CI explicit so the packaged-smoke wrapper keeps its **strict** posture
  (crash-attribution required, 30s settle floor, no dev-only observe/relaxations).

### Steps (in order)
1. `actions/checkout@v4`.
2. `actions/setup-node@v4` (Node 22 + npm cache).
3. `npm --prefix apps/lawbar-desktop ci` — installs from `package-lock.json` + the **committed** internal
   tarballs (`dist-tarballs/case-box-contract-*.tgz`, `case-box-persistence-*.tgz`); **no** `bootstrap` rebuild.
4. `npm --prefix apps/lawbar-desktop test` — the full unit/renderer/electron-in-list suite (**819**), including
   the i18n **user-facing-English guard** (must stay 0) and the FileVault-enforcement unit tests.
5. `npm --prefix apps/lawbar-desktop run dist` — electron-builder packages the app for **arm64 + x64**,
   **UNSIGNED** (`identity: null`; `skipped macOS code signing`). No `dist:release`, no credentials.
6. `npm --prefix apps/lawbar-desktop run test:smoke-matrix` — the packaged **M1–M9** smoke against the fresh
   build (launch zh-CN → nav → create → list → detail → sub-screen → archive → settings → localized-error),
   plus the local-first no-DB-leak scan and (in CI) strict crash attribution.

### Which commands run in CI
`npm ci` → `npm test` → `npm run dist` → `npm run test:smoke-matrix`. All three required checks (2/3/4 of the
WI) run; the packaged smoke (2) **runs in CI** — the wrapper is designed for it (its CI guard *enforces* strict
attribution + 30s settle rather than blocking).

### Caching
npm cache via `setup-node` (`cache: npm`, `cache-dependency-path: apps/lawbar-desktop/package-lock.json`).
Native `better-sqlite3` is rebuilt per run (fast; `postdist` restores the host binding).

### Signing / notarization
**None in CI.** The default `dist` is unsigned (`identity: null`); `dist:release` (the signed path) is **not**
invoked and would fail-closed without credentials anyway. No Apple secrets are referenced, read, or required.
The signing lane stays credential-gated (`dev-memo/desktop-macos-signing-notarization.md`).

### Artifacts
Generated `release/**` bundles are **not** uploaded or committed (300 MB+, gitignored). The gate proves the
release path builds + smokes; it does not publish artifacts.

## `check-ui-design-artifact`
**Unchanged.** It remains a separate workflow (`.github/workflows/ui-design-artifact.yml`), untouched by this WI.

## Local verification (this machine, before push)
- `npm --prefix apps/lawbar-desktop ci` → exit 0 (lock in sync; committed tarballs install).
- `npm --prefix apps/lawbar-desktop test` → **819 pass / 0 fail**.
- `npm --prefix apps/lawbar-desktop run dist` → success (arm64 + x64; unsigned).
- `LAWBAR_CI=true npm --prefix apps/lawbar-desktop run test:smoke-matrix` → **M1–M9 pass**, `0 UNATTRIBUTED`.

## Why full packaged smoke IS suitable for CI here
The `test-packaged-wrapper` was built CI-aware: under `CI=true`/`LAWBAR_CI=true` it *enforces* the strict
crash-attribution guard + a 30s settle floor (Phase-1 `ciFail` on any relaxation), rather than refusing to run.
A clean run reports `0 UNATTRIBUTED` (verified locally in CI mode), so the full M1–M9 matrix is the gate — no
subset needed. Runtime is dominated by `dist` (~1–2 min) + the 30s settle; total well within the 40-min timeout.

## Guardrails
No product/schema/backend/UI/auto-update change; existing tests / i18n guard / smoke / FileVault enforcement /
signing fail-closed behavior are unchanged (the gate *runs* them). No secrets; no `release/**` committed.
The new gate is **required for merge** by policy (do not merge a PR whose desktop-release-gates run fails).
