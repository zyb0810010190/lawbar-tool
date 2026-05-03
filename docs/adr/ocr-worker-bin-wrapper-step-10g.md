# ADR: OCR Worker Bin Wrapper + Real-Process Smoke (Step 10G)

## Status

Accepted. Implementation lives in
`services/ocr-worker/bin/ocr-worker.mjs` and
`services/ocr-worker/tests/cli.spawn.test.mjs`.

## Context

Step 10E (`docs/adr/ocr-worker-runtime-entrypoint-step-10e.md`) added
`runOcrWorkerProcess`, the in-process runtime shell. Step 10F
(`docs/adr/ocr-pipeline-runtime-integration-step-10f.md`) proved the
runtime composes end-to-end *in-process* against a fake
`EventEmitter` for `process`.

Two real-process invariants remained un-exercised:

1. **No spawnable command.** `services/ocr-worker/package.json` had no
   `"bin"` field, no executable entry point. ADR 10E §6 said *"the bin
   wrapper is responsible for assigning `process.exitCode`"* — but no
   wrapper was ever written.
2. **No real-OS proof.** Real `process.argv`, real `process.env`, real
   stdout flush on exit, real SIGINT from a parent, real
   `process.exitCode` propagation — none of those had been verified by
   any test.

Step 10G closes only that gap. It does **not** introduce a durable
queue or any cross-process consumption story; that is deferred to 10H.

## Decisions

### 1. Smallest possible wrapper

`services/ocr-worker/bin/ocr-worker.mjs` is ~10 lines: shebang,
`runOcrWorkerProcess` import, single call with the real `argv` tail /
`env` / `process`, single `process.exitCode` assignment. No flags
parsed by the wrapper itself, no extra logging, no signal handling
(handlers belong to `processSignals.ts`, called from `cli.ts`).

### 2. `process.exitCode`, not `process.exit()`

The wrapper assigns the returned numeric code to `process.exitCode`
and returns. It deliberately does **not** call `process.exit()`. ADR
10E and `cli.ts` both promise that `cleanup` runs on every
post-`buildDeps` exit path; `process.exit()` would truncate that and
also drop pending stdout writes. Letting the event loop drain is the
documented contract.

### 3. Bin field

`services/ocr-worker/package.json` declares
`"bin": { "ocr-worker": "./bin/ocr-worker.mjs" }`. The wrapper is
chmod +x and uses `#!/usr/bin/env node`. This is enough for `npm` /
`pnpm` / `node services/ocr-worker/bin/ocr-worker.mjs` to all work —
no monorepo / workspace changes required.

### 4. Real-process smoke tests

`services/ocr-worker/tests/cli.spawn.test.mjs` spawns the wrapper as a
child node process via `node:child_process.spawn(process.execPath,
[BIN_PATH, ...argv])`. Four cases:

| # | Case | What it proves |
|---|---|---|
| 1 | `--help` | real argv → config → help short-circuit; usage on real stdout; exit 0 |
| 2 | `--max-iterations=1 --idle-delay-ms=0` | real config → loop one iteration on default in-memory deps → JSON summary on real stdout (parsed) → exit 0 |
| 3 | `--bogus-flag` | real argv → config error → real stderr message → exit 2; **no** summary line on stdout |
| 4 | SIGINT during idle loop | real `process.kill("SIGINT")` from parent → AbortController seam → graceful stop → JSON summary `stop_reason="stopped"` → exit 0 (not signal-killed) |

Test hygiene:
- All children registered for `t.after(() => kill("SIGKILL"))` so a
  hung child cannot leak past the test.
- The spawn helper resolves on the child's `"close"` event (all stdio
  drained), tracks `(code, signal)` from `"exit"`, and rejects on
  `"error"` so spawn failures surface as test failures rather than
  hangs. stdout/stderr are captured to strings; the summary is parsed
  from the last non-empty stdout line.
- Test 4 uses a **bounded liveness gate** before sending SIGINT: wait
  for the child's `"spawn"` event, then poll briefly until `pid` is a
  number, the child has not exited (`exitCode === null &&
  signalCode === null`), and has not been killed — for a small number
  of consecutive stable ticks, with an overall timeout. A premature
  exit during the poll throws with diagnostic stderr; the timeout
  also throws with diagnostic state. This replaces a fixed sleep and
  surfaces flakes as test failures.
- This gate is **not** a formal readiness protocol. The worker has no
  child-side ready signal we can observe without a production change.
  The gate proves "the child process is alive and stable," not
  "signal handlers are installed." A future explicit readiness signal
  on the worker side would be needed for stronger long-running
  supervisor tests; that is out of scope for 10G.

### 5. No production src changed

None of `cli.ts`, `config.ts`, `processSignals.ts`, `coordinator.ts`,
`workerLoop.ts`, `adapter.ts`, `inMemoryQueue.ts`, `types.ts` were
touched. The only worker-package surface change is the `"bin"` field
and the additional spawn test in the test script.

### 6. What 10G does NOT prove

- It does **not** prove distributed or durable queue consumption. The
  worker still uses `InMemoryOcrQueue`, which does not survive process
  exit and cannot be shared across processes.
- It does **not** migrate `services/ocr-ingestion/src/ingest.ts` off
  the older synchronous `OcrJobAdapter.processNextOcrJob` path.
- It does **not** add concurrency, retry/back-off, DLQ progression,
  lease renewal, or mid-`processOne()` cancellation.

These are 10H+ concerns. Calling them out here so future readers do
not infer them from "the worker can now be spawned."

## Acceptance criteria — verified

| Criterion | Result |
|---|---|
| `bin/ocr-worker.mjs` exists, ESM, executable, calls `runOcrWorkerProcess({ argv: process.argv.slice(2), env: process.env, process })` | ✅ |
| Wrapper assigns return code to `process.exitCode`, does not call `process.exit()` | ✅ |
| `package.json` declares `"bin": { "ocr-worker": "./bin/ocr-worker.mjs" }` | ✅ |
| `--help` spawn → exit 0 + usage on stdout | ✅ |
| `--max-iterations=1 --idle-delay-ms=0` spawn → exit 0, summary JSON, `stop_reason="max_iterations"`, `outcomes.empty=1` | ✅ |
| Bogus flag spawn → exit 2 + stderr config error + no summary | ✅ |
| Real SIGINT spawn → exit 0, `stop_reason="stopped"`, normal exit (not signal-killed) | ✅ |
| Existing 396 tests remain green | ✅ |
| New worker test count: +4 (132 → 136) | ✅ |
| No coordinator / workerLoop / cli / config / processSignals / adapter / inMemoryQueue / types changed | ✅ files untouched |
| No root `package.json`, no workspace conversion | ✅ |
| No durable queue / SQLite-queue / BullMQ / Redis / SQS choice introduced | ✅ |
| `ingest.ts` unchanged | ✅ |

## Non-goals

- Durable / cross-process queue (deferred to 10H).
- Selection of BullMQ / Redis / SQS / Postgres / SQLite-backed queue.
- `ingest.ts` migration.
- systemd / Docker / Kubernetes process supervision specs.
- Lease renewal during long-running worker calls.
- Forceful mid-call cancellation.
- Concurrency > 1.
- Retry / back-off / DLQ progression.
- New top-level dependencies.
