// Adapter tests. No Redis, no BullMQ, no OCR. Everything in-process and
// deterministic. The adapter is wired against the in-memory queue and the
// fake worker — both shipped with `ocr-worker-contract` (the fake worker
// via the `/testing` subpath).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  OcrJobAdapter,
  InMemoryOcrQueue,
  OcrAdapterError,
} from "../dist/index.js";
import {
  validateOcrResult,
  validateOcrStatusTransitionSequence,
} from "ocr-worker-contract";

const here = dirname(fileURLToPath(import.meta.url));
// The contract package is installed via the `file:../../docs/contracts`
// dependency in package.json, which copies the source tree (schemas/, fixtures/,
// dist/) into node_modules at install time. We read the canonical fixture
// JSON from there. This is fine for the in-repo workspace setup; if the
// contract package is ever published to a registry, switch this to import
// the fixture path through a published API rather than reaching into
// node_modules directly.
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

// Build a submission with `n` distinct pages by cloning baseSubmission and
// rewriting page_id / page_number / source.key. The contract requires
// partial_failure scenario to operate on >= 2 pages, so this helper is used
// by the partial_failure tests below.
function makeMultiPageSubmission(n) {
  const sub = structuredClone(baseSubmission);
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

// Deterministic adapter factory: fixed clock + counter-based ids.
function makeAdapter() {
  let tick = 0;
  let id = 0;
  const now = () => new Date(Date.UTC(2030, 0, 1, 0, 0, tick++));
  const generateId = () => `job-${++id}`;
  return new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    now,
    generateId,
  });
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

test("enqueueOcrJob: rejects invalid submission with OcrAdapterError", async () => {
  const adapter = makeAdapter();
  await assert.rejects(
    () => adapter.enqueueOcrJob({ ...baseSubmission, priority: 250 }),
    (err) => err instanceof OcrAdapterError && /priority/.test(err.message),
  );
  assert.equal(await adapter.pendingCount(), 0, "rejected job must not enqueue");
});

test("enqueueOcrJob: rejects null submission", async () => {
  const adapter = makeAdapter();
  await assert.rejects(
    () => adapter.enqueueOcrJob(null),
    OcrAdapterError,
  );
});

test("enqueueOcrJob: accepts valid submission and assigns adapter id", async () => {
  const adapter = makeAdapter();
  const result = await adapter.enqueueOcrJob(baseSubmission);
  assert.equal(result.deduped, false);
  assert.equal(result.job.id, "job-1");
  assert.equal(result.job.enqueued_at, "2030-01-01T00:00:00.000Z");
  // Adapter id is distinct from the submission's job_id (different namespaces).
  assert.notEqual(result.job.id, baseSubmission.job_id);
  assert.equal(await adapter.pendingCount(), 1);
});

test("enqueueOcrJob: duplicate of an active job returns deduped: true with the canonical record", async () => {
  // Two enqueues of the same canonical submission. The second must be a
  // no-op at the backend and surface the *original* transport id, NOT a
  // freshly-minted one. This prevents callers from relying on an `id` /
  // `enqueued_at` that does not correspond to anything actually queued.
  const adapter = makeAdapter();
  const first = await adapter.enqueueOcrJob(baseSubmission);
  assert.equal(first.deduped, false);
  assert.equal(first.job.id, "job-1");
  assert.equal(await adapter.pendingCount(), 1);

  const second = await adapter.enqueueOcrJob(baseSubmission);
  assert.equal(second.deduped, true, "second enqueue must be deduped");
  assert.equal(
    second.job.id,
    first.job.id,
    "deduped result must carry the canonical queued id, not a fresh one",
  );
  assert.equal(
    second.job.enqueued_at,
    first.job.enqueued_at,
    "deduped result must carry the canonical queued enqueued_at, not a fresh one",
  );
  // Backend depth is unchanged.
  assert.equal(await adapter.pendingCount(), 1);
});

test("enqueueOcrJob: dedupe ignores transport metadata (scenario)", async () => {
  // Same canonical submission, different test-only scenario. Scenario is
  // transport metadata and is NOT part of dedupe equality; the second
  // enqueue must be a no-op and the canonical record's scenario must win.
  const adapter = makeAdapter();
  const first = await adapter.enqueueOcrJob(baseSubmission, { scenario: "success" });
  const second = await adapter.enqueueOcrJob(baseSubmission, { scenario: "permanent_failure" });
  assert.equal(second.deduped, true);
  assert.equal(second.job.scenario, "success");
  assert.equal(await adapter.pendingCount(), 1);
});

// ---------------------------------------------------------------------------
// processNextOcrJob — empty queue
// ---------------------------------------------------------------------------

test("processNextOcrJob: returns null when queue is empty", async () => {
  const adapter = makeAdapter();
  assert.equal(await adapter.processNextOcrJob(), null);
});

// ---------------------------------------------------------------------------
// scenario: success
// ---------------------------------------------------------------------------

test("scenario success: terminal_state=succeeded, contract-valid statuses + result", async () => {
  const adapter = makeAdapter();
  await adapter.enqueueOcrJob(baseSubmission, { scenario: "success" });
  const out = await adapter.processNextOcrJob();
  assert.ok(out, "expected a processed job");

  assert.equal(out.outcome.terminal_state, "succeeded");
  assert.equal(out.outcome.statuses.length, 3);
  assert.equal(out.outcome.results.length, 1);
  assert.equal(out.outcome.results[0].status, "succeeded");
  assertOutcomeFullyValid(out.outcome);

  // Queue is now drained.
  assert.equal(await adapter.pendingCount(), 0);
});

// ---------------------------------------------------------------------------
// Production-shape outcome: a worker that returns exactly the four fields
// of OcrJobOutcome (no `scenario`) must round-trip through the adapter
// unchanged. This pins what ADR-11A.5 v0.1 promises about the production
// seam, independent of the fake worker's structural-subtype convenience.
// Audit thread 019e3538 H#4.
// ---------------------------------------------------------------------------

test("production-shape outcome (no scenario field) round-trips through processOcrJob", async () => {
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: {
      async process(job) {
        // Hand-assembled OcrJobOutcome — four fields exactly, NO scenario.
        // Embeds the canonical success fixture so the result schema check
        // inside outcomeValidation accepts it.
        const result = {
          ...successFixture,
          job_id: job.submission.job_id,
          tenant_id: job.submission.tenant_id,
          document_id: job.submission.document_id,
          document_revision: job.submission.document_revision,
          page_id: job.submission.pages[0].page_id,
          page_number: job.submission.pages[0].page_number,
          metadata: { ...job.submission.metadata },
          completed_at: "2030-01-01T00:00:03.500Z",
        };
        return {
          job_id: job.submission.job_id,
          statuses: [
            { from: "queued",     to: "claimed",    controlled_by: "queue",  at: "2030-01-01T00:00:01.000Z" },
            { from: "claimed",    to: "processing", controlled_by: "worker", at: "2030-01-01T00:00:02.000Z" },
            { from: "processing", to: "succeeded",  controlled_by: "worker", at: "2030-01-01T00:00:03.000Z" },
          ],
          results: [result],
          terminal_state: "succeeded",
        };
      },
    },
  });
  const { job } = await adapter.enqueueOcrJob(baseSubmission);
  const out = await adapter.processOcrJob(job);

  // Production seam accepts the four-field shape.
  assert.equal(out.outcome.terminal_state, "succeeded");
  assert.equal(out.outcome.statuses.length, 3);
  assert.equal(out.outcome.results.length, 1);
  assert.equal(out.outcome.results[0].status, "succeeded");
  // `scenario` is absent on the production-shape outcome.
  assert.equal(
    Object.prototype.hasOwnProperty.call(out.outcome, "scenario"),
    false,
    "production-shape outcome must not carry a scenario field",
  );
  assertOutcomeFullyValid(out.outcome);
});

// ---------------------------------------------------------------------------
// scenario: partial_failure
// ---------------------------------------------------------------------------

test("scenario partial_failure: terminal_state=partial_succeeded, mixed results, page_ids match submitted", async () => {
  const adapter = makeAdapter();
  // partial_failure requires multi-page input — see fake-worker contract.
  const sub = makeMultiPageSubmission(2);
  await adapter.enqueueOcrJob(sub, { scenario: "partial_failure" });
  const out = await adapter.processNextOcrJob();
  assert.ok(out);

  assert.equal(out.outcome.terminal_state, "partial_succeeded");
  assert.equal(out.outcome.results.length, 2);
  const statuses = out.outcome.results.map((r) => r.status).sort();
  assert.deepEqual(statuses, ["failed", "succeeded"]);

  // Result page_ids must come from the submission only.
  const submittedIds = sub.pages.map((p) => p.page_id).sort();
  const resultIds = out.outcome.results.map((r) => r.page_id).sort();
  assert.deepEqual(resultIds, submittedIds);
  assertOutcomeFullyValid(out.outcome);
});

// ---------------------------------------------------------------------------
// scenario: permanent_failure
// ---------------------------------------------------------------------------

test("scenario permanent_failure: terminal_state=dead_lettered, no requeue", async () => {
  const adapter = makeAdapter();
  await adapter.enqueueOcrJob(baseSubmission, { scenario: "permanent_failure" });
  const out = await adapter.processNextOcrJob();
  assert.ok(out);

  assert.equal(out.outcome.terminal_state, "dead_lettered");
  // Permanent failure: no transition re-enters `queued` after the first claim.
  const requeues = out.outcome.statuses.filter(
    (t, i) => i > 0 && t.to === "queued",
  );
  assert.equal(requeues.length, 0, "permanent failure must not re-queue");

  assert.equal(out.outcome.results.length, 1);
  assert.equal(out.outcome.results[0].status, "failed");
  assert.equal(out.outcome.results[0].partial_failure.is_transient, false);
  assertOutcomeFullyValid(out.outcome);
});

// ---------------------------------------------------------------------------
// scenario: transient_then_success
// ---------------------------------------------------------------------------

test("scenario transient_then_success: includes one failed→queued retry edge, ends succeeded", async () => {
  const adapter = makeAdapter();
  await adapter.enqueueOcrJob(baseSubmission, { scenario: "transient_then_success" });
  const out = await adapter.processNextOcrJob();
  assert.ok(out);

  assert.equal(out.outcome.terminal_state, "succeeded");

  const retryEdges = out.outcome.statuses.filter(
    (t) => t.from === "failed" && t.to === "queued",
  );
  assert.equal(retryEdges.length, 1, "expected exactly one retry edge");

  assert.equal(out.outcome.results.length, 1);
  assert.equal(out.outcome.results[0].status, "succeeded");
  assertOutcomeFullyValid(out.outcome);
});

// ---------------------------------------------------------------------------
// FIFO ordering
// ---------------------------------------------------------------------------

test("queue is FIFO: jobs come out in enqueue order", async () => {
  const adapter = makeAdapter();
  // Two distinct logical jobs — same fixture but different submission.job_id
  // so the queue's job_id-keyed dedupe doesn't collapse them.
  const subA = { ...structuredClone(baseSubmission), job_id: "01jrk8m4q4xv2v8d4d4ymf5xn1" };
  const subB = { ...structuredClone(baseSubmission), job_id: "01jrk8m4q4xv2v8d4d4ymf5xn2" };
  const { job: a } = await adapter.enqueueOcrJob(subA, { scenario: "success" });
  const { job: b } = await adapter.enqueueOcrJob(subB, { scenario: "permanent_failure" });

  const first = await adapter.processNextOcrJob();
  const second = await adapter.processNextOcrJob();
  const third = await adapter.processNextOcrJob();

  assert.equal(first.job.id, a.id);
  assert.equal(second.job.id, b.id);
  assert.equal(first.outcome.terminal_state, "succeeded");
  assert.equal(second.outcome.terminal_state, "dead_lettered");
  assert.equal(third, null);
});

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------

test("determinism: same submission + scenario => identical outcome shape", async () => {
  const a = makeAdapter();
  const b = makeAdapter();

  await a.enqueueOcrJob(baseSubmission, { scenario: "success" });
  await b.enqueueOcrJob(baseSubmission, { scenario: "success" });

  const ra = await a.processNextOcrJob();
  const rb = await b.processNextOcrJob();

  // The fake derives its clock from submission.submitted_at, so status
  // timestamps and result.completed_at are byte-identical across runs.
  assert.deepEqual(ra.outcome.statuses, rb.outcome.statuses);
  assert.deepEqual(
    ra.outcome.results.map((r) => r.completed_at),
    rb.outcome.results.map((r) => r.completed_at),
  );
});

// ---------------------------------------------------------------------------
// adapter input validation guards worker output validation
// ---------------------------------------------------------------------------

test("processOcrJob: surfaces worker contract violations as OcrAdapterError", async () => {
  // Plug in a misbehaving worker that returns a bogus outcome. The adapter
  // must catch it via output re-validation, not silently forward it.
  const badWorker = {
    async process(job) {
      return {
        scenario: "success",
        job_id: "01jrk8m4q4xv2v8d4d4ymf5xnk",
        // succeeded → queued is not an allowed transition.
        statuses: [
          {
            from: "succeeded",
            to: "queued",
            controlled_by: "queue",
            at: "2030-01-01T00:00:00.000Z",
          },
        ],
        results: [],
        terminal_state: "queued",
      };
    },
  };
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: badWorker,
  });
  const { job } = await adapter.enqueueOcrJob(baseSubmission);
  await assert.rejects(
    () => adapter.processOcrJob(job),
    OcrAdapterError,
  );
});

// ---------------------------------------------------------------------------
// Cross-binding: outcome must be tied to the submitted job
// ---------------------------------------------------------------------------

// Helper: build a full success-shaped outcome that schema-validates, then let
// each test mutate one binding field to simulate a misbehaving worker.
function goodOutcomeForSubmission(sub) {
  return {
    scenario: "success",
    job_id: sub.job_id,
    statuses: [
      { from: "queued", to: "claimed", controlled_by: "queue", at: "2030-01-01T00:00:01.000Z" },
      { from: "claimed", to: "processing", controlled_by: "worker", at: "2030-01-01T00:00:02.000Z" },
      { from: "processing", to: "succeeded", controlled_by: "worker", at: "2030-01-01T00:00:03.000Z" },
    ],
    results: [
      // Cloned from the contract success fixture; only the fields the
      // adapter binds against are surfaced here so the test is readable.
      // The full schema-valid result body is filled by overlaying a known
      // valid result. The success path tests above already prove the
      // adapter accepts it, so it's safe to import via require/JSON read.
    ],
    terminal_state: "succeeded",
  };
}

// We need a concrete schema-valid result to feed the binding tests. Easiest
// path: read the canonical success fixture from the contract package.
const successFixture = readJson(join(fixtureDir, "result-chinese-litigation.json"));

test("processOcrJob: rejects outcome.job_id that does not match submission.job_id", async () => {
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: {
      async process(_job) {
        const out = goodOutcomeForSubmission(baseSubmission);
        out.results = [{ ...successFixture }];
        // Tamper: a different job_id (still 26 chars, schema-valid in isolation).
        out.job_id = "01zzzzzzzzzzzzzzzzzzzzzzzz";
        return out;
      },
    },
  });
  const { job } = await adapter.enqueueOcrJob(baseSubmission);
  await assert.rejects(
    () => adapter.processOcrJob(job),
    (err) =>
      err instanceof OcrAdapterError &&
      /outcome.job_id/.test(err.message) &&
      /does not match/.test(err.message),
  );
});

test("processOcrJob: rejects result.job_id that belongs to a different job", async () => {
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: {
      async process(_job) {
        const out = goodOutcomeForSubmission(baseSubmission);
        const tampered = { ...successFixture, job_id: "01zzzzzzzzzzzzzzzzzzzzzzzz" };
        out.results = [tampered];
        return out;
      },
    },
  });
  const { job } = await adapter.enqueueOcrJob(baseSubmission);
  await assert.rejects(
    () => adapter.processOcrJob(job),
    (err) => err instanceof OcrAdapterError && /result.job_id/.test(err.message),
  );
});

test("processOcrJob: rejects result.tenant_id that does not match submission", async () => {
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: {
      async process(_job) {
        const out = goodOutcomeForSubmission(baseSubmission);
        out.results = [{ ...successFixture, tenant_id: "01zzzzzzzzzzzzzzzzzzzzzzzz" }];
        return out;
      },
    },
  });
  const { job } = await adapter.enqueueOcrJob(baseSubmission);
  await assert.rejects(
    () => adapter.processOcrJob(job),
    (err) => err instanceof OcrAdapterError && /tenant_id/.test(err.message),
  );
});

test("processOcrJob: rejects result.document_id that does not match submission", async () => {
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: {
      async process(_job) {
        const out = goodOutcomeForSubmission(baseSubmission);
        out.results = [{ ...successFixture, document_id: "01zzzzzzzzzzzzzzzzzzzzzzzz" }];
        return out;
      },
    },
  });
  const { job } = await adapter.enqueueOcrJob(baseSubmission);
  await assert.rejects(
    () => adapter.processOcrJob(job),
    (err) => err instanceof OcrAdapterError && /document_id/.test(err.message),
  );
});

// ---------------------------------------------------------------------------
// No-loss-on-error: a thrown worker error must not silently drop the job
// ---------------------------------------------------------------------------

test("processNextOcrJob: re-enqueues the job when the worker throws", async () => {
  let attempts = 0;
  const flaky = {
    async process(_job) {
      attempts += 1;
      throw new Error("simulated worker crash");
    },
  };
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: flaky,
  });
  await adapter.enqueueOcrJob(baseSubmission, { scenario: "success" });
  assert.equal(await adapter.pendingCount(), 1);

  // First processing attempt: worker throws, error propagates to caller,
  // job must be re-enqueued.
  await assert.rejects(
    () => adapter.processNextOcrJob(),
    /simulated worker crash/,
  );
  assert.equal(attempts, 1);
  assert.equal(
    await adapter.pendingCount(),
    1,
    "job must remain in queue after a worker crash",
  );

  // Second poll: worker throws again, queue depth still 1 (no silent loss).
  await assert.rejects(() => adapter.processNextOcrJob());
  assert.equal(attempts, 2);
  assert.equal(await adapter.pendingCount(), 1);
});

test("processNextOcrJob: re-enqueues when the worker returns a contract violation", async () => {
  // Differs from the previous test: the worker returns *successfully* but
  // with an invalid outcome. The adapter throws via output validation; the
  // job must still be restored to the queue.
  const liarWorker = {
    async process(_job) {
      return {
        scenario: "success",
        job_id: "01zzzzzzzzzzzzzzzzzzzzzzzz", // mismatch w/ submission
        statuses: [
          { from: "queued", to: "claimed", controlled_by: "queue", at: "2030-01-01T00:00:01.000Z" },
          { from: "claimed", to: "processing", controlled_by: "worker", at: "2030-01-01T00:00:02.000Z" },
          { from: "processing", to: "succeeded", controlled_by: "worker", at: "2030-01-01T00:00:03.000Z" },
        ],
        results: [],
        terminal_state: "succeeded",
      };
    },
  };
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: liarWorker,
  });
  await adapter.enqueueOcrJob(baseSubmission);

  await assert.rejects(
    () => adapter.processNextOcrJob(),
    OcrAdapterError,
  );
  assert.equal(
    await adapter.pendingCount(),
    1,
    "job must remain in queue after a contract-binding violation",
  );
});

// ---------------------------------------------------------------------------
// Full result-to-submission binding (regression for audit High D3)
// ---------------------------------------------------------------------------

test("processOcrJob: rejects result.page_id that is not in submission.pages", async () => {
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: {
      async process(_job) {
        const out = goodOutcomeForSubmission(baseSubmission);
        // page_id not present in submission.pages.
        out.results = [{ ...successFixture, page_id: "01zzzzzzzzzzzzzzzzzzzzzzzz" }];
        return out;
      },
    },
  });
  const { job } = await adapter.enqueueOcrJob(baseSubmission);
  await assert.rejects(
    () => adapter.processOcrJob(job),
    (err) =>
      err instanceof OcrAdapterError &&
      /result\.page_id/.test(err.message) &&
      /not present/.test(err.message),
  );
});

test("processOcrJob: rejects result.page_number that does not match the submitted page", async () => {
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: {
      async process(_job) {
        const out = goodOutcomeForSubmission(baseSubmission);
        // page_id matches, page_number does not.
        out.results = [{ ...successFixture, page_number: 99 }];
        return out;
      },
    },
  });
  const { job } = await adapter.enqueueOcrJob(baseSubmission);
  await assert.rejects(
    () => adapter.processOcrJob(job),
    (err) => err instanceof OcrAdapterError && /page_number/.test(err.message),
  );
});

test("processOcrJob: rejects result.document_revision that does not match submission.document_revision", async () => {
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: {
      async process(_job) {
        const out = goodOutcomeForSubmission(baseSubmission);
        out.results = [{ ...successFixture, document_revision: 999 }];
        return out;
      },
    },
  });
  const { job } = await adapter.enqueueOcrJob(baseSubmission);
  await assert.rejects(
    () => adapter.processOcrJob(job),
    (err) => err instanceof OcrAdapterError && /document_revision/.test(err.message),
  );
});

test("processOcrJob: rejects outcome.terminal_state that disagrees with the final transition", async () => {
  const adapter = new OcrJobAdapter({
    backend: new InMemoryOcrQueue(),
    worker: {
      async process(_job) {
        const out = goodOutcomeForSubmission(baseSubmission);
        out.results = [{ ...successFixture }];
        // Status chain ends in `succeeded`, but tamper terminal_state.
        out.terminal_state = "dead_lettered";
        return out;
      },
    },
  });
  const { job } = await adapter.enqueueOcrJob(baseSubmission);
  await assert.rejects(
    () => adapter.processOcrJob(job),
    (err) =>
      err instanceof OcrAdapterError &&
      /terminal_state/.test(err.message) &&
      /does not match/.test(err.message),
  );
});

// ---------------------------------------------------------------------------
// Queue / job isolation (regression for audit High D2)
// ---------------------------------------------------------------------------

test("enqueueOcrJob: mutating the original submission after enqueue does not affect processing", async () => {
  const adapter = makeAdapter();
  const sub = structuredClone(baseSubmission);
  await adapter.enqueueOcrJob(sub, { scenario: "success" });
  // Tamper post-enqueue. Without defensive cloning, the queued job's
  // submission.priority and source.key would change, and the worker would
  // dispatch with the tampered values.
  sub.priority = 250; // schema-invalid; would turn the queued job into a poison pill
  sub.pages[0].source.key = "TAMPERED";

  const out = await adapter.processNextOcrJob();
  assert.ok(out);
  assert.equal(out.job.submission.priority, baseSubmission.priority);
  assert.equal(out.job.submission.pages[0].source.key, baseSubmission.pages[0].source.key);
  assert.equal(out.outcome.terminal_state, "succeeded");
});

test("enqueueOcrJob: mutating the returned job does not affect what is queued", async () => {
  const adapter = makeAdapter();
  const { job } = await adapter.enqueueOcrJob(baseSubmission, { scenario: "success" });
  // Tamper on the returned reference.
  job.scenario = "permanent_failure";
  job.submission.priority = 999;

  const out = await adapter.processNextOcrJob();
  assert.ok(out);
  // Queued state must reflect the original (success), not the tampered scenario.
  assert.equal(out.outcome.terminal_state, "succeeded");
  assert.equal(out.job.submission.priority, baseSubmission.priority);
});

test("InMemoryOcrQueue: mutating a returned claim's job does not affect future state", async () => {
  // Direct queue test bypassing the adapter — proves the queue itself is
  // defensive even when used outside the adapter wiring.
  const queue = new InMemoryOcrQueue();
  const job = {
    id: "raw-1",
    submission: structuredClone(baseSubmission),
    enqueued_at: "2030-01-01T00:00:00.000Z",
  };
  await queue.enqueue(job);
  // Mutate the original after enqueue.
  job.submission.priority = 999;

  const claim = await queue.claimNext("test-worker");
  assert.equal(claim.job.submission.priority, baseSubmission.priority);
  // Mutating the returned claim's job must not affect a subsequent renew.
  claim.job.submission.priority = 1234;
  const renewed = await queue.renewClaim(claim);
  assert.equal(renewed.job.submission.priority, baseSubmission.priority);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertOutcomeFullyValid(outcome) {
  const seq = validateOcrStatusTransitionSequence({
    job_id: outcome.job_id,
    transitions: outcome.statuses,
  });
  assert.equal(seq.ok, true, seq.ok ? "" : seq.summary);
  for (const r of outcome.results) {
    const v = validateOcrResult(r);
    assert.equal(v.ok, true, v.ok ? "" : v.summary);
    assert.equal(r.job_id, outcome.job_id);
  }
  // terminal_state must reflect the actual final transition.
  const lastTo = outcome.statuses[outcome.statuses.length - 1].to;
  assert.equal(outcome.terminal_state, lastTo, "terminal_state must match final transition.to");
}
