# OCR confidentiality & retention boundaries

**WI**: `WI-OCR-CONFIDENTIALITY-RETENTION-21`. Verifies + documents that **no OCR-extracted document text, OCR
outputs, or submission payloads leak** through logs, CI, temp directories, or persisted artifacts beyond the
intended local store. **Investigation outcome: no real leak of document content found** — the OCR chain is already
confidentiality-conscious by design. One confidentiality **regression test** was added to lock the highest-value
boundary (no OCR text in the worker's output streams); otherwise docs-only.

**Scope note (what this does NOT claim).** The guarantee is about **document-derived content** (OCR text / payload /
OCR output). It is **not** an absolute "no paths ever printed" claim: the worker's startup config summary
intentionally emits **deploy-config paths** (`sqlite_path`, `fetcher_file_root`) to stderr for operator visibility
(see §"Config-path disclosure"). Those are operator-chosen configuration, not derived from client documents.

## Confidentiality / retention inventory

| Surface | Finding | Verdict |
|---|---|---|
| **Ad-hoc logging** in the 4 OCR services (`console.*`, `logger`) | **Zero** `console`/logger call-sites in `ocr-worker`/`ocr-persistence`/`ocr-ingestion`/`ocr-review` `src/` | ✓ no ad-hoc log leak |
| **Observability events** (`toCoordinatorEvent` → worker stdout when `--log-outcomes`) | `observability.ts` §"No PII": events carry **only** `job_id`, counts (`statuses_persisted`), severity, outcome kind, and short error strings — **NOT** the submission payload or extracted OCR text | ✓ no text in events |
| **Extracted OCR text** flow | Engine → `OcrResult.raw_text` → `persistence.saveOcrResultOnce(job_id, r)` → the **local SQLite store** (intended). It never enters the observability event or the worker's output streams | ✓ persisted locally only |
| **Worker stdout/stderr** | Startup config summary (`worker_id`, `worker_kind`, `sqlite_path`, `fetcher_file_root` — deploy **config**, not document content), the observability event stream (ids + counts), and a JSON summary. **No document text.** Now **test-enforced** (see below) | ✓ no text in streams |
| **Temp input files** (engine) | `paddleocr-onnx.ts` writes the page bytes to a **private** temp: `mkdtemp` (dir `0o700`) + `writeFile` (`0o600`) under `os.tmpdir()`, removed in a **`finally`** (`rm` recursive+force on success / failure / throw) | ✓ private + always cleaned up |
| **Fetcher errors** (SSRF/TLS/DNS) | Surface **stable error codes** (`https_network_error`, `invalid_*`, …); the original error is preserved only via an **opt-in `cause`**, not emitted by default — so a source path/URL is not leaked in the public error | ✓ sanitized by default |
| **`describeError`** (cli.ts) | Returns `err.message` (the coordinator's own short, controlled error strings) or `JSON.stringify(err)` — it doesn't fabricate paths; the upstream messages are the no-PII strings above | ✓ controlled |
| **Failed OCR jobs** | A failure carries `OcrResult.partial_failure.{code,message}` (stable code + short message) — not raw extracted text | ✓ no raw text on failure |
| **Synthetic vs real fixtures** | The only OCR image fixtures are the **synthetic** `zh-02-court-heading.png` (authored `上海市浦东新区人民法院`, `tests/fixtures/README.md`) + the bakeoff synthetic set — clearly labelled, no client data | ✓ separated |
| **Committed OCR artifacts** | No tracked OCR **output** artifacts; `node_modules`/`dist` gitignored; engine temp lives under `os.tmpdir()` (outside the repo). Nothing OCR-generated is stageable | ✓ none committed |
| **`dev-memo/run/intake/`** | Gitignored (WI-13); **not inspected/touched** by this WI | ✓ untouched |

## Retention boundaries (what is intentionally kept, where)

- **Extracted OCR text** → the **local** case-box/OCR SQLite store (via `saveOcrResultOnce`). This is the intended
  local-first persistence; it is **not** a leak. It never leaves the machine and never reaches logs/CI/stdout.
- **Temp page images** (engine input) → ephemeral private temp under `os.tmpdir()`, deleted in `finally`. Never
  persisted, never committed.
- **Observability events / logs** → ids + counts + short error strings only. No document text, no payload.
- **Failure records** → stable code + short message, no raw text.

## Config-path disclosure (the one intentional path emission)

The worker's startup config summary (`cli.ts`, `ocr-worker startup: {...}`) writes **`sqlite_path`** and
**`fetcher_file_root`** to **stderr**, and a config error can echo `fetcher_file_root`. This is **intentional
operator visibility** (ADR-11C.3c: operators must see which worker/store the bin chose, so a misconfigured deploy
can't silently run the fake worker). These are **operator-chosen deploy configuration**, not values derived from
client documents, and no OCR text/payload accompanies them. **Caveat:** if an operator sets those config paths to
client-identifying locations (e.g. a matter-named directory), the path string would appear in the worker's stderr /
CI logs. Operators should keep OCR deploy-config paths non-identifying. A future enhancement could redact/relativize
these paths in the startup log if identifying deploy paths become a concern — **not** changed here (it is intended
visibility, and no leak of document content exists).

## What was added

- **Confidentiality regression** in `services/ocr-worker/tests/pipeline.real-engine.e2e.test.mjs`: after a real
  OCR run, assert the worker's **stdout + stderr contain no BMP CJK character** (`assert.doesNotMatch(..., /[一-鿿]/)`)
  — i.e. the extracted OCR text (which the same test confirms IS persisted) never reaches the output streams. Its
  failure message reports stream **lengths only** (redacted) so a real leak isn't amplified into the CI log. Runs
  under the WI-20 real-engine smoke (`OCR_WORKER_REAL_ENGINE_TESTS=1`); passes.
  - **Scope of this one test:** it pins the **highest-value** boundary — this synthetic fixture's CJK text not
    reaching the streams. It does **not** by itself prove the whole conclusion (it wouldn't catch ASCII/encoded
    text, or a config-path emission — those are covered by the design review above, not this regex). It is a
    tripwire against the most likely regression (OCR document text leaking into logs), not a total proof.
- This doc + the plan.

## No leak found — no product/data-model change

No sanitization fix was needed (the surfaces above are already sanitized). No data-model change, no removal of the
intended local persistence, no UI change, no accuracy work. The only code change is a test-only confidentiality
assertion that pins an existing boundary.

## References
- `services/ocr-worker/src/observability.ts` §"No PII" — the event contract.
- `services/ocr-worker/src/engines/paddleocr-onnx.ts` — private temp (`0o600`) + `finally` cleanup.
- `services/ocr-worker/src/fetcher/*` — stable error codes + opt-in `cause` (`.claude/rules/security-boundary.md`).
- `services/ocr-worker/tests/fixtures/README.md` — synthetic fixture provenance.
