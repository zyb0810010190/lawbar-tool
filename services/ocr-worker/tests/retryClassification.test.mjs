// ADR-11E retry classification tests. Two layers:
//
// 1. classifyFetcherError(code) — pure lookup table.
// 2. assembleFailedOutcome → partial_failure.is_transient — the
//    adapter sets the bit based on the classification.
//
// No fetcher network work here; tests are pure + stubbed engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";

import {
  classifyFetcherError,
  ENGINE_FAILED_CODE,
  FETCHER_ERROR_CODES,
  processPaddleOcrOnnxJob,
} from "../dist/index.js";

// --- classifyFetcherError direct tests ------------------------------------

test("classifyFetcherError: transient codes (5xx + timeout + network + engine)", () => {
  assert.equal(classifyFetcherError(FETCHER_ERROR_CODES.HTTPS_SERVER_ERROR_5XX), "transient");
  assert.equal(classifyFetcherError(FETCHER_ERROR_CODES.HTTPS_TIMEOUT), "transient");
  assert.equal(classifyFetcherError(FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR), "transient");
  assert.equal(classifyFetcherError(ENGINE_FAILED_CODE), "transient");
});

test("classifyFetcherError: caller-error codes classify as permanent", () => {
  const permanents = [
    FETCHER_ERROR_CODES.SOURCE_KIND_UNSUPPORTED,
    FETCHER_ERROR_CODES.MULTI_PAGE_UNSUPPORTED,
    FETCHER_ERROR_CODES.FILE_ROOT_UNCONFIGURED,
    FETCHER_ERROR_CODES.PATH_ESCAPE,
    FETCHER_ERROR_CODES.FILE_NOT_FOUND,
    FETCHER_ERROR_CODES.FILE_NOT_REGULAR,
    FETCHER_ERROR_CODES.SIZE_MISMATCH,
    FETCHER_ERROR_CODES.SIZE_CAP_EXCEEDED,
    FETCHER_ERROR_CODES.MIME_UNSUPPORTED,
    FETCHER_ERROR_CODES.MIME_SIGNATURE_MISMATCH,
    FETCHER_ERROR_CODES.URL_MALFORMED,
    FETCHER_ERROR_CODES.HTTP_SCHEME_UNSUPPORTED,
    FETCHER_ERROR_CODES.URL_EXPIRED,
    FETCHER_ERROR_CODES.HOST_NOT_ALLOWLISTED,
    FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP,
    FETCHER_ERROR_CODES.REDIRECT_UNSUPPORTED,
    FETCHER_ERROR_CODES.CONTENT_HASH_MISMATCH,
    FETCHER_ERROR_CODES.HTTPS_CLIENT_ERROR_4XX,
  ];
  for (const code of permanents) {
    assert.equal(
      classifyFetcherError(code),
      "permanent",
      `expected ${code} → permanent`,
    );
  }
});

test("classifyFetcherError: unknown code defaults to permanent (fail-safe)", () => {
  // The fail-safe policy is "default permanent" so a forgotten
  // classification doesn't create retry storms.
  assert.equal(classifyFetcherError("never_seen_code"), "permanent");
  assert.equal(classifyFetcherError(""), "permanent");
});

// --- assembleFailedOutcome wires is_transient correctly --------------------

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JOB_ID = "01jrk8m4q4xv2v8d4d4ymf5xnk";
const TENANT_ID = "01jrk8m4q4xv2v8d4d4ymf5tnt";
const DOCUMENT_ID = "01jrk8m4q4xv2v8d4d4ymf5doc";
const PAGE_1 = "01jrk8m4q4xv2v8d4d4ymf5p01";

function makeFileSource({ path, mime_type, byte_size }) {
  return { kind: "file", path, byte_size, mime_type };
}

function makeSubmission({ source } = {}) {
  return {
    contract_version: "1.0.0",
    job_id: JOB_ID,
    tenant_id: TENANT_ID,
    document_id: DOCUMENT_ID,
    document_revision: 1,
    submitted_at: "2026-05-18T10:00:00.000Z",
    submitted_by: "user_test",
    pages: [{ page_id: PAGE_1, page_number: 1, source: source ?? makeFileSource({ path: "p.png", mime_type: "image/png", byte_size: 1 }) }],
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
      deskew: "auto", denoise: "auto", binarize: false,
      remove_seal_bleed: false, upscale_low_dpi: true,
      target_dpi_floor: 200, crop_borders: "auto",
    },
    priority: 50,
    retry: { max_attempts: 3, backoff: "exponential", base_delay_ms: 2000, max_delay_ms: 60000, attempt: 1 },
    metadata: {},
  };
}

function makeJob({ source }) {
  return { id: "t", submission: makeSubmission({ source }), enqueued_at: "2026-05-18T10:00:00.000Z" };
}

async function withTempRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "ocr-retry-class-test-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const baseEngineVersion = "1.4.8+rapidocr-ch_PP-OCRv4";

test("adapter: permanent fetcher error (path_escape) -> is_transient: false on result", async () => {
  await withTempRoot(async (root) => {
    const engine = { async detect() { throw new Error("never called"); } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "/etc/passwd", mime_type: "image/png", byte_size: 1 }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.equal(outcome.results[0].partial_failure.code, FETCHER_ERROR_CODES.PATH_ESCAPE);
    assert.equal(outcome.results[0].partial_failure.is_transient, false);
  });
});

test("adapter: transient engine_failed -> is_transient: true on result (ADR-11E §3)", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const engine = { async detect() { throw new Error("simulated GPU OOM"); } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "failed");
    assert.equal(outcome.results[0].partial_failure.code, ENGINE_FAILED_CODE);
    assert.equal(outcome.results[0].partial_failure.is_transient, true);
  });
});

test("adapter: size_mismatch (caller lied) -> is_transient: false", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "p.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const engine = { async detect() { throw new Error("never called"); } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "p.png", mime_type: "image/png", byte_size: 999 }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.results[0].partial_failure.code, FETCHER_ERROR_CODES.SIZE_MISMATCH);
    assert.equal(outcome.results[0].partial_failure.is_transient, false);
  });
});

test("adapter: file_not_found -> is_transient: false (ADR-11E §4)", async () => {
  await withTempRoot(async (root) => {
    const engine = { async detect() { throw new Error("never called"); } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "missing.png", mime_type: "image/png", byte_size: 1 }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.results[0].partial_failure.code, FETCHER_ERROR_CODES.FILE_NOT_FOUND);
    assert.equal(outcome.results[0].partial_failure.is_transient, false);
  });
});

test("adapter: succeeded outcome has partial_failure: null regardless of classification", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "page.png"), PNG_HEADER);
    const engine = { async detect() { return [{ text: "x", mean: 1.0 }]; } };
    const outcome = await processPaddleOcrOnnxJob(
      makeJob({ source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: PNG_HEADER.length }) }),
      { fetcher: { allowedFileRoot: root }, engine, engineVersion: baseEngineVersion },
    );
    assert.equal(outcome.terminal_state, "succeeded");
    assert.equal(outcome.results[0].partial_failure, null);
  });
});
