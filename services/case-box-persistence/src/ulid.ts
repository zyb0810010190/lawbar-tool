// Local schema-valid-ID helper for case-box-persistence (Phase A1).
//
// Produces 26-char lowercase strings matching the audit-event schema's
// `^[0-9a-z]{26}$` pattern. The name preserves the schema field name
// (`ulid`), but this helper does NOT provide ULID timestamp-prefix or
// lexicographic ordering semantics — the schema's `ulid` pattern is
// structural-only (it pins the alphabet + length). Append-order is
// provided by per-matter `sequence`, NOT by the ID.
//
// `crypto.randomUUID()` is NOT acceptable as the audit-event ID generator
// because it produces 36 chars with hyphens, failing the schema pattern.

import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lowercase
const LENGTH = 26;

/**
 * Generate a fresh schema-valid ID. 26 lowercase chars from
 * Crockford base32 (no `i`, `l`, `o`, `u`). Cryptographically random.
 */
export function generateUlid(): string {
  // 16 random bytes → 128 bits → fits in 26 base32 chars (130 bits of space).
  // The first 2 bits of the leading char are always zero, which is fine
  // because the alphabet includes `0`-`v`.
  const bytes = randomBytes(16);
  let bigint = 0n;
  for (const b of bytes) {
    bigint = (bigint << 8n) | BigInt(b);
  }
  const chars: string[] = [];
  for (let i = 0; i < LENGTH; i++) {
    const idx = Number(bigint & 0x1fn);
    chars.unshift(ALPHABET[idx]!);
    bigint >>= 5n;
  }
  return chars.join("");
}
