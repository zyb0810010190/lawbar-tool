# ADR: OCR Processing Coordinator Step 10C

## Status

Accepted for Step 10C implementation, with B1/B2/B3 closed in this revision.

## Context

- Queue backend is transport-only.
- Persistence is source of truth.
- `OcrJobAdapter` is compatibility / test scaffolding, not the production
  lifecycle owner.
- Replay-safe persistence exists:
  - `appendOcrStatusOnce`
  - `saveOcrResultOnce`
- The contract (`docs/contracts/src/transitions.ts`) defines:
  - **Terminal states**: `succeeded`, `partial_succeeded`, `cancelled`,
    `dead_lettered`.
  - **Legal edges and owners** (subset most relevant to the coordinator):
    - `queued → claimed` (queue)
    - `claimed → processing` (worker)
    - `claimed → queued` (queue, lease-expired / crash)
    - `processing → succeeded` (worker)
    - `processing → failed` (worker)
    - `processing → partial_succeeded` (worker)
    - `failed → queued` (queue, retry)
    - `failed → dead_lettered` (queue, retry exhausted / permanent)
    - `* → cancelled` (web_app, from any non-terminal state)
  - There is **no** `processing → queued` edge. Worker crash mid-processing
    is reconciled at the queue level (lease expiry → `claimed → queued`)
    or by a later coordinator/retry-loop step (`failed → queued`).
- Fake worker may emit bundled queue-owned transitions (the
  `transient_then_success` scenario stitches a retry loop into one call);
  Step 10C must not consume those bundled edges.

## Decisions

### 1. Coordinator is a new standalone module

- Do not couple coordinator to `OcrJobAdapter` internals.
- Adapter remains in place as test scaffolding; it is not extended to own
  the production lifecycle.

### 2. Queue backend writes no persistence records

- `claim` / `renew` / `complete` / `requeue` are transport operations only.
- Restated from Step 10B as a guard against accidental coupling.

### 3. Coordinator owns queue-lifecycle persistence

- After a successful `claimNext`, the coordinator persists `queued →
  claimed` (controlled_by = `queue`) via `appendOcrStatusOnce`.
- A standalone `queued` status row is **not** required to exist before
  this write. The persistence timeline is transition-only and the
  validator accepts a first transition starting from `queued`.

### 4. No prewrite of `processing`

- The contract has no `processing → queued` edge. Persisting `claimed →
  processing` before the worker returns would create an unrecoverable
  persistence state if the worker then throws (the legal recovery edge
  `claimed → queued` is no longer reachable from `processing`).
- Therefore Step 10C **must not** persist `claimed → processing` before
  the worker returns a valid outcome.
- Coordinator persists `claimed → processing` (controlled_by = `worker`)
  only after the worker returns an outcome that passes contract +
  binding validation **and** that outcome's normalized transition
  sequence begins with `claimed → processing`.

### 5. Worker-thrown errors

- Treated as execution / transport failure.
- No terminal OCR failure is persisted.
- Coordinator requeues the claim.
- Returned coordinator outcome is `requeued` with error details.

### 6. Worker contract-invalid output

- Treated as execution failure.
- No worker-emitted statuses / results are persisted.
- Coordinator requeues the claim.
- Returned coordinator outcome is `requeued` with validation error
  details.

### 7. Worker-emitted statuses are normalized — explicit edge-ownership table (B1)

The coordinator does **not** persist worker output verbatim. It runs
each emitted transition through this ownership/normalization table
before any persistence write:

| Edge | Contract owner | Coordinator action in Step 10C |
|------|---------------|-------------------------------|
| `queued → claimed` | queue | **Persist once** (coordinator writes via `appendOcrStatusOnce` after `claimNext`). The current fake worker also emits this edge as the **leading** transition of every scenario (the worker fixture replays the queue handoff for documentation). The coordinator is the sole writer of this edge: when the leading transition of the worker outcome is `queued → claimed`, the coordinator silently drops it (it is a duplicate of the coordinator's own write, not a contract violation). Any **non-leading** occurrence of `queued → claimed` in worker output is a bundled-retry signal and is rejected (Decision 12). |
| `claimed → processing` | worker | **Persist** when present in a *valid single-attempt* worker outcome. **Never** prewrite. |
| `claimed → queued` | queue | Bundled-retry / lease-recovery signal. Coordinator **rejects** any worker outcome containing this edge (Decision 12). |
| `processing → succeeded` | worker | Persist. |
| `processing → partial_succeeded` | worker | Persist. |
| `processing → failed` | worker | A worker outcome ending at `failed` has no Step 10C-legal continuation (next legal edges `failed → queued` / `failed → dead_lettered` are queue-owned and out of scope). Therefore Step 10C **does not admit** worker outcomes that end at `failed` — see Decision 12. |
| `failed → queued` | queue (retry loop) | Bundled-retry signal. Coordinator **rejects** the outcome (Decision 12). |
| `failed → dead_lettered` | queue (retry exhausted) | DLQ signal. Coordinator **rejects** the outcome (Decision 12). |
| `* → cancelled` | web_app | Not produced by a well-behaved worker. If observed in worker output, treat as contract-invalid (Decision 6). |

Three important corollaries:

- **`claimed → processing` is worker-owned and is persisted from valid
  worker output. It is not "dropped as a queue-owned edge".** This
  closes the prior Decision 4 / Decision 7 contradiction.
- The **leading** `queued → claimed` in worker output is the *only*
  queue-owned edge the coordinator silently drops; it is a redundant
  echo of the queue handoff, written authoritatively by the coordinator
  itself. Every other queue- or web_app-owned edge in worker output is
  rejected (Decision 12).
- A worker outcome containing a *non-leading* `queued → claimed`,
  `claimed → queued`, `failed → queued`, `failed → dead_lettered`, or
  any `* → cancelled` is by definition bundled-retry / lease-recovery /
  DLQ / cancellation output — Step 10C rejects, never filters.

### 8. Redelivery reconciliation

- On every claim, coordinator inspects persistence first.
- **Already terminal**: if persistence shows any of `succeeded`,
  `partial_succeeded`, `cancelled`, `dead_lettered` for the job:
  - Skip worker execution.
  - Attempt `completeClaim`.
  - On success → outcome `completed_already_terminal`.
  - On failure → map per Decision 11 (queue-error mapping).
  - **Never** re-run the worker for a terminal job.
- **Non-terminal persisted state** (e.g. previous attempt persisted
  `queued → claimed` and `claimed → processing` but no terminal):
  - Proceed with normal worker execution.
  - All persistence writes go through `appendOcrStatusOnce` /
    `saveOcrResultOnce`.
  - Do **not** synthesize recovery transitions beyond what the
    replay-safe primitives provide.
- **No persistence rows at all for the claimed `job_id`** (B2):
  - Persistence is the source of truth. A queue claim with no
    persistence record is an invariant violation.
  - Coordinator does **not** run the worker.
  - Coordinator does **not** call `completeClaim`.
  - Coordinator attempts `requeueClaim` so the claim is not silently
    lost.
  - Outcome:
    - `requeueClaim` succeeds → `persistence_failed` (with reason).
    - `requeueClaim` fails with `lease_expired` → `lease_lost`.
    - `requeueClaim` fails with `unknown_receipt` / `stale_receipt` /
      `invalid_claim` / any other queue error → `ack_failed`.
  - Rationale: requeueing keeps the claim recoverable on the next
    delivery; another component (ingestion) can be running the
    persistence write concurrently. We refuse to ack-and-drop a job we
    cannot reconcile.

### 9. Partial persistence recovery

- Coordinator uses `appendOcrStatusOnce` and `saveOcrResultOnce`
  exclusively for redelivery-safe writes.
- Exact replay is accepted (idempotent).
- Conflicting replay fails deterministically.
- A persistence conflict means the queue claim **must not be
  completed** (so the divergence stays visible for operator action
  rather than being acked away).
- **Idempotency note**: Step 10C exact replay relies on
  `TransitionRecord` equality including timestamps. This is fine for the
  deterministic fake worker. Real-worker idempotency may require a
  timestamp-independent transition identity (e.g. `(job_id, from, to,
  controlled_by)` plus a deterministic attempt nonce); designing that
  identity is **out of scope for Step 10C** and belongs to the first
  real-worker step.

### 10. Cancellation

- `cancelled` is one of the four terminal states recognized by Decision
  8. Redelivery of a job already cancelled in persistence takes the
  terminal-skip path.
- Concurrent cancellation that arrives **after** the coordinator has
  claimed but before it has persisted a terminal state is **out of Step
  10C scope**. The coordinator does not poll for cancellation during
  worker execution.

### 11. Queue-error mapping into coordinator outcome (B3)

When a queue operation (`completeClaim`, `requeueClaim`) returns an
`OcrQueueError`, the coordinator maps the `code` field as follows:

| Queue error code | Coordinator outcome |
|------------------|--------------------|
| `lease_expired` | `lease_lost` |
| `unknown_receipt` | `ack_failed` |
| `stale_receipt` | `ack_failed` |
| `invalid_claim` | `ack_failed` |
| `dedupe_conflict` | not produced by these ops; treat as `ack_failed` with diagnostic |
| any unexpected queue error | `ack_failed` with error details |

Each `ack_failed` / `lease_lost` outcome carries the original queue
`code` and message in the result so callers/tests can distinguish
cause without re-parsing logs.

### 12. Fake-worker scenarios admitted in Step 10C

- **Admitted** (single-attempt outcomes whose status sequence after
  dropping the leading `queued → claimed` is entirely worker-owned and
  ends at a worker terminal state — `succeeded` or `partial_succeeded`):
  - `success` — sequence `queued→claimed`, `claimed→processing`,
    `processing→succeeded`. After dropping the leading
    `queued→claimed`, the remainder is fully worker-owned.
  - `partial_failure` — sequence `queued→claimed`,
    `claimed→processing`, `processing→partial_succeeded`. Same shape.
- **Rejected** (output crosses into queue retry / DLQ / lease-recovery
  semantics that Step 10C does not own):
  - `transient_then_success` — bundles `failed → queued → claimed →
    processing → succeeded` inside one `worker.process` call. Contains
    `failed→queued` (retry-loop) and a non-leading `queued→claimed`.
  - `permanent_failure` — current fake worker emits a trailing
    `failed → dead_lettered` (DLQ, queue-owned). DLQ is out of Step
    10C scope; rejection avoids silently swallowing the DLQ edge.
    (If a future fixture exposes a single-attempt `permanent_failure`
    sequence ending at worker-`failed` *and* the contract gains a
    legal coordinator/queue handoff for that state, the admission can
    be reopened by ADR amendment.)
- **Detection rule** (precise):
  1. Strip a single leading `queued → claimed` (controlled_by =
     `queue`) from the worker outcome's transition sequence, if
     present. (This is the duplicate the coordinator already wrote;
     see Decision 7.)
  2. If the remaining sequence contains **any** transition whose
     `controlled_by` is `queue` or `web_app`, the outcome is
     contract-invalid (Decision 6) and the claim is requeued.
  3. The remaining sequence must end at a worker terminal state
     (`succeeded` or `partial_succeeded`); otherwise the outcome is
     contract-invalid.
  4. The coordinator does not silently filter bundled-retry / DLQ /
     cancellation edges — rejection keeps the failure visible.

### 13. Lease renewal

- **Not** in Step 10C.
- Step 10C is single-claim / single-worker-call.
- Long-running lease renewal belongs to the Step 10D worker loop.

### 14. Dead-letter

- **Not** in Step 10C.
- Repeated-retry / dead-letter policy belongs to a later
  coordinator-loop step.

## Step 10C implementation target

Add a standalone `OcrProcessingCoordinator` (or
`processOneOcrQueueClaim` function) that:

1. `claimNext` — return `{ outcome: "empty" }` if nothing to claim.
2. Inspect persistence for the claim's `job_id`:
   - terminal → skip worker, ack via `completeClaim`, see Decision 8.
   - no rows at all → no worker, requeue, see Decision 8 (B2 path).
   - non-terminal → continue.
3. `appendOcrStatusOnce(queued → claimed)` (controlled_by `queue`).
4. Run worker.
5. Validate worker outcome against contract + binding rules.
6. Normalize per Decision 7 ownership table; reject bundled-retry per
   Decision 12.
7. Persist worker-emitted statuses via `appendOcrStatusOnce` and
   results via `saveOcrResultOnce`.
8. `completeClaim` on terminal success path; `requeueClaim` on
   recoverable failure; on persistence conflict do not complete.
9. Return a discriminated outcome:
   - `empty`
   - `completed`
   - `completed_already_terminal`
   - `requeued`
   - `persistence_failed`
   - `ack_failed`
   - `lease_lost`

   Each variant carries enough diagnostic detail (job_id, queue error
   code where relevant, validation summary, persistence error) for
   tests and operators.

## Implementation may begin

With B1 (Decision 7 edge-ownership table), B2 (Decision 8 missing-rows
rule), and B3 (Decision 11 queue-error mapping) closed in this
revision, Step 10C implementation may begin under these semantics. Any
deviation requires an ADR amendment, not an ad-hoc implementation
choice.

## Non-goals

- BullMQ
- Redis
- real OCR
- UI
- contract schema changes
- lease renewal
- dead-letter queue
- real-worker idempotency identity (timestamp-independent transition
  equality)
- concurrent-cancellation polling during worker execution
