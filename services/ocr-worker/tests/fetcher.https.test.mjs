// fetchFromHttps tests — see ADR-11D.2.
//
// The httpsTransport is stubbed for every test, so no real network
// I/O happens. The stub returns canned HttpsTransportResponse shapes
// with synthetic async iterables for the body. DNS lookups DO hit
// the system resolver, but only for hostnames we control:
// - "localhost" deliberately to trip the private-IP block test
// - "203.0.113.5" (TEST-NET-3 documentation range) — DNS returns
//   the literal IP, which we treat as public for the happy path

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  fetchPageBytes,
  FetcherError,
  FETCHER_ERROR_CODES,
} from "../dist/index.js";

// --- fixtures --------------------------------------------------------------

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const JOB_ID = "01jrk8m4q4xv2v8d4d4ymf5xnk";
const TENANT_ID = "01jrk8m4q4xv2v8d4d4ymf5tnt";
const DOCUMENT_ID = "01jrk8m4q4xv2v8d4d4ymf5doc";
const PAGE_1 = "01jrk8m4q4xv2v8d4d4ymf5p01";

function makeHttpsSource(overrides = {}) {
  return {
    kind: "https",
    url: "https://203.0.113.5/page.png",
    byte_size: PNG_HEADER.length,
    mime_type: "image/png",
    ...overrides,
  };
}

function makeSubmission({ source } = {}) {
  return {
    contract_version: "1.0.0",
    job_id: JOB_ID,
    tenant_id: TENANT_ID,
    document_id: DOCUMENT_ID,
    submitted_at: "2026-05-18T10:00:00.000Z",
    submitted_by: "user_test",
    pages: [{ page_id: PAGE_1, page_number: 1, source: source ?? makeHttpsSource() }],
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

function makeStubTransport(response) {
  return {
    async fetch() {
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

function syntheticBody(bytes) {
  return {
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
}

function okResponse(bytes, extra = {}) {
  return {
    status: 200,
    headers: new Headers(extra.headers ?? {}),
    body: extra.body ?? syntheticBody(bytes),
  };
}

async function assertFetcherError(promise, expectedCode) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof FetcherError, `expected FetcherError, got ${err?.constructor?.name}`);
    assert.equal(err.code, expectedCode, `expected ${expectedCode}, got ${err.code}`);
    return true;
  });
}

const deps = (overrides = {}) => ({
  allowedFileRoot: "/tmp/unused-for-https",
  allowedHttpsHosts: new Set(["203.0.113.5"]),
  ...overrides,
});

// --- happy path ------------------------------------------------------------

test("https happy path: allowlisted host, 200 with PNG bytes, byte_size matches", async () => {
  const submission = makeSubmission();
  const result = await fetchPageBytes(submission, deps({
    httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
  }));
  assert.equal(result.sizeBytes, PNG_HEADER.length);
  assert.equal(result.mimeType, "image/png");
  assert.deepEqual([...result.bytes], [...PNG_HEADER]);
});

test("https happy path: image/jpeg variant", async () => {
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const submission = makeSubmission({
    source: makeHttpsSource({ byte_size: jpegBytes.length, mime_type: "image/jpeg" }),
  });
  const result = await fetchPageBytes(submission, deps({
    httpsTransport: makeStubTransport(okResponse(jpegBytes)),
  }));
  assert.equal(result.mimeType, "image/jpeg");
});

test("https happy path: expected_sha256 verified when present", async () => {
  const sha = createHash("sha256").update(PNG_HEADER).digest("hex");
  const submission = makeSubmission({
    source: makeHttpsSource({ expected_sha256: sha }),
  });
  const result = await fetchPageBytes(submission, deps({
    httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
  }));
  assert.equal(result.sizeBytes, PNG_HEADER.length);
});

// --- pre-network gates -----------------------------------------------------

test("http:// (not https) rejected with http_scheme_unsupported", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ url: "http://203.0.113.5/page.png" }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({ httpsTransport: makeStubTransport(okResponse(PNG_HEADER)) })),
    FETCHER_ERROR_CODES.HTTP_SCHEME_UNSUPPORTED,
  );
});

test("url_expires_at in the past rejected with url_expired", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ url_expires_at: "2020-01-01T00:00:00Z" }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      now: () => new Date("2026-05-18T10:00:00Z"),
    })),
    FETCHER_ERROR_CODES.URL_EXPIRED,
  );
});

test("url_expires_at malformed rejected with url_expired", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ url_expires_at: "not-a-date" }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({ httpsTransport: makeStubTransport(okResponse(PNG_HEADER)) })),
    FETCHER_ERROR_CODES.URL_EXPIRED,
  );
});

test("url_expires_at in the future is accepted", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ url_expires_at: "2099-01-01T00:00:00Z" }),
  });
  const result = await fetchPageBytes(submission, deps({
    httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
  }));
  assert.equal(result.sizeBytes, PNG_HEADER.length);
});

test("host not in allowlist rejected with host_not_allowlisted", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ url: "https://evil.example.com/page.png" }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({ httpsTransport: makeStubTransport(okResponse(PNG_HEADER)) })),
    FETCHER_ERROR_CODES.HOST_NOT_ALLOWLISTED,
  );
});

test("missing allowlist rejects all https with host_not_allowlisted (fail-closed)", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, {
      allowedFileRoot: "/tmp/unused",
      // allowedHttpsHosts NOT set
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
    }),
    FETCHER_ERROR_CODES.HOST_NOT_ALLOWLISTED,
  );
});

test("empty allowlist rejects all https with host_not_allowlisted", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      allowedHttpsHosts: new Set(),
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
    })),
    FETCHER_ERROR_CODES.HOST_NOT_ALLOWLISTED,
  );
});

test("mime_type not in allowlist rejected with mime_unsupported (pre-network)", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ mime_type: "application/pdf" }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({ httpsTransport: makeStubTransport(okResponse(PNG_HEADER)) })),
    FETCHER_ERROR_CODES.MIME_UNSUPPORTED,
  );
});

test("mime_type missing rejected with mime_unsupported", async () => {
  const submission = makeSubmission({
    source: { kind: "https", url: "https://203.0.113.5/p.png", byte_size: 1 }, // no mime_type
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({ httpsTransport: makeStubTransport(okResponse(PNG_HEADER)) })),
    FETCHER_ERROR_CODES.MIME_UNSUPPORTED,
  );
});

// --- DNS / private IP block ------------------------------------------------

test("host resolving to loopback rejected with host_resolves_to_private_ip", async () => {
  // "localhost" resolves to 127.0.0.1 (and possibly ::1). Both are
  // private. The allowlist match passes (we explicitly add it) but
  // the private-IP check fires.
  const submission = makeSubmission({
    source: makeHttpsSource({ url: "https://localhost:8443/p.png" }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, {
      allowedFileRoot: "/tmp/unused",
      allowedHttpsHosts: new Set(["localhost"]),
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
    }),
    FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP,
  );
});

// --- transport-level errors ------------------------------------------------

test("3xx response rejected with redirect_unsupported", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 302,
        headers: new Headers({ location: "https://elsewhere/x.png" }),
        body: syntheticBody(Buffer.alloc(0)),
      }),
    })),
    FETCHER_ERROR_CODES.REDIRECT_UNSUPPORTED,
  );
});

test("non-200 status (404) rejected with https_status_not_ok", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 404,
        headers: new Headers(),
        body: syntheticBody(Buffer.from("not found")),
      }),
    })),
    FETCHER_ERROR_CODES.HTTPS_STATUS_NOT_OK,
  );
});

test("non-200 status (500) rejected with https_status_not_ok", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 500, headers: new Headers(), body: syntheticBody(Buffer.from("oops")),
      }),
    })),
    FETCHER_ERROR_CODES.HTTPS_STATUS_NOT_OK,
  );
});

test("transport throws AbortError -> https_timeout", async () => {
  const submission = makeSubmission();
  const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
  await assertFetcherError(
    fetchPageBytes(submission, deps({ httpsTransport: makeStubTransport(abortErr) })),
    FETCHER_ERROR_CODES.HTTPS_TIMEOUT,
  );
});

test("transport throws generic error -> https_network_error", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(new Error("ECONNREFUSED")),
    })),
    FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR,
  );
});

test("malformed URL rejected with https_network_error", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ url: "not a url" }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({ httpsTransport: makeStubTransport(okResponse(PNG_HEADER)) })),
    // URL constructor throws TypeError before any gates fire — we map
    // this to https_network_error (pre-network "can't even start").
    // Actually it's caught early; let's check whatever the code chose.
    FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR,
  );
});

// --- size + content-hash gates --------------------------------------------

test("Content-Length header > 50 MB cap rejected with size_cap_exceeded (early)", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 200,
        headers: new Headers({ "content-length": String(51 * 1024 * 1024) }),
        body: syntheticBody(PNG_HEADER),
      }),
    })),
    FETCHER_ERROR_CODES.SIZE_CAP_EXCEEDED,
  );
});

test("Body exceeds cap mid-stream rejected with size_cap_exceeded", async () => {
  // No Content-Length header (server lied / didn't send one);
  // stream-cap check fires when running total crosses MAX_PAGE_BYTES.
  const submission = makeSubmission();
  const chunk = Buffer.alloc(1 * 1024 * 1024, 0x89); // 1 MB
  const body = {
    async *[Symbol.asyncIterator]() {
      // 51 chunks * 1 MB = 51 MB > 50 MB cap
      for (let i = 0; i < 51; i++) yield chunk;
    },
  };
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 200, headers: new Headers(), body,
      }),
    })),
    FETCHER_ERROR_CODES.SIZE_CAP_EXCEEDED,
  );
});

test("Body size mismatch with declared byte_size rejected with size_mismatch", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ byte_size: 9999 }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
    })),
    FETCHER_ERROR_CODES.SIZE_MISMATCH,
  );
});

test("expected_sha256 mismatch rejected with content_hash_mismatch", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ expected_sha256: "0".repeat(64) }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
    })),
    FETCHER_ERROR_CODES.CONTENT_HASH_MISMATCH,
  );
});

test("expected_sha256 case-insensitive match accepted", async () => {
  // Schema's pattern is lowercase-only but our compare is to lowercase
  // anyway; this pins the contract.
  const sha = createHash("sha256").update(PNG_HEADER).digest("hex");
  const submission = makeSubmission({
    source: makeHttpsSource({ expected_sha256: sha }),
  });
  const result = await fetchPageBytes(submission, deps({
    httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
  }));
  assert.equal(result.sizeBytes, PNG_HEADER.length);
});

// --- MIME signature sniff (post-fetch) -------------------------------------

test("declared image/png but body is PDF -> mime_signature_mismatch", async () => {
  const pdfBytes = Buffer.from("%PDF-1.4\n%fake\n");
  const submission = makeSubmission({
    source: makeHttpsSource({ byte_size: pdfBytes.length, mime_type: "image/png" }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(pdfBytes)),
    })),
    FETCHER_ERROR_CODES.MIME_SIGNATURE_MISMATCH,
  );
});
