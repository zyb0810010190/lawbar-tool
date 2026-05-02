// Cross-job read APIs (Step 8B). Exercise listOcrJobsForDocument and
// listPagesNeedingManualReview through the same path production callers
// take: review layer -> persistence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  listOcrJobsForDocument,
  listPagesNeedingManualReview,
} from "../dist/index.js";
import { InMemoryOcrPersistence } from "ocr-persistence";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(
  here,
  "..",
  "node_modules",
  "ocr-worker-contract",
  "fixtures",
  "valid",
);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const rawSubmission = readJson(join(fixtureDir, "submission-s3.json"));
const successResult = readJson(join(fixtureDir, "result-chinese-litigation.json"));
const failureResult = readJson(join(fixtureDir, "result-partial-failure.json"));

const clone = (o) => JSON.parse(JSON.stringify(o));

function bumpUlidTail(ulid, suffix) {
  const tail = String(suffix).padStart(6, "0").toLowerCase();
  return ulid.slice(0, ulid.length - tail.length) + tail;
}

function makeJob({
  jobIdSuffix = "0001",
  tenantTail,
  documentTail,
  caseTail,
  documentRevision,
  pages,
  metadataTags,
}) {
  const sub = clone(rawSubmission);
  sub.job_id = bumpUlidTail(sub.job_id, jobIdSuffix);
  if (tenantTail !== undefined) sub.tenant_id = bumpUlidTail(sub.tenant_id, tenantTail);
  if (documentTail !== undefined) sub.document_id = bumpUlidTail(sub.document_id, documentTail);
  if (caseTail !== undefined) sub.case_id = bumpUlidTail(sub.case_id, caseTail);
  if (documentRevision !== undefined) sub.document_revision = documentRevision;
  if (metadataTags) sub.metadata = { ...sub.metadata, client_tags: metadataTags };
  if (pages) {
    const p1 = sub.pages[0];
    sub.pages = pages.map(({ idSuffix, page_number }) => {
      const p = clone(p1);
      p.page_id = bumpUlidTail(p1.page_id, idSuffix);
      p.page_number = page_number;
      p.source = {
        ...p.source,
        key: p.source.key.replace(
          "page-001",
          `page-${String(page_number).padStart(3, "0")}`,
        ),
      };
      return p;
    });
  }
  return sub;
}

function makeResult({
  base,
  jobIdSuffix,
  tenantTail,
  documentTail,
  documentRevision,
  pageIdSuffix,
  pageNumber,
  manualReview,
}) {
  const r = clone(base);
  r.job_id = bumpUlidTail(rawSubmission.job_id, jobIdSuffix);
  if (tenantTail !== undefined) r.tenant_id = bumpUlidTail(rawSubmission.tenant_id, tenantTail);
  if (documentTail !== undefined) r.document_id = bumpUlidTail(rawSubmission.document_id, documentTail);
  if (documentRevision !== undefined) r.document_revision = documentRevision;
  if (pageIdSuffix !== undefined) r.page_id = bumpUlidTail(rawSubmission.pages[0].page_id, pageIdSuffix);
  if (pageNumber !== undefined) r.page_number = pageNumber;
  if (manualReview !== undefined) {
    r.review = {
      manual_review_recommended: manualReview,
      reasons: manualReview ? ["seal_overlap"] : [],
    };
  }
  return r;
}

function makeRepo() {
  let tick = 0;
  return new InMemoryOcrPersistence({
    now: () => new Date(Date.UTC(2030, 0, 1, 0, 0, tick++)),
  });
}

// ---------------------------------------------------------------------------
// listOcrJobsForDocument
// ---------------------------------------------------------------------------

test("listOcrJobsForDocument: empty document returns empty page", async () => {
  const repo = makeRepo();
  const out = await listOcrJobsForDocument(repo, {
    tenant_id: rawSubmission.tenant_id,
    document_id: rawSubmission.document_id,
  });
  assert.deepEqual(out.rows, []);
  assert.equal(out.next_cursor, null);
});

test("listOcrJobsForDocument: returns frozen summary rows with full field set", async () => {
  const repo = makeRepo();
  const sub = makeJob({
    jobIdSuffix: "fr0001",
    pages: [
      { idSuffix: "fa0001", page_number: 1 },
      { idSuffix: "fb0001", page_number: 2 },
    ],
  });
  await repo.createOcrJob(sub);
  await repo.appendOcrStatus(sub.job_id, {
    from: "queued", to: "claimed", controlled_by: "queue",
    at: "2030-01-01T00:00:01.000Z",
  });
  // Save 1 succeeded + 1 manual-review-flagged result. Leave nothing failed.
  await repo.saveOcrResult(
    sub.job_id,
    makeResult({
      base: successResult,
      jobIdSuffix: "fr0001",
      pageIdSuffix: "fa0001",
      pageNumber: 1,
      manualReview: true,
    }),
  );

  const out = await listOcrJobsForDocument(repo, {
    tenant_id: sub.tenant_id,
    document_id: sub.document_id,
  });
  assert.equal(out.rows.length, 1);
  const row = out.rows[0];
  // Identity
  assert.equal(row.job_id, sub.job_id);
  assert.equal(row.tenant_id, sub.tenant_id);
  assert.equal(row.case_id, sub.case_id);
  assert.equal(row.document_id, sub.document_id);
  assert.equal(row.document_revision, sub.document_revision);
  assert.equal(row.submitted_by, sub.submitted_by);
  assert.equal(typeof row.created_at, "string");
  // Lifecycle (from cache)
  assert.equal(row.current_state, "claimed");
  assert.equal(row.is_terminal, false);
  assert.equal(row.terminal_state, undefined);
  // Counts
  assert.equal(row.total_pages, 2);
  assert.equal(row.result_pages, 1);
  assert.equal(row.succeeded_pages, 1);
  assert.equal(row.failed_pages, 0);
  assert.equal(row.pending_pages, 1);
  assert.equal(row.manual_review_pages, 1);
  assert.deepEqual({ ...row.metadata }, { ...sub.metadata });

  // Frozen at runtime.
  assert.ok(Object.isFrozen(row), "summary row must be frozen");
  assert.throws(() => { row.total_pages = 99; });
});

test("listOcrJobsForDocument: terminal_state mirrors current_state when terminal", async () => {
  const repo = makeRepo();
  const sub = makeJob({ jobIdSuffix: "tr0001" });
  await repo.createOcrJob(sub);
  for (const t of [
    { from: "queued", to: "claimed", controlled_by: "queue", at: "2030-01-01T00:00:01.000Z" },
    { from: "claimed", to: "processing", controlled_by: "worker", at: "2030-01-01T00:00:02.000Z" },
    { from: "processing", to: "succeeded", controlled_by: "worker", at: "2030-01-01T00:00:03.000Z" },
  ]) await repo.appendOcrStatus(sub.job_id, t);

  const out = await listOcrJobsForDocument(repo, {
    tenant_id: sub.tenant_id,
    document_id: sub.document_id,
  });
  assert.equal(out.rows[0].current_state, "succeeded");
  assert.equal(out.rows[0].is_terminal, true);
  assert.equal(out.rows[0].terminal_state, "succeeded");
});

test("listOcrJobsForDocument: counts succeeded vs failed (both failed/cancelled count against)", async () => {
  const repo = makeRepo();
  const sub = makeJob({
    jobIdSuffix: "ct0001",
    pages: [
      { idSuffix: "ca0001", page_number: 1 },
      { idSuffix: "cb0001", page_number: 4 },
    ],
  });
  await repo.createOcrJob(sub);
  await repo.saveOcrResult(
    sub.job_id,
    makeResult({
      base: successResult,
      jobIdSuffix: "ct0001",
      pageIdSuffix: "ca0001",
      pageNumber: 1,
    }),
  );
  await repo.saveOcrResult(
    sub.job_id,
    makeResult({
      base: failureResult,
      jobIdSuffix: "ct0001",
      pageIdSuffix: "cb0001",
      pageNumber: 4,
    }),
  );
  const out = await listOcrJobsForDocument(repo, {
    tenant_id: sub.tenant_id,
    document_id: sub.document_id,
  });
  const row = out.rows[0];
  assert.equal(row.total_pages, 2);
  assert.equal(row.result_pages, 2);
  assert.equal(row.succeeded_pages, 1);
  assert.equal(row.failed_pages, 1);
  assert.equal(row.pending_pages, 0);
});

test("listOcrJobsForDocument: multiple reruns for same document appear as separate rows", async () => {
  const repo = makeRepo();
  const a = makeJob({ jobIdSuffix: "ra0001" });
  const b = makeJob({ jobIdSuffix: "rb0001" });
  // Same tenant_id + document_id (no overrides).
  await repo.createOcrJob(a);
  await repo.createOcrJob(b);
  const out = await listOcrJobsForDocument(repo, {
    tenant_id: a.tenant_id,
    document_id: a.document_id,
  });
  assert.equal(out.rows.length, 2);
  const ids = out.rows.map((r) => r.job_id).sort();
  assert.deepEqual(ids, [a.job_id, b.job_id].sort());
});

test("listOcrJobsForDocument: does NOT call listOcrJobStatuses (no status fan-out)", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(makeJob({ jobIdSuffix: "nf0001" }));
  // Wrap repo with a guard that throws if listOcrJobStatuses is called.
  const guarded = new Proxy(repo, {
    get(target, prop, recv) {
      if (prop === "listOcrJobStatuses") {
        return () => {
          throw new Error("listOcrJobStatuses must NOT be called by listOcrJobsForDocument");
        };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const out = await listOcrJobsForDocument(guarded, {
    tenant_id: rawSubmission.tenant_id,
    document_id: rawSubmission.document_id,
  });
  assert.equal(out.rows.length, 1);
});

test("listOcrJobsForDocument: passes the persistence cursor through unchanged", async () => {
  const repo = makeRepo();
  for (let i = 0; i < 4; i++) {
    await repo.createOcrJob(makeJob({ jobIdSuffix: `cp${i}001` }));
  }
  const persistencePage = await repo.listOcrJobsByDocument({
    tenant_id: rawSubmission.tenant_id,
    document_id: rawSubmission.document_id,
    limit: 2,
  });
  const reviewPage = await listOcrJobsForDocument(repo, {
    tenant_id: rawSubmission.tenant_id,
    document_id: rawSubmission.document_id,
    limit: 2,
  });
  assert.equal(reviewPage.next_cursor, persistencePage.next_cursor);
});

test("listOcrJobsForDocument: read does not mutate persistence state", async () => {
  const repo = makeRepo();
  const sub = makeJob({ jobIdSuffix: "ms0001" });
  await repo.createOcrJob(sub);
  const before = await repo.getOcrJob(sub.job_id);
  await listOcrJobsForDocument(repo, {
    tenant_id: sub.tenant_id,
    document_id: sub.document_id,
  });
  const after = await repo.getOcrJob(sub.job_id);
  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------------
// listPagesNeedingManualReview
// ---------------------------------------------------------------------------

test("listPagesNeedingManualReview: returns ReviewableOcrPage rows with manual_review verdict verbatim", async () => {
  const repo = makeRepo();
  const sub = makeJob({
    jobIdSuffix: "mv0001",
    pages: [
      { idSuffix: "ma0001", page_number: 1 },
      { idSuffix: "mb0001", page_number: 2 },
    ],
  });
  await repo.createOcrJob(sub);
  // Build a high-confidence success that the contract validator accepts but
  // whose review.manual_review_recommended is forced true. Read model must
  // surface the verbatim verdict, NOT recompute from confidence numbers.
  const result = makeResult({
    base: successResult,
    jobIdSuffix: "mv0001",
    pageIdSuffix: "ma0001",
    pageNumber: 1,
  });
  result.review = {
    manual_review_recommended: true,
    reasons: ["seal_overlap"],
    page_confidence_summary: { mean: 0.99, median: 0.99, min: 0.97 },
  };
  await repo.saveOcrResult(sub.job_id, result);

  const out = await listPagesNeedingManualReview(repo, {
    tenant_id: sub.tenant_id,
  });
  assert.equal(out.rows.length, 1);
  const v = out.rows[0];
  assert.equal(v.outcome, "succeeded");
  assert.equal(v.manual_review_recommended, true);
  assert.deepEqual([...v.manual_review_reasons], ["seal_overlap"]);
  assert.equal(v.page_id, sub.pages[0].page_id);
  assert.equal(v.document_revision, sub.document_revision);
});

test("listPagesNeedingManualReview: failed page flagged for review is included with outcome=failed", async () => {
  const repo = makeRepo();
  const sub = makeJob({
    jobIdSuffix: "fr0002",
    pages: [
      { idSuffix: "fa0002", page_number: 1 },
      { idSuffix: "fb0002", page_number: 4 },
    ],
  });
  await repo.createOcrJob(sub);
  const failed = makeResult({
    base: failureResult,
    jobIdSuffix: "fr0002",
    pageIdSuffix: "fb0002",
    pageNumber: 4,
    manualReview: true,
  });
  await repo.saveOcrResult(sub.job_id, failed);
  const out = await listPagesNeedingManualReview(repo, { tenant_id: sub.tenant_id });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].outcome, "failed");
  assert.equal(out.rows[0].manual_review_recommended, true);
  assert.ok(out.rows[0].partial_failure, "failed page must carry partial_failure digest");
});

test("listPagesNeedingManualReview: pages without manual_review verdict are excluded", async () => {
  const repo = makeRepo();
  const sub = makeJob({
    jobIdSuffix: "ex0001",
    pages: [
      { idSuffix: "ea0001", page_number: 1 },
      { idSuffix: "eb0001", page_number: 2 },
    ],
  });
  await repo.createOcrJob(sub);
  const ok = makeResult({
    base: successResult,
    jobIdSuffix: "ex0001",
    pageIdSuffix: "ea0001",
    pageNumber: 1,
    manualReview: false,
  });
  await repo.saveOcrResult(sub.job_id, ok);
  const out = await listPagesNeedingManualReview(repo, { tenant_id: sub.tenant_id });
  assert.deepEqual(out.rows, []);
});

test("listPagesNeedingManualReview: passes the persistence cursor through unchanged", async () => {
  const repo = makeRepo();
  const sub = makeJob({
    jobIdSuffix: "cu0001",
    pages: [
      { idSuffix: "cu0001", page_number: 1 },
      { idSuffix: "cu0002", page_number: 2 },
      { idSuffix: "cu0003", page_number: 3 },
    ],
  });
  await repo.createOcrJob(sub);
  for (let i = 0; i < 3; i++) {
    await repo.saveOcrResult(
      sub.job_id,
      makeResult({
        base: successResult,
        jobIdSuffix: "cu0001",
        pageIdSuffix: `cu000${i + 1}`,
        pageNumber: i + 1,
        manualReview: true,
      }),
    );
  }
  const p = await repo.listOcrReviewPageRows({
    tenant_id: sub.tenant_id,
    limit: 2,
  });
  const r = await listPagesNeedingManualReview(repo, {
    tenant_id: sub.tenant_id,
    limit: 2,
  });
  assert.equal(r.next_cursor, p.next_cursor);
});

test("listPagesNeedingManualReview: preserves persistence row order verbatim (no re-sort)", async () => {
  // Build joined rows whose persistence ordering is deterministic via the
  // monotonic clock (newest persisted_at first). Insert results in an order
  // that does NOT match the expected output, so the test would fail if the
  // review layer accidentally re-sorted on a different key (e.g. page_id).
  const repo = makeRepo();
  const subA = makeJob({
    jobIdSuffix: "ro0001",
    pages: [
      { idSuffix: "rz0001", page_number: 1 },
      { idSuffix: "rm0001", page_number: 2 },
    ],
  });
  const subB = makeJob({
    jobIdSuffix: "ro0002",
    pages: [{ idSuffix: "ra0001", page_number: 1 }],
  });
  await repo.createOcrJob(subA);
  await repo.createOcrJob(subB);

  // Save order (and thus persisted_at ascending): rz, ra, rm.
  // Persistence sort persisted_at DESC -> expected: rm, ra, rz.
  // page_id ASC would be: ra, rm, rz — which differs in the first two slots,
  // so the test catches accidental re-sort on page_id alone.
  await repo.saveOcrResult(
    subA.job_id,
    makeResult({
      base: successResult,
      jobIdSuffix: "ro0001",
      pageIdSuffix: "rz0001",
      pageNumber: 1,
      manualReview: true,
    }),
  );
  await repo.saveOcrResult(
    subB.job_id,
    makeResult({
      base: successResult,
      jobIdSuffix: "ro0002",
      pageIdSuffix: "ra0001",
      pageNumber: 1,
      manualReview: true,
    }),
  );
  await repo.saveOcrResult(
    subA.job_id,
    makeResult({
      base: successResult,
      jobIdSuffix: "ro0001",
      pageIdSuffix: "rm0001",
      pageNumber: 2,
      manualReview: true,
    }),
  );

  const persistencePage = await repo.listOcrReviewPageRows({
    tenant_id: subA.tenant_id,
  });
  const reviewPage = await listPagesNeedingManualReview(repo, {
    tenant_id: subA.tenant_id,
  });

  // Review layer must mirror persistence ordering one-to-one — no re-sort.
  const persistenceIds = persistencePage.rows.map((r) => r.result.result.page_id);
  const reviewIds = reviewPage.rows.map((r) => r.page_id);
  assert.deepEqual(reviewIds, persistenceIds);

  // Sanity check: the chosen ordering is NOT page_id ASC (the bug we'd
  // catch if the review layer accidentally re-sorted on page_id alone).
  const pageIdAsc = [...reviewIds].sort();
  assert.notDeepEqual(reviewIds, pageIdAsc, "test must not be page_id ASC by coincidence");
});

test("listPagesNeedingManualReview: read does not mutate persistence state", async () => {
  const repo = makeRepo();
  const sub = makeJob({
    jobIdSuffix: "nm0001",
    pages: [{ idSuffix: "nm0001", page_number: 1 }],
  });
  await repo.createOcrJob(sub);
  await repo.saveOcrResult(
    sub.job_id,
    makeResult({
      base: successResult,
      jobIdSuffix: "nm0001",
      pageIdSuffix: "nm0001",
      pageNumber: 1,
      manualReview: true,
    }),
  );
  const before = {
    job: await repo.getOcrJob(sub.job_id),
    statuses: await repo.listOcrJobStatuses(sub.job_id),
    results: await repo.listOcrResults(sub.job_id),
  };
  await listPagesNeedingManualReview(repo, { tenant_id: sub.tenant_id });
  const after = {
    job: await repo.getOcrJob(sub.job_id),
    statuses: await repo.listOcrJobStatuses(sub.job_id),
    results: await repo.listOcrResults(sub.job_id),
  };
  assert.deepEqual(after, before);
});
