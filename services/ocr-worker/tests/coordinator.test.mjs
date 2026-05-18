// Step 10C — OCR processing coordinator tests.
//
// The tests use:
//   - the real `InMemoryOcrQueue` (Step 10B) for queue transport;
//   - the real fake worker via `processFakeOcrJob` from the contract package;
//   - a hand-rolled in-memory persistence (`FakePersistence` below) that
//     satisfies `OcrPersistencePort`. Hand-rolling avoids a circular
//     `ocr-worker-adapter` ↔ `ocr-persistence` dependency for tests, and
//     it gives each test cheap access to "pre-populate this state" and
//     "inject this error" without reaching into a real implementation.
//
// Where a test needs to perturb an otherwise-real flow (e.g. simulate
// `completeClaim` failing after persistence has already succeeded), it
// wraps the real backend with a thin proxy that intercepts a single
// method.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  InMemoryOcrQueue,
  OcrQueueError,
  processOneOcrQueueClaim,
  OcrProcessingCoordinator,
} from "../dist/index.js";
import { processFakeOcrJob } from "ocr-worker-contract/testing";
// Real persistence — relative path import bypasses npm package resolution so
// `ocr-worker` does not take a hard package dependency on `ocr-persistence`
// (which would create a cycle: persistence already devDep's worker).
import { InMemoryOcrPersistence } from "../../ocr-persistence/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(
  here,
  "..",
  "node_modules",
  "ocr-worker-contract",
  "fixtures",
  "valid",
);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const baseSubmission = readJson(join(fixtureDir, "submission-s3.json"));

// ---------------------------------------------------------------------------
// Fakes / helpers
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory persistence that satisfies `OcrPersistencePort`.
 *
 * Stores one `OcrJobRecord`-shaped object per `job_id` plus an append-only
 * status log and a per-(job_id,page_id) result store. Replay-safe writes
 * detect canonical-equal duplicates and no-op; conflicts throw.
 */
class FakePersistence {
  constructor() {
    this.jobs = new Map(); // job_id -> { terminal_state }
    this.statuses = new Map(); // job_id -> TransitionRecord[]
    this.results = new Map(); // job_id -> Map<page_id, result>
    this.calls = {
      getOcrJob: 0,
      appendOcrStatusOnce: 0,
      saveOcrResultOnce: 0,
    };
  }

  /** Pre-populate a job record so the coordinator does not hit the no-row path. */
  seedJob(job_id, terminal_state) {
    this.jobs.set(job_id, { terminal_state });
  }

  /** Pre-populate a status row (used to drive replay/conflict tests). */
  seedStatus(job_id, transition) {
    if (!this.statuses.has(job_id)) this.statuses.set(job_id, []);
    this.statuses.get(job_id).push({ ...transition });
    if (!this.jobs.has(job_id)) this.jobs.set(job_id, {});
    this.jobs.get(job_id).terminal_state = transition.to;
  }

  /** Pre-populate a per-page result (used to drive replay/conflict tests). */
  seedResult(job_id, result) {
    if (!this.results.has(job_id)) this.results.set(job_id, new Map());
    this.results.get(job_id).set(result.page_id, structuredClone(result));
  }

  async getOcrJob(jobId) {
    this.calls.getOcrJob++;
    const r = this.jobs.get(jobId);
    return r === undefined ? null : { terminal_state: r.terminal_state };
  }

  async appendOcrStatusOnce(jobId, transition) {
    this.calls.appendOcrStatusOnce++;
    const log = this.statuses.get(jobId) ?? [];
    // Canonical equality on (from,to,controlled_by,at,note).
    for (const stored of log) {
      if (
        stored.from === transition.from &&
        stored.to === transition.to &&
        stored.controlled_by === transition.controlled_by &&
        stored.at === transition.at &&
        (stored.note ?? null) === (transition.note ?? null)
      ) {
        return stored; // exact replay — no-op
      }
    }
    // Strict append: chain must extend the last persisted `to`.
    if (log.length > 0) {
      const lastTo = log[log.length - 1].to;
      if (lastTo !== transition.from) {
        const e = new Error(
          `chain break: last persisted to=${lastTo}, incoming from=${transition.from}`,
        );
        e.name = "OcrPersistenceError";
        throw e;
      }
    }
    const stored = { ...transition };
    log.push(stored);
    this.statuses.set(jobId, log);
    if (!this.jobs.has(jobId)) this.jobs.set(jobId, {});
    this.jobs.get(jobId).terminal_state = transition.to;
    return stored;
  }

  async saveOcrResultOnce(jobId, result) {
    this.calls.saveOcrResultOnce++;
    if (!this.results.has(jobId)) this.results.set(jobId, new Map());
    const byPage = this.results.get(jobId);
    const existing = byPage.get(result.page_id);
    if (existing !== undefined) {
      // Canonical equality across the contract result payload.
      if (JSON.stringify(canonicalize(existing)) === JSON.stringify(canonicalize(result))) {
        return existing; // exact replay — no-op
      }
      const e = new Error(
        `conflicting duplicate result for job_id=${jobId}, page_id=${result.page_id}`,
      );
      e.name = "OcrPersistenceError";
      throw e;
    }
    const stored = structuredClone(result);
    byPage.set(result.page_id, stored);
    return stored;
  }
  // ADR-11G outbox surface. The existing coordinator.test.mjs suite
  // never exercises the failed-terminal retry path, so these are no-op
  // stubs satisfying the OcrPersistencePort interface.
  async setOcrPendingRetry(jobId, submission) {
    if (!this.jobs.has(jobId)) this.jobs.set(jobId, {});
    this.jobs.get(jobId).pending_retry_submission = structuredClone(submission);
  }
  async getOcrPendingRetry(jobId) {
    const j = this.jobs.get(jobId);
    return j?.pending_retry_submission
      ? structuredClone(j.pending_retry_submission)
      : null;
  }
  async clearOcrPendingRetry(jobId) {
    const j = this.jobs.get(jobId);
    if (j) delete j.pending_retry_submission;
  }
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) {
    if (value[k] === undefined) continue;
    out[k] = canonicalize(value[k]);
  }
  return out;
}

/** Real fake-worker adapter: processFakeOcrJob via the OcrWorker shape. */
function realWorker(scenarioByJobId = {}) {
  return {
    async process(job) {
      const sub = job.submission;
      const scenario =
        job.scenario ?? scenarioByJobId[sub.job_id] ?? "success";
      return processFakeOcrJob(sub, { scenario });
    },
  };
}

/** Worker that always throws. */
function throwingWorker(message = "boom") {
  return {
    async process() {
      throw new Error(message);
    },
  };
}

/** Worker that returns a contract-invalid outcome (mismatched job_id). */
function contractInvalidWorker() {
  return {
    async process(job) {
      const real = await processFakeOcrJob(job.submission, { scenario: "success" });
      // Use a distinct but ULID-shaped id so the contract sequence schema
      // passes and the binding check (outcome.job_id vs submission.job_id)
      // is the gate that rejects the outcome.
      return { ...real, job_id: "01hzzzzzzzzzzzzzzzzzzzzzzz" };
    },
  };
}

/** Wrap a queue backend to override `completeClaim`. */
function withCompleteOverride(backend, override) {
  return new Proxy(backend, {
    get(target, prop, receiver) {
      if (prop === "completeClaim") return override;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** Wrap a queue backend to override `requeueClaim`. */
function withRequeueOverride(backend, override) {
  return new Proxy(backend, {
    get(target, prop, receiver) {
      if (prop === "requeueClaim") return override;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** Build a multi-page submission cloned from the canonical fixture. */
function makeMultiPageSubmission(n, jobId) {
  const sub = structuredClone(baseSubmission);
  if (jobId !== undefined) sub.job_id = jobId;
  const proto = sub.pages[0];
  const pages = [];
  for (let i = 0; i < n; i++) {
    const idx = i + 1;
    const suffix = `p${String(idx).padStart(2, "0")}`;
    const page_id = (proto.page_id.slice(0, 26 - suffix.length) + suffix).slice(0, 26);
    pages.push({
      page_id,
      page_number: idx,
      source: {
        ...proto.source,
        key: proto.source.key.replace(/page-\d+\.png/, `page-${String(idx).padStart(3, "0")}.png`),
      },
    });
  }
  sub.pages = pages;
  return sub;
}

/**
 * Build an OcrJob payload (the shape `queue.enqueue` consumes), with a
 * fixed clock so `enqueued_at` is deterministic.
 */
function makeJob(submission, idSuffix = "1") {
  return {
    id: `coord-job-${idSuffix}`,
    submission: structuredClone(submission),
    enqueued_at: "2030-01-01T00:00:00.000Z",
  };
}

/** Make a clock that ticks 1 second per call from a fixed start. */
function makeTickingClock(startISO = "2030-02-01T00:00:00.000Z") {
  let t = new Date(startISO).getTime();
  return () => {
    const d = new Date(t);
    t += 1000;
    return d;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("empty queue returns outcome=empty", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.deepEqual(result, { outcome: "empty" });
  // Worker was never asked anything because nothing was claimable.
  assert.equal(persistence.calls.getOcrJob, 0);
  assert.equal(persistence.calls.appendOcrStatusOnce, 0);
});

test("missing persisted job record: no worker call, requeue, persistence_failed", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  // Deliberately do NOT seedJob — the coordinator should refuse to run.
  await queue.enqueue(makeJob(baseSubmission));
  let workerCalled = false;
  const worker = {
    async process() {
      workerCalled = true;
      throw new Error("worker should not be invoked");
    },
  };
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker,
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "persistence_failed");
  assert.equal(result.job_id, baseSubmission.job_id);
  assert.match(result.error.message, /no persisted job record/);
  assert.equal(workerCalled, false);
  // Job should be back in the waiting set after requeue, not still claimed.
  assert.equal(queue.waitingCount(), 1);
  assert.equal(queue.claimedCount(), 0);
  // Persistence had only one read; nothing was written.
  assert.equal(persistence.calls.appendOcrStatusOnce, 0);
  assert.equal(persistence.calls.saveOcrResultOnce, 0);
});

test("already-terminal redelivery: skips worker, completes claim, completed_already_terminal", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id, "succeeded");
  await queue.enqueue(makeJob(baseSubmission));
  let workerCalled = false;
  const worker = {
    async process() {
      workerCalled = true;
      throw new Error("worker must not run for terminal redelivery");
    },
  };
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker,
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "completed_already_terminal");
  assert.equal(result.job_id, baseSubmission.job_id);
  assert.equal(workerCalled, false);
  // Claim is gone; queue is empty.
  assert.equal(queue.waitingCount(), 0);
  assert.equal(queue.claimedCount(), 0);
  // No new persistence writes — the terminal-skip path does not append.
  assert.equal(persistence.calls.appendOcrStatusOnce, 0);
});

test("success lifecycle: persists queued→claimed, claimed→processing, processing→succeeded, results, completes", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await queue.enqueue(makeJob(baseSubmission));
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "completed");
  assert.equal(result.job_id, baseSubmission.job_id);
  assert.equal(result.statuses_persisted, 3); // queued→claimed + claimed→processing + processing→succeeded
  assert.equal(result.results_persisted, baseSubmission.pages.length);
  // Queue claim acked.
  assert.equal(queue.waitingCount(), 0);
  assert.equal(queue.claimedCount(), 0);
  // Persistence chain ends at succeeded.
  const log = persistence.statuses.get(baseSubmission.job_id);
  assert.equal(log[0].from, "queued");
  assert.equal(log[0].to, "claimed");
  assert.equal(log[0].controlled_by, "queue");
  assert.equal(log[1].from, "claimed");
  assert.equal(log[1].to, "processing");
  assert.equal(log[1].controlled_by, "worker");
  assert.equal(log[log.length - 1].to, "succeeded");
});

test("partial_failure lifecycle: persists worker tail and completes", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  const sub = makeMultiPageSubmission(2, "01jrk8m4q4xv2v8d4d4ymf5pf1");
  persistence.seedJob(sub.job_id);
  await queue.enqueue(makeJob(sub, "pf"));
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker({ [sub.job_id]: "partial_failure" }),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "completed");
  assert.equal(result.statuses_persisted, 3);
  assert.equal(result.results_persisted, 2);
  const log = persistence.statuses.get(sub.job_id);
  assert.equal(log[log.length - 1].to, "partial_succeeded");
});

test("worker throws: requeue, no worker statuses/results persisted, queued→claimed kept", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await queue.enqueue(makeJob(baseSubmission));
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: throwingWorker("transient OCR failure"),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "requeued");
  assert.match(result.error.message, /worker threw: transient OCR failure/);
  // Job is back in waiting.
  assert.equal(queue.waitingCount(), 1);
  assert.equal(queue.claimedCount(), 0);
  // queued→claimed was already persisted before the worker ran; that is
  // expected and is replay-safe on the next delivery. No worker
  // transitions and no results were persisted.
  const log = persistence.statuses.get(baseSubmission.job_id);
  assert.equal(log.length, 1);
  assert.equal(log[0].from, "queued");
  assert.equal(log[0].to, "claimed");
  assert.equal(persistence.calls.saveOcrResultOnce, 0);
});

test("contract-invalid worker output: requeue, no worker statuses/results persisted", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await queue.enqueue(makeJob(baseSubmission));
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: contractInvalidWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "requeued");
  assert.match(result.error.message, /outcome\.job_id .* does not match submission\.job_id/);
  assert.equal(queue.waitingCount(), 1);
  // Only queued→claimed was persisted.
  const log = persistence.statuses.get(baseSubmission.job_id);
  assert.equal(log.length, 1);
  assert.equal(log[0].to, "claimed");
});

test("transient_then_success / bundled retry: rejected, requeued, no worker statuses persisted", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await queue.enqueue(makeJob(baseSubmission));
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker({ [baseSubmission.job_id]: "transient_then_success" }),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "requeued");
  assert.match(result.error.message, /non-worker edge .* controlled_by=queue/);
  assert.equal(queue.waitingCount(), 1);
  // Only queued→claimed; no worker tail was persisted because normalization rejected.
  const log = persistence.statuses.get(baseSubmission.job_id);
  assert.equal(log.length, 1);
});

test("permanent_failure (DLQ-bundled): rejected, requeued — Step 10C does not admit it", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await queue.enqueue(makeJob(baseSubmission));
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker({ [baseSubmission.job_id]: "permanent_failure" }),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "requeued");
  // The fake-worker permanent_failure tail is processing→failed (worker)
  // followed by failed→dead_lettered (queue). Normalization rejects on
  // either the queue-owned DLQ edge OR (if that edge were absent) the
  // tail not ending at a Step-10C-admitted terminal. Either reason is
  // acceptable — assert the rejection itself, not the wording.
  assert.ok(/non-worker edge|does not match|admits only/.test(result.error.message));
  assert.equal(queue.waitingCount(), 1);
});

test("persistence conflict on result write: persistence_failed, claim NOT completed", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  // Pre-seed a *conflicting* result for the same page_id so the
  // coordinator's saveOcrResultOnce will reject.
  const conflicting = {
    job_id: baseSubmission.job_id,
    tenant_id: baseSubmission.tenant_id,
    document_id: baseSubmission.document_id,
    page_id: baseSubmission.pages[0].page_id,
    page_number: baseSubmission.pages[0].page_number,
    bogus_field_to_force_inequality: true,
  };
  persistence.seedResult(baseSubmission.job_id, conflicting);
  await queue.enqueue(makeJob(baseSubmission));
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "persistence_failed");
  assert.match(result.error.message, /persistence write failed/);
  // ADR Decision 9: claim must NOT be completed. The coordinator does
  // not requeue on this branch either — the lease will eventually expire
  // and the queue will redeliver.
  assert.equal(queue.claimedCount(), 1);
  assert.equal(queue.waitingCount(), 0);
});

test("completeClaim fails with lease_expired after persistence success: lease_lost", async () => {
  const real = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await real.enqueue(makeJob(baseSubmission));
  const queue = withCompleteOverride(real, async () => {
    throw new OcrQueueError("lease_expired", "synthetic lease expiry");
  });
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "lease_lost");
  assert.equal(result.error.code, "lease_expired");
  // Persistence still saw the full chain plus results.
  assert.equal(result.statuses_persisted, 3);
  assert.equal(result.results_persisted, baseSubmission.pages.length);
});

test("completeClaim fails with stale_receipt after persistence success: ack_failed", async () => {
  const real = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await real.enqueue(makeJob(baseSubmission));
  const queue = withCompleteOverride(real, async () => {
    throw new OcrQueueError("stale_receipt", "synthetic stale receipt");
  });
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "ack_failed");
  assert.equal(result.error.code, "stale_receipt");
});

test("completeClaim fails with unknown_receipt after persistence success: ack_failed", async () => {
  const real = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await real.enqueue(makeJob(baseSubmission));
  const queue = withCompleteOverride(real, async () => {
    throw new OcrQueueError("unknown_receipt", "synthetic unknown receipt");
  });
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "ack_failed");
  assert.equal(result.error.code, "unknown_receipt");
});

test("completeClaim fails with invalid_claim after persistence success: ack_failed", async () => {
  const real = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await real.enqueue(makeJob(baseSubmission));
  const queue = withCompleteOverride(real, async () => {
    throw new OcrQueueError("invalid_claim", "synthetic invalid claim");
  });
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(result.outcome, "ack_failed");
  assert.equal(result.error.code, "invalid_claim");
});

test("exact redelivery replay after a successful processing: terminal-skip path is idempotent", async () => {
  // Run 1: fresh job, finishes with outcome=completed.
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await queue.enqueue(makeJob(baseSubmission));
  const r1 = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(r1.outcome, "completed");
  const statusesAfterRun1 = persistence.statuses.get(baseSubmission.job_id).length;
  const resultsAfterRun1 = persistence.results.get(baseSubmission.job_id).size;

  // Run 2: simulate redelivery by re-enqueuing the same logical job. The
  // queue dedupe rejects an active duplicate, so we instead enqueue and
  // claim — but persistence already shows succeeded, so the coordinator
  // takes the terminal-skip path.
  await queue.enqueue(makeJob(baseSubmission, "redelivery"));
  const r2 = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(r2.outcome, "completed_already_terminal");

  // Persistence is unchanged — no new statuses, no new results.
  assert.equal(
    persistence.statuses.get(baseSubmission.job_id).length,
    statusesAfterRun1,
  );
  assert.equal(
    persistence.results.get(baseSubmission.job_id).size,
    resultsAfterRun1,
  );
});

test("OcrProcessingCoordinator class wrapper exposes the same behavior", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await queue.enqueue(makeJob(baseSubmission));
  const coord = new OcrProcessingCoordinator({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  const result = await coord.processOne();
  assert.equal(result.outcome, "completed");
});

test("queued→claimed write is idempotent across redelivery before terminal", async () => {
  // Pre-populate a queued→claimed status to simulate "a previous attempt
  // wrote queued→claimed but then crashed before running the worker."
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  // Use the same `at` the coordinator's clock will mint so the replay-safe
  // append finds an exact match and no-ops.
  const clock = makeTickingClock();
  const willMintAt = new Date("2030-02-01T00:00:00.000Z").toISOString();
  persistence.seedStatus(baseSubmission.job_id, {
    from: "queued",
    to: "claimed",
    controlled_by: "queue",
    at: willMintAt,
  });
  await queue.enqueue(makeJob(baseSubmission));
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-1",
    now: clock,
  });
  assert.equal(result.outcome, "completed");
  // Status log has queued→claimed (idempotent), claimed→processing, processing→succeeded.
  const log = persistence.statuses.get(baseSubmission.job_id);
  assert.equal(log.length, 3);
});

// ---------------------------------------------------------------------------
// B2 missing-persisted-row × requeueClaim failure sub-branches
// ---------------------------------------------------------------------------
//
// All four tests share shape: the queue holds a claimable job, persistence
// returns null for that job_id, and `requeueClaim` is forced to throw a
// specific OcrQueueError code. The coordinator's `tryRequeueAs` mapping
// must surface the documented outcome for each code.

/** Drive the B2 path with `requeueClaim` forced to throw a given code. */
async function runMissingRowWithRequeueError(code) {
  const real = new InMemoryOcrQueue();
  await real.enqueue(makeJob(baseSubmission));
  const queue = withRequeueOverride(real, async () => {
    throw new OcrQueueError(code, `injected ${code}`);
  });
  const persistence = new FakePersistence(); // no seedJob → getOcrJob returns null
  let workerCalled = false;
  const worker = {
    async process() {
      workerCalled = true;
      throw new Error("worker must not be invoked when persistence row is missing");
    },
  };
  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker,
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(workerCalled, false);
  assert.equal(persistence.calls.appendOcrStatusOnce, 0);
  assert.equal(persistence.calls.saveOcrResultOnce, 0);
  return result;
}

test("B2 missing row + requeueClaim fails with lease_expired → outcome=lease_lost", async () => {
  const result = await runMissingRowWithRequeueError("lease_expired");
  assert.equal(result.outcome, "lease_lost");
  assert.equal(result.job_id, baseSubmission.job_id);
  assert.equal(result.error.code, "lease_expired");
  // Original B2 reason is preserved alongside the requeue failure.
  assert.match(result.error.message, /no persisted job record/);
  assert.match(result.error.message, /requeueClaim: injected lease_expired/);
});

test("B2 missing row + requeueClaim fails with stale_receipt → outcome=ack_failed", async () => {
  const result = await runMissingRowWithRequeueError("stale_receipt");
  assert.equal(result.outcome, "ack_failed");
  assert.equal(result.job_id, baseSubmission.job_id);
  assert.equal(result.error.code, "stale_receipt");
  assert.match(result.error.message, /no persisted job record/);
  assert.match(result.error.message, /requeueClaim: injected stale_receipt/);
});

test("B2 missing row + requeueClaim fails with unknown_receipt → outcome=ack_failed", async () => {
  const result = await runMissingRowWithRequeueError("unknown_receipt");
  assert.equal(result.outcome, "ack_failed");
  assert.equal(result.error.code, "unknown_receipt");
  assert.match(result.error.message, /requeueClaim: injected unknown_receipt/);
});

test("B2 missing row + requeueClaim fails with invalid_claim → outcome=ack_failed", async () => {
  const result = await runMissingRowWithRequeueError("invalid_claim");
  assert.equal(result.outcome, "ack_failed");
  assert.equal(result.error.code, "invalid_claim");
  assert.match(result.error.message, /requeueClaim: injected invalid_claim/);
});

// ---------------------------------------------------------------------------
// Real persistence integration (InMemoryOcrPersistence)
// ---------------------------------------------------------------------------
//
// All other coordinator tests use `FakePersistence` for branch coverage.
// This test exercises the structural seam: the real `OcrPersistence`
// implementation must satisfy `OcrPersistencePort` and produce the same
// successful end-to-end flow. If the seam ever drifts (e.g. a method
// signature changes), this test should be the first to catch it.

test("integration: real InMemoryOcrPersistence drives a success lifecycle end-to-end", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new InMemoryOcrPersistence({
    now: makeTickingClock("2030-03-01T00:00:00.000Z"),
  });

  // Real persistence requires a job row before any status append.
  const jobRecord = await persistence.createOcrJob(baseSubmission);
  assert.equal(jobRecord.job_id, baseSubmission.job_id);
  assert.equal(jobRecord.terminal_state, undefined);

  await queue.enqueue(makeJob(baseSubmission));

  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: realWorker(),
    worker_id: "w-int",
    now: makeTickingClock("2030-03-02T00:00:00.000Z"),
  });

  assert.equal(result.outcome, "completed");
  assert.equal(result.job_id, baseSubmission.job_id);
  // queued→claimed + claimed→processing + processing→succeeded
  assert.equal(result.statuses_persisted, 3);
  assert.equal(result.results_persisted, baseSubmission.pages.length);

  // Persistence is the source of truth — read it back via the real API.
  const after = await persistence.getOcrJob(baseSubmission.job_id);
  assert.notEqual(after, null);
  assert.equal(after.terminal_state, "succeeded");

  const statuses = await persistence.listOcrJobStatuses(baseSubmission.job_id);
  assert.equal(statuses.length, 3);
  assert.equal(statuses[0].from, "queued");
  assert.equal(statuses[0].to, "claimed");
  assert.equal(statuses[0].controlled_by, "queue");
  assert.equal(statuses[1].from, "claimed");
  assert.equal(statuses[1].to, "processing");
  assert.equal(statuses[1].controlled_by, "worker");
  assert.equal(statuses[2].from, "processing");
  assert.equal(statuses[2].to, "succeeded");
  assert.equal(statuses[2].controlled_by, "worker");

  const results = await persistence.listOcrResults(baseSubmission.job_id);
  assert.equal(results.length, baseSubmission.pages.length);
  for (const r of results) {
    // OcrResultRecord wraps the contract payload under `.result`.
    assert.equal(r.result.job_id, baseSubmission.job_id);
    assert.equal(r.result.tenant_id, baseSubmission.tenant_id);
    assert.equal(r.result.document_id, baseSubmission.document_id);
  }

  // Queue claim was completed.
  assert.equal(queue.waitingCount(), 0);
  assert.equal(queue.claimedCount(), 0);
});
