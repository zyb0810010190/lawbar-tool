// Transport-level HTTPS tests for ADR-11D.2-A (DNS pinning).
//
// WI-03a landed the pinned `node:https.request` transport core.
// WI-03b lands the 15 runtime-validation tests below, which are now
// un-skipped. They use the internal `makeNodeHttpsRequestTransportForTest`
// seam to pass a recording fake `request` and prove each invalid
// `allowedAddresses` shape fails preflight BEFORE any socket activity
// (the fake `request` is never called). Each test asserts on
// `instanceof HttpsTransportError` and `err.code === <CODE>` per the
// pinned mapping in `docs/release/go-live-plan.md` WI-03b.
//
// The remaining `test.skip(..., { skip: "Unlocked by WI-03d" })` cases
// in this file are NOT runtime-validation cases — they belong to
// WI-03c (content-length, body shape, abort) and WI-03d (TLS harness
// + the reordering test that needs two reachable endpoints). Those
// stay skipped.
//
// One skip reason is used in the still-skipped tests:
//   - "Unlocked by WI-03d"  — TLS test harness + the un-skip of TLS /
//     hostname / certificate / no-reorder / e2e cases. The current
//     production transport supports content-length and abort behavior
//     but the assertions need a local HTTPS server lifecycle that lands
//     with WI-03d.
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
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";

// WI-03c helper: counting AbortSignal wrapper. Records add/remove
// listener calls so listener-symmetry tests can assert add-count ===
// remove-count at end of test (i.e. no leaked listeners).
function makeCountingSignal(base) {
  const counts = { add: 0, remove: 0 };
  // Delegate to underlying signal; record adds/removes for "abort" only,
  // since that's the event the transport wires.
  const wrapped = {
    get aborted() { return base.aborted; },
    get reason() { return base.reason; },
    throwIfAborted() { return base.throwIfAborted(); },
    addEventListener(type, listener, options) {
      if (type === "abort") counts.add++;
      return base.addEventListener(type, listener, options);
    },
    removeEventListener(type, listener, options) {
      if (type === "abort") counts.remove++;
      return base.removeEventListener(type, listener, options);
    },
    dispatchEvent(event) { return base.dispatchEvent(event); },
    onabort: null,
    counts,
  };
  return wrapped;
}

// WI-03c helper: build a fake IncomingMessage with controllable
// rawHeaders, status, and body chunks. Used through the WI-03b request-
// factory seam to test the response adapter without a live HTTPS server.
function makeFakeIncomingMessage({ statusCode, rawHeaders = [], chunks = [] }) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.rawHeaders = rawHeaders;
  // Build res.headers by collapsing rawHeaders the way Node does
  // (case-insensitive lowercase keys; duplicates collapsed or arrayified).
  // Note: this fake intentionally collapses content-length duplicates
  // in res.headers — exactly the Node behavior that motivates WI-03c's
  // res.rawHeaders / res.headersDistinct duplicate-detection rule.
  const headers = {};
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const k = rawHeaders[i].toLowerCase();
    const v = rawHeaders[i + 1];
    if (k === "set-cookie") {
      if (!Array.isArray(headers[k])) headers[k] = [];
      headers[k].push(v);
    } else if (headers[k] === undefined) {
      headers[k] = v;
    }
  }
  res.headers = headers;
  let destroyed = false;
  res.destroyed = false;
  res.destroy = (err) => {
    if (destroyed) return res;
    destroyed = true;
    res.destroyed = true;
    if (err) {
      queueMicrotask(() => res.emit("error", err));
    }
    return res;
  };
  res[Symbol.asyncIterator] = async function* () {
    for (const chunk of chunks) {
      if (destroyed) {
        const err = new Error("stream destroyed");
        err.code = "ERR_STREAM_PREMATURE_CLOSE";
        throw err;
      }
      // Allow the await loop to observe abort between chunks.
      await Promise.resolve();
      // Yield Buffer chunks (matches Node's IncomingMessage behavior).
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  };
  return res;
}

// WI-03c helper: build a fake `request` factory that immediately
// invokes the response callback with the given fake IncomingMessage.
// The fake removes its own AbortSignal listener once the response is
// delivered, so listener-symmetry tests on the transport only observe
// transport-owned listeners.
function makeFakeRequestWithResponse(fakeRes) {
  return function fakeRequest(_url, options, responseCallback) {
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    let fired = false;
    let signalAttached = null;
    let onAbort = null;
    if (options?.signal) {
      onAbort = () => {
        if (fired) return;
        fired = true;
        const err = new Error("aborted");
        err.name = "AbortError";
        err.code = "ABORT_ERR";
        queueMicrotask(() => req.emit("error", err));
      };
      if (options.signal.aborted) {
        onAbort();
        return req;
      }
      signalAttached = options.signal;
      signalAttached.addEventListener("abort", onAbort, { once: true });
    }
    queueMicrotask(() => {
      // Detach the fake's own signal listener once the response is
      // delivered so listener-symmetry assertions on the transport
      // observe only transport-owned add/remove pairs.
      if (signalAttached && onAbort) {
        signalAttached.removeEventListener("abort", onAbort);
      }
      try {
        responseCallback(fakeRes);
      } catch (err) {
        req.emit("error", err);
      }
    });
    return req;
  };
}

// WI-03c helper: assemble a transport whose request factory returns a
// canned IncomingMessage. Returns { transport, signal, counts } where
// `signal` is a counting AbortSignal for listener-symmetry assertions.
async function makeTransportWithFakeResponse(responseSpec) {
  const { makeNodeHttpsRequestTransportForTest } = await import(
    "../dist/fetcher/httpsTransport.js"
  );
  const fakeRes = makeFakeIncomingMessage(responseSpec);
  const transport = makeNodeHttpsRequestTransportForTest({
    request: makeFakeRequestWithResponse(fakeRes),
  });
  const controller = new AbortController();
  const signal = makeCountingSignal(controller.signal);
  return { transport, controller, signal, fakeRes };
}

// WI-03b helper: build a recording fake `request` so each
// runtime-validation test can prove the fake was never invoked when
// preflight rejects. The fake throws if it is ever called.
function makeRecordingRequest() {
  const calls = [];
  const request = (...args) => {
    calls.push(args);
    throw new Error("recording fake request must not be called when preflight rejects");
  };
  return { request, calls };
}

// WI-03b helper: build a transport with a recording fake request via
// the internal `makeNodeHttpsRequestTransportForTest` seam (imported by
// internal dist path; NOT exported from public barrels).
async function makeTransportWithRecordingRequest() {
  const { makeNodeHttpsRequestTransportForTest } = await import(
    "../dist/fetcher/httpsTransport.js"
  );
  const rec = makeRecordingRequest();
  const transport = makeNodeHttpsRequestTransportForTest({ request: rec.request });
  return { transport, rec };
}

// WI-03b helper: assert err is an HttpsTransportError with the given
// code, and that the recording fake `request` was never called.
async function assertPreflightRejects(promise, rec, expectedCode) {
  const { HttpsTransportError } = await import(
    "../dist/fetcher/httpsTransportErrors.js"
  );
  await assert.rejects(promise, (err) => {
    assert.ok(
      err instanceof HttpsTransportError,
      `expected HttpsTransportError, got ${err && err.constructor && err.constructor.name}: ${err && err.message}`,
    );
    assert.equal(err.code, expectedCode, `expected code ${expectedCode}, got ${err.code}`);
    return true;
  });
  assert.equal(
    rec.calls.length,
    0,
    `expected request not to be called, but it was called ${rec.calls.length} time(s)`,
  );
}

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
// ADR §5 / WI-03b — Runtime address validation (transport entry)
// ---------------------------------------------------------------------------
//
// Per ADR §5 + WI-03b: production validates `allowedAddresses` at entry
// and fails closed with `HttpsTransportError` carrying a stable `code`
// discriminator. The 15 tests below assert on `instanceof
// HttpsTransportError` AND `err.code === <CODE>` per the pinned
// mapping in `docs/release/go-live-plan.md` WI-03b. Each test also
// asserts the recording fake `request` was never called, proving the
// preflight rejected BEFORE any socket/network activity. The fetcher-
// side mapping to public `https_network_error` is covered in
// fetcher.https.test.mjs.

test("transport rejects missing allowedAddresses", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      // allowedAddresses omitted
    }),
    rec,
    "MISSING_ALLOWED_ADDRESSES",
  );
});

test("transport rejects empty allowedAddresses", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [],
    }),
    rec,
    "EMPTY_ALLOWED_ADDRESSES",
  );
});

test("transport rejects non-array allowedAddresses", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: "not-an-array",
    }),
    rec,
    "ALLOWED_ADDRESSES_NOT_ARRAY",
  );
});

test("transport rejects non-plain-object element", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: ["8.8.8.8"], // string instead of object
    }),
    rec,
    "ADDRESS_ENTRY_NOT_PLAIN_OBJECT",
  );
});

test("transport rejects non-string address field", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: 12345678, family: 4 }],
    }),
    rec,
    "ADDRESS_NOT_STRING",
  );
});

test("transport rejects nonnumeric family", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "8.8.8.8", family: "4" }],
    }),
    rec,
    "ADDRESS_FAMILY_NOT_NUMBER",
  );
});

test("transport rejects family=5 (non 4|6)", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "8.8.8.8", family: 5 }],
    }),
    rec,
    "ADDRESS_FAMILY_INVALID",
  );
});

test("transport rejects malformed IPv4 literal", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "999.999.999.999", family: 4 }],
    }),
    rec,
    "ADDRESS_INVALID_LITERAL",
  );
});

test("transport rejects malformed IPv6 literal", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "::gg::", family: 6 }],
    }),
    rec,
    "ADDRESS_INVALID_LITERAL",
  );
});

test("transport rejects IPv4-mapped IPv6 dotted form (::ffff:1.2.3.4)", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "::ffff:1.2.3.4", family: 6 }],
    }),
    rec,
    "ADDRESS_INVALID_LITERAL",
  );
});

test("transport rejects IPv4-mapped IPv6 hex form (::ffff:0102:0304)", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "::ffff:0102:0304", family: 6 }],
    }),
    rec,
    "ADDRESS_INVALID_LITERAL",
  );
});

test("transport rejects scoped IPv6 (fe80::1%lo0) — literal-invalidity wins over private-IP", async () => {
  // WI-03b ordering rule: mapped/scoped literal rejection runs BEFORE
  // isPrivateIp, so fe80::1%lo0 must surface ADDRESS_INVALID_LITERAL
  // even though isPrivateIp("fe80::1%lo0") is true.
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "fe80::1%lo0", family: 6 }],
    }),
    rec,
    "ADDRESS_INVALID_LITERAL",
  );
});

test("transport rejects family/address mismatch (family=6 with IPv4 literal)", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [{ address: "8.8.8.8", family: 6 }],
    }),
    rec,
    "ADDRESS_FAMILY_MISMATCH",
  );
});

test("transport rejects private IPv4 (127.0.0.1) — defense in depth at transport entry", async () => {
  // Fetcher rejects earlier (host_resolves_to_private_ip); transport
  // ALSO rejects as defense-in-depth per ADR §1.
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [makeAddr(LOOPBACK_V4, 4)],
    }),
    rec,
    "ADDRESS_PRIVATE",
  );
});

test("transport rejects private IPv6 (::1) — defense in depth", async () => {
  const { transport, rec } = await makeTransportWithRecordingRequest();
  await assertPreflightRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal: AbortSignal.timeout(1000),
      allowedAddresses: [makeAddr(LOOPBACK_V6, 6)],
    }),
    rec,
    "ADDRESS_PRIVATE",
  );
});

// ---------------------------------------------------------------------------
// WI-03b — Private-IP defense-in-depth: representative coverage
// ---------------------------------------------------------------------------
//
// Beyond the loopback cases above, exercise one address from each
// major non-globally-routable family the shared `isPrivateIp` blocklist
// covers. The transport must reject all of them with
// `ADDRESS_PRIVATE`, mirroring the fetcher's earlier DNS-time check.
//
// Coverage:
//   - IPv4 RFC1918 (10/8, 172.16/12, 192.168/16)
//   - IPv4 link-local (169.254/16, includes cloud metadata 169.254.169.254)
//   - IPv6 link-local (fe80::/10) — un-scoped form (scoped + zone-id
//     forms are covered by the ADDRESS_INVALID_LITERAL case above)
//   - IPv6 ULA / RFC4193 (fc00::/7)

for (const [label, address, family] of [
  ["IPv4 RFC1918 10/8", "10.0.0.5", 4],
  ["IPv4 RFC1918 172.16/12", "172.16.5.5", 4],
  ["IPv4 RFC1918 192.168/16", "192.168.1.1", 4],
  ["IPv4 link-local 169.254/16", "169.254.169.254", 4],
  ["IPv6 link-local fe80::/10 (un-scoped)", "fe80::1", 6],
  ["IPv6 ULA fc00::/7", "fc00::1", 6],
  ["IPv6 ULA fd00::/8", "fd00::abcd", 6],
]) {
  test(`transport rejects private ${label} as ADDRESS_PRIVATE`, async () => {
    const { transport, rec } = await makeTransportWithRecordingRequest();
    await assertPreflightRejects(
      transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
        signal: AbortSignal.timeout(1000),
        allowedAddresses: [makeAddr(address, family)],
      }),
      rec,
      "ADDRESS_PRIVATE",
    );
  });
}

// ---------------------------------------------------------------------------
// ADR §4 — First-vetted-address selection (no transport reordering)
// ---------------------------------------------------------------------------

test("transport connects to the FIRST element of allowedAddresses, no reordering", { skip: "Unlocked by WI-03d" }, async () => {
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

test("TLS: cert valid for hostname → transport returns 200 + Headers; server saw Host + SNI = url.hostname", { skip: "Unlocked by WI-03d" }, async () => {
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

test("TLS: cert valid only for IP literal → transport throws (mapped to https_network_error by fetcher)", { skip: "Unlocked by WI-03d" }, async () => {
  // Strategy when un-skipped: cert SAN = IP:127.0.0.1 only.
  // Per ADR §7 + WI-01 prototype: only ERR_TLS_CERT_ALTNAME_INVALID
  // and ERR_OSSL_X509_HOST_MISMATCH are accepted as proving
  // hostname verification rejected. Bare cert errors (UNKNOWN_CA,
  // BAD_CERTIFICATE) would indicate a broken CA chain and FAIL this
  // assertion.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

test("TLS: cert valid only for wrong hostname → transport throws (mapped to https_network_error)", { skip: "Unlocked by WI-03d" }, async () => {
  // Strategy: cert SAN = DNS:other-host.test. Request goes to ALLOWED_HOST.
  // Expected: same hostname-verification error codes as above.
  const { makeNodeHttpsRequestTransport } = await import("../dist/index.js");
  assert.ok(makeNodeHttpsRequestTransport);
});

// ---------------------------------------------------------------------------
// ADR §6 / WI-03c — Strict Content-Length parsing
// ---------------------------------------------------------------------------
//
// All 6 content-length tests + body-shape + transport-3xx + phase-1 abort
// use the WI-03b request-factory seam with a fake IncomingMessage so the
// transport's response adapter is exercised without a live HTTPS server.
// Duplicate detection asserts the fake's rawHeaders (two content-length
// entries) reaches RESPONSE_CONTENT_LENGTH_DUPLICATE even though Node's
// res.headers would collapse them.

async function expectTransportRejects(promise, expectedCode) {
  const { HttpsTransportError } = await import(
    "../dist/fetcher/httpsTransportErrors.js"
  );
  await assert.rejects(promise, (err) => {
    assert.ok(
      err instanceof HttpsTransportError,
      `expected HttpsTransportError, got ${err && err.constructor && err.constructor.name}: ${err && err.message}`,
    );
    assert.equal(err.code, expectedCode, `expected code ${expectedCode}, got ${err.code}`);
    return true;
  });
}

test("content-length: leading zero (\"0123\") rejected with transport error", async () => {
  const { transport, controller, signal } = await makeTransportWithFakeResponse({
    statusCode: 200,
    rawHeaders: ["Content-Length", "0123"],
    chunks: [Buffer.alloc(123)],
  });
  await expectTransportRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal,
      allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
    }),
    "RESPONSE_CONTENT_LENGTH_INVALID",
  );
  controller.abort();
  assert.equal(signal.counts.add, signal.counts.remove, "listener add/remove must be symmetric (pre-yield rejection)");
});

test("content-length: negative value (-1) rejected", async () => {
  const { transport, controller, signal } = await makeTransportWithFakeResponse({
    statusCode: 200,
    rawHeaders: ["Content-Length", "-1"],
    chunks: [],
  });
  await expectTransportRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal,
      allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
    }),
    "RESPONSE_CONTENT_LENGTH_INVALID",
  );
  controller.abort();
  assert.equal(signal.counts.add, signal.counts.remove);
});

test("content-length: non-integer (\"12.5\") rejected", async () => {
  const { transport, controller, signal } = await makeTransportWithFakeResponse({
    statusCode: 200,
    rawHeaders: ["Content-Length", "12.5"],
    chunks: [],
  });
  await expectTransportRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal,
      allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
    }),
    "RESPONSE_CONTENT_LENGTH_INVALID",
  );
  controller.abort();
  assert.equal(signal.counts.add, signal.counts.remove);
});

test("content-length: duplicate header occurrences rejected (rawHeaders multiplicity, not res.headers comma-join)", async () => {
  // Critical fix from WI-03c plan: Node's res.headers may collapse
  // duplicates, so the duplicate check MUST use res.rawHeaders. The fake
  // delivers two Content-Length entries in rawHeaders to exercise the
  // multiplicity path directly.
  const { transport, controller, signal } = await makeTransportWithFakeResponse({
    statusCode: 200,
    rawHeaders: ["Content-Length", "100", "Content-Length", "200"],
    chunks: [],
  });
  await expectTransportRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal,
      allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
    }),
    "RESPONSE_CONTENT_LENGTH_DUPLICATE",
  );
  controller.abort();
  assert.equal(signal.counts.add, signal.counts.remove);
});

test("content-length: \"0\" is accepted (empty body case)", async () => {
  const { transport, controller, signal } = await makeTransportWithFakeResponse({
    statusCode: 200,
    rawHeaders: ["Content-Length", "0"],
    chunks: [],
  });
  const response = await transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
    signal,
    allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
  });
  assert.equal(response.status, 200);
  // Body must always be present (never undefined). Drain to verify
  // empty + Content-Length verification passes on end.
  let total = 0;
  for await (const chunk of response.body) total += chunk.byteLength;
  assert.equal(total, 0);
  controller.abort();
  assert.equal(signal.counts.add, signal.counts.remove, "listener add/remove must be symmetric on success exit");
});

test("content-length: absent → streams under existing size cap, no size hint", async () => {
  // No Content-Length header at all. Transport must accept the
  // response and stream the body without a size hint; the fetcher's
  // existing per-page cap is the upper bound.
  const payload = Buffer.from("hello-world");
  const { transport, controller, signal } = await makeTransportWithFakeResponse({
    statusCode: 200,
    rawHeaders: [],
    chunks: [payload],
  });
  const response = await transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
    signal,
    allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), null);
  let total = 0;
  for await (const chunk of response.body) total += chunk.byteLength;
  assert.equal(total, payload.byteLength);
  controller.abort();
  assert.equal(signal.counts.add, signal.counts.remove);
});

// ---------------------------------------------------------------------------
// ADR §6 / WI-03c — Body iteration: strict Uint8Array (not Buffer)
// ---------------------------------------------------------------------------

test("body: each chunk yielded by the async iterator is strict Uint8Array, never raw Buffer", async () => {
  // Node IncomingMessage yields Buffer chunks. The transport adapter
  // must rewrap each as `chunk.constructor === Uint8Array`. The strict
  // identity check distinguishes Uint8Array from its Buffer subclass.
  const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const { transport, controller, signal } = await makeTransportWithFakeResponse({
    statusCode: 200,
    rawHeaders: ["Content-Length", String(payload.byteLength)],
    chunks: [payload],
  });
  const response = await transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
    signal,
    allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
  });
  let seenChunks = 0;
  for await (const chunk of response.body) {
    seenChunks++;
    assert.equal(
      chunk.constructor,
      Uint8Array,
      "chunk.constructor must be Uint8Array exactly, NOT Buffer (which is a Uint8Array subclass)",
    );
    // sanity: Buffer.isBuffer must be false because Buffer chunks were
    // rewrapped — a Buffer would have constructor === Buffer.
    assert.equal(Buffer.isBuffer(chunk), false);
  }
  assert.ok(seenChunks > 0, "expected at least one chunk yielded");
  controller.abort();
  assert.equal(signal.counts.add, signal.counts.remove);
});

// ---------------------------------------------------------------------------
// ADR §4 / WI-03c — Manual 3xx handling (no auto-follow)
// ---------------------------------------------------------------------------

test("3xx: transport surfaces status 302 instead of following the Location header", async () => {
  // Transport must return { status, headers, body } for any 3xx. The
  // body is always an AsyncIterable<Uint8Array> (may be empty, never
  // undefined), and the transport must NOT pre-read it. The fetcher
  // separately maps 3xx to redirect_unsupported (covered elsewhere).
  const { transport, controller, signal } = await makeTransportWithFakeResponse({
    statusCode: 302,
    rawHeaders: [
      "Location", "https://elsewhere.example/",
      "Content-Length", "0",
    ],
    chunks: [],
  });
  const response = await transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
    signal,
    allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://elsewhere.example/");
  assert.notEqual(response.body, undefined, "body must never be undefined, even for 3xx");
  assert.equal(
    typeof response.body[Symbol.asyncIterator],
    "function",
    "body must remain an AsyncIterable<Uint8Array>",
  );
  // Drain to prove the body is empty (matches Content-Length: 0).
  let bytes = 0;
  for await (const chunk of response.body) bytes += chunk.byteLength;
  assert.equal(bytes, 0);
  controller.abort();
  assert.equal(signal.counts.add, signal.counts.remove);
});

// ---------------------------------------------------------------------------
// ADR §4 / §7 / WI-03c — Abort phases
// ---------------------------------------------------------------------------

test("abort: signal fired BEFORE connect resolves → RESPONSE_ABORTED, fetcher maps to https_timeout", async () => {
  // Strategy: pre-abort the controller before fetch starts. The fake
  // request factory simulates Node's signal-aware request by emitting
  // 'error' on req with an AbortError, which the transport rewraps as
  // RESPONSE_ABORTED. No real socket is opened.
  const { makeNodeHttpsRequestTransportForTest } = await import(
    "../dist/fetcher/httpsTransport.js"
  );
  const fakeRes = makeFakeIncomingMessage({ statusCode: 200, rawHeaders: [], chunks: [] });
  const transport = makeNodeHttpsRequestTransportForTest({
    request: makeFakeRequestWithResponse(fakeRes),
  });
  const controller = new AbortController();
  controller.abort(); // pre-aborted
  const signal = makeCountingSignal(controller.signal);
  await expectTransportRejects(
    transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
      signal,
      allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
    }),
    "RESPONSE_ABORTED",
  );
  assert.equal(signal.counts.add, signal.counts.remove, "listener add/remove must be symmetric on abort exit");
});

test("abort: signal fired MID-BODY after some chunks delivered → stream throws RESPONSE_ABORTED, no partial-success", async () => {
  // Phase-3 abort via fake-stream harness. The body iterator yields
  // one chunk, then we abort the signal before requesting the next
  // chunk; the iterator must throw RESPONSE_ABORTED (not end as a
  // partial-success).
  const { makeNodeHttpsRequestTransportForTest } = await import(
    "../dist/fetcher/httpsTransport.js"
  );
  const { HttpsTransportError } = await import(
    "../dist/fetcher/httpsTransportErrors.js"
  );
  // Build a fake res whose async iterator yields one chunk, then
  // waits for abort, then would yield more.
  const res = new EventEmitter();
  res.statusCode = 200;
  res.rawHeaders = []; // no content-length
  res.headers = {};
  let destroyed = false;
  res.destroyed = false;
  res.destroy = () => {
    destroyed = true;
    res.destroyed = true;
    return res;
  };
  res[Symbol.asyncIterator] = async function* () {
    yield Buffer.from("first");
    // Wait until destroyed (signal abort triggers res.destroy via the
    // body adapter's listener) so the next-chunk request never
    // delivers and the body iterator must throw.
    await new Promise((resolve) => {
      const tick = () => {
        if (destroyed) resolve();
        else setTimeout(tick, 5);
      };
      tick();
    });
    // If the test bug-fires and reaches here (it shouldn't), yield
    // a "second" chunk to make the partial-success failure mode
    // visible if the iterator-throw check is missing.
    yield Buffer.from("second");
  };
  const transport = makeNodeHttpsRequestTransportForTest({
    request: makeFakeRequestWithResponse(res),
  });
  const controller = new AbortController();
  const signal = makeCountingSignal(controller.signal);
  const response = await transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
    signal,
    allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
  });
  const it = response.body[Symbol.asyncIterator]();
  const first = await it.next();
  assert.equal(first.done, false);
  assert.equal(first.value.constructor, Uint8Array);
  // Abort before requesting the next chunk.
  controller.abort();
  await assert.rejects(it.next(), (err) => {
    assert.ok(
      err instanceof HttpsTransportError,
      `expected HttpsTransportError, got ${err?.constructor?.name}: ${err?.message}`,
    );
    assert.equal(err.code, "RESPONSE_ABORTED");
    return true;
  });
  assert.equal(signal.counts.add, signal.counts.remove, "listener add/remove must be symmetric on mid-body abort");
});

test("unconsumed body: signal abort after response yielded but before iteration destroys res (no leaked stream)", async () => {
  // WI-03c audit fix (audit-mpdnpa8n-iusz79): when a caller never
  // iterates the response body (e.g. the fetcher's 3xx branch throws
  // REDIRECT_UNSUPPORTED before the body loop), the transport must
  // still release the underlying IncomingMessage on signal abort.
  // Without the eager cleanup hook installed at response-callback time,
  // the body adapter's abort listener never runs (because iteration
  // never starts) and `res.destroy()` is never called, leaking the
  // socket until Node times out remotely.
  const { transport, controller, signal, fakeRes } = await makeTransportWithFakeResponse({
    statusCode: 302,
    rawHeaders: ["Location", "https://elsewhere.example/", "Content-Length", "0"],
    chunks: [],
  });
  const response = await transport.fetch(new URL(`https://${ALLOWED_HOST}/x`), {
    signal,
    allowedAddresses: [{ address: "8.8.8.8", family: 4 }],
  });
  assert.equal(response.status, 302);
  // Deliberately do NOT iterate the body — mirror the fetcher's 3xx
  // early-return path. Confirm cleanup state before abort.
  assert.equal(fakeRes.destroyed, false, "res must not be destroyed before abort");

  controller.abort();
  // Yield to microtasks so the eager listener can run.
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(
    fakeRes.destroyed,
    true,
    "transport must call res.destroy() on signal abort even when the body is never iterated",
  );
  // Listener-symmetry: the eager listener was added once and removed
  // once by the abort callback's idempotent removeEventListener.
  assert.equal(
    signal.counts.add,
    signal.counts.remove,
    `listener add/remove must be symmetric (add=${signal.counts.add}, remove=${signal.counts.remove})`,
  );
});

test("abort: signal fired AFTER connect but BEFORE response headers", { skip: "Unlocked by WI-03d (requires live HTTPS server lifecycle to distinguish from phase-1)" }, async () => {
  // Phase-2 (after socket, before headers) is hard to distinguish from
  // phase-1 with a synthetic fake-request harness because the fake
  // response is delivered on the same microtask. Promoting this to
  // WI-03d where the local HTTPS server can hold the socket open without
  // writing headers.
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
// Skip reason "Unlocked by WI-03d" because the e2e round-trip needs the
// WI-03d TLS test harness + live HTTPS server lifecycle to test anything
// new beyond what fetcher.https.test.mjs already covers with stubs.

test("e2e: TLS hostname mismatch via real transport → fetcher returns https_network_error", { skip: "Unlocked by WI-03d" }, async () => {
  // Strategy: local HTTPS server with cert SAN = DNS:wrong-host.test;
  // call fetchPageBytes() with allowedHttpsHosts including ALLOWED_HOST,
  // dns stub returning a single public-looking address, and the real
  // makeNodeHttpsRequestTransport(). Expect FetcherError(code = https_network_error).
  const { fetchPageBytes, FetcherError, FETCHER_ERROR_CODES, makeNodeHttpsRequestTransport } =
    await import("../dist/index.js");
  assert.ok(fetchPageBytes && FetcherError && FETCHER_ERROR_CODES && makeNodeHttpsRequestTransport);
});

test("e2e: malformed Content-Length via real transport → fetcher returns https_network_error", { skip: "Unlocked by WI-03d" }, async () => {
  const { fetchPageBytes, FetcherError, FETCHER_ERROR_CODES, makeNodeHttpsRequestTransport } =
    await import("../dist/index.js");
  assert.ok(fetchPageBytes && FetcherError && FETCHER_ERROR_CODES && makeNodeHttpsRequestTransport);
});

test("e2e: abort during body via real transport → fetcher returns https_timeout", { skip: "Unlocked by WI-03d" }, async () => {
  const { fetchPageBytes, FetcherError, FETCHER_ERROR_CODES, makeNodeHttpsRequestTransport } =
    await import("../dist/index.js");
  assert.ok(fetchPageBytes && FetcherError && FETCHER_ERROR_CODES && makeNodeHttpsRequestTransport);
});
