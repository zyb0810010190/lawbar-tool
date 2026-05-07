// Step 10I-B1 — receipt-lineage tests across process restart.
//
// The point of the receipt ledger is to preserve enough state on disk that
// a token issued before a process restart still classifies correctly when
// presented after the restart. Each test below issues a claim, simulates a
// restart by closing+reopening the DB on the same file path, and then
// inspects how the queue classifies the original token.
//
// Four classifications, four scenarios:
//
//   1. ACTIVE              — claim issued, lease still in the future.
//                           After restart: renewClaim succeeds.
//   2. RESOLVED-COMPLETED  — claim completed before restart.
//                           After restart: renewClaim → unknown_receipt.
//                           (Same applies to requeued, but completed is
//                           the more common path.)
//   3. EXPIRED-UNSWEPT     — lease elapsed, but no reclaim has yet
//                           happened.
//                           After restart: renewClaim → lease_expired.
//   4. EXPIRED-RECLAIMED   — lease elapsed; a different worker reclaimed
//                           the slot before restart, minting a newer
//                           receipt.
//                           After restart, the OLD receipt → stale_receipt;
//                           the NEW receipt is still active.
//
// Active dedupe lineage is also pinned: a completed (resolved) row does
// NOT block re-enqueue with the same submission, mirroring the partial
// unique index.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openSqliteOcrQueue,
} from "../dist/index.js";
import { OcrQueueError } from "ocr-worker-contract";

function tmpDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "ocr-queue-lineage-"));
  return { path: join(dir, "queue.sqlite"), dir };
}

/**
 * Mutable clock the test can advance. Returns Date instances so it slots
 * into SqliteOcrQueue's `now: () => Date` seam unchanged.
 */
function makeClock(initial) {
  let ms = new Date(initial).getTime();
  return {
    now: () => new Date(ms),
    advance(deltaMs) {
      ms += deltaMs;
    },
    nowMs: () => ms,
  };
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

let receiptCounter = 0;
function nextReceipt() {
  receiptCounter++;
  return `r-${receiptCounter}`;
}

test("ACTIVE receipt survives close+reopen and renews", async () => {
  const { path, dir } = tmpDbPath();
  const clock = makeClock("2030-01-01T00:00:00Z");
  const fixedReceipts = ["rA-1"];
  let i = 0;
  const generateReceipt = () => fixedReceipts[i++] ?? nextReceipt();

  let opened = openSqliteOcrQueue({
    path,
    now: clock.now,
    leaseMs: 60_000,
    generateReceipt,
  });
  try {
    await opened.queue.enqueue(SAMPLE_JOB("01active"));
    const claim = await opened.queue.claimNext("worker-1");
    assert.ok(claim);
    assert.equal(claim.receipt, "rA-1");

    // Simulate restart.
    await opened.queue.close();

    // Reopen on the SAME file. Receipt generator is fresh but irrelevant
    // for renew (no new claim is minted).
    opened = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 60_000,
      generateReceipt: () => nextReceipt(),
    });

    // Advance the clock by less than the lease — renew must succeed and
    // the new lease deadline must be strictly later than the original.
    clock.advance(5_000);
    const renewed = await opened.queue.renewClaim(claim);
    assert.equal(renewed.receipt, claim.receipt);
    const oldDeadlineMs = new Date(claim.lease_expires_at).getTime();
    const newDeadlineMs = new Date(renewed.lease_expires_at).getTime();
    assert.ok(
      newDeadlineMs > oldDeadlineMs,
      `renew must extend the lease (old=${claim.lease_expires_at} new=${renewed.lease_expires_at})`,
    );
  } finally {
    await opened.queue.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "RESOLVED (completed-before-restart) receipt → unknown_receipt after reopen",
  async () => {
    const { path, dir } = tmpDbPath();
    const clock = makeClock("2030-01-01T00:00:00Z");
    let opened = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 60_000,
    });
    try {
      await opened.queue.enqueue(SAMPLE_JOB("01completed"));
      const claim = await opened.queue.claimNext("worker-1");
      assert.ok(claim);
      await opened.queue.completeClaim(claim);
      await opened.queue.close();

      opened = openSqliteOcrQueue({ path, now: clock.now, leaseMs: 60_000 });
      await assert.rejects(
        opened.queue.renewClaim(claim),
        (err) =>
          err instanceof OcrQueueError &&
          err.code === "unknown_receipt",
      );
    } finally {
      await opened.queue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "EXPIRED-UNSWEPT receipt → lease_expired after reopen (no reclaim happened)",
  async () => {
    const { path, dir } = tmpDbPath();
    const clock = makeClock("2030-01-01T00:00:00Z");
    let opened = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 30_000,
    });
    try {
      await opened.queue.enqueue(SAMPLE_JOB("01expired"));
      const claim = await opened.queue.claimNext("worker-1");
      assert.ok(claim);
      await opened.queue.close();

      // Advance the clock past the lease, but DO NOT trigger another
      // claimNext — the slot stays "expired-but-unswept".
      clock.advance(60_000);
      opened = openSqliteOcrQueue({ path, now: clock.now, leaseMs: 30_000 });

      await assert.rejects(
        opened.queue.renewClaim(claim),
        (err) =>
          err instanceof OcrQueueError &&
          err.code === "lease_expired",
        "ledger row still resolution='claimed' but lease_expires_at_ms < now",
      );
    } finally {
      await opened.queue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "EXPIRED-RECLAIMED receipt → stale_receipt; new receipt is active, both survive restart",
  async () => {
    const { path, dir } = tmpDbPath();
    const clock = makeClock("2030-01-01T00:00:00Z");
    const receipts = ["old-1", "new-1"];
    let i = 0;
    const generateReceipt = () => receipts[i++] ?? nextReceipt();

    let opened = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 30_000,
      generateReceipt,
    });
    try {
      await opened.queue.enqueue(SAMPLE_JOB("01reclaimed"));
      const oldClaim = await opened.queue.claimNext("worker-1");
      assert.ok(oldClaim);
      assert.equal(oldClaim.receipt, "old-1");

      // Lease elapses; another worker reclaims the slot. This path
      // marks 'old-1' as resolution='superseded' in the receipt ledger
      // and mints 'new-1' as the active receipt.
      clock.advance(60_000);
      const newClaim = await opened.queue.claimNext("worker-2");
      assert.ok(newClaim);
      assert.equal(newClaim.receipt, "new-1");
      assert.notEqual(newClaim.receipt, oldClaim.receipt);

      // Simulate restart.
      await opened.queue.close();
      opened = openSqliteOcrQueue({
        path,
        now: clock.now,
        leaseMs: 30_000,
        generateReceipt: () => nextReceipt(),
      });

      // Old token: stale_receipt — slot was re-claimed.
      await assert.rejects(
        opened.queue.renewClaim(oldClaim),
        (err) =>
          err instanceof OcrQueueError &&
          err.code === "stale_receipt",
      );

      // New token: still authoritative, renew succeeds.
      const renewed = await opened.queue.renewClaim(newClaim);
      assert.equal(renewed.receipt, newClaim.receipt);
    } finally {
      await opened.queue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "tampered claim: live receipt paired with wrong job_id rejects all three resolve paths with invalid_claim",
  async () => {
    // Audit-blocker regression: classifyOrThrow looked up the ledger row by
    // receipt alone, so a caller holding a live receipt could swap in a
    // different `claim.job_id` and successfully mutate the live slot. The
    // contract requires `OcrQueueError("invalid_claim")` here. Mirrors the
    // in-memory queue's existing tampered-claim case.
    const { path, dir } = tmpDbPath();
    const clock = makeClock("2030-01-01T00:00:00Z");
    let opened = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 60_000,
    });
    try {
      await opened.queue.enqueue(SAMPLE_JOB("01legit"));
      const claim = await opened.queue.claimNext("worker-1");
      assert.ok(claim);
      assert.equal(claim.job_id, "01legit");

      const tampered = { ...claim, job_id: "01attacker" };

      // Simulate restart: invalid_claim must be classified from durable lineage,
      // not in-memory state.
      await opened.queue.close();
      opened = openSqliteOcrQueue({
        path,
        now: clock.now,
        leaseMs: 60_000,
      });

      await assert.rejects(
        opened.queue.renewClaim(tampered),
        (err) =>
          err instanceof OcrQueueError &&
          err.code === "invalid_claim" &&
          /01legit/.test(err.message) &&
          /01attacker/.test(err.message),
        "renewClaim must reject a live receipt paired with a foreign job_id",
      );
      await assert.rejects(
        opened.queue.completeClaim(tampered),
        (err) => err instanceof OcrQueueError && err.code === "invalid_claim",
        "completeClaim must reject a live receipt paired with a foreign job_id",
      );
      await assert.rejects(
        opened.queue.requeueClaim(tampered),
        (err) => err instanceof OcrQueueError && err.code === "invalid_claim",
        "requeueClaim must reject a live receipt paired with a foreign job_id",
      );

      // The live claim is unchanged: the legitimate caller can still renew.
      const renewed = await opened.queue.renewClaim(claim);
      assert.equal(renewed.receipt, claim.receipt);
      assert.equal(renewed.job_id, "01legit");
    } finally {
      await opened.queue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "active dedupe is over non-resolved rows only; re-enqueue after completion is allowed",
  async () => {
    const { path, dir } = tmpDbPath();
    const clock = makeClock("2030-01-01T00:00:00Z");
    let opened = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 60_000,
    });
    try {
      // First lifecycle: enqueue → claim → complete.
      const job1 = SAMPLE_JOB("01redo", "transport-A");
      const r1 = await opened.queue.enqueue(job1);
      assert.equal(r1.deduped, false);
      const c1 = await opened.queue.claimNext("worker-1");
      assert.ok(c1);
      await opened.queue.completeClaim(c1);

      // Second enqueue with the SAME logical job_id but a different
      // transport id. The previous queue row is resolved; the partial
      // unique index excludes it, so the new row inserts cleanly.
      const job2 = SAMPLE_JOB("01redo", "transport-B");
      const r2 = await opened.queue.enqueue(job2);
      assert.equal(r2.deduped, false);
      // Defensive: the returned job is the freshly-stored one, not the
      // resolved historical row.
      assert.equal(r2.job.id, "transport-B");

      // Restart preserves both ledger histories.
      await opened.queue.close();
      opened = openSqliteOcrQueue({ path, now: clock.now, leaseMs: 60_000 });

      // Old, resolved receipt is still unknown_receipt after reopen.
      await assert.rejects(
        opened.queue.renewClaim(c1),
        (err) =>
          err instanceof OcrQueueError && err.code === "unknown_receipt",
      );

      // Fresh row claims independently.
      const c2 = await opened.queue.claimNext("worker-2");
      assert.ok(c2);
      assert.equal(c2.job_id, "01redo");
      assert.equal(c2.job.id, "transport-B");
    } finally {
      await opened.queue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "NEVER-ISSUED receipt rejects with unknown_receipt for renew/complete/requeue",
  async () => {
    // No claim was ever minted with this receipt; the ledger row simply
    // does not exist. All three resolve paths must therefore reject as
    // unknown_receipt — not as stale_receipt or invalid_claim.
    const { path, dir } = tmpDbPath();
    const clock = makeClock("2030-01-01T00:00:00Z");
    const opened = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 60_000,
    });
    try {
      // Enqueue+claim something so the queue is fully bootstrapped — we
      // are testing classification of a *foreign* receipt against a live
      // queue, not classification on an empty queue.
      await opened.queue.enqueue(SAMPLE_JOB("01anchor"));
      const real = await opened.queue.claimNext("worker-1");
      assert.ok(real);

      const fabricated = {
        job_id: "01ghost",
        job: SAMPLE_JOB("01ghost", "t-ghost"),
        worker_id: "worker-X",
        claimed_at: clock.now().toISOString(),
        lease_expires_at: new Date(clock.nowMs() + 60_000).toISOString(),
        receipt: "never-minted-by-this-queue",
      };

      await assert.rejects(
        opened.queue.renewClaim(fabricated),
        (err) =>
          err instanceof OcrQueueError && err.code === "unknown_receipt",
      );
      await assert.rejects(
        opened.queue.completeClaim(fabricated),
        (err) =>
          err instanceof OcrQueueError && err.code === "unknown_receipt",
      );
      await assert.rejects(
        opened.queue.requeueClaim(fabricated),
        (err) =>
          err instanceof OcrQueueError && err.code === "unknown_receipt",
      );

      // The real claim is undisturbed.
      const renewed = await opened.queue.renewClaim(real);
      assert.equal(renewed.receipt, real.receipt);
    } finally {
      await opened.queue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "EXPIRED-SWEPT (B2 forward-compat) ledger row rejects all three paths with unknown_receipt",
  async () => {
    // Step 10I-B1 has no janitor that produces resolution='expired_swept'.
    // The classifier still maps that resolution to unknown_receipt today
    // (with no successor receipt by definition, there is nothing for the
    // token to be "stale against"). Pin that mapping by hand-crafting a
    // ledger row in the swept state and exercising all three resolve
    // paths against it. When 10I-B2 implements the janitor, this test
    // pins the contract that swept-without-successor → unknown_receipt.
    const { path, dir } = tmpDbPath();
    const clock = makeClock("2030-01-01T00:00:00Z");
    let opened = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 30_000,
    });
    try {
      await opened.queue.enqueue(SAMPLE_JOB("01tobesweep"));
      const claim = await opened.queue.claimNext("worker-1");
      assert.ok(claim);

      // Lease elapses but the slot is NEVER reclaimed. Simulate the future
      // janitor sweep by directly flipping the ledger resolution to
      // 'expired_swept' (still no successor receipt minted) and clearing
      // the queue-side current_receipt so no live row points back at it.
      // This is the only way to exercise the swept branch in B1 — the
      // classifier code path is forward-compat for a feature B2 owns.
      clock.advance(60_000);
      opened.db.prepare(
        "UPDATE ocr_queue_receipts SET resolution = 'expired_swept', resolved_at_ms = ? WHERE receipt = ?",
      ).run(clock.nowMs(), claim.receipt);
      opened.db.prepare(
        "UPDATE ocr_queue_jobs SET current_receipt = NULL, claimed_until_ms = NULL, claimed_by = NULL, state = 'waiting' WHERE current_receipt = ?",
      ).run(claim.receipt);

      // Simulate restart: expired_swept must be classified from durable lineage,
      // not in-memory state.
      await opened.queue.close();
      opened = openSqliteOcrQueue({
        path,
        now: clock.now,
        leaseMs: 30_000,
      });

      // All three resolve paths must reject as unknown_receipt.
      await assert.rejects(
        opened.queue.renewClaim(claim),
        (err) =>
          err instanceof OcrQueueError && err.code === "unknown_receipt",
      );
      await assert.rejects(
        opened.queue.completeClaim(claim),
        (err) =>
          err instanceof OcrQueueError && err.code === "unknown_receipt",
      );
      await assert.rejects(
        opened.queue.requeueClaim(claim),
        (err) =>
          err instanceof OcrQueueError && err.code === "unknown_receipt",
      );
    } finally {
      await opened.queue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "constructor-injected DB: queue.close() does NOT close the caller's handle",
  async () => {
    // Direct constructor seam → ownsDb=false. The caller still owns the
    // Database; queue.close() is a no-op against the handle. Pin this so
    // a future maintainer of the close path cannot accidentally re-acquire
    // ownership by changing the default.
    const Database = (await import("better-sqlite3")).default;
    const { SqliteOcrQueue } = await import("../dist/index.js");
    const { path, dir } = tmpDbPath();
    const db = new Database(path);
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      const queue = new SqliteOcrQueue({ db });
      await queue.close();
      // If close() had closed the handle, this prepared statement would
      // throw "The database connection is not open".
      const row = db
        .prepare("SELECT COUNT(*) AS c FROM ocr_queue_jobs")
        .get();
      assert.equal(row.c, 0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "openSqliteOcrQueue: queue.close() DOES close the factory-owned handle",
  async () => {
    const { path, dir } = tmpDbPath();
    const opened = openSqliteOcrQueue({ path });
    try {
      await opened.queue.close();
      // Handle must now be closed — better-sqlite3 throws on use.
      assert.throws(
        () => opened.db.prepare("SELECT 1").get(),
        /database connection is not open|closed/i,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "renewClaim returns durable metadata, not echoed forged caller fields",
  async () => {
    // A caller holding a valid receipt must not be able to launder a
    // forged worker_id / claimed_at through renewClaim. The returned claim
    // is reconstructed from the receipt ledger row.
    const { path, dir } = tmpDbPath();
    const clock = makeClock("2030-01-01T00:00:00Z");
    const opened = openSqliteOcrQueue({
      path,
      now: clock.now,
      leaseMs: 60_000,
    });
    try {
      await opened.queue.enqueue(SAMPLE_JOB("01durable"));
      const real = await opened.queue.claimNext("legit-worker");
      assert.ok(real);
      assert.equal(real.worker_id, "legit-worker");

      // Forge worker_id and claimed_at while keeping the live receipt.
      // job_id must still match (else classify rejects as invalid_claim).
      const forged = {
        ...real,
        worker_id: "attacker-worker",
        claimed_at: "1999-01-01T00:00:00.000Z",
      };
      clock.advance(5_000);
      const renewed = await opened.queue.renewClaim(forged);

      assert.equal(
        renewed.worker_id,
        "legit-worker",
        "renewClaim must not echo caller-supplied worker_id",
      );
      assert.equal(
        renewed.claimed_at,
        real.claimed_at,
        "renewClaim must not echo caller-supplied claimed_at",
      );
      // Receipt and job_id remain authoritative; lease_expires_at advances.
      assert.equal(renewed.receipt, real.receipt);
      assert.equal(renewed.job_id, "01durable");
      assert.notEqual(renewed.lease_expires_at, real.lease_expires_at);
    } finally {
      await opened.queue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
