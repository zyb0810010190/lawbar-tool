// Backend-agnostic conformance harness for `OcrJobQueueBackend` (Step 10B).
//
// Mirrors `runOcrPersistenceConformance` in spirit: every concrete backend
// (in-memory today, BullMQ tomorrow) imports this module and runs the same
// suite. A backend that diverges silently from the contract fails here.
//
// Inputs:
//   - label:           prefix for `node:test` test names
//   - makeImpl(opts):  factory returning a fresh `OcrJobQueueBackend`. The
//                      harness passes `{ now, leaseMs, generateReceipt }`
//                      so tests can drive deterministic time, lease length,
//                      and receipt minting.
//   - OcrQueueError:   the error class the backend throws. The harness
//                      asserts `err instanceof OcrQueueError` and that the
//                      `code` property matches the documented discriminant.
//
// Conventions:
//   - Submissions are derived from the canonical success fixture; job_id is
//     overridden per-test to keep dedupe scoping legible.
//   - When a test needs to advance simulated time, it owns its own
//     `clock` array and reads its head; the queue's injected `now` calls
//     `() => new Date(clock[0])` so the test can shift the clock between
//     queue ops without instantiating new wallclocks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(
  here,
  "..",
  "..",
  "node_modules",
  "ocr-worker-contract",
  "fixtures",
  "valid",
);
const baseSubmission = JSON.parse(
  readFileSync(join(fixtureDir, "submission-s3.json"), "utf8"),
);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a `OcrJob` with a chosen `submission.job_id`. The 26-char ULID
 * shape is preserved by overlaying onto the fixture.
 */
function makeJob({ jobId, transportId, enqueuedAt = "2030-01-01T00:00:00.000Z", scenario, submissionOverrides = {} } = {}) {
  const submission = structuredClone(baseSubmission);
  if (jobId) submission.job_id = jobId;
  for (const [k, v] of Object.entries(submissionOverrides)) submission[k] = v;
  const job = {
    id: transportId ?? `job-${jobId ?? submission.job_id}`,
    submission,
    enqueued_at: enqueuedAt,
  };
  if (scenario !== undefined) job.scenario = scenario;
  return job;
}

/**
 * Mutable clock helper. `clock.now()` returns the head epoch as a Date;
 * `clock.advance(ms)` adds to the head. Pass `clock.now` into makeImpl as
 * the queue's `now`.
 */
function makeClock(startMs = Date.UTC(2030, 0, 1)) {
  const state = { ms: startMs };
  return {
    now: () => new Date(state.ms),
    advance: (delta) => { state.ms += delta; },
    set: (ms) => { state.ms = ms; },
  };
}

/** Sequential receipt minter for deterministic tests. */
function makeReceiptMinter(prefix = "r") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

async function rejectsWithCode(promise, OcrQueueError, expectedCode) {
  await assert.rejects(promise, (err) => {
    return (
      err instanceof OcrQueueError &&
      err.code === expectedCode
    );
  }, `expected OcrQueueError(code=${expectedCode})`);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

export function runOcrQueueConformance({ label, makeImpl, OcrQueueError }) {
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
    assert.equal(claim.worker_id, "worker-A");
    assert.equal(claim.job_id, "01jrk8m4q4xv2v8d4d4ymf5xnk");
    assert.equal(claim.job.submission.job_id, "01jrk8m4q4xv2v8d4d4ymf5xnk");
    assert.equal(typeof claim.receipt, "string");
    assert.notEqual(claim.receipt, "");
    assert.equal(typeof claim.claimed_at, "string");
    assert.equal(typeof claim.lease_expires_at, "string");
    assert.ok(
      Date.parse(claim.lease_expires_at) > Date.parse(claim.claimed_at),
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

    const c1 = await q.claimNext("w");
    await q.completeClaim(c1);
    const c2 = await q.claimNext("w");
    await q.completeClaim(c2);
    const c3 = await q.claimNext("w");
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
    await q.completeClaim(c1);
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
    await q.completeClaim(c1);
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
    await q.completeClaim(c);

    const b = makeJob({
      jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk",
      submissionOverrides: { priority: 99 },
    });
    await q.enqueue(b); // must NOT throw
    const c2 = await q.claimNext("w");
    assert.ok(c2);
    assert.equal(c2.job.submission.priority, 99);
  });

  // -------------------------------------------------------------------------
  // renewClaim
  // -------------------------------------------------------------------------

  test(`${label}: renewClaim extends the lease and preserves the receipt`, async () => {
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 30_000, generateReceipt: makeReceiptMinter() });
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = await q.claimNext("w");

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
    const claim = await q.claimNext("w");
    const fake = { ...claim, receipt: "definitely-not-a-real-receipt" };
    await rejectsWithCode(q.renewClaim(fake), OcrQueueError, "unknown_receipt");
  });

  // -------------------------------------------------------------------------
  // completeClaim
  // -------------------------------------------------------------------------

  test(`${label}: completeClaim removes the job from the queue`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = await q.claimNext("w");
    await q.completeClaim(claim);
    const next = await q.claimNext("w");
    assert.equal(next, null);
  });

  test(`${label}: completing the same claim twice rejects on the second attempt`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = await q.claimNext("w");
    await q.completeClaim(claim);
    await rejectsWithCode(q.completeClaim(claim), OcrQueueError, "unknown_receipt");
  });

  // -------------------------------------------------------------------------
  // requeueClaim
  // -------------------------------------------------------------------------

  test(`${label}: requeueClaim makes the job claimable again`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = await q.claimNext("w");
    await q.requeueClaim(claim);

    const reclaim = await q.claimNext("w2");
    assert.ok(reclaim);
    assert.equal(reclaim.job_id, "01jrk8m4q4xv2v8d4d4ymf5xnk");
    assert.notEqual(
      reclaim.receipt,
      claim.receipt,
      "re-claim must mint a new receipt",
    );
  });

  test(`${label}: requeueClaim with an unknown receipt rejects`, async () => {
    const q = makeImpl({});
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = await q.claimNext("w");
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
    const claim = await q.claimNext("w");

    clock.advance(5_000); // well past 1s lease
    await rejectsWithCode(q.renewClaim(claim), OcrQueueError, "lease_expired");
  });

  test(`${label}: after lease expiry, the slot is reclaimable and the old receipt becomes stale`, async () => {
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 1_000, generateReceipt: makeReceiptMinter() });
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const oldClaim = await q.claimNext("w1");

    clock.advance(5_000);
    // Re-claim under a different worker. The expired claim is swept and a
    // new receipt is minted.
    const newClaim = await q.claimNext("w2");
    assert.ok(newClaim);
    assert.equal(newClaim.job_id, "01jrk8m4q4xv2v8d4d4ymf5xnk");
    assert.notEqual(newClaim.receipt, oldClaim.receipt);

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
    const claim = await q.claimNext("w");

    clock.advance(5_000); // past lease, no claimNext to trigger sweep
    await rejectsWithCode(q.completeClaim(claim), OcrQueueError, "lease_expired");
  });

  test(`${label}: requeueClaim on an expired-but-unswept receipt rejects with lease_expired`, async () => {
    const clock = makeClock();
    const q = makeImpl({ now: clock.now, leaseMs: 1_000, generateReceipt: makeReceiptMinter() });
    await q.enqueue(makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" }));
    const claim = await q.claimNext("w");

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
    const claimA = await q.claimNext("w1");
    const claimB = await q.claimNext("w2");
    assert.equal(claimA.job_id, idA);
    assert.equal(claimB.job_id, idB);

    clock.advance(5_000);
    const reclaim = await q.claimNext("w3"); // sweeps both, takes one
    assert.ok(reclaim);

    // Identify which one is still waiting (the one NOT reclaimed) and
    // assert its original receipt is treated as unknown_receipt — no
    // active claim with that job_id exists.
    const stranded = reclaim.job_id === idA ? claimB : claimA;
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
    const real = await q.claimNext("w");

    // Tampered claim: keeps the real (live) receipt but lies about job_id.
    // This is *not* legitimate lease succession (which would surface as
    // stale_receipt after expiry+reclaim) — it is malformed input.
    const tampered = { ...real, job_id: "01zzzzzzzzzzzzzzzzzzzzzzzz" };
    await rejectsWithCode(q.renewClaim(tampered), OcrQueueError, "invalid_claim");
    await rejectsWithCode(q.completeClaim(tampered), OcrQueueError, "invalid_claim");
    await rejectsWithCode(q.requeueClaim(tampered), OcrQueueError, "invalid_claim");
  });

  // -------------------------------------------------------------------------
  // Malformed input
  // -------------------------------------------------------------------------

  test(`${label}: a malformed claim (empty receipt) rejects with invalid_claim`, async () => {
    const q = makeImpl({});
    const malformed = {
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
    const originalPriority = original.submission.priority;
    await q.enqueue(original);
    const claim = await q.claimNext("w");

    // Tamper post-claim.
    claim.job.submission.priority = 999;

    const renewed = await q.renewClaim(claim);
    assert.equal(
      renewed.job.submission.priority,
      originalPriority,
      "backend must hold the canonical submission, not the mutated copy",
    );
  });

  test(`${label}: mutating the original job after enqueue does not poison the queue`, async () => {
    const q = makeImpl({});
    const job = makeJob({ jobId: "01jrk8m4q4xv2v8d4d4ymf5xnk" });
    const originalPriority = job.submission.priority;
    await q.enqueue(job);
    job.submission.priority = 999;

    const claim = await q.claimNext("w");
    assert.equal(claim.job.submission.priority, originalPriority);
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
