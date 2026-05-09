# ADR: OCR Ingest Enqueue-Only + Atomic Ingest Seam (Step 10K)

## Status

Accepted. Implemented in this step. Cross-process e2e remains 10L.

## Context

ADR-10H ("OCR Queue Boundary") staged the queue migration:

| Step | Scope |
|---|---|
| 10I | `SqliteOcrQueue` impl + schema v2 + conformance + contention. (Closed.) |
| 10J | Runtime/backend wiring in worker CLI. (Closed: commit `374dee3`.) |
| 10K | `ingest.ts` enqueue-only migration + transaction-capable seam. |
| 10L | Cross-process e2e (ingestion → bin worker → review). |

ADR-10H §"Atomicity caveat" pinned 10K's load-bearing requirement:

> Atomic `createOcrJob + enqueue` is a goal for 10K, not a property of
> 10H or even 10I. … A transaction-capable seam must be introduced …
> before `ingest.ts` migrates. Two viable shapes:
>
> - `OcrPersistence.withTransaction((tx) => …)`
> - A combined `enqueueNewOcrJob(submission, scenario?)` API on
>   `ocr-persistence` that wraps both writes in one transaction.

Pre-10K `ingest.ts` did six things in one synchronous call: validate →
`createOcrJob` → `enqueueOcrJob` → drive worker via `processNextOcrJob`
→ persist worker statuses + results → re-read. The "drive + persist"
sequence (steps 4–6) was wrong for any cross-process world; ADR-10H
flagged it explicitly. 10K is the step that removes it.

ADR-10H also bound a "Test migration rule":

> Synchronous lifecycle tests stay green until equivalent async
> read-model coverage exists. Deletion/replacement of a synchronous
> test must be paired in the same step with the async coverage that
> replaces it. No silent weakening. The current
> `services/ocr-review/tests/review.test.mjs` and
> `review.crossjob.test.mjs` are the fixed reference points.

## Decision

### 1. Atomic seam shape — combined `enqueueNewOcrJob`, optional method

10K adds an OPTIONAL method on the `OcrPersistence` interface:

```ts
enqueueNewOcrJob?(
  submission: unknown,
  queue: OcrJobQueueBackend,
  opts?: EnqueueNewOcrJobOptions,
): Promise<EnqueueNewOcrJobResult>;
```

The `queue` parameter is mandatory: the implementation MUST refuse to
write a queue row to a store the runtime queue cannot read. Same-store
identity is probed via `dbFilePath` exposed on both
`SqliteOcrPersistence` and `SqliteOcrQueue`.

The `dbFilePath` strings alone are not sufficient: two distinct
in-memory SQLite databases both report `:memory:`, so equality is
spoofable. An `isAtomicEligiblePath(path)` helper (exported from
`ocr-persistence`) gates the path-shape: it rejects `:memory:`, empty
strings, `file::memory:` URIs, and named URI memory variants such as
`file:foo?mode=memory&cache=shared`. Both `ingest.ts` and
`SqliteOcrPersistence.enqueueNewOcrJob` apply the gate before the
equality check, but their failure modes differ:

- `ingest.ts canTakeAtomicPath` returns `false` on mismatch or
  ineligible path; `ingestDocumentForOcr` then takes the non-atomic
  fallback (best-effort `createOcrJob` + `queueAdapter.enqueueOcrJob`).
- `SqliteOcrPersistence.enqueueNewOcrJob` REJECTS with
  `OcrPersistenceError("atomic enqueueNewOcrJob requires a SqliteOcrQueue
  on the same on-disk SQLite file")`. There is no implicit fallback at
  this layer — direct callers of the seam are responsible for choosing
  whether to retry through the non-atomic path.

- `EnqueueNewOcrJobOptions` carries `scenario`, `generateId`, `now`.
- `EnqueueNewOcrJobResult` returns `{ job: OcrJobRecord; enqueueResult: EnqueueResult }`.

Implementations that can guarantee atomicity (i.e. both writes commit
together or neither does) define this method. Implementations that
cannot (e.g. `InMemoryOcrPersistence`) MUST omit it; callers fall back
to the historical non-atomic sequence.

The capability-probe shape (`typeof persistence.enqueueNewOcrJob === "function"`)
beats a `withTransaction` callback for this codebase because:
- The only atomic write the ingest path needs is "createOcrJob + enqueue".
- A general `withTransaction` would expose the persistence's `Database`
  handle to callers — pre-empting 10K's design space exactly the way
  ADR-10H-A §6 ("Connection ownership") forbade for 10I.
- Optional methods compose cleanly with the existing fallback path; no
  caller in production has to know whether the underlying store is
  transactional.

### 2. SqliteOcrPersistence implementation

`SqliteOcrPersistence.enqueueNewOcrJob`:

1. Verifies the supplied `queue` shares the same SQLite file by
   comparing `dbFilePath` strings. Mismatch → `OcrPersistenceError`
   ("atomic enqueueNewOcrJob requires a SqliteOcrQueue on the same
   SQLite file"). The persistence writes the queue row into its own
   connection; if the runtime queue is on a different store the row
   would be invisible to the worker, so the call is refused at the
   seam rather than silently committing dead state.
2. Validates and clones the submission via the shared
   `validateAndCloneSubmission` helper (also used by `createOcrJob`).
3. Captures ONE wall-clock sample. `created_at` and the queue
   candidate's `enqueued_at` (and `enqueued_at_ms` on the queue row)
   are derived from that single `Date`. Test clocks that advance per
   call cannot make the two timestamps drift.
4. Opens ONE `db.transaction(() => { … }).immediate()` on the
   persistence connection containing:
   - a call to the shared private `insertOcrJobRow` helper (existence
     check + `INSERT INTO ocr_jobs`), AND
   - a call to the extracted free function
     `enqueueOcrJobIntoConnection(this.db, candidate, enqueuedAtMs)`,
     which performs the dedupe SELECT and the queue INSERT against the
     persistence's connection.
5. Returns `{ job, enqueueResult: { job: <queueRow>, deduped: <bool> } }`.

If either insert throws (validation, dedupe_conflict, "job already
exists", FK, or unique-violation), better-sqlite3 rolls back the
entire transaction. Neither row remains.

`wrapErrors` re-throws `OcrQueueError` verbatim (in addition to its
existing `OcrPersistenceError` passthrough), so callers can dispatch
on `.code === "dedupe_conflict"` rather than parsing a wrapped
"internal db error: …" message.

The shared `insertOcrJobRow` and `validateAndCloneSubmission` private
helpers are the only place the `ocr_jobs` INSERT body lives —
`createOcrJob` and `enqueueNewOcrJob` both call through them.

### 3. Queue body extraction (no SQL duplication)

`SqliteOcrQueue.enqueue` was refactored:

- The body inside `db.transaction(...).immediate()` was extracted into
  a free function `enqueueOcrJobIntoConnection(db, candidate, enqueuedAtMs)`
  exported from the same file (with a flagged "internal — exposed only
  for the 10K atomic seam" docstring).
- The class method now wraps a single call to that helper inside its
  own immediate transaction.

This is the only way to avoid duplicating the queue's dedupe + INSERT
SQL in two places (queue path and persistence atomic path), which would
have been a drift hazard.

`OcrJobQueueBackend` interface, `OcrQueueErrorCode` set, opaque receipt
rules, and existing tests are all unchanged.

### 4. ingest.ts — enqueue-only

Post-10K `ingestDocumentForOcr` does only:

1. Validate input → submission.
2. If the atomic path is reachable (persistence defines
   `enqueueNewOcrJob` AND the caller passed a `queue` whose
   `dbFilePath` matches the persistence's `dbFilePath`) → call it.
3. Else → `persistence.createOcrJob` then
   `queueAdapter.enqueueOcrJob`. This is the historical non-atomic
   sequence. If `queue.enqueue` throws after persistence succeeds, the
   `ocr_jobs` row LEAKS as an orphan — the 10C coordinator's path-B
   handles claimed-but-unknown-job (the inverse), not orphan-with-no-
   queue-row, so reconciliation is left to caller/operator policy.
4. Return `{ job, enqueueResult, atomic }`.

The `IngestDependencies` shape grew an optional `queue?:
OcrJobQueueBackend` field. Callers who want the atomic path pass it
alongside the adapter; callers who do not opt in stay on the fallback.

Removed:
- `processNextOcrJob` worker drive.
- Status timeline persistence (`appendOcrStatus` per worker outcome).
- Per-page result persistence (`saveOcrResult` per worker outcome).
- Read-back through persistence at the end of the call.

Those concerns now live in the worker process (the 10C coordinator
already implements them).

### 5. Test helper — `drainOcrPipelineForTesting`

A new helper in `ocr-ingestion/src/testing/drainPipeline.ts` loops
`processOneOcrQueueClaim` (the 10C entry point) until `empty`, with a
100-iteration ceiling. Tests that previously asserted on the post-OCR
state now run the helper after `ingestDocumentForOcr` returns.

The helper is **NOT** exported from the production root barrel.
Consumers reach for it via the explicit `ocr-ingestion/testing`
subpath export (declared in `package.json`'s `exports` field). That
keeps the coordinator + fake-worker testing code out of the main
runtime surface, so a production caller cannot pull the helper in by
accident.

Two reasons to centralize the helper rather than per-test boilerplate:
- The 10C coordinator IS the production worker's lifecycle. Anything
  the test helper does, the worker bin will do too.
- A single ceiling/timeout policy lives in one place; failing tests
  fail loudly rather than silently looping.

### 6. Test migration

Per ADR-10H "Test migration rule":

| Test | Migration |
|---|---|
| `ingestion.test.mjs` — success scenario | Migrated to `ingestAndDrain → coordinator drains → re-read via persistence`. Same assertions. |
| `ingestion.test.mjs` — partial_failure scenario | Migrated to drain helper. Same assertions. |
| `ingestion.test.mjs` — permanent_failure scenario | DELETED. 10C ADR Decision 12 explicitly rejects bundled DLQ output from the coordinator (the fake worker's permanent_failure trailing edge is `failed → dead_lettered`). The fake-worker scenario remains tested at the contract layer (`docs/contracts/tests/fake-worker.test.mjs`). |
| `ingestion.test.mjs` — transient_then_success scenario | DELETED. Same Decision 12 rejection (bundled retry chain `failed → queued → claimed → ...`). Contract-layer fake-worker tests cover the scenario. |
| `ingestion.test.mjs` — end-to-end via persistence | Repointed to the success scenario (the only ingestion-driven async-equivalent reachable through the coordinator). |
| `review.test.mjs` — success scenario | Migrated via `ingestAndDrain`. |
| `review.test.mjs` — partial_failure scenario | Migrated via `ingestAndDrain`. |
| `review.test.mjs` — permanent_failure assertions | Persistence-direct seeding. The read-model is what's under test; the route to the seeded state is irrelevant. Every prior assertion (`dead_lettered=true`, `terminal_state=dead_lettered`, `retry_count=0`, `failed_pages=1`, `succeeded_pages=0`) preserved. |
| `review.test.mjs` — transient_then_success assertions | Persistence-direct seeding. Every prior assertion (`terminal_state=succeeded`, `retry_count >= 1`, `succeeded_pages=1`) preserved. |
| `review.test.mjs` — `pages_needing_manual_review` | Unchanged (already used direct persistence writes). |
| `review.crossjob.test.mjs`, `pipeline.runtime.e2e.test.mjs` | No `ingestDocumentForOcr` usage; untouched. |

Net effect: the review read-model's fixed-reference assertions
(ADR-10H "review.test.mjs … fixed reference points") all remain
reachable. The ingestion-layer scenario tests for coordinator-rejected
fake-worker outputs were removed because their assertions are owned by
the contract layer; the same assertions exist there.

### 7. New 10K-specific tests

Persistence (`tests/sqliteAtomicEnqueue.step10k.test.mjs`):

- `InMemoryOcrPersistence` does not define `enqueueNewOcrJob`
  (capability-probe regression guard).
- `SqliteOcrPersistence` does define it.
- Atomic happy path: both `ocr_jobs` and `ocr_queue_jobs` rows visible
  after a single call.
- Scenario carries through into `job_json`.
- Persistence-side conflict (duplicate `job_id`) rolls back; no queue
  row appears.
- Queue-side `dedupe_conflict` rolls back; asserts typed
  `OcrQueueError.code === "dedupe_conflict"`.
- Idempotent retry (same job_id + equal canonical submission, after
  persistence row was removed mid-failure) returns deduped queue
  result and re-creates the persistence row.
- Invalid submission throws; nothing is written.
- Same-store probe rejects an `InMemoryOcrQueue` (different store).
- Same-store probe rejects a `SqliteOcrQueue` whose `dbFilePath`
  points at a different file.
- Same-store probe rejects two `:memory:` handles even though their
  `dbFilePath` strings match (eligibility gate).
- `isAtomicEligiblePath` unit test covers `:memory:`, empty,
  `file::memory:`, and named URI memory (`file:foo?mode=memory&...`).
- Cross-connection visibility: a separate `SqliteOcrQueue` opened on
  the same file (mimicking a worker process spawning post-ingestion)
  successfully `claimNext`s the row inserted by the atomic seam,
  observes resolved state after `completeClaim`, and a re-presented
  resolved receipt rejects with exact `unknown_receipt`.
- Same-process two-connection idempotency (two sequential calls,
  same submission, same file) → 1 `ocr_jobs` + 1 active queue row.
- Cross-thread contention via `worker_threads` (two worker threads
  racing on the same file) → exactly one fresh enqueue, one
  deduped-or-rejected; final state 1 `ocr_jobs` + 1 active queue row.

Ingestion (`tests/ingestion.test.mjs` + `tests/ingestion.sqlite.step10k.test.mjs`):

- `ingestDocumentForOcr` returns BEFORE the worker runs (no terminal
  state, no statuses, no results, queue depth = 1).
- In-memory persistence reports `atomic: false` (fallback path).
- Repeated submission with same `job_id` rejects without growing the
  queue.
- SQLite persistence + same-file SQLite queue → `atomic: true`; both
  rows committed.
- SQLite atomic path drains end-to-end via the coordinator and
  reaches `terminal_state: "succeeded"`.
- SQLite persistence + `InMemoryOcrQueue` → `atomic: false`; no
  SQLite queue row written; in-memory queue receives the job.
- SQLite persistence with no `queue` dep → `atomic: false`.
- SQLite atomic rollback through `ingestDocumentForOcr`: pre-existing
  `ocr_jobs` row → reject, no partial state.
- SQLite atomic rollback through `ingestDocumentForOcr`: pre-existing
  differing-canonical queue row → typed `OcrQueueError.code ===
  "dedupe_conflict"` (no message-regex fallback), no partial state.

## What 10K does NOT change

- `OcrJobQueueBackend` interface, error codes, receipt rules.
- 10C coordinator implementation.
- Worker loop, adapter, in-memory queue, queue types.
- Schema (still v2).
- 10J backend selector.
- ocr-worker-contract package.
- `ocr-review` source — only review tests changed.

## What 10K explicitly does NOT do

- Cross-process e2e (10L's job).
- Hard FK from queue rows to `ocr_jobs` (a v3 schema change for after
  the seam stabilizes).
- Multi-worker concurrency, lease renewal, back-off, DLQ enhancements.
- Generic `withTransaction` exposure on `OcrPersistence`.

## Acceptance — 10K itself

| Criterion | Status |
|---|---|
| `OcrPersistence.enqueueNewOcrJob` declared as optional, with `EnqueueNewOcrJobOptions` and `EnqueueNewOcrJobResult` types | ✅ |
| `SqliteOcrPersistence.enqueueNewOcrJob` implemented; both writes inside one BEGIN IMMEDIATE | ✅ |
| `enqueueOcrJobIntoConnection` factored from `SqliteOcrQueue.enqueue`; class method calls helper inside its own tx | ✅ |
| `InMemoryOcrPersistence` deliberately does NOT implement the optional method | ✅ |
| `ingest.ts` reduced to enqueue-only; worker drive removed | ✅ |
| `IngestionOutcome` narrowed to `{ job, enqueueResult, atomic }` | ✅ |
| `drainOcrPipelineForTesting` exported from `ocr-ingestion`; uses the 10C coordinator | ✅ |
| `ocr-ingestion` tests pairwise migrated; coordinator-rejected scenarios deleted with rationale | ✅ |
| `ocr-review/tests/review.test.mjs` pairwise migrated; every prior assertion preserved | ✅ |
| New 10K failure-mode tests added (atomic happy path, persistence rollback, queue rollback, idempotent retry, validation) | ✅ |
| All five package test suites green (contract 73, persistence 205, worker 164, ingestion 27, review 38; total 507) | ✅ |
| `OcrJobQueueBackend` interface, error codes, receipt rules untouched | ✅ |
| 10C coordinator untouched | ✅ |
| 10J backend selector untouched | ✅ |
| ADR file `docs/adr/ocr-ingest-enqueue-only-step-10k.md` exists | ✅ |

## Consequences

- The atomic ingest seam is reachable. Both `ocr_jobs` and the queue
  row commit together when persistence is SQLite. Either one or the
  other rolls back — never partial state.
- Production runtime is now stage-correct for 10L: ingestion enqueues
  only; a separate worker process (services/ocr-worker bin) is the
  only thing that drives the worker and persists status timelines and
  per-page results.
- The non-atomic fallback (in-memory persistence, or SQLite without
  the optional `queue` dep) still works. If `queue.enqueue` throws
  AFTER persistence succeeded, the resulting `ocr_jobs` row is
  ORPHANED — there is no queue row, no claim, no terminal state, and
  10C does NOT auto-reconcile this direction (its path-B handles
  claimed-but-unknown-job, the inverse). Reconciliation is caller /
  operator policy: surface the error, retry with the same submission
  (idempotent at the queue once it succeeds), or admin-clean the
  orphan.
- `IngestionOutcome` is a breaking shape change inside this monorepo.
  Every caller in this repo was migrated in the same step.
- The ingestion-layer assertion surface for the fake-worker
  `permanent_failure` and `transient_then_success` scenarios was
  removed in favor of contract-layer coverage. This is the correct
  boundary: those scenarios test the fake worker's output shape, not
  ingestion behavior.
