# ADR: Coordinator Pending-Retry Outbox (Step 11G)

## Status

Accepted. **Decision + code**. Closes ADR-11F open question Q4 / Codex
audit finding B2: when `completeClaim` fails between the persisted
`failed → queued` transition and the queue re-enqueue, the bumped
`submission.retry.attempt` was not durable. On redelivery the queue
returned the original submission and `retry.attempt` did not advance,
allowing the same attempt to re-run indefinitely under repeated ack
failures.

This ADR adds a durable per-job "pending retry submission" record so the
coordinator can produce the bumped submission BEFORE completing the
old claim, and read it back on any redelivery (queue or operator).

## Context

The ADR-11F retry flow is:

```
Step 7.6  classify worker outcome (early, before any result write)
Step 8    persist transitions (skip results on retry)
Step 8.5a append failed → queued
Step 8.5b completeClaim
Step 8.5c enqueue bumped submission
```

The bumped submission is constructed in-memory at Step 8.5c. If Step 8.5b
returns `lease_expired` / `stale_receipt` / `ack_failed`, the function
returns early; nothing durable carries the bumped attempt forward. On
redelivery the queue hands back the original submission and the
coordinator's Step 7.6 classifier sees the same `retry.attempt`.

The ADR-11F §3.2 documentation acknowledged this honestly, and the user
chose to ship v1 with the gap rather than block on this fix. ADR-11G is
the planned follow-up.

## Decisions

### §1 New persistence surface — `pending_retry_submission_json`

Add a nullable column to the existing `ocr_jobs` table (chosen over a
separate `ocr_pending_retries` table for cohesion: the pending submission
IS part of the job's authoritative state):

```sql
ALTER TABLE ocr_jobs
  ADD COLUMN pending_retry_submission_json TEXT;
```

`InMemoryOcrPersistence` mirrors this by extending `OcrJobRecord` with
an optional `pending_retry_submission?: OcrSubmission` field.

Three new `OcrPersistence` methods make the column readable and
writable independently of the verbatim `submission` field:

- `setOcrPendingRetry(jobId, submission)` — validate submission, write
  column. Idempotent overwrite (re-writing the same submission is a
  no-op; writing a different one replaces it).
- `getOcrPendingRetry(jobId)` — `OcrSubmission | null`.
- `clearOcrPendingRetry(jobId)` — set column to NULL. No-op if already
  cleared.

All three throw `OcrPersistenceError` for unknown jobs. None mutate
`submission` (the original-attempt record) or `terminal_state`.

The contract package itself is **not** changed. Pending-retry is a
persistence-side concern; the contract doesn't need to know the job
has a queued re-attempt waiting.

### §2 Coordinator wiring

Two read sites + two write sites + one clear site:

#### §2.1 Step 2 read — adopt pending submission if present

When the coordinator reads the persisted job record at Step 2, it now
also fetches the pending-retry submission. If present, that submission
is the authoritative input for this run — it overrides
`claim.job.submission`.

```ts
const pending = await persistence.getOcrPendingRetry(claim.job_id);
const effectiveSubmission = pending ?? claim.job.submission;
```

If the queue's claim happens to carry the same bumped submission
(common case: the previous coordinator successfully enqueued before
crashing), `pending` and `claim.job.submission` will be canonically
equal. Using `pending` consistently is simpler than reconciling.

The worker is invoked with a synthesized `OcrJob` that has the
effective submission:

```ts
const effectiveJob = pending === null
  ? claim.job
  : { ...claim.job, submission: pending };
await worker.process(effectiveJob);
```

#### §2.2 Step 8.5b write — durable pending submission BEFORE completeClaim

When the retry path commits, the order becomes:

1. Append `failed → queued` to persistence.
2. **NEW**: Compute the bumped submission (deep-clone, `retry.attempt+1`).
3. **NEW**: `setOcrPendingRetry(jobId, bumpedSubmission)`.
4. `completeClaim`.
5. `enqueue(bumpedSubmission)`.
6. **NEW**: `clearOcrPendingRetry(jobId)` — best-effort cleanup after the
   queue has accepted the next attempt.

After step 3 the bumped submission is durable. Any failure at steps
4–6 leaves the system recoverable:

| Failure point | Persisted state                       | Recovery                                                          |
|---------------|----------------------------------------|-------------------------------------------------------------------|
| 4 (ack)       | failed→queued + pending submission     | lease expiry → redelivery → §2.1 reads pending, runs bumped attempt |
| 5 (enqueue)   | failed→queued + pending submission     | operator re-enqueues from pending; or §2.1 on next delivery       |
| 6 (clear)     | failed→queued + pending submission     | next attempt's coordinator overwrites the now-stale pending (§2.3) |

#### §2.3 Terminal cleanup — clear on succeeded / dead_lettered

When a coordinator turn reaches a non-retry terminal (`succeeded`,
`partial_succeeded`, `dead_lettered`, `completed_already_terminal`),
the pending-retry column is cleared as part of the same code path
that completes the claim. This prevents a stale pending submission
from outliving the job it described.

`failed` is NOT terminal (the queue-controlled continuation off
`failed` is the whole point of ADR-11F/11G); we don't clear there.

### §3 Failure-mode matrix

The combined matrix across the retry path's new write sites:

| Step                       | Failure outcome     | Persisted invariants                            |
|----------------------------|---------------------|--------------------------------------------------|
| 8.5a append failed→queued  | persistence_failed  | no pending row written; failed→queued not visible|
| 8.5b setOcrPendingRetry    | persistence_failed  | failed→queued visible; no pending row written    |
| 8.5b completeClaim         | ack_failed/lease_lost | failed→queued + pending row both visible         |
| 8.5b enqueue               | persistence_failed  | failed→queued + pending row both visible         |
| 8.5b clear                 | persistence_failed  | failed→queued + pending row + enqueued row       |

The "ack_failed on completeClaim" row is the B2 fix: under the new
ordering, the pending row IS present, so redelivery picks it up via
§2.1 and `retry.attempt` does advance.

### §4 Test surface

New tests in `coordinator.retryWiring.test.mjs`:

- **Pending-retry happy path**: classification → set pending → complete
  → enqueue → clear. Final state: queue has bumped job, persistence has
  no pending row.
- **B2 closure**: complete-claim fails on retry → pending row remains
  → second `processOneOcrQueueClaim` reads pending → worker sees
  `retry.attempt+1` → second attempt classifies against bumped budget
  → real budget advancement.
- **Enqueue-fail leaves pending row visible**: persistence_failed
  returned, pending row queryable for operator recovery.
- **Stale-pending overwrite**: a run that finds an existing pending row
  AND produces a fresh retry decision overwrites the row (no two
  pendings layered).
- **Terminal cleanup**: succeeded outcome clears any pending row that
  may exist. Same for dead_lettered.
- **In-memory persistence conformance**: new methods round-trip and
  throw OcrPersistenceError on unknown job.

The SQLite hardening suite needs the same conformance probes against
the real `SqliteOcrPersistence` impl.

## Consequences

- `OcrPersistence` interface gains 3 methods; both impls update.
- One SQLite migration. Backward-compatible (nullable column).
- Coordinator outcome shapes unchanged — same `retried` /
  `dead_lettered` / `persistence_failed` / `ack_failed` / `lease_lost`
  union. The B2 fix manifests as the inner state of the system, not as
  a new outcome variant.
- `claim.job.submission` is no longer authoritative when a pending row
  exists. Existing callers of the coordinator do not see this (the
  port abstracts it), but anyone reading queue contents directly for
  diagnostics should be aware.
- The contract package is unchanged.

## Open questions (for post-v1)

- Q1: should a periodic scanner reconcile pending rows with no
  matching queue row (operator-recovery automation)? Useful but not
  on the v1 critical path.
- Q2: cross-process race — what if two coordinator processes both
  redeliver the same claim while a pending row exists? The pending
  row is shared persistence; both reads see the same submission, so
  the worker runs against identical input. The OcrQueueError
  `dedupe_conflict` guard on enqueue handles the queue-side
  double-write; persistence chain replay-safety covers the status
  side. Honest gap: simultaneous retries can double-bump retry.attempt
  in pending writes (overwrites). v1 acceptable.
- Q3: should `failed → dead_lettered` ALSO write a final pending row
  for audit? No — dead_lettered is terminal, no continuation expected.
  ADR-11G clear-on-terminal explicitly handles that.

## Rejected alternatives

- **Separate `ocr_pending_retries` table**: more schema surface, adds
  a JOIN to read pending alongside the job record, no future use case
  (one pending per job by contract). Cohesion argues for the column.
- **Sidecar field on a status transition row**: hijacks the transition
  table's single purpose and complicates chain-replay. Discarded.
- **Resolve B2 by changing the queue contract** to accept "in-place
  submission update" on claim: bigger contract break, no win over the
  outbox approach.
- **Always trust queue submission, never persistence**: leaves B2 open.
  The whole point.
