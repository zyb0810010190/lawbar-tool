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
    // Sanitized message — raw "simulated engine crash" does NOT travel
    // into the result; only the stable, code-keyed text does. Audit
    // 019e3a2e D2 Medium fix.
    assert.equal(
      outcome.results[0].partial_failure.message,
      "OCR engine failed to process the image.",
    );
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

// --- audit 019e3a2e fix coverage ------------------------------------------

test("D3 H: success path echoes submission.metadata unchanged", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const engine = { async detect() { return [{ text: "x", mean: 0.5 }]; } };
    const sub = makeSubmission({
      source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }),
    });
    sub.metadata = {
      trace_id: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      filing_ref: "court-filing-2025-hu-min-12345",
      nested: { tags: ["a", "b"], n: 42 },
    };
    const outcome = await processPaddleOcrOnnxJob(
      { id: "t", submission: sub, enqueued_at: "2026-05-18T10:00:00.000Z" },
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "succeeded");
    assert.deepEqual(outcome.results[0].metadata, sub.metadata);
    // Defensive clone — mutating the source metadata after the call
    // must NOT leak into the result.
    sub.metadata.trace_id = "MUTATED";
    assert.notEqual(outcome.results[0].metadata.trace_id, "MUTATED");
  });
});

test("D3 H: failed path also echoes submission.metadata", async () => {
  await withTempRoot(async (root) => {
    const engine = { async detect() { throw new Error("should not be called"); } };
    const sub = makeSubmission({
      source: { kind: "s3", bucket: "b", key: "k", byte_size: 1, mime_type: "image/png" },
    });
    sub.metadata = { trace_id: "trace-xyz", tags: ["audit"] };
    const outcome = await processPaddleOcrOnnxJob(
      { id: "t", submission: sub, enqueued_at: "2026-05-18T10:00:00.000Z" },
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.deepEqual(outcome.results[0].metadata, sub.metadata);
  });
});

test("D3 H: engine returns non-array -> engine_failed (no mapper crash)", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const engine = { async detect() { return null; } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.equal(outcome.results[0].partial_failure.code, ENGINE_FAILED_CODE);
  });
});

test("D3 H: engine returns array with non-string text -> engine_failed", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const engine = { async detect() { return [{ text: 42, mean: 0.5 }]; } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.equal(outcome.results[0].partial_failure.code, ENGINE_FAILED_CODE);
  });
});

test("D3 H: engine returns array with non-object element -> engine_failed", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const engine = { async detect() { return ["just a string"]; } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.equal(outcome.results[0].partial_failure.code, ENGINE_FAILED_CODE);
  });
});

test("D2 M: sanitized partial_failure.message for fetcher errors (no path leak into result)", async () => {
  await withTempRoot(async (root) => {
    const engine = { async detect() { throw new Error("should not be called"); } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({
        source: makeFileSource({ path: "/etc/passwd", mime_type: "image/png", byte_size: 1 }),
      }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.results[0].partial_failure.code, FETCHER_ERROR_CODES.PATH_ESCAPE);
    // The fetcher's raw message would have contained "/etc/passwd" + the
    // resolved allowed-root path. The sanitized result must not.
    const msg = outcome.results[0].partial_failure.message;
    assert.equal(msg, "Source path failed containment check.");
    assert.equal(msg.includes("/etc/passwd"), false);
    assert.equal(msg.includes(root), false);
  });
});

test("D7: full status-chain sequence validates as a chain (not just edge-by-edge)", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const engine = { async detect() { return [{ text: "x", mean: 1.0 }]; } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    const { validateOcrStatusTransitionSequence } = await import("ocr-worker-contract");
    const v = validateOcrStatusTransitionSequence({
      job_id: outcome.job_id,
      transitions: outcome.statuses,
    });
    assert.equal(v.ok, true, v.ok ? "" : v.summary);
  });
});

test("D2 L: temp file mode is 0o600", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    let capturedPath;
    let capturedMode;
    const engine = {
      async detect(imagePath) {
        capturedPath = imagePath;
        const st = await fsStat(imagePath);
        capturedMode = st.mode & 0o777;
        return [{ text: "x", mean: 1.0 }];
      },
    };
    await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.ok(capturedPath, "engine should have been called");
    // POSIX umask can mask further but never adds; 0o600 means the file
    // permission bits are exactly user-rw, no group/other access. We
    // accept 0o600 exactly OR the value after a more-restrictive umask
    // (any subset of 0o600).
    assert.equal(capturedMode & 0o077, 0, `expected no group/other bits; mode=0o${capturedMode.toString(8)}`);
    assert.ok((capturedMode & 0o600) === 0o600 || (capturedMode & 0o400) === 0o400,
      `expected user-readable; mode=0o${capturedMode.toString(8)}`);
  });
});

test("D4 M: WORKER_REGISTRY is deep-frozen (entries are immutable too)", () => {
  // Top-level: already covered above.
  // Entry-level: nested .load and .name must be immutable.
  assert.throws(() => { WORKER_REGISTRY.fake.load = async () => null; }, TypeError);
  assert.throws(() => { WORKER_REGISTRY.fake.name = "evil"; }, TypeError);
  assert.throws(() => { WORKER_REGISTRY["paddleocr-onnx"].load = async () => null; }, TypeError);
});

test("D4 M: paddleocr-onnx.load with engineVersion='' rejected (real type guard)", async () => {
  await withTempRoot(async (root) => {
    const engine = { async detect() { return []; } };
    await assert.rejects(
      WORKER_REGISTRY["paddleocr-onnx"].load({
        fetcher: { allowedFileRoot: root },
        engine,
        engineVersion: "",
      }),
      /not yet wired|non-empty engineVersion/i,
    );
  });
});

test("D4 M: paddleocr-onnx.load with engine.detect not a function rejected", async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(
      WORKER_REGISTRY["paddleocr-onnx"].load({
        fetcher: { allowedFileRoot: root },
        engine: { detect: "not a function" },
        engineVersion: baseEngineVersion,
      }),
      /not yet wired/i,
    );
  });
});

test("D3 M: processing_duration_ms is non-negative even with backward wall clock", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    let n = 0;
    // Wall clock that goes BACKWARDS — if duration used clock(), it
    // would produce a negative value. performance.now() is monotonic
    // so we stay non-negative.
    const backwardClock = () => {
      const t = new Date(Date.UTC(2030, 0, 1, 0, 0, 60 - n));
      n += 1;
      return t;
    };
    const engine = { async detect() { return [{ text: "x", mean: 1.0 }]; } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion, now: backwardClock },
    );
    assert.ok(
      outcome.results[0].page_metrics.processing_duration_ms >= 0,
      `expected duration >= 0, got ${outcome.results[0].page_metrics.processing_duration_ms}`,
    );
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
