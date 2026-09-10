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
- **R3 / WI-12 step 3 (2026-09-10)** — `lawbar-ocr-vision`: Apple Vision reached
  THROUGH the desktop app's packaged helper (`src/harnesses/lawbar-ocr-vision.ts`).
  The binary is resolved from `apps/lawbar-desktop/release/mac-*/lawbar.app`
  first, the staged `build/helpers` second, or `LAWBAR_OCR_HELPER`; it runs with
  an empty `PATH` under a process-group deadline, and its self-reported digest
  must equal the executed file's sha256 or the observation is a failure. Cold
  runs only (one process per page). Opt-in real run:
  `OCR_REAL_LAWBAR_OCR_TESTS=1`.
- **R3 / WI-12 PDF fixture kind (2026-09-10)** — fixtures carry `media: png | pdf`
  (default png; the extension must agree) and candidates declare
  `supported_media`; the runner records `unsupported_media` instead of handing a
  PDF to an image-only engine. Ten PDF fixtures derive from the five Chinese
  pages: `*-pdf-layer.pdf` (text layer authored with `cupsfilter`) and
  `*-pdf-scan.pdf` (image-only, wrapped with `sips`). `lawbar-ocr-pdfkit-layer`
  (`src/harnesses/lawbar-ocr-pdfkit-layer.ts`) scores the text layer through the
  same helper boundary (`src/harnesses/lawbar-ocr-helper.ts`); a page with no
  layer is the structured `no_text_layer` failure — the escalation signal.
- **R3 / WI-12 helper 0.2.0, `--layer-only` (2026-09-10)** — the layer tier's
  numbers are its own: the helper reads the text layer and renders and
  recognises nothing, records carry `mode` and `layer_ms`, and unmeasured fields
  are absent rather than zero. The harness requires the record's `mode` to be
  the one it asked for. Measured: ~40 ms and ~17 MB per page for the layer tier
  against ~280 ms and ~70–106 MB for Vision.
- **R3 / WI-12 item 6, the verdict (2026-09-10)** — `fixtures/verdict-spec.json`
  registers, per tier slot, what must be met on the HOLDOUT role (metric,
  subgroup, operator, value); it was committed before any holdout page was
  authored. `fixtures/holdout/` holds six pages rendered unlike the tuning set
  (other fonts, rotation, noise, a faint fax-like page, a seal over the text,
  full-width punctuation in the source) with text-layer and scanned PDF
  variants. `src/verdict.ts` aggregates a run per candidate and subgroup and
  applies the spec as written; `bin/verdict.mjs --role=holdout --out=results/…`
  writes the COMMITTABLE result — aggregates and identity only, never a
  transcript, a fixture id, or a path — append-only. `results/` holds committed
  verdicts. `--fixtures-root=/abs/path` points both bins at a manifest outside
  the repository (the owner's real pages, read in place; same containment rules;
  same result shape).
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
