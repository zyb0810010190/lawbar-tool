// Private/loopback/link-local IP range detector for the https
// fetcher's anti-SSRF post-DNS check. See ADR-11D.2 §3.
//
// Pure function. Pass an IP literal (v4 or v6, as produced by
// `dns.promises.lookup`). Returns true if the address falls in
// any range we consider "internal" for v1.
//
// IPv4-mapped IPv6 (`::ffff:0:0/96`) is unwrapped and the embedded
// v4 is re-checked.

const IPV4_PRIVATE_BLOCKS: ReadonlyArray<{
  readonly base: number;
  readonly mask: number;
}> = [
  { base: 0x00000000, mask: 0xff000000 },   // 0.0.0.0/8
  { base: 0x0a000000, mask: 0xff000000 },   // 10.0.0.0/8
  { base: 0x7f000000, mask: 0xff000000 },   // 127.0.0.0/8 (loopback)
  { base: 0xa9fe0000, mask: 0xffff0000 },   // 169.254.0.0/16 (link-local)
  { base: 0xac100000, mask: 0xfff00000 },   // 172.16.0.0/12
  { base: 0xc0a80000, mask: 0xffff0000 },   // 192.168.0.0/16
  { base: 0x64400000, mask: 0xffc00000 },   // 100.64.0.0/10 (CGNAT)
  { base: 0xc6120000, mask: 0xfffe0000 },   // 198.18.0.0/15 (benchmark)
];

export function isPrivateIp(address: string): boolean {
  if (typeof address !== "string" || address.length === 0) return false;

  // IPv4-mapped IPv6 ("::ffff:1.2.3.4" or "::ffff:0102:0304")
  // unwrap to the v4 portion and re-check.
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (v4Mapped) {
    return isPrivateIpv4(v4Mapped[1]!);
  }

  if (address.includes(":")) {
    return isPrivateIpv6(address);
  }
  return isPrivateIpv4(address);
}

function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number.parseInt(p, 10));
  for (const o of octets) {
    if (!Number.isInteger(o) || o < 0 || o > 255) return false;
  }
  const n = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
  for (const block of IPV4_PRIVATE_BLOCKS) {
    if ((n & block.mask) === block.base) return true;
  }
  return false;
}

function isPrivateIpv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  // Loopback: ::1
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  // Link-local: fe80::/10
  if (lower.startsWith("fe8") || lower.startsWith("fe9") ||
      lower.startsWith("fea") || lower.startsWith("feb")) {
    return true;
  }
  // Unique local: fc00::/7 (fc.. or fd..)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // Unspecified: ::
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true;
  return false;
}
