// Step 10L — cross-process e2e.
//
// Two real Node processes share one SQLite file:
//   1. the test (this process) opens persistence + queue, calls
//      `ingestDocumentForOcr` on the 10K atomic seam,
//   2. the bin (`services/ocr-worker/bin/ocr-worker.mjs`) is spawned
//      as a child process with `--queue=sqlite --persistence=sqlite
//      --max-iterations=1`. It runs the 10C coordinator once, drains
//      the single job, persists status + result, and exits.
//
// 10L is observation-only. No production wiring change. The bin
// already exists (10G), the queue selector already exists (10J), the
// atomic ingest already exists (10K). 10L only proves they compose
// across the process boundary.
//
// Pinned decisions (R1–R12 from the plan-review thread, see
// `dev-memo/step-10l-plan.md`):
//   - `--max-iterations=1`, `--idle-delay-ms=0`. With one queued job
//     this gives `stop_reason="max_iterations"`, `iterations=1`,
//     `outcomes.completed=1`. (`stop_reason="stopped"` would require
//     a signal — wrong for this case.)
//   - Pre-spawn assertions: `out.atomic`, `!deduped`, exactly 1
//     active queue row in the same SQLite file.
//   - `process.execPath` (matches 10G's spawn pattern).
//   - Spawn helper resolves on `"close"` (stdio drained), rejects on
//     `"error"`, with per-child timeout that SIGKILLs and re-throws
//     with diagnostics.
//   - Close order: `queue.close()` → `persistenceDb.close()` → spawn.
//   - Last non-empty stdout line is parsed as JSON; on parse failure
//     the assertion includes both stdout and stderr.

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

function spawnWorkerBin({ path, workerId, timeoutMs = 15_000 }) {
  const child = spawn(process.execPath, [BIN_PATH], {
    env: {
      ...process.env,
      OCR_WORKER_PERSISTENCE: "sqlite",
      OCR_WORKER_QUEUE: "sqlite",
      OCR_WORKER_SQLITE_PATH: path,
      OCR_WORKER_MAX_ITERATIONS: "1",
      OCR_WORKER_IDLE_DELAY_MS: "0",
      OCR_WORKER_ID: workerId,
    },
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
      `10L: bin produced no stdout. stderr=${JSON.stringify(stderr)} lines=${JSON.stringify(lines)}`,
    );
  }
  try {
    return JSON.parse(last);
  } catch (parseErr) {
    throw new Error(
      `10L: bin's last stdout line is not JSON. line=${JSON.stringify(last)} stderr=${JSON.stringify(stderr)} parseErr=${String(parseErr)}`,
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
    cleanup: () => {
      try {
        queue.close();
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

function twoPageInput() {
  return {
    tenant_id: TENANT,
    document_id: DOCUMENT,
    document_revision: 1,
    submitted_by: "user_01jrk8m4q4xv2v8d4d4ymf5usr",
    pages: [
      { page_id: PAGE_1, page_number: 1, source: { ...sampleSource } },
      {
        page_id: PAGE_2,
        page_number: 2,
        source: { ...sampleSource, key: "tenant/01jrk/doc/01jrk/page-002.png" },
      },
    ],
    metadata: { trace_id: "10l-partial" },
  };
}

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
// Tests
// ---------------------------------------------------------------------------

test(
  "10L: success scenario — atomic ingest, spawned worker drains, persistence terminal_state=succeeded",
  { timeout: 20_000 },
  async () => {
    const ws = freshSqliteWorkspace();
    try {
      const env = deterministicEnv();
      const out = await ingestDocumentForOcr(singlePageInput(), {
        persistence: ws.persistence,
        queueAdapter: ws.queueAdapter,
        queue: ws.queue,
        generateJobId: env.generateJobId,
        now: env.now,
      });

      // R2: pre-spawn assertions.
      assert.equal(out.atomic, true, "atomic ingest path must have been taken");
      assert.equal(
        out.enqueueResult.deduped,
        false,
        "fresh enqueue, not a dedupe",
      );
      const queueRows = ws.persistenceDb
        .prepare(
          "SELECT COUNT(*) AS n FROM ocr_queue_jobs WHERE state != 'resolved' AND job_id = ?",
        )
        .get(out.job.job_id).n;
      assert.equal(queueRows, 1, "exactly one active queue row before spawn");

      // R8: close ingestion handles BEFORE spawning the bin.
      ws.queue.close();
      ws.persistenceDb.close();

      const { done } = spawnWorkerBin({
        path: ws.path,
        workerId: "10l-success-worker",
      });
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
        assert.equal(job.terminal_state, "succeeded");

        const results = await persistence.listOcrResults(out.job.job_id);
        assert.equal(results.length, 1);
        assert.equal(results[0].result.status, "succeeded");

        const statuses = await persistence.listOcrJobStatuses(out.job.job_id);
        const edges = statuses.map(
          (s) => `${s.controlled_by}:${s.from}->${s.to}`,
        );
        // R5: exact ordered edges for the success case.
        assert.deepEqual(edges, [
          "queue:queued->claimed",
          "worker:claimed->processing",
          "worker:processing->succeeded",
        ]);
      } finally {
        db.close();
      }
    } finally {
      ws.cleanup();
    }
  },
);

test(
  "10L: partial_failure scenario — terminal_state=partial_succeeded, mixed page results",
  { timeout: 20_000 },
  async () => {
    const ws = freshSqliteWorkspace();
    try {
      const env = deterministicEnv();
      // R6: scenario must be passed via ingest opts; without it the
      // fake worker default-runs as success.
      const out = await ingestDocumentForOcr(twoPageInput(), {
        persistence: ws.persistence,
        queueAdapter: ws.queueAdapter,
        queue: ws.queue,
        scenario: "partial_failure",
        generateJobId: env.generateJobId,
        now: env.now,
      });

      assert.equal(out.atomic, true);
      assert.equal(out.enqueueResult.deduped, false);
      const queueRows = ws.persistenceDb
        .prepare(
          "SELECT COUNT(*) AS n FROM ocr_queue_jobs WHERE state != 'resolved' AND job_id = ?",
        )
        .get(out.job.job_id).n;
      assert.equal(queueRows, 1);

      ws.queue.close();
      ws.persistenceDb.close();

      const { done } = spawnWorkerBin({
        path: ws.path,
        workerId: "10l-partial-worker",
      });
      const result = await done;

      assert.equal(result.code, 0, `bin exit code (stderr=${result.stderr})`);
      assert.equal(result.signal, null);

      const summary = parseSummary(result.stdout, result.stderr);
      assert.equal(summary.stop_reason, "max_iterations");
      assert.equal(summary.iterations, 1);
      assert.equal(summary.outcomes.completed, 1);
      assert.equal(summary.outcomes.requeued ?? 0, 0);
      assert.equal(summary.outcomes.ack_failed ?? 0, 0);
      assert.equal(summary.outcomes.persistence_failed ?? 0, 0);
      assert.equal(summary.outcomes.lease_lost ?? 0, 0);

      const { persistence, db } = openSqliteOcrPersistence({ path: ws.path });
      try {
        const job = await persistence.getOcrJob(out.job.job_id);
        assert.notEqual(job, null);
        // R5: partial_failure terminal state is `partial_succeeded`.
        assert.equal(job.terminal_state, "partial_succeeded");

        const results = await persistence.listOcrResults(out.job.job_id);
        assert.equal(results.length, 2);
        const byPage = new Map(
          results.map((r) => [r.result.page_number, r.result]),
        );
        assert.equal(byPage.get(1).status, "succeeded");
        assert.equal(byPage.get(2).status, "failed");
        assert.ok(
          byPage.get(2).partial_failure,
          "failed page must carry partial_failure digest",
        );

        const statuses = await persistence.listOcrJobStatuses(out.job.job_id);
        const edges = statuses.map(
          (s) => `${s.controlled_by}:${s.from}->${s.to}`,
        );
        assert.deepEqual(edges, [
          "queue:queued->claimed",
          "worker:claimed->processing",
          "worker:processing->partial_succeeded",
        ]);
      } finally {
        db.close();
      }
    } finally {
      ws.cleanup();
    }
  },
);
