# ADR: OCR Queue Boundary (Step 10H)

## Status

Accepted as **decision-only**. No implementation lives in this step.
Implementation is staged into 10I → 10J → 10K → 10L (see §"Staging" below).

## Context

The runtime path now composes end-to-end in two narrow shapes:

- **10F** proved the runtime composes against an in-memory queue and an
  in-memory persistence inside a *single Node process* with a fake
  `EventEmitter` for `process` (see
  `docs/adr/ocr-pipeline-runtime-integration-step-10f.md`).
- **10G** proved the bin wrapper handles real `argv` / `env` /
  `stdout` / `stderr` / `SIGINT` / `process.exitCode` (see
  `docs/adr/ocr-worker-bin-wrapper-step-10g.md`).

What still does not exist anywhere in the repo:

1. A queue backend that survives a process exit.
2. Any way for *another* process to enqueue work that the worker bin
   process can claim. The default `buildDeps` in
   `services/ocr-worker/src/cli.ts` constructs a per-process
   `InMemoryOcrQueue`; nothing reaches it from outside.
3. A migration of `services/ocr-ingestion/src/ingest.ts`, which still
   drives the worker synchronously inside the same call (see
   `ingest.ts` lines 4–13 + 71–82). Its top-of-file comment promises
   "we persist before enqueueing so a crash between enqueue and the
   next persistence call cannot leave a queued job with no record" —
   currently true only because the loop is in-process. The promise
   wants atomicity in any cross-process world.

10C (`docs/adr/ocr-processing-coordinator-step-10c.md`) already
established the boundary: **persistence is the source of truth; the
queue is transport.** The `OcrJobQueueBackend` seam in
`services/ocr-worker/src/types.ts` (lease / receipt / dedupe-by-job_id /
five `OcrQueueErrorCode` codes) was deliberately abstract enough to
admit a non-memory implementation.

10H records the *boundary decision* for what that durable backend
should look like. It does not implement it.

## Decision

Use a **SQLite-backed queue, co-located in `ocr-persistence`,
implemented behind the existing `OcrJobQueueBackend` interface from
`ocr-worker`**. Reject Redis / BullMQ / SQS / Postgres-queue libraries
for now. Reject "persistence-as-claim-source" (no queue interface).
Reject a brand-new `ocr-queue` package.

### Mechanism

The choice is justified, in order, by:

1. **Single-host repo posture.** Sibling packages via `file:` deps. No
   monorepo runner. No compose file. No infra dir. No k8s manifests.
   Distributed-queue infrastructure would be speculative scale.
2. **Atomicity reachable later in *one* DB file.** A future
   transaction-capable seam (see §"Atomicity caveat") can keep the
   `ingest.ts` "persist before enqueue" promise honest. Two
   storage backends (Postgres + Redis, SQLite + BullMQ) cannot do this
   without 2PC or sagas — both heavier than the problem.
3. **Crash recovery is free.** Lease expiry via `claimed_until < now`
   already mirrors the lazy-on-claim sweep semantics in
   `services/ocr-worker/src/inMemoryQueue.ts` (lines 11–22, lines
   320–331). The same shape, just on disk.
4. **Idempotency already paid for.** `OcrProcessingCoordinator`
   (10C) calls `appendOcrStatusOnce` / `saveOcrResultOnce`.
   At-least-once redelivery is a no-op on the persistence side.
5. **`OcrJobQueueBackend` survives intact.** The interface, dedupe
   rules, opaque receipts, and five `OcrQueueErrorCode` values
   (`dedupe_conflict` / `unknown_receipt` / `stale_receipt` /
   `lease_expired` / `invalid_claim`) are abstract enough to back with
   SQL. No coordinator / workerLoop / cli / config / processSignals
   semantic change is forced *by 10H*. (10I/10J/10K do require config
   wiring; see §"Staging".)

Rejected, briefly, with mechanism:

| Option | Why rejected |
|---|---|
| Persistence-as-claim-source (no queue iface) | Inverts 10C's transport seam. Coordinator already built against `OcrJobQueueBackend`. Demolishes a working abstraction for nothing. |
| Redis/BullMQ/SQS/Postgres-queue | No repo evidence demanding distributed scale. Adds infra, deps, ops surface, and a queue-vs-persistence drift surface. Add later if real load arrives. |
| New sibling `ocr-queue` package | Same SQLite file, separate package. Forces a third package edge to know the persistence DB path. Net cost without isolation benefit, since the queue table will live in the persistence DB anyway. |

### Atomicity caveat — required, load-bearing

**Atomic `createOcrJob + enqueue` is a goal for 10K, not a property of
10H or even 10I.**

It is **not** buildable behind today's public APIs:

- `OcrPersistence.createOcrJob(...)` and
- `OcrJobQueueBackend.enqueue(...)`

are split across two interfaces with no shared transaction scope.
Putting both row writes in the same SQLite *file* is a necessary, not
sufficient, condition. A transaction-capable seam must be introduced
in 10I or 10K before `ingest.ts` migrates. Two viable shapes:

- `OcrPersistence.withTransaction((tx) => …)` taking a transactional
  handle that both `createOcrJob` and the SQL queue's `enqueue` can
  use.
- A combined `ocr-persistence` API, e.g. `enqueueNewOcrJob(submission,
  scenario?)`, that wraps `createOcrJob + enqueue` in one
  transaction.

10H does not pick. It records that the choice is required before
ingest migration and that pre-10K ingestion will continue to follow
the existing non-atomic "persist, then enqueue" sequencing — which the
10C coordinator already tolerates via its path-B "claimed but unknown
job → persistence_failed → requeue" handling.

### Package ownership

- `ocr-persistence` **owns physical SQLite storage**, including the
  queue table(s).
- Queue rows are **transport state**, not OCR source of truth.
- OCR truth remains in `ocr_jobs`, `ocr_status_events`,
  `ocr_results` (see `services/ocr-persistence/src/sqlite/schema.ts`).
  Queue-row state must never be read as lifecycle truth.
- The `SqliteOcrQueue` class will live in **`ocr-persistence`**.
- It will implement **`OcrJobQueueBackend` from `ocr-worker`**
  (`services/ocr-worker/src/types.ts`). The interface is unchanged.
- The runtime worker (10J) will construct it instead of
  `InMemoryOcrQueue` for the production code path. `InMemoryOcrQueue`
  stays as the default test/dev seam.

This co-location is **package ownership**, not **domain ownership**.
Persistence owning the queue file is what makes a future shared
transaction possible; it does not promote queue rows to source of
truth.

### Applicability — when this decision applies

- single host
- one SQLite DB file on local filesystem
- one (or modest) worker-process concurrency

### Revisit criteria — when to reopen this ADR

- multi-host workers required
- DB lives on a network filesystem (NFS, SMB, EFS, etc.)
- sustained `SQLITE_BUSY` / write contention observed
- independent queue scaling needed (queue throughput
  dwarfs persistence throughput)
- stronger queue observability or retention required than SQLite
  ergonomics support
- managed cloud queue semantics (DLQ-as-service, deferred delivery,
  fan-out) become product or ops requirements

If any of the above appears, 10H is no longer load-bearing — replace
with a new ADR that picks a different backend.

### Decision applicability — what this is NOT

- not a claim of multi-host readiness
- not a claim of distributed-queue readiness
- not a production deployment posture (single-host SQLite is a
  durability step, not a deployment topology)
- not a commitment to ship a real migration framework
- not a commitment that `ingest.ts` migrates in 10H or 10I

## Intended 10I shape (informational, not committed)

The following is what 10I will *attempt*, recorded here so 10I has
something concrete to react against. **None of this is implemented in
10H.** Schema diagrams below are intent, not DDL.

### Schema delta (10I)

- `CURRENT_SCHEMA_VERSION` bumps **1 → 2** in
  `services/ocr-persistence/src/sqlite/schema.ts`.
- New table(s), additive only:
  - one queue table (provisional name `ocr_queue_jobs` or similar,
    final name picked in 10I) keyed by a transport id, carrying
    `job_id`, `submission_json` payload, `worker_id`, `claimed_at`,
    `claimed_until`, `receipt`, `enqueued_at`, optional `scenario`
    (test only — see §"Scenario / test seam").
  - partial unique index on `submission_job_id` while not
    terminal-resolved, to enforce the active-job dedupe rule from the
    `OcrJobQueueBackend` contract.
- Index to support `claim_next` ordering by `enqueued_at` among
  unclaimed-or-expired rows.
- FK from queue rows to `ocr_jobs(job_id)` is desirable (transactional
  enqueue assumes both rows land together) but final FK choice is a
  10I decision because pre-10K enqueue will not be atomic.

### Lease semantics (10I must pin)

- **Lease duration source.** Default lease length and where it is
  configured (constructor option vs config). The in-memory backend
  uses 30s as `DEFAULT_LEASE_MS`
  (`services/ocr-worker/src/inMemoryQueue.ts:35`); 10I should match
  the same default unless it has a reason not to.
- **Reclaim trigger.** Default expectation: lazy-on-`claim_next`
  (matches in-memory). No background sweeper unless concurrent
  testing in 10I shows it is necessary.
- **Clock authority.** Either Node-side `now()` or SQLite-side
  `strftime('%Y-%m-%dT%H:%M:%fZ','now')`. 10I picks one with
  reasoning; the choice affects skew between processes and test
  determinism. The in-memory backend uses an injectable Node clock,
  which is the natural starting point.
- **Receipt lineage.** The in-memory backend keeps an `issuedReceipts`
  set
  (`services/ocr-worker/src/inMemoryQueue.ts:118-126`,
  `:293-315`) so it can distinguish `unknown_receipt` (never
  issued) from `stale_receipt` (issued, then resolved, slot now owned
  by a different receipt). 10I must reproduce this discrimination
  durably across restarts — likely via a column on the queue row
  (current owner) and either a retention rule for resolved receipts
  or an SQL rule that infers `stale_receipt` from "row exists with a
  *different* receipt".
- **Queue-row lifecycle.** State transitions and row disposal must be
  recorded for: `complete` (delete? mark resolved? archive?),
  terminal-skip (10C path A), `requeueClaim`, expired-lease reclaim.
  Default expectation: completed rows are deleted; expired rows return
  to the waiting set in place; terminal-skip rows are deleted. 10I
  decides.

### `OcrJobQueueBackend` parity

10I must pass the same conformance suite as `InMemoryOcrQueue`
(`services/ocr-worker/tests/inMemoryQueue.conformance.test.mjs`),
including the five-error taxonomy, dedupe-by-canonical-submission, and
lease/sweep semantics.

## SQLite contention policy intent (10I requirements)

10I is required to:

- Enable WAL on the queue connection (or explicitly evaluate why not).
  Persistence already enables WAL in
  `SqliteOcrPersistence`; the queue uses the same DB.
- Set `busy_timeout` to a deliberate value (not the default 0).
- Treat `SQLITE_BUSY` deliberately: either `busy_timeout` blocks the
  call up to a chosen ceiling, or the operation surfaces a documented
  error code on contention. Whichever is chosen must be explicit.
- Include concurrent enqueue/claim/ack/expire tests, or equivalent
  contention coverage. The current persistence hardening tests are a
  starting reference (`services/ocr-persistence/tests/sqlite.*`).
- Recognize that `better-sqlite3` is synchronous under the hood. The
  `OcrJobQueueBackend` interface stays async; the SQL implementation
  resolves immediately, and write serialization is whatever SQLite
  itself provides.

## Migration framework caveat

The repo has **no robust migration framework**.
`services/ocr-persistence/src/sqlite/schema.ts` records v1 via
`INSERT OR IGNORE INTO schema_version` and runs DDL idempotently. That
is fine for additive moves and not fine for rewrites.

10I must therefore:

- ship a v2 that is **additive only** (no `ALTER TABLE` rewrites, no
  column removals, no PK changes on existing tables);
- keep `applySchema` idempotent — re-running on a v2 DB is a no-op;
- state explicitly that **mixed-version binary deployments are not
  supported**: if a process running v1 binary opens a v2 DB, behavior
  is undefined unless 10I adds a guard. 10I should at minimum log /
  refuse on unexpected `schema_version`.

10H does not add v2.

## Scenario / test seam

`OcrJob.scenario` (`services/ocr-worker/src/types.ts:35`) currently
travels with the queue payload to force a fake-worker outcome in
tests. It is a deliberate test/dev seam.

10I must choose:

- **persist `scenario` in the queue row JSON, test/dev use only**, and
  document it as a non-production field (and keep `OcrJob.scenario`'s
  current "production callers omit it" comment), or
- **replace it with a different fake-worker injection seam** that
  doesn't ride on the queue payload (e.g., scenario-by-job-id map in
  the worker construction).

10H does not pick. The risk recorded here is: do not let `scenario`
quietly become a production contract.

## Runtime config intent

- **Default intent for 10J:** queue uses the **same SQLite path** as
  persistence. One file, two connections (or one connection — 10J
  decides), no separate queue path config key.
- **Do not** add a queue-backend selector or queue path key in 10I or
  10J unless evidence forces it (e.g., separate ops requirement to
  put the queue file on a different disk).
- Runtime/backend wiring (CLI flag or env var to switch from
  `InMemoryOcrQueue` to `SqliteOcrQueue`) is **10J's job**, not
  10H's. 10I builds the implementation; 10J wires it; 10K migrates
  ingest; 10L proves cross-process.

## Staging

The plan reviewer flagged that bundling runtime + ingest + e2e into a
single 10J was too much risk for one step. Restaged:

| Step | Scope | Output |
|---|---|---|
| **10H** | This ADR. | `docs/adr/ocr-queue-boundary-step-10h.md`. No code. |
| **10I** | `SqliteOcrQueue` implementation in `ocr-persistence`, schema v2 (additive), conformance against `InMemoryOcrQueue`, contention coverage. | New impl class, schema v2, tests. No CLI/config change. No ingest migration. |
| **10J** | Runtime/backend wiring: `services/ocr-worker/src/cli.ts` `buildDeps` can construct `SqliteOcrQueue` using the same DB path persistence already configures. | CLI/config can select SQLite queue. `InMemoryOcrQueue` stays the default for tests/dev. |
| **10K** | `ingest.ts` enqueue-only migration. Introduce the transaction-capable seam (see §"Atomicity caveat"). Migrate review/ingestion tests pairwise (see §"Test migration rule"). | Ingest no longer drives worker synchronously. Atomic createOcrJob + enqueue. Tests still green. |
| **10L** | Cross-process e2e: ingestion process enqueues, spawned worker bin claims via `bin/ocr-worker.mjs`, review observes terminal state through persistence reads. | New integration test home (likely `services/ocr-review`), no production wiring change. |

This ordering moves risk: 10I is mechanical conformance, 10J is small
wiring, 10K is the real semantic change (with the transaction seam
required), 10L is observation-only.

## Test migration rule

When 10K (and possibly later steps) reshapes synchronous-lifecycle
tests:

- Synchronous lifecycle tests stay green **until** equivalent async
  read-model coverage exists.
- Deletion/replacement of a synchronous test must be **paired in the
  same step** with the async coverage that replaces it. No silent
  weakening.
- The current `services/ocr-review/tests/review.test.mjs` and
  `review.crossjob.test.mjs` are the fixed reference points; their
  assertions must remain reachable through whatever path replaces
  the synchronous one.

## Acceptance criteria — for 10H itself

| Criterion | Result |
|---|---|
| `docs/adr/ocr-queue-boundary-step-10h.md` exists and records boundary, decision, mechanism, atomicity caveat, package ownership, applicability, revisit criteria, intended 10I shape, contention policy intent, migration caveat, lease/scenario/runtime intent, staging, test migration rule, non-goals | ✅ |
| No source files in any package modified | ✅ |
| No `package.json` modified | ✅ |
| No schema, no migration, no SqliteOcrQueue impl, no test added | ✅ |
| `services/ocr-ingestion/src/ingest.ts` unchanged | ✅ |
| Coordinator / workerLoop / cli / config / processSignals / adapter / inMemoryQueue / types untouched | ✅ |

## Non-goals — strict

10H does **not**:

- implement `SqliteOcrQueue`
- add schema v2 (no DDL change)
- add a migration framework
- add a transaction-capable seam (`withTransaction`,
  `enqueueNewOcrJob`, …)
- migrate `services/ocr-ingestion/src/ingest.ts`
- change `cli.ts` / `config.ts` / `processSignals.ts`
- change `coordinator.ts` / `workerLoop.ts`
- add cross-process e2e tests
- choose Redis / BullMQ / SQS / Postgres queue libraries
- claim production or distributed-queue readiness
- add retry / back-off / DLQ / lease-renewal / concurrency-greater-than-1
- add a root `package.json` or convert to a workspace
- add new top-level dependencies
- pre-decide where `scenario` lives in 10I
- pre-decide Node-vs-SQLite clock authority
- pre-decide queue-row lifecycle disposal rules
- pre-decide whether the FK from queue rows to `ocr_jobs` is enforced
  before 10K's atomicity seam lands

These are 10I+ concerns. They are listed here so future readers do
not infer them from "the repo has chosen SQLite for the queue."
