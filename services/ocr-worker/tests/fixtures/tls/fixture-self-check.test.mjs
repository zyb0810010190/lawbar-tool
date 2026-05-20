// WI-03d TLS fixture self-check.
//
// Runs as part of the ocr-worker test suite. Verifies that the static
// PEM fixtures under this directory match the documented profile in
// README.md BEFORE any WI-03d transport test consumes them. Failures
// here MUST block the WI-03d suite — they indicate fixture drift or
// expiry, not a transport bug.
//
// Checks (matching the plan's "Fixture correctness preflight"):
//   - Each leaf's SAN matches the documented profile.
//   - Each leaf is signed by the test CA (issuer DN + signature verify).
//   - Validity window covers now + 30 days.
//   - Wronghost fixture is trusted by the CA — so the WI-03d Case 4
//     failure mode is hostname-mismatch, not CA-trust.
//
// No production code is involved. Pure file reads + node:crypto.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { X509Certificate } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadCert(name) {
  return new X509Certificate(readFileSync(join(HERE, `${name}.crt`)));
}

const ca = loadCert("ca");
const hostnameCert = loadCert("server-hostname");
const ipOnlyCert = loadCert("server-ip-only");
const wrongHostCert = loadCert("server-wrong-host");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function asMs(date) {
  // X509Certificate.valid{From,To} return ISO-ish strings; use Date.parse.
  return Date.parse(date);
}

function assertValidityCoversWindow(cert, label, bufferMs) {
  const now = Date.now();
  const from = asMs(cert.validFrom);
  const to = asMs(cert.validTo);
  assert.ok(Number.isFinite(from), `${label}: validFrom not parseable: ${cert.validFrom}`);
  assert.ok(Number.isFinite(to), `${label}: validTo not parseable: ${cert.validTo}`);
  assert.ok(from <= now, `${label} not yet valid: validFrom=${cert.validFrom}`);
  assert.ok(to - now >= bufferMs, `${label} expires within ${bufferMs}ms (validTo=${cert.validTo}); regenerate fixtures`);
}

// --- CA self-consistency -----------------------------------------------

test("fixture self-check: CA is a self-signed root with the documented subject", () => {
  assert.equal(ca.subject, ca.issuer, "CA must be self-signed");
  assert.ok(/CN\s*=\s*WI-03d Test Root CA/.test(ca.subject), `unexpected CA subject: ${ca.subject}`);
});

test("fixture self-check: CA validity covers now + 30 days", () => {
  assertValidityCoversWindow(ca, "ca", THIRTY_DAYS_MS);
});

// --- Per-leaf SAN profile ----------------------------------------------

test("fixture self-check: server-hostname.crt has SAN DNS:allowed-host.test only", () => {
  const san = hostnameCert.subjectAltName;
  assert.ok(/DNS:allowed-host\.test/.test(san), `unexpected SAN: ${san}`);
  // Defensive: must NOT carry an IP SAN — the Case-2 success assertion
  // proves hostname-based verification, not IP-based.
  assert.equal(/IP[ :]/.test(san), false, `server-hostname must not have IP SAN: ${san}`);
});

test("fixture self-check: server-ip-only.crt has SAN IP:127.0.0.1 only, no DNS SAN", () => {
  const san = ipOnlyCert.subjectAltName;
  assert.ok(/IP\s*Address:127\.0\.0\.1/.test(san), `unexpected SAN: ${san}`);
  assert.equal(/DNS:/.test(san), false, `server-ip-only must not have DNS SAN: ${san}`);
});

test("fixture self-check: server-wrong-host.crt has SAN DNS:other-host.test only", () => {
  const san = wrongHostCert.subjectAltName;
  assert.ok(/DNS:other-host\.test/.test(san), `unexpected SAN: ${san}`);
  assert.equal(/IP[ :]/.test(san), false, `server-wrong-host must not have IP SAN: ${san}`);
  // Hostname-mismatch path requires the wronghost cert to be trusted
  // by the SAME test CA — otherwise the failure would be CA-trust,
  // not hostname-mismatch. The next test below verifies that.
});

// --- Trust chain --------------------------------------------------------

test("fixture self-check: every leaf is issued by the test CA (issuer DN match)", () => {
  for (const [label, cert] of [
    ["server-hostname", hostnameCert],
    ["server-ip-only", ipOnlyCert],
    ["server-wrong-host", wrongHostCert],
  ]) {
    assert.equal(cert.issuer, ca.subject, `${label} issuer mismatch — must be signed by the test CA`);
  }
});

test("fixture self-check: every leaf's signature verifies against the CA public key", () => {
  // X509Certificate#publicKey already returns a public KeyObject;
  // X509Certificate#verify accepts it directly.
  for (const [label, cert] of [
    ["server-hostname", hostnameCert],
    ["server-ip-only", ipOnlyCert],
    ["server-wrong-host", wrongHostCert],
  ]) {
    assert.ok(cert.verify(ca.publicKey), `${label} signature does not verify against the test CA public key`);
  }
});

// --- Validity windows ---------------------------------------------------

test("fixture self-check: each leaf is valid now and stays valid for 30 days", () => {
  for (const [label, cert] of [
    ["server-hostname", hostnameCert],
    ["server-ip-only", ipOnlyCert],
    ["server-wrong-host", wrongHostCert],
  ]) {
    assertValidityCoversWindow(cert, label, THIRTY_DAYS_MS);
  }
});

// --- Hostname expectations (Node's tls layer) ---------------------------

test("fixture self-check: server-hostname.crt accepts hostname 'allowed-host.test'", () => {
  // checkHost returns the matched name or undefined; truthy = match.
  assert.equal(hostnameCert.checkHost("allowed-host.test"), "allowed-host.test");
  // Mismatch must NOT spuriously match.
  assert.equal(hostnameCert.checkHost("other-host.test"), undefined);
});

test("fixture self-check: server-ip-only.crt rejects hostname 'allowed-host.test'", () => {
  // Hostname does not match an IP SAN — Case 3's failure mode.
  assert.equal(ipOnlyCert.checkHost("allowed-host.test"), undefined);
  // It DOES match an IP SAN check (defensive — proves the IP SAN is wired).
  assert.equal(ipOnlyCert.checkIP("127.0.0.1"), "127.0.0.1");
});

test("fixture self-check: server-wrong-host.crt rejects hostname 'allowed-host.test'", () => {
  // Wronghost cert is CA-trusted but does not match the hostname —
  // exactly the Case-4 failure shape (hostname-mismatch, not CA-trust).
  assert.equal(wrongHostCert.checkHost("allowed-host.test"), undefined);
  assert.equal(wrongHostCert.checkHost("other-host.test"), "other-host.test");
});
