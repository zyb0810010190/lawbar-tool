# ADR: Real OCR Worker — Engine Adapter + Registry Shape (Step 11C.3a)

## Status

Accepted. **Decision + code**. Third staged unit of the ADR-11C
sequence (mapper @ `2dd6a5c`, fetcher @ `ae1de3c` + `f6984be`). Pins
the `WORKER_REGISTRY` static map (ADR-11B §1 deferred until now) and
lands the production `paddleocr-onnx` adapter SHAPE, integrating
fetcher (ADR-11C.2) + mapper (ADR-11C.1) into one job-processing
function. The real `@gutenye/ocr-node` integration is **stubbed**
via an injected `EnginePort` interface; 11C.3b swaps the real engine
in and adds the dep to the production graph; 11C.3c does the bin
env wiring + smoke.

Companion code:
- `services/ocr-worker/src/registry.ts` (new) — typed static map.
- `services/ocr-worker/src/engines/paddleocr-onnx.ts` (new) —
  adapter, EnginePort interface, fetcher-error mapping.
- `services/ocr-worker/src/index.ts` — re-export registry + adapter
  public surface.

## Context

ADR-11B §1 designed `WORKER_REGISTRY` but landed no code. The fake
worker is still wired ad-hoc in `cli.ts:241-247` and `adapter.ts:55-60`
via direct `processFakeOcrJob` imports. 11C.1 added the mapper,
11C.2 added the fetcher; neither integrated them. This is where the
two halves come together.

The engine itself takes a path, not a buffer (`@gutenye/ocr-node`
`Detection.run(path)` calls `ImageRaw.open(path)` internally). The
fetcher returns bytes after validation. The adapter therefore needs
a bytes-to-path bridge for the engine call.

User decisions captured this session:
1. **Stage delivery** → 11C.3a (this) / 11C.3b (real engine) / 11C.3c (bin wiring + smoke).
2. **Engine cold-load exit code** → `2` (config fault), matches
   ADR-11A.0 §10 fail-closed pattern.
3. **Fetcher-error → outcome mapping** → all per-job fetcher errors
   become terminal `failed` results. `file_root_unconfigured` is the
   only exception: it bubbles past the adapter to the bin (exit 2).

## Decisions

### §1 `WORKER_REGISTRY` lands as a typed static map (ADR-11B §1)

`services/ocr-worker/src/registry.ts`:

```ts
export type WorkerKey = "fake" | "paddleocr-onnx";

export interface WorkerEntry {
  readonly name: WorkerKey;
  readonly load: (deps?: unknown) => Promise<OcrWorker>;
}

export const WORKER_REGISTRY: Readonly<Record<WorkerKey, WorkerEntry>>
  = Object.freeze({
    fake: { name: "fake", load: makeFakeWorker },
    "paddleocr-onnx": { name: "paddleocr-onnx", load: makePaddleOcrOnnxWorker },
  });
```

Frozen at runtime (same defense as `INGESTION_ERROR_CODES` and
`FETCHER_ERROR_CODES`). `WorkerKey` is a closed discriminated union;
the bin (11C.3c) parses caller input against this exact set and
fails closed on unknown values, never reaching the registry with a
caller-supplied string.

11C.3a does NOT migrate `cli.ts` / `adapter.ts` away from their
ad-hoc fake-worker construction. That migration is bin-shaped and
belongs to 11C.3c. The registry is added as a new public surface;
existing consumers stay unchanged until 11C.3c.

### §2 `EnginePort` interface — the engine seam

`services/ocr-worker/src/engines/paddleocr-onnx.ts`:

```ts
export interface EnginePort {
  /**
   * Inference on a PNG/JPEG image at the given path. Returns the
   * recognized lines in engine-output order. Implementations MAY
   * return [] for an image with no recognizable text (the mapper
   * treats that as a succeeded result with empty blocks).
   *
   * Path-only (not Buffer): mirrors @gutenye/ocr-node `Ocr.detect`
   * which uses `ImageRaw.open(path)` internally.
   */
  detect(imagePath: string): Promise<ReadonlyArray<EngineLine>>;
}
```

The adapter takes `EnginePort` via deps injection. Tests stub it.
11C.3b lands `makeRealPaddleEngine()` that wraps `Ocr.create()` +
`Ocr.detect()`. The interface is engine-agnostic on purpose: a
future swap to a different ONNX or Tesseract backend touches only
the factory, not the adapter.

### §3 Adapter contract

`processPaddleOcrOnnxJob(job, deps) -> Promise<OcrJobOutcome>`:

```ts
export interface PaddleOcrOnnxAdapterDeps {
  readonly fetcher: FetcherDeps;
  readonly engine: EnginePort;
  /**
   * Wall clock for TransitionRecord.at + OcrResult.completed_at.
   * Default: `() => new Date()`.
   *
   * NOTE (audit 019e3a2e D3 Medium): NOT used for
   * `processing_duration_ms`. Duration uses `performance.now()` so a
   * wall-clock backward adjustment cannot produce a negative duration.
   */
  readonly now?: () => Date;
  /**
   * Engine version string for `OcrResult.engine.version`. Format
   * `<pkg-version>+<model-set>` per ADR-11A.5. Required — the
   * registry's no-arg `load()` form rejects missing / empty values
   * with a real type guard rather than a cast.
   */
  readonly engineVersion: string;
}
```

Job-processing flow:

1. **Status-chain start**: emit `queued→claimed` (queue) and
   `claimed→processing` (worker) edges into the outcome's
   `statuses[]`. Same shape as the fake worker for coordinator
   compatibility.
2. **Fetch**: `await fetchPageBytes(job.submission, deps.fetcher)`.
   - On `FetcherError` with code `file_root_unconfigured`:
     **re-throw**. This is a config fault that the bin must surface
     as exit 2; it must NOT be swallowed by a per-job `failed`
     outcome.
   - On any other `FetcherError`: assemble a **failed** outcome
     (§4 below).
3. **Bridge**: write the validated bytes to a private temp path
   (`fs.mkdtemp` under `os.tmpdir()`). Pass that path to the engine.
   See §5 for why bytes→temp→engine rather than fetcher→engine.
4. **Engine call**: `lines = await deps.engine.detect(tempPath)`.
   - On engine throw: assemble a failed outcome with code
     `engine_failed` and the engine's message; same per-job
     terminal as fetcher errors.
5. **Cleanup**: delete the temp file. Run in a `finally` so the
   temp persists past neither success nor failure.
6. **Map**: call `mapEngineLinesToOcrResult` with the engine lines
   + job metadata + timing + (best-effort) page geometry. Produces a
   `succeeded` OcrResult.
7. **Status-chain end**: append `processing→succeeded` (or
   `processing→failed` on fail path) to `statuses[]`.
8. **Return**: `{ job_id, statuses, results: [result],
   terminal_state }` where `terminal_state` matches the final
   transition.

### §4 Fetcher-error → failed-OcrResult mapping

When the fetcher throws `FetcherError` (excluding
`file_root_unconfigured`), the adapter produces a failed
`OcrResult` per the schema's `failed → partial_failure` `allOf`
clause:

```ts
{
  contract_version: submission.contract_version,
  job_id, tenant_id, document_id, page_id, page_number,
  status: "failed",
  engine: { name: "paddleocr-onnx", version: deps.engineVersion },
  page_metrics: { processing_duration_ms: <wall-time> },
  partial_failure: {
    code: err.code,                  // stable fetcher code
    message: err.message,            // human, may include path (op-log)
    is_transient: false,             // all v1 fetcher errors permanent
    attempted_count: 1,              // first attempt; coordinator may bump
  },
  metadata: {},
  completed_at: <ISO>,
}
```

`is_transient: false` for every v1 fetcher code per the user
decision (no async-upload pattern exists yet). When that pattern
lands, the mapping for `file_not_found` would flip to `true`
behind a separate ADR amendment.

`partial_failure.code` carries the EXACT fetcher code
(`source_kind_unsupported`, `path_escape`, `size_mismatch`,
`mime_signature_mismatch`, etc.). Coordinators and reviewers can
branch on these without parsing message text.

`engine_failed` is a NEW code raised only by the adapter for
engine-throw cases (not in `FETCHER_ERROR_CODES`). Defined inline
in the adapter to avoid polluting the fetcher's stable surface.

### §5 Bytes → temp file → engine path

The engine takes a path. The fetcher returns bytes (validated). Two
boundary choices:

A. **Adapter writes a private temp file** with the validated bytes,
   passes that path to the engine, deletes after. **CHOSEN.**
B. Fetcher exposes the source `realPath`; adapter passes it
   directly to the engine. Rejected.

Why (A):
- The unit of validation is bytes (size, magic-byte signature). The
  engine reads the EXACT bytes the fetcher validated; no second
  TOCTOU window between fetcher and engine.
- Fetcher's `realPath` stays internal to the fetcher. Engine has no
  knowledge of the source-file structure.
- Temp file is in `os.tmpdir()` (worker-owned) with `mkdtemp`'s
  randomized suffix; no path-collision risk.

Cost: one async `writeFile` (≤ 50 MB, mode `0o600` per ADR-11A.0 §7)
+ one async `rm` per job. Under the v1 throughput envelope (N=1
single-page jobs, sub-second engine detect), negligible.

Cleanup invariant: the temp file is deleted in a `finally` that runs
regardless of fetcher / engine / mapper outcome. Test pins it.

### §6 Wiring `WORKER_REGISTRY["paddleocr-onnx"].load` for 11C.3a

The registry's `load()` for `paddleocr-onnx` cannot construct a real
engine yet (that's 11C.3b). Two viable shapes for 11C.3a:

A. `load` throws `engine_not_yet_wired` with exit-code-2 semantics.
   Anyone reaching for `paddleocr-onnx` in 11C.3a gets a clear error.
B. `load` accepts an injected `EnginePort` via deps so tests can
   exercise it. Production wiring lands in 11C.3b.

**CHOSEN: B.** The factory takes `PaddleOcrOnnxAdapterDeps` as an
arg. Tests pass a stub engine; the registry entry exposes the
SHAPE. 11C.3b lands a no-arg factory that constructs the real
engine (and `WORKER_REGISTRY["paddleocr-onnx"].load` switches to
the no-arg form).

For 11C.3a, the registry entry's `load` is therefore a thin wrapper
that ALWAYS throws "not yet wired — pass deps via
`makePaddleOcrOnnxWorker` directly" if called without args. This
keeps the public registry shape correct while making the un-wired
state observable. The adapter tests bypass the registry and call
`makePaddleOcrOnnxWorker(deps)` directly.

### §7 Out of scope (deferred)

- **Real `Ocr.create()` + `Ocr.detect()` integration** — 11C.3b.
  Includes adding `@gutenye/ocr-node` to `services/ocr-worker`
  production dependencies (currently only in `ocr-worker-bakeoff`).
- **Bin env wiring** — 11C.3c. `OCR_WORKER` env (which key from
  registry) + `OCR_FETCHER_FILE_ROOT` env (fetcher root).
- **Real-fixture smoke** — 11C.3c. Bakeoff's `zh-02..zh-06` PNGs
  copied into a worker-test fixtures dir; one end-to-end test from
  ingestion submission through worker bin to persisted result.
- **Engine cold-load failure exit-code propagation** — 11C.3c. The
  EXIT 2 decision is pinned here; the BIN PLUMBING that turns a
  thrown engine-load error into exit 2 belongs to the bin wiring.
- **Page geometry (width/height/dpi)** — 11C.3b/c. The mapper accepts
  `MapperPageGeometry` but the adapter has no source for it without
  decoding the image. `image-size` or similar can land later;
  v1 mapping passes geometry `{}`.

## Consequences

- New `WORKER_REGISTRY` public surface. Frozen registry; adding a
  new engine key is a coordinated change (worker `WorkerKey` union
  + bin env parsing + tests).
- New `EnginePort` interface. Engine swaps touch only the factory.
- New stable error code `engine_failed` exposed by the adapter's
  failed outcomes. Documented in the adapter file; not part of
  `FETCHER_ERROR_CODES`.
- 11C.3b inherits a complete adapter contract: it only swaps the
  stub EnginePort for a real one.
- 11C.3c inherits a registry that's ready for `OCR_WORKER` env
  routing.

## Open questions (for 11C.3b / 11C.3c)

- Q1 (11C.3b): `Ocr.create()` cost — paid once per worker bin
  lifetime per ADR-11B §7. Where exactly does that happen — in the
  registry's `load`, or lazily on first `detect`? Provisional
  answer: in `load`, so cold-load failures surface at bin startup
  (exit 2), not mid-first-job.
- Q2 (11C.3b): `engine.version` string assembly — `<pkg-version>+<model-set>`.
  Pkg-version from `@gutenye/ocr-node`'s `package.json`; model-set
  from the bundled ONNX path or `rapidocr-<lang>`. Concrete value
  decided when the real factory lands.
- Q3 (11C.3c): how does `OCR_FETCHER_FILE_ROOT` interact with
  multi-worker deployments? Same root for every worker bin per
  host? Different roots per tenant? v1 answer: one root per bin.

## Rejected alternatives

- **Migrate `cli.ts` + `adapter.ts` to consume the registry now** —
  would conflate the adapter-shape work with bin migration. 11C.3c
  is the natural seam.
- **Make `paddleocr-onnx` registry entry a hard error in 11C.3a** —
  tests need to exercise the adapter SHAPE. Throwing on `load()`
  without deps but accepting deps directly via
  `makePaddleOcrOnnxWorker` keeps the SHAPE testable and the
  un-wired state explicit.
- **Pass fetcher `realPath` to the engine** — leaks fetcher
  internals; loses byte-level integrity guarantee (engine reads
  whatever is at the path, not what the fetcher validated).
- **In-memory engine bridge (Buffer-only)** — would require
  patching `@gutenye/ocr-node` or wrapping with a custom
  `ImageRaw.openBuffer` shim. Temp-file bridge is simpler and the
  performance cost is irrelevant under v1 throughput.
- **Single failed-OcrResult code for all fetcher errors
  (`fetch_failed`)** — loses the stable code surface the fetcher
  spent §7 establishing. Passing through the exact code makes the
  failed outcome diagnosable.
