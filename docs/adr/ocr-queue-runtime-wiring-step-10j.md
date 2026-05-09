# ADR: OCR Queue Runtime Wiring (Step 10J)

## Status

Accepted. Implemented in this step. No ingest migration; no cross-process
e2e. Those remain 10K and 10L per ADR-10H staging.

## Context

ADR-10H ("OCR Queue Boundary") chose a SQLite-backed queue co-located in
`ocr-persistence`, implementing the existing `OcrJobQueueBackend` seam in
`ocr-worker`. ADR-10H also pinned the staging:

| Step | Scope |
|---|---|
| 10I | `SqliteOcrQueue` impl + schema v2 + conformance + contention. |
| 10J | Runtime/backend wiring in the worker CLI. |
| 10K | `ingest.ts` enqueue-only migration + transactional ingest seam. |
| 10L | Cross-process e2e (ingestion → bin worker → review). |

10I closed at commits 7419c14 ("Extend queue conformance for SQLite
backend") and 1454713 ("Add SQLite queue contention hardening"). The
implementation, schema, and conformance harness are in place.

What 10I did *not* do (and 10H deferred to 10J):

- No CLI flag or env var to select `SqliteOcrQueue` over the default
  `InMemoryOcrQueue`.
- No `buildDefaultDeps` branch that constructs the SQLite queue.
- No ADR-recorded decision about how the queue and persistence connect
  to the same SQLite file.

10J fills exactly those gaps and nothing more.

## Decision

### 1. Selector shape

A new `--queue <memory|sqlite>` flag and `OCR_WORKER_QUEUE` env var
mirror the existing persistence selector in
`services/ocr-worker/src/config.ts`.

| | |
|---|---|
| Flag | `--queue <memory\|sqlite>` |
| Env  | `OCR_WORKER_QUEUE` |
| Default | `memory` |
| Precedence | argv > env > default (matches persistence) |
| Repeated flag | rejected (matches persistence) |
| Invalid value | rejected with `OcrWorkerConfigError("invalid queue: …")` |
| `--help` short-circuit | returns `queue: "memory"` |

The default stays `memory` because every existing test path —
adapter, conformance, coordinator, workerLoop, review/ingestion
fixtures — relies on `InMemoryOcrQueue`. ADR-10H requires that the
in-memory backend "stays as the default test/dev seam".

### 2. Path reuse

`queue=sqlite` reuses `--sqlite-path` / `OCR_WORKER_SQLITE_PATH`. There
is no separate queue path key. ADR-10H §"Runtime config intent"
explicitly forbids one unless an ops requirement to put queue and
persistence on different disks emerges; no such requirement exists.

### 3. Cross-config validation

`queue=sqlite` requires `persistence=sqlite`:

```
queue=sqlite + persistence=memory  →  OcrWorkerConfigError
  "queue=sqlite requires persistence=sqlite (queue and persistence
   share the SQLite file)"
```

Justification: the queue and persistence share one SQLite file by
design. With `persistence=memory` the queue would be the only consumer
of the SQLite file, which:

- contradicts ADR-10H's "one file" intent,
- separates the OCR truth (jobs / status / results) from the queue
  rows that depend on those jobs (a 10K transactional concern would
  then never be reachable),
- and silently invites the operator to mistake `--persistence=memory
  --queue=sqlite` for "durable enough" — durability of OCR truth is the
  whole reason the queue moved off memory in the first place.

The reverse (`queue=memory` + `persistence=sqlite`) IS allowed. It is
the existing 10E path; nothing in 10J changes its behavior.

### 4. Connection model — two connections, one file

When `queue=sqlite` and `persistence=sqlite`:

- `openSqliteOcrPersistence({ path })` opens its own better-sqlite3
  handle, configures WAL + `synchronous=NORMAL`, applies the
  persistence schema.
- `openSqliteOcrQueue({ path })` opens a *separate* better-sqlite3
  handle to the *same* file, configures WAL + `synchronous=NORMAL` +
  `busy_timeout=5000`, applies the queue schema.

10J explicitly chooses two connections rather than a shared one:

- The worker side never writes queue+persistence in a single
  transaction. `OcrProcessingCoordinator` (10C) runs persist-first,
  ack-second, idempotent on persistence (`appendOcrStatusOnce` /
  `saveOcrResultOnce`). At-least-once redelivery is a no-op.
- A shared connection would be required only for transactional ingest
  (createOcrJob + enqueue in one tx). That seam is 10K's responsibility,
  on the ingest side, not 10J's worker side.
- WAL allows concurrent readers + a single writer without blocking.
  `busy_timeout=5000` is the queue's defense against transient
  `SQLITE_BUSY` when both connections briefly contend (covered by 10I-B2
  contention tests).
- Two connections keep ownership clean: each backend's factory closes
  its own handle. No tangled lifecycle, no "who owns the db" branching
  in `cleanup`.

If a future ingest seam (10K) needs a shared transactional connection,
that wiring lives in `ingest.ts` and is allowed to bypass these
factories. 10J does not pre-build that seam.

### 5. Lifecycle

`buildDefaultDeps` returns a `cleanup` that closes both handles in
order:

1. `queue.close()` — releases the queue's WAL writer slot first.
   `SqliteOcrQueue.close()` closes its own DB handle when the factory
   set `ownsDb=true` (which `openSqliteOcrQueue` does).
2. `persistenceDb.close()` — closes the persistence handle.

The CLI's existing `safeCleanup` wrapper ensures errors during
shutdown are logged to stderr without taking down the process.

### 6. Help text

`HELP_TEXT` in `cli.ts` documents the new flag, the env var, and the
cross-validation rule:

```
--queue <memory|sqlite>             Queue backend (default: memory)
                                    sqlite requires --persistence=sqlite;
                                    shares --sqlite-path with persistence.
```

## What 10J does NOT change

Per ADR-10H staging, all of the following stay untouched:

- `services/ocr-ingestion/src/ingest.ts`. Synchronous in-process
  enqueue + drive remains. Migration to enqueue-only is 10K.
- `OcrProcessingCoordinator`, `runOcrWorkerLoop`, `OcrWorkerAdapter`.
- `InMemoryOcrQueue`. Stays the default; behavior unchanged.
- `OcrJobQueueBackend` interface, `OcrQueueErrorCode` set, opaque
  receipts, dedupe semantics. The five queue error codes
  (`dedupe_conflict`, `unknown_receipt`, `stale_receipt`,
  `lease_expired`, `invalid_claim`) are stable.
- `SqliteOcrQueue` impl, schema v2, lease accounting, clock authority.
  10I closed those; 10J only constructs the class.
- Cross-process e2e. Ingestion still drives the worker in-process for
  every existing test. 10L is when a separate worker bin claims jobs
  enqueued by an ingestion process.

## Acceptance — 10J itself

| Criterion | Status |
|---|---|
| `--queue <memory\|sqlite>` flag and `OCR_WORKER_QUEUE` env recognized | ✅ |
| Default `memory` preserved when neither set | ✅ |
| `queue=sqlite` requires `persistence=sqlite` (config error otherwise) | ✅ |
| `queue=sqlite` reuses `--sqlite-path`; no new path key introduced | ✅ |
| `buildDefaultDeps` constructs `SqliteOcrQueue` for `queue=sqlite` | ✅ |
| Two separate connections to the same SQLite file (one per backend) | ✅ |
| `cleanup` closes both DB handles | ✅ |
| `cli.sqlite.test.mjs` proves a second worker run on the same file succeeds (no leaked locks) | ✅ |
| All existing service tests still green: contract, persistence, worker, ingestion, review | ✅ |
| `coordinator.ts` / `workerLoop.ts` / `adapter.ts` / `inMemoryQueue.ts` / `types.ts` unchanged | ✅ |
| `ingest.ts` unchanged | ✅ |
| New ADR file `ocr-queue-runtime-wiring-step-10j.md` | ✅ |

## Consequences

- An operator can now run the worker bin against a durable SQLite
  queue:

  ```
  OCR_WORKER_PERSISTENCE=sqlite \
  OCR_WORKER_QUEUE=sqlite \
  OCR_WORKER_SQLITE_PATH=/var/lib/lawbar/ocr.db \
    node services/ocr-worker/bin/ocr-worker.mjs
  ```

  ...but *nothing else has been migrated to enqueue into that queue
  cross-process yet*. Until 10K, the only producer of work is the
  in-process `ingest.ts` flow that still constructs its own queue
  inside the same Node process. 10J is necessary but not sufficient
  for cross-process operation.

- The two-connection model under WAL is the simplest defensible
  choice today. If 10K decides it needs a shared transaction across
  `createOcrJob` + queue insert, the ingest seam will introduce its
  own shared `Database` and pass it into both `SqliteOcrPersistence`
  and `SqliteOcrQueue` constructors directly (both already accept a
  caller-owned `db`). 10J's factory-based wiring does not block that.

- `--queue` adds a third combinatoric to the CLI's startup matrix
  (persistence × queue × sqlite_path). The cross-validation rule
  collapses the matrix back to three legal combinations:

  | persistence | queue | sqlite_path | legal |
  |---|---|---|---|
  | memory | memory | unset | ✅ default |
  | sqlite | memory | required | ✅ existing 10E path |
  | sqlite | sqlite | required | ✅ new in 10J |
  | memory | sqlite | * | ❌ rejected |
  | * | * | empty when sqlite needed | ❌ rejected |
