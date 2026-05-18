# ADR: Coordinator Retry Wiring (Step 11F)

## Status

Accepted. **Decision + code**. Wires the behavior layer that
ADR-11E's data layer prepared. The coordinator now inspects
`partial_failure.is_transient` post-worker, calls
`classifyOcrFailureForRetry`, drives `failed → queued` for
transient codes (with budget remaining), and `failed → dead_lettered`
otherwise. v1 user-visible behavior: transient fetcher/engine
errors now actually retry; budget exhaustion + permanent errors
dead-letter.

Companion code:
- `services/ocr-worker/src/coordinator.ts` — new step 8.5 between
  persistence write + queue ack; new `retried` + `dead_lettered`
  coordinator outcomes.
- `services/ocr-worker/src/types.ts` — no contract changes (re-uses
  `classifyOcrFailureForRetry` + existing transition shape).

## Context

ADR-11E left the data layer correct: every fetcher/engine error
code carries `is_transient: true|false` per its classification.
But no consumer acted on it — the coordinator persisted the
failed outcome + completed the queue claim. Result: transient
network blips became permanent failures. ADR-11E §7 documented
this as ADR-11F scope.

Contract pieces already in place:
- `classifyOcrFailureForRetry({status, failure, retry})` →
  `{ kind: "retry" | "dead_letter" | "not_failed", reason, attemptsRemaining? }`
  in `docs/contracts/src/retryPolicy.ts`.
- State machine admits `failed → queued` (controlled by `queue`)
  and `failed → dead_lettered` (controlled by `queue`).
- `OcrPersistencePort.appendOcrStatusOnce` auto-refreshes
  `terminal_state` to the latest transition's `to`.
- `OcrJobQueueBackend.enqueue(job)` exists; backend dedupes by
  `submission.job_id`.

User decisions captured this session:
1. **Minimal scope** — decision + immediate requeue. No backoff.
2. **Retry count** — bump `submission.retry.attempt` on requeue.
3. **DLQ visibility** — `terminal_state="dead_lettered"` + review
   filter. No new schema fields.

## Decisions

### §1 New coordinator outcomes

`services/ocr-worker/src/coordinator.ts`:

```ts
export type OcrCoordinatorOutcome =
  | "empty"
  | "completed"
  | "completed_already_terminal"
  | "requeued"
  | "retried"          // NEW: transient failure + budget remaining
  | "dead_lettered"    // NEW: permanent OR transient + budget exhausted
  | "persistence_failed"
  | "ack_failed"
  | "lease_lost";
```

Both new outcomes complete the queue claim (i.e., the current
claim is fully resolved). `retried` means a fresh job has been
enqueued. `dead_lettered` means the job is terminal.

### §2 Retry decision + persistence ordering

**Codex audit findings (cross-validated) drove a restructure of the
original draft.** The first cut persisted results before classifying;
that broke under `services/ocr-persistence`'s `(job_id, page_id)`
result-conflict guard — attempt-2's success result would have
collided with attempt-1's persisted failed result, structurally
breaking the retry feature. The shipped flow is:

```
Step 7   normalize (admits succeeded / partial_succeeded / failed)
Step 7.5 reject failed-terminal with no failed result (Codex B3)
Step 7.6 classify EARLY — before any result write (Codex B1)
         - validate submission (typed retry policy)
         - try classifier; map RetryPolicyError to persistence_failed (Codex B4)
         - produce retryDecision: null | retry | dead_letter
Step 8   persist transitions (always)
         persist results ONLY when retryDecision is null OR dead_letter
Step 8.5 if retryDecision: append failed→queued or failed→dead_lettered
Step 9   completeClaim (current claim)
Step 10  if retry: deep-clone submission, bump retry.attempt, enqueue
```

#### §2.1 Step 7.5 — failed-terminal coherence (Codex B3)

The worker contract validators are schema-only: a worker can emit
`terminal_state="failed"` while every result row carries
`status="succeeded"`. That output is internally incoherent — the
classifier has nothing to decide on. Reject with
`tryRequeueAs(... "requeued" ...)` so the persisted state is not
advanced into an un-classifiable shape.

#### §2.2 Step 7.6 — early classification + counter guard (Codex B1 + B4)

Classification runs BEFORE any persistence write so we can short-circuit
result writes on the retry path (see §3 below). The classifier
(`classifyOcrFailureForRetry`) calls `validateRetryCounters` and throws
`RetryPolicyError` on semantically-invalid counters (`attempt >
max_attempts`, fractional values smuggled past the schema). Step 7.6
catches that throw and maps to `persistence_failed` rather than
letting it escape the coordinator as an undocumented error.

#### §2.3 Loop semantics

```ts
let retryDecision: { kind: "retry" | "dead_letter"; reason: string } | null = null;
for (const result of resultsToPersist) {
  if (result.status !== "failed") continue;
  const verdict = classifyOcrFailureForRetry({
    status: result.status,
    failure: result.partial_failure ?? null,
    retry: validatedRetryPolicy,
  });
  if (verdict.kind === "retry") {
    retryDecision = { kind: "retry", reason: verdict.reason };
    break;  // any retry-eligible result triggers retry
  }
  if (verdict.kind === "dead_letter" && retryDecision === null) {
    retryDecision = { kind: "dead_letter", reason: verdict.reason };
  }
}
```

For v1 N=1, there's exactly one result, so the loop runs once.
The generalization handles a future N>1 lift where mixed
transient/permanent outcomes need a combined verdict; "any
retry-eligible result triggers retry" is the safe choice (don't
dead-letter a job that could partially recover).

### §3 Retry path

When `retryDecision.kind === "retry"`:

1. Persist all transitions from `transitionsToPersist` (the
   worker's `queued→claimed→processing→failed` chain after Step 7
   normalization). **Do NOT** call `saveOcrResultOnce` for any
   result — Codex B1 fix. Per `services/ocr-persistence`'s
   per-(job_id, page_id) conflict guard, writing attempt-1's failed
   result would collide with attempt-2's result on the next pass.
   The transitions are kept because they are the audit trail of
   what happened; the result body is discarded because attempt-N is
   the page's final state of record.
2. Append `failed → queued` to persistence (queue-controlled).
3. **Complete the current claim**. This MUST happen before the
   retry enqueue — see ordering note below.
4. Deep-clone the validated submission; bump `submission.retry.attempt`.
5. Build a new `OcrJob` with a fresh transport id (from a new
   `generateJobId` coordinator option, defaulting to `crypto.randomUUID()`).
6. Call `queue.enqueue(newJob)`.
7. Return `outcome: "retried"`.

Ordering note: the InMemoryOcrQueue (and any backend obeying the
project invariant "queue dedupe key = job_id + canonical submission
JSON") rejects an enqueue whose `job_id` matches an active record
with a DIFFERENT canonical submission. While the current claim is
still active, its in-memory submission has the OLD `retry.attempt`
value; a retry enqueue with the bumped value collides with it and
the queue throws `dedupe_conflict`. Completing the claim first
releases the active slot so the retry is a clean insert.

Failure modes:
- §3.1 If `appendOcrStatusOnce(failed→queued)` fails → return
  `persistence_failed`. The current claim stays active; lease
  expiry will redeliver and the coordinator will re-evaluate.
- §3.2 If `completeClaim` fails → return `ack_failed` or
  `lease_lost`. The persisted `failed → queued` row stands. On
  redelivery, the queue returns the ORIGINAL submission (queue
  state is the source of truth for transport, and we never wrote
  the bumped submission anywhere durable before completing).
  The coordinator re-runs the worker → re-classifies → re-appends
  the failed→queued chain. The transition chain stays replay-safe
  via `appendOcrStatusOnce`, but `retry.attempt` does NOT
  advance because it's only bumped at enqueue. **Acknowledged v1
  limitation**: under repeated `completeClaim` failures the same
  attempt can re-run indefinitely without burning the retry
  budget. See "Open questions" Q4 for the post-v1 fix
  (durable-next-submission write before claim resolution).
- §3.3 If `queue.enqueue(retry)` fails → return
  `persistence_failed`. Persistence shows the job in `queued`
  state but no queue row exists. The persisted transition is NOT
  rolled back — `appendOcrStatusOnce` is replay-safe, and an
  operator-driven recovery (rescan persistence for `queued` jobs
  with no queue row, re-enqueue) closes the gap. **Honest gap**:
  the persisted `failed → queued` edge alone does not encode the
  bumped submission; recovery requires the operator to
  reconstruct `retry.attempt+1` from the existing transition
  count.

### §4 Dead-letter path

When `retryDecision.kind === "dead_letter"`:

1. Persist all transitions AND all results (dead-letter is the
   page's final state of record, so the failed result must land).
2. Append `failed → dead_lettered` to persistence.
3. Complete the current claim.
4. Return `outcome: "dead_lettered"`.

No re-enqueue. `terminal_state` becomes `dead_lettered` via
persistence's auto-refresh. Downstream review filters can detect
this state per ADR-11F user decision §3.

### §5 `submission.retry.attempt` semantics

The submission's `retry.attempt` field starts at 1 (per
ingestion defaults) and represents "the current attempt number"
when the worker processes the job.

- First attempt: `retry.attempt = 1`.
- After a transient failure with `max_attempts = 3`:
  - `attemptsRemaining = 3 - 1 = 2`
  - Coordinator bumps to `retry.attempt = 2` on requeue.
- Second attempt fails transiently: `attemptsRemaining = 3 - 2 = 1`, bump to 3, requeue.
- Third attempt fails transiently: `attemptsRemaining = 3 - 3 = 0`, dead-letter.

The bumped attempt lands in the re-enqueued submission. The next
worker iteration sees attempt=2 in the submission it claims. The
worker doesn't need to know about retries — it just processes;
the coordinator decides.

`partial_failure.attempted_count` on each result also increments
naturally because the worker emits it on each invocation; we don't
need to thread it manually.

### §6 Queue dedupe interaction

`OcrJobQueueBackend.enqueue` dedupes by `submission.job_id` per
the queue contract (ADR-10H). When we re-enqueue with the same
`job_id` but a different submission (bumped `retry.attempt`),
the dedupe semantics need to handle this:

- In-memory backend's dedupe: keyed on canonical submission JSON
  (per the project invariant). Bumping `retry.attempt` changes the
  canonical JSON, so the new submission is NOT a dedupe of the old.
- SQLite backend: same rules.

The new submission is therefore treated as a fresh enqueue. The
previous queue row was already resolved (we just completed its
claim). No conflict.

### §7 What v1 still doesn't do (post-v1)

- **Backoff between retries**: no delay. Honoring
  `submission.retry.backoff/base_delay_ms/max_delay_ms` requires
  the queue backend to support delayed delivery. In-memory queue
  has no concept of "visible at timestamp T"; SQLite queue same.
  Deferred.
- **Per-page retry granularity**: N=1 v1 makes this moot. When
  multi-page (N>1) returns, partial-success scenarios need
  per-page retry decisions.
- **Retry observability**: no per-job retry counter on the queue
  row, no metric. The audit trail lives in the persistence
  `ocr_job_statuses` table (each retry appends a `failed → queued`
  edge).
- **Dead-letter reason persistence**: the `note` field on the
  transition captures the reason string from the classifier, but
  there's no dedicated `dead_letter_reason` query API. Downstream
  filters scan transitions.

### §8 Test surface

- Transient + budget remaining → `retried`, new job in queue with
  `retry.attempt + 1`.
- Transient + budget exhausted → `dead_lettered`, terminal_state
  updated.
- Permanent → `dead_lettered` immediately, no budget consultation.
- Succeeded → `completed` (unchanged).
- End-to-end: transient on first attempt, success on retry → full
  loop completes through a single workerLoop drain.
- workerLoop's outcome accounting includes `retried` + `dead_lettered`.

## Consequences

- The retry data layer ships behavior. The system now actually
  retries transient failures (network blips, 5xx, engine
  hiccups) up to `submission.retry.max_attempts`.
- Two new coordinator outcomes; workerLoop accounting type
  widens automatically (it's `Partial<Record<OcrCoordinatorOutcome,
  number>>`).
- No new contract surface. `classifyOcrFailureForRetry` was
  already shipped; this commit just calls it.
- No new dependencies.

## Open questions (for post-v1)

- Q1: backoff delay — when v2 wants exponential backoff, the
  queue backends need delayed-delivery support. Adds queue
  contract surface.
- Q2: per-page retry — N>1 lift opens "page 1 succeeded, page 2
  transient-failed, retry only page 2" patterns. Materially
  larger ADR.
- Q3: retry-storm guard — if a transient error persists, we burn
  through max_attempts in tight succession. Backoff (Q1) is the
  natural defense; until then operators should set
  `max_attempts` conservatively.
- Q4: durable next-submission for ack-failure resilience — §3.2
  documents that a `completeClaim` failure causes the next
  redelivery to re-run the same attempt without burning the retry
  budget. The fix is to durably store the bumped submission BEFORE
  resolving the claim (an outbox-style write of the intended
  attempt+1 submission into persistence), so redelivery/recovery
  reads it instead of the queue's stale copy. Out of scope for
  v1; the v1 mitigation is the audit-log visibility of the
  failed→queued→claimed→processing→failed→queued cycle.

## Rejected alternatives

- **Backoff in this ADR**: requires queue support; out of scope
  per user decision.
- **Per-result requeue (vs whole-job)**: N=1 v1; deferred to
  multi-page ADR.
- **Mutate submission in place vs deep-clone**: in-place mutation
  would leak across the claim/result boundary; clone is the
  honest path even though the cost is small.
- **Don't increment retry.attempt; rely on attempted_count**:
  attempted_count is per-RESULT not per-JOB; bumping
  retry.attempt is the contract's intended mechanism (the
  classifier reads retry.attempt, not attempted_count).
- **Dead-letter via a separate `dead_letter_jobs` table**:
  premature; existing `terminal_state` + transition trail is
  sufficient for v1 visibility.
