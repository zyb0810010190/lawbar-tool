# ADR: OCR Cross-Process E2E (Step 10L)

## Status

Accepted. Implemented in this step. Closes ADR-10H staging.

## Context

ADR-10H staging:

| Step | Scope |
|---|---|
| 10I | `SqliteOcrQueue` impl + schema v2 + conformance + contention. Closed (`7419c14`, `1454713`). |
| 10J | Runtime/backend wiring in worker CLI. Closed (`374dee3`). |
| 10K | `ingest.ts` enqueue-only migration + atomic ingest seam. Closed (`3ea8c7d`). |
| **10L** | Cross-process e2e — observation only. |

ADR-10H §"Staging" pinned 10L's intent:

> Cross-process e2e: ingestion process enqueues, spawned worker bin
> claims via `bin/ocr-worker.mjs`, review observes terminal state
> through persistence reads. New integration test home (likely
> `services/ocr-review`), no production wiring change.

10L is the closing chapter of the queue migration. It proves that the
three independently-tested constituents — atomic ingest (10K), the
SQLite queue selector (10J), and the bin wrapper (10G) — compose
correctly across a real process boundary.

## Decision

A new test file in `services/ocr-review/tests/` runs the full e2e
flow:

1. The test process opens its own `SqliteOcrPersistence` +
   `SqliteOcrQueue` against a `mkdtempSync` SQLite file.
2. Calls `ingestDocumentForOcr(input, { persistence, queueAdapter,
   queue, scenario? })` — the 10K atomic seam writes both `ocr_jobs`
   and `ocr_queue_jobs` rows in one `BEGIN IMMEDIATE`.
3. Asserts pre-spawn invariants: `out.atomic === true`,
   `out.enqueueResult.deduped === false`, exactly one active row in
   `ocr_queue_jobs` for that `job_id`.
4. Closes the test's queue + persistence handles (queue first, then
   `persistenceDb`) so the writer lock transfers cleanly.
5. Spawns `services/ocr-worker/bin/ocr-worker.mjs` via
   `spawn(process.execPath, [BIN_PATH], { env: ... })` with
   `OCR_WORKER_PERSISTENCE=sqlite`, `OCR_WORKER_QUEUE=sqlite`,
   `OCR_WORKER_SQLITE_PATH=<shared>`, `OCR_WORKER_MAX_ITERATIONS=1`,
   `OCR_WORKER_IDLE_DELAY_MS=0`, `OCR_WORKER_ID=<deterministic>`.
6. Awaits the bin's `"close"` event (stdio drained) with a 15 s
   per-test timeout escalating to SIGKILL.
7. Parses the bin's last non-empty stdout line as JSON; asserts
   `stop_reason === "max_iterations"`, `iterations === 1`,
   `outcomes.completed === 1`, no `requeued|ack_failed|persistence_failed|lease_lost`.
8. Re-opens persistence in the test process, asserts terminal state +
   per-page results + the exact ordered status timeline.

Two test cases cover the two scenarios the 10C coordinator admits:

| Case | Scenario | Pages | `terminal_state` | Status edges |
|---|---|---|---|---|
| Success | (default) | 1 | `succeeded` | `queue:queued→claimed`, `worker:claimed→processing`, `worker:processing→succeeded` |
| Partial | `partial_failure` | 2 | `partial_succeeded` | `queue:queued→claimed`, `worker:claimed→processing`, `worker:processing→partial_succeeded` |

The plan reviewer's R1–R12 (thread `019e0d75`) are baked into the
test as concrete invariants:

| # | Decision |
|---|---|
| R1 | `--max-iterations=1`, `--idle-delay-ms=0`. Expect `stop_reason="max_iterations"`. (`"stopped"` requires a signal; would be wrong here.) |
| R2 | Pre-spawn assertions verify queue same-store visibility, not just persistence write. |
| R3 | `process.execPath`, not bare `"node"`. Mirrors `cli.spawn.test.mjs`. |
| R4 | Spawn helper resolves on `"close"`, rejects on `"error"`, escalates to SIGKILL on timeout, surfaces stderr in diagnostics. |
| R5 | Exact ordered lifecycle edges per case — no "and various worker edges" hand-wave. |
| R6 | Partial case passes `scenario: "partial_failure"` via ingest opts. |
| R7 | Review's `package.json` test script chains `npm --prefix ../ocr-worker run build` (and ingestion) so `bin/ocr-worker.mjs` finds its `dist/` at spawn time. |
| R8 | Close order: `queue.close()` → `persistenceDb.close()` → spawn. |
| R9 | Bin config-error coverage already lives in 10J's `cli.sqlite.test.mjs`. 10L is happy-path-only by design. |
| R10 | Stdout summary parsing is `lines.filter(trim).at(-1)` → `JSON.parse`. Errors include stderr + stdout in the message. |
| R11 | No pre-bootstrap step. Constructors apply schema idempotently. |
| R12 | No `outcomes.empty` assertion (irrelevant with one queued job + 1 iteration). |

## What 10L proves

- Atomic ingest under `SqliteOcrPersistence.enqueueNewOcrJob` lands
  rows visible to a SECOND OS process opening `SqliteOcrQueue` on the
  same file.
- The bin wrapper, the 10E config parser, the `--queue` selector
  (10J), the 10C coordinator, and the in-memory→SQLite queue swap all
  compose end-to-end.
- The bin's stdout summary contract (`stop_reason`, `iterations`,
  `outcomes.{completed,empty,...}`) is observable from a parent test
  process and stable enough to assert on exactly.
- Persistence is the source of truth: the test never reads through
  the queue to verify outcomes.

## What 10L does NOT prove

- Multi-host / NFS / network-FS deployment. ADR-10H §"Applicability"
  scopes the queue choice to a single host with a local-FS SQLite
  file. 10L tests in that scope only.
- Multi-worker concurrent claim. The worker loop enforces
  concurrency-1 by construction; 10L runs exactly one worker process.
- Retry / DLQ / lease-renewal / back-off. Those remain post-10L.
- Production-scale OCR. The fake worker is still wired in; a real
  OCR worker is its own ADR series.
- Long-running worker behaviour (lease renewal under multi-second
  jobs). 10L's `--max-iterations=1` finishes synchronously well
  within the default lease window.
- SIGINT / SIGTERM graceful shutdown. 10G already covers that.
- Bin config-error paths. 10J's `cli.sqlite.test.mjs` already covers
  `queue=sqlite` without `persistence=sqlite` exiting `2`, plus the
  `--persistence=sqlite` requires-`--sqlite-path` rule. 10L would
  duplicate that coverage if it added them.

## What 10L does NOT change

- `services/ocr-ingestion/src/ingest.ts` (10K).
- `services/ocr-worker/src/cli.ts`, `services/ocr-worker/bin/ocr-worker.mjs` (10E/10G/10J).
- `OcrProcessingCoordinator`, `runOcrWorkerLoop`, `OcrJobAdapter`.
- `SqliteOcrQueue`, `SqliteOcrPersistence`, schema (still v2).
- `ocr-worker-contract` package.

The ADR file itself plus the new test plus the review's `package.json`
test-script line are the only artefacts of 10L.

## Acceptance — 10L itself

| Criterion | Result |
|---|---|
| New test file `services/ocr-review/tests/pipeline.crossprocess.step10l.test.mjs` exists | ✅ |
| Two test cases (success + partial_failure) green | ✅ |
| Review test script chains worker + ingestion build before running 10L | ✅ |
| Pre-spawn assertions cover same-store queue visibility | ✅ |
| Spawn helper resolves on `"close"` with timeout-escalating SIGKILL | ✅ |
| Bin's stdout summary asserted exactly (no `>=` slop) | ✅ |
| Lifecycle edges asserted exactly with `controlled_by` discrimination | ✅ |
| All five package suites still green | contract 73 + persistence 209 + worker 164 + ingestion 29 + review 40 = 515 |
| Zero production-source changes | ✅ |
| ADR file `docs/adr/ocr-cross-process-e2e-step-10l.md` exists | ✅ |

## Consequences

- ADR-10H staging closes here. The branch carrying 10I → 10J → 10K
  → 10L is a merge candidate.
- Production wiring is now stage-correct for real OCR worker work:
  ingestion enqueues atomically; a separate worker process claims via
  the bin; review observes through persistence.
- The shape of 10L's test (spawn the real bin, drive one job through,
  assert via persistence) is a template for any future cross-process
  e2e — e.g. when a real OCR worker replaces the fake one, or when
  multiple worker processes are introduced (post-10L).
- The plan-review chain (initial sketch → review → R1–R12 revision)
  caught a wrong-on-first-run defect (`stop_reason="stopped"` claim
  vs the actual `"max_iterations"` semantics) BEFORE code was
  written. Reinforces the "/codex-toolkit:review-plan before
  implementation" loop in `CLAUDE.md`'s Codex Integration Policy.
