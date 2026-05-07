// Backend-agnostic conformance harness for `OcrJobQueueBackend`.
//
// Step 10I-A relocation. Previously lived at
// `services/ocr-worker/tests/conformance/runOcrQueueConformance.mjs`. Moved
// here so that:
//   - the `ocr-persistence` SqliteOcrQueue (10I-B) can run the same matrix
//     without taking a runtime dep on `ocr-worker-adapter`;
//   - the in-memory and SQLite backends prove the *same* contract — drift
//     fails here.
//
// Mirrors `runOcrPersistenceConformance` in spirit: every concrete backend
// (in-memory today, SQLite next) imports this module and runs the suite.
//
// Inputs:
//   - label:           prefix for `node:test` test names
//   - makeImpl(opts):  factory returning a fresh `OcrJobQueueBackend`. The
//                      harness passes `{ now, leaseMs, generateReceipt }`
//                      so tests can drive deterministic time, lease length,
//                      and receipt minting.
//   - OcrQueueError:   optional. The error class the backend throws. The
//                      harness asserts `err instanceof OcrQueueError` and
//                      that the `code` property matches the documented
//                      discriminant. Defaults to the canonical class
//                      exported from this contract package — backends
//                      MUST throw the same class identity to keep
//                      `instanceof` honest across the worker re-export.

import { test } from "node:test";
import assert from "node:assert/strict";

import baseSubmissionFixture from "../../fixtures/valid/submission-s3.json" with { type: "json" };

import {
  OcrQueueError as CanonicalOcrQueueError,
  type OcrJob,
  type OcrJobQueueBackend,
  type OcrQueueClaim,
} from "../queue.js";

export interface MakeImplOptions {
  now?: () => Date;
  leaseMs?: number;
  generateReceipt?: () => string;
}

export interface RunOcrQueueConformanceOptions {
  label: string;
  makeImpl: (opts: MakeImplOptions) => OcrJobQueueBackend;
  /**
   * The `OcrQueueError` class identity the backend throws. Defaults to the
   * canonical class exported by `ocr-worker-contract`. Backends should not
   * pass a different class — the worker re-export preserves identity, and
   * `ocr-persistence` imports from here directly.
   */
  OcrQueueError?: typeof CanonicalOcrQueueError;
}

interface MakeJobOptions {
  jobId?: string;
  transportId?: string;
  enqueuedAt?: string;
  scenario?: OcrJob["scenario"];
  submissionOverrides?: Record<string, unknown>;
}

const baseSubmission = baseSubmissionFixture as Record<string, unknown>;

/**
 * Build an `OcrJob` with a chosen `submission.job_id`. The 26-char ULID
 * shape is preserved by overlaying onto the fixture.
 */
function makeJob({
  jobId,
  transportId,
  enqueuedAt = "2030-01-01T00:00:00.000Z",
  scenario,
  submissionOverrides = {},
}: MakeJobOptions = {}): OcrJob {
  const submission = structuredClone(baseSubmission) as Record<string, unknown>;
  if (jobId) submission.job_id = jobId;
  for (const [k, v] of Object.entries(submissionOverrides)) submission[k] = v;
  const effectiveJobId = (jobId ?? (submission.job_id as string));
  const job: OcrJob = {
    id: transportId ?? `job-${effectiveJobId}`,
    submission,
    enqueued_at: enqueuedAt,
  };
  if (scenario !== undefined) job.scenario = scenario;
  return job;
}

interface ClockHandle {
  now: () => Date;
  advance: (delta: number) => void;
  set: (ms: number) => void;
}

/**
 * Mutable clock helper. `clock.now()` returns the head epoch as a Date;
 * `clock.advance(ms)` adds to the head. Pass `clock.now` into makeImpl as
 * the queue's `now`.
 */
function makeClock(startMs: number = Date.UTC(2030, 0, 1)): ClockHandle {
  const state = { ms: startMs };
  return {
    now: () => new Date(state.ms),
    advance: (delta: number) => { state.ms += delta; },
    set: (ms: number) => { state.ms = ms; },
  };
}

/** Sequential receipt minter for deterministic tests. */
function makeReceiptMinter(prefix = "r"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  ErrorClass: typeof CanonicalOcrQueueError,
  expectedCode: string,
): Promise<void> {
  await assert.rejects(
    promise,
    (err: unknown) => {
      return (
        err instanceof ErrorClass &&
        (err as InstanceType<typeof CanonicalOcrQueueError>).code === expectedCode
      );
    },
    `expected OcrQueueError(code=${expectedCode})`,
  );
}

export function runOcrQueueConformance({
  label,
  makeImpl,
  OcrQueueError = CanonicalOcrQueueError,
}: RunOcrQueueConformanceOptions): void {
  // -------------------------------------------------------------------------
  // enqueue + claimNext basics
  // -------------------------------------------------------------------------

  test(`${label}: claimNext returns null on an empty queue`, async () => {
    const q = makeImpl({});
    const c = await q.claimNext("worker-1");
    assert.equal(c, null);
  });

  test(`${label}: enqueue then claimNext returns a claim with job + receipt + worker_id`, async () => {
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 30_000, generateReceipt: makeReceiptMinter() });
    const job = makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" });
    await q.enqueue(job);

    const claim = await q.claimNext("worker-A");
    assert.ok(claim, "expected a claim");
    const c = claim as OcrQueueClaim;
    assert.equal(c.worker_id, "worker-A");
    assert.equal(c.job_id, "01jrk8m4q4xv2v8d4d4ymf5xnk");
    assert.equal(
      (c.job.submission as { job_id: string }).job_id,
      "01jrk8m4q4xv2v8d4d4ymf5xnk",
    );
    assert.equal(typeof c.receipt, "string");
    assert.notEqual(c.receipt, "");
    assert.equal(typeof c.claimed_at, "string");
    assert.equal(typeof c.lease_expires_at, "string");
    assert.ok(
      Date.parse(c.lease_expires_at) > Date.parse(c.claimed_at),
      "lease_expires_at must be after claimed_at",
    );
  });

  test(`${label}: claimNext does not redeliver an already-claimed job`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const first = await q.claimNext("worker-1");
    assert.ok(first);
    const second = await q.claimNext("worker-2");
    assert.equal(second, null, "claimed job must not be claimable again");
  });

  // -------------------------------------------------------------------------
  // FIFO at concurrency 1
  // -------------------------------------------------------------------------

  test(`${label}: at concurrency 1, claim order follows enqueue order`, async () => {
    const q = makeImpl({});
    const ids = [
      "01jrk8m4q4xv2v8d4d4ymf5xn1",
      "01jrk8m4q4xv2v8d4d4ymf5xn2",
      "01jrk8m4q4xv2v8d4d4ymf5xn3",
    ];
    for (const jobId of ids) await q.enqueue(makeJob({ jobId }));

    const c1 = (await q.claimNext("w")) as OcrQueueClaim;
    await q.completeClaim(c1);
    const c2 = (await q.claimNext("w")) as OcrQueueClaim;
    await q.completeClaim(c2);
    const c3 = (await q.claimNext("w")) as OcrQueueClaim;
    await q.completeClaim(c3);
    const c4 = await q.claimNext("w");

    assert.equal(c1.job_id, ids[0]);
    assert.equal(c2.job_id, ids[1]);
    assert.equal(c3.job_id, ids[2]);
    assert.equal(c4, null);
  });

  // -------------------------------------------------------------------------
  // Dedupe
  // -------------------------------------------------------------------------

  test(`${label}: enqueueing the same submission twice is an idempotent no-op`, async () => {
    const q = makeImpl({});
    const a = makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" });
    const b = makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" });
    await q.enqueue(a);
    await q.enqueue(b);

    const c1 = await q.claimNext("w");
    assert.ok(c1);
    await q.completeClaim(c1 as OcrQueueClaim);
    const c2 = await q.claimNext("w");
    assert.equal(c2, null, "second enqueue must not create a second slot");
  });

  test(`${label}: dedupe ignores transport metadata (id / enqueued_at / scenario)`, async () => {
    const q = makeImpl({});
    const a = makeJob({
      jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
      transportId: "transport-A",
      enqueuedAt: "2030-01-01T00:00:00.000Z",
    });
    const b = makeJob({
      jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
      transportId: "transport-B-different",
      enqueuedAt: "2030-06-15T12:34:56.000Z",
      scenario: "permanent_failure",
    });
    await q.enqueue(a);
    await q.enqueue(b);

    const c1 = await q.claimNext("w");
    await q.completeClaim(c1 as OcrQueueClaim);
    const c2 = await q.claimNext("w");
    assert.equal(c2, null, "transport metadata differences must not bypass dedupe");
  });

  test(`${label}: enqueue with same job_id but different submission throws dedupe_conflict`, async () => {
    const q = makeImpl({});
    const a = makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" });
    const b = makeJob({
      jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
      submissionOverrides: { priority: 99 },
    });
    await q.enqueue(a);
    await rejectsWithCode(q.enqueue(b), OcrQueueError, "dedupe_conflict");
  });

  test(`${label}: dedupe scope is active queue only — re-enqueue after complete succeeds even with a different payload`, async () => {
    const q = makeImpl({});
    const a = makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" });
    await q.enqueue(a);
    const c = await q.claimNext("w");
    await q.completeClaim(c as OcrQueueClaim);

    const b = makeJob({
      jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
      submissionOverrides: { priority: 99 },
    });
    await q.enqueue(b); // must NOT throw
    const c2 = (await q.claimNext("w")) as OcrQueueClaim | null;
    assert.ok(c2);
    assert.equal(
      ((c2 as OcrQueueClaim).job.submission as { priority: number }).priority,
      99,
    );
  });

  // -------------------------------------------------------------------------
  // renewClaim
  // -------------------------------------------------------------------------

  test(`${label}: renewClaim extends the lease and preserves the receipt`, async () => {
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 30_000, generateReceipt: makeReceiptMinter() });
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;

    clock.advance(10_000); // 10s passes
    const renewed = await q.renewClaim(claim);

    assert.equal(renewed.receipt, claim.receipt, "renew must keep the same receipt");
    assert.ok(
      Date.parse(renewed.lease_expires_at) > Date.parse(claim.lease_expires_at),
      "renewed lease must extend past the original",
    );
  });

  test(`${label}: renewClaim with an unknown receipt rejects with unknown_receipt`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    const fake: OcrQueueClaim = { ...claim, receipt: "definitely-not-a-real-receipt" };
    await rejectsWithCode(q.renewClaim(fake), OcrQueueError, "unknown_receipt");
  });

  // -------------------------------------------------------------------------
  // completeClaim
  // -------------------------------------------------------------------------

  test(`${label}: completeClaim removes the job from the queue`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    await q.completeClaim(claim);
    const next = await q.claimNext("w");
    assert.equal(next, null);
  });

  test(`${label}: completing the same claim twice rejects on the second attempt`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    await q.completeClaim(claim);
    await rejectsWithCode(q.completeClaim(claim), OcrQueueError, "unknown_receipt");
  });

  // -------------------------------------------------------------------------
  // requeueClaim
  // -------------------------------------------------------------------------

  test(`${label}: requeueClaim makes the job claimable again`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    await q.requeueClaim(claim);

    const reclaim = (await q.claimNext("w2")) as OcrQueueClaim | null;
    assert.ok(reclaim);
    const r = reclaim as OcrQueueClaim;
    assert.equal(r.job_id, "01jrk8m4q4xv2v8d4d4ymf5xnk");
    assert.notEqual(
      r.receipt,
      claim.receipt,
      "re-claim must mint a new receipt",
    );
  });

  test(`${label}: requeueClaim with an unknown receipt rejects`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    await q.completeClaim(claim);
    await rejectsWithCode(q.requeueClaim(claim), OcrQueueError, "unknown_receipt");
  });

  // -------------------------------------------------------------------------
  // Lease expiry
  // -------------------------------------------------------------------------

  test(`${label}: renewing an expired (but not-yet-swept) receipt rejects with lease_expired`, async () => {
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 1_000, generateReceipt: makeReceiptMinter() });
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;

    clock.advance(5_000); // well past 1s lease
    await rejectsWithCode(q.renewClaim(claim), OcrQueueError, "lease_expired");
  });

  test(`${label}: after lease expiry, the slot is reclaimable and the old receipt becomes stale`, async () => {
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 1_000, generateReceipt: makeReceiptMinter() });
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const oldClaim = (await q.claimNext("w1")) as OcrQueueClaim;

    clock.advance(5_000);
    // Re-claim under a different worker. The expired claim is swept and a
    // new receipt is minted.
    const newClaim = (await q.claimNext("w2")) as OcrQueueClaim | null;
    assert.ok(newClaim);
    const nc = newClaim as OcrQueueClaim;
    assert.equal(nc.job_id, "01jrk8m4q4xv2v8d4d4ymf5xnk");
    assert.notEqual(nc.receipt, oldClaim.receipt);

    // The old receipt now points at a slot owned by someone else. Every
    // op surfaces stale_receipt, including requeueClaim.
    await rejectsWithCode(
      q.renewClaim(oldClaim),
      OcrQueueError,
      "stale_receipt",
    );
    await rejectsWithCode(
      q.completeClaim(oldClaim),
      OcrQueueError,
      "stale_receipt",
    );
    await rejectsWithCode(
      q.requeueClaim(oldClaim),
      OcrQueueError,
      "stale_receipt",
    );
  });

  // -------------------------------------------------------------------------
  // Receipt error matrix — close gap (#2)
  // -------------------------------------------------------------------------
  // Renew is well covered above. Complete and requeue need parity tests
  // across expired-but-unswept and post-sweep/pre-reclaim states.

  test(`${label}: completeClaim on an expired-but-unswept receipt rejects with lease_expired`, async () => {
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 1_000, generateReceipt: makeReceiptMinter() });
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;

    clock.advance(5_000); // past lease, no claimNext to trigger sweep
    await rejectsWithCode(q.completeClaim(claim), OcrQueueError, "lease_expired");
  });

  test(`${label}: requeueClaim on an expired-but-unswept receipt rejects with lease_expired`, async () => {
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 1_000, generateReceipt: makeReceiptMinter() });
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;

    clock.advance(5_000);
    await rejectsWithCode(q.requeueClaim(claim), OcrQueueError, "lease_expired");
  });

  test(`${label}: post-sweep / pre-reclaim — original receipt for a swept-but-not-yet-reclaimed job is unknown_receipt`, async () => {
    // Sweep without immediate reclaim of the same job: enqueue two distinct
    // jobs, claim both, expire both, then trigger one more claimNext. The
    // sweep moves both jobs back to waiting and the next claim consumes
    // one — leaving the other in waiting with no active claim under any
    // receipt. Its original receipt is now post-sweep/pre-reclaim.
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 1_000, generateReceipt: makeReceiptMinter("r") });
    const idA = "01jrk8m4q4xv2v8d4d4ymf5xn1";
    const idB = "01jrk8m4q4xv2v8d4d4ymf5xn2";
    await q.enqueue(makeJob({ jobId: idA }));
    await q.enqueue(makeJob({ jobId: idB }));
    const claimA = (await q.claimNext("w1")) as OcrQueueClaim;
    const claimB = (await q.claimNext("w2")) as OcrQueueClaim;
    assert.equal(claimA.job_id, idA);
    assert.equal(claimB.job_id, idB);

    clock.advance(5_000);
    const reclaim = (await q.claimNext("w3")) as OcrQueueClaim | null; // sweeps both, takes one
    assert.ok(reclaim);

    // Identify which one is still waiting (the one NOT reclaimed) and
    // assert its original receipt is treated as unknown_receipt — no
    // active claim with that job_id exists.
    const stranded = (reclaim as OcrQueueClaim).job_id === idA ? claimB : claimA;
    await rejectsWithCode(q.renewClaim(stranded), OcrQueueError, "unknown_receipt");
    await rejectsWithCode(q.completeClaim(stranded), OcrQueueError, "unknown_receipt");
    await rejectsWithCode(q.requeueClaim(stranded), OcrQueueError, "unknown_receipt");
  });

  // -------------------------------------------------------------------------
  // Fix #3: live receipt + wrong job_id → invalid_claim
  // -------------------------------------------------------------------------

  test(`${label}: a live receipt paired with the wrong job_id rejects with invalid_claim`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const real = (await q.claimNext("w")) as OcrQueueClaim;

    // Tampered claim: keeps the real (live) receipt but lies about job_id.
    // This is *not* legitimate lease succession (which would surface as
    // stale_receipt after expiry+reclaim) — it is malformed input.
    const tampered: OcrQueueClaim = { ...real, job_id: "01zzzzzzzzzzzzzzzzzzzzzzzz" };
    await rejectsWithCode(q.renewClaim(tampered), OcrQueueError, "invalid_claim");
    await rejectsWithCode(q.completeClaim(tampered), OcrQueueError, "invalid_claim");
    await rejectsWithCode(q.requeueClaim(tampered), OcrQueueError, "invalid_claim");
  });

  // -------------------------------------------------------------------------
  // Malformed input
  // -------------------------------------------------------------------------

  test(`${label}: a malformed claim (empty receipt) rejects with invalid_claim`, async () => {
    const q = makeImpl({});
    const malformed: OcrQueueClaim = {
      job_id: "01jrk8m4q4xv2v8d4d4ymf5xnk",
      job: makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }),
      worker_id: "w",
      claimed_at: "2030-01-01T00:00:00.000Z",
      lease_expires_at: "2030-01-01T00:00:30.000Z",
      receipt: "",
    };
    await rejectsWithCode(q.renewClaim(malformed), OcrQueueError, "invalid_claim");
    await rejectsWithCode(q.completeClaim(malformed), OcrQueueError, "invalid_claim");
    await rejectsWithCode(q.requeueClaim(malformed), OcrQueueError, "invalid_claim");
  });

  // -------------------------------------------------------------------------
  // Defensive cloning
  // -------------------------------------------------------------------------

  test(`${label}: mutating the returned claim's job does not change backend state`, async () => {
    const q = makeImpl({});
    const original = makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" });
    const originalPriority = (original.submission as { priority: number }).priority;
    await q.enqueue(original);
    const claim = (await q.claimNext("w")) as OcrQueueClaim;

    // Tamper post-claim.
    (claim.job.submission as { priority: number }).priority = 999;

    const renewed = await q.renewClaim(claim);
    assert.equal(
      (renewed.job.submission as { priority: number }).priority,
      originalPriority,
      "backend must hold the canonical submission, not the mutated copy",
    );
  });

  test(`${label}: mutating the original job after enqueue does not poison the queue`, async () => {
    const q = makeImpl({});
    const job = makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" });
    const originalPriority = (job.submission as { priority: number }).priority;
    await q.enqueue(job);
    (job.submission as { priority: number }).priority = 999;

    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    assert.equal(
      (claim.job.submission as { priority: number }).priority,
      originalPriority,
    );
  });

  // -------------------------------------------------------------------------
  // Step 10I-B2a — extended conformance
  //
  // Added cases:
  //   - canonical-JSON equivalence (different key order still dedupes)
  //   - dedupe return shape (`deduped` flag + canonical existing record)
  //   - active dedupe after `requeueClaim`
  //   - renew metadata authority (caller-supplied worker_id/claimed_at ignored)
  //   - lease boundary at exactly `now === lease_expires_at`
  //   - cross-terminal: double-requeue, complete-after-requeue
  //   - never-issued receipt parity for complete and requeue
  //   - rejection state-preservation for dedupe_conflict and invalid_claim
  // -------------------------------------------------------------------------

  test(`${label}: enqueue dedupes when canonical submissions match despite different key order`, async () => {
    const q = makeImpl({});
    const a = makeJob({
      jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
      submissionOverrides: { extraA: 1, extraB: 2 },
    });
    const b = makeJob({
      jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
      submissionOverrides: { extraB: 2, extraA: 1 },
    });
    // Precondition sanity: insertion-order JSON must differ for this test
    // to mean what it claims. Canonical equivalence is what dedupes them.
    assert.notEqual(
      JSON.stringify(a.submission),
      JSON.stringify(b.submission),
      "preconditions: insertion-order strings must differ",
    );

    const r1 = await q.enqueue(a);
    assert.equal(r1.deduped, false);
    const r2 = await q.enqueue(b);
    assert.equal(r2.deduped, true, "different key order must still dedupe");
  });

  test(`${label}: enqueue returns deduped:false on fresh and deduped:true with the existing canonical record`, async () => {
    const q = makeImpl({});
    const fresh = makeJob({
      jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
      transportId: "transport-A",
      enqueuedAt: "2030-01-01T00:00:00.000Z",
    });
    const r1 = await q.enqueue(fresh);
    assert.equal(r1.deduped, false);
    assert.equal(r1.job.id, "transport-A");
    assert.equal(r1.job.enqueued_at, "2030-01-01T00:00:00.000Z");

    const candidate = makeJob({
      jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
      transportId: "transport-B-different",
      enqueuedAt: "2030-12-31T23:59:59.000Z",
    });
    const r2 = await q.enqueue(candidate);
    assert.equal(r2.deduped, true);
    // Returned record must be the EXISTING queued one, not the candidate.
    assert.equal(r2.job.id, "transport-A");
    assert.equal(r2.job.enqueued_at, "2030-01-01T00:00:00.000Z");
  });

  test(`${label}: after requeueClaim, the slot is active and dedupes a same-payload enqueue`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    await q.requeueClaim(claim);

    // Same canonical submission must dedupe (active scope spans waiting).
    const r = await q.enqueue(
      makeJob({
        jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
        transportId: "transport-different",
      }),
    );
    assert.equal(r.deduped, true);

    // Different submission still conflicts on the active slot.
    await rejectsWithCode(
      q.enqueue(
        makeJob({
          jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
          submissionOverrides: { priority: 7 },
        }),
      ),
      OcrQueueError,
      "dedupe_conflict",
    );
  });

  test(`${label}: renewClaim returns authoritative metadata, not caller-supplied fields`, async () => {
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 30_000, generateReceipt: makeReceiptMinter() });
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const original = (await q.claimNext("real-worker")) as OcrQueueClaim;

    clock.advance(5_000);
    const forged: OcrQueueClaim = {
      ...original,
      worker_id: "imposter",
      claimed_at: "1999-01-01T00:00:00.000Z",
    };
    const renewed = await q.renewClaim(forged);
    assert.equal(
      renewed.worker_id,
      "real-worker",
      "renew must return the issuing worker, not the forged caller field",
    );
    assert.equal(
      renewed.claimed_at,
      original.claimed_at,
      "renew must return the issuance time, not the forged caller field",
    );
    assert.equal(renewed.receipt, original.receipt);
  });

  test(`${label}: at the exact lease boundary (now === lease_expires_at), receipt rejects as lease_expired`, async () => {
    const clock = makeClock();
    const leaseMs = 1_000;
    const q = makeImpl({ now: clock.now, leaseMs, generateReceipt: makeReceiptMinter() });
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;

    // Advance to exactly the lease deadline; both backends use a `<=`
    // comparison, so equality must reject.
    clock.advance(leaseMs);
    await rejectsWithCode(q.renewClaim(claim), OcrQueueError, "lease_expired");
  });

  test(`${label}: requeueClaim twice on the same receipt rejects on the second attempt`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    await q.requeueClaim(claim);
    await rejectsWithCode(q.requeueClaim(claim), OcrQueueError, "unknown_receipt");
  });

  test(`${label}: completeClaim after requeueClaim rejects with unknown_receipt`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    await q.requeueClaim(claim);
    await rejectsWithCode(q.completeClaim(claim), OcrQueueError, "unknown_receipt");
  });

  test(`${label}: completeClaim with a never-issued receipt rejects with unknown_receipt`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    const fake: OcrQueueClaim = { ...claim, receipt: "never-issued-receipt" };
    await rejectsWithCode(q.completeClaim(fake), OcrQueueError, "unknown_receipt");
  });

  test(`${label}: requeueClaim with a never-issued receipt rejects with unknown_receipt`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    const fake: OcrQueueClaim = { ...claim, receipt: "never-issued-receipt" };
    await rejectsWithCode(q.requeueClaim(fake), OcrQueueError, "unknown_receipt");
  });

  test(`${label}: dedupe_conflict does not mutate the active queued record`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    await rejectsWithCode(
      q.enqueue(
        makeJob({
          jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
          submissionOverrides: { priority: 99 },
        }),
      ),
      OcrQueueError,
      "dedupe_conflict",
    );
    // Original queued submission remains intact.
    const claim = (await q.claimNext("w")) as OcrQueueClaim;
    assert.notEqual(
      (claim.job.submission as { priority: number }).priority,
      99,
      "rejected enqueue must not overwrite the queued submission",
    );
  });

  test(`${label}: invalid_claim (forged job_id) does not consume or mutate the live receipt`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const real = (await q.claimNext("w")) as OcrQueueClaim;
    const tampered: OcrQueueClaim = { ...real, job_id: "01zzzzzzzzzzzzzzzzzzzzzzzz" };
    await rejectsWithCode(q.completeClaim(tampered), OcrQueueError, "invalid_claim");
    // Real receipt still works after the tampered rejection.
    const renewed = await q.renewClaim(real);
    assert.equal(renewed.receipt, real.receipt);
    await q.completeClaim(real);
  });

  // -------------------------------------------------------------------------
  // close (optional)
  // -------------------------------------------------------------------------

  test(`${label}: close (if implemented) is callable without throwing`, async () => {
    const q = makeImpl({});
    if (typeof q.close === "function") {
      await q.close();
    }
    // Backends without close() pass trivially; the test exists to keep the
    // optional method on the conformance radar.
  });
}
