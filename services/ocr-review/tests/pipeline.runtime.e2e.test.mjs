// Step 10F — pipeline runtime integration smoke tests.
//
// Proves the NEW runtime path composes end-to-end:
//
//   createOcrSubmissionFromDocument
//   → persistence.createOcrJob(submission)
//   → OcrJobAdapter.enqueueOcrJob(submission, { scenario })
//   → InMemoryOcrQueue
//   → runOcrWorkerProcess (10E entrypoint)
//   → runtime-built OcrProcessingCoordinator (10C)
//   → runOcrWorkerLoop (10D)
//   → InMemoryOcrPersistence
//   → ocr-review read models
//
// What this test deliberately avoids:
//   - OcrJobAdapter.processNextOcrJob — the OLD synchronous path covered
//     by review.test.mjs. Using it here would silently bypass the
//     coordinator/loop/cli stack, which is the whole point of 10F.
//   - Overriding `coordinator` in `buildDeps`. That seam is for unit
//     tests; using it here would defeat the integration check.
//   - The real Node `process`. We pass a fake EventEmitter so SIGINT
//     handlers do not attach to the actual `node --test` process.
//
// In-memory only. No durable queue. No OS-process supervision proven.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  getOcrJobLifecycle,
  getReviewableOcrPage,
  summarizeOcrIngestionOutcome,
} from "../dist/index.js";

import { InMemoryOcrPersistence } from "ocr-persistence";
import {
  InMemoryOcrQueue,
  OcrJobAdapter,
  runOcrWorkerProcess,
} from "ocr-worker-adapter";
import { createOcrSubmissionFromDocument } from "ocr-ingestion";
import { processFakeOcrJob } from "ocr-worker-contract/testing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fake `process` for the runtime entrypoint: an EventEmitter (so signal
 * listeners attach here, NOT to the real node test process) plus buffered
 * stdout/stderr writers.
 */
function makeFakeProcess() {
  const proc = new EventEmitter();
  proc.stdout_buf = [];
  proc.stderr_buf = [];
  proc.stdout = { write: (s) => proc.stdout_buf.push(String(s)) };
  proc.stderr = { write: (s) => proc.stderr_buf.push(String(s)) };
  return proc;
}

function lastStdoutJson(proc) {
  const lines = proc.stdout_buf.join("").split("\n").filter(Boolean);
  assert.ok(lines.length > 0, "expected at least one stdout line (loop summary)");
  const last = lines[lines.length - 1];
  try {
    return JSON.parse(last);
  } catch (e) {
    throw new Error(
      `last stdout line was not JSON. Lines:\n${lines.join("\n---\n")}`,
    );
  }
}

/**
 * The exact same fake worker the production default uses (cli.ts
 * `defaultFakeWorker`). Replicated locally so the e2e test does not depend
 * on whether `buildDefaultDeps` is invoked — we always inject explicitly.
 */
const fakeWorker = {
  async process(job) {
    return processFakeOcrJob(job.submission, {
      scenario: job.scenario ?? "success",
    });
  },
};

function makeOnePageInput() {
  return {
    tenant_id: "01jrk8m4q4xv2v8d4d4ymf5tnt",
    case_id: "01jrk8m4q4xv2v8d4d4ymf5cas",
    document_id: "01jrk8m4q4xv2v8d4d4ymf5doc",
    document_revision: 1,
    submitted_by: "user_01jrk8m4q4xv2v8d4d4ymf5usr",
    pages: [
      {
        page_id: "01jrk8m4q4xv2v8d4d4ymf5p01",
        page_number: 1,
        source: {
          kind: "s3",
          bucket: "ocr-ingest-prod",
          key: "tenant/01jrk/doc/01jrk/page-001.png",
          byte_size: 1843201,
          mime_type: "image/png",
        },
      },
    ],
    metadata: { trace_id: "step-10f-success" },
  };
}

function makeTwoPageInput() {
  return {
    tenant_id: "01jrk8m4q4xv2v8d4d4ymf5tnt",
    document_id: "01jrk8m4q4xv2v8d4d4ymf5doc",
    submitted_by: "user_01jrk8m4q4xv2v8d4d4ymf5usr",
    pages: [
      {
        page_id: "01jrk8m4q4xv2v8d4d4ymf5p01",
        page_number: 1,
        source: {
          kind: "s3",
          bucket: "ocr-ingest-prod",
          key: "tenant/01jrk/doc/01jrk/page-001.png",
          byte_size: 1,
          mime_type: "image/png",
        },
      },
      {
        page_id: "01jrk8m4q4xv2v8d4d4ymf5p02",
        page_number: 2,
        source: {
          kind: "s3",
          bucket: "ocr-ingest-prod",
          key: "tenant/01jrk/doc/01jrk/page-002.png",
          byte_size: 1,
          mime_type: "image/png",
        },
      },
    ],
    metadata: { trace_id: "step-10f-partial" },
  };
}

// ---------------------------------------------------------------------------
// Scenario 1 — success
// ---------------------------------------------------------------------------

test("10F success: ingest -> persistence.createOcrJob -> adapter.enqueue -> runOcrWorkerProcess -> review reads succeeded job", async () => {
  const persistence = new InMemoryOcrPersistence();
  const queue = new InMemoryOcrQueue();
  const proc = makeFakeProcess();

  // 1. Build a contract-valid submission via the ingestion layer.
  const submission = createOcrSubmissionFromDocument(makeOnePageInput());

  // 2. Persist the job row BEFORE enqueue. The 10C coordinator's B-path
  //    reads persistence first; without this it would emit
  //    `persistence_failed` and requeue.
  await persistence.createOcrJob(submission);

  // 3. Enqueue through the adapter (it owns the OcrJob transport
  //    wrapping; the queue itself takes OcrJob, not submissions).
  const adapter = new OcrJobAdapter({ backend: queue });
  await adapter.enqueueOcrJob(submission, { scenario: "success" });

  // 4. Drive the runtime entrypoint with the SHARED queue + persistence
  //    so the same instances the test wrote to are the ones the loop
  //    reads from. `buildDeps` returns queue + persistence + worker; the
  //    runtime constructs the coordinator itself.
  const code = await runOcrWorkerProcess({
    argv: [],
    env: {
      OCR_WORKER_MAX_ITERATIONS: "1",
      OCR_WORKER_IDLE_DELAY_MS: "0",
    },
    process: proc,
    buildDeps: async () => ({
      queue,
      persistence,
      worker: fakeWorker,
      cleanup: undefined,
    }),
  });

  // 5. Exit-code + summary assertions (summary is on the LAST stdout line).
  assert.equal(code, 0, `expected exit 0, got ${code}; stderr=${proc.stderr_buf.join("")}`);
  const summary = lastStdoutJson(proc);
  assert.equal(summary.stop_reason, "max_iterations");
  assert.equal(summary.iterations, 1);
  assert.equal(summary.outcomes.completed, 1);

  // 6. Review reads observe the lifecycle the runtime persisted.
  const lifecycle = await getOcrJobLifecycle(persistence, submission.job_id);
  assert.ok(lifecycle, "expected lifecycle for newly-processed job");
  assert.equal(lifecycle.terminal_state, "succeeded");
  assert.equal(lifecycle.is_terminal, true);
  assert.equal(lifecycle.results.length, 1);

  const page = await getReviewableOcrPage(persistence, {
    job_id: submission.job_id,
    page_id: submission.pages[0].page_id,
  });
  assert.ok(page, "expected reviewable page after success");
  assert.equal(page.page_id, submission.pages[0].page_id);
  assert.equal(page.outcome, "succeeded");
  assert.ok(typeof page.raw_text === "string" && page.raw_text.length > 0);
  assert.ok(typeof page.text_preview === "string" && page.text_preview.length > 0);
  // The review read-model returns block digests (counts + ids), not raw
  // blocks. The success fixture (result-chinese-litigation.json) contains
  // exactly one seal block and one table block, so both digests must be
  // non-empty — a regression to zero seals/tables would be a real bug, not
  // a tolerable variation.
  assert.ok(page.detected_seals && page.detected_seals.count > 0,
    `expected detected_seals.count > 0; got ${page.detected_seals?.count}`);
  assert.ok(page.detected_tables && page.detected_tables.count > 0,
    `expected detected_tables.count > 0; got ${page.detected_tables?.count}`);

  // 7. Verify the fake process has no remaining SIGINT/SIGTERM listeners
  //    after the runtime returns — proves the runtime cleaned up its own
  //    handlers on the fake. (Real-process leakage is impossible by
  //    construction here, since the runtime only saw the fake.)
  assert.equal(proc.listenerCount("SIGINT"), 0);
  assert.equal(proc.listenerCount("SIGTERM"), 0);
});

// ---------------------------------------------------------------------------
// Scenario 2 — partial_failure (requires >= 2 pages)
// ---------------------------------------------------------------------------

test("10F partial: 2-page submission via runtime entrypoint -> partial_succeeded; review surfaces 1 succeeded + 1 failed page", async () => {
  const persistence = new InMemoryOcrPersistence();
  const queue = new InMemoryOcrQueue();
  const proc = makeFakeProcess();

  const submission = createOcrSubmissionFromDocument(makeTwoPageInput());
  await persistence.createOcrJob(submission);

  const adapter = new OcrJobAdapter({ backend: queue });
  await adapter.enqueueOcrJob(submission, { scenario: "partial_failure" });

  const code = await runOcrWorkerProcess({
    argv: [],
    env: {
      OCR_WORKER_MAX_ITERATIONS: "1",
      OCR_WORKER_IDLE_DELAY_MS: "0",
    },
    process: proc,
    buildDeps: async () => ({
      queue,
      persistence,
      worker: fakeWorker,
      cleanup: undefined,
    }),
  });
  assert.equal(code, 0, `expected exit 0, got ${code}; stderr=${proc.stderr_buf.join("")}`);

  const summary = lastStdoutJson(proc);
  assert.equal(summary.stop_reason, "max_iterations");
  assert.equal(summary.outcomes.completed, 1);

  // Repo terminal-state spelling: `partial_succeeded` (NOT
  // `partially_failed`). Pinned by ocr-status.schema.json + transitions.ts
  // + fake-worker.ts.
  const ingestionSummary = await summarizeOcrIngestionOutcome(
    persistence,
    submission.job_id,
  );
  assert.ok(ingestionSummary, "expected an ingestion summary");
  assert.equal(ingestionSummary.terminal_state, "partial_succeeded");
  assert.equal(ingestionSummary.is_terminal, true);
  assert.equal(ingestionSummary.total_pages, 2);
  assert.equal(ingestionSummary.succeeded_pages, 1);
  assert.equal(ingestionSummary.failed_pages, 1);
  assert.equal(ingestionSummary.pending_pages, 0);

  // Read each page through the review layer. Fake worker convention:
  // first page succeeds, the rest fail.
  const succeededPage = await getReviewableOcrPage(persistence, {
    job_id: submission.job_id,
    page_id: submission.pages[0].page_id,
  });
  assert.ok(succeededPage);
  assert.equal(succeededPage.outcome, "succeeded");

  const failedPage = await getReviewableOcrPage(persistence, {
    job_id: submission.job_id,
    page_id: submission.pages[1].page_id,
  });
  assert.ok(failedPage, "expected the failed page to be reviewable");
  assert.equal(failedPage.outcome, "failed");
  assert.ok(
    failedPage.partial_failure !== null && failedPage.partial_failure !== undefined,
    "expected partial_failure detail to be populated on the failed page",
  );
  assert.ok(typeof failedPage.partial_failure.code === "string");
  assert.ok(typeof failedPage.partial_failure.message === "string");
});

// ---------------------------------------------------------------------------
// Scenario 3 — empty queue
// ---------------------------------------------------------------------------

test("10F empty queue: no job persisted/enqueued -> runtime exits with outcomes.empty=1; persistence stays empty", async () => {
  const persistence = new InMemoryOcrPersistence();
  const queue = new InMemoryOcrQueue();
  const proc = makeFakeProcess();

  const code = await runOcrWorkerProcess({
    argv: [],
    env: {
      OCR_WORKER_MAX_ITERATIONS: "1",
      // Idle delay 0 keeps the test fast and deterministic — the loop
      // sleeps once on the empty claim before its iteration cap fires.
      OCR_WORKER_IDLE_DELAY_MS: "0",
    },
    process: proc,
    buildDeps: async () => ({
      queue,
      persistence,
      worker: fakeWorker,
      cleanup: undefined,
    }),
  });
  assert.equal(code, 0);

  const summary = lastStdoutJson(proc);
  assert.equal(summary.stop_reason, "max_iterations");
  assert.equal(summary.iterations, 1);
  assert.equal(summary.outcomes.empty, 1);
  assert.equal(summary.outcomes.completed, undefined);

  // Persistence stayed empty — getOcrJob on any id returns null.
  assert.equal(
    await persistence.getOcrJob("01jrk8m4q4xv2v8d4d4ymf5xxx"),
    null,
  );
});
