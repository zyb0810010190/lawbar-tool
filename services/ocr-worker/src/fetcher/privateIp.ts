// Non-globally-routable IP detector for the https fetcher's anti-SSRF
// post-DNS check. See ADR-11D.2 §3 + audit 019e3af0 D2 High fix.
//
// Policy v1: "block non-globally-routable". Returns true for any
// address in a range that should never be reached over the public
// internet. Audit fix: previous version was a hand-picked private
// shortlist that missed several special-use ranges and had a real
// IPv4-mapped IPv6 hex-form bypass.
//
// IPv4-mapped IPv6 (e.g. `::ffff:7f00:1` for loopback) is normalized
// to its embedded IPv4 form and re-checked.

import { BlockList, isIPv4, isIPv6 } from "node:net";

/**
 * Special-use IPv4 ranges per IANA. Updated to cover the full
 * "should never appear as a fetch destination" surface (audit
 * 019e3af0 D2 Medium fix).
 */
const BLOCKED_V4_SUBNETS: ReadonlyArray<{ readonly base: string; readonly prefix: number }> = [
  { base: "0.0.0.0",      prefix: 8 },   // "this network"
  { base: "10.0.0.0",     prefix: 8 },   // RFC 1918 private
  { base: "100.64.0.0",   prefix: 10 },  // CGNAT
  { base: "127.0.0.0",    prefix: 8 },   // loopback
  { base: "169.254.0.0",  prefix: 16 },  // link-local + cloud metadata
  { base: "172.16.0.0",   prefix: 12 },  // RFC 1918 private
  { base: "192.0.0.0",    prefix: 24 },  // IETF protocol assignments
  { base: "192.0.2.0",    prefix: 24 },  // TEST-NET-1
  { base: "192.168.0.0",  prefix: 16 },  // RFC 1918 private
  { base: "198.18.0.0",   prefix: 15 },  // benchmark testing
  { base: "198.51.100.0", prefix: 24 },  // TEST-NET-2
  { base: "203.0.113.0",  prefix: 24 },  // TEST-NET-3
  { base: "224.0.0.0",    prefix: 4 },   // multicast
  { base: "240.0.0.0",    prefix: 4 },   // reserved for future use
  { base: "255.255.255.255", prefix: 32 }, // broadcast
];

/**
 * Non-globally-routable IPv6 prefixes per IANA + RFC 4291.
 */
const BLOCKED_V6_SUBNETS: ReadonlyArray<{ readonly base: string; readonly prefix: number }> = [
  { base: "::",       prefix: 128 }, // unspecified
  { base: "::1",      prefix: 128 }, // loopback
  { base: "fe80::",   prefix: 10 },  // link-local
  { base: "fc00::",   prefix: 7 },   // unique local
  { base: "ff00::",   prefix: 8 },   // multicast
  { base: "2001:db8::", prefix: 32 }, // documentation
];

const blockList = (() => {
  const list = new BlockList();
  for (const { base, prefix } of BLOCKED_V4_SUBNETS) {
    list.addSubnet(base, prefix, "ipv4");
  }
  for (const { base, prefix } of BLOCKED_V6_SUBNETS) {
    list.addSubnet(base, prefix, "ipv6");
  }
  return list;
})();

export function isPrivateIp(address: string): boolean {
  if (typeof address !== "string" || address.length === 0) return false;

  // Step 1: detect IPv4-mapped IPv6 (`::ffff:a.b.c.d` dotted form OR
  // `::ffff:wwww:xxxx` hex form) and recurse on the embedded IPv4.
  // Audit 019e3af0 D2 High: previous code only handled the dotted
  // form via regex; hex form like `::ffff:7f00:1` (= 127.0.0.1)
  // bypassed the block entirely.
  if (isIPv6(address)) {
    const embedded = extractEmbeddedV4(address);
    if (embedded !== null) {
      // Re-check as IPv4 against the v4 blocklist.
      return blockList.check(embedded, "ipv4");
    }
    return blockList.check(address, "ipv6");
  }
  if (isIPv4(address)) {
    return blockList.check(address, "ipv4");
  }
  // Not a valid IP literal — treat as private (fail-closed) so a
  // malformed/empty address can't bypass the check.
  return true;
}

/**
 * Extract the embedded IPv4 address from an IPv4-mapped IPv6 form,
 * or null if the input is not such a form.
 *
 * IPv4-mapped IPv6 has the top 80 bits as zero, next 16 bits as
 * 0xffff, and bottom 32 bits as the IPv4 address. Two text forms
 * are valid per RFC 4291:
 *   - dotted: `::ffff:127.0.0.1`
 *   - hex:    `::ffff:7f00:1` (or `::ffff:7f00:0001`)
 *
 * We expand the IPv6 to its full 8-group form, check the top-6
 * groups are zero + the 7th group is 0xffff, and assemble the
 * v4 from groups 7-8.
 */
function extractEmbeddedV4(addr: string): string | null {
  const groups = expandIPv6(addr);
  if (groups === null) return null;
  if (groups.length !== 8) return null;
  for (let i = 0; i < 5; i++) {
    if (groups[i] !== 0) return null;
  }
  if (groups[5] !== 0xffff) return null;
  // Build the dotted-decimal v4 from groups 6 + 7 (each is 16 bits).
  const high = groups[6]!;
  const low = groups[7]!;
  const a = (high >> 8) & 0xff;
  const b = high & 0xff;
  const c = (low >> 8) & 0xff;
  const d = low & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

/**
 * Expand a possibly-compressed IPv6 string to an array of 8
 * 16-bit numbers. Returns null on malformed input. Handles `::`
 * compression and the dotted-decimal embedded IPv4 form.
 */
function expandIPv6(addr: string): number[] | null {
  if (!isIPv6(addr)) return null;
  let s = addr.toLowerCase();
  // Strip zone id (e.g., `fe80::1%eth0`).
  const zoneAt = s.indexOf("%");
  if (zoneAt !== -1) s = s.slice(0, zoneAt);

  // If the address has a dotted-decimal IPv4 tail (e.g.
  // `::ffff:127.0.0.1`), convert the v4 portion to two hex groups
  // and re-join.
  const dotIdx = s.indexOf(".");
  if (dotIdx !== -1) {
    const lastColon = s.lastIndexOf(":", dotIdx);
    if (lastColon === -1) return null;
    const v4 = s.slice(lastColon + 1);
    const parts = v4.split(".");
    if (parts.length !== 4) return null;
    const octets = parts.map((p) => Number.parseInt(p, 10));
    for (const o of octets) {
      if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    }
    const g1 = (octets[0]! << 8) | octets[1]!;
    const g2 = (octets[2]! << 8) | octets[3]!;
    s = s.slice(0, lastColon + 1) + g1.toString(16) + ":" + g2.toString(16);
  }

  // Handle `::` compression.
  const dcIdx = s.indexOf("::");
  let parts: string[];
  if (dcIdx === -1) {
    parts = s.split(":");
  } else {
    const left = s.slice(0, dcIdx);
    const right = s.slice(dcIdx + 2);
    const leftParts = left === "" ? [] : left.split(":");
    const rightParts = right === "" ? [] : right.split(":");
    const fillCount = 8 - leftParts.length - rightParts.length;
    if (fillCount < 0) return null;
    parts = [...leftParts, ...Array(fillCount).fill("0"), ...rightParts];
  }
  if (parts.length !== 8) return null;
  const groups: number[] = [];
  for (const p of parts) {
    if (p.length === 0 || p.length > 4) return null;
    if (!/^[0-9a-f]+$/.test(p)) return null;
    groups.push(Number.parseInt(p, 16));
  }
  return groups;
}
