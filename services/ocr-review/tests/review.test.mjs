// Read-model tests. The read model derives lawyer-facing review state
// from OcrPersistence; these tests exercise it through the same path
// production callers use (persistence -> read model) plus a few end-to-end
// flows via the queue adapter / fake worker / ingestion orchestrator.
//
// Step 8A scope: single-job-id-scoped derivations only. Cross-job APIs are
// out of scope and not tested here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  getOcrJobLifecycle,
  getReviewableOcrPage,
  summarizeOcrIngestionOutcome,
  TEXT_PREVIEW_MAX_CHARS,
} from "../dist/index.js";
import { InMemoryOcrPersistence } from "ocr-persistence";
import { OcrJobAdapter, InMemoryOcrQueue } from "ocr-worker-adapter";
import { ingestDocumentForOcr } from "ocr-ingestion";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

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

// Two-page submission (p01 + p04) so failureResult.page_id (p04) is a
// member of submission.pages — persistence binding requires this.
function makeTwoPageSubmission() {
  const sub = JSON.parse(JSON.stringify(rawSubmission));
  const p1 = sub.pages[0];
  const p4 = JSON.parse(JSON.stringify(p1));
  p4.page_id = failureResult.page_id; // ...p04
  p4.page_number = failureResult.page_number; // 4
  p4.source = { ...p4.source, key: p4.source.key.replace("page-001", "page-004") };
  sub.pages = [p1, p4];
  return sub;
}

function makeRepo() {
  let tick = 0;
  return new InMemoryOcrPersistence({
    now: () => new Date(Date.UTC(2030, 0, 1, 0, 0, tick++)),
  });
}

// Snapshot helper: capture current persistence state to assert read-model
// calls do not mutate it.
async function snapshot(repo, jobId) {
  return {
    job: await repo.getOcrJob(jobId),
    statuses: await repo.listOcrJobStatuses(jobId),
    results: await repo.listOcrResults(jobId),
  };
}

// ---------------------------------------------------------------------------
// getOcrJobLifecycle
// ---------------------------------------------------------------------------

test("getOcrJobLifecycle: missing job returns null", async () => {
  const repo = makeRepo();
  const out = await getOcrJobLifecycle(repo, "01jrk8m4q4xv2v8d4d4ymf5p99");
  assert.equal(out, null);
});

test("getOcrJobLifecycle: job with no statuses yet -> current_state undefined, is_terminal false, terminal_state undefined", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  const out = await getOcrJobLifecycle(repo, rawSubmission.job_id);
  assert.ok(out);
  assert.equal(out.current_state, undefined);
  assert.equal(out.is_terminal, false);
  assert.equal(out.terminal_state, undefined);
  assert.equal(out.statuses.length, 0);
  assert.equal(out.results.length, 0);
  assert.equal(out.job.job_id, rawSubmission.job_id);
});

test("getOcrJobLifecycle: in-flight (claimed but not finished) -> current_state='claimed', is_terminal false, terminal_state undefined", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  await repo.appendOcrStatus(rawSubmission.job_id, {
    from: "queued", to: "claimed", controlled_by: "queue",
    at: "2030-01-01T00:00:01.000Z",
  });
  const out = await getOcrJobLifecycle(repo, rawSubmission.job_id);
  assert.equal(out.current_state, "claimed");
  assert.equal(out.is_terminal, false);
  assert.equal(out.terminal_state, undefined,
    "terminal_state must NOT mirror non-terminal current_state");
});

test("getOcrJobLifecycle: succeeded job -> current_state and terminal_state both 'succeeded'", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  for (const t of [
    { from: "queued", to: "claimed", controlled_by: "queue", at: "2030-01-01T00:00:01.000Z" },
    { from: "claimed", to: "processing", controlled_by: "worker", at: "2030-01-01T00:00:02.000Z" },
    { from: "processing", to: "succeeded", controlled_by: "worker", at: "2030-01-01T00:00:03.000Z" },
  ]) await repo.appendOcrStatus(rawSubmission.job_id, t);
  const out = await getOcrJobLifecycle(repo, rawSubmission.job_id);
  assert.equal(out.current_state, "succeeded");
  assert.equal(out.is_terminal, true);
  assert.equal(out.terminal_state, "succeeded");
  assert.equal(out.statuses.length, 3);
});

test("getOcrJobLifecycle: read-model call does not mutate persistence state", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  await repo.appendOcrStatus(rawSubmission.job_id, {
    from: "queued", to: "claimed", controlled_by: "queue",
    at: "2030-01-01T00:00:01.000Z",
  });
  const before = await snapshot(repo, rawSubmission.job_id);
  const view = await getOcrJobLifecycle(repo, rawSubmission.job_id);
  // Tamper with the view to be doubly sure cloning at the persistence
  // boundary holds — the persistence layer already returns clones, but
  // we want to fail loudly if anyone breaks that.
  view.statuses.length = 0;
  view.job.terminal_state = "dead_lettered";
  const after = await snapshot(repo, rawSubmission.job_id);
  assert.deepEqual(after, before, "read-model must not mutate persistence state");
});

// ---------------------------------------------------------------------------
// getReviewableOcrPage
// ---------------------------------------------------------------------------

test("getReviewableOcrPage: missing job returns null", async () => {
  const repo = makeRepo();
  const out = await getReviewableOcrPage(repo, {
    job_id: "01jrk8m4q4xv2v8d4d4ymf5p99",
    page_id: successResult.page_id,
  });
  assert.equal(out, null);
});

test("getReviewableOcrPage: missing result for an existing job returns null (pending page)", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  const out = await getReviewableOcrPage(repo, {
    job_id: rawSubmission.job_id,
    page_id: successResult.page_id,
  });
  assert.equal(out, null);
});

test("getReviewableOcrPage: succeeded page returns identity, raw_text, text_preview, manual review fields, seal/table digests", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  await repo.saveOcrResult(rawSubmission.job_id, successResult);
  const v = await getReviewableOcrPage(repo, {
    job_id: rawSubmission.job_id,
    page_id: successResult.page_id,
  });
  assert.ok(v);
  // Identity
  assert.equal(v.job_id, rawSubmission.job_id);
  assert.equal(v.tenant_id, rawSubmission.tenant_id);
  assert.equal(v.case_id, rawSubmission.case_id);
  assert.equal(v.document_id, rawSubmission.document_id);
  assert.equal(v.document_revision, rawSubmission.document_revision);
  assert.equal(v.page_id, successResult.page_id);
  assert.equal(v.page_number, successResult.page_number);
  // Outcome
  assert.equal(v.outcome, "succeeded");
  // Text
  assert.equal(v.raw_text, successResult.raw_text ?? "");
  assert.ok(v.text_preview.length <= TEXT_PREVIEW_MAX_CHARS);
  assert.equal(v.text_preview, v.raw_text.slice(0, TEXT_PREVIEW_MAX_CHARS));
  // Manual review — read verbatim, not recomputed
  assert.equal(
    v.manual_review_recommended,
    successResult.review?.manual_review_recommended === true,
  );
  assert.deepEqual(
    [...v.manual_review_reasons],
    [...(successResult.review?.reasons ?? [])],
  );
  // Seal / table digests
  const expectedSeals = (successResult.blocks ?? []).filter((b) => b.type === "seal");
  const expectedTables = (successResult.blocks ?? []).filter((b) => b.type === "table");
  assert.equal(v.detected_seals.count, expectedSeals.length);
  assert.deepEqual(
    [...v.detected_seals.block_ids],
    expectedSeals.map((b) => b.block_id),
  );
  assert.equal(v.detected_tables.count, expectedTables.length);
  // Failed-only field is null on succeeded
  assert.equal(v.partial_failure, null);
});

test("getReviewableOcrPage: text_preview truncates at TEXT_PREVIEW_MAX_CHARS for long raw_text", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  // Build a long-text successResult clone bound to the existing submission's
  // page. We deep-clone to avoid mutating shared fixture state.
  const long = JSON.parse(JSON.stringify(successResult));
  long.raw_text = "X".repeat(TEXT_PREVIEW_MAX_CHARS + 250);
  await repo.saveOcrResult(rawSubmission.job_id, long);
  const v = await getReviewableOcrPage(repo, {
    job_id: rawSubmission.job_id,
    page_id: successResult.page_id,
  });
  assert.equal(v.raw_text.length, TEXT_PREVIEW_MAX_CHARS + 250);
  assert.equal(v.text_preview.length, TEXT_PREVIEW_MAX_CHARS);
});

test("getReviewableOcrPage: manual_review_recommended uses result.review verbatim, not a recomputed threshold", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  const tampered = JSON.parse(JSON.stringify(successResult));
  // Force-set the verdict to true with confidence numbers that no
  // sane threshold would flag — proving the read model trusts the field.
  tampered.review = {
    manual_review_recommended: true,
    reasons: ["seal_overlap"],
    page_confidence_summary: { mean: 0.99, median: 0.99, min: 0.95 },
  };
  await repo.saveOcrResult(rawSubmission.job_id, tampered);
  const v = await getReviewableOcrPage(repo, {
    job_id: rawSubmission.job_id,
    page_id: successResult.page_id,
  });
  assert.equal(v.manual_review_recommended, true);
  assert.deepEqual([...v.manual_review_reasons], ["seal_overlap"]);
});

test("getReviewableOcrPage: failed page exposes partial_failure digest and outcome='failed'", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(makeTwoPageSubmission());
  await repo.saveOcrResult(rawSubmission.job_id, failureResult);
  const v = await getReviewableOcrPage(repo, {
    job_id: rawSubmission.job_id,
    page_id: failureResult.page_id,
  });
  assert.ok(v);
  assert.equal(v.outcome, "failed");
  assert.ok(v.partial_failure, "failed result must carry partial_failure digest");
  assert.equal(v.partial_failure.code, failureResult.partial_failure.code);
  assert.equal(v.partial_failure.is_transient, failureResult.partial_failure.is_transient);
  assert.equal(v.partial_failure.attempted_count, failureResult.partial_failure.attempted_count);
});

test("getReviewableOcrPage: evidence_index reflects metadata.client_tags signal only (no heuristic)", async () => {
  // (a) Neither submission nor result carries the explicit tag -> source: "none".
  const repoA = makeRepo();
  const sub = JSON.parse(JSON.stringify(rawSubmission));
  sub.metadata = { ...sub.metadata, client_tags: ["unrelated-tag"] };
  await repoA.createOcrJob(sub);
  // The shipped successResult fixture carries client_tags including
  // "evidence-index". Strip it so neither side carries the marker.
  const stripped = JSON.parse(JSON.stringify(successResult));
  stripped.metadata = { ...stripped.metadata, client_tags: ["unrelated-tag"] };
  await repoA.saveOcrResult(sub.job_id, stripped);
  const a = await getReviewableOcrPage(repoA, {
    job_id: sub.job_id,
    page_id: successResult.page_id,
  });
  assert.deepEqual(a.evidence_index, { source: "none", present: false });

  // (b) Submission carries the explicit "evidence-index" tag -> present
  // (regardless of whether the result-side tag is stripped).
  const repoB = makeRepo();
  const sub2 = JSON.parse(JSON.stringify(rawSubmission));
  sub2.metadata = { ...sub2.metadata, client_tags: ["evidence-index"] };
  await repoB.createOcrJob(sub2);
  const stripped2 = JSON.parse(JSON.stringify(successResult));
  stripped2.metadata = { ...stripped2.metadata, client_tags: ["unrelated-tag"] };
  await repoB.saveOcrResult(sub2.job_id, stripped2);
  const b = await getReviewableOcrPage(repoB, {
    job_id: sub2.job_id,
    page_id: successResult.page_id,
  });
  assert.deepEqual(b.evidence_index, { source: "metadata.client_tags", present: true });

  // (c) Result-side tag alone is also accepted as the signal carrier.
  const repoC = makeRepo();
  const sub3 = JSON.parse(JSON.stringify(rawSubmission));
  sub3.metadata = { ...sub3.metadata, client_tags: ["unrelated-tag"] };
  await repoC.createOcrJob(sub3);
  // successResult fixture already carries "evidence-index" in its metadata.
  await repoC.saveOcrResult(sub3.job_id, successResult);
  const c = await getReviewableOcrPage(repoC, {
    job_id: sub3.job_id,
    page_id: successResult.page_id,
  });
  assert.deepEqual(c.evidence_index, { source: "metadata.client_tags", present: true });
});

test("getReviewableOcrPage: read-model call does not mutate persistence state", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  await repo.saveOcrResult(rawSubmission.job_id, successResult);
  const before = await snapshot(repo, rawSubmission.job_id);
  const v = await getReviewableOcrPage(repo, {
    job_id: rawSubmission.job_id,
    page_id: successResult.page_id,
  });
  v.raw_text = "TAMPERED";
  v.detected_tables.block_ids = ["TAMPERED"];
  const after = await snapshot(repo, rawSubmission.job_id);
  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------------
// summarizeOcrIngestionOutcome
// ---------------------------------------------------------------------------

test("summarizeOcrIngestionOutcome: missing job returns null", async () => {
  const repo = makeRepo();
  const out = await summarizeOcrIngestionOutcome(repo, "01jrk8m4q4xv2v8d4d4ymf5p99");
  assert.equal(out, null);
});

test("summarizeOcrIngestionOutcome: created-but-untouched job -> all pages pending, retry_count 0, dead_lettered false", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  const s = await summarizeOcrIngestionOutcome(repo, rawSubmission.job_id);
  assert.equal(s.total_pages, 1);
  assert.equal(s.succeeded_pages, 0);
  assert.equal(s.failed_pages, 0);
  assert.equal(s.pending_pages, 1);
  assert.deepEqual([...s.pending_page_ids], [rawSubmission.pages[0].page_id]);
  assert.equal(s.retry_count, 0);
  assert.equal(s.dead_lettered, false);
  assert.equal(s.current_state, undefined);
  assert.equal(s.is_terminal, false);
  assert.equal(s.terminal_state, undefined);
});

test("summarizeOcrIngestionOutcome: end-to-end success scenario via ingestion -> 1 succeeded, 0 failed, terminal_state succeeded", async () => {
  const persistence = new InMemoryOcrPersistence();
  const queueAdapter = new OcrJobAdapter({ backend: new InMemoryOcrQueue() });
  const out = await ingestDocumentForOcr(
    {
      tenant_id: "01jrk8m4q4xv2v8d4d4ymf5tnt",
      case_id: "01jrk8m4q4xv2v8d4d4ymf5cas",
      document_id: "01jrk8m4q4xv2v8d4d4ymf5doc",
      document_revision: 3,
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
      metadata: { trace_id: "t" },
    },
    { persistence, queueAdapter },
  );
  const s = await summarizeOcrIngestionOutcome(persistence, out.job.job_id);
  assert.equal(s.terminal_state, "succeeded");
  assert.equal(s.is_terminal, true);
  assert.equal(s.dead_lettered, false);
  assert.equal(s.retry_count, 0);
  assert.equal(s.total_pages, 1);
  assert.equal(s.succeeded_pages, 1);
  assert.equal(s.failed_pages, 0);
  assert.equal(s.pending_pages, 0);
  assert.deepEqual([...s.failed_page_ids], []);
  assert.deepEqual([...s.pending_page_ids], []);
});

test("summarizeOcrIngestionOutcome: partial_failure scenario via ingestion -> mixed succeeded/failed page counts and ids", async () => {
  const persistence = new InMemoryOcrPersistence();
  const queueAdapter = new OcrJobAdapter({ backend: new InMemoryOcrQueue() });
  const out = await ingestDocumentForOcr(
    {
      tenant_id: "01jrk8m4q4xv2v8d4d4ymf5tnt",
      document_id: "01jrk8m4q4xv2v8d4d4ymf5doc",
      submitted_by: "user_01jrk8m4q4xv2v8d4d4ymf5usr",
      pages: [
        {
          page_id: "01jrk8m4q4xv2v8d4d4ymf5p01",
          page_number: 1,
          source: {
            kind: "s3", bucket: "b", key: "tenant/01jrk/doc/01jrk/page-001.png",
            byte_size: 1, mime_type: "image/png",
          },
        },
        {
          page_id: "01jrk8m4q4xv2v8d4d4ymf5p02",
          page_number: 2,
          source: {
            kind: "s3", bucket: "b", key: "tenant/01jrk/doc/01jrk/page-002.png",
            byte_size: 1, mime_type: "image/png",
          },
        },
      ],
    },
    { persistence, queueAdapter, scenario: "partial_failure" },
  );
  const s = await summarizeOcrIngestionOutcome(persistence, out.job.job_id);
  assert.equal(s.total_pages, 2);
  assert.equal(s.succeeded_pages, 1);
  assert.equal(s.failed_pages, 1);
  assert.equal(s.pending_pages, 0);
  assert.deepEqual([...s.failed_page_ids], ["01jrk8m4q4xv2v8d4d4ymf5p02"]);
  assert.equal(s.terminal_state, "partial_succeeded");
  assert.equal(s.dead_lettered, false);
});

test("summarizeOcrIngestionOutcome: permanent_failure scenario -> dead_lettered true, retry_count 0", async () => {
  const persistence = new InMemoryOcrPersistence();
  const queueAdapter = new OcrJobAdapter({ backend: new InMemoryOcrQueue() });
  const out = await ingestDocumentForOcr(
    {
      tenant_id: "01jrk8m4q4xv2v8d4d4ymf5tnt",
      document_id: "01jrk8m4q4xv2v8d4d4ymf5doc",
      submitted_by: "user_01jrk8m4q4xv2v8d4d4ymf5usr",
      pages: [
        {
          page_id: "01jrk8m4q4xv2v8d4d4ymf5p01",
          page_number: 1,
          source: {
            kind: "s3", bucket: "b", key: "k/page-001.png",
            byte_size: 1, mime_type: "image/png",
          },
        },
      ],
    },
    { persistence, queueAdapter, scenario: "permanent_failure" },
  );
  const s = await summarizeOcrIngestionOutcome(persistence, out.job.job_id);
  assert.equal(s.dead_lettered, true);
  assert.equal(s.terminal_state, "dead_lettered");
  assert.equal(s.retry_count, 0);
  assert.equal(s.failed_pages, 1);
  assert.equal(s.succeeded_pages, 0);
});

test("summarizeOcrIngestionOutcome: transient_then_success preserves retry_count >= 1 and terminal_state succeeded", async () => {
  const persistence = new InMemoryOcrPersistence();
  const queueAdapter = new OcrJobAdapter({ backend: new InMemoryOcrQueue() });
  const out = await ingestDocumentForOcr(
    {
      tenant_id: "01jrk8m4q4xv2v8d4d4ymf5tnt",
      document_id: "01jrk8m4q4xv2v8d4d4ymf5doc",
      submitted_by: "user_01jrk8m4q4xv2v8d4d4ymf5usr",
      pages: [
        {
          page_id: "01jrk8m4q4xv2v8d4d4ymf5p01",
          page_number: 1,
          source: {
            kind: "s3", bucket: "b", key: "k/page-001.png",
            byte_size: 1, mime_type: "image/png",
          },
        },
      ],
    },
    { persistence, queueAdapter, scenario: "transient_then_success" },
  );
  const s = await summarizeOcrIngestionOutcome(persistence, out.job.job_id);
  assert.equal(s.terminal_state, "succeeded");
  assert.equal(s.dead_lettered, false);
  assert.ok(s.retry_count >= 1, `expected retry_count >= 1, got ${s.retry_count}`);
  assert.equal(s.succeeded_pages, 1);
});

test("summarizeOcrIngestionOutcome: pages_needing_manual_review counts results whose review.manual_review_recommended is true", async () => {
  const repo = makeRepo();
  const sub = makeTwoPageSubmission();
  await repo.createOcrJob(sub);
  // page p01 (success) — recommend review.
  const r1 = JSON.parse(JSON.stringify(successResult));
  r1.review = { manual_review_recommended: true, reasons: ["seal_overlap"] };
  await repo.saveOcrResult(sub.job_id, r1);
  // page p04 (fail) — review usually n/a; leave as-is.
  await repo.saveOcrResult(sub.job_id, failureResult);
  const s = await summarizeOcrIngestionOutcome(repo, sub.job_id);
  assert.equal(s.pages_needing_manual_review, 1);
});

test("summarizeOcrIngestionOutcome: read-model call does not mutate persistence state", async () => {
  const repo = makeRepo();
  await repo.createOcrJob(rawSubmission);
  await repo.appendOcrStatus(rawSubmission.job_id, {
    from: "queued", to: "claimed", controlled_by: "queue",
    at: "2030-01-01T00:00:01.000Z",
  });
  const before = await snapshot(repo, rawSubmission.job_id);
  const s = await summarizeOcrIngestionOutcome(repo, rawSubmission.job_id);
  s.failed_page_ids.push?.("TAMPERED");
  const after = await snapshot(repo, rawSubmission.job_id);
  assert.deepEqual(after, before);
});
