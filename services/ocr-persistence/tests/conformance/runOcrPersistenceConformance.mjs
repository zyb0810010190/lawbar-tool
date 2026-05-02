// OcrPersistence conformance harness.
//
// Registers the full behavioral contract of `OcrPersistence` against an
// implementation factory. Today the only impl is `InMemoryOcrPersistence`;
// future DB-backed impls (Step 9 SQLite, later Postgres) MUST pass the same
// suite without modification.
//
// Implementation-neutral: this file imports nothing from
// InMemoryOcrPersistence. It receives an `OcrPersistenceError` reference and
// a `makeImpl` factory; both are supplied by the caller test entry-point.
//
// makeImpl signature:
//   ({ now }: { now: () => Date }) => Promise<{
//     persistence: OcrPersistence;
//     cleanup?: () => Promise<void> | void;
//   }>
//
// Each test creates its OWN persistence instance via makeImpl so isolation is
// preserved across tests and across implementations (e.g. each SQLite run can
// use a fresh in-memory DB).
//
// External dependency note:
//   The end-to-end lifecycle test ("a full adapter outcome can be persisted
//   via the repository primitives") drives a realistic, contract-valid
//   transition+result stream by exercising `OcrJobAdapter` with the
//   `InMemoryOcrQueue` fake-worker path from `ocr-worker-adapter`. This is
//   intentional: it forces every OcrPersistence implementation to accept the
//   exact shape that the production worker emits, instead of hand-crafted
//   fixtures. The dependency is on the adapter package only — the harness
//   remains neutral with respect to which OcrPersistence implementation
//   consumes the adapter's outcome.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OcrJobAdapter, InMemoryOcrQueue } from "ocr-worker-adapter";

import {
  rawBaseSubmission,
  baseSubmission,
  successResult,
  failureResult,
  bumpUlidTail,
  clone,
  makeJob,
  makeResult,
  monotonicClock,
  fixedClock,
} from "./fixtures.mjs";

/**
 * @param {object} opts
 * @param {string} opts.label  prefix for every test name so multiple impls can co-exist
 * @param {(args:{now:()=>Date}) => Promise<{persistence:any, cleanup?:()=>any}>} opts.makeImpl
 * @param {Function} opts.OcrPersistenceError  error class the impl throws (used in assertions)
 */
export function runOcrPersistenceConformance({
  label,
  makeImpl,
  OcrPersistenceError,
}) {
  if (typeof label !== "string" || label.length === 0) {
    throw new Error("conformance: label is required");
  }
  if (typeof makeImpl !== "function") {
    throw new Error("conformance: makeImpl is required");
  }
  if (typeof OcrPersistenceError !== "function") {
    throw new Error("conformance: OcrPersistenceError is required");
  }

  const T = (name, fn) => test(`${label}: ${name}`, fn);

  // ---------------------------------------------------------------------
  // Local helpers
  // ---------------------------------------------------------------------

  /** Build a fresh persistence instance with a default monotonic clock. */
  async function setup({ now } = {}) {
    return await makeImpl({ now: now ?? monotonicClock() });
  }

  /** Run `body` against a fresh impl, always running cleanup. */
  async function withImpl(body, opts = {}) {
    const { persistence, cleanup } = await setup(opts);
    try {
      await body(persistence);
    } finally {
      if (cleanup) await cleanup();
    }
  }

  // =====================================================================
  // createOcrJob
  // =====================================================================

  T("createOcrJob: rejects invalid submission", async () => {
    await withImpl(async (repo) => {
      await assert.rejects(
        () => repo.createOcrJob({ ...baseSubmission, priority: 250 }),
        (err) =>
          err instanceof OcrPersistenceError && /priority/.test(err.message),
      );
      // Nothing persisted.
      assert.equal(await repo.getOcrJob(baseSubmission.job_id), null);
    });
  });

  T("createOcrJob: rejects null", async () => {
    await withImpl(async (repo) => {
      await assert.rejects(() => repo.createOcrJob(null), OcrPersistenceError);
    });
  });

  T("createOcrJob: stores submission verbatim, lifts linkage fields", async () => {
    await withImpl(async (repo) => {
      const rec = await repo.createOcrJob(baseSubmission);
      assert.equal(rec.job_id, baseSubmission.job_id);
      assert.equal(rec.tenant_id, baseSubmission.tenant_id);
      assert.equal(rec.case_id, baseSubmission.case_id);
      assert.equal(rec.document_id, baseSubmission.document_id);
      assert.equal(rec.document_revision, baseSubmission.document_revision);
      assert.deepEqual(rec.submission, baseSubmission);
      assert.equal(rec.terminal_state, undefined, "no statuses yet");
      assert.equal(rec.created_at, "2030-01-01T00:00:00.000Z");
    });
  });

  T("createOcrJob: rejects duplicate job_id", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await assert.rejects(
        () => repo.createOcrJob(baseSubmission),
        (err) =>
          err instanceof OcrPersistenceError &&
          /already exists/.test(err.message),
      );
    });
  });

  // =====================================================================
  // appendOcrStatus
  // =====================================================================

  T("appendOcrStatus: rejects status for unknown job", async () => {
    await withImpl(async (repo) => {
      await assert.rejects(
        () =>
          repo.appendOcrStatus("nonexistent", {
            from: "queued",
            to: "claimed",
            controlled_by: "queue",
            at: "2030-01-01T00:00:00.000Z",
          }),
        OcrPersistenceError,
      );
    });
  });

  T("appendOcrStatus: timeline preserves order via seq", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const t1 = await repo.appendOcrStatus(baseSubmission.job_id, {
        from: "queued",
        to: "claimed",
        controlled_by: "queue",
        at: "2030-01-01T00:00:01.000Z",
      });
      const t2 = await repo.appendOcrStatus(baseSubmission.job_id, {
        from: "claimed",
        to: "processing",
        controlled_by: "worker",
        at: "2030-01-01T00:00:02.000Z",
      });
      const t3 = await repo.appendOcrStatus(baseSubmission.job_id, {
        from: "processing",
        to: "succeeded",
        controlled_by: "worker",
        at: "2030-01-01T00:00:03.000Z",
      });
      assert.deepEqual([t1.seq, t2.seq, t3.seq], [1, 2, 3]);

      const list = await repo.listOcrJobStatuses(baseSubmission.job_id);
      assert.deepEqual(
        list.map((e) => e.seq),
        [1, 2, 3],
      );
      assert.deepEqual(
        list.map((e) => e.to),
        ["claimed", "processing", "succeeded"],
      );

      const job = await repo.getOcrJob(baseSubmission.job_id);
      assert.equal(job.terminal_state, "succeeded");
    });
  });

  T("appendOcrStatus: rejects illegal single edge", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await assert.rejects(
        () =>
          repo.appendOcrStatus(baseSubmission.job_id, {
            from: "succeeded",
            to: "queued",
            controlled_by: "queue",
            at: "2030-01-01T00:00:01.000Z",
          }),
        OcrPersistenceError,
      );
      assert.deepEqual(await repo.listOcrJobStatuses(baseSubmission.job_id), []);
    });
  });

  T("appendOcrStatus: rejects chain break (from != previous.to)", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await repo.appendOcrStatus(baseSubmission.job_id, {
        from: "queued",
        to: "claimed",
        controlled_by: "queue",
        at: "2030-01-01T00:00:01.000Z",
      });
      await assert.rejects(
        () =>
          repo.appendOcrStatus(baseSubmission.job_id, {
            from: "processing",
            to: "succeeded",
            controlled_by: "worker",
            at: "2030-01-01T00:00:02.000Z",
          }),
        OcrPersistenceError,
      );
    });
  });

  T("appendOcrStatus: rejects departure from terminal state", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await repo.appendOcrStatus(baseSubmission.job_id, {
        from: "queued",
        to: "claimed",
        controlled_by: "queue",
        at: "2030-01-01T00:00:01.000Z",
      });
      await repo.appendOcrStatus(baseSubmission.job_id, {
        from: "claimed",
        to: "processing",
        controlled_by: "worker",
        at: "2030-01-01T00:00:02.000Z",
      });
      await repo.appendOcrStatus(baseSubmission.job_id, {
        from: "processing",
        to: "succeeded",
        controlled_by: "worker",
        at: "2030-01-01T00:00:03.000Z",
      });
      await assert.rejects(
        () =>
          repo.appendOcrStatus(baseSubmission.job_id, {
            from: "succeeded",
            to: "dead_lettered",
            controlled_by: "queue",
            at: "2030-01-01T00:00:04.000Z",
          }),
        OcrPersistenceError,
      );
    });
  });

  // =====================================================================
  // saveOcrResult
  // =====================================================================

  T("saveOcrResult: validates the result before saving", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const broken = { ...successResult, status: "succeeded", blocks: undefined };
      await assert.rejects(
        () => repo.saveOcrResult(baseSubmission.job_id, broken),
        OcrPersistenceError,
      );
      assert.deepEqual(await repo.listOcrResults(baseSubmission.job_id), []);
    });
  });

  T("saveOcrResult: rejects mismatched job_id", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const wrong = { ...successResult, job_id: "01zzzzzzzzzzzzzzzzzzzzzzzz" };
      await assert.rejects(
        () => repo.saveOcrResult(baseSubmission.job_id, wrong),
        (err) => err instanceof OcrPersistenceError && /job_id/.test(err.message),
      );
    });
  });

  T("saveOcrResult: rejects mismatched tenant_id linkage", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const tampered = {
        ...successResult,
        tenant_id: "01jrk8m4q4xv2v8d4d4ymf5XXX",
      };
      await assert.rejects(
        () => repo.saveOcrResult(baseSubmission.job_id, tampered),
        (err) =>
          err instanceof OcrPersistenceError && /tenant_id/.test(err.message),
      );
    });
  });

  T("saveOcrResult: rejects unknown job_id (no createOcrJob preceded)", async () => {
    await withImpl(async (repo) => {
      // No createOcrJob call: the job_id has never been registered. The
      // result payload itself is contract-valid; persistence must still reject
      // because the linkage target doesn't exist.
      await assert.rejects(
        () => repo.saveOcrResult(successResult.job_id, successResult),
        OcrPersistenceError,
      );
      // And nothing was persisted under that key.
      assert.deepEqual(await repo.listOcrResults(successResult.job_id), []);
    });
  });

  T("saveOcrResult: rejects mismatched document_id linkage", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      // Same job_id and tenant_id, but document_id is rewritten to a different
      // (still contract-shaped) ULID. Persistence's linkage cross-check must
      // reject — the canonical document_id lives on the stored job record.
      const tampered = {
        ...successResult,
        document_id: bumpUlidTail(successResult.document_id, "ddffff"),
      };
      await assert.rejects(
        () => repo.saveOcrResult(baseSubmission.job_id, tampered),
        (err) =>
          err instanceof OcrPersistenceError &&
          /document_id/.test(err.message),
      );
      assert.deepEqual(await repo.listOcrResults(baseSubmission.job_id), []);
    });
  });

  T("saveOcrResult: stores a partial-failure (failed) result", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const rec = await repo.saveOcrResult(baseSubmission.job_id, failureResult);
      assert.equal(rec.result.status, "failed");
      assert.ok(rec.result.partial_failure);
      assert.equal(typeof rec.result.partial_failure.is_transient, "boolean");
    });
  });

  T("saveOcrResult: rejects duplicate (job_id, page_id)", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await repo.saveOcrResult(baseSubmission.job_id, successResult);
      await assert.rejects(
        () => repo.saveOcrResult(baseSubmission.job_id, successResult),
        (err) =>
          err instanceof OcrPersistenceError && /duplicate/.test(err.message),
      );
    });
  });

  T("saveOcrResult: stores multiple results across distinct page_ids", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await repo.saveOcrResult(baseSubmission.job_id, successResult);
      await repo.saveOcrResult(baseSubmission.job_id, failureResult);
      const list = await repo.listOcrResults(baseSubmission.job_id);
      assert.equal(list.length, 2);
      const statuses = list.map((r) => r.result.status).sort();
      assert.deepEqual(statuses, ["failed", "succeeded"]);
    });
  });

  T("saveOcrResult: rejects result whose page_id is not in submission.pages", async () => {
    await withImpl(async (repo) => {
      const oneSub = clone(rawBaseSubmission);
      await repo.createOcrJob(oneSub);
      await assert.rejects(
        () => repo.saveOcrResult(oneSub.job_id, failureResult),
        (err) =>
          err instanceof OcrPersistenceError &&
          /page_id/.test(err.message) &&
          /submission\.pages/.test(err.message),
      );
      assert.deepEqual(await repo.listOcrResults(oneSub.job_id), []);
    });
  });

  T("saveOcrResult: rejects result whose page_number does not match the submitted page_number for that page_id", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const bad = { ...successResult, page_number: 999 };
      await assert.rejects(
        () => repo.saveOcrResult(baseSubmission.job_id, bad),
        (err) =>
          err instanceof OcrPersistenceError &&
          /page_number/.test(err.message),
      );
    });
  });

  T("saveOcrResult: rejects result whose document_revision does not match the stored job's document_revision", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const bad = { ...successResult, document_revision: 999 };
      await assert.rejects(
        () => repo.saveOcrResult(baseSubmission.job_id, bad),
        (err) =>
          err instanceof OcrPersistenceError &&
          /document_revision/.test(err.message),
      );
    });
  });

  // =====================================================================
  // dead-letter / permanent failure
  // =====================================================================

  T("permanent failure lifecycle: terminal_state=dead_lettered, failure result stored", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const transitions = [
        { from: "queued", to: "claimed", controlled_by: "queue", at: "2030-01-01T00:00:01.000Z" },
        { from: "claimed", to: "processing", controlled_by: "worker", at: "2030-01-01T00:00:02.000Z" },
        { from: "processing", to: "failed", controlled_by: "worker", at: "2030-01-01T00:00:03.000Z" },
        { from: "failed", to: "dead_lettered", controlled_by: "queue", at: "2030-01-01T00:00:04.000Z" },
      ];
      for (const t of transitions) {
        await repo.appendOcrStatus(baseSubmission.job_id, t);
      }
      await repo.saveOcrResult(baseSubmission.job_id, failureResult);

      const job = await repo.getOcrJob(baseSubmission.job_id);
      assert.equal(job.terminal_state, "dead_lettered");
      const results = await repo.listOcrResults(baseSubmission.job_id);
      assert.equal(results.length, 1);
      assert.equal(results[0].result.partial_failure.is_transient, false);
    });
  });

  // =====================================================================
  // adapter-driven end-to-end lifecycle (transient-then-success retry edge)
  // =====================================================================

  T("end-to-end: a full adapter outcome can be persisted via the repository primitives", async () => {
    await withImpl(async (repo) => {
      const adapter = new OcrJobAdapter({ backend: new InMemoryOcrQueue() });

      await repo.createOcrJob(baseSubmission);
      await adapter.enqueueOcrJob(baseSubmission, {
        scenario: "transient_then_success",
      });

      const out = await adapter.processNextOcrJob();
      assert.ok(out);
      assert.equal(out.outcome.terminal_state, "succeeded");

      for (const t of out.outcome.statuses) {
        await repo.appendOcrStatus(baseSubmission.job_id, t);
      }
      for (const r of out.outcome.results) {
        await repo.saveOcrResult(baseSubmission.job_id, r);
      }

      const job = await repo.getOcrJob(baseSubmission.job_id);
      assert.equal(job.terminal_state, "succeeded");

      const persistedStatuses = await repo.listOcrJobStatuses(baseSubmission.job_id);
      assert.equal(persistedStatuses.length, out.outcome.statuses.length);
      assert.deepEqual(
        persistedStatuses.map((e) => `${e.from}->${e.to}`),
        out.outcome.statuses.map((t) => `${t.from}->${t.to}`),
      );
      const retryEdges = persistedStatuses.filter(
        (e) => e.from === "failed" && e.to === "queued",
      );
      assert.equal(retryEdges.length, 1);

      const persistedResults = await repo.listOcrResults(baseSubmission.job_id);
      assert.equal(persistedResults.length, out.outcome.results.length);
    });
  });

  // =====================================================================
  // read-after-write isolation / defensive copies
  // =====================================================================

  T("list methods return defensive copies (callers cannot mutate internal state)", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await repo.appendOcrStatus(baseSubmission.job_id, {
        from: "queued",
        to: "claimed",
        controlled_by: "queue",
        at: "2030-01-01T00:00:01.000Z",
      });
      const a = await repo.listOcrJobStatuses(baseSubmission.job_id);
      a.length = 0;
      const b = await repo.listOcrJobStatuses(baseSubmission.job_id);
      assert.equal(b.length, 1, "internal list must be untouched");
    });
  });

  T("createOcrJob: caller mutating its submission object after createOcrJob does not alter stored record", async () => {
    await withImpl(async (repo) => {
      const sub = clone(baseSubmission);
      await repo.createOcrJob(sub);
      sub.metadata.client_tags = ["mutated"];
      sub.priority = 99;

      const stored = await repo.getOcrJob(sub.job_id);
      assert.notDeepEqual(
        stored.submission.metadata.client_tags,
        ["mutated"],
        "stored submission must not see post-write caller mutation",
      );
      assert.notEqual(stored.submission.priority, 99);
    });
  });

  T("getOcrJob: caller mutating returned record does not alter repo state", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const a = await repo.getOcrJob(baseSubmission.job_id);
      a.terminal_state = "dead_lettered";
      a.submission.priority = 1;
      const b = await repo.getOcrJob(baseSubmission.job_id);
      assert.notEqual(b.terminal_state, "dead_lettered");
      assert.notEqual(b.submission.priority, 1);
    });
  });

  T("listOcrJobStatuses: caller mutating returned event does not alter repo state", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await repo.appendOcrStatus(baseSubmission.job_id, {
        from: "queued",
        to: "claimed",
        controlled_by: "queue",
        at: "2030-01-01T00:00:01.000Z",
      });
      const a = await repo.listOcrJobStatuses(baseSubmission.job_id);
      a[0].to = "dead_lettered";
      const b = await repo.listOcrJobStatuses(baseSubmission.job_id);
      assert.equal(b[0].to, "claimed", "stored status must not reflect caller mutation");
    });
  });

  T("saveOcrResult: caller mutating result after save does not alter stored record", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const r = clone(successResult);
      await repo.saveOcrResult(baseSubmission.job_id, r);
      r.status = "failed";
      r.raw_text = "TAMPERED";
      if (Array.isArray(r.blocks) && r.blocks.length > 0) {
        r.blocks[0].text = "TAMPERED";
      }

      const stored = (await repo.listOcrResults(baseSubmission.job_id))[0];
      assert.equal(stored.result.status, "succeeded", "stored result.status must not see post-save mutation");
      assert.notEqual(stored.result.raw_text, "TAMPERED", "stored result.raw_text must not see post-save mutation");
      if (Array.isArray(stored.result.blocks) && stored.result.blocks.length > 0) {
        assert.notEqual(stored.result.blocks[0].text, "TAMPERED", "nested block mutation must not bleed in");
      }
    });
  });

  // =====================================================================
  // listOcrResults ordering
  // =====================================================================

  T("listOcrResults: results are returned ascending by persisted_at, ties broken by page_id", async () => {
    await withImpl(
      async (repo) => {
        await repo.createOcrJob(baseSubmission);

        // Save in reverse-page-id order; tie on persisted_at forces page_id ASC tie-break.
        await repo.saveOcrResult(baseSubmission.job_id, failureResult);
        await repo.saveOcrResult(baseSubmission.job_id, successResult);

        const list = await repo.listOcrResults(baseSubmission.job_id);
        assert.equal(list.length, 2);
        const fixed = "2030-06-01T00:00:00.000Z";
        assert.equal(list[0].persisted_at, fixed);
        assert.equal(list[1].persisted_at, fixed);
        assert.ok(
          list[0].result.page_id < list[1].result.page_id,
          `expected page_id ascending under tie, got ${list[0].result.page_id} then ${list[1].result.page_id}`,
        );
        assert.equal(list[0].result.page_id, successResult.page_id);
        assert.equal(list[1].result.page_id, failureResult.page_id);
      },
      { now: fixedClock("2030-06-01T00:00:00.000Z") },
    );
  });

  // =====================================================================
  // listOcrJobsByDocument (cross-job)
  // =====================================================================

  T("listOcrJobsByDocument: empty repo + unknown tenant returns {rows:[], next_cursor:null}", async () => {
    await withImpl(async (repo) => {
      const out = await repo.listOcrJobsByDocument({
        tenant_id: bumpUlidTail(rawBaseSubmission.tenant_id, "ZZZZZZ"),
        document_id: rawBaseSubmission.document_id,
      });
      assert.deepEqual(out.rows, []);
      assert.equal(out.next_cursor, null);
    });
  });

  T("listOcrJobsByDocument: filters by tenant_id and document_id", async () => {
    await withImpl(async (repo) => {
      const a = makeJob({ jobIdSuffix: "0a0001", tenantTail: "aaaaaa" });
      const b = makeJob({ jobIdSuffix: "0b0001", tenantTail: "bbbbbb" });
      await repo.createOcrJob(a);
      await repo.createOcrJob(b);

      const onlyA = await repo.listOcrJobsByDocument({
        tenant_id: a.tenant_id,
        document_id: a.document_id,
      });
      assert.equal(onlyA.rows.length, 1);
      assert.equal(onlyA.rows[0].job_id, a.job_id);

      const otherDoc = await repo.listOcrJobsByDocument({
        tenant_id: a.tenant_id,
        document_id: bumpUlidTail(rawBaseSubmission.document_id, "zzzzzz"),
      });
      assert.equal(otherDoc.rows.length, 0);
      assert.equal(otherDoc.next_cursor, null);
    });
  });

  T("listOcrJobsByDocument: document_revision filter", async () => {
    await withImpl(async (repo) => {
      const r3 = makeJob({ jobIdSuffix: "030001", documentRevision: 3 });
      const r4 = makeJob({ jobIdSuffix: "040001", documentRevision: 4 });
      await repo.createOcrJob(r3);
      await repo.createOcrJob(r4);

      const onlyRev3 = await repo.listOcrJobsByDocument({
        tenant_id: r3.tenant_id,
        document_id: r3.document_id,
        document_revision: 3,
      });
      assert.equal(onlyRev3.rows.length, 1);
      assert.equal(onlyRev3.rows[0].document_revision, 3);

      const both = await repo.listOcrJobsByDocument({
        tenant_id: r3.tenant_id,
        document_id: r3.document_id,
      });
      assert.equal(both.rows.length, 2);
    });
  });

  T("listOcrJobsByDocument: orders by created_at DESC, then job_id ASC", async () => {
    await withImpl(async (repo) => {
      const t1 = makeJob({ jobIdSuffix: "aa0001" });
      await repo.createOcrJob(t1);
      const t2 = makeJob({ jobIdSuffix: "bb0001" });
      await repo.createOcrJob(t2);
      const t3 = makeJob({ jobIdSuffix: "cc0001" });
      await repo.createOcrJob(t3);

      const out = await repo.listOcrJobsByDocument({
        tenant_id: t1.tenant_id,
        document_id: t1.document_id,
      });
      assert.deepEqual(
        out.rows.map((j) => j.job_id),
        [t3.job_id, t2.job_id, t1.job_id],
      );
    });
  });

  T("listOcrJobsByDocument: ties on created_at break by job_id ASC", async () => {
    await withImpl(
      async (repo) => {
        const a = makeJob({ jobIdSuffix: "aa0001" });
        const b = makeJob({ jobIdSuffix: "bb0001" });
        const c = makeJob({ jobIdSuffix: "cc0001" });
        await repo.createOcrJob(c);
        await repo.createOcrJob(a);
        await repo.createOcrJob(b);

        const out = await repo.listOcrJobsByDocument({
          tenant_id: a.tenant_id,
          document_id: a.document_id,
        });
        assert.deepEqual(
          out.rows.map((j) => j.job_id),
          [a.job_id, b.job_id, c.job_id].sort(),
        );
      },
      { now: fixedClock("2030-01-01T00:00:00.000Z") },
    );
  });

  T("listOcrJobsByDocument: pagination is stable (no duplicates / no skips)", async () => {
    await withImpl(async (repo) => {
      const total = 7;
      const created = [];
      for (let i = 0; i < total; i++) {
        const j = makeJob({ jobIdSuffix: `xx0${i}01` });
        await repo.createOcrJob(j);
        created.push(j.job_id);
      }
      const expected = [...created].reverse();

      const seen = [];
      let cursor;
      for (let safety = 0; safety < 10; safety++) {
        const page = await repo.listOcrJobsByDocument({
          tenant_id: rawBaseSubmission.tenant_id,
          document_id: rawBaseSubmission.document_id,
          limit: 3,
          ...(cursor !== undefined ? { cursor } : {}),
        });
        seen.push(...page.rows.map((r) => r.job_id));
        if (page.next_cursor === null) break;
        cursor = page.next_cursor;
      }
      assert.deepEqual(seen, expected);
      assert.equal(new Set(seen).size, total, "no duplicates across pages");
    });
  });

  T("listOcrJobsByDocument: rejects invalid limits", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(rawBaseSubmission);
      for (const bad of [0, -1, 1.5, NaN, 201, "10", null]) {
        await assert.rejects(
          () =>
            repo.listOcrJobsByDocument({
              tenant_id: rawBaseSubmission.tenant_id,
              document_id: rawBaseSubmission.document_id,
              limit: bad,
            }),
          OcrPersistenceError,
          `expected reject for limit=${String(bad)}`,
        );
      }
    });
  });

  T("listOcrJobsByDocument: rejects malformed cursor", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(rawBaseSubmission);
      await assert.rejects(
        () =>
          repo.listOcrJobsByDocument({
            tenant_id: rawBaseSubmission.tenant_id,
            document_id: rawBaseSubmission.document_id,
            cursor: "!!!not-base64url-json!!!",
          }),
        (err) => err instanceof OcrPersistenceError,
      );
    });
  });

  T("listOcrJobsByDocument: rejects wrong-kind cursor", async () => {
    await withImpl(async (repo) => {
      const sub = makeJob({
        jobIdSuffix: "wk0001",
        pages: [
          { idSuffix: "pa0001", page_number: 1 },
          { idSuffix: "pb0001", page_number: 2 },
        ],
      });
      await repo.createOcrJob(sub);
      for (const idx of [0, 1]) {
        const r = makeResult({
          base: successResult,
          jobIdSuffix: "wk0001",
          pageIdSuffix: idx === 0 ? "pa0001" : "pb0001",
          pageNumber: idx + 1,
          manualReview: true,
        });
        await repo.saveOcrResult(sub.job_id, r);
      }
      const reviewPage = await repo.listOcrReviewPageRows({
        tenant_id: sub.tenant_id,
        limit: 1,
      });
      assert.ok(reviewPage.next_cursor, "expected a review_pages cursor");

      await assert.rejects(
        () =>
          repo.listOcrJobsByDocument({
            tenant_id: sub.tenant_id,
            document_id: sub.document_id,
            cursor: reviewPage.next_cursor,
          }),
        (err) =>
          err instanceof OcrPersistenceError &&
          /wrong-kind|kind/.test(err.message),
      );
    });
  });

  T("listOcrJobsByDocument: rejects cursor whose filters_hash mismatches", async () => {
    await withImpl(async (repo) => {
      for (let i = 0; i < 5; i++) {
        await repo.createOcrJob(makeJob({ jobIdSuffix: `mm0${i}01` }));
      }
      const page1 = await repo.listOcrJobsByDocument({
        tenant_id: rawBaseSubmission.tenant_id,
        document_id: rawBaseSubmission.document_id,
        limit: 2,
      });
      assert.ok(page1.next_cursor, "expected next_cursor");

      await assert.rejects(
        () =>
          repo.listOcrJobsByDocument({
            tenant_id: rawBaseSubmission.tenant_id,
            document_id: rawBaseSubmission.document_id,
            document_revision: 999,
            cursor: page1.next_cursor,
          }),
        (err) =>
          err instanceof OcrPersistenceError &&
          /filters_hash|filters/.test(err.message),
      );
    });
  });

  T("listOcrJobsByDocument: returns next_cursor=null on the final page", async () => {
    await withImpl(async (repo) => {
      for (let i = 0; i < 4; i++) {
        await repo.createOcrJob(makeJob({ jobIdSuffix: `ll0${i}01` }));
      }
      const out = await repo.listOcrJobsByDocument({
        tenant_id: rawBaseSubmission.tenant_id,
        document_id: rawBaseSubmission.document_id,
        limit: 4,
      });
      assert.equal(out.rows.length, 4);
      assert.equal(out.next_cursor, null);
    });
  });

  T("listOcrJobsByDocument: returned rows are defensive copies", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(makeJob({ jobIdSuffix: "dc0001" }));
      const out = await repo.listOcrJobsByDocument({
        tenant_id: rawBaseSubmission.tenant_id,
        document_id: rawBaseSubmission.document_id,
      });
      out.rows[0].terminal_state = "dead_lettered";
      out.rows[0].submission.priority = 1;
      const again = await repo.listOcrJobsByDocument({
        tenant_id: rawBaseSubmission.tenant_id,
        document_id: rawBaseSubmission.document_id,
      });
      assert.notEqual(again.rows[0].terminal_state, "dead_lettered");
      assert.notEqual(again.rows[0].submission.priority, 1);
    });
  });

  // =====================================================================
  // listOcrReviewPageRows (cross-job)
  // =====================================================================

  T("listOcrReviewPageRows: empty + unknown tenant returns empty page", async () => {
    await withImpl(async (repo) => {
      const out = await repo.listOcrReviewPageRows({
        tenant_id: bumpUlidTail(rawBaseSubmission.tenant_id, "ZZZZZZ"),
      });
      assert.deepEqual(out.rows, []);
      assert.equal(out.next_cursor, null);
    });
  });

  T("listOcrReviewPageRows: only result-backed pages with manual_review_recommended=true appear", async () => {
    await withImpl(async (repo) => {
      const sub = makeJob({
        jobIdSuffix: "mr0001",
        pages: [
          { idSuffix: "p10001", page_number: 1 },
          { idSuffix: "p20001", page_number: 2 },
        ],
      });
      await repo.createOcrJob(sub);
      await repo.saveOcrResult(
        sub.job_id,
        makeResult({
          base: successResult,
          jobIdSuffix: "mr0001",
          pageIdSuffix: "p10001",
          pageNumber: 1,
          manualReview: false,
        }),
      );
      await repo.saveOcrResult(
        sub.job_id,
        makeResult({
          base: successResult,
          jobIdSuffix: "mr0001",
          pageIdSuffix: "p20001",
          pageNumber: 2,
          manualReview: true,
        }),
      );
      const out = await repo.listOcrReviewPageRows({ tenant_id: sub.tenant_id });
      assert.equal(out.rows.length, 1);
      assert.equal(out.rows[0].result.result.page_id, sub.pages[1].page_id);
    });
  });

  T("listOcrReviewPageRows: failed page with manual_review_recommended=true is included", async () => {
    await withImpl(async (repo) => {
      const sub = makeJob({
        jobIdSuffix: "fp0001",
        pages: [
          { idSuffix: "fa0001", page_number: 1 },
          { idSuffix: "fb0001", page_number: 4 },
        ],
      });
      await repo.createOcrJob(sub);
      const failedFlagged = makeResult({
        base: failureResult,
        jobIdSuffix: "fp0001",
        pageIdSuffix: "fb0001",
        pageNumber: 4,
        manualReview: true,
      });
      await repo.saveOcrResult(sub.job_id, failedFlagged);
      const out = await repo.listOcrReviewPageRows({ tenant_id: sub.tenant_id });
      assert.equal(out.rows.length, 1);
      assert.equal(out.rows[0].result.result.status, "failed");
      assert.equal(out.rows[0].result.result.review.manual_review_recommended, true);
    });
  });

  T("listOcrReviewPageRows: case_id filter matches OcrJobRecord.case_id", async () => {
    await withImpl(async (repo) => {
      const subA = makeJob({
        jobIdSuffix: "ca0001",
        caseTail: "case01",
        pages: [{ idSuffix: "pa0001", page_number: 1 }],
      });
      const subB = makeJob({
        jobIdSuffix: "cb0001",
        caseTail: "case02",
        pages: [{ idSuffix: "pb0001", page_number: 1 }],
      });
      await repo.createOcrJob(subA);
      await repo.createOcrJob(subB);
      for (const [sub, suffix] of [
        [subA, "pa0001"],
        [subB, "pb0001"],
      ]) {
        const r = makeResult({
          base: successResult,
          jobIdSuffix: sub.job_id.slice(-6),
          pageIdSuffix: suffix,
          pageNumber: 1,
          manualReview: true,
        });
        r.job_id = sub.job_id;
        r.tenant_id = sub.tenant_id;
        await repo.saveOcrResult(sub.job_id, r);
      }
      const out = await repo.listOcrReviewPageRows({
        tenant_id: subA.tenant_id,
        case_id: subA.case_id,
      });
      assert.equal(out.rows.length, 1);
      assert.equal(out.rows[0].job.case_id, subA.case_id);
    });
  });

  T("listOcrReviewPageRows: document_revision filter narrows by job-side revision", async () => {
    await withImpl(async (repo) => {
      const sub3 = makeJob({
        jobIdSuffix: "dr0003",
        documentRevision: 3,
        pages: [{ idSuffix: "p30001", page_number: 1 }],
      });
      const sub4 = makeJob({
        jobIdSuffix: "dr0004",
        documentRevision: 4,
        pages: [{ idSuffix: "p40001", page_number: 1 }],
      });
      await repo.createOcrJob(sub3);
      await repo.createOcrJob(sub4);
      for (const [sub, suffix, rev] of [
        [sub3, "p30001", 3],
        [sub4, "p40001", 4],
      ]) {
        const r = makeResult({
          base: successResult,
          jobIdSuffix: sub.job_id.slice(-6),
          pageIdSuffix: suffix,
          pageNumber: 1,
          documentRevision: rev,
          manualReview: true,
        });
        r.job_id = sub.job_id;
        r.tenant_id = sub.tenant_id;
        await repo.saveOcrResult(sub.job_id, r);
      }
      const onlyRev3 = await repo.listOcrReviewPageRows({
        tenant_id: sub3.tenant_id,
        document_id: sub3.document_id,
        document_revision: 3,
      });
      assert.equal(onlyRev3.rows.length, 1);
      assert.equal(onlyRev3.rows[0].job.document_revision, 3);
    });
  });

  T("listOcrReviewPageRows: orders by persisted_at DESC, job_id ASC, page_number ASC, page_id ASC", async () => {
    await withImpl(async (repo) => {
      const subA = makeJob({
        jobIdSuffix: "aaa001",
        pages: [
          { idSuffix: "aa0001", page_number: 1 },
          { idSuffix: "ab0001", page_number: 2 },
        ],
      });
      const subB = makeJob({
        jobIdSuffix: "bbb001",
        pages: [{ idSuffix: "ba0001", page_number: 1 }],
      });
      await repo.createOcrJob(subA);
      await repo.createOcrJob(subB);
      await repo.saveOcrResult(
        subB.job_id,
        makeResult({
          base: successResult,
          jobIdSuffix: "bbb001",
          pageIdSuffix: "ba0001",
          pageNumber: 1,
          manualReview: true,
        }),
      );
      await repo.saveOcrResult(
        subA.job_id,
        makeResult({
          base: successResult,
          jobIdSuffix: "aaa001",
          pageIdSuffix: "ab0001",
          pageNumber: 2,
          manualReview: true,
        }),
      );
      await repo.saveOcrResult(
        subA.job_id,
        makeResult({
          base: successResult,
          jobIdSuffix: "aaa001",
          pageIdSuffix: "aa0001",
          pageNumber: 1,
          manualReview: true,
        }),
      );
      const out = await repo.listOcrReviewPageRows({ tenant_id: subA.tenant_id });
      assert.equal(out.rows.length, 3);
      assert.equal(out.rows[0].job.job_id, subA.job_id);
      assert.equal(out.rows[0].result.result.page_number, 1);
      assert.equal(out.rows[1].job.job_id, subA.job_id);
      assert.equal(out.rows[1].result.result.page_number, 2);
      assert.equal(out.rows[2].job.job_id, subB.job_id);
    });
  });

  T("listOcrReviewPageRows: pagination is stable across pages", async () => {
    await withImpl(async (repo) => {
      const N = 5;
      const sub = makeJob({
        jobIdSuffix: "pg0001",
        pages: Array.from({ length: N }, (_, i) => ({
          idSuffix: `p${String(i).padStart(5, "0")}`,
          page_number: i + 1,
        })),
      });
      await repo.createOcrJob(sub);
      for (let i = 0; i < N; i++) {
        await repo.saveOcrResult(
          sub.job_id,
          makeResult({
            base: successResult,
            jobIdSuffix: "pg0001",
            pageIdSuffix: `p${String(i).padStart(5, "0")}`,
            pageNumber: i + 1,
            manualReview: true,
          }),
        );
      }
      const seen = [];
      let cursor;
      for (let safety = 0; safety < 10; safety++) {
        const page = await repo.listOcrReviewPageRows({
          tenant_id: sub.tenant_id,
          limit: 2,
          ...(cursor !== undefined ? { cursor } : {}),
        });
        seen.push(...page.rows.map((r) => r.result.result.page_id));
        if (page.next_cursor === null) break;
        cursor = page.next_cursor;
      }
      assert.equal(seen.length, N);
      assert.equal(new Set(seen).size, N, "no duplicates across pages");
    });
  });

  T("listOcrReviewPageRows: rejects invalid limits", async () => {
    await withImpl(async (repo) => {
      for (const bad of [0, -1, 1.5, NaN, 201, "x", null]) {
        await assert.rejects(
          () =>
            repo.listOcrReviewPageRows({
              tenant_id: rawBaseSubmission.tenant_id,
              limit: bad,
            }),
          OcrPersistenceError,
          `expected reject for limit=${String(bad)}`,
        );
      }
    });
  });

  T("listOcrReviewPageRows: rejects malformed and wrong-kind cursors", async () => {
    await withImpl(async (repo) => {
      for (let i = 0; i < 3; i++) {
        await repo.createOcrJob(makeJob({ jobIdSuffix: `wc0${i}01` }));
      }
      const wrong = await repo.listOcrJobsByDocument({
        tenant_id: rawBaseSubmission.tenant_id,
        document_id: rawBaseSubmission.document_id,
        limit: 1,
      });
      assert.ok(wrong.next_cursor);

      await assert.rejects(
        () =>
          repo.listOcrReviewPageRows({
            tenant_id: rawBaseSubmission.tenant_id,
            cursor: "!!! not valid !!!",
          }),
        OcrPersistenceError,
      );
      await assert.rejects(
        () =>
          repo.listOcrReviewPageRows({
            tenant_id: rawBaseSubmission.tenant_id,
            cursor: wrong.next_cursor,
          }),
        (err) => err instanceof OcrPersistenceError && /kind/.test(err.message),
      );
    });
  });

  T("listOcrReviewPageRows: rejects cursor with mismatched filters_hash", async () => {
    await withImpl(async (repo) => {
      const sub = makeJob({
        jobIdSuffix: "fh0001",
        pages: [
          { idSuffix: "f10001", page_number: 1 },
          { idSuffix: "f20001", page_number: 2 },
          { idSuffix: "f30001", page_number: 3 },
        ],
      });
      await repo.createOcrJob(sub);
      for (let i = 0; i < 3; i++) {
        await repo.saveOcrResult(
          sub.job_id,
          makeResult({
            base: successResult,
            jobIdSuffix: "fh0001",
            pageIdSuffix: `f${i + 1}0001`,
            pageNumber: i + 1,
            manualReview: true,
          }),
        );
      }
      const page1 = await repo.listOcrReviewPageRows({
        tenant_id: sub.tenant_id,
        limit: 1,
      });
      assert.ok(page1.next_cursor);
      await assert.rejects(
        () =>
          repo.listOcrReviewPageRows({
            tenant_id: sub.tenant_id,
            case_id: sub.case_id,
            cursor: page1.next_cursor,
          }),
        (err) =>
          err instanceof OcrPersistenceError &&
          /filters_hash|filters/.test(err.message),
      );
    });
  });

  T("listOcrReviewPageRows: page_id ASC is the final tie-break when persisted_at, job_id, and page_number all collide", async () => {
    await withImpl(
      async (repo) => {
        const sub = makeJob({
          jobIdSuffix: "tb0001",
          pages: [
            { idSuffix: "z90001", page_number: 7 },
            { idSuffix: "a10001", page_number: 7 },
          ],
        });
        await repo.createOcrJob(sub);

        await repo.saveOcrResult(
          sub.job_id,
          makeResult({
            base: successResult,
            jobIdSuffix: "tb0001",
            pageIdSuffix: "z90001",
            pageNumber: 7,
            manualReview: true,
          }),
        );
        await repo.saveOcrResult(
          sub.job_id,
          makeResult({
            base: successResult,
            jobIdSuffix: "tb0001",
            pageIdSuffix: "a10001",
            pageNumber: 7,
            manualReview: true,
          }),
        );

        const out = await repo.listOcrReviewPageRows({ tenant_id: sub.tenant_id });
        assert.equal(out.rows.length, 2);
        assert.equal(
          out.rows[0].result.persisted_at,
          out.rows[1].result.persisted_at,
        );
        assert.equal(out.rows[0].job.job_id, out.rows[1].job.job_id);
        assert.equal(
          out.rows[0].result.result.page_number,
          out.rows[1].result.result.page_number,
        );
        const ids = out.rows.map((r) => r.result.result.page_id);
        assert.deepEqual(ids, [...ids].sort(), "expected page_id ASC tie-break");
        assert.equal(ids[0], sub.pages[1].page_id, "a10001 before z90001");
        assert.equal(ids[1], sub.pages[0].page_id);
      },
      { now: fixedClock("2030-06-01T00:00:00.000Z") },
    );
  });

  T("listOcrReviewPageRows: returned rows are defensive copies", async () => {
    await withImpl(async (repo) => {
      const sub = makeJob({
        jobIdSuffix: "def001",
        pages: [{ idSuffix: "dd0001", page_number: 1 }],
      });
      await repo.createOcrJob(sub);
      await repo.saveOcrResult(
        sub.job_id,
        makeResult({
          base: successResult,
          jobIdSuffix: "def001",
          pageIdSuffix: "dd0001",
          pageNumber: 1,
          manualReview: true,
        }),
      );
      const a = await repo.listOcrReviewPageRows({ tenant_id: sub.tenant_id });
      a.rows[0].result.result.raw_text = "TAMPERED";
      a.rows[0].job.terminal_state = "dead_lettered";
      const b = await repo.listOcrReviewPageRows({ tenant_id: sub.tenant_id });
      assert.notEqual(b.rows[0].result.result.raw_text, "TAMPERED");
      assert.notEqual(b.rows[0].job.terminal_state, "dead_lettered");
    });
  });

  // =====================================================================
  // appendOcrStatusOnce — replay-safe variant for at-least-once redelivery
  // =====================================================================

  T("appendOcrStatusOnce: writes a new transition like strict (when no replay match)", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const t1 = await repo.appendOcrStatusOnce(baseSubmission.job_id, {
        from: "queued",
        to: "claimed",
        controlled_by: "queue",
        at: "2030-01-01T00:00:01.000Z",
      });
      assert.equal(t1.seq, 1);
      assert.equal(t1.to, "claimed");
      const list = await repo.listOcrJobStatuses(baseSubmission.job_id);
      assert.equal(list.length, 1);
      const job = await repo.getOcrJob(baseSubmission.job_id);
      assert.equal(job.terminal_state, "claimed");
    });
  });

  T("appendOcrStatusOnce: exact replay returns the stored event without duplicating", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const transition = {
        from: "queued",
        to: "claimed",
        controlled_by: "queue",
        at: "2030-01-01T00:00:01.000Z",
      };
      const first = await repo.appendOcrStatusOnce(baseSubmission.job_id, transition);
      const replayed = await repo.appendOcrStatusOnce(
        baseSubmission.job_id,
        // Re-order keys to prove canonical-JSON equality, not key-order equality.
        {
          at: transition.at,
          controlled_by: transition.controlled_by,
          to: transition.to,
          from: transition.from,
        },
      );
      assert.equal(replayed.seq, first.seq);
      assert.equal(replayed.persisted_at, first.persisted_at);
      const list = await repo.listOcrJobStatuses(baseSubmission.job_id);
      assert.equal(list.length, 1);
    });
  });

  T("appendOcrStatusOnce: replay of an earlier already-persisted transition is a no-op even after the chain advanced", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const t1 = {
        from: "queued",
        to: "claimed",
        controlled_by: "queue",
        at: "2030-01-01T00:00:01.000Z",
      };
      const t2 = {
        from: "claimed",
        to: "processing",
        controlled_by: "worker",
        at: "2030-01-01T00:00:02.000Z",
      };
      await repo.appendOcrStatusOnce(baseSubmission.job_id, t1);
      await repo.appendOcrStatusOnce(baseSubmission.job_id, t2);
      const replay = await repo.appendOcrStatusOnce(baseSubmission.job_id, t1);
      assert.equal(replay.seq, 1);
      assert.equal(replay.to, "claimed");
      const list = await repo.listOcrJobStatuses(baseSubmission.job_id);
      assert.equal(list.length, 2);
      assert.deepEqual(
        list.map((e) => e.seq),
        [1, 2],
      );
    });
  });

  T("appendOcrStatusOnce: conflicting replay (same from/to but different `at`) is rejected", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await repo.appendOcrStatusOnce(baseSubmission.job_id, {
        from: "queued",
        to: "claimed",
        controlled_by: "queue",
        at: "2030-01-01T00:00:01.000Z",
      });
      await assert.rejects(
        () =>
          repo.appendOcrStatusOnce(baseSubmission.job_id, {
            from: "queued",
            to: "claimed",
            controlled_by: "queue",
            // Different `at` — not canonically equal to stored event, and the
            // chain has already advanced past `from=queued`, so strict's
            // re-validation must reject this.
            at: "2030-01-01T00:00:99.000Z",
          }),
        OcrPersistenceError,
      );
      const list = await repo.listOcrJobStatuses(baseSubmission.job_id);
      assert.equal(list.length, 1);
    });
  });

  T("appendOcrStatusOnce: rejects unknown job", async () => {
    await withImpl(async (repo) => {
      await assert.rejects(
        () =>
          repo.appendOcrStatusOnce("nonexistent", {
            from: "queued",
            to: "claimed",
            controlled_by: "queue",
            at: "2030-01-01T00:00:01.000Z",
          }),
        OcrPersistenceError,
      );
    });
  });

  T("appendOcrStatusOnce: rejects illegal edge (no replay match, strict reject)", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await assert.rejects(
        () =>
          repo.appendOcrStatusOnce(baseSubmission.job_id, {
            from: "succeeded",
            to: "queued",
            controlled_by: "queue",
            at: "2030-01-01T00:00:01.000Z",
          }),
        OcrPersistenceError,
      );
      assert.deepEqual(await repo.listOcrJobStatuses(baseSubmission.job_id), []);
    });
  });

  // =====================================================================
  // saveOcrResultOnce — replay-safe variant for at-least-once redelivery
  // =====================================================================

  T("saveOcrResultOnce: writes a new result like strict (when no existing row)", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const rec = await repo.saveOcrResultOnce(baseSubmission.job_id, successResult);
      assert.equal(rec.result.page_id, successResult.page_id);
      const list = await repo.listOcrResults(baseSubmission.job_id);
      assert.equal(list.length, 1);
    });
  });

  T("saveOcrResultOnce: exact duplicate replay returns stored record without inserting again", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      const first = await repo.saveOcrResultOnce(baseSubmission.job_id, successResult);
      // Re-build the same payload from a deep clone to prove identity is not
      // required — canonical equality is what matters.
      const replayed = await repo.saveOcrResultOnce(
        baseSubmission.job_id,
        clone(successResult),
      );
      assert.equal(replayed.persisted_at, first.persisted_at);
      assert.deepEqual(replayed.result, first.result);
      const list = await repo.listOcrResults(baseSubmission.job_id);
      assert.equal(list.length, 1);
    });
  });

  T("saveOcrResultOnce: conflicting duplicate (same page_id, different payload) is rejected", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await repo.saveOcrResultOnce(baseSubmission.job_id, successResult);
      const tampered = clone(successResult);
      // Mutate a contract payload field that is NOT linkage. This forces the
      // conflict to land in the equality check, not the linkage gauntlet.
      tampered.raw_text = `${tampered.raw_text}_DRIFT`;
      await assert.rejects(
        () => repo.saveOcrResultOnce(baseSubmission.job_id, tampered),
        (err) =>
          err instanceof OcrPersistenceError &&
          /conflicting duplicate/i.test(err.message),
      );
      const list = await repo.listOcrResults(baseSubmission.job_id);
      assert.equal(list.length, 1);
      assert.equal(list[0].result.raw_text, successResult.raw_text);
    });
  });

  T("saveOcrResultOnce: linkage checks run BEFORE the duplicate-vs-replay decision", async () => {
    await withImpl(async (repo) => {
      await repo.createOcrJob(baseSubmission);
      await repo.saveOcrResultOnce(baseSubmission.job_id, successResult);
      // Tamper tenant_id. Because the row already exists for this page_id, a
      // naive impl that checked duplicates first would surface
      // "conflicting duplicate". The contract requires the specific tenant
      // mismatch error so the operator can tell tampered linkage apart from
      // a benign payload drift.
      const tampered = clone(successResult);
      tampered.tenant_id = bumpUlidTail(tampered.tenant_id, "ee9999");
      await assert.rejects(
        () => repo.saveOcrResultOnce(baseSubmission.job_id, tampered),
        (err) =>
          err instanceof OcrPersistenceError &&
          /tenant_id mismatch/.test(err.message),
      );
    });
  });

  T("saveOcrResultOnce: rejects unknown job", async () => {
    await withImpl(async (repo) => {
      await assert.rejects(
        () => repo.saveOcrResultOnce(successResult.job_id, successResult),
        (err) =>
          err instanceof OcrPersistenceError && /unknown job/.test(err.message),
      );
    });
  });

  T("saveOcrResultOnce: rejects page_id not in submission.pages", async () => {
    await withImpl(async (repo) => {
      const oneSub = clone(rawBaseSubmission);
      await repo.createOcrJob(oneSub);
      await assert.rejects(
        () => repo.saveOcrResultOnce(oneSub.job_id, failureResult),
        (err) =>
          err instanceof OcrPersistenceError &&
          /page_id .* is not present in submission\.pages/.test(err.message),
      );
    });
  });

  // =====================================================================
  // adapter-driven end-to-end replay (the redelivery boundary)
  // =====================================================================

  T("end-to-end replay: full adapter outcome can be re-applied via *Once methods as a no-op", async () => {
    await withImpl(async (repo) => {
      const adapter = new OcrJobAdapter({ backend: new InMemoryOcrQueue() });
      await repo.createOcrJob(baseSubmission);
      await adapter.enqueueOcrJob(baseSubmission, {
        scenario: "transient_then_success",
      });
      const out = await adapter.processNextOcrJob();
      assert.ok(out);

      for (const t of out.outcome.statuses) {
        await repo.appendOcrStatusOnce(baseSubmission.job_id, t);
      }
      for (const r of out.outcome.results) {
        await repo.saveOcrResultOnce(baseSubmission.job_id, r);
      }
      const beforeStatuses = await repo.listOcrJobStatuses(baseSubmission.job_id);
      const beforeResults = await repo.listOcrResults(baseSubmission.job_id);

      // Replay the entire outcome — must be idempotent.
      for (const t of out.outcome.statuses) {
        await repo.appendOcrStatusOnce(baseSubmission.job_id, t);
      }
      for (const r of out.outcome.results) {
        await repo.saveOcrResultOnce(baseSubmission.job_id, r);
      }
      const afterStatuses = await repo.listOcrJobStatuses(baseSubmission.job_id);
      const afterResults = await repo.listOcrResults(baseSubmission.job_id);

      assert.equal(afterStatuses.length, beforeStatuses.length);
      assert.equal(afterResults.length, beforeResults.length);
      assert.deepEqual(
        afterStatuses.map((e) => e.seq),
        beforeStatuses.map((e) => e.seq),
      );
      assert.deepEqual(
        afterStatuses.map((e) => e.persisted_at),
        beforeStatuses.map((e) => e.persisted_at),
      );
      assert.deepEqual(
        afterResults.map((r) => r.persisted_at),
        beforeResults.map((r) => r.persisted_at),
      );
    });
  });

  T("end-to-end replay: redelivery with a conflicting result for a stored page_id is rejected", async () => {
    await withImpl(async (repo) => {
      const adapter = new OcrJobAdapter({ backend: new InMemoryOcrQueue() });
      await repo.createOcrJob(baseSubmission);
      await adapter.enqueueOcrJob(baseSubmission, {
        scenario: "transient_then_success",
      });
      const out = await adapter.processNextOcrJob();
      assert.ok(out);

      for (const t of out.outcome.statuses) {
        await repo.appendOcrStatusOnce(baseSubmission.job_id, t);
      }
      for (const r of out.outcome.results) {
        await repo.saveOcrResultOnce(baseSubmission.job_id, r);
      }

      // Mutate one of the persisted results' payload (non-linkage field) and
      // try to re-apply. Replay-safe MUST reject. processing_duration_ms is
      // present on every contract result fixture; bumping it stays inside
      // OcrResult validation while breaking canonical equality.
      const drifted = clone(out.outcome.results[0]);
      drifted.page_metrics = {
        ...drifted.page_metrics,
        processing_duration_ms:
          (drifted.page_metrics?.processing_duration_ms ?? 0) + 1,
      };
      await assert.rejects(
        () => repo.saveOcrResultOnce(baseSubmission.job_id, drifted),
        (err) =>
          err instanceof OcrPersistenceError &&
          /conflicting duplicate/i.test(err.message),
      );
    });
  });
}
