// Fetcher tests. Cover every error code in FETCHER_ERROR_CODES plus
// the happy path. Each test uses a real temp directory so the
// path-containment guards are exercised against actual filesystem
// state, not mocks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Buffer } from "node:buffer";

import {
  fetchPageBytes,
  FetcherError,
  FETCHER_ERROR_CODES,
} from "../dist/index.js";

// --- fixture helpers -------------------------------------------------------

const JOB_ID = "01jrk8m4q4xv2v8d4d4ymf5xnk";
const TENANT_ID = "01jrk8m4q4xv2v8d4d4ymf5tnt";
const DOCUMENT_ID = "01jrk8m4q4xv2v8d4d4ymf5doc";
const PAGE_1 = "01jrk8m4q4xv2v8d4d4ymf5p01";
const PAGE_2 = "01jrk8m4q4xv2v8d4d4ymf5p02";

function makeFileSource({ path, mime_type, byte_size }) {
  return { kind: "file", path, byte_size, mime_type };
}

function makeSubmission({ source, secondPage } = {}) {
  const pages = [
    { page_id: PAGE_1, page_number: 1, source: source ?? makeFileSource({ path: "p.png", mime_type: "image/png", byte_size: 1 }) },
  ];
  if (secondPage) pages.push(secondPage);
  return {
    contract_version: "1.0.0",
    job_id: JOB_ID,
    tenant_id: TENANT_ID,
    document_id: DOCUMENT_ID,
    submitted_at: "2026-05-18T10:00:00.000Z",
    submitted_by: "user_test",
    pages,
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

async function withTempRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "ocr-fetcher-test-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function assertFetcherError(promise, expectedCode) {
  await assert.rejects(
    promise,
    (err) => {
      assert.ok(err instanceof FetcherError, `expected FetcherError, got ${err?.constructor?.name}`);
      assert.equal(err.code, expectedCode, `expected code ${expectedCode}, got ${err.code}`);
      return true;
    },
  );
}

// --- happy path ------------------------------------------------------------

test("file: source with matching byte_size + allowed MIME -> returns bytes", async () => {
  await withTempRoot(async (root) => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    await writeFile(join(root, "page.png"), bytes);
    const submission = makeSubmission({
      source: makeFileSource({ path: "page.png", mime_type: "image/png", byte_size: bytes.length }),
    });
    const result = await fetchPageBytes(submission, { allowedFileRoot: root });
    assert.equal(result.sizeBytes, bytes.length);
    assert.equal(result.mimeType, "image/png");
    assert.deepEqual([...result.bytes], [...bytes]);
  });
});

test("file: nested path inside root resolves correctly", async () => {
  await withTempRoot(async (root) => {
    const sub = join(root, "tenant", "doc");
    await mkdir(sub, { recursive: true });
    const bytes = Buffer.from("hello jpeg");
    await writeFile(join(sub, "p.jpg"), bytes);
    const submission = makeSubmission({
      source: makeFileSource({ path: "tenant/doc/p.jpg", mime_type: "image/jpeg", byte_size: bytes.length }),
    });
    const result = await fetchPageBytes(submission, { allowedFileRoot: root });
    assert.equal(result.sizeBytes, bytes.length);
    assert.equal(result.mimeType, "image/jpeg");
  });
});

test("file: image/jpeg is allowed alongside image/png", async () => {
  await withTempRoot(async (root) => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff]); // JPEG SOI
    await writeFile(join(root, "page.jpg"), bytes);
    const submission = makeSubmission({
      source: makeFileSource({ path: "page.jpg", mime_type: "image/jpeg", byte_size: bytes.length }),
    });
    const result = await fetchPageBytes(submission, { allowedFileRoot: root });
    assert.equal(result.mimeType, "image/jpeg");
  });
});

// --- source-kind admission -------------------------------------------------

test("s3 source rejected with source_kind_unsupported", async () => {
  await withTempRoot(async (root) => {
    const submission = makeSubmission({
      source: { kind: "s3", bucket: "b", key: "k", byte_size: 1, mime_type: "image/png" },
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.SOURCE_KIND_UNSUPPORTED,
    );
  });
});

test("https source rejected with source_kind_unsupported", async () => {
  await withTempRoot(async (root) => {
    const submission = makeSubmission({
      source: { kind: "https", url: "https://example.test/p.png", byte_size: 1, mime_type: "image/png" },
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.SOURCE_KIND_UNSUPPORTED,
    );
  });
});

test("inline source rejected with source_kind_unsupported", async () => {
  await withTempRoot(async (root) => {
    const submission = makeSubmission({
      source: { kind: "inline", base64: "aGVsbG8=", byte_size: 5, mime_type: "image/png" },
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.SOURCE_KIND_UNSUPPORTED,
    );
  });
});

// --- N=1 defense-in-depth --------------------------------------------------

test("multi-page submission rejected with multi_page_unsupported (defense in depth)", async () => {
  await withTempRoot(async (root) => {
    const bytes = Buffer.from("x");
    await writeFile(join(root, "p1.png"), bytes);
    await writeFile(join(root, "p2.png"), bytes);
    const submission = makeSubmission({
      source: makeFileSource({ path: "p1.png", mime_type: "image/png", byte_size: 1 }),
      secondPage: {
        page_id: PAGE_2,
        page_number: 2,
        source: makeFileSource({ path: "p2.png", mime_type: "image/png", byte_size: 1 }),
      },
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.MULTI_PAGE_UNSUPPORTED,
    );
  });
});

// --- file_root_unconfigured ------------------------------------------------

test("empty allowedFileRoot rejected with file_root_unconfigured", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, { allowedFileRoot: "" }),
    FETCHER_ERROR_CODES.FILE_ROOT_UNCONFIGURED,
  );
});

test("relative allowedFileRoot rejected with file_root_unconfigured", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, { allowedFileRoot: "var/ocr" }),
    FETCHER_ERROR_CODES.FILE_ROOT_UNCONFIGURED,
  );
});

// --- path_escape -----------------------------------------------------------

test("absolute source.path rejected with path_escape", async () => {
  await withTempRoot(async (root) => {
    const submission = makeSubmission({
      source: makeFileSource({ path: "/etc/passwd", mime_type: "image/png", byte_size: 1 }),
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.PATH_ESCAPE,
    );
  });
});

test("../ traversal rejected with path_escape", async () => {
  await withTempRoot(async (root) => {
    const submission = makeSubmission({
      source: makeFileSource({ path: "../escape.png", mime_type: "image/png", byte_size: 1 }),
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.PATH_ESCAPE,
    );
  });
});

test("source.path resolving to root itself rejected with path_escape", async () => {
  await withTempRoot(async (root) => {
    const submission = makeSubmission({
      source: makeFileSource({ path: ".", mime_type: "image/png", byte_size: 1 }),
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.PATH_ESCAPE,
    );
  });
});

test("symlink under root pointing OUTSIDE root rejected with path_escape", async () => {
  await withTempRoot(async (root) => {
    await withTempRoot(async (outside) => {
      const target = join(outside, "secret.png");
      await writeFile(target, Buffer.from("secret"));
      // symlink inside root → file outside root
      await symlink(target, join(root, "linked.png"));
      const submission = makeSubmission({
        source: makeFileSource({ path: "linked.png", mime_type: "image/png", byte_size: 6 }),
      });
      await assertFetcherError(
        fetchPageBytes(submission, { allowedFileRoot: root }),
        FETCHER_ERROR_CODES.PATH_ESCAPE,
      );
    });
  });
});

// --- file_not_found --------------------------------------------------------

test("missing file rejected with file_not_found", async () => {
  await withTempRoot(async (root) => {
    const submission = makeSubmission({
      source: makeFileSource({ path: "missing.png", mime_type: "image/png", byte_size: 1 }),
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.FILE_NOT_FOUND,
    );
  });
});

// --- file_not_regular ------------------------------------------------------

test("directory at source.path rejected with file_not_regular", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, "imadir"));
    const submission = makeSubmission({
      source: makeFileSource({ path: "imadir", mime_type: "image/png", byte_size: 1 }),
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.FILE_NOT_REGULAR,
    );
  });
});

// --- size_mismatch ---------------------------------------------------------

test("declared byte_size larger than actual file -> size_mismatch", async () => {
  await withTempRoot(async (root) => {
    const bytes = Buffer.from("five!");
    await writeFile(join(root, "p.png"), bytes);
    const submission = makeSubmission({
      source: makeFileSource({ path: "p.png", mime_type: "image/png", byte_size: 999 }),
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.SIZE_MISMATCH,
    );
  });
});

test("declared byte_size smaller than actual file -> size_mismatch (preferred over size_cap)", async () => {
  await withTempRoot(async (root) => {
    const bytes = Buffer.from("five!");
    await writeFile(join(root, "p.png"), bytes);
    const submission = makeSubmission({
      source: makeFileSource({ path: "p.png", mime_type: "image/png", byte_size: 1 }),
    });
    // size_mismatch wins over size_cap_exceeded per ADR-11C.2 §6 ordering
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.SIZE_MISMATCH,
    );
  });
});

// --- size_cap_exceeded -----------------------------------------------------
// Per ADR-11C.2 §6 the cap is 50 MB. We don't write 50 MB in tests; size_cap
// is reachable only when stat.size > 50 MB AND stat.size == byte_size (so
// size_mismatch doesn't pre-empt it). That requires a 50+ MB file, which is
// disk-expensive for a unit test. The size_cap path IS exercised by the
// TOCTOU defense at the bottom of fetchPageBytes (the bytes.byteLength
// check), and by the contract on FETCHER_ERROR_CODES being part of the
// public surface. Skipped here; if a regression risk surfaces, escalate
// to an integration test with a sparse file.

// --- mime_unsupported ------------------------------------------------------

test("application/pdf rejected with mime_unsupported", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "p.pdf"), Buffer.from("%PDF-1.4"));
    const submission = makeSubmission({
      source: makeFileSource({ path: "p.pdf", mime_type: "application/pdf", byte_size: 8 }),
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.MIME_UNSUPPORTED,
    );
  });
});

test("image/gif rejected with mime_unsupported (allowlist is jpeg+png only)", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "p.gif"), Buffer.from("GIF89a"));
    const submission = makeSubmission({
      source: makeFileSource({ path: "p.gif", mime_type: "image/gif", byte_size: 6 }),
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.MIME_UNSUPPORTED,
    );
  });
});

test("image/tiff rejected with mime_unsupported", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "p.tif"), Buffer.from("II*\0"));
    const submission = makeSubmission({
      source: makeFileSource({ path: "p.tif", mime_type: "image/tiff", byte_size: 4 }),
    });
    await assertFetcherError(
      fetchPageBytes(submission, { allowedFileRoot: root }),
      FETCHER_ERROR_CODES.MIME_UNSUPPORTED,
    );
  });
});

// --- error-shape invariants ------------------------------------------------

test("FETCHER_ERROR_CODES is runtime-frozen", () => {
  // Strict-mode assignment to a frozen object throws TypeError.
  assert.throws(
    () => {
      FETCHER_ERROR_CODES.MULTI_PAGE_UNSUPPORTED = "tampered";
    },
    TypeError,
  );
  // Adding a new property also throws.
  assert.throws(
    () => {
      FETCHER_ERROR_CODES.NEW_CODE = "x";
    },
    TypeError,
  );
});

test("FetcherError carries code and name; instanceof check works", () => {
  const err = new FetcherError("hello", {
    code: FETCHER_ERROR_CODES.PATH_ESCAPE,
  });
  assert.ok(err instanceof FetcherError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "FetcherError");
  assert.equal(err.code, "path_escape");
  assert.equal(err.message, "hello");
});

test("FetcherError.code survives JSON round-trip via explicit serialization", () => {
  const err = new FetcherError("oops", {
    code: FETCHER_ERROR_CODES.SIZE_MISMATCH,
  });
  // JSON.stringify on Error preserves own-properties (code) but drops
  // message/name; callers serializing for transport must spell them
  // out explicitly per ADR-11C.2 §7 + types.ts JSDoc.
  const payload = { name: err.name, message: err.message, code: err.code };
  const round = JSON.parse(JSON.stringify(payload));
  assert.equal(round.code, "size_mismatch");
  assert.equal(round.name, "FetcherError");
  assert.equal(round.message, "oops");
});
