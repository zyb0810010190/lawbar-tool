# ADR: OCR Queue Boundary — Amendment (Step 10H-A)

## Status

Accepted as **decision-only**. Amends, but does not replace,
`docs/adr/ocr-queue-boundary-step-10h.md`. No implementation, no
schema, no code change, no test, no package.json edit lives in this
step. Implementation is staged into 10I → 10J → 10K → 10L per 10H.

## Context

10H ("OCR Queue Boundary") chose a SQLite-backed queue, co-located in
`ocr-persistence`, implementing `OcrJobQueueBackend` from
`ocr-worker`, with persistence as the source of truth and the queue
as transport. The 10I plan-review surfaced three design blockers that
must be settled in writing before any 10I code is written:

1. **Queue type / interface ownership would create a runtime package
   cycle.** `ocr-persistence` depending on `ocr-worker` (file:`../`
   dep) for the `OcrJobQueueBackend` interface and supporting types
   inverts the current dep direction (`ocr-worker` → contract) and
   couples persistence to the runtime worker package.
2. **SQL row lifecycle.** A naive "DELETE on complete" implementation
   destroys receipt lineage. The `OcrJobQueueBackend` contract
   requires that a returned receipt outlive its claim long enough to
   distinguish `unknown_receipt` (never existed) from `stale_receipt`
   (already resolved / superseded). Restart must not collapse those
   into one indistinguishable case.
3. **FK timing, connection ownership, and contention coverage.**
   Three smaller but load-bearing implementation knobs cannot be
   left to 10I implementer judgment without locking the project into
   choices that 10K (atomic ingest) cannot reverse cheaply.

10H-A records the amended boundary so 10I has a single source of
truth to react against. It does not implement, schema-migrate, or
move any source file.

## Decisions

### 1. Queue type ownership — relocate to neutral contract package

The queue transport types and error model move from `ocr-worker` to
the neutral contract package (`docs/contracts`, treated as the
`ocr-worker-contract` runtime package) in **10I**. This is a 10I
move, not a 10H-A move; this ADR only commits the direction.

- Target export path: `docs/contracts/src/queue.ts` (final filename
  is a 10I implementation detail; one file is preferred over a
  subdir for grep-ability and to mirror existing flat layout in
  `docs/contracts/src/`).
- Types relocated:
  - `OcrJobQueueBackend`
  - `OcrJob`
  - `OcrQueueClaim`
  - `OcrQueueError`
  - `OcrQueueErrorCode`
  - `EnqueueResult`
- `ocr-worker` re-exports the relocated symbols from its
  `services/ocr-worker/src/types.ts` so existing internal imports
  (`coordinator.ts`, `workerLoop.ts`, `inMemoryQueue.ts`,
  `adapter.ts`, `cli.ts`) keep compiling without source-level churn.
- `ocr-persistence` imports the relocated symbols **directly from
  the contract package**, not from `ocr-worker`.
- **Hard rule:** `services/ocr-persistence/package.json` must not
  list `ocr-worker-adapter` (or any path reaching back into
  `services/ocr-worker`) as a runtime `dependency`. Dev / test deps
  remain a separate question, see §2.

This avoids the `ocr-worker` ↔ `ocr-persistence` runtime cycle that
would otherwise materialize the moment `SqliteOcrQueue` exists.

#### Why neutral, not bidirectional

The contract package is already the architectural hub
(schemas + validators + state machine + retry classifier). Adding
the queue-transport seam beside the OCR-state seam is consistent
with what the contract package is *for*: the wire-shape vocabulary
two packages must agree on without depending on each other's
runtime. Persistence and worker are siblings; one cannot be the hub
of the other without inversion.

### 2. Conformance harness ownership

The queue conformance suite at
`services/ocr-worker/tests/inMemoryQueue.conformance.test.mjs` proves
behavior of *the interface*, not of the in-memory implementation
specifically. Both `InMemoryOcrQueue` and `SqliteOcrQueue` must pass
the same matrix.

10I should pursue, in order of preference:

1. **Neutral shared test helper.** A test-only module exporting a
   suite factory that takes a queue-instance fixture and registers
   the standard `node:test` tests. Two thin test files (one per
   implementation) call the factory. Likely home: contract package
   under a `testing/` subpath (it already has
   `docs/contracts/src/testing/fake-worker.ts` and a
   `ocr-worker-contract/testing` subpath export, so the precedent
   exists).
2. **Minimal duplication.** Permitted only if neutral sharing
   creates disproportionate package / test-script friction
   (e.g. forces a new `devDependency` edge that pulls
   `ocr-worker` runtime artifacts into `ocr-persistence` test
   builds). Duplicated suite must be byte-equivalent except for the
   factory and import lines, and any drift becomes a 10I bug.

The goal is binding: the two implementations prove the same
behavior. How they share is a 10I choice; whether they share is
not.

### 3. Row lifecycle — no hard-delete on complete

`SqliteOcrQueue` **must not** treat row deletion as the only
state transition for a completed claim. Concretely:

- A `completeClaim(claim)` call must not result in `DELETE FROM
  ocr_queue_jobs WHERE …` as the *only* effect.
- The `OcrJobQueueBackend` contract requires that subsequent
  `completeClaim` / `renewClaim` / `requeueClaim` calls bearing the
  same receipt distinguish `unknown_receipt` from `stale_receipt`.
  Hard-delete collapses both into "row not found", which is wrong
  on its face and worse across restart.
- This must hold across process restart: a coordinator that crashed
  *between* worker success and `completeClaim` must, on the next
  boot, call `completeClaim` with the same receipt and observe a
  benign idempotent outcome — not `unknown_receipt`.

Accepted shapes (10I picks one, ADR lists both as acceptable):

- **Tombstone / resolved-state column.** A `state` enum on the
  queue row (e.g. `enqueued | claimed | resolved`) plus a
  `resolved_at` timestamp; resolved rows stay in the table long
  enough to satisfy receipt lineage. Retention policy
  (rows-vs-time-vs-count) is a 10I decision but must be explicit.
- **Separate receipt ledger.** Active queue rows live in one
  table, resolved-receipt records (receipt id, terminal state,
  resolved_at) in a sibling ledger table. `completeClaim` writes
  the ledger row and removes the active row in the same SQLite
  transaction.

10I must preserve `unknown_receipt` vs `stale_receipt` semantics
across restart and prove it with a test that round-trips through a
real database file (see §9).

### 4. FK timing — no strict queue → ocr_jobs FK in schema v2

Schema v2 (10I) **must not** declare a strict
`FOREIGN KEY (job_id) REFERENCES ocr_jobs(job_id)` constraint on
queue rows.

- Rationale: pre-10K conformance tests, and the InMemoryOcrQueue
  conformance suite they will be adapted from, create queue jobs
  through the queue seam alone — there is no `ocr_jobs` row at
  conformance test time. Enforcing the FK in v2 forces every
  conformance test to also exercise `ocr-persistence.createOcrJob`,
  which couples the two seams precisely where 10C said they should
  stay decoupled.
- Pre-10K ingestion follows the existing non-atomic
  "persist, then enqueue" sequencing
  (see `services/ocr-ingestion/src/ingest.ts` lines 4–13 + 71–82
  per 10H). 10C path-B (claimed-but-unknown-job → `persistence_failed`
  → requeue) already tolerates the brief inconsistency.
- The FK becomes appropriate **only after** a transaction-capable
  ingest seam exists (10K), at which point a v3 migration can add
  it. 10I is not the right time.
- 10I may still record a *non-enforcing* index or comment marking
  `job_id` as a logical reference, if useful for future migration
  authoring; that is a 10I implementation detail.

### 5. Transaction scope

Two distinct transaction questions exist; 10I owns one and
explicitly does not own the other.

- **In scope for 10I — queue-internal SQLite transactions.**
  `claimNext` must use an **explicit write-intent transaction**
  (`BEGIN IMMEDIATE` is the recommended shape; `BEGIN DEFERRED`
  followed by a write upgrades to a writer lock and risks
  `SQLITE_BUSY` between the read and the write under contention)
  enclosing the
  find-claimable + mark-claimed + mint-receipt sequence. Other
  multi-statement queue operations (e.g. tombstone-on-complete +
  ledger-write per §3) must be similarly atomic.
- **Out of scope until 10K — cross-package transaction-capable
  ingest seam.** The 10H "atomicity caveat" still stands:
  atomic `createOcrJob + enqueue` requires either
  `OcrPersistence.withTransaction` or a combined
  `enqueueNewOcrJob` API, neither of which 10I introduces. 10I
  must not accidentally bake this seam in by, e.g., exporting a
  shared `Database` handle.

### 6. Connection ownership

For 10I:

- `SqliteOcrQueue` opens and owns its **own `better-sqlite3`
  `Database` handle**, against the **same DB file** as the existing
  persistence handle.
- It **does not** receive or share a `Database` handle from
  `ocr-persistence` constructors. (Sharing is the foundation of
  the 10K transactional ingest seam; introducing it in 10I
  pre-empts 10K's design space.)
- 10I must configure / evaluate, on its own connection:
  - `journal_mode = WAL` (matches expected concurrent
    reader-while-writer pattern; check
    `services/ocr-persistence/src/sqlite/schema.ts` for the
    existing decision and align unless deviation is justified).
  - `busy_timeout` (non-zero, large enough to absorb normal
    claim/ack contention without throwing `SQLITE_BUSY` on the
    happy path; documented choice with rationale).
  - `foreign_keys` per row-lifecycle shape from §3 (relevant only
    if a ledger introduces an FK to the active queue table).
- 10K may later replace this with shared transaction / handle
  coordination. That replacement is explicitly out of 10I scope.

### 7. Clock source

10I must pin **a single clock authority** for lease accounting and
test it.

- Default preference: **Node clock** (`Date.now()` injectable as a
  fake-clock seam), if it preserves the testability shape currently
  used by `services/ocr-worker/src/inMemoryQueue.ts` (which is
  fake-clock-friendly and exercised by the existing conformance
  suite).
- Acceptable alternative: **SQLite clock**
  (`strftime('%s','now')` / `unixepoch()`) — but only if 10I
  accepts the loss of an injectable fake clock and rebuilds the
  fake-clock seam at the SQLite level (e.g. a clock-mock view or a
  bound parameter) so that conformance tests remain
  deterministic.
- Mixing the two is forbidden. A queue that takes `now` from Node
  on `enqueue` and from SQLite on `claimNext` will produce
  intermittently negative `claimed_until - enqueued_at` values
  under skew and is not testable.
- 10I must add a test that asserts the chosen clock authority is
  used everywhere a lease is computed.

### 8. Scenario field — not a production contract

`OcrJob.scenario` exists in the in-memory backend as a
fake-worker / dev / test seam (it selects which deterministic
`processFakeOcrJob` scenario the worker should run). It must not
become production contract by accident the moment it is persisted
into a SQLite column.

10I must explicitly choose between:

- **Persist-but-tag-as-test.** Keep `scenario` as a column on
  `ocr_queue_jobs`, document it as test/dev-only, and gate its
  acceptance behind a config seam so production builds either
  reject non-null `scenario` on enqueue or strip it on read.
- **Replace with a different fake-worker injection seam.**
  Remove `scenario` from the queue payload entirely; have
  fake-worker test setups inject the scenario via the worker's
  build seam (`buildDeps`-equivalent) rather than via the
  persisted job.

The choice must appear in 10I's ADR, not be inferred from code.

### 9. Contention coverage

`:memory:` SQLite databases give each connection its own private
schema. They cannot exercise dual-connection contention,
WAL semantics, or `busy_timeout` behavior. 10I conformance
**must** therefore include:

- **File-backed temp DBs.** Tests open the queue against
  `node:fs.mkdtemp`-rooted DB files, not `:memory:`, for any
  test that asserts on a behavior that depends on real disk
  semantics or cross-connection visibility.
- **At minimum one dual-connection contention test.** Two
  `SqliteOcrQueue` instances against the same file, exercising:
  - concurrent `claimNext` ⇒ exactly one wins, the other gets
    `null` (or the next claimable row), no double-claim.
  - `completeClaim` / `requeueClaim` from one connection visible
    to the other.
  - `SQLITE_BUSY` / `busy_timeout` policy: under deliberately
    induced contention, the configured timeout absorbs the
    contention rather than surfacing as a thrown error on the
    happy path. If `SQLITE_BUSY` *does* surface, it must map to
    the documented `OcrQueueErrorCode` (likely a transient one
    — 10I must pin which).

`:memory:` remains acceptable for fast-path unit tests of pure
SQL shape; it is not acceptable as the *only* substrate.

### 10. Revised 10I acceptance criteria

The 10I step is accepted when **all** of the following hold:

| # | Criterion |
|---|---|
| 1 | Queue types relocated to the neutral contract package (per §1) |
| 2 | No runtime package cycle: `ocr-persistence` does not depend on `ocr-worker` |
| 3 | `SqliteOcrQueue` passes the same queue conformance matrix — via a shared helper or byte-equivalent duplicate per §2 |
| 4 | Schema v2 migration is additive, idempotent, and refuses newer-version DBs |
| 5 | Durable receipt lineage preserved across restart (per §3) |
| 6 | Tombstone-or-ledger row lifecycle (no hard-delete-only on complete) |
| 7 | No queue → `ocr_jobs` FK in schema v2 (per §4) |
| 8 | `claimNext` uses an explicit write-intent transaction (per §5) |
| 9 | WAL + `busy_timeout` policy configured and documented on the queue connection |
| 10 | Dual-connection, file-backed contention test included (per §9) |
| 11 | Clock authority pinned and tested (per §7) |
| 12 | Scenario seam decision recorded in 10I's ADR (per §8) |
| 13 | No CLI / config / `processSignals` / coordinator / `workerLoop` / `ingest.ts` changes |

### 11. Non-goals

10H-A explicitly does **not** introduce or commit:

- any implementation
- schema v2 (no migration written, no DDL applied)
- the type relocation itself (relocation lands in 10I)
- any `package.json` edit
- any `ingest.ts` migration
- any CLI / config wiring or runtime construction-site change
- any cross-process end-to-end test
- Redis / BullMQ / SQS / Postgres backends
- retry / back-off / DLQ progression
- lease renewal during long-running `processOne()`
- concurrency > 1
- a real migration framework

These remain 10I, 10J, 10K, 10L+ concerns in the same order 10H
already staged them.

## Acceptance — 10H-A itself

| Criterion | Result |
|---|---|
| Exactly one new file: `docs/adr/ocr-queue-boundary-amendment-step-10h-a.md` | ✅ |
| No code changed | ✅ |
| No tests added or modified | ✅ |
| No schema migration written | ✅ |
| No `package.json` edit | ✅ |
| Amends, does not replace, 10H | ✅ |
| Closes the three 10I-blocking design questions in writing | ✅ |
