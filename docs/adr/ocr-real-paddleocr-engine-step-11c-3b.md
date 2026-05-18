# ADR: Real OCR Worker — Real `@gutenye/ocr-node` Engine (Step 11C.3b)

## Status

Accepted. **Decision + code**. Fourth staged unit of the ADR-11C
sequence (mapper @ `2dd6a5c`, fetcher @ `ae1de3c` + `f6984be`,
adapter shape @ `c031b20` + `cc2a320`). Lands the real
`@gutenye/ocr-node` engine factory behind the `EnginePort` interface
introduced by ADR-11C.3a §2. The registry, adapter, fetcher, and
mapper stay structurally unchanged; this commit just produces a real
engine that 11C.3c's bin wiring can plug into the adapter's
`PaddleOcrOnnxAdapterDeps.engine` slot.

Companion code:
- `services/ocr-worker/src/engines/real-paddleocr-engine.ts` (new) —
  `makeRealPaddleEngine()` factory.
- `services/ocr-worker/package.json` — `@gutenye/ocr-node@1.4.8`
  enters production dependencies.

Out of scope (still): bin env wiring + cli/adapter migration to
consume `WORKER_REGISTRY` + real-fixture smoke. Those land in
11C.3c.

## Context

ADR-11C.3a defined the `EnginePort` interface — `detect(imagePath:
string) -> Promise<ReadonlyArray<EngineLine>>` — and pinned every
adapter behavior (hostile-engine boundary, metadata echo, sanitized
fetcher messages, monotonic duration, deep-frozen registry). The
adapter was wired with a stub engine because the real
`@gutenye/ocr-node` integration deserved its own decision unit:

- The package enters the **production** dependency graph for the
  first time. ADR-11B §4 was explicit that the bakeoff stays out of
  prod; this is the inverse — the bakeoff's measurement-time
  dependency is now also the worker's runtime dependency.
- Cold-load cost (~200ms in bakeoff observations) is paid once per
  worker-bin lifetime per ADR-11B §7. WHERE that cost lands (load()
  vs first detect()) is a real call.
- The package's `Ocr.create(options)` ⇒ `Promise<any>` (literal
  `any` in the d.ts at line 3); the version `1.4.8` type surface is
  thin. The wrapper has to assert the runtime shape against the
  EnginePort contract, not rely on TS narrowing.
- License attestation: MIT (confirmed at
  `node_modules/@gutenye/ocr-node/package.json` and re-confirmed
  by the bakeoff's ADR-11A.1 §"license").

User decisions already locked (this session):
- Engine cold-load failure → exit 2 (config fault). The bin owns
  the exit; the factory just throws.

## Decisions

### §1 `makeRealPaddleEngine()` factory shape

`services/ocr-worker/src/engines/real-paddleocr-engine.ts`:

```ts
import type { EnginePort } from "./paddleocr-onnx.js";

export interface RealPaddleEngine {
  readonly engine: EnginePort;
  readonly version: string; // `<engine-pkg>+<model-set>@<models-pkg>`
}

// No options for v1 (audit 019e3a4c D2 fix): the model-set is
// pinned to the @gutenye/ocr-models defaults. When override use
// cases land, options MUST require a validated model-root +
// digest, not raw paths.
export function makeRealPaddleEngine(): Promise<RealPaddleEngine>;
```

The factory returns BOTH the engine and the version string in one
shot. Pairing them avoids two separate calls in 11C.3c's bin
construction and keeps the version-derivation logic with the
package it pins.

`engine.detect(path)` is a thin wrapper that calls `ocr.detect(path)`
and asserts the runtime return shape against the EnginePort
contract:

- `Array.isArray(returned)` — throws `TypeError` if not.
- For each element: `typeof line === "object"` and
  `typeof line.text === "string"`.

The factory enforces this at its own seam because it publicly
re-exports an `EnginePort`-typed return: a direct consumer of the
factory (not just the adapter) must get the type-level guarantee
the interface promises. The adapter's own `sanitizeEngineLines`
(ADR-11C.3a §6) re-checks the same invariants — intentional
defense-in-depth (audit 019e3a4c D4 fix). The cost is one
`Array.isArray` + one `typeof` per line, far cheaper than the OCR
call itself.

### §2 Cold load runs INSIDE the factory (paid once per bin)

`Ocr.create()` is the expensive step (~200ms in bakeoff
observations against `@gutenye/ocr-node@1.4.8` + the bundled
`ch_PP-OCRv4` models). Two valid placements:

A. **Cold load inside `makeRealPaddleEngine`**. Failure surfaces at
   bin startup → exit 2 (config fault) per the user decision.
B. Lazy cold load on first `detect()` call. Failure surfaces
   mid-first-job → per-job `engine_failed`. Subsequent jobs reuse
   the loaded session.

**CHOSEN: A.** Three reasons:

1. **Fail-closed config sequence (ADR-11A.0 §10)**. Cold-load
   failure is a config-shaped problem — missing ONNX models,
   incompatible runtime, OS-level dynamic-library issues. It MUST
   surface at startup, not mid-job, so a failing deploy is caught
   by a smoke probe rather than absorbed by the queue's retry
   logic.
2. **ADR-11B §7 pinned cold load as "paid once per bin lifetime"**.
   Doing it inside the factory makes that promise observable.
3. **The bin's exit-2 contract** depends on the engine refusing to
   construct before the job loop starts. Lazy load would force the
   bin to either re-classify mid-job throws OR pre-warm with a
   dummy detect call — both worse than just loading up front.

### §3 Engine version string

Format: `<engine-pkg>+<model-set>@<models-pkg>` — extended over the
plain `<pkg>+<model-set>` of ADR-11A.5 per audit 019e3a4c D8 fix:
the bundled model bytes come from a SEPARATE transitive package
(`@gutenye/ocr-models`), and recording only the engine wrapper
version would let two runs with different inference outputs (because
the model was swapped under the wrapper) report identical
`engine.version` strings. Provenance demands both halves.

Hardcoded constants in `real-paddleocr-engine.ts`:
- `ENGINE_PKG_VERSION = "1.4.8"`
- `MODELS_PKG_VERSION = "1.4.2"`
- `DEFAULT_MODEL_SET = "ch_PP-OCRv4"`

Why hardcoded (NOT static JSON import): `@gutenye/ocr-node`'s
`exports` field does not expose `./package.json` as a subpath, so
neither `import pkg from "@gutenye/ocr-node/package.json"` nor
`createRequire(...).resolve("@gutenye/ocr-node/package.json")` is
portable. The same restriction applies to `@gutenye/ocr-models`.
Two drift tests in
`tests/engines.real-paddleocr-engine.test.mjs` read each installed
manifest from disk and assert equality, so an upgrade that bumps
either dep but forgets to bump the constant fails fast at test
time with an actionable error message.

Result for v1 default deployment: `1.4.8+ch_PP-OCRv4@1.4.2`.

No public override surface for the model set in v1 (audit 019e3a4c
D2 fix): the `options.models` field was removed entirely. When an
override use case lands, overrides MUST flow through an allowlist +
digest check rather than raw caller-supplied paths.

### §4 No registry change

`WORKER_REGISTRY["paddleocr-onnx"].load` keeps the type-guard +
inject-deps signature from ADR-11C.3a §6. 11C.3b does NOT shift it
to a no-arg form. The reason: the registry entry's `load()` cannot
construct `FetcherDeps` without reading `OCR_FETCHER_FILE_ROOT`
from the environment, and env reads are the bin's concern (11C.3c).

11C.3c will:
1. Read `OCR_FETCHER_FILE_ROOT` (exit 2 if unset / not absolute).
2. Call `makeRealPaddleEngine()` (exit 2 on cold-load throw).
3. Call `WORKER_REGISTRY["paddleocr-onnx"].load({ fetcher: { allowedFileRoot: root }, engine, engineVersion })`.

11C.3b just provides step 2's building block.

### §5 No dynamic dispatch on `Ocr` return type

The `@gutenye/ocr-node` d.ts has `static create(options?):
Promise<any>`. The factory uses the runtime instance through a
narrow internal interface:

```ts
interface OcrInstance {
  detect(image: string): Promise<unknown>;
}
```

…and the wrapper's `detect` asserts the per-call return shape. We
do NOT add a runtime-shape assertion of the `Ocr` instance itself
beyond `typeof instance.detect === "function"` — anything else
(missing internals, broken model session) surfaces at the first
`detect()` call as an engine throw, which the adapter already maps
to `engine_failed`.

### §6 License + supply chain

`@gutenye/ocr-node@1.4.8` is MIT-licensed
(`node_modules/@gutenye/ocr-node/package.json#license`). Transitive
production deps (also reaching `services/ocr-worker` via this
addition): `@gutenye/ocr-common`, `@gutenye/ocr-models`,
`onnxruntime-node@^1.17.3-rev.1`, `sharp@^0.33.3`. All MIT or
Apache-2.0 per their own package.json.

The `onnxruntime-node` and `sharp` packages ship native binaries
(`.node` files). The bakeoff already exercises these against the
darwin-arm64 + linux-x64 prebuilts; v1 deployment targets the same
platforms.

### §7 Out of scope (deferred to 11C.3c)

- Bin env wiring (`OCR_WORKER`, `OCR_FETCHER_FILE_ROOT`).
- `cli.ts` / `adapter.ts` migration to consume `WORKER_REGISTRY`
  (still call the fake worker directly today).
- Real-fixture smoke against bakeoff's `zh-02..zh-06` PNGs.
- Configurable model-set selection via env.
- `OCR_DEBUG_OUTPUT_DIR` for the engine's `isDebug` mode.

## Consequences

- `services/ocr-worker/package.json` gains
  `@gutenye/ocr-node@^1.4.8` under `dependencies`. The package's
  transitive deps (`@gutenye/ocr-common`, `@gutenye/ocr-models`,
  `onnxruntime-node`, `sharp`) enter the worker's installed graph.
  Install footprint grows by ~70 MB (ONNX models + sharp native +
  onnxruntime-node binary).
- The worker bin in 11C.3c can construct a real engine with one
  `await makeRealPaddleEngine()` call.
- Test suite gains an OPT-IN real-engine smoke (default off; flag
  `OCR_WORKER_REAL_ENGINE_TESTS=1`) so CI doesn't pay the ~200ms
  cold load + ~130ms detect per case unless explicitly asked.
- 11C.3c inherits a closed engine factory; the only remaining work
  is env reads + adapter-deps construction + smoke.

## Open questions (for 11C.3c)

- Q1 (11C.3c): exit-code mapping for engine cold-load failure paths
  — `Ocr.create()` can throw for missing model files, ONNX runtime
  init errors, native-binary loading errors. The bin maps all of
  them to exit 2 (config fault), correct? Provisional answer: yes.
- Q2 (11C.3c): how does the bin distinguish "engine cold-load
  failure" from "engine detect throw" when both can carry the same
  error class? Provisional: cold load happens before the loop;
  detect happens inside it. The bin guards by location in the
  code, not by error type.

## Rejected alternatives

- **Lazy cold load**. Deferred — explained §2.
- **Run cold load in the registry's `load()`**. Would require the
  registry to read env / hold a constructed engine. Mixes
  concerns; the registry's job is routing, not configuration.
- **Pre-warm the engine with a dummy detect at startup**. Trades a
  cleaner config-vs-runtime split for an extra ~130ms of startup
  cost with no clear win.
- **Bundle the ONNX models in the worker package directly** —
  wasted disk; `@gutenye/ocr-models` is already a transitive dep
  with its own update cadence.
- **Add a runtime shape assertion on the `Ocr` instance itself**.
  Premature; the adapter's per-call `sanitizeEngineLines` already
  catches every reachable bad shape.
- **Expose `OCR_DEBUG_OUTPUT_DIR` in 11C.3b**. Mixes
  observability work into a dep-introduction step. Defer.
