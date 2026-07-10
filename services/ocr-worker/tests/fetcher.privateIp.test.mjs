// fetcher.privateIp.test.mjs — direct unit test of the SSRF-core `isPrivateIp`
// (WI-OCR-FETCHER-SECURITY-23). The fetcher's DNS seam already tests a subset of
// addresses end-to-end (fetcher.https.test.mjs); this pins the pure function's FULL
// contract directly, so a future edit that breaks a blocked range — OR over-blocks a
// public address (which would break legitimate fetches) — fails here immediately.
//
// No network. Pure string classification. Uses the built module subpath.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isPrivateIp } from "../dist/fetcher/privateIp.js";

// Every one of these MUST be blocked (isPrivateIp === true).
const BLOCKED = [
  // loopback
  "127.0.0.1", "127.1.2.3", "::1",
  // RFC1918 private
  "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.168.255.255",
  // CGNAT (RFC 6598 shared address space)
  "100.64.0.1", "100.127.255.255",
  // link-local + cloud metadata (169.254.169.254)
  "169.254.0.1", "169.254.169.254",
  // IPv6 link-local / unique-local / unspecified / multicast
  "fe80::1", "fe80::abcd", "fc00::1", "fd12:3456:789a::1", "::", "ff00::1",
  // additional IANA IPv6 "Globally Reachable: False" ranges (audit H1)
  "64:ff9b:1::1", "100::1", "100:0:0:1::1", "2001:2::1", "3fff::1", "5f00::1",
  // IPv4 multicast / reserved / this-network / broadcast
  "224.0.0.1", "240.0.0.1", "0.0.0.0", "255.255.255.255",
  // TEST-NET / documentation / benchmark ranges (also used as SSRF decoys in tests)
  "192.0.2.5", "198.51.100.9", "203.0.113.5", "198.18.0.1", "2001:db8::1",
  // IPv4-mapped IPv6 — dotted AND hex form (the audit-019e3af0 bypass class)
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:c0a8:0101", "::ffff:169.254.169.254",
  // zone id must not defeat the check
  "fe80::1%eth0",
];

// Every one of these MUST be allowed (isPrivateIp === false) — public/global addresses.
// Over-blocking any of these would silently break legitimate document fetches.
const ALLOWED = [
  "8.8.8.8", "1.1.1.1", "93.184.216.34",
  // boundaries just OUTSIDE blocked ranges
  "172.15.255.255", "172.32.0.0", "100.63.255.255", "100.128.0.0", "11.0.0.1",
  // public IPv6 (Cloudflare / Google DNS)
  "2606:4700:4700::1111", "2001:4860:4860::8888",
];

// Unparseable / malformed inputs MUST fail closed (treated as private → true).
const FAIL_CLOSED = ["", "not-an-ip", "999.999.999.999", "garbage:::", "  ", "example.com"];

test("isPrivateIp blocks every non-globally-routable range (SSRF core)", () => {
  for (const ip of BLOCKED) {
    assert.equal(isPrivateIp(ip), true, `expected ${ip} to be BLOCKED (private/special-use)`);
  }
});

test("isPrivateIp allows public/global addresses (no over-block that would break fetches)", () => {
  for (const ip of ALLOWED) {
    assert.equal(isPrivateIp(ip), false, `expected ${ip} to be ALLOWED (public)`);
  }
});

test("isPrivateIp fails closed on unparseable input (blocks, never allows)", () => {
  for (const ip of FAIL_CLOSED) {
    assert.equal(isPrivateIp(ip), true, `expected malformed ${JSON.stringify(ip)} to fail closed (blocked)`);
  }
});

// The guard also covers `typeof address !== "string"` — pin that half of the fix
// (audit L2). Runtime JS can pass a non-string despite the `: string` type.
test("isPrivateIp fails closed on non-string input", () => {
  for (const bad of [undefined, null, {}, 42, [], true]) {
    assert.equal(isPrivateIp(bad), true, `expected non-string ${String(bad)} to fail closed (blocked)`);
  }
});
