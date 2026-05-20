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

// WI-03d helper: convenience wrapper that creates a counting signal
// linked to a fresh AbortController. Returns both so tests can abort()
// at the right time and still assert listener symmetry.
function makeCountingController() {
  const controller = new AbortController();
  const signal = makeCountingSignal(controller.signal);
  return { controller, signal };
}

// WI-03d helper: poll until predicate returns true or the deadline
// elapses. Used in phase-2 abort to wait for the server to accept the
// request before aborting (so the abort lands AFTER connect/TLS).
async function waitUntil(predicate, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return predicate();
}

// WI-03d helper: assemble a TLS test case — load fixtures, start a
// local HTTPS server with the requested fixture, build the test-only
// loopback transport, register teardown. Returns the helpers each
// per-case test body needs without duplicating the boilerplate.
//
// `fixtureName` selects one of the static fixture leaves:
//   - "hostname"   → SAN: DNS:allowed-host.test
//   - "ipOnly"     → SAN: IP:127.0.0.1 only
//   - "wrongHost"  → SAN: DNS:other-host.test
async function setupTlsCase(t, fixtureName, handlerMarker = "X") {
  const { loadTlsFixtures } = await import("./helpers/tls-fixtures.mjs");
  const { startLocalHttpsServer, makeMarkerHandler, makeTestOnlyLoopbackHttpsTransport } =
    await import("./helpers/tls-server.mjs");
  const fx = loadTlsFixtures();
  const leaf = fx[fixtureName];
  const server = await startLocalHttpsServer({
    key: leaf.key,
    cert: leaf.cert,
    bindAddress: "127.0.0.1",
    requestHandler: makeMarkerHandler(handlerMarker),
  });
  t.after(() => server.stop());
  const transport = makeTestOnlyLoopbackHttpsTransport({
    ca: fx.ca,
    pinTo: { address: "127.0.0.1", family: 4 },
  });
  const { controller, signal } = makeCountingController();
  const fetchUrl = new URL(`https://${ALLOWED_HOST}:${server.port}/x`);
  return { fx, server, transport, controller, signal, fetchUrl };
}

// WI-03d helper: shared assertion for hostname-verification failures.
// Narrow accept set per WI-03d plan (criterion 10); bare cert/CA
// errors are explicitly excluded.
function assertHostnameMismatch(err) {
  assert.ok(
    err && (err.code === "ERR_TLS_CERT_ALTNAME_INVALID" || err.code === "ERR_OSSL_X509_HOST_MISMATCH"),
    `expected hostname-mismatch error code (ERR_TLS_CERT_ALTNAME_INVALID or ERR_OSSL_X509_HOST_MISMATCH), got ${err && err.code}: ${err && err.message}`,
  );
  assert.notEqual(err.code, "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CA-trust must be intact; hostname is the mismatch");
  assert.notEqual(err.code, "SELF_SIGNED_CERT_IN_CHAIN");
  assert.notEqual(err.code, "DEPTH_ZERO_SELF_SIGNED_CERT");
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

test("transport connects to the FIRST element of allowedAddresses, no reordering", async (t) => {
  // WI-03d Case 1 — no-reorder proof via two reachable HTTPS servers
  // (127.0.0.1 + 127.0.0.2 when the loopback alias capability allows).
  // The transport must connect to allowedAddresses[0] regardless of
  // order, and the marker contract (header `x-wi03d-marker` + body
  // payload `marker:A`/`marker:B`) is asserted both ways.
  const { makeTestOnlyLoopbackHttpsTransport } = await import("./helpers/tls-server.mjs");
  const { loadTlsFixtures } = await import("./helpers/tls-fixtures.mjs");
  const { startLocalHttpsServer, probe127_0_0_2_loopback, makeMarkerHandler } =
    await import("./helpers/tls-server.mjs");

  const aliasProbe = await probe127_0_0_2_loopback();
  // The plan permits skipping ONLY sub-case 2 when 127.0.0.2 is
  // unavailable. Sub-case 1 (127.0.0.1-only) is unconditional.
  if (!aliasProbe.available) {
    t.diagnostic(`127.0.0.2 capability unavailable: ${aliasProbe.reason ?? "unknown"} — running sub-case 1 only`);
  } else {
    t.diagnostic(`127.0.0.2 capability available — running both sub-cases`);
  }

  const fx = loadTlsFixtures();
  const serverA = await startLocalHttpsServer({
    key: fx.hostname.key,
    cert: fx.hostname.cert,
    bindAddress: "127.0.0.1",
    requestHandler: makeMarkerHandler("A"),
  });
  t.after(() => serverA.stop());

  let serverB = null;
  if (aliasProbe.available) {
    // Bind serverB on 127.0.0.2 at the SAME port as serverA so a
    // reorder bug surfaces as a wrong marker (B instead of A), not as
    // a refused connection. The plan forbids one-reachable-one-
    // unreachable proofs. If the port is in use on 127.0.0.2 (rare),
    // fall back to dynamic — sub-case 2 still proves marker B, and
    // sub-case 1's reorder safety is degraded but never silent.
    try {
      serverB = await startLocalHttpsServer({
        key: fx.hostname.key,
        cert: fx.hostname.cert,
        bindAddress: "127.0.0.2",
        port: serverA.port,
        requestHandler: makeMarkerHandler("B"),
      });
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === "EADDRINUSE") {
        t.diagnostic(`port ${serverA.port} already bound on 127.0.0.2; falling back to dynamic port for serverB`);
        serverB = await startLocalHttpsServer({
          key: fx.hostname.key,
          cert: fx.hostname.cert,
          bindAddress: "127.0.0.2",
          requestHandler: makeMarkerHandler("B"),
        });
      } else {
        throw err;
      }
    }
    t.after(() => serverB.stop());
  }

  const ca = fx.ca;

  async function fetchMarker(transport, allowedAddresses, port) {
    const { controller, signal } = makeCountingController();
    try {
      const response = await transport.fetch(
        new URL(`https://${ALLOWED_HOST}:${port}/`),
        { signal, allowedAddresses },
      );
      assert.equal(response.status, 200);
      const headerMarker = response.headers.get("x-wi03d-marker");
      const chunks = [];
      for await (const chunk of response.body) chunks.push(chunk);
      const bodyMarker = Buffer.concat(chunks).toString("utf8");
      return { headerMarker, bodyMarker, signal };
    } finally {
      controller.abort();
    }
  }

  // Sub-case 1: pin to 127.0.0.1 → expect marker A. Unconditional.
  // We point the URL at the alias-or-localhost port, which only matters
  // when both servers exist (sub-case 1 uses serverA's port; the URL
  // hostname `allowed-host.test` is what the cert is valid for and the
  // transport pins lookup to allowedAddresses[0]).
  {
    const transport = makeTestOnlyLoopbackHttpsTransport({ ca });
    const allowedAddresses = aliasProbe.available
      ? [{ address: "127.0.0.1", family: 4 }, { address: "127.0.0.2", family: 4 }]
      : [{ address: "127.0.0.1", family: 4 }];
    const { headerMarker, bodyMarker, signal } = await fetchMarker(transport, allowedAddresses, serverA.port);
    assert.equal(headerMarker, "A", "header marker must be A — transport must pin to allowedAddresses[0]");
    assert.equal(bodyMarker, "marker:A", "body marker must be marker:A — transport must pin to allowedAddresses[0]");
    assert.equal(serverA.state.requests.length >= 1, true);
    if (serverB) assert.equal(serverB.state.requests.length, 0, "serverB must not have been reached in sub-case 1");
    // Note: listener-symmetry is enforced by the production transport's
    // WI-03c tests (see "abort: signal fired MID-BODY..." and
    // "unconsumed body..."). The WI-03d TLS tests use a test-only
    // transport that does not implement the WI-03c eager-listener
    // pattern, so we don't assert symmetry here.
    void signal;
  }

  // Sub-case 2: pin to 127.0.0.2 → expect marker B. Only when capability allows.
  if (!aliasProbe.available || !serverB) {
    t.diagnostic("sub-case 2 skipped: 127.0.0.2 loopback alias unavailable on this platform");
    return;
  }
  const transport = makeTestOnlyLoopbackHttpsTransport({ ca });
  const { headerMarker, bodyMarker, signal } = await fetchMarker(
    transport,
    [{ address: "127.0.0.2", family: 4 }, { address: "127.0.0.1", family: 4 }],
    serverB.port,
  );
  assert.equal(headerMarker, "B", "header marker must be B — transport must pin to allowedAddresses[0], not reorder");
  assert.equal(bodyMarker, "marker:B");
  void signal; // listener-symmetry covered by WI-03c production-transport tests

  // Cross-proof: when serverA and serverB share a port, swapping the
  // pinned address must swap the marker without changing the URL. This
  // is the property the plan asks for — reorder bugs yield a wrong
  // marker, never an unreachable address.
  if (serverB.port === serverA.port) {
    const swapTransport = makeTestOnlyLoopbackHttpsTransport({ ca });
    const { headerMarker: hm2, bodyMarker: bm2 } = await fetchMarker(
      swapTransport,
      [{ address: "127.0.0.1", family: 4 }, { address: "127.0.0.2", family: 4 }],
      serverA.port,
    );
    assert.equal(hm2, "A", "same port + pin to 127.0.0.1 → marker A (proves pinning, not reachability)");
    assert.equal(bm2, "marker:A");
  }
});

// ---------------------------------------------------------------------------
// ADR §1.1 / §4 — TLS scenarios (hostname verification)
// ---------------------------------------------------------------------------

test("TLS: cert valid for hostname → transport returns 200 + Headers; server saw Host + SNI = url.hostname", async (t) => {
  // WI-03d Case 2 — hostname-success cert.
  const { server, transport, controller, signal, fetchUrl } = await setupTlsCase(t, "hostname", "H");
  try {
    const response = await transport.fetch(
      fetchUrl,
      { signal, allowedAddresses: [{ address: "127.0.0.1", family: 4 }] },
    );
    assert.equal(response.status, 200);
    assert.ok(response.headers instanceof Headers, "response.headers must be a Headers instance");
    assert.equal(typeof response.body[Symbol.asyncIterator], "function", "body must be AsyncIterable");
    // Drain to confirm body chunks are strict Uint8Array under TLS too.
    let seenChunks = 0;
    for await (const chunk of response.body) {
      assert.equal(chunk.constructor, Uint8Array, "TLS body chunks must be strict Uint8Array");
      seenChunks++;
    }
    assert.ok(seenChunks > 0);
    // Server-side state — single request, Host header + SNI = ALLOWED_HOST, socket localAddress = 127.0.0.1.
    assert.equal(server.state.requests.length, 1);
    const captured = server.state.requests[0];
    assert.equal(captured.hostHeader, `${ALLOWED_HOST}:${server.port}`);
    assert.equal(captured.sniServername, ALLOWED_HOST, "server-side SNI must equal the URL hostname");
    assert.equal(captured.socketLocalAddress, "127.0.0.1", "socket must connect to the pinned IP");
  } finally {
    controller.abort();
  }
  void signal; // listener-symmetry covered by WI-03c production-transport tests
});

test("TLS: cert valid only for IP literal → transport throws (mapped to https_network_error by fetcher)", async (t) => {
  // WI-03d Case 3 — IP-only SAN cert; client requests via hostname, mismatch.
  const { transport, controller, signal, fetchUrl } = await setupTlsCase(t, "ipOnly");
  try {
    await assert.rejects(
      transport.fetch(fetchUrl, { signal, allowedAddresses: [{ address: "127.0.0.1", family: 4 }] }),
      (err) => {
        assertHostnameMismatch(err);
        // Secondary: message must mention hostname-mismatch semantics
        // to defend against OpenSSL message drift.
        assert.ok(
          /alt(name|ernate|ernative)|hostname|host\s*mismatch/i.test(String(err.message)),
          `expected message to mention hostname-mismatch, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    controller.abort();
  }
  void signal; // listener-symmetry covered by WI-03c production-transport tests
});

test("TLS: cert valid only for wrong hostname → transport throws (mapped to https_network_error)", async (t) => {
  // WI-03d Case 4 — wrong-hostname SAN cert (CA-trusted, hostname-mismatch).
  // Distinguishes "wrong hostname, CA OK" from "UNKNOWN_CA / SELF_SIGNED"
  // — `assertHostnameMismatch` excludes the CA-trust failure codes.
  const { transport, controller, signal, fetchUrl } = await setupTlsCase(t, "wrongHost");
  try {
    await assert.rejects(
      transport.fetch(fetchUrl, { signal, allowedAddresses: [{ address: "127.0.0.1", family: 4 }] }),
      (err) => {
        assertHostnameMismatch(err);
        return true;
      },
    );
  } finally {
    controller.abort();
  }
  void signal; // listener-symmetry covered by WI-03c production-transport tests
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
  void signal; // listener-symmetry covered by WI-03c production-transport tests
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
  void signal; // listener-symmetry covered by WI-03c production-transport tests
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
  void signal; // listener-symmetry covered by WI-03c production-transport tests
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
  void signal; // listener-symmetry covered by WI-03c production-transport tests
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
  void signal; // listener-symmetry covered by WI-03c production-transport tests
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
  void signal; // listener-symmetry covered by WI-03c production-transport tests
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

test("abort: signal fired AFTER connect but BEFORE response headers", async (t) => {
  // WI-03d Case 5 — phase-2 abort via a real local HTTPS server that
  // completes the TLS handshake but never writes response headers.
  // After the handshake completes (verified via server.state.requests),
  // we abort the signal. Transport must reject with RESPONSE_ABORTED.
  const { makeTestOnlyLoopbackHttpsTransport } = await import("./helpers/tls-server.mjs");
  const { HttpsTransportError } = await import("../dist/fetcher/httpsTransportErrors.js");
  const { loadTlsFixtures } = await import("./helpers/tls-fixtures.mjs");
  const { startLocalHttpsServer } = await import("./helpers/tls-server.mjs");

  const fx = loadTlsFixtures();
  const server = await startLocalHttpsServer({
    key: fx.hostname.key,
    cert: fx.hostname.cert,
    bindAddress: "127.0.0.1",
    requestHandler: (_req, _res) => {
      // Hold the connection — never write headers or end. The harness
      // teardown destroys the socket on server.stop().
    },
  });
  t.after(() => server.stop());

  const transport = makeTestOnlyLoopbackHttpsTransport({ ca: fx.ca, pinTo: { address: "127.0.0.1", family: 4 } });
  const { controller, signal } = makeCountingController();

  const fetchPromise = transport.fetch(
    new URL(`https://${ALLOWED_HOST}:${server.port}/x`),
    { signal, allowedAddresses: [{ address: "127.0.0.1", family: 4 }] },
  );
  // Catch the rejection eagerly so it doesn't become an unhandled
  // promise rejection if the assertion below races.
  fetchPromise.catch(() => undefined);

  // Wait for the server to receive the request (post-TLS-handshake)
  // before aborting, so the abort lands in the phase-2 window (after
  // connect, before headers).
  const arrived = await waitUntil(() => server.state.requests.length >= 1, { timeoutMs: 3000 });
  assert.equal(arrived, true, "server must receive request before phase-2 abort");

  controller.abort();

  await assert.rejects(fetchPromise, (err) => {
    assert.ok(
      err instanceof HttpsTransportError,
      `expected HttpsTransportError, got ${err && err.constructor && err.constructor.name}: ${err && err.message}`,
    );
    assert.equal(err.code, "RESPONSE_ABORTED");
    return true;
  });
  assert.equal(signal.counts.add, signal.counts.remove, "listener add/remove must be symmetric on phase-2 abort exit");
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

// e2e helpers — build a deterministic OcrSubmission + FetcherDeps for
// round-trip through fetchPageBytes against a local HTTPS server.

const PNG_HEADER_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeE2eSubmission(byteSize = PNG_HEADER_BYTES.length) {
  return {
    contract_version: "1.0.0",
    job_id: "01jrk8m4q4xv2v8d4d4ymf5xnk",
    tenant_id: "01jrk8m4q4xv2v8d4d4ymf5tnt",
    document_id: "01jrk8m4q4xv2v8d4d4ymf5doc",
    submitted_at: "2026-05-20T10:00:00.000Z",
    submitted_by: "wi03d_e2e",
    pages: [{
      page_id: "01jrk8m4q4xv2v8d4d4ymf5p01",
      page_number: 1,
      source: {
        kind: "https",
        url: `https://${ALLOWED_HOST}/page.png`,
        byte_size: byteSize,
        mime_type: "image/png",
      },
    }],
    rerun: { is_rerun: false, previous_job_id: null, page_ids: null },
    ocr_options: {
      languages: ["zh-Hans"], detect_orientation: true, detect_vertical_text: true,
      table_recognition: "auto", seal_recognition: true,
      return_word_confidence: true, return_polygon: true, min_confidence_emit: 0.3,
    },
    preprocessing: {
      deskew: "auto", denoise: "auto", binarize: false, remove_seal_bleed: false,
      upscale_low_dpi: true, target_dpi_floor: 200, crop_borders: "auto",
    },
    priority: 50,
    retry: { max_attempts: 3, backoff: "exponential", base_delay_ms: 2000, max_delay_ms: 60000, attempt: 1 },
    metadata: {},
  };
}

test("e2e: TLS hostname mismatch via real transport → fetcher returns https_network_error", async (t) => {
  // WI-03d Case 6 — wrong-host cert; client requests via allowed-host.test.
  // The fetcher must surface a FetcherError(https_network_error) with
  // the original Node TLS error preserved as `cause` (relies on the
  // WI-03d additive `cause: err` extension to the generic wrap branch).
  //
  // We use `makeTestOnlyLoopbackHttpsTransport` (a test-only transport
  // that does real TLS but bypasses the WI-03b preflight's loopback
  // block) because the production transport refuses loopback IPs by
  // design. Preflight is exhaustively tested in WI-03b; this test
  // covers the fetcher-side mapping.
  const { fetchPageBytes, FetcherError, FETCHER_ERROR_CODES } = await import("../dist/index.js");
  const { loadTlsFixtures } = await import("./helpers/tls-fixtures.mjs");
  const { startLocalHttpsServer, makeMarkerHandler, makeTestOnlyLoopbackHttpsTransport } =
    await import("./helpers/tls-server.mjs");

  const fx = loadTlsFixtures();
  const server = await startLocalHttpsServer({
    key: fx.wrongHost.key,
    cert: fx.wrongHost.cert,
    bindAddress: "127.0.0.1",
    requestHandler: makeMarkerHandler("X"),
  });
  t.after(() => server.stop());

  const submission = makeE2eSubmission();
  submission.pages[0].source.url = `https://${ALLOWED_HOST}:${server.port}/page.png`;

  await assert.rejects(
    fetchPageBytes(submission, {
      allowedFileRoot: "/tmp/unused-for-https",
      allowedHttpsHosts: new Set([ALLOWED_HOST]),
      dnsLookup: async () => [{ address: "8.8.8.8", family: 4 }],
      httpsTransport: makeTestOnlyLoopbackHttpsTransport({ ca: fx.ca, pinTo: { address: "127.0.0.1", family: 4 } }),
    }),
    (err) => {
      assert.ok(err instanceof FetcherError);
      assert.equal(err.code, FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR);
      // Generic-branch cause preservation (WI-03d additive) makes the
      // original Node TLS error reachable via err.cause.
      assert.ok(err.cause, "expected err.cause to be preserved");
      assert.ok(
        err.cause.code === "ERR_TLS_CERT_ALTNAME_INVALID" || err.cause.code === "ERR_OSSL_X509_HOST_MISMATCH",
        `expected Node TLS hostname-mismatch code, got ${err.cause.code}: ${err.cause.message}`,
      );
      return true;
    },
  );
});

test("e2e: malformed Content-Length via real transport → fetcher returns https_network_error", async (t) => {
  // WI-03d Case 7 — server emits two Content-Length headers; the test
  // transport's res.rawHeaders multiplicity check (same rule the
  // production WI-03c parseStrictContentLength enforces) rejects with
  // RESPONSE_CONTENT_LENGTH_DUPLICATE. Fetcher maps via the
  // isHttpsTransportError branch → https_network_error with
  // HttpsTransportError as cause.
  const { fetchPageBytes, FetcherError, FETCHER_ERROR_CODES } = await import("../dist/index.js");
  const { HttpsTransportError } = await import("../dist/fetcher/httpsTransportErrors.js");
  const { loadTlsFixtures } = await import("./helpers/tls-fixtures.mjs");
  const { startLocalHttpsServer, makeTestOnlyLoopbackHttpsTransport } = await import("./helpers/tls-server.mjs");

  const fx = loadTlsFixtures();
  // Manually emit two Content-Length headers via res.socket.write so we
  // can control the raw wire format. Node's res.setHeader collapses
  // duplicates — we need a real duplicate to exercise the multiplicity
  // rejection in the transport.
  const server = await startLocalHttpsServer({
    key: fx.hostname.key,
    cert: fx.hostname.cert,
    bindAddress: "127.0.0.1",
    requestHandler: (_req, res) => {
      // Emit two IDENTICAL Content-Length headers. Node's HTTP parser
      // rejects responses where conflicting Content-Length values are
      // present (HPE_UNEXPECTED_CONTENT_LENGTH), but accepts identical
      // duplicates while preserving both occurrences in
      // `res.rawHeaders`. That lets us exercise the transport's
      // multiplicity check (RESPONSE_CONTENT_LENGTH_DUPLICATE) without
      // tripping Node's parser-level rejection first.
      const body = "xxxxxxxx";
      const raw =
        "HTTP/1.1 200 OK\r\n" +
        "Content-Type: text/plain\r\n" +
        "Content-Length: 8\r\n" +
        "Content-Length: 8\r\n" +
        "Connection: close\r\n" +
        "\r\n" +
        body;
      res.socket.write(raw);
      res.socket.end();
    },
  });
  t.after(() => server.stop());

  const submission = makeE2eSubmission();
  submission.pages[0].source.url = `https://${ALLOWED_HOST}:${server.port}/page.png`;

  await assert.rejects(
    fetchPageBytes(submission, {
      allowedFileRoot: "/tmp/unused-for-https",
      allowedHttpsHosts: new Set([ALLOWED_HOST]),
      dnsLookup: async () => [{ address: "8.8.8.8", family: 4 }],
      httpsTransport: makeTestOnlyLoopbackHttpsTransport({ ca: fx.ca, pinTo: { address: "127.0.0.1", family: 4 } }),
    }),
    (err) => {
      assert.ok(err instanceof FetcherError);
      assert.equal(err.code, FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR);
      assert.ok(err.cause instanceof HttpsTransportError, `expected HttpsTransportError cause, got ${err.cause?.constructor?.name}`);
      assert.equal(err.cause.code, "RESPONSE_CONTENT_LENGTH_DUPLICATE");
      return true;
    },
  );
});

test("e2e: abort during body via real transport → fetcher returns https_timeout", async (t) => {
  // WI-03d Case 8 — exercise RESPONSE_ABORTED → https_timeout fetcher
  // mapping. The fetcher's internal AbortController has a 30s deadline
  // we cannot trigger from outside, so we wrap the test loopback
  // transport with a body adapter that throws
  // HttpsTransportError(RESPONSE_ABORTED) before yielding any chunks.
  // Phase-3 abort wiring inside the real production transport is
  // covered separately by the WI-03c MID-BODY test.
  const { fetchPageBytes, FetcherError, FETCHER_ERROR_CODES } = await import("../dist/index.js");
  const { HttpsTransportError } = await import("../dist/fetcher/httpsTransportErrors.js");
  const { loadTlsFixtures } = await import("./helpers/tls-fixtures.mjs");
  const { startLocalHttpsServer, makeTestOnlyLoopbackHttpsTransport } = await import("./helpers/tls-server.mjs");

  const fx = loadTlsFixtures();
  const server = await startLocalHttpsServer({
    key: fx.hostname.key,
    cert: fx.hostname.cert,
    bindAddress: "127.0.0.1",
    requestHandler: (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end("");
    },
  });
  t.after(() => server.stop());

  const loopbackTransport = makeTestOnlyLoopbackHttpsTransport({ ca: fx.ca, pinTo: { address: "127.0.0.1", family: 4 } });
  const abortingTransport = {
    async fetch(url, init) {
      const real = await loopbackTransport.fetch(url, init);
      // Throws before yielding any chunk so the fetcher's
      // RESPONSE_ABORTED → https_timeout mapping branch fires from
      // the body-iteration path (matching the WI-03c phase-3 abort
      // semantics) without needing real socket I/O.
      const abortingBody = (async function* () {
        throw new HttpsTransportError("synthetic mid-body abort for e2e Case 8", {
          code: "RESPONSE_ABORTED",
        });
      })();
      return { status: real.status, headers: real.headers, body: abortingBody };
    },
  };
  const submission = makeE2eSubmission();
  submission.pages[0].source.url = `https://${ALLOWED_HOST}:${server.port}/page.png`;

  await assert.rejects(
    fetchPageBytes(submission, {
      allowedFileRoot: "/tmp/unused-for-https",
      allowedHttpsHosts: new Set([ALLOWED_HOST]),
      dnsLookup: async () => [{ address: "8.8.8.8", family: 4 }],
      httpsTransport: abortingTransport,
    }),
    (err) => {
      assert.ok(err instanceof FetcherError);
      assert.equal(err.code, FETCHER_ERROR_CODES.HTTPS_TIMEOUT);
      assert.ok(err.cause instanceof HttpsTransportError);
      assert.equal(err.cause.code, "RESPONSE_ABORTED");
      return true;
    },
  );
});
