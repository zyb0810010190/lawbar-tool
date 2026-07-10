# Plan — WI-SERVICES-CI-GATES-SIBLINGS-18

**Type**: WORKFLOW/CI investigation (docs). **No product/schema/workflow-behavior change.** Follows
`WI-SERVICES-CI-GATES-17` (`services-ci` gates `case-box-persistence`) + `WI-SERVICES-CI-DOC-FIX1`. `main` @ `eefe945`.

## First step (done)

Due Layer-B closeout for window `2063b0d..eefe945` returned **BATCH-FAIL C0 H0 M1** → remediated by
`WI-SERVICES-CI-DOC-FIX1` (commit `f7cdbd9`) → post-fix Layer-B `audit-mre8qlu0-vs18wb` **BATCH-PASS C0 H0 M0** →
closeout `1d62b27`, marker → `f7cdbd9`. Run-log override line persisted (`85bb37f`).

## Goal

Add CI gates for sibling `services/*` packages whose install/test path is clean, deterministic, and safe in PR CI.

## Investigation — service inventory

| Service (dir) | pkg name | pkg.json | lock | `npm ci` (local) | `npm test` (local) | Needs (network / native / OCR engine / build-chain) | CI-safe now? |
|---|---|---|---|---|---|---|---|
| `services/ocr-worker` | **ocr-worker-adapter** | yes | yes | heavy | not run | **`@gutenye/ocr-node` OCR engine** (`onnxruntime-node` native + `sharp` native + 16 MB `.onnx` models; **326 MB** node_modules) **+ SSRF/TLS/DNS network surface** (`node:http/https/net/tls/dns`, `127.0.0.1`, `fetch`) + `OCR_WORKER_REAL_ENGINE_TESTS`-gated tests | **NO** |
| `services/ocr-persistence` | ocr-persistence | yes | yes | ok | 231 pass* | `better-sqlite3` native + `abi-smoke` pretest; **tests `import` `ocr-worker-adapter`** → dist requires building `services/ocr-worker` → the **OCR engine chain** | **NO** |
| `services/ocr-ingestion` | ocr-ingestion | yes | yes | ok | 30 pass* | deps `ocr-worker-adapter` + `ocr-persistence` + `ocr-worker-contract`; its `test` builds **only itself** (relies on pre-built sibling dist) → needs a multi-package build chain **+ the OCR engine chain** via `ocr-worker-adapter` | **NO** |
| `services/ocr-review` | ocr-review | yes | yes | not run | not run | its `test` **builds** the whole chain incl. `services/ocr-worker` (→ the OCR engine chain install); the `pipeline.runtime.e2e.test.mjs` E2E itself is **in-memory** (`InMemoryOcrQueue` + `InMemoryOcrPersistence` + an injected **fake worker** + a fake process `EventEmitter`) — it does **not** run the real engine or network | **NO** |

\* The local `npm test` passes are **not** a clean-CI signal — they reuse `dist/` + `node_modules` built by prior
local work. A clean CI checkout has no `dist`, so every sibling's tests would need the sibling build chain
(`ocr-worker-adapter` in particular) constructed first.

## Root cause of the shared blocker

`services/ocr-worker` **is** the package named **`ocr-worker-adapter`**, and it is a `file:` dependency of
ocr-persistence, ocr-ingestion, and (transitively) ocr-review. All four import `ocr-worker-adapter` at runtime, so
building/testing any of them in clean CI requires that package's `dist`, whose build pulls the **326 MB native OCR
engine chain** (`onnxruntime-node` + `sharp` + ONNX model binaries). `ocr-worker` additionally owns the
security-sensitive fetcher (SSRF/TLS/DNS) surface.

## Decision — defer all four (this WI adds no CI jobs)

None of the four satisfies the WI's ALL-must-hold bar — each **requires the external OCR engine chain** to
build/test, which fails "no external OCR engine/service required", strains "reasonable runtime", and adds native
prebuild (onnxruntime/sharp) determinism risk. Per the WI ("if a service is not ready, document it as deferred; do
not force it into CI"), all four are **deferred**. `.github/workflows/services-ci.yml` is **not** changed.

## Recommended follow-up — a dedicated OCR-chain CI WI

A focused WI should: (1) decide whether the 326 MB native OCR engine (onnxruntime-node + sharp + models) is
acceptable per-PR, and if so **cache** it; (2) build the `docs/contracts` → `ocr-worker-adapter` → `ocr-persistence`
chain once, then gate `ocr-persistence` / `ocr-ingestion` / `ocr-review` (each its own explicit job after a
clean-room `npm ci` + `test` proof — `ocr-review`'s E2E is in-memory, so once the chain builds it may be a
low-runtime addition); (3) handle `ocr-worker`'s network-surface tests separately after confirming they are
**loopback-only** (no external network) and the real-engine tests stay env-gated. **Lockfile hygiene to validate
first:** the `../ocr-worker` (`ocr-worker-adapter`) `file:` entry is present with `@gutenye/ocr-node` in
`ocr-persistence`'s and `ocr-worker`'s locks (refs 1 and 3) but **absent** in `ocr-ingestion`'s and `ocr-review`'s
locks (0 refs) — the clean proof must confirm/regenerate these locks so a clean `npm ci` resolves the chain
deterministically.

## Requirements honored

No product/service source, tests, or package files touched; existing `services-ci` / `desktop-release-gates` /
`check-ui-design-artifact` gates unchanged; no secrets; no signing; no real client data; `dev-memo/run/intake/`
untouched; no generated DBs / OCR outputs / temp / backups / release artifacts / local data / credentials committed.

## Acceptance (met)

Regression checks green (unchanged): `services/case-box-persistence` ci + test; `apps/lawbar-desktop` test + dist +
smoke. Docs-only change; no product behavior change.

## Out of scope

Adding any OCR-service CI job (the follow-up above); any product/schema change; changing the OCR dependency graph.
