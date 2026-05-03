# ADR: OCR Pipeline Runtime Integration — Smoke (Step 10F)

## Status

Accepted. Implementation lives in
`services/ocr-review/tests/pipeline.runtime.e2e.test.mjs`.

## Context

After Step 10E the codebase has all the pieces of the new runtime
pipeline, but no test composes them end-to-end:

- 10C — `OcrProcessingCoordinator` (persistence-as-source-of-truth,
  queue-as-transport).
- 10D — `runOcrWorkerLoop` (concurrency=1 driver loop with
  AbortSignal-based graceful stop).
- 10E — `runOcrWorkerProcess` (CLI/runtime entrypoint, config parser,
  signal handlers, exit-code mapping).

The existing `services/ocr-review/tests/review.test.mjs` exercises a
read-model e2e against the **older synchronous path**:
`ingestDocumentForOcr → OcrJobAdapter.processNextOcrJob`. That path
bypasses the coordinator/loop/cli entirely. So the coordinator + loop +
runtime trio has, until 10F, only ever been exercised in isolation.

Step 10F closes that gap **as a smoke check** — not a production
integration. It composes the runtime path once, in-memory, and asserts
the lawyer-facing read models reflect what the runtime persisted.

## Decisions

### 1. Smoke integration boundary — not durable, not distributed

10F is the minimum demonstration that the new path composes:

```
createOcrSubmissionFromDocument
  → persistence.createOcrJob(submission)
  → OcrJobAdapter.enqueueOcrJob(submission, { scenario })
  → InMemoryOcrQueue
  → runOcrWorkerProcess (10E)
  → runtime-built OcrProcessingCoordinator (10C)
  → runOcrWorkerLoop (10D)
  → InMemoryOcrPersistence
  → ocr-review read models (getOcrJobLifecycle / getReviewableOcrPage /
    summarizeOcrIngestionOutcome)
```

It is **not**:

- a durable / distributed queue integration,
- a real OS-process supervision check,
- a production wiring claim,
- a migration of `services/ocr-ingestion/src/ingest.ts` (still uses the
  older synchronous adapter path on purpose — out of scope for 10F).

### 2. Test home: `services/ocr-review`

`ocr-review` already devDeps `ocr-worker-adapter` and `ocr-ingestion`,
and prod-deps `ocr-persistence` + `ocr-worker-contract`. It is the only
package that already pulls in every layer the smoke test touches. No
new package edges were added. No workspace conversion. No root
`package.json`.

### 3. Persist BEFORE enqueue

`persistence.createOcrJob(submission)` runs before the adapter enqueue.
The 10C coordinator's path B (claimed-but-unknown job) requires the job
row to exist; without it the coordinator emits `persistence_failed`
(transient) and requeues, and the smoke test would observe nothing
useful. This mirrors what production ingestion is already expected to
do.

### 4. Enqueue via `OcrJobAdapter`, not the queue directly

The `InMemoryOcrQueue` consumes `OcrJob` envelopes (job_id + scenario +
submission), not bare submissions. `OcrJobAdapter.enqueueOcrJob` owns
that wrapping. Calling `queue.enqueue` directly would couple the test
to the queue's internal envelope shape; using the adapter keeps the
test pinned to the public contract.

### 5. No `coordinator` override in `buildDeps`

`runOcrWorkerProcess`'s `coordinator` injection seam is for unit tests
(see `services/ocr-worker/tests/cli.test.mjs`). Using it here would
defeat the integration check, since the whole point of 10F is to
exercise the **runtime-built** coordinator. `buildDeps` returns
`{ queue, persistence, worker, cleanup: undefined }` and lets the
runtime construct the coordinator itself.

### 6. Fake `process` via `EventEmitter`

The runtime entrypoint takes a `process` parameter. The e2e test passes
a `new EventEmitter()` plus buffered `stdout`/`stderr` writers, so:

- SIGINT/SIGTERM handlers attach to the fake — they do **not** leak
  onto the real `node --test` process,
- the loop summary line is captured deterministically from the fake's
  stdout buffer (last non-empty line, parsed as JSON).

### 7. `cleanup: undefined` for shared in-memory deps

The fixtures (`InMemoryOcrPersistence`, `InMemoryOcrQueue`) are owned
by the test, not by `buildDeps`. Returning `cleanup: undefined` keeps
the runtime from double-closing what the test still needs.

### 8. Config: `MAX_ITERATIONS=1`, `IDLE_DELAY_MS=0`

`max_iterations=1` makes each scenario run exactly one loop iteration
and exit deterministically with `stop_reason="max_iterations"`. No
SIGINT plumbing needed. `idle_delay_ms=0` keeps the empty-queue case
fast.

### 9. Three scenarios

| # | Scenario | Pages | Queue scenario | Terminal state | `outcomes` |
|---|---|---|---|---|---|
| 1 | success | 1 | `success` | `succeeded` | `completed=1` |
| 2 | partial | 2 | `partial_failure` | `partial_succeeded` | `completed=1` |
| 3 | empty | – | – (nothing enqueued) | – | `empty=1` |

Pinned terminal-state spelling: **`partial_succeeded`** (not
`partially_failed`). Source of truth is the contract:
`docs/contracts/schemas/ocr-status.schema.json` →
`docs/contracts/src/transitions.ts` →
`docs/contracts/src/testing/fake-worker.ts`. The repo never used
`partially_failed`.

The partial scenario specifically requires **≥ 2 pages** because
`processFakeOcrJob` for `partial_failure` succeeds page 1 and fails the
rest; with a single page the fake worker throws.

### 10. Build-order in the test script

`services/ocr-review/package.json` test script now explicitly chains
sibling builds:

```
contracts → ocr-persistence → ocr-worker → ocr-ingestion → ocr-review
```

before running `node --test` over the three review test files
(`review.test.mjs`, `review.crossjob.test.mjs`,
`pipeline.runtime.e2e.test.mjs`). The ESM imports resolve from each
package's `dist/`, so the test would otherwise be sensitive to whether
sibling packages had been built earlier in the session.

## Acceptance criteria — verified

| Criterion | Result |
|---|---|
| New e2e test wires shared `InMemoryOcrPersistence` + `InMemoryOcrQueue` | ✅ |
| Submission built via `createOcrSubmissionFromDocument` (no hand-rolled fake) | ✅ |
| Test enqueues through `OcrJobAdapter.enqueueOcrJob` | ✅ |
| Runtime invoked via `runOcrWorkerProcess({ buildDeps })` | ✅ |
| `max_iterations=1` → deterministic single-iteration run | ✅ |
| Success: exit 0, `stop_reason="max_iterations"`, `outcomes.completed=1`, lifecycle terminal `succeeded`, page `raw_text`/`text_preview` and review block digests (`detected_seals`, `detected_tables`) present (the review model exposes digests, not raw worker `blocks[]`) | ✅ |
| Partial: terminal `partial_succeeded`, summary `succeeded=1 / failed=1`, failed page surfaced via review with populated `partial_failure` | ✅ |
| Empty: exit 0, `stop_reason="max_iterations"`, `outcomes.empty=1`, persistence has no job rows | ✅ |
| Existing 393 tests remain green | ✅ |
| New test count: +3, total 396 | ✅ |
| No coordinator / workerLoop / cli / config / processSignals semantic changes | ✅ files untouched |
| No root `package.json`, no workspace conversion | ✅ |

## Non-goals

- Migrate `services/ocr-ingestion/src/ingest.ts` to the runtime path.
- Durable/distributed queue backend (BullMQ, Redis, SQS).
- Production OS-process supervision.
- Retry / back-off / DLQ progression beyond the existing 10C edges.
- Lease renewal during long-running worker calls.
- Concurrency > 1.
- Demonstrating mid-`processOne()` cancellation (no contract channel
  for it; ADR 10E §3 already records this).
