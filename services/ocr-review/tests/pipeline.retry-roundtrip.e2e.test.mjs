// ADR-11F/11G/observability runtime integration smoke.
//
// Proves the new retry layer composes end-to-end under the actual loop:
//
//   1. Ingest a submission (attempt=1, max_attempts=3).
//   2. Enqueue + persist.
//   3. Drive runOcrWorkerProcess with a worker that emits a transient
//      `failed` outcome on attempt=1 and a `succeeded` outcome on
//      attempt>=2.
//   4. Loop iterates: first iteration → `retried`, second → `completed`.
//      The bumped submission travels via the ADR-11G outbox / queue
//      re-enqueue (clean path A — completeClaim succeeds, so the
//      pending row is durably written and then promptly cleared).
//   5. Inspect:
//      - Final terminal_state = succeeded.
//      - Observability event stream (OCR_LOG_OUTCOMES=1) contains the
//        expected `retried` event followed by a `completed` event.
//      - The completed event references attempt=2 (verified via the
//        review lifecycle's status timeline + the persisted result's
//        attempted_count where applicable).
//      - pending_retry_submission is null after the round-trip.
//
// This is the integration counterpart to the unit-level retry-wiring
// suite. The unit suite proves each seam; this proves they compose
// under the real loop semantics.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";

import { InMemoryOcrPersistence } from "ocr-persistence";
import {
  InMemoryOcrQueue,
  OcrJobAdapter,
  runOcrWorkerProcess,
} from "ocr-worker-adapter";
import { createOcrSubmissionFromDocument } from "ocr-ingestion";
import { processFakeOcrJob } from "ocr-worker-contract/testing";

import { getOcrJobLifecycle } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(
  here,
  "..",
  "node_modules",
  "ocr-worker-contract",
  "fixtures",
  "valid",
);
const failureFixture = JSON.parse(
  readFileSync(join(fixtureDir, "result-partial-failure.json"), "utf8"),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeProcess() {
  const proc = new EventEmitter();
  proc.stdout_buf = [];
  proc.stderr_buf = [];
  proc.stdout = { write: (s) => proc.stdout_buf.push(String(s)) };
  proc.stderr = { write: (s) => proc.stderr_buf.push(String(s)) };
  return proc;
}

function stdoutLines(proc) {
  return proc.stdout_buf.join("").split("\n").filter(Boolean);
}

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
    metadata: { trace_id: "retry-e2e" },
  };
}

/**
 * Worker that emits a transient `failed` outcome on attempt=1 and a
 * `succeeded` outcome on attempt>=2. Conditions on
 * `submission.retry.attempt`, which is the contract's mechanism for
 * advancing across coordinator-driven retries (ADR-11F §5).
 */
function makeTransientThenSuccessWorker() {
  let invocations = 0;
  return {
    async process(job) {
      invocations++;
      const sub = job.submission;
      const attempt = sub.retry.attempt;
      if (attempt === 1) {
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
          code: "engine_failed",
          message: "simulated transient failure",
          is_transient: true,
          attempted_count: 1,
        };
        result.completed_at = `2030-03-01T00:00:${String(invocations).padStart(2, "0")}.000Z`;
        return {
          job_id: sub.job_id,
          statuses: [
            { from: "queued", to: "claimed", controlled_by: "queue",
              at: `2030-03-01T00:00:${String(invocations).padStart(2, "0")}.000Z` },
            { from: "claimed", to: "processing", controlled_by: "worker",
              at: `2030-03-01T00:00:${String(invocations + 1).padStart(2, "0")}.000Z` },
            { from: "processing", to: "failed", controlled_by: "worker",
              at: `2030-03-01T00:00:${String(invocations + 2).padStart(2, "0")}.000Z` },
          ],
          results: [result],
          terminal_state: "failed",
        };
      }
      // attempt >= 2: success via the contract's deterministic fake.
      return processFakeOcrJob(sub, { scenario: "success" });
    },
    get invocations() {
      return invocations;
    },
  };
}

// ---------------------------------------------------------------------------
// Integration test
// ---------------------------------------------------------------------------

test("ADR-11F/11G/observability runtime e2e: transient → retry → success, observability events stream, retry.attempt advances, pending row clears", async () => {
  const persistence = new InMemoryOcrPersistence();
  const queue = new InMemoryOcrQueue();
  const proc = makeFakeProcess();
  const worker = makeTransientThenSuccessWorker();

  // 1. Ingest + persist + enqueue. The ingestion-built submission has
  //    retry.max_attempts=3 / attempt=1 by default.
  const submission = createOcrSubmissionFromDocument(makeOnePageInput());
  assert.equal(submission.retry.attempt, 1);
  await persistence.createOcrJob(submission);
  const adapter = new OcrJobAdapter({ backend: queue });
  await adapter.enqueueOcrJob(submission);

  // 2. Drive the runtime entrypoint for ≥2 iterations with structured
  //    event logging enabled. max_iterations=5 is generous — clean path
  //    A converges in 2; the cap stops us if something loops.
  const code = await runOcrWorkerProcess({
    argv: [],
    env: {
      OCR_WORKER_MAX_ITERATIONS: "5",
      OCR_WORKER_IDLE_DELAY_MS: "0",
      OCR_LOG_OUTCOMES: "1",
    },
    process: proc,
    buildDeps: async () => ({
      queue,
      persistence,
      worker,
      cleanup: undefined,
    }),
  });

  // 3. Exit code + summary.
  assert.equal(
    code,
    0,
    `expected exit 0, got ${code}; stderr=${proc.stderr_buf.join("")}`,
  );

  // 4. Parse the streamed observability events. With --log-outcomes /
  //    OCR_LOG_OUTCOMES=1, stdout is the homogeneous per-iteration event
  //    stream and the OcrWorkerLoopSummary goes to stderr (audit L1 —
  //    keeps the stdout schema stable for downstream consumers).
  const events = stdoutLines(proc).map((l) => JSON.parse(l));
  assert.ok(events.length >= 2, `expected at least 2 event lines on stdout, got ${events.length}`);
  // Summary lives on stderr in log-outcomes mode. The stderr buffer may
  // also contain unrelated log lines (e.g. config echo); the summary is
  // the unique line that parses as JSON with a `stop_reason` field.
  const stderrJsonLines = proc.stderr_buf
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((v) => v !== null && typeof v === "object" && "stop_reason" in v);
  assert.equal(stderrJsonLines.length, 1, "expected exactly one summary line on stderr");
  const summary = stderrJsonLines[0];

  // 5. The retry sequence: at least one `retried` event, exactly one
  //    `completed` event, in that order. The loop may emit additional
  //    `empty` events depending on iteration timing — those are fine.
  const retriedIdx = events.findIndex((e) => e.type === "retried");
  const completedIdx = events.findIndex((e) => e.type === "completed");
  assert.ok(retriedIdx >= 0, `expected a 'retried' event; got: ${JSON.stringify(events.map((e) => e.type))}`);
  assert.ok(completedIdx >= 0, `expected a 'completed' event; got: ${JSON.stringify(events.map((e) => e.type))}`);
  assert.ok(retriedIdx < completedIdx, "retried must precede completed in the event stream");

  // Both events reference the same job_id.
  assert.equal(events[retriedIdx].job_id, submission.job_id);
  assert.equal(events[completedIdx].job_id, submission.job_id);

  // 6. Worker observed BOTH attempts; the second invocation saw the
  //    bumped retry.attempt=2 (proves the bumped submission rode either
  //    the queue (clean path) or the pending-retry outbox (B2 path)
  //    through to attempt 2).
  assert.equal(worker.invocations, 2);

  // 7. Summary histogram pins retried + completed counts.
  assert.equal(summary.outcomes.retried, 1, `summary.outcomes=${JSON.stringify(summary.outcomes)}`);
  assert.equal(summary.outcomes.completed, 1);

  // 8. Final persistence state. The job is terminal=succeeded; the
  //    pending_retry_submission outbox row is cleared.
  const lifecycle = await getOcrJobLifecycle(persistence, submission.job_id);
  assert.ok(lifecycle);
  assert.equal(lifecycle.terminal_state, "succeeded");
  assert.equal(lifecycle.is_terminal, true);

  const jobRecord = await persistence.getOcrJob(submission.job_id);
  assert.equal(
    jobRecord.pending_retry_submission,
    undefined,
    "ADR-11G: pending row must be cleared after successful retry+complete",
  );

  // 9. Status timeline reflects both attempts: the worker emitted
  //    processing→failed once, then the queue-controlled failed→queued
  //    bridged to the second attempt's claimed→processing→succeeded.
  //    There is no separate per-attempt counter on persistence (the
  //    contract records the chain, not the attempt). The chain proves
  //    the round-trip happened.
  const statuses = await persistence.listOcrJobStatuses(submission.job_id);
  const tos = statuses.map((s) => s.to);
  // We expect: claimed (turn1) → processing → failed → queued (retry)
  //          → claimed (turn2) → processing → succeeded.
  assert.deepEqual(tos, [
    "claimed",
    "processing",
    "failed",
    "queued",
    "claimed",
    "processing",
    "succeeded",
  ]);

  // 10. No leaked signal handlers on the fake process.
  assert.equal(proc.listenerCount("SIGINT"), 0);
  assert.equal(proc.listenerCount("SIGTERM"), 0);
});
