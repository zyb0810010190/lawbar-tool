// Step 10K — SQLite ingestion coverage.
//
// Closes the audit Dim 7 High: every other ingestion test runs on
// `InMemoryOcrPersistence`, leaving the `atomic: true` SQLite path and
// same-store probe behaviour untested. These tests pin both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ingestDocumentForOcr,
} from "../dist/index.js";
import { drainOcrPipelineForTesting } from "../dist/testing/drainPipeline.js";
import { OcrJobAdapter, InMemoryOcrQueue } from "ocr-worker-adapter";
import { OcrQueueError } from "ocr-worker-contract";
import {
  openSqliteOcrPersistence,
  openSqliteOcrQueue,
} from "ocr-persistence";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = "01jrk8m4q4xv2v8d4d4ymf5tnt";
const DOCUMENT = "01jrk8m4q4xv2v8d4d4ymf5doc";
const PAGE_1 = "01jrk8m4q4xv2v8d4d4ymf5p01";

const sampleSource = {
  kind: "s3",
  bucket: "ocr-ingest-prod",
  key: "tenant/01jrk/doc/01jrk/page-001.png",
  byte_size: 100,
  mime_type: "image/png",
};

const baseInput = () => ({
  tenant_id: TENANT,
  document_id: DOCUMENT,
  document_revision: 1,
  submitted_by: "user_01jrk8m4q4xv2v8d4d4ymf5usr",
  pages: [{ page_id: PAGE_1, page_number: 1, source: { ...sampleSource } }],
  metadata: { trace_id: "10k-sqlite-ingest" },
});

function makeEnv() {
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

function freshSqliteWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ocr-ingestion-sqlite-10k-"));
  const path = join(dir, "ocr.db");
  const { persistence, db: persistenceDb } = openSqliteOcrPersistence({ path });
  const { queue, db: queueDb } = openSqliteOcrQueue({ path });
  const queueAdapter = new OcrJobAdapter({ backend: queue });
  const env = makeEnv();
  return {
    persistence,
    persistenceDb,
    queue,
    queueDb,
    queueAdapter,
    path,
    env,
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

// ---------------------------------------------------------------------------
// Atomic path
// ---------------------------------------------------------------------------

test("SQLite ingest (10K): persistence + queue on same file → atomic=true; both rows committed", async () => {
  const ws = freshSqliteWorkspace();
  try {
    const out = await ingestDocumentForOcr(baseInput(), {
      persistence: ws.persistence,
      queueAdapter: ws.queueAdapter,
      queue: ws.queue, // triggers atomic path
      generateJobId: ws.env.generateJobId,
      now: ws.env.now,
    });

    assert.equal(out.atomic, true, "atomic path must be taken when persistence + queue share file");
    assert.equal(out.enqueueResult.deduped, false);

    const jobRow = ws.persistenceDb
      .prepare("SELECT job_id FROM ocr_jobs WHERE job_id = ?")
      .get(out.job.job_id);
    assert.equal(jobRow?.job_id, out.job.job_id);
    const queueRow = ws.persistenceDb
      .prepare("SELECT job_id, state FROM ocr_queue_jobs WHERE job_id = ?")
      .get(out.job.job_id);
    assert.equal(queueRow?.state, "waiting");
  } finally {
    ws.cleanup();
  }
});

test("SQLite ingest (10K): atomic path drains end-to-end via the worker coordinator", async () => {
  const ws = freshSqliteWorkspace();
  try {
    const out = await ingestDocumentForOcr(baseInput(), {
      persistence: ws.persistence,
      queueAdapter: ws.queueAdapter,
      queue: ws.queue,
      generateJobId: ws.env.generateJobId,
      now: ws.env.now,
    });
    assert.equal(out.atomic, true);

    await drainOcrPipelineForTesting({
      queue: ws.queue,
      persistence: ws.persistence,
      worker_id: "ingest-sqlite-10k-worker",
    });

    const job = await ws.persistence.getOcrJob(out.job.job_id);
    assert.equal(job?.terminal_state, "succeeded");
    const results = await ws.persistence.listOcrResults(out.job.job_id);
    assert.equal(results.length, 1);
    assert.equal(results[0].result.status, "succeeded");
  } finally {
    ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Same-store probe — fallback when wiring is mismatched
// ---------------------------------------------------------------------------

test("SQLite ingest (10K): SQLite persistence + InMemoryOcrQueue → atomic=false (fallback path)", async () => {
  // Pre-fix this combination silently took the atomic path and wrote
  // queue rows into the SQLite file the in-memory queue cannot read.
  // The same-store probe in ingest.ts must now reject the atomic path
  // and use the non-atomic fallback (queue.enqueue lands in memory).
  const ws = freshSqliteWorkspace();
  const memQueue = new InMemoryOcrQueue();
  const memAdapter = new OcrJobAdapter({ backend: memQueue });
  try {
    const out = await ingestDocumentForOcr(baseInput(), {
      persistence: ws.persistence,
      queueAdapter: memAdapter,
      queue: memQueue,
      generateJobId: ws.env.generateJobId,
      now: ws.env.now,
    });

    assert.equal(out.atomic, false, "fallback path must be taken on same-store mismatch");

    // ocr_jobs row is in SQLite (createOcrJob ran).
    const jobRow = ws.persistenceDb
      .prepare("SELECT job_id FROM ocr_jobs WHERE job_id = ?")
      .get(out.job.job_id);
    assert.equal(jobRow?.job_id, out.job.job_id);
    // The SQLite queue table must NOT have a row — the queue went to memory.
    const queueRowCount = ws.persistenceDb
      .prepare("SELECT COUNT(*) AS n FROM ocr_queue_jobs WHERE job_id = ?")
      .get(out.job.job_id).n;
    assert.equal(queueRowCount, 0);
    // Memory queue did receive it.
    assert.equal(await memAdapter.pendingCount(), 1);
  } finally {
    ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Atomic rollback semantics through the ingest seam
// ---------------------------------------------------------------------------

test("SQLite ingest (10K) atomic rollback: pre-existing ocr_jobs row → ingest rejects, no partial state", async () => {
  const ws = freshSqliteWorkspace();
  try {
    const out = await ingestDocumentForOcr(baseInput(), {
      persistence: ws.persistence,
      queueAdapter: ws.queueAdapter,
      queue: ws.queue,
      generateJobId: ws.env.generateJobId,
      now: ws.env.now,
    });
    assert.equal(out.atomic, true);
    const before = ws.persistenceDb
      .prepare("SELECT COUNT(*) AS n FROM ocr_queue_jobs")
      .get().n;

    // Force the same job_id on the next call → atomic path's
    // existence-check trips → BEGIN IMMEDIATE rolls back the new
    // ocr_jobs insert AND the prospective queue insert.
    await assert.rejects(
      () =>
        ingestDocumentForOcr(baseInput(), {
          persistence: ws.persistence,
          queueAdapter: ws.queueAdapter,
          queue: ws.queue,
          generateJobId: () => out.job.job_id,
          now: ws.env.now,
        }),
      (err) => /already exists/.test(err.message ?? String(err)),
    );

    const jobs = ws.persistenceDb
      .prepare("SELECT COUNT(*) AS n FROM ocr_jobs")
      .get().n;
    const queueRows = ws.persistenceDb
      .prepare("SELECT COUNT(*) AS n FROM ocr_queue_jobs")
      .get().n;
    assert.equal(jobs, 1, "atomic rollback must NOT leave a duplicate ocr_jobs row");
    assert.equal(queueRows, before, "atomic rollback must NOT grow the queue");
  } finally {
    ws.cleanup();
  }
});

test("SQLite ingest (10K) atomic rollback: pre-existing differing-canonical queue row → dedupe_conflict, no partial state", async () => {
  const ws = freshSqliteWorkspace();
  try {
    const firstOut = await ingestDocumentForOcr(baseInput(), {
      persistence: ws.persistence,
      queueAdapter: ws.queueAdapter,
      queue: ws.queue,
      generateJobId: ws.env.generateJobId,
      now: ws.env.now,
    });
    assert.equal(firstOut.atomic, true);

    // Simulate "persistence row removed but queue row still active",
    // then re-ingest with the SAME job_id but a DIFFERENT canonical
    // submission. The queue's active-row check sees a mismatch and
    // throws OcrQueueError("dedupe_conflict"); the atomic insert of
    // ocr_jobs must roll back.
    ws.persistenceDb
      .prepare("DELETE FROM ocr_jobs WHERE job_id = ?")
      .run(firstOut.job.job_id);
    assert.equal(
      ws.persistenceDb.prepare("SELECT COUNT(*) AS n FROM ocr_jobs").get().n,
      0,
    );
    assert.equal(
      ws.persistenceDb
        .prepare("SELECT COUNT(*) AS n FROM ocr_queue_jobs")
        .get().n,
      1,
    );

    const mutated = baseInput();
    mutated.metadata = { trace_id: "10k-sqlite-ingest", changed: true };

    await assert.rejects(
      () =>
        ingestDocumentForOcr(mutated, {
          persistence: ws.persistence,
          queueAdapter: ws.queueAdapter,
          queue: ws.queue,
          generateJobId: () => firstOut.job.job_id,
          now: ws.env.now,
        }),
      // Typed OcrQueueError must propagate through wrapErrors. No
      // message-regex fallback — a wrapped/untyped error here would
      // silently regress the wrapErrors fix from round-1.
      (err) => err instanceof OcrQueueError && err.code === "dedupe_conflict",
    );

    // ocr_jobs must NOT have been re-created; queue still has only
    // the original row.
    assert.equal(
      ws.persistenceDb.prepare("SELECT COUNT(*) AS n FROM ocr_jobs").get().n,
      0,
    );
    assert.equal(
      ws.persistenceDb
        .prepare("SELECT COUNT(*) AS n FROM ocr_queue_jobs")
        .get().n,
      1,
    );
  } finally {
    ws.cleanup();
  }
});

test("SQLite ingest (10K): no `queue` dep → atomic=false even with sqlite persistence", async () => {
  // The atomic path is gated on the caller passing the runtime queue
  // backend explicitly. Omitting it forces the fallback. (Worker
  // process callers that do not need the atomicity guarantee can keep
  // their existing wiring.)
  const ws = freshSqliteWorkspace();
  try {
    const out = await ingestDocumentForOcr(baseInput(), {
      persistence: ws.persistence,
      queueAdapter: ws.queueAdapter,
      // queue intentionally omitted
      generateJobId: ws.env.generateJobId,
      now: ws.env.now,
    });
    assert.equal(out.atomic, false);
  } finally {
    ws.cleanup();
  }
});
