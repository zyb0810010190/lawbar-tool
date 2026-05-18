// ADR-11C.3c — opt-in worker-bin end-to-end smoke through the REAL paddle engine.
//
// Scope: worker-bin level (NOT a full ingestion → review smoke). This test
// owns the submission construction directly because services/ocr-worker
// doesn't depend on ocr-ingestion (and shouldn't — ingestion sits above
// the worker in the dep graph). A full domain-input → review smoke
// belongs to a higher-level integration package; that's deferred.
//
// Flow:
//   1. mkdtemp a temp file root + copy the vendored zh-02 fixture into it
//   2. mkdtemp a SQLite workspace
//   3. Build a contract-valid OcrSubmission with kind:file source pointing
//      at the copied PNG (path relative to the file root)
//   4. persistence.createOcrJob + queueAdapter.enqueueOcrJob into the
//      shared SQLite workspace (no ocr-ingestion dependency)
//   5. Spawn the worker bin with OCR_WORKER=paddleocr-onnx +
//      OCR_FETCHER_FILE_ROOT=<temp root> + SQLite workspace + max_iter=1
//   6. Wait for clean exit (~400ms = ~200ms cold load + ~150ms detect +
//      spawn overhead)
//   7. Re-open persistence, read OcrResult, assert:
//        - terminal_state === "succeeded"
//        - status === "succeeded" on the result
//        - raw_text contains at least one BMP CJK character
//        - engine.name === "paddleocr-onnx"
//        - engine.version matches <pkg>+ch_PP-OCRv4@<models-pkg>
//        - metadata round-tripped from the submission
//
// Opt-in via OCR_WORKER_REAL_ENGINE_TESTS=1 (same flag as 11C.3b).
// Default-off because the cold load + real native binary loads are too
// heavy for every test invocation. CI can flip the flag once per
// deployment-target run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

import {
  openSqliteOcrPersistence,
  openSqliteOcrQueue,
} from "ocr-persistence";
import { OcrJobAdapter } from "../dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BIN_PATH = resolve(__dirname, "..", "bin", "ocr-worker.mjs");

// Vendored fixture under services/ocr-worker/tests/fixtures/ — audit
// 019e3a8f D8 Medium fix: previously this test read the bakeoff's
// fixture by relative path and silently skipped if absent. Vendoring
// makes the worker tests self-contained.
const VENDORED_FIXTURE = resolve(__dirname, "fixtures", "zh-02-court-heading.png");

const TENANT = "01jrk8m4q4xv2v8d4d4ymf5tnt";
const DOCUMENT = "01jrk8m4q4xv2v8d4d4ymf5doc";
const PAGE_1 = "01jrk8m4q4xv2v8d4d4ymf5p01";

// Minimal allowlisted env passed to the spawned bin. Excludes
// NODE_OPTIONS, NODE_PATH, and any parent-process secrets so the
// child cannot be perturbed by the test process's environment.
const CHILD_ENV_ALLOWLIST = [
  "HOME",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
];

function buildChildEnv({ sqlitePath, workerId, fetcherRoot }) {
  const inherited = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) inherited[key] = v;
  }
  return {
    ...inherited,
    OCR_WORKER: "paddleocr-onnx",
    OCR_FETCHER_FILE_ROOT: fetcherRoot,
    OCR_WORKER_PERSISTENCE: "sqlite",
    OCR_WORKER_QUEUE: "sqlite",
    OCR_WORKER_SQLITE_PATH: sqlitePath,
    OCR_WORKER_MAX_ITERATIONS: "1",
    OCR_WORKER_IDLE_DELAY_MS: "0",
    OCR_WORKER_ID: workerId,
  };
}

function spawnWorkerBin({ sqlitePath, workerId, fetcherRoot, timeoutMs = 30_000 }) {
  const child = spawn(process.execPath, [BIN_PATH], {
    env: buildChildEnv({ sqlitePath, workerId, fetcherRoot }),
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
            `11C.3c real-engine E2E timed out after ${timeoutMs}ms. ` +
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

function freshSqliteWorkspace() {
  const dir = mkdtempSync(resolve(tmpdir(), "ocr-11c3c-e2e-"));
  const sqlitePath = resolve(dir, "ocr.db");
  const { persistence, db: persistenceDb } = openSqliteOcrPersistence({
    path: sqlitePath,
  });
  const { queue, db: queueDb } = openSqliteOcrQueue({ path: sqlitePath });
  const queueAdapter = new OcrJobAdapter({ backend: queue });
  return {
    persistence,
    persistenceDb,
    queue,
    queueDb,
    queueAdapter,
    sqlitePath,
    dir,
    cleanup: async () => {
      try { await queue.close(); } catch { /* already closed */ }
      try { persistenceDb.close(); } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function makeFetcherRoot() {
  const dir = mkdtempSync(resolve(tmpdir(), "ocr-11c3c-fetcher-"));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
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

function shouldRunRealEngine() {
  return process.env.OCR_WORKER_REAL_ENGINE_TESTS === "1";
}

// --- always-on bin startup smoke for paddleocr-onnx (audit 019e3a8f D7) ---
// Spawns the real bin with OCR_WORKER=paddleocr-onnx + an existing
// fetcher root + an empty in-memory queue + max_iterations=1. Pays the
// engine cold load (~200ms) so the deploy seam is exercised on every
// CI run — registry routing, env reading, fetcher-root stat validation,
// real engine factory cold load, bin spawn, clean exit code.
//
// Does NOT pay the detect cost (queue is empty; the loop runs one idle
// iteration then exits). The real-OCR detect path is exercised by the
// opt-in fixture-based test below.
//
// This catches deploy-seam regressions that the 11C.3b factory smoke
// can't reach (the factory only proves makeRealPaddleEngine works in-
// process; the bin smoke proves the bin can actually invoke it through
// the full config-parse + buildDeps + WORKER_REGISTRY routing chain).
test("bin startup smoke: OCR_WORKER=paddleocr-onnx with empty queue exits 0", async () => {
  const fetcherRoot = makeFetcherRoot();
  const sqliteWs = freshSqliteWorkspace();
  try {
    // Close ingestion handles so the bin gets exclusive SQLite access.
    await sqliteWs.queue.close();
    sqliteWs.persistenceDb.close();

    const { done } = spawnWorkerBin({
      sqlitePath: sqliteWs.sqlitePath,
      workerId: "11c3c-startup-smoke",
      fetcherRoot: fetcherRoot.dir,
      // Detection runs no inference; cold load alone is paid.
      timeoutMs: 15_000,
    });
    const result = await done;

    assert.equal(
      result.code,
      0,
      `bin exit code; stderr=${result.stderr}`,
    );
    assert.equal(result.signal, null);

    // Audit 019e3a8f D2 M: stderr config-log line should show the
    // chosen worker so operators can verify the deploy.
    assert.match(
      result.stderr,
      /"worker_kind":"paddleocr-onnx"/,
      `expected startup config-log line to show worker_kind=paddleocr-onnx in stderr; ` +
        `stderr=${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /"fetcher_file_root":/,
      "expected startup config-log line to show fetcher_file_root",
    );
  } finally {
    await sqliteWs.cleanup();
    fetcherRoot.cleanup();
  }
});

test("E2E real engine: bin -> real paddle -> persisted succeeded result with CJK text", async (t) => {
  if (!shouldRunRealEngine()) {
    t.skip("set OCR_WORKER_REAL_ENGINE_TESTS=1 to run the real-engine E2E smoke");
    return;
  }
  // Vendored fixture; absence is a real failure, not a skip — the
  // worker package now owns this fixture (see tests/fixtures/README.md).
  if (!existsSync(VENDORED_FIXTURE)) {
    assert.fail(
      `vendored fixture missing at ${VENDORED_FIXTURE}; ` +
        `check tests/fixtures/zh-02-court-heading.png is present`,
    );
  }

  const ws = freshSqliteWorkspace();
  const fetcherRoot = makeFetcherRoot();
  try {
    // Copy the fixture into the fetcher root so the bin can resolve
    // `source.path = "page.png"` against `OCR_FETCHER_FILE_ROOT`.
    const fixtureInRoot = join(fetcherRoot.dir, "page.png");
    copyFileSync(VENDORED_FIXTURE, fixtureInRoot);
    const fixtureSize = statSync(fixtureInRoot).size;

    const env = deterministicEnv();
    const traceId = "11c3c-e2e-success";
    const job_id = env.generateJobId();

    // Build a contract-valid submission directly. We don't go through
    // `ocr-ingestion` here because services/ocr-worker does not depend
    // on ocr-ingestion (and shouldn't — ingestion sits ABOVE the
    // worker package in the dep graph). Manually filling in every
    // field that ingestion would default keeps the E2E test in the
    // package that owns the bin under test.
    const submission = {
      contract_version: "1.0.0",
      job_id,
      tenant_id: TENANT,
      document_id: DOCUMENT,
      document_revision: 1,
      submitted_at: env.now().toISOString(),
      submitted_by: "user_e2e_test",
      pages: [
        {
          page_id: PAGE_1,
          page_number: 1,
          source: {
            kind: "file",
            path: "page.png", // relative to fetcher root
            byte_size: fixtureSize,
            mime_type: "image/png",
          },
        },
      ],
      rerun: { is_rerun: false, previous_job_id: null, page_ids: null },
      ocr_options: {
        languages: ["zh-Hans", "en"],
        detect_orientation: true,
        detect_vertical_text: true,
        table_recognition: "auto",
        seal_recognition: true,
        return_word_confidence: true,
        return_polygon: true,
        min_confidence_emit: 0.3,
      },
      preprocessing: {
        deskew: "auto",
        denoise: "auto",
        binarize: false,
        remove_seal_bleed: false,
        upscale_low_dpi: true,
        target_dpi_floor: 200,
        crop_borders: "auto",
      },
      priority: 50,
      retry: {
        max_attempts: 3,
        backoff: "exponential",
        base_delay_ms: 2000,
        max_delay_ms: 60000,
        attempt: 1,
      },
      metadata: { trace_id: traceId },
    };

    // Atomic createOcrJob + enqueue. Mirrors the ingestion layer's
    // atomic seam but skipping the domain-input translation.
    await ws.persistence.createOcrJob(submission);
    const enq = await ws.queueAdapter.enqueueOcrJob(submission);
    assert.equal(enq.deduped, false);

    // Close ingestion handles BEFORE spawning the bin (same as 10L
    // crossprocess pattern — only one SQLite writer at a time).
    await ws.queue.close();
    ws.persistenceDb.close();

    const { done } = spawnWorkerBin({
      sqlitePath: ws.sqlitePath,
      workerId: "11c3c-e2e-worker",
      fetcherRoot: fetcherRoot.dir,
    });
    const result = await done;

    assert.equal(
      result.code,
      0,
      `bin exit code; stderr=${result.stderr}`,
    );
    assert.equal(result.signal, null, "bin must exit cleanly, not by signal");

    // Re-open persistence to inspect the persisted OcrResult.
    const { persistence, db } = openSqliteOcrPersistence({ path: ws.sqlitePath });
    try {
      const job = await persistence.getOcrJob(job_id);
      assert.notEqual(job, null);
      assert.equal(job.terminal_state, "succeeded", `terminal state; stderr=${result.stderr}`);

      const results = await persistence.listOcrResults(job_id);
      assert.equal(results.length, 1, "exactly one OcrResult for the single-page submission");
      const r = results[0].result;
      assert.equal(r.status, "succeeded");
      assert.equal(r.partial_failure, null);
      assert.equal(r.engine.name, "paddleocr-onnx");
      assert.match(
        r.engine.version,
        /^\d+\.\d+\.\d+\+ch_PP-OCRv4@\d+\.\d+\.\d+$/,
        `engine.version format; got ${JSON.stringify(r.engine.version)}`,
      );

      // The fixture's authored text is "上海市浦东新区人民法院". Engine
      // output may have OCR noise; assert at least one BMP CJK char
      // survives — proof the engine actually ran and produced text.
      assert.ok(typeof r.raw_text === "string", "raw_text is a string");
      assert.match(
        r.raw_text,
        /[一-鿿]/,
        `expected at least one BMP CJK character in raw_text; got ${JSON.stringify(r.raw_text)}`,
      );

      // Metadata round-trip per ADR-11C.3a §3 contract.
      assert.deepEqual(r.metadata, { trace_id: traceId });
    } finally {
      db.close();
    }
  } finally {
    await ws.cleanup();
    fetcherRoot.cleanup();
  }
});
