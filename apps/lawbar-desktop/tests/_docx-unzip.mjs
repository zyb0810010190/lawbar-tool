// Dependency-free ZIP entry reader for the T3 DOCX golden test (WI-FORMS-T3-S3-DOCX-EXPORT-00).
//
// A `.docx` is a ZIP container. Extracting `word/document.xml` for the normalized-OOXML
// golden must NOT pull in `jszip` — jszip is only a reviewed TRANSITIVE of `docx`, not a
// declared dependency, so importing it directly is a dependency-control smell. This helper
// uses ONLY Node built-ins (`node:zlib`): it parses the End-of-Central-Directory record,
// walks the central directory to locate the entry + its local-header offset + compression
// method, reads the local file header, slices the compressed bytes, and inflates them
// (method 8 = deflate → inflateRawSync; method 0 = stored → the bytes as-is).
//
// NEVER hash raw `.docx` bytes — this only projects one part to text for the golden.

import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50; // PK\x05\x06
const CDH_SIG = 0x02014b50; // PK\x01\x02
const LFH_SIG = 0x04034b50; // PK\x03\x04

// Locate the End-of-Central-Directory record by scanning backward for its signature
// (the trailing comment is variable-length, so the EOCD is not at a fixed offset).
function findEocd(buf) {
  // Minimum EOCD size is 22 bytes; scan from the latest legal start position back.
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("EOCD record not found — not a valid ZIP/.docx buffer");
}

// Walk the central directory and return a map: entry name → { offset, method, compressedSize }.
function readCentralDirectory(buf) {
  const eocd = findEocd(buf);
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== CDH_SIG) {
      throw new Error(`central-directory header signature mismatch at offset ${p}`);
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { localOffset, method, compressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Read one ZIP entry's decompressed bytes given its central-directory record.
function readEntryBytes(buf, entry) {
  const { localOffset, method, compressedSize } = entry;
  if (buf.readUInt32LE(localOffset) !== LFH_SIG) {
    throw new Error(`local file header signature mismatch at offset ${localOffset}`);
  }
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) return Buffer.from(compressed); // stored — bytes as-is
  if (method === 8) return inflateRawSync(compressed); // deflate
  throw new Error(`unsupported ZIP compression method ${method}`);
}

/**
 * Extract one entry from a packed `.docx` (or any ZIP) Buffer as a UTF-8 string, using
 * only Node built-ins. Throws if the entry is absent.
 */
export function extractZipEntryText(buffer, entryName) {
  if (!Buffer.isBuffer(buffer)) throw new Error("extractZipEntryText requires a Buffer");
  const entries = readCentralDirectory(buffer);
  const entry = entries.get(entryName);
  if (entry === undefined) throw new Error(`entry "${entryName}" not found in the ZIP/.docx`);
  return readEntryBytes(buffer, entry).toString("utf8");
}
