# ADR: OCR Worker Runtime Entrypoint (Step 10E)

## Status

Accepted. Implementation lives in `services/ocr-worker/src/{config,processSignals,cli}.ts`.

## Context

After Step 10D the package shipped a thin coordinator loop
(`runOcrWorkerLoop`) and an in-memory queue, but no OS-process shell:

- No CLI / runtime entrypoint.
- No argv / env config parsing.
- No signal handling.
- No JSON summary log on shutdown.
- No exit-code mapping.

Step 10E adds **only** that runtime shell. It does not change coordinator
semantics, contract semantics, retry policy, or the in-memory queue. It
deliberately does not introduce a durable broker — the in-memory queue
stays the only backend, so 10E proves *process lifecycle*, not
production distributed consumption.

## Decisions

### 1. New, isolated runtime module — no coordinator changes

10E lives in three new files in `services/ocr-worker/src/`:

- `config.ts` — pure parser of `{ env, argv }` → `OcrWorkerConfig` |
  throw `OcrWorkerConfigError`. No process side-effects.
- `processSignals.ts` — `installShutdownHandlers({ process, signals,
  onSecondSignal })` returns `{ signal: AbortSignal, uninstall(): void }`.
  First signal aborts the controller; second-and-subsequent signals are
  forwarded to a hook (default no-op).
- `cli.ts` — `runOcrWorkerProcess({ argv, env, process, buildDeps })`
  returns the exit code (does not call `process.exit`). Defaults wire
  `InMemoryOcrQueue` + `InMemoryOcrPersistence` (or
  `openSqliteOcrPersistence` when `persistence=sqlite`) + the fake worker
  from `ocr-worker-contract/testing`.

`coordinator.ts`, `workerLoop.ts`, `adapter.ts`, `inMemoryQueue.ts`,
`outcomeValidation.ts`, and `types.ts` are **not** modified.

### 2. Concurrency stays exactly 1

The runtime delegates iteration entirely to `runOcrWorkerLoop`, which
runs at most one `processOne()` at a time by construction. Step 10E
does not expose a concurrency knob.

### 3. Signal model

- Listened signals default to `SIGINT` and `SIGTERM`. Custom sets are
  accepted (test seam; useful for `SIGHUP` etc.).
- First arrival → `controller.abort()` → `runOcrWorkerLoop` finishes the
  in-flight `processOne()` and returns with `stop_reason="stopped"`.
- Second arrival → `onSecondSignal(sig)` is invoked. The default
  implementation in `cli.ts` writes a "shutdown already in progress"
  notice to stderr.
- **Forceful cancellation is intentionally not implemented.** The
  current `OcrWorker.process()` contract has no `AbortSignal` channel,
  so the coordinator cannot interrupt a worker mid-call. Adding such a
  channel is a contract change and is out of 10E scope. For now,
  operators relying on hard kill must use the OS (e.g. `kill -9`).
- `uninstall()` is called on every exit path so the Node event loop is
  not held by orphaned listeners. The `cli.test.mjs` suite asserts the
  listener count is back to 0 after the runtime returns.

### 4. Config surface

| Source | Key |
|---|---|
| env | `OCR_WORKER_ID` |
| env | `OCR_WORKER_PERSISTENCE` (`memory` \| `sqlite`) |
| env | `OCR_WORKER_SQLITE_PATH` |
| env | `OCR_WORKER_IDLE_DELAY_MS` |
| env | `OCR_WORKER_MAX_ITERATIONS` |
| env | `OCR_WORKER_INCLUDE_EMPTY_OUTCOMES` |
| argv | `--worker-id`, `--persistence`, `--sqlite-path`, `--idle-delay-ms`, `--max-iterations`, `--include-empty-outcomes`, `--help` |

Precedence: argv > env > default. Flags accept both `--flag=value` and
`--flag value`. `--include-empty-outcomes` may appear bare (implies
`true`) or with an explicit boolean.

`persistence=sqlite` requires `sqlite_path`; missing it is a config
error (exit code 2).

### 5. Logging

- **stdout** receives one JSON line at the end: the
  `OcrWorkerLoopSummary` (`iterations`, `stop_reason`, `outcomes`,
  optional `last_outcome`, optional `last_error`). Single-line so the
  log is grep-friendly and machine-parseable.
- **stderr** receives human messages: config errors, dep-wiring errors,
  loop errors (per-event from the loop's `onError` hook), the
  second-signal notice, cleanup errors.
- `--help` writes a usage block to stdout and returns 0 without
  starting the loop or installing signal handlers.

### 6. Exit codes

| Outcome | Code |
|---|---|
| `stop_reason="stopped"` (graceful via signal or pre-aborted signal) | 0 |
| `stop_reason="max_iterations"` | 0 |
| `--help` | 0 |
| `stop_reason="error"` | 1 |
| Defensive: loop throws despite contract (should not happen) | 1 |
| Config parse failure | 2 |
| Dep-wiring failure (`buildDeps` throws) | 2 |

`runOcrWorkerProcess` returns the code. It does **not** call
`process.exit`; the bin wrapper is responsible for assigning
`process.exitCode`. This keeps the function fully testable in-process.

### 7. Dependency injection seam

`runOcrWorkerProcess({ buildDeps })` accepts an override that returns:

```ts
{
  queue?: OcrJobQueueBackend;
  worker?: OcrWorker;
  persistence?: OcrPersistencePort;
  coordinator?: OcrCoordinatorLike;
  cleanup?: () => Promise<void>;
}
```

If `coordinator` is provided, default coordinator construction is
skipped (used by tests to inject a stub or a coordinator that throws on
`processOne`). Otherwise the runtime constructs
`new OcrProcessingCoordinator({ queue, persistence, worker, worker_id })`
from the config-provided `worker_id`.

`cleanup` runs on every **post-`buildDeps`** exit path: graceful stop,
`max_iterations`, loop error, and unexpected loop throw. It does **not**
run when `buildDeps` itself fails, when config parsing fails, or when
`--help` short-circuits — at those points no `cleanup` handle exists yet
to invoke. Cleanup errors are logged to stderr but do not change the
exit code — the loop result is authoritative.

### 8. Package boundary

- `ocr-persistence` is promoted from devDependency to **dependency**
  in `services/ocr-worker/package.json` because the runtime entrypoint
  imports it. This does **not** authorize a workspace conversion or a
  root `package.json`.
- Test script ordering is updated so `ocr-persistence` is built
  *before* `ocr-worker`, since the entrypoint now depends on the
  built `dist/`.
- No new top-level dependency is added to any other package.

### 9. What stays out of scope (intentional, per Step 10E constraints)

- Retry / back-off / DLQ progression.
- Lease renewal.
- Concurrency > 1.
- Durable / distributed queue backend (BullMQ, Redis, SQS).
- Mid-`processOne()` cancellation (would require contract change to
  `OcrWorker.process`).
- Concurrent-cancellation polling.
- Long-running worker idempotency identity (deferred since 10C).

## Acceptance criteria — verified

| Criterion | Result |
|---|---|
| CLI starts with default config | ✅ `runOcrWorkerProcess` with empty argv/env runs the loop |
| Config parse failure → exit 2 | ✅ `cli.test.mjs` "config error → stderr message + exit code 2" |
| `persistence=sqlite` without path → exit 2 | ✅ `cli.test.mjs` "missing sqlite_path → exit code 2" |
| `--help` → exit 0 + usage on stdout | ✅ `cli.test.mjs` |
| SIGINT/SIGTERM trigger graceful AbortController shutdown | ✅ `processSignals.test.mjs` + `cli.test.mjs` "SIGINT during idle loop" |
| Summary as single-line JSON to stdout | ✅ `cli.test.mjs` parses the last stdout line as JSON |
| `stop_reason="stopped"` → 0 | ✅ |
| `stop_reason="max_iterations"` → 0 | ✅ |
| `stop_reason="error"` → 1 | ✅ `cli.test.mjs` "loop error (coordinator throws)" |
| Cleanup runs on every post-`buildDeps` exit path (success and loop error) | ✅ |
| Listeners uninstalled after exit | ✅ |
| Existing 345 tests pass | ✅ 376/376 (115 in worker, +31) |
| No root `package.json` | ✅ |
| No coordinator / contract semantics changed | ✅ files untouched |

## Non-goals

- Production OCR engine.
- Durable queue backend.
- Lease renewal during long-running worker calls.
- Forceful mid-call cancellation.
- Concurrency > 1.
- Retry / back-off / DLQ progression.
- Workspace / monorepo conversion.
