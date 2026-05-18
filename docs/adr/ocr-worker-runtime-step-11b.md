# ADR: Real OCR Worker — Runtime / Transport (Step 11B)

## Status

Accepted. **Decision-only**. Pins the `WORKER_REGISTRY` shape, the
in-process vs sidecar choice, the lease-renewal trigger (and why it's
not needed for v1), the engine-dependency graph, and the audit-log
destination. No code lands in this step. The ADR-11C implementation
commit consumes these decisions.

## Context

ADR-11A.0 §11 deferred engine-selection mechanism to ADR-11B with a
specific shape constraint (typed static map, no caller-string
`import(name)`). ADR-11A.1 v0.1 named **δ PaddleOCR-via-ONNX-Node**
(`@gutenye/ocr-node@1.4.8`) as the provisional default. δ is an
**in-process Node** engine — `Ocr.create()` loads ONNX models into
the current process; `ocr.detect()` runs inference synchronously
against those loaded sessions. This makes 11B's runtime shape
materially simpler than the brainstorm anticipated: no sidecar, no
Unix-socket protocol, no separate interpreter or venv to provision,
no temp-file handoff between processes.

`dev-memo/real-ocr-worker-brainstorm.md` lines 73-93 sketched a
registry over a discriminated union of engine keys; 11B finalizes
that shape and its dependency-graph constraints.

## Decisions

### §1 `WORKER_REGISTRY` — typed static map; no caller-string imports

`services/ocr-worker/src/registry.ts` (new file, ADR-11C lands the code):

```ts
import type { OcrWorker } from "./types.js";

export type WorkerKey = "fake" | "paddleocr-onnx";

export interface WorkerEntry {
  /** Human-readable name for diagnostics. */
  readonly name: WorkerKey;
  /**
   * Async factory. Throws on engine-package missing (ERR_MODULE_NOT_FOUND
   * with anchored regex match per ADR-11A.0 §11). Returns an `OcrWorker`
   * the coordinator can call. The factory MUST NOT cache the worker
   * itself; the bin owns lifecycle via `buildDeps`.
   */
  readonly load: () => Promise<OcrWorker>;
}

export const WORKER_REGISTRY: Readonly<Record<WorkerKey, WorkerEntry>> = {
  fake: { name: "fake", load: makeFakeWorker },
  "paddleocr-onnx": { name: "paddleocr-onnx", load: makePaddleOcrOnnxWorker },
};
```

Constraints:

- **Static map, not dynamic.** Keys are a closed `WorkerKey` discriminated
  union. The registry MUST NOT accept caller-supplied strings; the CLI
  flag parser validates the input is a `WorkerKey` before lookup.
- **`load()` is async** so engine packages can be dynamically imported
  inside it. Engine packages are NOT eagerly imported at registry
  module load (that would force every operator to install every engine
  package).
- **Adding an engine = adding a `WorkerEntry` to the map + writing the
  `make...Worker` factory.** No reflection, no plugin discovery.

### §2 In-process runtime (δ) — no sidecar

δ PaddleOCR-via-ONNX-Node runs **in-process** in the worker bin's Node
runtime. Rationale:

- ONNX Runtime via `onnxruntime-node` is a Node-native dep. Loading
  models inside the worker process is the canonical use.
- The bakeoff harness (`services/ocr-worker-bakeoff/`) spawns a
  subprocess for RSS isolation across candidates. That's a
  *measurement* concern, NOT a production runtime concern. Production
  wants one engine; one process; one cold model load amortized across
  many pages.
- No sidecar = no Unix socket protocol; no temp-file handoff; no
  interpreter/venv provisioning; no separate shutdown signal path.

Consequences:
- The production worker holds the loaded ONNX sessions for the
  lifetime of the bin process. Re-loading on every claim would be
  wasteful and would force per-page cold-load cost.
- Worker memory grows by the resident model size (~280 MB per the
  ADR-11A.1 v0.1 measurements) and stays there. Operators must size
  worker hosts accordingly.
- A worker holding loaded models is a **warm** worker between pages.
  ADR-11A.5 v0.1 acknowledged warm-mode is currently absent from the
  production seam (`supported_run_kinds: ["cold"]` in the bakeoff
  harness). The production OcrWorker contract doesn't have an explicit
  cold/warm distinction; the worker simply reuses its loaded models
  across `process(job)` invocations.

### §3 Lease-renewal trigger — NOT needed for v1

Per brainstorm Round-3 fix #4:

```
max_planned_job_wall_time =
    fetch_max(N pages)
  + raster_max(M pages of PDF)
  + cold_model_load
  + N × per_page_inference_max
  + ack_max
```

Substituting v1 numbers from ADR-11A.0 + ADR-11A.1 v0.1:

| Term | v1 bound | Notes |
|---|---|---|
| `fetch_max(N)` | ≤ 30 s × N | ADR-11A.0 default `FetchOptions.timeoutMs = 30_000` per page |
| `raster_max(M)` | **0** | ADR-11A.0 §8 forbids PDF at the fetcher boundary; upstream must rasterize |
| `cold_model_load` | ~200 ms | Measured for δ; paid once per worker bin lifetime, NOT per job |
| `N × per_page_inference_max` | ~130 ms × N | Measured for δ on synthetic Chinese |
| `ack_max` | < 100 ms | Persistence + queue receipt write |

For a **single-page** job: ~30.5 s upper bound (dominated by fetch
timeout). For a **10-page** job: ~31 s.

The default lease is `DEFAULT_LEASE_MS = 30_000` (in-memory queue
default; SQLite queue inherits). The 0.5× threshold is 15 s.

**Decision:** v1 worker MUST NOT renew leases. Rationale:

- For 1-page jobs, the upper bound (~30 s) sits at the lease boundary,
  not over it. The actual median is ~250 ms (fetch from a fast network
  + inference). The 99th percentile case is dominated by fetch timeout,
  which is bounded by the fetcher's own timeout — not by an open
  question.
- For N-page jobs where `max_planned_job_wall_time > 15 s`, the v1
  answer is **bound N at the submission boundary**, not renew leases.
  Concretely: ADR-11C MUST cap per-submission page count at a value
  whose worst-case wall time stays under the 15 s threshold. With δ's
  per-page inference + per-page fetch caps, **N ≤ 1** is the
  conservative bound until ADR-11C measures real-fixture cost.
- Lease renewal adds a control-plane concern (a heartbeat from worker
  to queue) that the v1 coordinator does not need.

This decision lands here, not in 11C, so 11C inherits a frozen
"no lease renewal in v1" rule rather than re-litigating it under
implementation pressure. If real-fixture measurements in ADR-11A.1
v1.0 raise `max_planned_job_wall_time` past 15 s for realistic page
counts, the v2 worker adds lease renewal and 11B is amended.

### §4 Engine-package dependency graph

ADR-11C lands the production code; this ADR pins the package edges.

```
services/ocr-worker (production worker)
    │
    ├── runtime dep:  ocr-worker-contract  (already present)
    ├── runtime dep:  ocr-persistence       (already present)
    └── runtime dep:  @gutenye/ocr-node     (NEW in 11C — δ engine)
                                            (transitively: onnxruntime-node,
                                             sharp, @gutenye/ocr-models)
```

Constraints:

- **One engine wired per worker bin invocation.** The registry MUST NOT
  load both `fake` and `paddleocr-onnx` at boot — `cli.ts buildDefaultDeps`
  picks one based on `OCR_WORKER` env / `--worker` flag and calls
  `WORKER_REGISTRY[k].load()` exactly once.
- **`fake` factory has zero runtime deps beyond the contract package**
  (the `processFakeOcrJob` import stays in `ocr-worker-contract/testing`).
- **Engine-package missing handling** follows ADR-11A.0 §11 verbatim:
  `ERR_MODULE_NOT_FOUND` + anchored regex `/^Cannot find package
  '<enginePkg>'/` distinguishes "engine package missing" (friendly
  install message) from "transitive import failure inside engine"
  (propagate original diagnostic). ADR-11C tests this branch.
- **The bakeoff package (`services/ocr-worker-bakeoff/`) stays out of
  the production graph.** ADR-11C's production paddleocr-onnx adapter
  is a separate file from the bakeoff's; they share `@gutenye/ocr-node`
  as a common dependency but not source code.
- **`@gutenye/ocr-node` becomes a v1 runtime dep on production
  deployments.** ~280 MB unpacked (native runtime) is the cost. This
  is the price of in-process Node engine; sidecar would have meant
  installing the engine on a separate host but the same install size
  somewhere.

#### Why not share `services/ocr-worker-bakeoff/src/harnesses/paddleocr-onnx.ts`?

The bakeoff harness returns `EngineObservation` (measurement-shaped:
transcript, latency, RSS, cold load). The production worker returns
`OcrJobOutcome` (contract-shaped: statuses, results, terminal state).
Different output types, different lifecycle (bakeoff spawns
subprocess for RSS isolation; production runs in-process for cold-
load amortization). Re-using the file would force one of:

- Twin codepaths in the harness (subprocess vs in-process modes)
- A measurement adapter wrapping the production adapter

Both add complexity. ADR-11C writes the production paddleocr-onnx
adapter from scratch, depending on `@gutenye/ocr-node` directly.
The bakeoff harness keeps its measurement-shaped form. The shared
contract is the engine library API + the model artifacts, not
source code.

### §5 Audit-log destination

ADR-11A.0 §5 + §6 named the audit-log destination as "stderr +
optional persistence" with strict redaction rules. 11B pins:

- **v1: stderr only.** Per-fetch + per-engine-invocation events go to
  stderr via the `writeFetcherEvent(event)` redactor-sink wrapper that
  ADR-11A.0 §6 mandated. No persistence-side audit log table.
- **No `ocr_persistence` schema change** for audit. ADR-11C does NOT
  add an `ocr_audit_events` table or column.
- **No log aggregation / shipping infrastructure** wired by 11C.
  Operators can pipe the worker bin's stderr to their preferred
  collector (journald, fluentd, etc.); that is a deployment concern.
- **Post-v1 amendment** adds a persisted audit table if compliance
  requirements emerge. The schema for it is NOT pre-decided here.

This is a deliberate scope cut. v1 audit needs are observability +
post-incident reconstruction; both are served by stderr + an external
collector. Compliance-grade audit (legal retention, queryable
incident review) requires a real schema and is not part of v1.

### §6 Fail-closed config — ties to ADR-11A.0 §10

ADR-11A.0 §10 pinned the production fail-closed flags:

- `OCR_WORKER_REQUIRE_REAL=1` → if `--worker=fake`, exit 2
- `NODE_ENV=production` → if `OCR_WORKER_REQUIRE_REAL` unset OR
  `--worker=fake`, exit 2

11B locks the implementation sequence:

```
parseConfig(env, argv)
  └→ rejectMalformedWorkerSelector(argv)     # 11A.0 §10 — exit 2 on bad --worker
  └→ resolveWorkerSelector(config)           # omitted --worker → "fake"
  └→ validateProductionProfile(env, config)  # 11A.0 §10 — exit 2 on bad combo
  └→ WORKER_REGISTRY[config.worker].load()   # 11B §1 — runtime engine load
  └→ buildDefaultDeps(config, worker)        # existing path
```

Validation runs strictly between config parsing and registry lookup.
No worker is instantiated under an invalid profile. The registry
shape from §1 satisfies the "exit 2 on unknown key" requirement
because `WorkerKey` is a closed union; an unknown key fails at
config parse, not at registry load.

### §7 Cold model load is paid once per worker bin lifetime

The worker bin's process loads the engine once at `buildDefaultDeps`
time (via `WORKER_REGISTRY[key].load()`). Subsequent
`OcrWorker.process(job)` invocations reuse the loaded models. This
amortizes the ~200 ms δ cold-load cost across every job the bin
processes in its lifetime.

Consequences:
- Worker bin process restarts (SIGINT/SIGTERM / crash / deploy) pay
  cold load. ADR-11A.0 §10's graceful-shutdown chain already drains
  the in-flight job before exit; cold load is paid on next-start.
- Concurrent workers (multi-process) each pay their own cold load.
  v1 is single-worker per bin (ADR-10C concurrency = 1); multi-worker
  is post-v1.

### §8 What 11B explicitly does NOT decide

- The fetcher implementation (ADR-11C). The contract is frozen by
  ADR-11A.0; the code lands in 11C.
- The engine adapter code (ADR-11C). 11B pins the registry shape +
  dependency edges; 11C writes `make<engine>Worker()`.
- The mapper (ADR-11A.5 v1.0 + ADR-11C). 11B says "the worker returns
  `OcrJobOutcome`"; how the engine output projects into that contract
  is mapping rules, which live in 11A.5 amendments and the 11C code.
- Engine choice. ADR-11A.1 v0.1 pinned δ as provisional default; ε
  v1.0 amendment can flip it.
- Multi-host / multi-tenant / cloud OCR — all post-v1.
- Audit-log retention policy.

## Acceptance — ADR-11B itself

| Criterion | Result |
|---|---|
| ADR file at `docs/adr/ocr-worker-runtime-step-11b.md` | ✅ |
| Zero source-file edits in this commit | ✅ |
| Zero changes to tests, fixtures, or schemas | ✅ |
| Registry shape pinned with explicit constraints (closed union, async load, no caller strings, missing-deps handling) | ✅ |
| In-process vs sidecar decision pinned with rationale | ✅ |
| Lease-renewal trigger decision pinned with arithmetic | ✅ |
| Dependency-graph edges + bakeoff-isolation rule pinned | ✅ |
| Audit-log destination pinned for v1 | ✅ |
| Fail-closed config sequence pinned (ties to 11A.0 §10) | ✅ |
| Five package suites still green (no code change, no expected delta) | ✅ |

## Consequences

- **ADR-11C inherits a fixed registry shape + dependency graph.** No
  more design loops on "where does the engine package edge live."
- **`@gutenye/ocr-node` enters the production dependency graph in
  11C.** Operators install it via `npm` like any other Node dep; no
  external system packages required.
- **The `OCR_WORKER` env / `--worker` flag becomes the canonical
  production toggle.** Defaults to `fake`; production deployments
  set it to `paddleocr-onnx` AND set `OCR_WORKER_REQUIRE_REAL=1` AND
  `NODE_ENV=production` for the fail-closed combo.
- **Lease renewal is v2 work.** v1 worker bin doesn't carry heartbeat
  state; the coordinator's existing path-B requeue handles every
  case where the lease genuinely expires before completion.
- **The bakeoff harness stays out of the production graph.** ADR-11A.1
  v1.0 work continues against the bakeoff package; the production
  worker has its own adapter.
- **C3 closes when 11C lands.** `cli.ts buildDefaultDeps` will route
  through `WORKER_REGISTRY[key].load()`; the `processFakeOcrJob`
  import moves entirely behind the `fake` key's factory. Production
  source under `services/ocr-worker/src/` (other than the registry
  itself + the fake factory) no longer references
  `ocr-worker-contract/testing` at all.

## Non-goals (strict)

- Implement the registry. ADR-11C.
- Implement the engine adapter. ADR-11C.
- Implement the fetcher. ADR-11C.
- Implement the mapper. ADR-11A.5 v1.0 + ADR-11C.
- Add a sidecar protocol. δ is in-process; the protocol is empty.
- Add lease-renewal logic. v2 amendment.
- Add an audit-log persistence schema. Post-v1.
- Pre-decide engine candidate beyond δ. ADR-11A.1 v1.0.
- Multi-worker concurrency, multi-host, cloud OCR, PDF rasterization —
  all post-v1 per ADR-11A.0.

## Open questions for ADR-11C

| Question | Why it matters |
|---|---|
| Does the production paddleocr-onnx adapter call `Ocr.create()` synchronously inside `WORKER_REGISTRY["paddleocr-onnx"].load()`, or lazily on first `process(job)`? | Affects bin startup latency vs first-job latency. 11B's §7 leans toward eager load (cost paid at startup, not on the first claim). |
| How does the production adapter project `Line[]` (engine output) into `OcrResult` (contract output)? | The mapper rules. Mostly ADR-11A.5 v1.0 work; ADR-11C lands the code. |
| What does the production adapter do for empty results (zero detected lines)? | ADR-11A.0 §9 names it "not a failure"; the adapter writes an empty `OcrResult` with `texts: []` and a flag. Implementation detail for 11C. |
| Does the production worker handle `Ocr.create()` failures (corrupted model files, etc.) by exiting the bin or by returning a per-job `worker_threw` failure? | Lifecycle decision. The bin should exit 2 on startup failure (matches ADR-10E exit-code mapping); per-job failures during inference become contract `partial_failure` outputs via the mapper. |
