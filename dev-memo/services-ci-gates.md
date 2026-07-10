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
lockfiles + `test` scripts, but **WI-SERVICES-CI-GATES-SIBLINGS-18 investigated them and deferred all four** (see
`dev-memo/plan-services-ci-gates-siblings-18.md` for the full inventory). Root cause: `services/ocr-worker` is the
package named **`ocr-worker-adapter`**, a shared `file:` dependency of the other three (they all `import` it at
runtime). It carries the **`@gutenye/ocr-node` OCR engine** — `onnxruntime-node` (native) + `sharp` (native) +
16 MB of `.onnx` model binaries, a **326 MB** `node_modules`. So building/testing *any* sibling in clean CI
requires that native OCR engine chain, which fails the WI bar ("no external OCR engine/service required",
"reasonable runtime", clean/deterministic). `ocr-worker` additionally owns the SSRF/TLS/DNS fetcher surface + a
`OCR_WORKER_REAL_ENGINE_TESTS`-gated real-engine path. Local `npm test` passes for ocr-persistence (231) and
ocr-ingestion (30) are **not** a clean-CI signal — they reuse pre-built `dist/`.

**Follow-up (recommended):** a dedicated *OCR-chain CI* WI that decides whether the 326 MB native engine is
acceptable per-PR (and **caches** onnxruntime/sharp/models), builds the `docs/contracts` → `ocr-worker-adapter` →
`ocr-persistence` chain once, then gates ocr-persistence / ocr-ingestion; `ocr-worker`'s network-surface tests are
handled separately after confirming they are loopback-only. This workflow is structured so each future service is a
new job, not a rewrite.

## Guardrails
No product/schema/UI change. No secrets. No generated artifacts uploaded/committed (no DBs, no `dist/`, no
`release/**`). The desktop `desktop-release-gates` and `check-ui-design-artifact` workflows are untouched.

**Merge posture — required by policy, technically advisory.** This `services-ci` gate is **required for merge by
policy**: maintainers MUST NOT merge a PR (touching its trigger paths) while `services-ci` is red. It is **not**
enforced by a required-status-check rule, because this repo currently lacks enforceable GitHub branch
protection / rulesets (private repo under the current account — see `dev-memo/run/log.md` §"Workflow note — GitHub
private-repo branch protection limitation"). So the check is technically **advisory**; the do-not-merge-on-red rule
is a human policy, exactly mirroring the existing `desktop-release-gates` precedent
(`dev-memo/desktop-ci-release-gates.md`). If enforceable branch protection becomes available, add `services-ci` as
a required status check on `main`.
