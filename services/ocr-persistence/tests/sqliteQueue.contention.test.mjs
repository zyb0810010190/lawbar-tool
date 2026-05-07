// Step 10I-B2b — SQLite-only dual-connection contention hardening.
//
// The contract conformance harness in `ocr-worker-contract/testing` runs
// against a single backend instance. SQLite under `better-sqlite3` is
// synchronous in one Node thread, so two `claimNext` calls on one queue
// instance trivially serialize on the JS event loop — that does not prove
// anything about file-level locking. These tests open TWO queue handles
// (or one queue + one raw `Database`) against the same temp file so the
// observable behavior is mediated by SQLite's reserved-lock + busy_timeout
// machinery.
//
// Coverage:
//   A. raw SQLITE_BUSY surfaced under contended write lock is NOT remapped
//      into an `OcrQueueError` domain code.
//   B. two factory-owned queues on the same DB do not double-claim a job.
//   C. same logical job_id enqueued from two connections converges to one
//      active row (deduped or `dedupe_conflict` on payload divergence).
//   D. expired-lease reclaim across two connections leaves exactly one
//      active owner; the old receipt classifies as `stale_receipt` via the
//      durable ledger.
//   E. closing one factory-owned queue releases only its own handle and
//      does not poison the second connection.
//
// All tests use temp file DBs (NOT `:memory:`) because a `:memory:` DB is
// per-connection and would not produce shared state across handles.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { openSqliteOcrQueue } from "../dist/index.js";
import { OcrQueueError } from "ocr-worker-contract";

function tmpDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "ocr-queue-contention-"));
  return { path: join(dir, "queue.sqlite"), dir };
}

function makeClock(initial = "2030-01-01T00:00:00Z") {
  let ms = Date.parse(initial);
  return {
    now: () => new Date(ms),
    advance: (delta) => { ms += delta; },
  };
}

function makeReceiptMinter(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const SAMPLE_JOB = (id, transportId = `t-${id}`) => ({
  id: transportId,
  submission: {
    job_id: id,
    tenant_id: "tenant-1",
    document_id: "doc-1",
    submitted_by: "user-1",
    pages: [{ page_id: "p1", page_number: 1, source: { kind: "s3", bucket: "b", key: "k" } }],
  },
  enqueued_at: "2030-01-01T00:00:00.000Z",
});

// --- A. SQLITE_BUSY is not remapped ----------------------------------------

test("A. raw SQLITE_BUSY is surfaced as-is, not remapped to OcrQueueError", async () => {
  const { path, dir } = tmpDbPath();
  let opened = null;
  let raw = null;
  try {
    // Open the queue first so the schema is applied. The queue holds its
    // own better-sqlite3 connection (factory-owned, ownsDb=true). Tiny
    // busy_timeout so the contended write fails fast.
    opened = openSqliteOcrQueue({ path, busyTimeoutMs: 50 });
    // Second raw connection on the same file. We deliberately do NOT
    // re-apply the schema here — applySchema is idempotent but unnecessary
    // since the queue handle already migrated.
    raw = new Database(path);
    raw.pragma("busy_timeout = 50");
    let caught = null;
    // BEGIN IMMEDIATE acquires the reserved lock. Queue's enqueue() also
    // uses BEGIN IMMEDIATE, so it must wait — and time out — on this lock.
    raw.exec("BEGIN IMMEDIATE");
    try {
      await opened.queue.enqueue(SAMPLE_JOB("01busycontention000000000a"));
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected enqueue to throw under contended writer lock");
    assert.ok(
      !(caught instanceof OcrQueueError),
      `raw SQLITE_BUSY MUST NOT be remapped to OcrQueueError; got ${caught?.name} code=${caught?.code}`,
    );
    const indicator = String(caught?.code ?? "") + " " + String(caught?.message ?? "");
    assert.match(
      indicator,
      /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i,
      `expected raw SQLite busy/locked indicator, got: ${indicator}`,
    );
  } finally {
    if (raw) {
      try { raw.exec("ROLLBACK"); } catch { /* lock may already be gone */ }
      try { raw.close(); } catch { /* ignore */ }
    }
    if (opened) {
      try { await opened.queue.close(); } catch { /* ignore */ }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- B. two queues, no double-claim ----------------------------------------

test("B. two factory-owned queues on the same DB do not double-claim one job", async () => {
  const { path, dir } = tmpDbPath();
  let a = null;
  let b = null;
  try {
    a = openSqliteOcrQueue({ path });
    b = openSqliteOcrQueue({ path });
    await a.queue.enqueue(SAMPLE_JOB("01nodbl000000000000000000a"));

    const c1 = await a.queue.claimNext("worker-A");
    assert.ok(c1, "first claim must succeed");
    assert.equal(c1.worker_id, "worker-A");

    const c2 = await b.queue.claimNext("worker-B");
    assert.equal(c2, null, "second claim against the same DB must NOT redeliver the active job");

    // Both connections still usable for further work on distinct ids.
    const r3 = await a.queue.enqueue(SAMPLE_JOB("01usableA00000000000000000", "tA"));
    const r4 = await b.queue.enqueue(SAMPLE_JOB("01usableB00000000000000000", "tB"));
    assert.equal(r3.deduped, false);
    assert.equal(r4.deduped, false);
  } finally {
    if (a) { try { await a.queue.close(); } catch { /* ignore */ } }
    if (b) { try { await b.queue.close(); } catch { /* ignore */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- C. cross-connection enqueue dedupe / conflict -------------------------

test("C. same-job enqueue across two connections converges to one active row", async () => {
  const { path, dir } = tmpDbPath();
  let a = null;
  let b = null;
  try {
    a = openSqliteOcrQueue({ path });
    b = openSqliteOcrQueue({ path });
    const jobId = "01samexconn0000000000000000";
    const r1 = await a.queue.enqueue(SAMPLE_JOB(jobId, "transport-from-A"));
    assert.equal(r1.deduped, false);

    // Equal canonical submission, different transport_id from B → dedupe.
    const r2 = await b.queue.enqueue(SAMPLE_JOB(jobId, "transport-from-B"));
    assert.equal(r2.deduped, true, "equal canonical submission must dedupe across connections");
    // Returned record reflects the EXISTING queued one, not the candidate.
    assert.equal(r2.job.id, "transport-from-A");

    // Different submission → dedupe_conflict, leaving the active row intact.
    const conflict = SAMPLE_JOB(jobId, "transport-conflict");
    conflict.submission.priority = 99;
    let caught = null;
    try {
      await a.queue.enqueue(conflict);
    } catch (err) { caught = err; }
    assert.ok(caught instanceof OcrQueueError);
    assert.equal(caught.code, "dedupe_conflict");

    // Active row still claims to the original payload — priority absent
    // (the SAMPLE_JOB factory doesn't set it on the original) and not 99.
    const claim = await b.queue.claimNext("w");
    assert.ok(claim);
    assert.notEqual(claim.job.submission.priority, 99);
  } finally {
    if (a) { try { await a.queue.close(); } catch { /* ignore */ } }
    if (b) { try { await b.queue.close(); } catch { /* ignore */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- D. expired-lease reclaim across two connections -----------------------

test("D. expired-lease reclaim across two connections has exactly one active owner", async () => {
  const { path, dir } = tmpDbPath();
  const clock = makeClock();
  let a = null;
  let b = null;
  try {
    a = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 1_000,
      generateReceipt: makeReceiptMinter("a"),
    });
    b = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 1_000,
      generateReceipt: makeReceiptMinter("b"),
    });
    await a.queue.enqueue(SAMPLE_JOB("01reclaimacross00000000000a"));
    const c1 = await a.queue.claimNext("worker-A");
    assert.ok(c1);
    const oldReceipt = c1.receipt;

    clock.advance(5_000); // well past 1s lease

    // B reclaims the expired slot.
    const c2 = await b.queue.claimNext("worker-B");
    assert.ok(c2, "B must reclaim the expired slot");
    assert.equal(c2.job_id, c1.job_id);
    assert.notEqual(c2.receipt, oldReceipt);

    // A trying to claim sees nothing left.
    const c3 = await a.queue.claimNext("worker-A");
    assert.equal(c3, null, "no second active owner of the same slot may exist");

    // Old receipt now stale per durable ledger ('superseded').
    let staleErr = null;
    try {
      await a.queue.renewClaim(c1);
    } catch (err) { staleErr = err; }
    assert.ok(staleErr instanceof OcrQueueError);
    assert.equal(staleErr.code, "stale_receipt");

    // Old receipt rejected on either connection (durable, not connection-local).
    let staleErrB = null;
    try {
      await b.queue.completeClaim(c1);
    } catch (err) { staleErrB = err; }
    assert.ok(staleErrB instanceof OcrQueueError);
    assert.equal(staleErrB.code, "stale_receipt");

    // New receipt is renewable on its issuing connection.
    const renewed = await b.queue.renewClaim(c2);
    assert.equal(renewed.receipt, c2.receipt);
  } finally {
    if (a) { try { await a.queue.close(); } catch { /* ignore */ } }
    if (b) { try { await b.queue.close(); } catch { /* ignore */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- E. writer-after-close -------------------------------------------------

test("E. closing one factory-owned queue does not poison another connection", async () => {
  const { path, dir } = tmpDbPath();
  let a = null;
  let b = null;
  try {
    a = openSqliteOcrQueue({ path });
    b = openSqliteOcrQueue({ path });
    await a.queue.close();
    a = null; // already closed; skip in finally

    // B continues uninterrupted on the same file.
    const r = await b.queue.enqueue(SAMPLE_JOB("01alivexafterxclose0000000a"));
    assert.equal(r.deduped, false);
    const claim = await b.queue.claimNext("w");
    assert.ok(claim);
    const renewed = await b.queue.renewClaim(claim);
    assert.equal(renewed.receipt, claim.receipt);
    await b.queue.completeClaim(claim);
  } finally {
    if (a) { try { await a.queue.close(); } catch { /* ignore */ } }
    if (b) { try { await b.queue.close(); } catch { /* ignore */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});
