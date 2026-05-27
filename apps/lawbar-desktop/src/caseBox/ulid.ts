import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function newUlid(now: number = Date.now()): string {
  const timeBuf = encodeTime(now, 10);
  const randomBuf = encodeRandom(16);
  const out = timeBuf + randomBuf;
  if (!/^[0-9a-z]{26}$/.test(out)) {
    throw new Error("ulid: generated id did not match schema regex");
  }
  return out;
}

function encodeTime(ms: number, length: number): string {
  let out = "";
  let value = Math.floor(ms);
  for (let i = length - 1; i >= 0; i--) {
    const mod = value % 32;
    out = ALPHABET[mod] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % 32];
  }
  return out;
}
