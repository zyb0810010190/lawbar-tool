# ocr-worker-bakeoff

Engine bakeoff harness for **ADR-11A.1**. Stays outside the production
dependency graph — `services/{ocr-worker, ocr-persistence, ocr-ingestion,
ocr-review}` and `docs/contracts` MUST NOT depend on this package.

## Status

- **Commit α (this)** — engine-free foundation: types, CER metric,
  fixture-manifest schema. **No harness, no runner, no bin.**
- **Commit β** — Tesseract baseline. Adds `src/harnesses/tesseract.ts`
  + a thin runner. Lands once `tesseract` CLI is installed locally
  (`brew install tesseract`).
- **Commit γ** — PaddleOCR baseline. Adds a Python-wrapper harness
  emitting versioned JSON. Lands once a Python venv with
  `paddleocr` / `paddlepaddle` exists.
- **Commit δ** — RapidOCR baseline. Adds an ONNX-Runtime-Node harness
  with pinned model artifacts.
- **Commit ε** — ADR-11A.1 verdict + lockfile + assembled license
  artifact. Lands only after all three v1 candidates have measurements
  and the hybrid fixture set is complete (≥5 active synthetic + ≥2
  active real, per Q3 sign-off).

## Per-engine landing protocol

Each engine commit MUST:

1. Add its harness module under `src/harnesses/<engine>.ts`.
2. Implement `EngineCandidate.probe()` against the real engine
   installation states (return a typed `ProbeResult` for each known
   failure mode — see `src/types.ts`).
3. Define the engine's raw-output → `engineTranscript: string`
   projection explicitly inside the harness file. This is
   **measurement-only**, NOT the production OCR mapper (see
   ADR-11A.5 v0.1 §"What v0.1 does NOT decide").
4. Capture `cold_model_load_ms` (first run on a fresh process) and
   `per_page_inference_ms` (subsequent runs) separately. The
   lease-renewal metric assembled in ε depends on this split.
5. Run each candidate in an isolated child process so `peak_rss_bytes`
   readings do not contaminate one another.
6. Record `LicenseEvidence` for the engine code AND the model weights
   AND the redistribution status. ε assembles these into the legal
   artifact; a missing field blocks ε.

## Fixture replacement procedure

Fixtures live under `fixtures/synthetic/` and `fixtures/real/`. Each
active fixture ships:

- the image bytes (e.g. `01-printed-chinese.png`)
- the expected ground-truth text (`01-printed-chinese.txt`)
- a SHA-256 of the image bytes (`01-printed-chinese.sha256`)
- a manifest entry in `fixtures/manifest.json`

**CI never regenerates fixtures.** Replacement is a manual offline
operation:

1. Render or capture the new image bytes with whatever tool
   (rendering is non-deterministic across machines — that is why we
   do not regenerate at CI time).
2. Update the expected `.txt` to match.
3. Recompute the SHA-256 and overwrite the `.sha256` file.
4. Update the manifest entry (`expected_text_sha256`, `provenance`,
   `notes`, `last_verified_at`).
5. Commit all four changes together.

`tests/manifest.test.mjs` enforces hash consistency across every
**active** fixture; placeholder fixtures skip the hash check.

## ProbeResult contract summary

`probe()` returns one of:

- `available` — engine ready; harness can run.
- `missing_dependency` — required runtime is absent (e.g. Python,
  Tesseract binary, npm package).
- `missing_model` — runtime is present but the model artifact isn't.
- `bad_version` — runtime is present but the version doesn't match
  the harness's pin.
- `unsupported_platform` — engine refuses to run on this OS/arch.
- `probe_failed` — probe itself crashed (engine in a broken state).

Each non-`available` status carries a `remediation` string the bakeoff
runner prints alongside the report.

## CER normalization summary

See `src/accuracy.ts` for the full normative spec. Headline rules:

- Unicode NFC normalize both reference and candidate.
- Collapse any whitespace run (including line breaks) to a single ASCII
  space; trim leading and trailing whitespace.
- Full-width vs half-width punctuation NOT folded (engines are
  judged on what they actually emit).
- Latin case preserved (no `.toLowerCase()` shenanigans).
- Each Unicode code point after normalization = one token.

## What this package is NOT

- Not part of the production OCR worker. Production OCR is the topic
  of ADR-11C, not ADR-11A.1.
- Not a real-time benchmarking service. It is a one-shot
  decision-support harness for choosing an engine.
- Not authoritative on the contract `OcrResult` shape — that's
  ADR-11A.5 v0.1.
