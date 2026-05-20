// WI-03d local HTTPS server lifecycle helpers.
//
// Loopback-only TLS server harness used by WI-03d transport / e2e
// tests. The harness:
//   - binds only to 127.0.0.1 (and optionally 127.0.0.2 when the
//     loopback-alias capability probe says it's available).
//   - lets each test allocate dynamic ephemeral ports (independent
//     per server — no shared-port requirement for the two-server
//     no-reorder case).
//   - captures per-request server-side state (Host header,
//     SNI servername, peer address) for assertions.
//   - tears down all open sockets on close so a leaked socket
//     cannot keep a test runner alive.
//
// The harness uses the static fixtures from `tls-fixtures.mjs` —
// it does NOT shell out to OpenSSL.

import { createServer, request as httpsRequest } from "node:https";
import { createServer as createNetServer } from "node:net";
import { Buffer } from "node:buffer";

import { HttpsTransportError } from "../../dist/fetcher/httpsTransportErrors.js";

/**
 * Start a local HTTPS server on the given loopback address.
 *
 * @param {object} options
 * @param {Buffer} options.key - PEM private key for the server cert.
 * @param {Buffer} options.cert - PEM server certificate.
 * @param {string} [options.bindAddress] - Loopback address to bind to
 *   (`"127.0.0.1"` by default; pass `"127.0.0.2"` when alias is
 *   available). Anything outside `127.0.0.0/8` is rejected — this
 *   harness is loopback-only by design.
 * @param {number} [options.port] - Optional explicit port. Defaults to
 *   `0` (OS-assigned). Pass a specific port to bind two harnesses on
 *   different loopback aliases at the same port (the no-reorder proof
 *   needs this so a reorder bug yields a wrong marker, not a refused
 *   connection).
 * @param {(req: import("node:http").IncomingMessage,
 *           res: import("node:http").ServerResponse,
 *           state: ServerState) => void} options.requestHandler
 *   Per-request handler. The handler receives a mutable `state`
 *   object so assertions can capture Host, SNI, peer address, etc.
 * @returns {Promise<StartedServer>}
 */
export async function startLocalHttpsServer(options) {
  const bindAddress = options.bindAddress ?? "127.0.0.1";
  if (!/^127\./.test(bindAddress)) {
    throw new Error(
      `tls-server.mjs is loopback-only; refusing to bind to ${bindAddress}`,
    );
  }
  const bindPort = typeof options.port === "number" ? options.port : 0;

  /** @type {ServerState} */
  const state = {
    requests: [],
    sockets: new Set(),
  };

  const server = createServer({ key: options.key, cert: options.cert }, (req, res) => {
    // Capture per-request observables for assertions BEFORE invoking
    // the handler so even handler exceptions surface useful state.
    const capture = {
      hostHeader: req.headers.host ?? null,
      // tls.TLSSocket exposes `.servername` (SNI). Falsy when SNI
      // was absent; truthy = client sent SNI of this hostname.
      sniServername:
        typeof (/** @type {any} */ (req.socket).servername) === "string"
          ? (/** @type {any} */ (req.socket).servername)
          : null,
      // Strip ::ffff: IPv4-mapped IPv6 prefix so assertions can
      // compare against the bind address straight.
      socketLocalAddress: stripIpv4Mapped(req.socket.localAddress ?? null),
      socketRemoteAddress: stripIpv4Mapped(req.socket.remoteAddress ?? null),
    };
    state.requests.push(capture);
    try {
      options.requestHandler(req, res, state);
    } catch (err) {
      try {
        res.statusCode = 500;
        res.end(`harness handler threw: ${(err && err.message) || err}`);
      } catch {
        // Connection may be already torn down; nothing else to do.
      }
    }
  });

  server.on("connection", (socket) => {
    state.sockets.add(socket);
    socket.once("close", () => state.sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(undefined);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(bindPort, bindAddress);
  });

  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("server.address() did not return AddressInfo");
  }

  return {
    server,
    bindAddress,
    port: addr.port,
    url: `https://${bindAddress}:${addr.port}`,
    state,
    /**
     * Tear down: destroy any sockets the harness is still tracking,
     * then close the server. Awaits the `close` event so the test
     * runner records the teardown deterministically.
     */
    async stop() {
      for (const socket of state.sockets) {
        try {
          socket.destroy();
        } catch {
          // best-effort cleanup
        }
      }
      state.sockets.clear();
      await new Promise((resolve) => {
        server.close(() => resolve(undefined));
      });
    },
  };
}

/**
 * Capability probe for the `127.0.0.2` loopback alias. Probes by
 * attempting a single TCP `listen(0, "127.0.0.2")` against a plain
 * net server; closes immediately on success. Result is `available: true`
 * on a clean bind, `available: false` with `reason` on a deterministic
 * failure (e.g. `EADDRNOTAVAIL`), and the test FAILS (probe throws)
 * on any other error per the WI-03d plan's "fail on unknown" rule.
 *
 * @returns {Promise<{ available: boolean, reason: string | null }>}
 */
export async function probe127_0_0_2_loopback() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    const cleanup = () =>
      new Promise((done) => {
        try {
          server.close(() => done(undefined));
        } catch {
          done(undefined);
        }
      });
    server.once("error", (err) => {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code ?? "UNKNOWN";
      cleanup().then(() => {
        if (code === "EADDRNOTAVAIL" || code === "EACCES") {
          // Deterministic unsupported result — alias is not configured
          // on this platform. The plan permits skipping the alias-
          // dependent sub-case in this state.
          resolve({ available: false, reason: `127.0.0.2 bind failed: ${code}` });
          return;
        }
        // Any other error is treated as unknown — per plan, fail loudly
        // rather than silently degrade.
        reject(new Error(`127.0.0.2 probe failed with unexpected code ${code}: ${err.message}`));
      });
    });
    server.once("listening", () => {
      cleanup().then(() => resolve({ available: true, reason: null }));
    });
    server.listen(0, "127.0.0.2");
  });
}

function stripIpv4Mapped(addr) {
  if (typeof addr !== "string") return null;
  return addr.startsWith("::ffff:") ? addr.slice("::ffff:".length) : addr;
}

/**
 * Convenience handler factory for the no-reorder marker contract.
 * Each server returns a distinct `x-wi03d-marker` header AND a
 * distinct body byte string. Both must be asserted by the test.
 *
 * @param {string} markerId - e.g. "A" or "B".
 * @returns {(req: any, res: any, state: ServerState) => void}
 */
export function makeMarkerHandler(markerId) {
  return (_req, res) => {
    const body = Buffer.from(`marker:${markerId}`, "utf8");
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("content-length", String(body.byteLength));
    res.setHeader("x-wi03d-marker", markerId);
    res.statusCode = 200;
    res.end(body);
  };
}

/**
 * Test-only HTTPS transport that connects directly to a loopback
 * server via `node:https.request` with a pinned `lookup`. This is
 * NOT the production transport — it intentionally bypasses the
 * WI-03b preflight `allowedAddresses` validator so the WI-03d
 * TLS / no-reorder / e2e tests can drive a real TLS handshake
 * against a loopback test server without tripping the production
 * transport's "no private IPs" guard.
 *
 * Pinning behavior matches production: the socket is pinned to
 * `init.allowedAddresses[0]` via the custom `lookup` callback.
 * SNI + cert verification still use the URL hostname. Body chunks
 * are adapted to strict `Uint8Array` per ADR §6 / WI-03c.
 *
 * Coverage rationale: WI-03b preflight blocks all RFC1918/loopback/
 * link-local addresses by design. There is no public IP we can run
 * a local HTTPS server against; the only way to exercise real TLS
 * verification against the test fixtures is to bypass preflight in
 * test code. The production preflight is tested exhaustively by the
 * 22 WI-03b validation cases earlier in this file, and the
 * production transport's pinned lookup is unit-tested by the
 * `makePinnedLookup` direct tests in `pinnedLookup.test.mjs`.
 *
 * Surface matches `HttpsTransport` so it can be passed via
 * `FetcherDeps.httpsTransport`.
 *
 * Two pinning modes:
 *   - Default (`pinTo` omitted): pin to `init.allowedAddresses[0]` —
 *     mirrors production behavior. Use when the test drives
 *     `transport.fetch` directly (e.g. TLS / no-reorder / phase-2
 *     abort cases).
 *   - Override (`pinTo` provided): ignore `init.allowedAddresses` and
 *     pin to the constructor-supplied IP. Use for e2e tests where
 *     the fetcher's DNS stub returns a public-looking address to
 *     satisfy the `host_resolves_to_private_ip` gate, but the actual
 *     socket must still reach a loopback test server.
 *
 * @param {{ ca: Buffer, pinTo?: { address: string, family: number } }} options
 * @returns {import("../../dist/fetcher/types.js").HttpsTransport}
 */
export function makeTestOnlyLoopbackHttpsTransport(options) {
  return {
    fetch(url, init) {
      return new Promise((resolve, reject) => {
        const pinned = options.pinTo ?? init.allowedAddresses[0];
        if (!pinned || typeof pinned.address !== "string" || typeof pinned.family !== "number") {
          reject(new Error("test-only transport requires init.allowedAddresses[0] or options.pinTo: { address, family }"));
          return;
        }
        const req = httpsRequest(
          url,
          {
            method: "GET",
            signal: init.signal,
            agent: false,
            rejectUnauthorized: true,
            servername: url.hostname,
            ca: options.ca,
            // Pin lookup to `init.allowedAddresses[0]` so the socket
            // reaches the requested loopback (or aliased loopback) even
            // though the URL hostname is allowed-host.test. SNI + cert
            // verification still use the URL hostname.
            lookup: (_host, opts, cb) => {
              let callback;
              let optionsArg;
              if (typeof opts === "function") {
                callback = opts;
                optionsArg = undefined;
              } else {
                callback = cb;
                optionsArg = opts;
              }
              if (optionsArg && optionsArg.all === true) {
                callback(null, [{ address: pinned.address, family: pinned.family }]);
              } else {
                callback(null, pinned.address, pinned.family);
              }
            },
          },
          (res) => {
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (Array.isArray(v)) for (const item of v) headers.append(k, item);
              else if (v !== undefined) headers.set(k, String(v));
            }
            // Detect duplicate content-length in rawHeaders so e2e
            // Case 7 can exercise the same multiplicity rejection the
            // production transport enforces. Without this, Node would
            // collapse duplicates and the test would not see the
            // RESPONSE_CONTENT_LENGTH_DUPLICATE failure.
            let clCount = 0;
            const raw = res.rawHeaders;
            for (let i = 0; i < raw.length; i += 2) {
              if (raw[i].toLowerCase() === "content-length") clCount++;
            }
            if (clCount > 1) {
              // Synthesize the same internal error the production
              // transport would throw, so the fetcher mapping branch
              // sees an HttpsTransportError as in production. Reject
              // BEFORE destroying res so the Node error emitted by
              // destroy doesn't race-win the reject().
              reject(
                new HttpsTransportError(
                  "response Content-Length header appears more than once",
                  { code: "RESPONSE_CONTENT_LENGTH_DUPLICATE" },
                ),
              );
              res.destroy();
              return;
            }
            const body = (async function* () {
              for await (const chunk of res) {
                const adapted = Buffer.isBuffer(chunk)
                  ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
                  : chunk;
                yield adapted;
              }
            })();
            resolve({ status: res.statusCode, headers, body });
          },
        );
        req.on("error", (err) => {
          // Match production transport's abort semantics: wrap any
          // signal-aborted error as HttpsTransportError(RESPONSE_ABORTED)
          // so the fetcher's WI-03c RESPONSE_ABORTED → https_timeout
          // mapping branch fires correctly through this test transport
          // too.
          if (init.signal && init.signal.aborted) {
            reject(
              new HttpsTransportError(
                "request aborted before response yielded",
                { code: "RESPONSE_ABORTED", cause: err },
              ),
            );
            return;
          }
          // Node's HTTP parser rejects responses with duplicate
          // Content-Length headers BEFORE the response callback runs,
          // emitting `HPE_UNEXPECTED_CONTENT_LENGTH`. Translate to the
          // same internal discriminator the production transport would
          // have raised via parseStrictContentLength so the fetcher's
          // isHttpsTransportError branch fires and the e2e mapping
          // test can assert `cause.code === RESPONSE_CONTENT_LENGTH_DUPLICATE`.
          if (err && err.code === "HPE_UNEXPECTED_CONTENT_LENGTH") {
            reject(
              new HttpsTransportError(
                "response Content-Length header appears more than once",
                { code: "RESPONSE_CONTENT_LENGTH_DUPLICATE", cause: err },
              ),
            );
            return;
          }
          // Other errors propagate untouched (Node TLS errors etc.
          // flow into the fetcher's generic catch-all, which preserves
          // them as `cause` per the WI-03d generic-cause-preservation
          // change).
          reject(err);
        });
        req.end();
      });
    },
  };
}

/**
 * @typedef {{
 *   requests: Array<{
 *     hostHeader: string | null,
 *     sniServername: string | null,
 *     socketLocalAddress: string | null,
 *     socketRemoteAddress: string | null,
 *   }>,
 *   sockets: Set<import("node:net").Socket>,
 * }} ServerState
 */

/**
 * @typedef {{
 *   server: import("node:https").Server,
 *   bindAddress: string,
 *   port: number,
 *   url: string,
 *   state: ServerState,
 *   stop: () => Promise<void>,
 * }} StartedServer
 */
