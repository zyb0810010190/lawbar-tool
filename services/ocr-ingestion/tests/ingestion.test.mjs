// Ingestion-layer tests. The orchestrator wires together
//   ocr-worker-contract  (validators)
//   ocr-worker-adapter   (queue + fake worker)
//   ocr-persistence      (in-memory repository)
// with a domain-facing input shape. No real OCR, no Redis, no DB.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createOcrSubmissionFromDocument,
  ingestDocumentForOcr,
  IngestionError,
} from "../dist/index.js";
import {
  OcrJobAdapter,
  InMemoryOcrQueue,
} from "ocr-worker-adapter";
import {
  InMemoryOcrPersistence,
} from "ocr-persistence";
import {
  validateOcrSubmission,
} from "ocr-worker-contract";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = "01jrk8m4q4xv2v8d4d4ymf5tnt";
const CASE = "01jrk8m4q4xv2v8d4d4ymf5cas";
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

const baseInput = () => ({
  tenant_id: TENANT,
  case_id: CASE,
  document_id: DOCUMENT,
  document_revision: 3,
  submitted_by: "user_01jrk8m4q4xv2v8d4d4ymf5usr",
  pages: [
    { page_id: PAGE_1, page_number: 1, source: { ...sampleSource } },
  ],
  metadata: {
    trace_id: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    originating_request_id: "req_01jrk8m4",
    client_tags: ["evidence-index", "court-filing-2025-hu-min-12345"],
  },
});

// Deterministic environment: counter-based job_id (still 26 chars,
// satisfies the contract's relaxed ULID pattern) + fixed clock.
function makeEnv() {
  let n = 0;
  return {
    generateJobId: () => {
      const id = `job${String(++n).padStart(23, "0")}`;
      // Ensure it lands in [0-9a-z]{26}.
      return id.toLowerCase().padEnd(26, "0").slice(0, 26);
    },
    now: (() => {
      let t = 0;
      return () => new Date(Date.UTC(2030, 0, 1, 0, 0, t++));
    })(),
  };
}

function makeDeps(scenario) {
  const env = makeEnv();
  return {
    persistence: new InMemoryOcrPersistence({ now: env.now }),
    queueAdapter: new OcrJobAdapter({ backend: new InMemoryOcrQueue() }),
    scenario,
    generateJobId: env.generateJobId,
    now: env.now,
  };
}

// ---------------------------------------------------------------------------
// createOcrSubmissionFromDocument
// ---------------------------------------------------------------------------

test("createOcrSubmissionFromDocument: single-page document yields contract-valid submission", () => {
  const env = makeEnv();
  const sub = createOcrSubmissionFromDocument(baseInput(), env);
  const v = validateOcrSubmission(sub);
  assert.equal(v.ok, true, v.ok ? "" : v.summary);
  assert.equal(sub.tenant_id, TENANT);
  assert.equal(sub.case_id, CASE);
  assert.equal(sub.document_id, DOCUMENT);
  assert.equal(sub.document_revision, 3);
  assert.equal(sub.pages.length, 1);
  assert.equal(sub.pages[0].page_id, PAGE_1);
  // Defaults landed.
  assert.equal(sub.priority, 50);
  assert.equal(sub.contract_version, "1.0.0");
  assert.equal(sub.retry.max_attempts, 3);
  assert.equal(sub.rerun.is_rerun, false);
});

test("createOcrSubmissionFromDocument: multi-page document yields contract-valid submission", () => {
  const env = makeEnv();
  const input = baseInput();
  input.pages = [
    { page_id: PAGE_1, page_number: 1, source: { ...sampleSource } },
    {
      page_id: PAGE_2,
      page_number: 2,
      source: {
        kind: "https",
        url: "https://example.test/doc/page-2.png",
        byte_size: 2_000_000,
        mime_type: "image/png",
      },
    },
  ];
  const sub = createOcrSubmissionFromDocument(input, env);
  const v = validateOcrSubmission(sub);
  assert.equal(v.ok, true, v.ok ? "" : v.summary);
  assert.equal(sub.pages.length, 2);
  assert.deepEqual(
    sub.pages.map((p) => p.page_number),
    [1, 2],
  );
  assert.deepEqual(
    sub.pages.map((p) => p.source.kind),
    ["s3", "https"],
  );
});

test("createOcrSubmissionFromDocument: missing tenant_id throws IngestionError", () => {
  const env = makeEnv();
  const input = baseInput();
  delete input.tenant_id;
  assert.throws(
    () => createOcrSubmissionFromDocument(input, env),
    (err) => err instanceof IngestionError && /tenant_id/.test(err.message),
  );
});

test("createOcrSubmissionFromDocument: missing document_id throws IngestionError", () => {
  const env = makeEnv();
  const input = baseInput();
  delete input.document_id;
  assert.throws(
    () => createOcrSubmissionFromDocument(input, env),
    (err) => err instanceof IngestionError && /document_id/.test(err.message),
  );
});

test("createOcrSubmissionFromDocument: empty pages throws IngestionError", () => {
  const env = makeEnv();
  const input = baseInput();
  input.pages = [];
  assert.throws(
    () => createOcrSubmissionFromDocument(input, env),
    (err) => err instanceof IngestionError && /page/.test(err.message),
  );
});

test("createOcrSubmissionFromDocument: missing page identity throws IngestionError", () => {
  const env = makeEnv();
  const input = baseInput();
  input.pages = [{ page_number: 1, source: { ...sampleSource } }];
  assert.throws(
    () => createOcrSubmissionFromDocument(input, env),
    (err) => err instanceof IngestionError && /page_id/.test(err.message),
  );
});

test("createOcrSubmissionFromDocument: round-trips opaque metadata verbatim", () => {
  const env = makeEnv();
  const input = baseInput();
  input.metadata = {
    trace_id: "trace-abc",
    court_filing: { jurisdiction: "shanghai-pudong-court", docket: "(2025)沪0115民初12345号" },
    nested: { a: 1, b: [true, null, "x"] },
  };
  const sub = createOcrSubmissionFromDocument(input, env);
  assert.deepEqual(sub.metadata, input.metadata);
});

test("createOcrSubmissionFromDocument: defaults document_revision to 1 when omitted", () => {
  const env = makeEnv();
  const input = baseInput();
  delete input.document_revision;
  const sub = createOcrSubmissionFromDocument(input, env);
  assert.equal(sub.document_revision, 1);
});

test("createOcrSubmissionFromDocument: omits case_id when caller omits it", () => {
  const env = makeEnv();
  const input = baseInput();
  delete input.case_id;
  const sub = createOcrSubmissionFromDocument(input, env);
  assert.equal(sub.case_id, undefined);
  // Still contract-valid (case_id is optional in the contract).
  const v = validateOcrSubmission(sub);
  assert.equal(v.ok, true, v.ok ? "" : v.summary);
});

// ---------------------------------------------------------------------------
// Shared-default isolation (regression for audit High: shared mutable defaults)
// ---------------------------------------------------------------------------

test("createOcrSubmissionFromDocument: subsequent calls do not share retry/preprocessing/languages references", () => {
  const env = makeEnv();
  const a = createOcrSubmissionFromDocument(baseInput(), env);
  const b = createOcrSubmissionFromDocument(baseInput(), env);
  assert.notEqual(a.retry, b.retry, "retry must not be shared between submissions");
  assert.notEqual(a.preprocessing, b.preprocessing, "preprocessing must not be shared");
  assert.notEqual(
    a.ocr_options.languages,
    b.ocr_options.languages,
    "ocr_options.languages must not be shared",
  );
});

test("createOcrSubmissionFromDocument: mutating one submission's defaults does not affect a later submission", () => {
  const env = makeEnv();
  const a = createOcrSubmissionFromDocument(baseInput(), env);
  // Tamper with every field that previously aliased a module-level default.
  a.retry.max_attempts = 99;
  a.preprocessing.deskew = "off";
  a.ocr_options.languages.push("ja");

  const b = createOcrSubmissionFromDocument(baseInput(), env);
  assert.equal(b.retry.max_attempts, 3, "retry default leaked from prior submission");
  assert.equal(b.preprocessing.deskew, "auto", "preprocessing default leaked from prior submission");
  assert.deepEqual(
    b.ocr_options.languages,
    ["zh-Hans", "en"],
    "languages default leaked from prior submission",
  );
});

test("createOcrSubmissionFromDocument: caller-supplied ocr_options.languages are isolated from the returned submission", () => {
  const env = makeEnv();
  const input = baseInput();
  input.ocr_options = { languages: ["zh-Hant", "en"] };
  const sub = createOcrSubmissionFromDocument(input, env);
  // Mutate caller's array post-call — must not change the persisted submission.
  input.ocr_options.languages.push("MUTATED");
  assert.deepEqual(sub.ocr_options.languages, ["zh-Hant", "en"]);
});

test("createOcrSubmissionFromDocument: caller-supplied retry/preprocessing/metadata are deep-cloned", () => {
  const env = makeEnv();
  const input = baseInput();
  input.retry = { max_attempts: 5, backoff: "exponential", base_delay_ms: 1000, max_delay_ms: 30000, attempt: 1 };
  input.preprocessing = {
    deskew: "off", denoise: "off", binarize: true,
    remove_seal_bleed: true, upscale_low_dpi: false, target_dpi_floor: 150,
    crop_borders: "off",
  };
  input.metadata = { trace_id: "t", nested: { tags: ["a", "b"] } };
  const sub = createOcrSubmissionFromDocument(input, env);
  // Mutate input AFTER the call.
  input.retry.max_attempts = 99;
  input.preprocessing.deskew = "auto";
  input.metadata.nested.tags.push("MUTATED");
  // Stored submission must not see those mutations.
  assert.equal(sub.retry.max_attempts, 5);
  assert.equal(sub.preprocessing.deskew, "off");
  assert.deepEqual(sub.metadata.nested.tags, ["a", "b"]);
});

// ---------------------------------------------------------------------------
// ingestDocumentForOcr — orchestration
// ---------------------------------------------------------------------------

test("ingestDocumentForOcr: persists job and emits succeeded lifecycle by default", async () => {
  const deps = makeDeps(); // defaults to "success" via the queue adapter
  const out = await ingestDocumentForOcr(baseInput(), deps);

  assert.equal(out.job.tenant_id, TENANT);
  assert.equal(out.job.document_id, DOCUMENT);
  assert.equal(out.job.terminal_state, "succeeded");
  assert.equal(out.statuses.length, 3);
  assert.equal(out.statuses.at(-1).to, "succeeded");
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].result.status, "succeeded");
});

test("ingestDocumentForOcr: partial_failure is persisted with mixed page results", async () => {
  const deps = makeDeps("partial_failure");
  // partial_failure scenario emits one result per submitted page (first page
  // succeeds, the rest fail) and therefore requires a multi-page submission.
  // The fake worker rejects single-page partial_failure submissions explicitly.
  const input = baseInput();
  input.pages = [
    { page_id: PAGE_1, page_number: 1, source: { ...sampleSource } },
    {
      page_id: PAGE_2,
      page_number: 2,
      source: { ...sampleSource, key: "tenant/01jrk/doc/01jrk/page-002.png" },
    },
  ];
  const out = await ingestDocumentForOcr(input, deps);

  assert.equal(out.job.terminal_state, "partial_succeeded");
  assert.equal(out.results.length, 2);
  const statuses = out.results.map((r) => r.result.status).sort();
  assert.deepEqual(statuses, ["failed", "succeeded"]);
});

test("ingestDocumentForOcr: permanent_failure ends in dead_lettered without requeue", async () => {
  const deps = makeDeps("permanent_failure");
  const out = await ingestDocumentForOcr(baseInput(), deps);

  assert.equal(out.job.terminal_state, "dead_lettered");
  // No re-enter `queued` after the first claim.
  const requeues = out.statuses.filter((e, i) => i > 0 && e.to === "queued");
  assert.equal(requeues.length, 0);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].result.status, "failed");
  assert.equal(out.results[0].result.partial_failure.is_transient, false);
});

test("ingestDocumentForOcr: transient_then_success preserves the retry edge in the timeline", async () => {
  const deps = makeDeps("transient_then_success");
  const out = await ingestDocumentForOcr(baseInput(), deps);

  assert.equal(out.job.terminal_state, "succeeded");
  const retryEdges = out.statuses.filter(
    (e) => e.from === "failed" && e.to === "queued",
  );
  assert.equal(retryEdges.length, 1);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].result.status, "succeeded");
});

test("ingestDocumentForOcr: end-to-end view via persistence matches returned snapshot", async () => {
  const deps = makeDeps("transient_then_success");
  const input = baseInput();
  const out = await ingestDocumentForOcr(input, deps);

  // Re-read via persistence as a downstream query would.
  const job = await deps.persistence.getOcrJob(out.job.job_id);
  const statuses = await deps.persistence.listOcrJobStatuses(out.job.job_id);
  const results = await deps.persistence.listOcrResults(out.job.job_id);

  assert.equal(job.terminal_state, "succeeded");
  assert.equal(statuses.length, out.statuses.length);
  assert.deepEqual(
    statuses.map((s) => `${s.from}->${s.to}`),
    out.statuses.map((s) => `${s.from}->${s.to}`),
  );
  assert.equal(results.length, out.results.length);
  // Linkage round-trips: every persisted result references the same job/tenant/document.
  for (const r of results) {
    assert.equal(r.result.job_id, job.job_id);
    assert.equal(r.result.tenant_id, TENANT);
    assert.equal(r.result.document_id, DOCUMENT);
  }
});

test("ingestDocumentForOcr: missing persistence dep throws IngestionError", async () => {
  await assert.rejects(
    () => ingestDocumentForOcr(baseInput(), { queueAdapter: new OcrJobAdapter() }),
    (err) => err instanceof IngestionError && /persistence/.test(err.message),
  );
});

test("ingestDocumentForOcr: missing queueAdapter dep throws IngestionError", async () => {
  await assert.rejects(
    () => ingestDocumentForOcr(baseInput(), { persistence: new InMemoryOcrPersistence() }),
    (err) => err instanceof IngestionError && /queueAdapter/.test(err.message),
  );
});

test("ingestDocumentForOcr: invalid input never enqueues nor persists", async () => {
  const deps = makeDeps();
  const bad = baseInput();
  delete bad.tenant_id;
  await assert.rejects(
    () => ingestDocumentForOcr(bad, deps),
    IngestionError,
  );
  assert.equal(await deps.queueAdapter.pendingCount(), 0);
});

test("ingestDocumentForOcr: opaque metadata flows from input through to the persisted submission", async () => {
  const deps = makeDeps();
  const input = baseInput();
  input.metadata = {
    trace_id: "trace-zeta",
    court_filing: { docket: "(2025)京01民初9999号" },
  };
  const out = await ingestDocumentForOcr(input, deps);
  assert.deepEqual(out.job.submission.metadata, input.metadata);
});
