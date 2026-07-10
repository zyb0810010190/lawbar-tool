# Services CI gates

**WI**: `WI-SERVICES-CI-GATES-17`. **CI/scaffold only — no product change.** Adds a GitHub Actions gate so
service-package suites run on PRs. Starts with `services/case-box-persistence` (its migration / conformance /
hardening suites previously ran only locally — surfaced by WI-16's data-migration test living there, off CI).

## Workflow

`.github/workflows/services-ci.yml` — job **`case-box-persistence`**.

- **Triggers:** `pull_request` touching `services/case-box-persistence/**`, `docs/contracts/case-box-contract/**`
  (the `file:`-linked contract dependency — a contract change can break persistence build/tests), or the workflow
  file itself; plus `workflow_dispatch`.
- **Runner:** `ubuntu-latest` — the suite is headless Node + `better-sqlite3` (native, builds on Linux); no
  GUI/Electron here (that stays the desktop gate's job). Cheaper/faster than macOS.
- **Node:** 22 via `actions/setup-node@v4` (persistence `engines` is `>=22 <26`), with **npm cache** keyed on
  **both** lockfiles (`services/case-box-persistence/package-lock.json` +
  `docs/contracts/case-box-contract/package-lock.json`).
- **Permissions:** `contents: read` (least-privilege; no secrets). **Concurrency:** cancels superseded runs per ref.

### Steps
1. `actions/checkout@v4`.
2. `actions/setup-node@v4` (Node 22 + npm cache on both locks).
3. `npm --prefix docs/contracts/case-box-contract ci` — the persistence `test` builds the contract (`tsc`), which
   needs the contract's own `typescript` devDep.
4. `npm --prefix services/case-box-persistence ci` — installs persistence deps incl. the native `better-sqlite3`
   (**node-ABI** build) + the `file:` link to `case-box-contract`.
5. `npm --prefix services/case-box-persistence test` — runs the `abi-smoke` pretest (better-sqlite3 loads) → builds
   the contract → builds persistence → the full `node --test` suite: **migration-compat**, conformance, hardening,
   impl-parity, invariants, audit-chain (**589 / 273 / 288** locally from a clean `npm ci`).

### Why not macOS / the desktop gate
The persistence suite is pure Node; it does not need Electron or a GUI. The desktop's `better-sqlite3` is an
**Electron-ABI** binding (can't load under plain `node`), which is exactly why the WI-16 migration test lives in
the persistence package — and why this gate runs it on Linux under the **node-ABI** binding.

## Local verification (this machine, before push)
- `npm --prefix docs/contracts/case-box-contract ci` → ok.
- `npm --prefix services/case-box-persistence ci` → ok (better-sqlite3 rebuilt; `[case-box-abi-smoke] OK`).
- `npm --prefix services/case-box-persistence test` → **589 / 273 / 288 pass**.
- Desktop regressions unaffected: `npm --prefix apps/lawbar-desktop test` / `dist` / `test:smoke-matrix`.

## Sibling services — deferred (documented)
`services/ocr-worker`, `services/ocr-persistence`, `services/ocr-ingestion`, `services/ocr-review` all have
lockfiles + `test` scripts, but their CI setup is **not yet clearly low-risk** to add blindly: `ocr-worker` carries
the SSRF/TLS/DNS security surface, `ocr-persistence` has its own native-binding/ABI concerns, and cross-service
wiring is unverified for CI. Per the WI ("include siblings only if setup is clear and low-risk; otherwise document
as follow-up"), they are **deferred** to a follow-up that extends this workflow one service at a time (each proven
with a clean `npm ci` + `test` first). The workflow is structured so adding a sibling is a new job, not a rewrite.

## Guardrails
No product/schema/UI change. No secrets. No generated artifacts uploaded/committed (no DBs, no `dist/`, no
`release/**`). The desktop `desktop-release-gates` and `check-ui-design-artifact` workflows are untouched. This
gate is **required for merge** for PRs that touch its trigger paths.
