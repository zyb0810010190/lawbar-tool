# Plan — WI-OCR-CONFIDENTIALITY-RETENTION-21

**Type**: SECURITY/confidentiality verification (test + docs). **No product/schema change.** Follows the OCR CI
arc (WI-19 chain CI, WI-20 real-engine smoke). `main` @ `670e28e`.

## First step (done)

Due Layer-B closeout for window `260c9cd..670e28e` → `audit-mredompa-9kf6s8` **BATCH-PASS C0 H0 M0 L3** (three
undescribed Lows, CI/docs window) → closeout `57c886f`, marker → `670e28e`.

## Goal

Verify + document that no client document text, paths, temp files, or OCR outputs leak through logs, CI, temp
directories, or persisted artifacts beyond the intended local store.

## Investigation (full inventory in `dev-memo/ocr-confidentiality-retention.md`)

- **Zero** `console`/logger call-sites in any OCR service `src/`.
- Observability events (`observability.ts` §"No PII") = `job_id` + counts + short error strings — **no OCR text /
  payload**.
- Extracted text → `OcrResult.raw_text` → `saveOcrResultOnce` → the **local** store (intended); never to stdout/
  stderr/events.
- Engine temp input: `mkdtemp` (`0o700`) + `writeFile` (`0o600`) under `os.tmpdir()`, removed in a **`finally`**.
- Fetcher errors: stable codes, `cause` opt-in — no path/URL leak by default.
- Failure records: stable code + short message, no raw text.
- Fixtures: synthetic + labelled; no tracked OCR output artifacts; temp lives outside the repo.
- **No real leak found.**

## What was added

- `services/ocr-worker/tests/pipeline.real-engine.e2e.test.mjs` — a confidentiality **regression assertion**: the
  worker's stdout+stderr must contain **no BMP CJK char** after a real OCR run (the extracted text is persisted, not
  logged). Test-only; runs under the WI-20 real-engine smoke; passes.
- `dev-memo/ocr-confidentiality-retention.md` (inventory + retention boundaries) + this plan.

## Requirements honored

No real client/legal data (synthetic fixture); no OCR outputs from real documents committed; `dev-memo/run/intake/`
untouched; no generated `node_modules`/models/`dist`/temp/artifacts/secrets committed; existing OCR / case-box /
desktop / i18n gates unchanged (the added assertion strengthens, never weakens); no cloud/remote; not broadened
into accuracy benchmarking; no UI change (no UI leak found).

## Acceptance (met; live on PR)

Local: E2E confidentiality assertion passes under `OCR_WORKER_REAL_ENGINE_TESTS=1`; default ocr-worker suite
unchanged; `case-box-persistence` ci + test. Live: the `ocr-chain` job (incl. the real-engine smoke that runs the
strengthened E2E) on this PR.

## Out of scope

Any product/schema/data-model change; sanitization fixes (none needed — surfaces already sanitized); OCR accuracy;
cloud/remote retention.
