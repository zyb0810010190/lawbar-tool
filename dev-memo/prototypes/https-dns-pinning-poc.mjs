// WI-01 prototype gate (ADR-11D.2-A §"Required sequencing").
//
// Proves the mechanism the production transport rewrite will use:
//
//   1. `node:https.request` against a URL whose hostname is the
//      original allowed hostname (NOT an IP literal).
//   2. A custom `lookup` callback returns exactly ONE vetted IP,
//      so the socket connects to that address while the request
//      keeps the hostname.
//   3. `servername: url.hostname` forces TLS SNI to the original
//      hostname (not the pinned IP).
//   4. Per-request `ca` injection through `tls.connect` options
//      (not `NODE_EXTRA_CA_CERTS`) — the test process's global TLS
//      trust stays unchanged.
//   5. Hostname certificate verification: a cert valid for the
//      original hostname succeeds; a cert valid only for the pinned
//      IP fails; a cert valid only for an unrelated hostname fails.
//
// The proof is the ADR's "prototype gate": full transport rewrite
// (WI-02t / WI-02 / WI-03) only proceeds after this passes.
//
// Run:
//
//     node dev-memo/prototypes/https-dns-pinning-poc.mjs
//
// Exit code 0 = all three scenarios behaved as expected. Non-zero =
// gate FAILED; do not start WI-02t / WI-02 / WI-03.
//
// Note: this prototype exercises only the Node 22 `options.all === true`
// shape of the `lookup` callback (which is what `http.request` invokes
// on Node 22 today). The legacy `cb(err, address, family)` branch in
// the callback is retained for forward portability but is NOT proved
// by WI-01. If/when the production transport must run on a Node version
// that uses the legacy callback path, that path needs its own test.

import { createServer as createHttpsServer } from "node:https";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";

import { generateCertSuite } from "./https-dns-pinning-cert-helper.mjs";

// ---------------------------------------------------------------------------
// Test fixture parameters
// ---------------------------------------------------------------------------

const HOSTNAME = "allowed-host.test";
const PINNED_IP = "127.0.0.1";
const PINNED_FAMILY = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Start an HTTPS server with the given cert; resolve when listening.
 *
 * The server-side `ca` option is intentionally NOT set: this prototype
 * proves hostname certificate verification on the CLIENT side, where
 * the per-request `ca` injection lives. Adding `ca` to the server
 * would muddy the signal (server-side `ca` is for client-cert
 * verification, which is disabled here via `requestCert: false`).
 */
function startTlsServer({ key, cert }) {
  return new Promise((resolve, reject) => {
    const server = createHttpsServer(
      { key, cert, requestCert: false },
      (req, res) => {
        // Capture what the server sees: Host header, SNI servername,
        // and the local socket address (proves where the client
        // actually connected to, not just where the server is bound).
        const observed = {
          host: req.headers.host,
          servername: req.socket?.servername ?? null,
          localAddress: req.socket?.localAddress ?? null,
          remoteAddress: req.socket?.remoteAddress ?? null,
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(observed));
      },
    );
    server.on("error", reject);
    server.listen(0, PINNED_IP, () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

/** Issue one https.request with the pinned lookup + per-request CA. */
function probeHttpsRequest({ url, ca, signalTimeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), signalTimeoutMs);
    const req = httpsRequest(
      url,
      {
        method: "GET",
        signal: ac.signal,
        agent: false,
        rejectUnauthorized: true,
        servername: url.hostname,
        ca,
        // Custom lookup pins the socket address to PINNED_IP while the
        // request keeps url.hostname for SNI + cert verification.
        //
        // Node 22's http.request calls lookup with `options.all = true`,
        // which expects callback signature `cb(err, addresses[])` where
        // each entry is `{ address, family }`. Handle both modes
        // defensively so this prototype is portable across Node versions
        // that may still use the legacy `cb(err, address, family)` form.
        lookup(_host, opts, cb) {
          if (opts && opts.all === true) {
            cb(null, [{ address: PINNED_IP, family: PINNED_FAMILY }]);
          } else {
            cb(null, PINNED_IP, PINNED_FAMILY);
          }
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          clearTimeout(timer);
          resolve({
            kind: "ok",
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", (err) => {
          clearTimeout(timer);
          resolve({ kind: "stream-error", error: String(err) });
        });
      },
    );
    req.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        kind: "request-error",
        code: err.code,
        message: err.message,
      });
    });
    req.end();
  });
}

function loadCertSet(set) {
  return {
    key: readFileSync(set.keyPath),
    cert: readFileSync(set.certPath),
  };
}

function readCa(ca) {
  return readFileSync(ca.caCert);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function runScenario(label, cert, ca, expect) {
  let server, port;
  try {
    ({ server, port } = await startTlsServer(loadCertSet(cert)));
    const url = new URL(`https://${HOSTNAME}:${port}/probe`);
    const result = await probeHttpsRequest({
      url,
      ca: readCa(ca),
    });
    const pass = matchesExpectation(result, expect);
    return { label, pass, result, expect };
  } finally {
    if (server) await new Promise((r) => server.close(r));
  }
}

function matchesExpectation(result, expect) {
  if (expect.kind === "tls-handshake-success") {
    if (result.kind !== "ok") return false;
    if (result.statusCode !== 200) return false;
    let observed;
    try {
      observed = JSON.parse(result.body);
    } catch {
      return false;
    }
    // Server must have seen the original hostname in both Host and SNI.
    if (typeof observed.host !== "string") return false;
    if (!observed.host.startsWith(`${HOSTNAME}:`) && observed.host !== HOSTNAME) {
      return false;
    }
    if (observed.servername !== HOSTNAME) return false;
    // The custom `lookup` pinned the socket to PINNED_IP; the server
    // must have observed both the local bind (127.0.0.1) AND a remote
    // peer address that is 127.0.0.1 (since the client connected via
    // the loopback). Drop the IPv4-mapped IPv6 prefix `::ffff:` if
    // Node returned it for the IPv4 socket.
    const remote = observed.remoteAddress?.replace(/^::ffff:/, "");
    const local = observed.localAddress?.replace(/^::ffff:/, "");
    if (local !== PINNED_IP) return false;
    if (remote !== PINNED_IP) return false;
    return true;
  }
  if (expect.kind === "tls-hostname-verification-error") {
    if (result.kind !== "request-error") return false;
    // ONLY accept hostname/altname-verification failures. CA-unknown,
    // bad-cert, and self-signed-cert failures are NOT what this gate
    // is supposed to prove — those would indicate a broken CA chain,
    // which would mask the real "hostname verification rejected" case
    // the production transport relies on.
    const hostnameVerificationCodes = new Set([
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "ERR_OSSL_X509_HOST_MISMATCH",
    ]);
    if (hostnameVerificationCodes.has(result.code)) return true;
    // Some Node versions surface ERR_TLS_CERT_ALTNAME_INVALID with a
    // message like "Hostname/IP does not match certificate's altnames".
    // Accept that as a fallback only when code is missing.
    if (
      typeof result.message === "string" &&
      /altname|hostname.*does not match.*cert/i.test(result.message)
    ) {
      return true;
    }
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "wi01-dns-pinning-poc-"));
  let exitCode = 0;
  try {
    const suite = generateCertSuite({ workDir, hostname: HOSTNAME });

    const scenarios = [
      {
        label: "cert-valid-for-hostname",
        cert: suite.certHostname,
        ca: suite.ca,
        expect: { kind: "tls-handshake-success" },
      },
      {
        label: "cert-valid-only-for-ip-literal",
        cert: suite.certIpOnly,
        ca: suite.ca,
        expect: { kind: "tls-hostname-verification-error" },
      },
      {
        label: "cert-valid-only-for-wrong-hostname",
        cert: suite.certWrongHost,
        ca: suite.ca,
        expect: { kind: "tls-hostname-verification-error" },
      },
    ];

    const results = [];
    for (const s of scenarios) {
      const r = await runScenario(s.label, s.cert, s.ca, s.expect);
      results.push(r);
    }

    const heading = `WI-01 — HTTPS DNS-Pinning TLS Prototype Gate (Node ${process.version}, ${process.platform}-${process.arch})`;
    console.log("\n" + heading);
    console.log("=".repeat(heading.length));
    for (const r of results) {
      console.log(
        `${r.pass ? "PASS" : "FAIL"}  ${r.label}  -- expect=${r.expect.kind}`,
      );
      if (!r.pass) {
        console.log("       observed:", JSON.stringify(r.result));
        exitCode = 1;
      }
    }
    console.log("");
    if (exitCode === 0) {
      console.log("✓ All scenarios passed.");
      console.log("  - SNI/Host matched the original hostname.");
      console.log("  - Per-request CA injection worked (no global TLS state changed).");
      console.log("  - Hostname-cert success / IP-only-cert fail / wrong-host-cert fail behave as expected.");
      console.log("  WI-01 prototype gate is GREEN. WI-02t / WI-02 / WI-03 may proceed.");
    } else {
      console.log("✗ One or more scenarios failed. WI-01 prototype gate is RED.");
      console.log("  Do not start WI-02t / WI-02 / WI-03 until this gate passes.");
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("WI-01 prototype harness threw an unhandled error:", err);
  process.exit(2);
});
