# ADR: Real OCR Worker — Bin Wiring + Real-Engine E2E (Step 11C.3c)

## Status

Accepted. **Decision + code**. Fifth and final staged unit of the
ADR-11C sequence (mapper @ `2dd6a5c`, fetcher @ `ae1de3c`, N=1 cap @
`854abf8`, adapter @ `c031b20`, real engine @ `2e74129`). Wires the
worker bin to consume `WORKER_REGISTRY`, reads the new env vars,
maps engine cold-load failure to exit 2, and lands an opt-in
end-to-end smoke that runs a real Chinese PNG through the FULL
pipeline (ingestion → queue → worker bin → real engine → mapper →
persistence).

This commit makes the system **usable for real OCR**: a deployer
who sets `OCR_WORKER=paddleocr-onnx` + `OCR_FETCHER_FILE_ROOT=/path`
gets a worker that recognizes text in legal-document scans.

Companion code:
- `services/ocr-worker/src/config.ts` — two new env vars.
- `services/ocr-worker/src/cli.ts` — buildDefaultDeps consumes
  WORKER_REGISTRY.
- New test files for config + cli + opt-in E2E.

## Context

ADR-11C.3a wired the registry + adapter shape. ADR-11C.3b added the
real engine factory. Neither commit MIGRATED the bin away from its
ad-hoc `processFakeOcrJob` direct import at `cli.ts:241-247` — that's
this commit. The migration unblocks:

- `OCR_WORKER=paddleocr-onnx` routing in production.
- Engine cold-load failures surfacing as exit 2 (config fault) per
  ADR-11A.0 §10.
- The fetcher's `OCR_FETCHER_FILE_ROOT` env read (ADR-11C.2 §3
  deferred to the bin layer).

User decisions captured this session:
- All four open: staged delivery, synthetic zh-* PNG smoke, exit 2
  on cold-load failure, all per-job fetcher errors → terminal
  failed (provisional; matches what 11C.3a wired).

## Decisions

### §1 New env vars + config fields

`services/ocr-worker/src/config.ts`:

| Env var | CLI flag | Type | Default | Required when |
|---|---|---|---|---|
| `OCR_WORKER` | `--worker` | `"fake" \| "paddleocr-onnx"` | `"fake"` | — |
| `OCR_FETCHER_FILE_ROOT` | `--fetcher-file-root` | absolute path string | `undefined` | `OCR_WORKER=paddleocr-onnx` |

`worker_kind` defaults to `"fake"` (audit trail: §6 §3-Rejected).
The choice preserves backward compatibility for the 200+ existing
worker tests that don't set the env; production deployers MUST set
`OCR_WORKER=paddleocr-onnx` explicitly. Fail-loud configuration:
forgetting the env in prod silently runs the fake worker, which is
operator error — same class as forgetting any other env. The bin
emits the chosen worker key in its stderr config-log line so
operators see what they got.

`fetcher_file_root`:
- Required when `worker_kind === "paddleocr-onnx"`.
- Must be an ABSOLUTE path (cross-validated in config parse).
- Forwarded verbatim to `FetcherDeps.allowedFileRoot`; the fetcher
  itself does the deeper realpath / mkdtemp-free containment.
- Unset for `worker_kind === "fake"` (the fake worker doesn't
  fetch; supplying a root is allowed but ignored — no warning).

### §2 `buildDefaultDeps` consumes WORKER_REGISTRY

`services/ocr-worker/src/cli.ts`:

Previous:
```ts
const defaultFakeWorker: OcrWorker = {
  async process(job) { return processFakeOcrJob(...); }
};
async function buildDefaultDeps(config) {
  const worker = defaultFakeWorker;
  // ... persistence + queue construction
}
```

New:
```ts
async function buildDefaultDeps(config) {
  const worker = await constructWorker(config);
  // ... persistence + queue construction (unchanged)
}

async function constructWorker(config): Promise<OcrWorker> {
  switch (config.worker_kind) {
    case "fake":
      return WORKER_REGISTRY.fake.load();
    case "paddleocr-onnx": {
      // Cold load runs HERE — at startup, BEFORE the job loop, so
      // failure surfaces as exit 2 per ADR-11A.0 §10.
      const { engine, version } = await makeRealPaddleEngine();
      return WORKER_REGISTRY["paddleocr-onnx"].load({
        fetcher: { allowedFileRoot: config.fetcher_file_root! },
        engine,
        engineVersion: version,
      });
    }
  }
}
```

The cold-load + factory call sit inside the buildDefaultDeps path
already wired for exit-2 mapping in the existing cli.ts:
`OcrWorkerConfigError` and any throw from buildDeps maps to exit 2
at the caller. We just propagate.

### §3 Engine cold-load failure → exit 2

`makeRealPaddleEngine()` can throw for:
- Missing ONNX model files (corrupted install).
- ONNX runtime initialization errors (incompatible native binary,
  unsupported CPU).
- `Ocr.create()` returning unexpected shape (guarded in 11C.3b).

Any of these throw before the bin enters the job loop. The
existing cli.ts:`runOcrWorkerProcess` already catches throws from
buildDeps and maps to exit 2. No new code needed; the wiring just
flows through that existing path.

Per-job engine failures (after cold load) map to terminal `failed`
outcomes via the adapter (ADR-11C.3a §3 + audit fix), NOT exit 2.
This is the cold-load-vs-runtime split.

### §4 `adapter.ts` stays as test infrastructure

`OcrJobAdapter` (services/ocr-worker/src/adapter.ts) has its own
`defaultFakeWorker` built from `processFakeOcrJob`. That adapter is
test infra (it doesn't run in production; the bin owns lifecycle).
11C.3c migrates only the BIN (cli.ts). adapter.ts keeps its direct
fake-worker import to avoid pulling the registry's transitive
imports into every test that constructs an OcrJobAdapter.

If a future ADR wires a real worker into OcrJobAdapter's default
path, that's a separate migration.

### §5 Bin help text and config-log line

`runOcrWorkerProcess` already prints a one-line JSON-ish config
summary to stderr on startup. New fields added:
- `worker_kind`
- `fetcher_file_root` (or `null` for fake)

Help text gains `--worker` + `--fetcher-file-root` entries with the
env-var aliases and the required-when condition.

### §6 Opt-in end-to-end smoke

New test file
`services/ocr-worker/tests/pipeline.real-engine.e2e.test.mjs`:

Behind `OCR_WORKER_REAL_ENGINE_TESTS=1` (matches 11C.3b's flag).
Default-off because cold-load (~200ms) + detect (~150ms) per case
is too much for every test run; opt-in keeps CI default-fast.

Smoke flow (one test):
1. `mkdtemp` a temp file root.
2. Copy bakeoff's `zh-02-court-heading.png` into the root.
3. Build a contract-valid `OcrSubmission` with
   `source.kind = "file"`, `source.path = "zh-02-court-heading.png"`.
4. `createOcrJob` + `enqueueOcrJob` into in-memory persistence +
   queue.
5. Spawn the bin process with:
   - `OCR_WORKER=paddleocr-onnx`
   - `OCR_FETCHER_FILE_ROOT=<temp root>`
   - `OCR_WORKER_MAX_ITERATIONS=1`
   - `OCR_WORKER_IDLE_DELAY_MS=0`
6. Wait for the bin to drain the single job and exit 0.
7. Read the persisted `OcrResult`:
   - `status === "succeeded"`
   - `raw_text` contains at least one BMP CJK character
   - `engine.name === "paddleocr-onnx"`
   - `engine.version` matches `<engine-pkg>+ch_PP-OCRv4@<models-pkg>`
   - `metadata` round-tripped from the submission

Cost when enabled: cold load + 1 detect ≈ ~400ms + bin spawn
overhead. Acceptable per-test when opted in.

The smoke also acts as the FIRST end-to-end check that the bin
wiring works: bin env reads, registry routing, engine cold load,
fetcher path resolution, adapter assembly, mapper projection,
persistence write. If any seam fails, this test catches it.

### §7 Out of scope (closes 11C; future work)

- **`OCR_DEBUG_OUTPUT_DIR`** for engine isDebug mode — separate
  observability ADR.
- **Configurable model-set selection via env** — needs allowlist +
  digest design (ADR-11C.3b audit D2 fix deferred to v2).
- **`OcrJobAdapter` default migration to registry** — see §4.
- **`s3 | https | inline` source-kind admission** — separate fetcher
  ADR; current state is "fetcher rejects with stable code".
- **Multi-page submission lift** — separate ADR; current state is
  `multi_page_unsupported` reject at ingestion.
- **Page geometry (width/height/dpi) in mapper output** — separate
  image-decoding ADR.
- **Coordinator-side retry classification for `engine_failed`** —
  separate retry-policy ADR.

## Consequences

- Operators get a one-env-set deploy: `OCR_WORKER=paddleocr-onnx` +
  `OCR_FETCHER_FILE_ROOT=/var/ocr/incoming` runs real OCR.
- The system is **functionally complete for v1**: a legal document
  page placed in the fetcher root becomes a persisted, mapper-projected
  OcrResult with CJK text.
- 11C sequence closes. Next major step is 11D / something else —
  not this branch.

## Open questions (none v1-blocking; tracked for future)

- Q1: telemetry seam — adapter currently has a TODO for routing
  cleanup errors + sanitized fetcher diagnostic to an operator-log
  channel. Pinned in 11C.3a comments; needs an observability ADR.
- Q2: model-set override design (allowlist + digest). Driven by
  multi-tenant or specialized-model use cases.
- Q3: bin readiness-protocol (the SIGINT spawn-test would un-flake
  if the bin emitted a "READY" marker; same flaky test fix path).

## Rejected alternatives

- **Default `OCR_WORKER` to `paddleocr-onnx`** — would break every
  existing worker test that doesn't set the env. Fake is the safe
  back-compat default; prod deployers set it explicitly.
- **Require `OCR_FETCHER_FILE_ROOT` even for fake** — the fake
  worker doesn't fetch. Forcing an unused env adds confusion.
- **Lazy cold load in cli.ts (on first job)** — already rejected in
  ADR-11C.3b §2. Cold load happens in `buildDefaultDeps` so
  failure surfaces as exit 2.
- **Migrate `OcrJobAdapter`'s default worker to the registry** —
  see §4. Pulls the registry's transitive imports into every test
  that constructs an OcrJobAdapter; not worth the symmetry win.
- **Embed the E2E smoke in the default CI run** — pays ~400ms per
  test; better behind the opt-in flag that 11C.3b established.
  When CI gains real-engine deploy targets, flip the flag in CI
  config, not in the test file.
