// Step 10L — cross-process e2e. Two Node processes share one SQLite
// file; the spawned worker bin drains the queue, the test asserts
// persistence terminal state. See docs/adr/ocr-cross-process-e2e-step-10l.md
// for scope and pinned decisions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ingestDocumentForOcr } from "ocr-ingestion";
import {
  openSqliteOcrPersistence,
  openSqliteOcrQueue,
} from "ocr-persistence";
import { OcrJobAdapter } from "ocr-worker-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN_PATH = resolve(
  __dirname,
  "..",
  "..",
  "ocr-worker",
  "bin",
  "ocr-worker.mjs",
);

// ---------------------------------------------------------------------------
// Spawn helper (R4)
// ---------------------------------------------------------------------------

// Minimal allowlisted env passed to the spawned bin. Excludes
// NODE_OPTIONS, NODE_PATH, and any parent-process secrets so the
// child cannot be perturbed by the test process's environment.
const CHILD_ENV_ALLOWLIST = [
  "HOME",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
];

function buildChildEnv({ path, workerId }) {
  const inherited = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) inherited[key] = v;
  }
  return {
    ...inherited,
    OCR_WORKER_PERSISTENCE: "sqlite",
    OCR_WORKER_QUEUE: "sqlite",
    OCR_WORKER_SQLITE_PATH: path,
    OCR_WORKER_MAX_ITERATIONS: "1",
    OCR_WORKER_IDLE_DELAY_MS: "0",
    OCR_WORKER_ID: workerId,
  };
}

function spawnWorkerBin({ path, workerId, timeoutMs = 15_000 }) {
  const child = spawn(process.execPath, [BIN_PATH], {
    env: buildChildEnv({ path, workerId }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c) => stdoutChunks.push(c));
  child.stderr.on("data", (c) => stderrChunks.push(c));

  let exitInfo = { code: null, signal: null };
  child.once("exit", (code, signal) => {
    exitInfo = { code, signal };
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch {
      // already dead
    }
  }, timeoutMs);
  timer.unref?.();

  const done = new Promise((resolveClose, reject) => {
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", () => {
      clearTimeout(timer);
      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");
      if (timedOut) {
        reject(
          new Error(
            `10L: bin timed out after ${timeoutMs}ms. ` +
              `stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
          ),
        );
        return;
      }
      resolveClose({
        code: exitInfo.code,
        signal: exitInfo.signal,
        stdout,
        stderr,
      });
    });
  });

  return { child, done };
}

// ---------------------------------------------------------------------------
// Stdout parsing (R10)
// ---------------------------------------------------------------------------

function parseSummary(stdout, stderr) {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) {
    throw new Error(
      `10L: bin produced no stdout. stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)} lines=${JSON.stringify(lines)}`,
    );
  }
  try {
    return JSON.parse(last);
  } catch (parseErr) {
    throw new Error(
      `10L: bin's last stdout line is not JSON. line=${JSON.stringify(last)} stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)} parseErr=${String(parseErr)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Workspace + fixtures
// ---------------------------------------------------------------------------

function freshSqliteWorkspace() {
  const dir = mkdtempSync(resolve(tmpdir(), "ocr-10l-crossproc-"));
  const path = resolve(dir, "ocr.db");
  const { persistence, db: persistenceDb } = openSqliteOcrPersistence({ path });
  const { queue, db: queueDb } = openSqliteOcrQueue({ path });
  const queueAdapter = new OcrJobAdapter({ backend: queue });
  return {
    persistence,
    persistenceDb,
    queue,
    queueDb,
    queueAdapter,
    path,
    dir,
    // Async to honour the OcrJobQueueBackend.close contract; idempotent
    // so callers may close the queue/persistence directly first and still
    // call cleanup() in finally.
    cleanup: async () => {
      try {
        await queue.close();
      } catch {
        // already closed
      }
      try {
        persistenceDb.close();
      } catch {
        // already closed
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const TENANT = "01jrk8m4q4xv2v8d4d4ymf5tnt";
const DOCUMENT = "01jrk8m4q4xv2v8d4d4ymf5doc";
const PAGE_1 = "01jrk8m4q4xv2v8d4d4ymf5p01";
const PAGE_2 = "01jrk8m4q4xv2v8d4d4ymf5p02";

const sampleSource = {
  kind: "s3",
  bucket: "ocr-ingest-prod",
  key: "tenant/01jrk/doc/01jrk/page-001.png",
  byte_size: 1843201,
  mime_type: "image/png",
};

function singlePageInput() {
  return {
    tenant_id: TENANT,
    document_id: DOCUMENT,
    document_revision: 1,
    submitted_by: "user_01jrk8m4q4xv2v8d4d4ymf5usr",
    pages: [{ page_id: PAGE_1, page_number: 1, source: { ...sampleSource } }],
    metadata: { trace_id: "10l-success" },
  };
}

// `twoPageInput` was deleted with the partial_failure cross-process test
// at the N=1-cap migration (ADR-11B §3). It was only consumed by that
// test; the `success` scenario uses `singlePageInput` above. No production
// code path references it.

function deterministicEnv() {
  let n = 0;
  return {
    generateJobId: () => {
      const id = `job${String(++n).padStart(23, "0")}`;
      return id.toLowerCase().padEnd(26, "0").slice(0, 26);
    },
    now: (() => {
      let t = 0;
      return () => new Date(Date.UTC(2030, 0, 1, 0, 0, t++));
    })(),
  };
}

// ---------------------------------------------------------------------------
// Shared case runner
// ---------------------------------------------------------------------------

/**
 * Run one cross-process e2e case end-to-end.
 *
 * @param {object} opts
 * @param {() => object} opts.input - factory returning a fresh DocumentIngestionInput
 * @param {string} [opts.scenario] - fake-worker scenario; omit for default success
 * @param {string} opts.workerId - stable worker identity for the spawned bin
 * @param {string} opts.expectedTerminalState - "succeeded" | "partial_succeeded"
 * @param {Array<{page_number: number, status: string, hasPartialFailure?: boolean}>} opts.expectedResults
 * @param {string[]} opts.expectedEdges - ordered "<controlled_by>:<from>-><to>" entries
 */
async function runCrossProcessCase(opts) {
  const ws = freshSqliteWorkspace();
  try {
    const env = deterministicEnv();
    const ingestDeps = {
      persistence: ws.persistence,
      queueAdapter: ws.queueAdapter,
      queue: ws.queue,
      generateJobId: env.generateJobId,
      now: env.now,
    };
    if (opts.scenario !== undefined) ingestDeps.scenario = opts.scenario;

    const out = await ingestDocumentForOcr(opts.input(), ingestDeps);

    // R2: pre-spawn invariants — atomic seam, fresh enqueue, exactly
    // one active queue row in the same SQLite file.
    assert.equal(out.atomic, true, "atomic ingest path must have been taken");
    assert.equal(out.enqueueResult.deduped, false, "fresh enqueue, not a dedupe");
    const queueRows = ws.persistenceDb
      .prepare(
        "SELECT COUNT(*) AS n FROM ocr_queue_jobs WHERE state != 'resolved' AND job_id = ?",
      )
      .get(out.job.job_id).n;
    assert.equal(queueRows, 1, "exactly one active queue row before spawn");

    // R8: close ingestion handles BEFORE spawning the bin. Await the
    // queue close — its interface is async even when current impl is
    // synchronous internally.
    await ws.queue.close();
    ws.persistenceDb.close();

    const { done } = spawnWorkerBin({ path: ws.path, workerId: opts.workerId });
    const result = await done;

    assert.equal(result.code, 0, `bin exit code (stderr=${result.stderr})`);
    assert.equal(result.signal, null, "bin must not be killed by a signal");

    // R1: with --max-iterations=1 and one queued job, the loop runs
    // exactly one iteration that completes the job.
    const summary = parseSummary(result.stdout, result.stderr);
    assert.equal(summary.stop_reason, "max_iterations");
    assert.equal(summary.iterations, 1);
    assert.equal(summary.outcomes.completed, 1);
    assert.equal(summary.outcomes.requeued ?? 0, 0);
    assert.equal(summary.outcomes.ack_failed ?? 0, 0);
    assert.equal(summary.outcomes.persistence_failed ?? 0, 0);
    assert.equal(summary.outcomes.lease_lost ?? 0, 0);

    // Re-open persistence to inspect final state.
    const { persistence, db } = openSqliteOcrPersistence({ path: ws.path });
    try {
      const job = await persistence.getOcrJob(out.job.job_id);
      assert.notEqual(job, null);
      assert.equal(job.terminal_state, opts.expectedTerminalState);

      const results = await persistence.listOcrResults(out.job.job_id);
      assert.equal(results.length, opts.expectedResults.length);
      const byPage = new Map(results.map((r) => [r.result.page_number, r.result]));
      for (const expected of opts.expectedResults) {
        const r = byPage.get(expected.page_number);
        assert.notEqual(
          r,
          undefined,
          `result for page ${expected.page_number} missing`,
        );
        assert.equal(r.status, expected.status);
        if (expected.hasPartialFailure) {
          assert.ok(
            r.partial_failure,
            `page ${expected.page_number} must carry partial_failure digest`,
          );
        }
      }

      const statuses = await persistence.listOcrJobStatuses(out.job.job_id);
      const edges = statuses.map((s) => `${s.controlled_by}:${s.from}->${s.to}`);
      // R5: exact ordered edges per case.
      assert.deepEqual(edges, opts.expectedEdges);
    } finally {
      db.close();
    }
  } finally {
    await ws.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test(
  "10L: success scenario — atomic ingest, spawned worker drains, persistence terminal_state=succeeded",
  { timeout: 20_000 },
  () =>
    runCrossProcessCase({
      input: singlePageInput,
      workerId: "10l-success-worker",
      expectedTerminalState: "succeeded",
      expectedResults: [{ page_number: 1, status: "succeeded" }],
      expectedEdges: [
        "queue:queued->claimed",
        "worker:claimed->processing",
        "worker:processing->succeeded",
      ],
    }),
);

// `10L: partial_failure scenario — terminal_state=partial_succeeded, mixed
// page results` was removed at the N=1-cap migration (ADR-11B §3 +
// `multi_page_unsupported` guard in createOcrSubmissionFromDocument).
//
// Reason: the case fed a 2-page input through the cross-process ingestion
// path (`twoPageInput` -> `ingestDocumentForOcr`), which now hard-rejects
// pages.length > 1. The fake-worker `partial_failure` scenario explicitly
// requires >= 2 pages to produce mixed succeeded/failed outputs, so this
// cross-process partial path is unreachable in v1.
//
// What is still covered: the cross-process *success* path is asserted by
// the case above (`10L: success scenario`), proving the runtime entrypoint
// + cross-process queue + persistence + status replay still wire end-to-end
// under the N=1 cap. The partial_succeeded coordinator edge is asserted in
// services/ocr-worker tests via `makeMultiPageSubmission(2)` which bypasses
// ingestion.
//
// If multi-page submission returns post-v1, restore this test alongside
// that reversal.
