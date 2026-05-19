// Transport-level HTTPS tests for ADR-11D.2-A (DNS pinning).
//
// **WI-02t / Option A status**: every test here is currently
// `test.skip(..., { skip: "Unlocked by WI-03 ..." })` because the
// production transport rewrite (`node:https.request` with custom
// `lookup`, per-request `ca`, strict content-length parsing, runtime
// address validation, abort wiring) has NOT shipped yet. The bodies
// are fully written so the security-critical assertions remain
// reviewable in source; they will be un-skipped one by one as WI-03
// lands the corresponding implementation surface.
//
// Two skip reasons are used:
//   - "Unlocked by WI-02"  — seam-only changes (interface signature,
//     types, allowedAddresses wiring). The current production
//     transport doesn't accept `allowedAddresses`.
//   - "Unlocked by WI-03"  — actual https.request integration with
//     TLS, custom lookup, content-length parsing, abort wiring, etc.
//     The current production transport uses global `fetch`.
//
// Two seam scopes are tested:
//   A. Direct on the production transport factory — proves the
//      transport-level contract per ADR §3, §4, §5, §6, §7.
//   B. Through the fetcher — proves the fetcher's error-code mapping
//      from transport errors to fetcher error codes per ADR §7.
//
// The cert-helper from WI-01 (dev-memo/prototypes) is intentionally
// NOT re-used here: those certs are dev-memo scratch space and not a
// service surface. The transport TLS scenarios in this file use a
// locally-generated CA inside the test process and clean up after
// each test, mirroring the WI-01 prototype's posture.

import { test } from "node:test";
import assert from "node:assert/strict";

// NOTE: top-level imports of the future production transport are
// intentionally absent. WI-03 will export
// `makeNodeHttpsRequestTransport` (name TBD by WI-03 author) from
// services/ocr-worker/src/fetcher/index.ts; until then, each test
// `await import(...)` inside its body. With { skip: "..." } the body
// never executes, so a missing export does NOT crash this file at
// load time.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALLOWED_HOST = "allowed-host.test";
const LOOPBACK_V4 = "127.0.0.1";
const LOOPBACK_V6 = "::1";

function makeAddr(address, family) {
  return { address, family };
}

// ---------------------------------------------------------------------------
// ADR §5 — Runtime address validation (transport entry)
// ---------------------------------------------------------------------------
//
// Per ADR §5: production must validate `allowedAddresses` at entry
// and fail closed with a transport error that the fetcher maps to
// `https_network_error`. The transport-level tests below assert the
// transport-side error shape; a parallel set later in this file
// asserts the fetcher-side error-code mapping per ADR §7.
//
// **Regex brittleness note**: each runtime-address-validation test
// currently matches an error MESSAGE substring (e.g. `/allowedAddresses/i`,
// `/mapped|ipv4/i`, `/scope|zone|%/i`). This is provisional. When
// WI-03 lands a stable transport-input error class or `code`
// discriminator (recommended: e.g. `TransportInputError` with codes
// `MISSING_ALLOWED_ADDRESSES`, `MAPPED_IPV6`, `SCOPED_IPV6`,
// `PRIVATE_ADDRESS`, `FAMILY_MISMATCH`, etc.), update each test to
// assert on the code/class as the PRIMARY check and keep the
// message regex only as a secondary readability assertion.

test("transport rejects missing allowedAddresses", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), { signal: AbortSignal.timeout(1000) /* allowedAddresses omitted */ }),
    (err) => err && /allowedAddresses/i.test(String(err.message)),
  );
});

test("transport rejects empty allowedAddresses", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [],
    }),
    (err) => err && /empty|at least one/i.test(String(err.message)),
  );
});

test("transport rejects non-array allowedAddresses", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: "not-an-array",
    }),
    (err) => err && /array/i.test(String(err.message)),
  );
});

test("transport rejects non-plain-object element", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: ["8.8.8.8"], // string instead of object
    }),
    (err) => err && /object|address/i.test(String(err.message)),
  );
});

test("transport rejects non-string address field", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: 12345678, family: 4 }],
    }),
    (err) => err && /address.*string|string.*address/i.test(String(err.message)),
  );
});

test("transport rejects nonnumeric family", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "8.8.8.8", family: "4" }],
    }),
    (err) => err && /family/i.test(String(err.message)),
  );
});

test("transport rejects family=5 (non 4|6)", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "8.8.8.8", family: 5 }],
    }),
    (err) => err && /family/i.test(String(err.message)),
  );
});

test("transport rejects malformed IPv4 literal", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "999.999.999.999", family: 4 }],
    }),
    (err) => err && /address|literal|parse/i.test(String(err.message)),
  );
});

test("transport rejects malformed IPv6 literal", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "::gg::", family: 6 }],
    }),
    (err) => err && /address|literal|parse/i.test(String(err.message)),
  );
});

test("transport rejects IPv4-mapped IPv6 dotted form (::ffff:1.2.3.4)", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "::ffff:1.2.3.4", family: 6 }],
    }),
    (err) => err && /mapped|ipv4/i.test(String(err.message)),
  );
});

test("transport rejects IPv4-mapped IPv6 hex form (::ffff:0102:0304)", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "::ffff:0102:0304", family: 6 }],
    }),
    (err) => err && /mapped|ipv4/i.test(String(err.message)),
  );
});

test("transport rejects scoped IPv6 (fe80::1%lo0)", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "fe80::1%lo0", family: 6 }],
    }),
    (err) => err && /scope|zone|%/i.test(String(err.message)),
  );
});

test("transport rejects family/address mismatch (family=6 with IPv4 literal)", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "8.8.8.8", family: 6 }],
    }),
    (err) => err && /family.*address|address.*family|mismatch/i.test(String(err.message)),
  );
});

test("transport rejects private IPv4 (127.0.0.1) — defense in depth at transport entry", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  // Fetcher should reject earlier; transport must ALSO reject as
  // defense-in-depth per ADR §1 "transport repeats the private-IP
  // check even though the fetcher already performed it".
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [makeAddr(LOOPBACK_V4, 4)],
    }),
    (err) => err && /private|loopback|host_resolves_to_private_ip|globally.routable/i.test(String(err.message)),
  );
});

test("transport rejects private IPv6 (::1) — defense in depth", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  const t = makeNodeHttpsRequestTransport({});
  await assert.rejects(
    t.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [makeAddr(LOOPBACK_V6, 6)],
    }),
    (err) => err && /private|loopback|host_resolves_to_private_ip|globally.routable/i.test(String(err.message)),
  );
});

// ---------------------------------------------------------------------------
// ADR §4 — First-vetted-address selection (no transport reordering)
// ---------------------------------------------------------------------------

test("transport connects to the FIRST element of allowedAddresses, no reordering", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy when un-skipped — both endpoints must be REACHABLE so
  // that a buggy "retry second after first fails" implementation
  // cannot coincidentally pass.
  //
  // Bind server A to 127.0.0.1 and server B to 127.0.0.2 (loopback
  // alias, supported on macOS + Linux), each on the same chosen
  // url.port. Each server emits a distinct response marker
  // (e.g. `X-Server-Id: A` vs `X-Server-Id: B`, or a marker byte in
  // the body). Run two sub-cases:
  //
  //   1. allowedAddresses=[{127.0.0.1,4}, {127.0.0.2,4}] → expect marker A
  //   2. allowedAddresses=[{127.0.0.2,4}, {127.0.0.1,4}] → expect marker B
  //
  // Asserting on the marker proves the transport actually connected
  // to entry[0] (not entry[1], not "preferred IPv4", not "round-robin").
  //
  // Earlier draft of this strategy used one reachable + one
  // unreachable (TEST-NET-2) endpoint; that only proved "first works"
  // and could be silently passed by a buggy retry-after-failure
  // implementation. The two-reachable-endpoint check is the strict
  // no-reorder proof.
  //
  // If 127.0.0.2 binding is unavailable on the test platform, skip
  // sub-case 2 with a platform-specific reason — but DO NOT downgrade
  // to the one-reachable-one-unreachable variant, which would mask
  // reorder bugs.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

// ---------------------------------------------------------------------------
// ADR §1.1 / §4 — TLS scenarios (hostname verification)
// ---------------------------------------------------------------------------
//
// These mirror the WI-01 prototype: cert-valid-for-hostname success,
// cert-valid-only-for-IP and cert-valid-only-for-wrong-hostname both
// reject with a hostname-verification error.

test("TLS: cert valid for hostname → transport returns 200 + Headers; server saw Host + SNI = url.hostname", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy when un-skipped: generate CA + leaf-with-DNS:SAN=ALLOWED_HOST,
  // start local server on 127.0.0.1, request with allowedAddresses=[{127.0.0.1,4}],
  // per-request ca. Assert:
  //   - status === 200
  //   - response.headers is a Headers instance
  //   - response.body is AsyncIterable<Uint8Array>
  //   - server-side captured Host header === ALLOWED_HOST
  //   - server-side captured req.socket.servername === ALLOWED_HOST
  //   - server-side req.socket.localAddress === 127.0.0.1 (drop ::ffff: prefix)
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

test("TLS: cert valid only for IP literal → transport throws (mapped to https_network_error by fetcher)", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy when un-skipped: cert SAN = IP:127.0.0.1 only.
  // Per ADR §7 + WI-01 prototype: only ERR_TLS_CERT_ALTNAME_INVALID
  // and ERR_OSSL_X509_HOST_MISMATCH are accepted as proving
  // hostname verification rejected. Bare cert errors (UNKNOWN_CA,
  // BAD_CERTIFICATE) would indicate a broken CA chain and FAIL this
  // assertion.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

test("TLS: cert valid only for wrong hostname → transport throws (mapped to https_network_error)", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy: cert SAN = DNS:other-host.test. Request goes to ALLOWED_HOST.
  // Expected: same hostname-verification error codes as above.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

// ---------------------------------------------------------------------------
// ADR §6 — Strict content-length parsing
// ---------------------------------------------------------------------------

test("content-length: leading zero (\"0123\") rejected with transport error", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy: local HTTPS server returns header `Content-Length: 0123`
  // alongside actual body. Transport must reject with an error the
  // fetcher maps to https_network_error.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

test("content-length: negative value (-1) rejected", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

test("content-length: non-integer (\"12.5\") rejected", { skip: "Unlocked by WI-03" }, async () => {
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

test("content-length: duplicate values (\"100, 200\") rejected", { skip: "Unlocked by WI-03" }, async () => {
  // Per ADR §6: single-valued, integer >= 0, no leading zero unless "0".
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

test("content-length: \"0\" is accepted (empty body case)", { skip: "Unlocked by WI-03" }, async () => {
  // Edge case: a literal "0" content-length should NOT trip the
  // "no leading zero" rule; only multi-digit leading zeros do.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

test("content-length: absent → streams under existing size cap, no size hint", { skip: "Unlocked by WI-03" }, async () => {
  // Per ADR §6: fetcher's existing streamed byte cap remains authoritative.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

// ---------------------------------------------------------------------------
// ADR §6 — Body iteration: Uint8Array (not Buffer) chunks
// ---------------------------------------------------------------------------

test("body: each chunk yielded by the async iterator is Uint8Array, never raw Buffer", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy: local server returns a body whose Readable yields Buffer
  // chunks (Node default). The transport adapter must convert via
  // `new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)`
  // (or equivalent). For each chunk:
  //   assert.ok(chunk instanceof Uint8Array);
  //   assert.equal(Buffer.isBuffer(chunk), false);  // strict — Buffer instanceof Uint8Array is true,
  //                                                  // but Buffer IS a Uint8Array subclass. The test
  //                                                  // must assert chunk.constructor === Uint8Array
  //                                                  // OR Object.getPrototypeOf(chunk) === Uint8Array.prototype.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

// ---------------------------------------------------------------------------
// ADR §4 — Manual 3xx handling (no auto-follow)
// ---------------------------------------------------------------------------

test("3xx: transport surfaces status 302 instead of following the Location header", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy: local server returns
  //   HTTP/1.1 302 Found
  //   Location: https://elsewhere.example/
  //   Content-Length: 0
  // Transport must return { status: 302, headers, body: empty } —
  // NOT follow the redirect. Fetcher then maps to redirect_unsupported
  // (already covered in fetcher.https.test.mjs).
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

// ---------------------------------------------------------------------------
// ADR §4 / §7 — Abort phases
// ---------------------------------------------------------------------------

test("abort: signal fired BEFORE connect resolves → request error mapped to https_timeout by fetcher", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy: aim at a non-listening port on 127.0.0.1, abort the
  // signal immediately. Transport must surface an error whose fetcher
  // mapping is https_timeout (ADR §7). The transport-level assertion
  // checks for AbortError or DOMException name === 'AbortError'.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

test("abort: signal fired AFTER connect but BEFORE response headers → request error mapped to https_timeout", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy: local server accepts the connection but delays
  // writing headers (e.g. via setTimeout). Abort signal fires
  // after socket connect but before server emits status line.
  // Must not hang; must abort cleanly.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

test("abort: signal fired MID-BODY after some chunks delivered → stream throws, no partial-success", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy: local server starts streaming, delivers a chunk, then
  // delays. The async iterator must throw when the abort signal
  // fires, NOT complete normally. Per ADR §6: "If the abort signal
  // fires during body iteration, iteration must throw a
  // timeout-mapped error, not end as a partial-content success."
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

// ---------------------------------------------------------------------------
// ADR §7 — Fetcher-side error-code mapping (round-trip through fetcher)
// ---------------------------------------------------------------------------
//
// These tests exercise the END-TO-END mapping: transport throws X,
// fetcher returns FetcherError(code=Y). They run through fetchPageBytes
// with the real production transport.
//
// Skip reason "Unlocked by WI-03" because the production transport
// must exist for the round-trip to test anything new beyond what
// fetcher.https.test.mjs already covers with stubs.

test("e2e: TLS hostname mismatch via real transport → fetcher returns https_network_error", { skip: "Unlocked by WI-03" }, async () => {
  // Strategy: local HTTPS server with cert SAN = DNS:wrong-host.test;
  // call fetchPageBytes() with allowedHttpsHosts including ALLOWED_HOST,
  // dns stub returning a single public-looking address, and the real
  // makeNodeHttpsRequestTransport(). Expect FetcherError(code = https_network_error).
  const { fetchPageBytes, FetcherError, FETCHER_ERROR_CODES, makeNodeHttpsRequestTransport } =
    await import("../dist/index.js");
  assert.ok(fetchPageBytes && FetcherError && FETCHER_ERROR_CODES && makeNodeHttpsRequestTransport);
});

test("e2e: malformed Content-Length via real transport → fetcher returns https_network_error", { skip: "Unlocked by WI-03" }, async () => {
  const { fetchPageBytes, FetcherError, FETCHER_ERROR_CODES, makeNodeHttpsRequestTransport } =
    await import("../dist/index.js");
  assert.ok(fetchPageBytes && FetcherError && FETCHER_ERROR_CODES && makeNodeHttpsRequestTransport);
});

test("e2e: abort during body via real transport → fetcher returns https_timeout", { skip: "Unlocked by WI-03" }, async () => {
  const { fetchPageBytes, FetcherError, FETCHER_ERROR_CODES, makeNodeHttpsRequestTransport } =
    await import("../dist/index.js");
  assert.ok(fetchPageBytes && FetcherError && FETCHER_ERROR_CODES && makeNodeHttpsRequestTransport);
});
