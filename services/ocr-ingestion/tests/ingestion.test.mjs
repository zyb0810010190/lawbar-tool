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
  INGESTION_ERROR_CODES,
} from "../dist/index.js";
import { drainOcrPipelineForTesting } from "../dist/testing/drainPipeline.js";
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

// Step 10K: ingestion is enqueue-only. Tests that previously relied on
// the synchronous worker drive now invoke this helper after
// `ingestDocumentForOcr` so the 10C coordinator persists the worker's
// status timeline + per-page results, then re-read via persistence.
async function runPipelineToTerminal(input, deps) {
  const enqueued = await ingestDocumentForOcr(input, deps);
  const queueBackend = deps.queueAdapter._backendForTests ?? deps.queueBackend;
  if (queueBackend === undefined) {
    throw new Error(
      "test wiring: drain helper needs the underlying queue backend; pass `queueBackend` on deps",
    );
  }
  await drainOcrPipelineForTesting({
    queue: queueBackend,
    persistence: deps.persistence,
    worker_id: "test-worker",
    now: deps.now,
  });
  const job = await deps.persistence.getOcrJob(enqueued.job.job_id);
  const statuses = await deps.persistence.listOcrJobStatuses(enqueued.job.job_id);
  const results = await deps.persistence.listOcrResults(enqueued.job.job_id);
  return { job, statuses, results, enqueued };
}

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
  const queueBackend = new InMemoryOcrQueue();
  return {
    persistence: new InMemoryOcrPersistence({ now: env.now }),
    queueAdapter: new OcrJobAdapter({ backend: queueBackend }),
    queueBackend,
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

test("createOcrSubmissionFromDocument: multi-page submission is rejected with multi_page_unsupported (ADR-11B §3)", () => {
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
  assert.throws(
    () => createOcrSubmissionFromDocument(input, env),
    (err) =>
      err instanceof IngestionError &&
      err.code === INGESTION_ERROR_CODES.MULTI_PAGE_UNSUPPORTED &&
      /not supported in v1/i.test(err.message) &&
      /2 pages/.test(err.message),
  );
});

test("createOcrSubmissionFromDocument: 3+ pages also rejected with multi_page_unsupported", () => {
  const env = makeEnv();
  const input = baseInput();
  input.pages = [
    { page_id: PAGE_1, page_number: 1, source: { ...sampleSource } },
    { page_id: PAGE_2, page_number: 2, source: { ...sampleSource } },
    {
      page_id: "01jrk8m4q4xv2v8d4d4ymf5p03",
      page_number: 3,
      source: { ...sampleSource },
    },
  ];
  assert.throws(
    () => createOcrSubmissionFromDocument(input, env),
    (err) =>
      err instanceof IngestionError &&
      err.code === INGESTION_ERROR_CODES.MULTI_PAGE_UNSUPPORTED &&
      /3 pages/.test(err.message),
  );
});

test("createOcrSubmissionFromDocument: 0 pages rejected with the existing 'at least one' message (no code)", () => {
  // Backward-compat: the empty-pages rejection class predates IngestionErrorCode
  // and no caller branches on it via code. We keep the un-coded form so existing
  // callers depending only on the message text continue to work; if a caller
  // ever needs to branch on it, add a code entry then.
  const env = makeEnv();
  const input = baseInput();
  input.pages = [];
  assert.throws(
    () => createOcrSubmissionFromDocument(input, env),
    (err) =>
      err instanceof IngestionError &&
      err.code === undefined &&
      /at least one page is required/.test(err.message),
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

test("ingestDocumentForOcr: enqueues + drained pipeline produces succeeded lifecycle by default", async () => {
  const deps = makeDeps(); // defaults to "success" via the queue adapter
  const { job, statuses, results, enqueued } = await runPipelineToTerminal(
    baseInput(),
    deps,
  );

  // Step 10K invariant: ingestDocumentForOcr returns BEFORE worker runs.
  assert.equal(enqueued.job.terminal_state, undefined);
  assert.equal(enqueued.atomic, false); // in-memory persistence => fallback path
  assert.equal(enqueued.enqueueResult.deduped, false);

  // After draining via the coordinator the timeline matches old expectations.
  assert.equal(job.tenant_id, TENANT);
  assert.equal(job.document_id, DOCUMENT);
  assert.equal(job.terminal_state, "succeeded");
  assert.equal(statuses.length, 3);
  assert.equal(statuses.at(-1).to, "succeeded");
  assert.equal(results.length, 1);
  assert.equal(results[0].result.status, "succeeded");
});

// `ingestDocumentForOcr: partial_failure is persisted with mixed page results
// after drain` has been removed at the N=1-cap migration (ADR-11B §3 +
// the multi_page_unsupported guard in createOcrSubmissionFromDocument).
// Reason: the fake-worker `partial_failure` scenario emits one result per
// submitted page and explicitly rejects single-page submissions, so it can
// no longer be exercised through the ingestion seam. The scenario's
// per-page-mix behaviour is still asserted at the contract layer
// (`docs/contracts/tests/fake-worker.test.mjs`), and the
// `partial_failure_lifecycle` worker-side coordinator path is still asserted
// in `services/ocr-worker/tests/coordinator.test.mjs`. The mixed-page-result
// assertion formerly here is not lost, just relocated to the layers that
// can legitimately reach the scenario. If multi-page submission returns
// post-v1, restore the ingestion-end test alongside that reversal.

// 10K test-migration note: the previous ingestion tests for the
// `permanent_failure` and `transient_then_success` fake scenarios asserted
// a synchronous lifecycle that ingest.ts wrote directly into persistence.
// Step 10C ADR Decision 12 rejected both scenarios from the coordinator:
//
//   - `permanent_failure` produces a trailing `failed → dead_lettered` DLQ
//     edge that the coordinator rejects.
//   - `transient_then_success` bundles a `failed → queued → claimed → ...`
//     retry chain that the coordinator rejects as a bundled-retry signal.
//
// Post-10K ingestion drives the coordinator. Therefore those scenarios
// are no longer reachable via the ingestion seam. Their fake-worker
// behaviour is asserted at the contract layer
// (`docs/contracts/tests/fake-worker.test.mjs`) — the assertions formerly
// here are not lost, just relocated to the layer that legitimately owns
// them.

test("ingestDocumentForOcr: end-to-end view via persistence is the only authoritative read post-10K", async () => {
  const deps = makeDeps("success");
  const input = baseInput();
  const { job, statuses, results, enqueued } = await runPipelineToTerminal(
    input,
    deps,
  );

  assert.equal(job.terminal_state, "succeeded");
  assert.equal(job.job_id, enqueued.job.job_id);
  // Linkage round-trips: every persisted result references the same job/tenant/document.
  for (const r of results) {
    assert.equal(r.result.job_id, job.job_id);
    assert.equal(r.result.tenant_id, TENANT);
    assert.equal(r.result.document_id, DOCUMENT);
  }
  // Sanity: status timeline length is the chain the worker produced + the
  // 10C coordinator-owned queued→claimed edge.
  assert.ok(statuses.length >= 3);
});

// ----------------------------------------------------------------------
// Step 10K — enqueue-only invariants
// ----------------------------------------------------------------------

test("ingestDocumentForOcr (10K): returns before the worker runs (no terminal_state, no persisted statuses)", async () => {
  const deps = makeDeps();
  const enqueued = await ingestDocumentForOcr(baseInput(), deps);

  assert.equal(enqueued.job.terminal_state, undefined);
  assert.equal(enqueued.enqueueResult.deduped, false);
  // Nothing has been claimed/processed/persisted yet — only the
  // ocr_jobs row + queue row exist.
  const statuses = await deps.persistence.listOcrJobStatuses(enqueued.job.job_id);
  const results = await deps.persistence.listOcrResults(enqueued.job.job_id);
  assert.equal(statuses.length, 0);
  assert.equal(results.length, 0);
  assert.equal(await deps.queueAdapter.pendingCount(), 1);
});

test("ingestDocumentForOcr (10K): in-memory persistence reports atomic=false (fallback path)", async () => {
  const deps = makeDeps();
  const enqueued = await ingestDocumentForOcr(baseInput(), deps);
  assert.equal(enqueued.atomic, false);
});

test("ingestDocumentForOcr (10K): repeated submission with same job_id surfaces as createOcrJob conflict", async () => {
  // Fallback path: persistence rejects duplicate job_id BEFORE enqueue runs,
  // so the queue is left untouched on the second call.
  const deps = makeDeps();
  const input = baseInput();
  const first = await ingestDocumentForOcr(input, deps);
  // Force the SAME job_id on the next call so we exercise the
  // persistence-side existence check, regardless of generator state.
  const reusedDeps = { ...deps, generateJobId: () => first.job.job_id };
  const before = await deps.queueAdapter.pendingCount();
  await assert.rejects(
    () => ingestDocumentForOcr(input, reusedDeps),
    (err) => /already exists|dedupe/.test(err.message ?? String(err)),
  );
  const after = await deps.queueAdapter.pendingCount();
  // Queue count must not grow on the rejected duplicate.
  assert.equal(after, before);
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
