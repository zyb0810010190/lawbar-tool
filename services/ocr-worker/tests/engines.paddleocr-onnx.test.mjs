// Paddleocr-onnx adapter SHAPE tests. Real engine integration is
// deferred to 11C.3b; here the EnginePort is stubbed so the adapter's
// wiring (fetcher -> temp file -> engine -> mapper -> outcome) is
// exercised end-to-end without any real OCR.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  rm,
  readdir,
  stat as fsStat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";

import {
  processPaddleOcrOnnxJob,
  makePaddleOcrOnnxWorker,
  ENGINE_FAILED_CODE,
  WORKER_REGISTRY,
  FETCHER_ERROR_CODES,
} from "../dist/index.js";

// --- fixture helpers -------------------------------------------------------

const JOB_ID = "01jrk8m4q4xv2v8d4d4ymf5xnk";
const TENANT_ID = "01jrk8m4q4xv2v8d4d4ymf5tnt";
const DOCUMENT_ID = "01jrk8m4q4xv2v8d4d4ymf5doc";
const PAGE_1 = "01jrk8m4q4xv2v8d4d4ymf5p01";

// PNG magic-byte header — every fetcher happy-path test ships these.
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeFileSource({ path, mime_type, byte_size }) {
  return { kind: "file", path, byte_size, mime_type };
}

function makeSubmission({ source }) {
  return {
    contract_version: "1.0.0",
    job_id: JOB_ID,
    tenant_id: TENANT_ID,
    document_id: DOCUMENT_ID,
    document_revision: 1,
    submitted_at: "2026-05-18T10:00:00.000Z",
    submitted_by: "user_test",
    pages: [{ page_id: PAGE_1, page_number: 1, source }],
    rerun: { is_rerun: false, previous_job_id: null, page_ids: null },
    ocr_options: {
      languages: ["zh-Hans"],
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
    metadata: {},
  };
}

function makeJob({ source }) {
  return {
    id: "transport-1",
    submission: makeSubmission({ source }),
    enqueued_at: "2026-05-18T10:00:00.000Z",
  };
}

async function withTempRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "ocr-paddle-adapter-test-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function fixedClock(start = "2026-05-18T10:00:00.000Z") {
  let t = new Date(start).getTime();
  return () => {
    const d = new Date(t);
    t += 1; // advance 1ms per call so transitions get unique timestamps
    return d;
  };
}

const baseEngineVersion = "1.4.8+rapidocr-ch_PP-OCRv4";

// --- happy path ------------------------------------------------------------

test("happy path: fetcher -> temp file -> engine stub -> mapper -> succeeded", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const seenPaths = [];
    const stubLines = [
      { text: "上海市浦东新区人民法院", mean: 0.95, box: [[0, 0], [100, 0], [100, 50], [0, 50]] },
      { text: "民事判决书", mean: 0.92 },
    ];
    const engine = {
      async detect(imagePath) {
        seenPaths.push(imagePath);
        return stubLines;
      },
    };

    const outcome = await processPaddleOcrOnnxJob(
      makeJob({
        source: makeFileSource({
          path: "page.png",
          mime_type: "image/png",
          byte_size: PNG_HEADER.length,
        }),
      }),
      {
        fetcher: { allowedFileRoot: root },
        engine,
        now: fixedClock(),
        engineVersion: baseEngineVersion,
      },
    );

    assert.equal(outcome.terminal_state, "succeeded");
    assert.equal(outcome.job_id, JOB_ID);
    assert.equal(outcome.results.length, 1);
    assert.equal(outcome.results[0].status, "succeeded");
    assert.equal(outcome.results[0].partial_failure, null);
    assert.equal(outcome.results[0].blocks.length, 2);
    assert.equal(outcome.results[0].blocks[0].text, "上海市浦东新区人民法院");
    assert.equal(outcome.results[0].engine.name, "paddleocr-onnx");
    assert.equal(outcome.results[0].engine.version, baseEngineVersion);

    // Status chain: queue:queued->claimed, worker:claimed->processing,
    // worker:processing->succeeded.
    assert.equal(outcome.statuses.length, 3);
    assert.equal(outcome.statuses[0].from, "queued");
    assert.equal(outcome.statuses[0].to, "claimed");
    assert.equal(outcome.statuses[0].controlled_by, "queue");
    assert.equal(outcome.statuses[2].from, "processing");
    assert.equal(outcome.statuses[2].to, "succeeded");

    // Temp path was passed to the engine + lives inside os.tmpdir().
    assert.equal(seenPaths.length, 1);
    assert.match(seenPaths[0], /ocr-worker-paddle-/);
    assert.match(seenPaths[0], /\.png$/);
  });
});

test("temp file is cleaned up after success", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    let capturedPath;
    const engine = {
      async detect(imagePath) {
        capturedPath = imagePath;
        return [{ text: "x", mean: 0.5 }];
      },
    };
    await processPaddleOcrOnnxJob(
      makeJob({
        source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }),
      }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    // Temp dir (which held the temp file) is gone.
    await assert.rejects(fsStat(capturedPath), /ENOENT/);
  });
});

test("temp file is cleaned up after engine throws", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    let capturedPath;
    const engine = {
      async detect(imagePath) {
        capturedPath = imagePath;
        throw new Error("simulated engine crash");
      },
    };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({
        source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }),
      }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.equal(outcome.results[0].partial_failure.code, ENGINE_FAILED_CODE);
    assert.match(outcome.results[0].partial_failure.message, /simulated engine crash/);
    await assert.rejects(fsStat(capturedPath), /ENOENT/);
  });
});

test("engine returns empty lines -> succeeded with empty blocks + raw_text", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const engine = { async detect() { return []; } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({
        source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }),
      }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "succeeded");
    assert.deepEqual(outcome.results[0].blocks, []);
    assert.equal(outcome.results[0].raw_text, "");
  });
});

// --- fetcher error -> failed outcome ---------------------------------------

test("source_kind_unsupported -> failed outcome with code preserved", async () => {
  await withTempRoot(async (root) => {
    const engine = { async detect() { throw new Error("engine should not be called"); } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({
        // s3 kind is rejected by the fetcher at boundary
        source: { kind: "s3", bucket: "b", key: "k", byte_size: 1, mime_type: "image/png" },
      }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.equal(outcome.results[0].status, "failed");
    assert.equal(outcome.results[0].partial_failure.code, FETCHER_ERROR_CODES.SOURCE_KIND_UNSUPPORTED);
    assert.equal(outcome.results[0].partial_failure.is_transient, false);
    assert.equal(outcome.results[0].partial_failure.attempted_count, 1);
    // Status chain: queue:queued->claimed, worker:claimed->processing,
    // worker:processing->failed.
    assert.equal(outcome.statuses[outcome.statuses.length - 1].to, "failed");
  });
});

test("path_escape -> failed outcome with code preserved", async () => {
  await withTempRoot(async (root) => {
    const engine = { async detect() { throw new Error("engine should not be called"); } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({
        source: makeFileSource({ path: "/etc/passwd", mime_type: "image/png", byte_size: 1 }),
      }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.equal(outcome.results[0].partial_failure.code, FETCHER_ERROR_CODES.PATH_ESCAPE);
  });
});

test("size_mismatch -> failed outcome with code preserved", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "p.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const engine = { async detect() { throw new Error("engine should not be called"); } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({
        source: makeFileSource({ path: "p.png", mime_type: "image/png", byte_size: 999 }),
      }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.equal(outcome.results[0].partial_failure.code, FETCHER_ERROR_CODES.SIZE_MISMATCH);
  });
});

test("mime_signature_mismatch -> failed outcome with code preserved (full pipeline integration)", async () => {
  await withTempRoot(async (root) => {
    // Declare image/png but ship PDF bytes.
    const bytes = Buffer.from("%PDF-1.4\n%fake\n");
    await writeFile(join(root, "lie.png"), bytes);
    const engine = { async detect() { throw new Error("engine should not be called"); } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({
        source: makeFileSource({ path: "lie.png", mime_type: "image/png", byte_size: bytes.length }),
      }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.equal(outcome.results[0].partial_failure.code, FETCHER_ERROR_CODES.MIME_SIGNATURE_MISMATCH);
  });
});

// --- file_root_unconfigured -> RE-THROWS (config fault, not per-job) -------

test("file_root_unconfigured re-throws so the bin can exit 2 (config fault)", async () => {
  const engine = { async detect() { throw new Error("engine should not be called"); } };
  await assert.rejects(
    processPaddleOcrOnnxJob(
      makeJob({
        source: makeFileSource({ path: "p.png", mime_type: "image/png", byte_size: 1 }),
      }),
      { fetcher: { allowedFileRoot: "" }, engine, engineVersion: baseEngineVersion },
    ),
    (err) => err.code === FETCHER_ERROR_CODES.FILE_ROOT_UNCONFIGURED,
  );
});

// --- adapter validates submission -----------------------------------------

test("invalid submission (missing job_id) throws — never returns outcome", async () => {
  await withTempRoot(async (root) => {
    const engine = { async detect() { throw new Error("engine should not be called"); } };
    const sub = makeSubmission({
      source: makeFileSource({ path: "p.png", mime_type: "image/png", byte_size: 1 }),
    });
    delete sub.job_id; // bypass ingestion to expose adapter's narrow
    await assert.rejects(
      processPaddleOcrOnnxJob(
        { id: "t", submission: sub, enqueued_at: "2026-05-18T10:00:00.000Z" },
        { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
      ),
      /invalid submission/i,
    );
  });
});

// --- WORKER_REGISTRY tests -------------------------------------------------

test("WORKER_REGISTRY exposes fake + paddleocr-onnx keys, frozen", () => {
  assert.deepEqual(Object.keys(WORKER_REGISTRY).sort(), ["fake", "paddleocr-onnx"]);
  assert.equal(WORKER_REGISTRY.fake.name, "fake");
  assert.equal(WORKER_REGISTRY["paddleocr-onnx"].name, "paddleocr-onnx");
  // Registry is runtime-frozen
  assert.throws(() => { WORKER_REGISTRY.fake = null; }, TypeError);
  assert.throws(() => { WORKER_REGISTRY.newkey = { name: "x", load: () => {} }; }, TypeError);
});

test("WORKER_REGISTRY.fake.load() returns a working OcrWorker", async () => {
  const worker = await WORKER_REGISTRY.fake.load();
  assert.equal(typeof worker.process, "function");
});

test("WORKER_REGISTRY.paddleocr-onnx.load() without deps throws (11C.3a unwired state)", async () => {
  await assert.rejects(
    WORKER_REGISTRY["paddleocr-onnx"].load(),
    /not yet wired|11C\.3a/i,
  );
});

test("WORKER_REGISTRY.paddleocr-onnx.load(deps) returns OcrWorker with adapter wired", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const engine = { async detect() { return [{ text: "x", mean: 1.0 }]; } };
    const worker = await WORKER_REGISTRY["paddleocr-onnx"].load({
      fetcher: { allowedFileRoot: root },
      engine,
      engineVersion: baseEngineVersion,
    });
    assert.equal(typeof worker.process, "function");
    const outcome = await worker.process(makeJob({
      source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }),
    }));
    assert.equal(outcome.terminal_state, "succeeded");
  });
});

test("makePaddleOcrOnnxWorker(deps) is the direct entrypoint for adapter tests", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const engine = { async detect() { return [{ text: "x", mean: 1.0 }]; } };
    const worker = await makePaddleOcrOnnxWorker({
      fetcher: { allowedFileRoot: root },
      engine,
      engineVersion: baseEngineVersion,
    });
    const outcome = await worker.process(makeJob({
      source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }),
    }));
    assert.equal(outcome.terminal_state, "succeeded");
  });
});
