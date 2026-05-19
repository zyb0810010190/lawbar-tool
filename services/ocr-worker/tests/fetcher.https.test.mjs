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

// Default test deps stub the DNS lookup so happy-path tests don't
// hit the system resolver AND don't depend on TEST-NET-3 being
// treated as public (it's not, per the updated blocklist).
const defaultDnsStub = async () => [{ address: "8.8.8.8", family: 4 }];

const deps = (overrides = {}) => ({
  allowedFileRoot: "/tmp/unused-for-https",
  allowedHttpsHosts: new Set(["203.0.113.5"]),
  dnsLookup: defaultDnsStub,
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

// Stub DNS lookup helper — returns canned addresses deterministically.
// Audit 019e3af0 D7 fix: previous tests relied on the system resolver
// for "localhost" + a documentation IP; replaced with the DNS seam.
function stubDns(addresses) {
  return async (_hostname) => addresses;
}

test("DNS seam: resolved 127.0.0.1 (loopback) rejected with host_resolves_to_private_ip", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: stubDns([{ address: "127.0.0.1", family: 4 }]),
    })),
    FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP,
  );
});

test("DNS seam: resolved 192.168.1.5 (RFC1918) rejected", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: stubDns([{ address: "192.168.1.5", family: 4 }]),
    })),
    FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP,
  );
});

test("DNS seam: resolved 169.254.169.254 (cloud metadata) rejected", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: stubDns([{ address: "169.254.169.254", family: 4 }]),
    })),
    FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP,
  );
});

test("DNS seam: resolved 203.0.113.5 (TEST-NET-3) NOW rejected (audit 019e3af0 D2 M policy fix)", async () => {
  // Previous code allowed TEST-NET ranges as 'public'. New policy:
  // any non-globally-routable address blocks. TEST-NET docs are
  // out per RFC 5737.
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: stubDns([{ address: "203.0.113.5", family: 4 }]),
    })),
    FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP,
  );
});

test("DNS seam: mixed v4 public + v6 link-local — ANY private addr rejects", async () => {
  // Mixed-family rebinding: attacker returns one safe public-looking
  // v4 + one v6 link-local. Defense must reject if ANY address is
  // non-routable, not just the first.
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: stubDns([
        { address: "8.8.8.8", family: 4 },
        { address: "fe80::1", family: 6 },
      ]),
    })),
    FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP,
  );
});

test("DNS seam: IPv4-mapped IPv6 hex form (::ffff:7f00:1 = loopback) rejected (audit 019e3af0 D2 H)", async () => {
  // Previous code only handled dotted form `::ffff:127.0.0.1`; hex
  // form `::ffff:7f00:1` slipped through and could connect to
  // loopback via an AAAA-mapped DNS answer.
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: stubDns([{ address: "::ffff:7f00:1", family: 6 }]),
    })),
    FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP,
  );
});

test("DNS seam: IPv4-mapped IPv6 dotted form (::ffff:127.0.0.1) rejected", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: stubDns([{ address: "::ffff:127.0.0.1", family: 6 }]),
    })),
    FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP,
  );
});

test("DNS seam: empty address set rejected with https_network_error", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: stubDns([]),
    })),
    FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR,
  );
});

test("DNS seam: lookup throws -> https_network_error", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: async () => { throw new Error("EAI_NONAME"); },
    })),
    FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR,
  );
});

test("DNS seam: only-public address accepted (happy path with stub DNS)", async () => {
  const submission = makeSubmission();
  const result = await fetchPageBytes(submission, deps({
    httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
    dnsLookup: stubDns([{ address: "8.8.8.8", family: 4 }]),
  }));
  assert.equal(result.sizeBytes, PNG_HEADER.length);
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

test("non-200 status 404 rejected with https_client_error_4xx (ADR-11E §2 split)", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 404,
        headers: new Headers(),
        body: syntheticBody(Buffer.from("not found")),
      }),
    })),
    FETCHER_ERROR_CODES.HTTPS_CLIENT_ERROR_4XX,
  );
});

test("non-200 status 401 rejected with https_client_error_4xx", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 401, headers: new Headers(), body: syntheticBody(Buffer.from("unauthorized")),
      }),
    })),
    FETCHER_ERROR_CODES.HTTPS_CLIENT_ERROR_4XX,
  );
});

test("non-200 status 500 rejected with https_server_error_5xx (transient)", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 500, headers: new Headers(), body: syntheticBody(Buffer.from("oops")),
      }),
    })),
    FETCHER_ERROR_CODES.HTTPS_SERVER_ERROR_5XX,
  );
});

test("non-200 status 503 rejected with https_server_error_5xx", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 503, headers: new Headers(), body: syntheticBody(Buffer.from("busy")),
      }),
    })),
    FETCHER_ERROR_CODES.HTTPS_SERVER_ERROR_5XX,
  );
});

test("non-200 status 204 (no content) rejected with https_status_unexpected (audit 019e3b1f D1 M)", async () => {
  // 204 No Content is in the 2xx family but not 200. Code now
  // honestly reflects "unexpected status family" rather than
  // mislabeling as 4xx.
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 204, headers: new Headers(), body: syntheticBody(Buffer.alloc(0)),
      }),
    })),
    FETCHER_ERROR_CODES.HTTPS_STATUS_UNEXPECTED,
  );
});

test("status 206 (partial content) rejected with https_status_unexpected", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 206, headers: new Headers(), body: syntheticBody(Buffer.from("partial")),
      }),
    })),
    FETCHER_ERROR_CODES.HTTPS_STATUS_UNEXPECTED,
  );
});

test("status 600+ (non-standard) rejected with https_status_unexpected", async () => {
  const submission = makeSubmission();
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport({
        status: 699, headers: new Headers(), body: syntheticBody(Buffer.alloc(0)),
      }),
    })),
    FETCHER_ERROR_CODES.HTTPS_STATUS_UNEXPECTED,
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

test("malformed URL rejected with url_malformed (audit 019e3af0 D1 M)", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ url: "not a url" }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({ httpsTransport: makeStubTransport(okResponse(PNG_HEADER)) })),
    FETCHER_ERROR_CODES.URL_MALFORMED,
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

test("expected_sha256: uppercase hex accepted (case-insensitive compare)", async () => {
  // Audit 019e3af0 verify L-D7: the previous test was named
  // "case-insensitive match accepted" but only ever passed
  // lowercase input. This actually tests the case-insensitivity
  // by passing the SHA in UPPERCASE; the fetcher's pre-network
  // shape check normalizes via toLowerCase + then the post-fetch
  // comparison also normalizes both sides.
  const sha = createHash("sha256").update(PNG_HEADER).digest("hex");
  const upperSha = sha.toUpperCase();
  const submission = makeSubmission({
    source: makeHttpsSource({ expected_sha256: upperSha }),
  });
  const result = await fetchPageBytes(submission, deps({
    httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
  }));
  assert.equal(result.sizeBytes, PNG_HEADER.length);
});

test("expected_sha256: lowercase matching value accepted (happy path)", async () => {
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

// --- audit 019e3af0 D3 Medium fixes ---------------------------------------

test("https: byte_size missing rejected pre-network with size_mismatch (audit 019e3af0 D3 M)", async () => {
  const submission = makeSubmission({
    source: {
      kind: "https",
      url: "https://203.0.113.5/p.png",
      mime_type: "image/png",
      // byte_size intentionally omitted
    },
  });
  let dnsLookupCalled = false;
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: async () => { dnsLookupCalled = true; return [{ address: "8.8.8.8", family: 4 }]; },
    })),
    FETCHER_ERROR_CODES.SIZE_MISMATCH,
  );
  assert.equal(dnsLookupCalled, false, "byte_size check must run before DNS");
});

test("https: expected_sha256 with wrong length (32 hex = MD5) rejected pre-network (audit 019e3af0 D3 M)", async () => {
  // Schema admits 32-128 hex; fetcher only computes SHA-256 (64).
  // A 32-char value can never match — reject up front rather than
  // doing the round-trip just to surface a confusing
  // content_hash_mismatch.
  const submission = makeSubmission({
    source: makeHttpsSource({ expected_sha256: "0".repeat(32) }),
  });
  let dnsLookupCalled = false;
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
      dnsLookup: async () => { dnsLookupCalled = true; return [{ address: "8.8.8.8", family: 4 }]; },
    })),
    FETCHER_ERROR_CODES.CONTENT_HASH_MISMATCH,
  );
  assert.equal(dnsLookupCalled, false, "expected_sha256 shape check must run before DNS");
});

test("https: expected_sha256 with 128 hex (SHA-512) rejected pre-network", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ expected_sha256: "0".repeat(128) }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
    })),
    FETCHER_ERROR_CODES.CONTENT_HASH_MISMATCH,
  );
});

test("https: expected_sha256 with non-hex chars rejected pre-network", async () => {
  const submission = makeSubmission({
    source: makeHttpsSource({ expected_sha256: "X".repeat(64) }),
  });
  await assertFetcherError(
    fetchPageBytes(submission, deps({
      httpsTransport: makeStubTransport(okResponse(PNG_HEADER)),
    })),
    FETCHER_ERROR_CODES.CONTENT_HASH_MISMATCH,
  );
});

// --- audit 019e3af0 D3 High: single deadline covers body streaming --------

test("https: stalled body stream eventually aborts with https_timeout (audit 019e3af0 D3 H)", async (t) => {
  // Need to mock setTimeout cycles? Simpler: rely on a body that
  // never yields after the first chunk + an explicit abort signal.
  // The fetcher's controller fires after 30s; we shortcut by
  // making the body iterator wait on a never-resolving promise
  // BUT abort when the controller fires.
  //
  // To avoid real 30s waits, we install our OWN AbortController in
  // the body and trigger it manually after a tick. The deadline is
  // intrinsic to the fetcher; we test that the body iteration
  // RESPECTS the signal by simulating a controller abort.
  //
  // Approach: stub transport returns a body whose iterator awaits
  // a controller-aborted promise. After a tick, manually abort.
  // The fetcher catches the AbortError and maps to https_timeout.
  let externalController;
  const stallingBody = {
    async *[Symbol.asyncIterator]() {
      yield PNG_HEADER; // first chunk arrives
      // Then stall awaiting our controller — abort it externally.
      await new Promise((_resolve, reject) => {
        externalController = new AbortController();
        externalController.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    },
  };
  const submission = makeSubmission();
  // Kick off the fetch; abort the stalling body shortly after.
  const promise = fetchPageBytes(submission, deps({
    httpsTransport: makeStubTransport({
      status: 200,
      headers: new Headers(),
      body: stallingBody,
    }),
  }));
  // Give the loop a microtask to start iterating before we abort.
  await new Promise((r) => setTimeout(r, 5));
  externalController?.abort();
  await assertFetcherError(promise, FETCHER_ERROR_CODES.HTTPS_TIMEOUT);
});

// ---------------------------------------------------------------------------
// WI-02 seam: fetcher passes vetted addresses to httpsTransport.fetch
// ---------------------------------------------------------------------------
//
// These tests assert the CONTRACT at the fetcher/transport seam that
// WI-02 must establish: after DNS resolution + private-IP screening,
// the fetcher must pass the surviving addresses to the transport via
// an `allowedAddresses: ReadonlyArray<DnsAddress>` field on the init
// argument, preserving order (no re-sort by family).
//
// Currently the fetcher passes only `{ signal }` to transport.fetch,
// so these tests will FAIL until WI-02 ships. They are kept here
// (skipped) so the seam contract is reviewable in source and so that
// reverting WI-02 in the future fails CI loudly. Skip reason names
// WI-02 as the unlocker.

function makeRecordingTransport(response) {
  const calls = [];
  return {
    calls,
    async fetch(url, init) {
      calls.push({ url: url.toString(), init });
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

test(
  "WI-02 seam: fetcher passes a single vetted DNS address to transport.allowedAddresses",
  { skip: "Unlocked by WI-02 (fetcher must propagate allowedAddresses to transport)" },
  async () => {
    const submission = makeSubmission();
    const transport = makeRecordingTransport(okResponse(PNG_HEADER));
    await fetchPageBytes(
      submission,
      deps({
        httpsTransport: transport,
        dnsLookup: async () => [{ address: "8.8.8.8", family: 4 }],
      }),
    );
    assert.equal(transport.calls.length, 1);
    const { init } = transport.calls[0];
    assert.ok(Array.isArray(init.allowedAddresses), "expected allowedAddresses array");
    assert.equal(init.allowedAddresses.length, 1);
    assert.deepEqual(init.allowedAddresses[0], { address: "8.8.8.8", family: 4 });
  },
);

test(
  "WI-02 seam: multi-address DNS preserves DNS order in allowedAddresses (no transport re-sort)",
  { skip: "Unlocked by WI-02" },
  async () => {
    // URL host MUST match the overridden allowlist or the fetcher
    // short-circuits with host_not_allowlisted before DNS is even
    // consulted. The fetcher always invokes deps.dnsLookup on the
    // hostname (no IP-literal bypass), so it is sufficient that the
    // URL host equals an allowlist entry.
    const submission = makeSubmission({
      source: { kind: "https", url: "https://example.test/page.png", byte_size: PNG_HEADER.length, mime_type: "image/png" },
    });
    const transport = makeRecordingTransport(okResponse(PNG_HEADER));
    let dnsCalls = 0;
    // DNS returns IPv6 FIRST then IPv4. The fetcher must NOT re-sort
    // by family — ordering is the fetcher's contract with the
    // transport; per ADR §4 the transport selects entry[0].
    //
    // Fixtures must be GLOBALLY ROUTABLE (not on privateIp.ts blocklist),
    // or the fetcher's existing post-DNS private-IP screen rejects the
    // call before reaching the seam. Documentation ranges (TEST-NET-1/2/3,
    // 2001:db8::/32) are explicitly blocked; using them here would cause
    // a false host_resolves_to_private_ip failure on un-skip and mask
    // any real seam bug. Public DNS resolver literals are safe choices
    // since they are real-world routable and have no side effects in a
    // stub-transport test.
    await fetchPageBytes(
      submission,
      deps({
        httpsTransport: transport,
        allowedHttpsHosts: new Set(["example.test"]),
        dnsLookup: async () => {
          dnsCalls += 1;
          return [
            { address: "2001:4860:4860::8888", family: 6 },
            { address: "1.1.1.1", family: 4 },
          ];
        },
      }),
    );
    assert.equal(dnsCalls, 1, "fetcher must consult DNS exactly once for this hostname");
    assert.equal(transport.calls.length, 1);
    const { init } = transport.calls[0];
    assert.deepEqual(init.allowedAddresses, [
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "1.1.1.1", family: 4 },
    ]);
  },
);

test(
  "WI-02 seam: private addresses are filtered out BEFORE the transport receives allowedAddresses",
  { skip: "Unlocked by WI-02" },
  async () => {
    // Mixed public + private DNS answer: fetcher's existing
    // host_resolves_to_private_ip path rejects the call before
    // reaching transport. The transport must NOT be called at all,
    // because surfacing a public-only subset would mask the private
    // address and weaken SSRF defense (ADR §1 "no quiet subsetting").
    const submission = makeSubmission();
    const transport = makeRecordingTransport(okResponse(PNG_HEADER));
    await assertFetcherError(
      fetchPageBytes(
        submission,
        deps({
          httpsTransport: transport,
          dnsLookup: async () => [
            { address: "8.8.8.8", family: 4 },
            { address: "10.0.0.5", family: 4 },
          ],
        }),
      ),
      FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP,
    );
    assert.equal(transport.calls.length, 0, "transport must not be called when any DNS answer is private");
  },
);
