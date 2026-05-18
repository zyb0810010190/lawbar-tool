// ADR-11F coordinator retry-wiring tests.
//
// The fake worker scenarios `permanent_failure` and `transient_then_success`
// emit BUNDLED queue+worker transitions (the queue-controlled retry/DLQ edge
// is baked into the worker output). The Step-10C normalizer rejects those
// bundles, so they can't exercise the retry seam.
//
// We use a hand-rolled worker that emits ONLY worker-controlled edges ending
// at `failed`, with the result carrying a failure code whose is_transient bit
// drives the classifier. The coordinator's Step 8.5 should then own the
// queue-controlled `failed → queued` or `failed → dead_lettered` transition.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  InMemoryOcrQueue,
  OcrQueueError,
  processOneOcrQueueClaim,
} from "../dist/index.js";

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
const failureFixture = readJson(join(fixtureDir, "result-partial-failure.json"));

// ---------------------------------------------------------------------------
// Persistence + worker fakes
// ---------------------------------------------------------------------------

class FakePersistence {
  constructor() {
    this.jobs = new Map();
    this.statuses = new Map();
    this.results = new Map();
    this.calls = {
      getOcrJob: 0,
      appendOcrStatusOnce: 0,
      saveOcrResultOnce: 0,
    };
    this.injectFailure = null;
  }
  seedJob(job_id, terminal_state) {
    this.jobs.set(job_id, { terminal_state });
  }
  async getOcrJob(jobId) {
    this.calls.getOcrJob++;
    const r = this.jobs.get(jobId);
    return r === undefined ? null : { terminal_state: r.terminal_state };
  }
  async appendOcrStatusOnce(jobId, transition) {
    this.calls.appendOcrStatusOnce++;
    if (this.injectFailure?.kind === "append" && this.injectFailure.matches(transition)) {
      const e = new Error(this.injectFailure.message);
      e.name = "OcrPersistenceError";
      throw e;
    }
    const log = this.statuses.get(jobId) ?? [];
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
    this.results.get(jobId).set(result.page_id, structuredClone(result));
    return result;
  }
}

/**
 * Build a worker that emits a failed outcome with a single failed result.
 * `isTransient` drives the partial_failure.is_transient bit.
 */
function failingWorker({ isTransient, code = "engine_failed" }) {
  return {
    async process(job) {
      const sub = job.submission;
      const page = sub.pages[0];
      const result = structuredClone(failureFixture);
      result.job_id = sub.job_id;
      result.tenant_id = sub.tenant_id;
      result.document_id = sub.document_id;
      if (sub.document_revision !== undefined) {
        result.document_revision = sub.document_revision;
      }
      result.page_id = page.page_id;
      result.page_number = page.page_number;
      result.metadata = structuredClone(sub.metadata);
      result.partial_failure = {
        code,
        message: "test-induced failure",
        is_transient: isTransient,
        attempted_count: 1,
      };
      result.completed_at = "2030-02-01T00:00:10.000Z";
      const statuses = [
        { from: "queued", to: "claimed", controlled_by: "queue", at: "2030-02-01T00:00:00.000Z" },
        { from: "claimed", to: "processing", controlled_by: "worker", at: "2030-02-01T00:00:01.000Z" },
        { from: "processing", to: "failed", controlled_by: "worker", at: "2030-02-01T00:00:02.000Z" },
      ];
      return {
        job_id: sub.job_id,
        statuses,
        results: [result],
        terminal_state: "failed",
      };
    },
  };
}

function makeJob(submission, idSuffix = "1") {
  return {
    id: `coord-job-${idSuffix}`,
    submission: structuredClone(submission),
    enqueued_at: "2030-01-01T00:00:00.000Z",
  };
}

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

test("ADR-11F retry: transient failure with budget remaining → outcome=retried, new job enqueued, retry.attempt bumped", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  const sub = structuredClone(baseSubmission);
  sub.retry = { ...sub.retry, max_attempts: 3, attempt: 1 };
  await queue.enqueue(makeJob(sub, "retry-A"));

  const enqueued = [];
  const queueWrap = new Proxy(queue, {
    get(t, p, r) {
      if (p === "enqueue") {
        return async (job) => {
          enqueued.push(job);
          return t.enqueue(job);
        };
      }
      const v = Reflect.get(t, p, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });

  let n = 0;
  const generateJobId = () => `retry-job-${++n}`;

  const result = await processOneOcrQueueClaim({
    queue: queueWrap,
    persistence,
    worker: failingWorker({ isTransient: true }),
    worker_id: "w-1",
    now: makeTickingClock(),
    generateJobId,
  });

  assert.equal(result.outcome, "retried");
  assert.equal(result.job_id, baseSubmission.job_id);

  const log = persistence.statuses.get(baseSubmission.job_id);
  const last = log[log.length - 1];
  assert.equal(last.from, "failed");
  assert.equal(last.to, "queued");
  assert.equal(last.controlled_by, "queue");

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].id, "retry-job-1");
  assert.equal(enqueued[0].submission.job_id, baseSubmission.job_id);
  assert.equal(enqueued[0].submission.retry.attempt, 2);

  assert.equal(queue.waitingCount(), 1);
  assert.equal(queue.claimedCount(), 0);
});

test("ADR-11F retry: transient failure with budget exhausted → outcome=dead_lettered", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  const sub = structuredClone(baseSubmission);
  sub.retry = { ...sub.retry, max_attempts: 3, attempt: 3 };
  await queue.enqueue(makeJob(sub, "retry-B"));

  let enqueueCount = 0;
  const queueWrap = new Proxy(queue, {
    get(t, p, r) {
      if (p === "enqueue") {
        return async (job) => {
          enqueueCount++;
          return t.enqueue(job);
        };
      }
      const v = Reflect.get(t, p, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });

  const result = await processOneOcrQueueClaim({
    queue: queueWrap,
    persistence,
    worker: failingWorker({ isTransient: true }),
    worker_id: "w-1",
    now: makeTickingClock(),
  });

  assert.equal(result.outcome, "dead_lettered");
  assert.equal(result.job_id, baseSubmission.job_id);

  const log = persistence.statuses.get(baseSubmission.job_id);
  const last = log[log.length - 1];
  assert.equal(last.from, "failed");
  assert.equal(last.to, "dead_lettered");
  assert.equal(last.controlled_by, "queue");

  assert.equal(persistence.jobs.get(baseSubmission.job_id).terminal_state, "dead_lettered");

  // No re-enqueue on dead-letter (seed went through bare `queue`, not the
  // proxy, so this counter only sees coordinator-issued enqueues).
  assert.equal(enqueueCount, 0);
  assert.equal(queue.waitingCount(), 0);
  assert.equal(queue.claimedCount(), 0);
});

test("ADR-11F retry: permanent failure → outcome=dead_lettered regardless of budget", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  const sub = structuredClone(baseSubmission);
  // Budget is fresh (attempt=1, max=3) but failure is permanent.
  sub.retry = { ...sub.retry, max_attempts: 3, attempt: 1 };
  await queue.enqueue(makeJob(sub, "retry-C"));

  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: failingWorker({ isTransient: false, code: "mime_unsupported" }),
    worker_id: "w-1",
    now: makeTickingClock(),
  });

  assert.equal(result.outcome, "dead_lettered");
  const log = persistence.statuses.get(baseSubmission.job_id);
  const last = log[log.length - 1];
  assert.equal(last.to, "dead_lettered");
  assert.equal(persistence.jobs.get(baseSubmission.job_id).terminal_state, "dead_lettered");
  assert.equal(queue.waitingCount(), 0);
  assert.equal(queue.claimedCount(), 0);
});

test("ADR-11F retry: succeeded outcome path unchanged (no retry decision)", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  await queue.enqueue(makeJob(baseSubmission, "succ"));

  const successWorker = {
    async process(job) {
      const sub = job.submission;
      const page = sub.pages[0];
      const successFixture = readJson(
        join(fixtureDir, "result-chinese-litigation.json"),
      );
      const result = structuredClone(successFixture);
      result.job_id = sub.job_id;
      result.tenant_id = sub.tenant_id;
      result.document_id = sub.document_id;
      if (sub.document_revision !== undefined) {
        result.document_revision = sub.document_revision;
      }
      result.page_id = page.page_id;
      result.page_number = page.page_number;
      result.metadata = structuredClone(sub.metadata);
      result.completed_at = "2030-02-01T00:00:10.000Z";
      return {
        job_id: sub.job_id,
        statuses: [
          { from: "queued", to: "claimed", controlled_by: "queue", at: "2030-02-01T00:00:00.000Z" },
          { from: "claimed", to: "processing", controlled_by: "worker", at: "2030-02-01T00:00:01.000Z" },
          { from: "processing", to: "succeeded", controlled_by: "worker", at: "2030-02-01T00:00:02.000Z" },
        ],
        results: [result],
        terminal_state: "succeeded",
      };
    },
  };

  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: successWorker,
    worker_id: "w-1",
    now: makeTickingClock(),
  });

  assert.equal(result.outcome, "completed");
  assert.equal(persistence.jobs.get(baseSubmission.job_id).terminal_state, "succeeded");
});

test("ADR-11F retry: appendOcrStatusOnce(failed→queued) failure → persistence_failed, no enqueue", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  const sub = structuredClone(baseSubmission);
  sub.retry = { ...sub.retry, max_attempts: 3, attempt: 1 };
  await queue.enqueue(makeJob(sub, "retry-D"));

  persistence.injectFailure = {
    kind: "append",
    message: "simulated persistence outage",
    matches: (t) => t.from === "failed" && t.to === "queued",
  };

  let enqueueCalls = 0;
  const queueWrap = new Proxy(queue, {
    get(t, p, r) {
      if (p === "enqueue") {
        return async (job) => {
          enqueueCalls++;
          return t.enqueue(job);
        };
      }
      const v = Reflect.get(t, p, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });

  const result = await processOneOcrQueueClaim({
    queue: queueWrap,
    persistence,
    worker: failingWorker({ isTransient: true }),
    worker_id: "w-1",
    now: makeTickingClock(),
  });

  assert.equal(result.outcome, "persistence_failed");
  assert.match(result.error.message, /failed→queued.*simulated persistence outage/);
  // No retry enqueue (proxy was attached AFTER the seed enqueue).
  assert.equal(enqueueCalls, 0);
});

test("ADR-11F retry: queue.enqueue(retry) failure → persistence_failed; failed→queued already persisted", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  const sub = structuredClone(baseSubmission);
  sub.retry = { ...sub.retry, max_attempts: 3, attempt: 1 };
  await queue.enqueue(makeJob(sub, "retry-E"));

  // Seed enqueue went through bare `queue`. The proxy's first enqueue call
  // is the retry — make it fail.
  let enqueueCount = 0;
  const queueWrap = new Proxy(queue, {
    get(t, p, r) {
      if (p === "enqueue") {
        return async (_job) => {
          enqueueCount++;
          throw new OcrQueueError(
            "dedupe_conflict",
            "simulated enqueue failure",
          );
        };
      }
      const v = Reflect.get(t, p, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });

  const result = await processOneOcrQueueClaim({
    queue: queueWrap,
    persistence,
    worker: failingWorker({ isTransient: true }),
    worker_id: "w-1",
    now: makeTickingClock(),
  });

  assert.equal(result.outcome, "persistence_failed");
  assert.equal(result.error.code, "dedupe_conflict");
  assert.match(result.error.message, /failed→queued persisted.*enqueue.*simulated enqueue failure/);

  // failed→queued WAS persisted before the enqueue attempt.
  const log = persistence.statuses.get(baseSubmission.job_id);
  const last = log[log.length - 1];
  assert.equal(last.from, "failed");
  assert.equal(last.to, "queued");
});

// ---------------------------------------------------------------------------
// Codex audit cross-validated blockers (B1, B3, B4) — regression coverage
// ---------------------------------------------------------------------------

test("B1: retry path does NOT persist the failed result (so attempt-2 result will not collide)", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  const sub = structuredClone(baseSubmission);
  sub.retry = { ...sub.retry, max_attempts: 3, attempt: 1 };
  await queue.enqueue(makeJob(sub, "b1-A"));

  await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: failingWorker({ isTransient: true }),
    worker_id: "w-1",
    now: makeTickingClock(),
  });

  // Persistence's result map for this job_id is empty on the retry path —
  // the would-be attempt-1 failed result was discarded so attempt-2 can
  // write the same (job_id, page_id) without conflict.
  assert.equal(persistence.calls.saveOcrResultOnce, 0);
  assert.equal(persistence.results.get(baseSubmission.job_id) ?? null, null);
});

test("B1: dead-letter path DOES persist the failed result (it is final)", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  const sub = structuredClone(baseSubmission);
  sub.retry = { ...sub.retry, max_attempts: 3, attempt: 3 }; // exhausted
  await queue.enqueue(makeJob(sub, "b1-B"));

  await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: failingWorker({ isTransient: true }),
    worker_id: "w-1",
    now: makeTickingClock(),
  });

  assert.equal(persistence.calls.saveOcrResultOnce, 1);
  const stored = persistence.results.get(baseSubmission.job_id);
  assert.equal(stored.size, 1);
});

test("B1 end-to-end: attempt-1 transient fail → retry → attempt-2 success persists without conflict", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  const sub = structuredClone(baseSubmission);
  sub.retry = { ...sub.retry, max_attempts: 3, attempt: 1 };
  await queue.enqueue(makeJob(sub, "b1-e2e"));

  const successFixture = readJson(join(fixtureDir, "result-chinese-litigation.json"));
  let invocation = 0;
  const dualWorker = {
    async process(job) {
      invocation++;
      const s = job.submission;
      const page = s.pages[0];
      if (invocation === 1) {
        return failingWorker({ isTransient: true }).process(job);
      }
      const result = structuredClone(successFixture);
      result.job_id = s.job_id;
      result.tenant_id = s.tenant_id;
      result.document_id = s.document_id;
      if (s.document_revision !== undefined) {
        result.document_revision = s.document_revision;
      }
      result.page_id = page.page_id;
      result.page_number = page.page_number;
      result.metadata = structuredClone(s.metadata);
      result.completed_at = "2030-02-01T00:00:30.000Z";
      return {
        job_id: s.job_id,
        statuses: [
          { from: "queued", to: "claimed", controlled_by: "queue", at: "2030-02-01T00:00:20.000Z" },
          { from: "claimed", to: "processing", controlled_by: "worker", at: "2030-02-01T00:00:21.000Z" },
          { from: "processing", to: "succeeded", controlled_by: "worker", at: "2030-02-01T00:00:22.000Z" },
        ],
        results: [result],
        terminal_state: "succeeded",
      };
    },
  };

  // Attempt 1 → retry
  const r1 = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: dualWorker,
    worker_id: "w-1",
    now: makeTickingClock(),
  });
  assert.equal(r1.outcome, "retried");

  // Attempt 2 → completed, the previously-discarded failed-result slot
  // is free so the success result writes cleanly.
  const r2 = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: dualWorker,
    worker_id: "w-1",
    now: makeTickingClock("2030-02-01T00:01:00.000Z"),
  });
  assert.equal(r2.outcome, "completed");
  assert.equal(persistence.results.get(baseSubmission.job_id).size, 1);
  assert.equal(persistence.jobs.get(baseSubmission.job_id).terminal_state, "succeeded");
});

test("B3: worker emits failed terminal with no failed result → outcome=requeued, no transitions persisted", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  const sub = structuredClone(baseSubmission);
  sub.retry = { ...sub.retry, max_attempts: 3, attempt: 1 };
  await queue.enqueue(makeJob(sub, "b3"));

  const successFixture = readJson(join(fixtureDir, "result-chinese-litigation.json"));
  // Worker emits a `processing→failed` terminal but the per-page result
  // carries status='succeeded' (incoherent output — should be rejected).
  const incoherentWorker = {
    async process(job) {
      const s = job.submission;
      const page = s.pages[0];
      const result = structuredClone(successFixture);
      result.job_id = s.job_id;
      result.tenant_id = s.tenant_id;
      result.document_id = s.document_id;
      if (s.document_revision !== undefined) {
        result.document_revision = s.document_revision;
      }
      result.page_id = page.page_id;
      result.page_number = page.page_number;
      result.metadata = structuredClone(s.metadata);
      result.completed_at = "2030-02-01T00:00:10.000Z";
      return {
        job_id: s.job_id,
        statuses: [
          { from: "queued", to: "claimed", controlled_by: "queue", at: "2030-02-01T00:00:00.000Z" },
          { from: "claimed", to: "processing", controlled_by: "worker", at: "2030-02-01T00:00:01.000Z" },
          { from: "processing", to: "failed", controlled_by: "worker", at: "2030-02-01T00:00:02.000Z" },
        ],
        results: [result], // status='succeeded' — incoherent with failed terminal
        terminal_state: "failed",
      };
    },
  };

  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: incoherentWorker,
    worker_id: "w-1",
    now: makeTickingClock(),
  });

  assert.equal(result.outcome, "requeued");
  assert.match(result.error.message, /no result carrying status='failed'/);
  // The coordinator's queued→claimed write is the ONLY thing persisted —
  // the worker's transition tail was rejected before any of it landed.
  assert.equal(persistence.statuses.get(baseSubmission.job_id).length, 1);
  assert.equal(persistence.results.get(baseSubmission.job_id) ?? null, null);
});

test("B4: invalid retry counter (attempt > max_attempts) → outcome=persistence_failed, not unhandled throw", async () => {
  const queue = new InMemoryOcrQueue();
  const persistence = new FakePersistence();
  persistence.seedJob(baseSubmission.job_id);
  const sub = structuredClone(baseSubmission);
  // Schema-valid (integers in range), semantically invalid (attempt > max).
  sub.retry = { ...sub.retry, max_attempts: 2, attempt: 5 };
  await queue.enqueue(makeJob(sub, "b4"));

  const result = await processOneOcrQueueClaim({
    queue,
    persistence,
    worker: failingWorker({ isTransient: true }),
    worker_id: "w-1",
    now: makeTickingClock(),
  });

  assert.equal(result.outcome, "persistence_failed");
  assert.match(result.error.message, /retry classifier rejected/);
});

