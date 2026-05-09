// Step 10K — atomic ingest seam tests for SqliteOcrPersistence.enqueueNewOcrJob.
//
// Asserts:
//  - Both ocr_jobs and ocr_queue_jobs rows are visible after a single call.
//  - dedupe_conflict on the queue side rolls back the persistence insert.
//  - duplicate job_id on persistence side rolls back without a queue row.
//  - retried submission with same job_id yields deduped enqueueResult,
//    persistence row stays as the original.
//  - in-memory persistence does NOT advertise enqueueNewOcrJob (capability
//    probe regression guard).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import {
  InMemoryOcrPersistence,
  openSqliteOcrPersistence,
  openSqliteOcrQueue,
  isAtomicEligiblePath,
} from "../dist/index.js";
import { InMemoryOcrQueue } from "ocr-worker-adapter";
import { OcrQueueError } from "ocr-worker-contract";

function freshSqlitePersistence() {
  const dir = mkdtempSync(join(tmpdir(), "ocr-persistence-10k-"));
  const path = join(dir, "ocr.db");
  const { persistence, db } = openSqliteOcrPersistence({ path });
  // Same-file queue connection used as the atomic-seam compatibility
  // probe (dbFilePath identity) and as the dual-connection claimNext
  // target in the cross-connection test.
  const { queue, db: queueDb } = openSqliteOcrQueue({ path });
  return {
    persistence,
    db,
    queue,
    queueDb,
    path,
    cleanup: () => {
      try {
        queue.close();
      } catch {
        // already closed
      }
      try {
        db.close();
      } catch {
        // already closed
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function baseSubmission(jobIdSuffix = "10kjob000000000000000000000") {
  return {
    schema_version: "1.0.0",
    contract_version: "1.0.0",
    job_id: jobIdSuffix.padEnd(26, "0").slice(0, 26).toLowerCase(),
    tenant_id: "01jrk8m4q4xv2v8d4d4ymf5tnt",
    document_id: "01jrk8m4q4xv2v8d4d4ymf5doc",
    document_revision: 1,
    submitted_at: "2030-01-01T00:00:00.000Z",
    submitted_by: "user_01jrk8m4q4xv2v8d4d4ymf5usr",
    pages: [
      {
        page_id: "01jrk8m4q4xv2v8d4d4ymf5p01",
        page_number: 1,
        source: {
          kind: "s3",
          bucket: "ocr-ingest-prod",
          key: "tenant/01jrk/doc/01jrk/page-001.png",
          byte_size: 100,
          mime_type: "image/png",
        },
      },
    ],
    priority: 50,
    retry: { max_attempts: 3, attempt: 1, backoff: "exponential", base_delay_ms: 500, max_delay_ms: 30000 },
    rerun: { is_rerun: false },
    preprocessing: {
      deskew: "auto",
      denoise: "auto",
      binarize: false,
      remove_seal_bleed: true,
      upscale_low_dpi: true,
      target_dpi_floor: 200,
      crop_borders: "auto",
    },
    ocr_options: { languages: ["zh-Hans", "en"] },
    metadata: { trace_id: "10k-test" },
  };
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

// ----------------------------------------------------------------------
// Capability probe
// ----------------------------------------------------------------------

test("InMemoryOcrPersistence does NOT define enqueueNewOcrJob (fallback path advertised)", () => {
  const p = new InMemoryOcrPersistence();
  assert.equal(typeof p.enqueueNewOcrJob, "undefined");
});

test("SqliteOcrPersistence defines enqueueNewOcrJob (atomic path advertised)", () => {
  const { persistence, cleanup } = freshSqlitePersistence();
  try {
    assert.equal(typeof persistence.enqueueNewOcrJob, "function");
  } finally {
    cleanup();
  }
});

// ----------------------------------------------------------------------
// Atomic happy path
// ----------------------------------------------------------------------

test("enqueueNewOcrJob: both rows visible after a single call (one transaction)", async () => {
  const { persistence, db, queue, cleanup } = freshSqlitePersistence();
  try {
    const sub = baseSubmission("10ksuccess000000000000000000");
    const { job, enqueueResult } = await persistence.enqueueNewOcrJob(sub, queue);
    assert.equal(job.job_id, sub.job_id);
    assert.equal(enqueueResult.deduped, false);

    assert.equal(countRows(db, "ocr_jobs"), 1);
    assert.equal(countRows(db, "ocr_queue_jobs"), 1);
    const jobRow = db
      .prepare("SELECT job_id, terminal_state FROM ocr_jobs WHERE job_id = ?")
      .get(sub.job_id);
    assert.equal(jobRow.job_id, sub.job_id);
    assert.equal(jobRow.terminal_state, null);
    const queueRow = db
      .prepare("SELECT job_id, state FROM ocr_queue_jobs WHERE job_id = ?")
      .get(sub.job_id);
    assert.equal(queueRow.job_id, sub.job_id);
    assert.equal(queueRow.state, "waiting");
  } finally {
    cleanup();
  }
});

test("enqueueNewOcrJob: scenario carries through to the queue candidate's job_json", async () => {
  const { persistence, db, queue, cleanup } = freshSqlitePersistence();
  try {
    const sub = baseSubmission("10kscen0000000000000000000000");
    await persistence.enqueueNewOcrJob(sub, queue, { scenario: "partial_failure" });
    const queueRow = db
      .prepare("SELECT job_json FROM ocr_queue_jobs WHERE job_id = ?")
      .get(sub.job_id);
    const job = JSON.parse(queueRow.job_json);
    assert.equal(job.scenario, "partial_failure");
  } finally {
    cleanup();
  }
});

// ----------------------------------------------------------------------
// Rollback semantics — persistence-side conflict
// ----------------------------------------------------------------------

test("enqueueNewOcrJob: duplicate job_id (persistence) rolls back; no queue row appears", async () => {
  const { persistence, db, queue, cleanup } = freshSqlitePersistence();
  try {
    const sub = baseSubmission("10kdup0000000000000000000000");
    await persistence.enqueueNewOcrJob(sub, queue);
    assert.equal(countRows(db, "ocr_queue_jobs"), 1);

    // Second call with identical submission triggers the persistence-side
    // existence check. The whole atomic insert must roll back — the queue
    // row count must NOT grow.
    await assert.rejects(
      () => persistence.enqueueNewOcrJob(sub, queue),
      (err) => /already exists/.test(err.message),
    );
    assert.equal(countRows(db, "ocr_jobs"), 1);
    assert.equal(countRows(db, "ocr_queue_jobs"), 1);
  } finally {
    cleanup();
  }
});

// ----------------------------------------------------------------------
// Rollback semantics — queue-side dedupe_conflict
// ----------------------------------------------------------------------

test("enqueueNewOcrJob: queue-side dedupe_conflict rolls back the persistence insert", async () => {
  const { persistence, db, queue, cleanup } = freshSqlitePersistence();
  try {
    const subA = baseSubmission("10kconflict00000000000000000");
    await persistence.enqueueNewOcrJob(subA, queue);
    assert.equal(countRows(db, "ocr_jobs"), 1);
    assert.equal(countRows(db, "ocr_queue_jobs"), 1);

    // Manually delete the persistence row so that the next call's
    // existence check passes — but leave the queue row intact. The queue
    // INSERT will then trip dedupe_conflict (active row, differing
    // canonical submission). Atomicity must roll back the new ocr_jobs
    // insert that the call started, leaving total counts unchanged.
    db.prepare("DELETE FROM ocr_jobs WHERE job_id = ?").run(subA.job_id);
    assert.equal(countRows(db, "ocr_jobs"), 0);
    assert.equal(countRows(db, "ocr_queue_jobs"), 1);

    // Build a submission with the SAME job_id but a DIFFERENT canonical
    // payload, so the queue's active-row check sees a mismatch.
    const subB = baseSubmission("10kconflict00000000000000000");
    subB.priority = 60; // changes canonical JSON

    await assert.rejects(
      () => persistence.enqueueNewOcrJob(subB, queue),
      // 10K: typed OcrQueueError must propagate through wrapErrors so
      // callers can dispatch on `.code` instead of regex on a wrapped
      // "internal db error: …" string.
      (err) => err instanceof OcrQueueError && err.code === "dedupe_conflict",
    );
    // Atomic rollback: ocr_jobs must NOT have re-grown.
    assert.equal(countRows(db, "ocr_jobs"), 0);
    assert.equal(countRows(db, "ocr_queue_jobs"), 1);
  } finally {
    cleanup();
  }
});

// ----------------------------------------------------------------------
// Idempotent retry — same canonical submission
// ----------------------------------------------------------------------

test("enqueueNewOcrJob: same job_id with equal canonical submission after persistence row removed produces deduped queue result", async () => {
  const { persistence, db, queue, cleanup } = freshSqlitePersistence();
  try {
    const sub = baseSubmission("10kdedupe000000000000000000");
    await persistence.enqueueNewOcrJob(sub, queue);
    // Drop persistence row (simulates only the persistence write being
    // lost between attempts; queue row survives). A retry with equal
    // canonical submission should NOT throw on the queue side — dedupe
    // path returns the existing canonical queued record.
    db.prepare("DELETE FROM ocr_jobs WHERE job_id = ?").run(sub.job_id);
    const { enqueueResult } = await persistence.enqueueNewOcrJob(sub, queue);
    assert.equal(enqueueResult.deduped, true);
    // Single queue row throughout (idempotent; canonical record returned).
    assert.equal(countRows(db, "ocr_queue_jobs"), 1);
    // Persistence row was re-inserted on the retry.
    assert.equal(countRows(db, "ocr_jobs"), 1);
  } finally {
    cleanup();
  }
});

// ----------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------

test("enqueueNewOcrJob: invalid submission throws and writes nothing", async () => {
  const { persistence, db, queue, cleanup } = freshSqlitePersistence();
  try {
    await assert.rejects(
      () => persistence.enqueueNewOcrJob({ not: "a submission" }, queue),
      (err) => /invalid submission/.test(err.message),
    );
    assert.equal(countRows(db, "ocr_jobs"), 0);
    assert.equal(countRows(db, "ocr_queue_jobs"), 0);
  } finally {
    cleanup();
  }
});

// ----------------------------------------------------------------------
// Same-store check (10K Dim-3 High audit fix)
// ----------------------------------------------------------------------

test("enqueueNewOcrJob: rejects an InMemoryOcrQueue (different store) without writing anything", async () => {
  const { persistence, db, cleanup } = freshSqlitePersistence();
  try {
    const sub = baseSubmission("10kmismatch0000000000000000");
    const memQueue = new InMemoryOcrQueue();
    await assert.rejects(
      () => persistence.enqueueNewOcrJob(sub, memQueue),
      (err) => /on the same on-disk SQLite file/.test(err.message),
    );
    assert.equal(countRows(db, "ocr_jobs"), 0);
    assert.equal(countRows(db, "ocr_queue_jobs"), 0);
  } finally {
    cleanup();
  }
});

test("isAtomicEligiblePath: rejects :memory:, empty, file::memory:, and named URI memory variants", () => {
  assert.equal(isAtomicEligiblePath(":memory:"), false);
  assert.equal(isAtomicEligiblePath(""), false);
  assert.equal(isAtomicEligiblePath("file::memory:?cache=shared"), false);
  // Named URI memory — `file:NAME?mode=memory[&...]`. Earlier gate
  // missed this; round-3 explicitly rejects it.
  assert.equal(
    isAtomicEligiblePath("file:memdb1?mode=memory&cache=shared"),
    false,
  );
  assert.equal(isAtomicEligiblePath("file:foo?mode=memory"), false);
  // On-disk URI that names a real file is fine.
  assert.equal(isAtomicEligiblePath("file:/tmp/real.db"), true);
  assert.equal(isAtomicEligiblePath("/tmp/some-file.db"), true);
});

test("enqueueNewOcrJob: rejects two `:memory:` handles even though their dbFilePath strings match", async () => {
  // Two independent `:memory:` databases both report `:memory:` as
  // their path. Without a path-eligibility gate, the duck-typed
  // identity check would silently match them.
  const { persistence, db } = openSqliteOcrPersistence({ path: ":memory:" });
  const { queue, db: qDb } = openSqliteOcrQueue({ path: ":memory:" });
  try {
    const sub = baseSubmission("10kmemory00000000000000000");
    await assert.rejects(
      () => persistence.enqueueNewOcrJob(sub, queue),
      (err) => /on the same on-disk SQLite file/.test(err.message),
    );
    // Nothing written to either store.
    const jobs = db
      .prepare("SELECT COUNT(*) AS n FROM ocr_jobs")
      .get().n;
    const queueRows = qDb
      .prepare("SELECT COUNT(*) AS n FROM ocr_queue_jobs")
      .get().n;
    assert.equal(jobs, 0);
    assert.equal(queueRows, 0);
  } finally {
    try {
      queue.close();
    } catch {
      // already closed
    }
    try {
      db.close();
    } catch {
      // already closed
    }
  }
});

test("enqueueNewOcrJob: rejects a SqliteOcrQueue on a different file path", async () => {
  const { persistence, db, cleanup } = freshSqlitePersistence();
  // A second SQLite queue on a separate temp file path. Same backend
  // class, different store. dbFilePath must differ → mismatch.
  const otherDir = mkdtempSync(join(tmpdir(), "ocr-persistence-10k-other-"));
  const otherPath = join(otherDir, "other.db");
  const { queue: otherQueue, db: otherDb } = openSqliteOcrQueue({
    path: otherPath,
  });
  try {
    const sub = baseSubmission("10kotherfile0000000000000000");
    await assert.rejects(
      () => persistence.enqueueNewOcrJob(sub, otherQueue),
      (err) => /on the same on-disk SQLite file/.test(err.message),
    );
    assert.equal(countRows(db, "ocr_jobs"), 0);
    assert.equal(countRows(db, "ocr_queue_jobs"), 0);
  } finally {
    try {
      otherQueue.close();
    } catch {
      // already closed
    }
    try {
      otherDb.close();
    } catch {
      // already closed
    }
    rmSync(otherDir, { recursive: true, force: true });
    cleanup();
  }
});

// ----------------------------------------------------------------------
// Cross-connection visibility (10K Dim-7 High audit fix)
// ----------------------------------------------------------------------

test("enqueueNewOcrJob: a separate SqliteOcrQueue connection on the same file can claim the inserted row", async () => {
  // Atomic insert via persistence connection. Then a SECOND, freshly
  // opened SqliteOcrQueue against the same file (i.e. the connection a
  // production runtime worker would hold) must be able to claim it via
  // the public `claimNext` path. Pre-fix, the happy-path test only
  // verified the row count through the persistence's own handle and
  // never proved cross-connection visibility.
  const { persistence, queue: persistenceQueue, path, cleanup } =
    freshSqlitePersistence();
  try {
    const sub = baseSubmission("10kxconn0000000000000000000");
    const { enqueueResult } = await persistence.enqueueNewOcrJob(
      sub,
      persistenceQueue,
    );
    assert.equal(enqueueResult.deduped, false);

    // Open a brand-new queue connection on the same file, mimicking the
    // worker process spawning after ingestion has run.
    const { queue: workerQueue, db: workerDb } = openSqliteOcrQueue({ path });
    try {
      const claim = await workerQueue.claimNext("worker-cross-conn");
      assert.notEqual(claim, null, "second connection failed to claim");
      assert.equal(claim.job_id, sub.job_id);
      assert.equal(claim.job.submission.job_id, sub.job_id);

      await workerQueue.completeClaim(claim);

      // The completion must be visible cross-connection. A THIRD
      // queue connection on the same file:
      //   (a) finds the row in `state = 'resolved'`,
      //   (b) returns null on `claimNext` (no live work left),
      //   (c) rejects the now-resolved receipt as `unknown_receipt`
      //       on a redelivered completeClaim attempt.
      const { queue: probeQueue, db: probeDb } = openSqliteOcrQueue({ path });
      try {
        const stateRow = probeDb
          .prepare("SELECT state FROM ocr_queue_jobs WHERE job_id = ?")
          .get(sub.job_id);
        assert.equal(stateRow?.state, "resolved");

        const followClaim = await probeQueue.claimNext("worker-probe");
        assert.equal(
          followClaim,
          null,
          "expected empty queue after cross-connection completeClaim",
        );

        await assert.rejects(
          () => probeQueue.completeClaim(claim),
          // 10I receipt classification: a receipt that has been
          // resolved (completed) is reported as `unknown_receipt`
          // when re-presented. `stale_receipt` is reserved for "row
          // exists with a DIFFERENT receipt", which is not the case
          // for a completed-then-replayed receipt. Pin the exact code.
          (err) =>
            err instanceof OcrQueueError && err.code === "unknown_receipt",
        );
      } finally {
        try {
          probeQueue.close();
        } catch {
          // already closed
        }
        try {
          probeDb.close();
        } catch {
          // already closed
        }
      }
    } finally {
      try {
        workerQueue.close();
      } catch {
        // already closed
      }
      try {
        workerDb.close();
      } catch {
        // already closed
      }
    }
  } finally {
    cleanup();
  }
});

// ----------------------------------------------------------------------
// Idempotency — two sequential atomic enqueues from two connections
// ----------------------------------------------------------------------

test("enqueueNewOcrJob: two same-process calls with the same submission collapse to one ocr_jobs + one queue row", async () => {
  // better-sqlite3 transactions are SYNCHRONOUS native calls, so
  // `Promise.allSettled` over two `enqueueNewOcrJob` calls in the
  // same Node thread does NOT run them in parallel — the second
  // call observes the first's committed state. This still pins the
  // intended "two-connections, same-store, same-submission ⇒ one
  // job row + one active queue row" invariant. True cross-thread
  // contention (real BEGIN IMMEDIATE serialisation) is exercised by
  // the worker_threads test below, and cross-process contention is
  // 10L's domain.
  const { persistence: pA, db: dbA, queue: qA, path, cleanup } =
    freshSqlitePersistence();
  // Second persistence handle on the same file — distinct connection,
  // shared store. Mirrors a future multi-process or multi-tab ingest.
  const { persistence: pB, db: dbB } = openSqliteOcrPersistence({ path });
  try {
    const sub = baseSubmission("10kparallel0000000000000000");

    const [resA, resB] = await Promise.allSettled([
      pA.enqueueNewOcrJob(sub, qA),
      pB.enqueueNewOcrJob(sub, qA),
    ]);

    // Exactly one of the two calls succeeds outright; the other
    // either succeeds (queue dedupe path) or rejects with
    // "job already exists". Net rows in either ordering: one.
    const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
    const rejected = [resA, resB].filter((r) => r.status === "rejected");
    assert.ok(
      fulfilled.length >= 1,
      "at least one enqueue must have committed",
    );
    if (rejected.length > 0) {
      // Rejection is the persistence-side existence check OR the
      // queue-side dedupe_conflict (it can't be — equal canonical
      // payload — so only the existence check should appear here).
      for (const r of rejected) {
        assert.match(
          r.reason?.message ?? String(r.reason),
          /already exists|dedupe/,
        );
      }
    }

    // Final state: 1 ocr_jobs row, 1 active queue row (state != resolved).
    const jobRows = dbA
      .prepare("SELECT COUNT(*) AS n FROM ocr_jobs WHERE job_id = ?")
      .get(sub.job_id).n;
    assert.equal(jobRows, 1);
    const activeQueueRows = dbA
      .prepare(
        "SELECT COUNT(*) AS n FROM ocr_queue_jobs WHERE job_id = ? AND state != 'resolved'",
      )
      .get(sub.job_id).n;
    assert.equal(activeQueueRows, 1);
  } finally {
    try {
      dbB.close();
    } catch {
      // already closed
    }
    cleanup();
  }
});

// ----------------------------------------------------------------------
// Concurrency — TRUE cross-thread contention (worker_threads)
// ----------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKER_PATH = join(__dirname, "fixtures/atomicEnqueueWorker.mjs");

/**
 * Spawn a worker that awaits a `go` start barrier before calling
 * `enqueueNewOcrJob`. Returns a handle exposing:
 *   - `ready`: a Promise that resolves once the worker has opened its
 *     handles and is ready to race;
 *   - `result`: a Promise that resolves with the worker's result
 *     payload AFTER the worker has closed its DB handles AND exited;
 *   - `start()`: send the `go` message to the worker;
 *   - `terminate()`: forcefully kill the worker (timeout escape hatch).
 */
function spawnEnqueueWorker(path, sub, { timeoutMs = 10_000 } = {}) {
  const w = new Worker(WORKER_PATH, { workerData: { path, sub } });
  let readyResolve, readyReject;
  let resultResolve, resultReject;
  const ready = new Promise((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });
  const result = new Promise((res, rej) => {
    resultResolve = res;
    resultReject = rej;
  });

  const timer = setTimeout(() => {
    void w.terminate();
    const err = new Error(`worker timed out after ${timeoutMs}ms`);
    readyReject(err);
    resultReject(err);
  }, timeoutMs);
  timer.unref?.();

  let resultPayload;
  w.on("message", (msg) => {
    if (msg && msg.phase === "ready") readyResolve();
    else if (msg && msg.phase === "result") resultPayload = msg;
  });
  w.on("error", (err) => {
    clearTimeout(timer);
    readyReject(err);
    resultReject(err);
  });
  w.on("exit", (code) => {
    clearTimeout(timer);
    if (resultPayload !== undefined) {
      resultResolve(resultPayload);
    } else {
      const err = new Error(
        `worker exited with code ${code} before posting a result`,
      );
      readyReject(err);
      resultReject(err);
    }
  });

  return {
    ready,
    result,
    start: () => w.postMessage({ phase: "go" }),
    terminate: () => w.terminate(),
  };
}

test(
  "enqueueNewOcrJob: two worker_threads racing the same submission converge to one ocr_jobs + one active queue row",
  { timeout: 15_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "ocr-persistence-10k-race-"));
    const path = join(dir, "ocr.db");
    // Pre-create the file by opening + closing one persistence handle.
    // Both workers will then race to take the writer lock against a
    // schema-applied file; without a pre-created schema the first
    // worker still applies it idempotently and the second waits via
    // busy_timeout.
    {
      const { persistence: bootstrap, db: bootstrapDb } =
        openSqliteOcrPersistence({ path });
      void bootstrap;
      bootstrapDb.close();
    }
    try {
      const sub = baseSubmission("10kthreadrace0000000000000");

      const wA = spawnEnqueueWorker(path, sub);
      const wB = spawnEnqueueWorker(path, sub);

      // Start barrier: do NOT release either worker until BOTH have
      // opened their handles and are parked on the `go` message.
      // Without this barrier the first worker can complete its
      // BEGIN IMMEDIATE before the second one has even opened its
      // connection, and the test degenerates to sequential
      // idempotency (which is already covered above).
      await Promise.all([wA.ready, wB.ready]);
      wA.start();
      wB.start();

      // Wait for BOTH workers to post their result AND exit. The
      // worker fixture closes its DB handles before posting; the
      // exit event is the parent's signal that the writer file lock
      // has been released, so post-race assertions on the file are
      // safe.
      const [mA, mB] = await Promise.all([wA.result, wB.result]);

      // At least one worker must report a fresh enqueue. The other
      // worker either reports `deduped: true` (queue's active-row
      // dedupe path observed the first's commit) OR `ok: false` with
      // an `already exists` message (persistence-side existence check).
      const messages = [mA, mB];
      const fresh = messages.filter((m) => m.ok && m.deduped === false);
      const deduped = messages.filter((m) => m.ok && m.deduped === true);
      const failed = messages.filter((m) => !m.ok);
      assert.equal(
        fresh.length,
        1,
        `expected exactly one fresh enqueue across workers, got ${JSON.stringify(messages)}`,
      );
      assert.equal(
        deduped.length + failed.length,
        1,
        `expected exactly one deduped/failed report, got ${JSON.stringify(messages)}`,
      );
      for (const f of failed) {
        assert.match(f.message, /already exists/);
      }

      // Open a fresh persistence to inspect final on-disk state.
      const { persistence, db } = openSqliteOcrPersistence({ path });
      try {
        const jobs = db
          .prepare("SELECT COUNT(*) AS n FROM ocr_jobs WHERE job_id = ?")
          .get(sub.job_id).n;
        assert.equal(jobs, 1, "exactly one ocr_jobs row must remain");
        const activeQueueRows = db
          .prepare(
            "SELECT COUNT(*) AS n FROM ocr_queue_jobs WHERE job_id = ? AND state != 'resolved'",
          )
          .get(sub.job_id).n;
        assert.equal(activeQueueRows, 1, "exactly one active queue row must remain");
        void persistence;
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
