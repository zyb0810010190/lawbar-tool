# Plan — WI-OCR-REAL-ENGINE-SMOKE-20

**Type**: WORKFLOW/CI (workflow + docs). **No product/schema change.** Follows `WI-OCR-CHAIN-CI-READINESS-19`
(OCR chain gates load/startup, skipped real inference). `main` @ `260c9cd`.

## First step (done)

Due Layer-B closeout for window `27cbd86..260c9cd` → `audit-mreav95g-1najl5` **BATCH-PASS C0 H0 M0 L2** (two stale
doc refs naming `services-ci.yml` for the ocr-chain job — fixed in THIS WI) → closeout `07d59bb`, marker → `260c9cd`.

## Goal

Determine whether a minimal real OCR **inference** smoke can safely run in CI, and add it only if deterministic,
fast, synthetic, and non-sensitive.

## Investigation (full detail in `dev-memo/ocr-real-engine-smoke.md`)

- Gated tests: `services/ocr-worker/tests/{engines.real-paddleocr-engine,pipeline.real-engine.e2e}.test.mjs`
  (`OCR_WORKER_REAL_ENGINE_TESTS`-gated).
- Fixture: `tests/fixtures/zh-02-court-heading.png` — **synthetic**, 8 KB, committed, authored ground truth
  `上海市浦东新区人民法院`; **not** real client data.
- Assertions are stable: **≥1 CJK char** (`/[一-鿿]/`, not exact text) + `deepEqual` determinism + E2E
  `succeeded`+CJK.
- Measured: **10 pass / 0 fail / 0 skipped in 4.74s** with the env set (detect 132ms, deterministic 190ms, E2E
  475ms).
- All "add CI only if…" conditions hold.

## Decision — add the smoke

Added a dedicated step **"ocr-worker real-engine inference smoke (synthetic fixture)"** to the `ocr-chain` job
(`.github/workflows/services-ci-ocr.yml`): `working-directory: services/ocr-worker`,
`env OCR_WORKER_REAL_ENGINE_TESTS=1`, `run: node --test tests/engines.real-paddleocr-engine.test.mjs
tests/pipeline.real-engine.e2e.test.mjs`. Runs after the default ocr-worker suite (reuses its dist). **No test or
fixture change** — the tests + synthetic fixtures already exist; only CI enables them.

## What was added / changed

- `.github/workflows/services-ci-ocr.yml` — the real-engine smoke step + header-comment scope update.
- `dev-memo/ocr-real-engine-smoke.md` (analysis + safety matrix) + this plan.
- **Stale-ref fixes (batch-254 audit L1/L2):** `dev-memo/ocr-chain-ci-readiness.md` + `dev-memo/services-ci-gates.md`
  now name `services-ci-ocr.yml` (not `services-ci.yml`) for the `ocr-chain` job.

## Requirements honored

No real client/legal data (synthetic fixture); no OCR outputs from real documents committed; no external network
(local fixture); no committed `node_modules`/models/`dist`; existing OCR-chain / case-box / desktop gates unchanged
(the smoke is an added step, not a change to those); `dev-memo/run/intake/` untouched; not broadened into accuracy
benchmarking (smoke only).

## Acceptance (met; live on PR)

Local: `OCR_WORKER_REAL_ENGINE_TESTS=1` real-engine smoke **10 pass / 0 fail** (4.74s); clean OCR chain install +
build + test; `case-box-persistence` ci + test. Live: the `ocr-chain` job (now incl. the real-engine smoke step)
runs on this PR.

## Out of scope

OCR accuracy benchmarking (stays in `services/ocr-worker-bakeoff`, dev-only); any product/schema change; running
inference on real documents.
