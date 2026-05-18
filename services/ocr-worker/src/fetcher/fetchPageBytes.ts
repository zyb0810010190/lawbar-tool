// Page fetcher: turn an OcrSubmission's source field into bytes for
// the engine. See ADR-11C.2 for every gate pinned here.
//
// v1 supports `kind: "file"` only. s3 / https / inline are rejected at
// the boundary with stable code `source_kind_unsupported`. ADR-11C.2 §1
// explains why this lives in the fetcher rather than the ingestion
// validator (vocabulary stays open; admission policy is engine-local).
//
// TOCTOU posture (audit 019e3a07 D2 High): the fetcher uses an
// fd-based read pattern — `open` + `fstat` + `read` on the SAME fd —
// so the size + regular-file checks and the byte read all operate on
// the inode the fd points at. A path replacement after `open` cannot
// substitute different content under us. The remaining residual is a
// same-inode in-place rewrite, which requires write access to the
// fd's inode and is out of v1 threat model (the file root is
// worker-owned).

import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { OcrSubmission } from "ocr-worker-contract";

import {
  FetcherError,
  FETCHER_ERROR_CODES,
  type FetchedPage,
  type FetcherDeps,
} from "./types.js";
import {
  assertLexicallyContained,
  assertRealContained,
} from "./pathContainment.js";

/**
 * Maximum bytes per page. Pinned by ADR-11C.2 §6.
 *
 * 50 MB covers a 600-DPI A4 PNG with comfortable headroom; 300-DPI
 * scans land at ~5–10 MB. Hard cap — operators raise this only by
 * amending the ADR. Cap is inclusive (a 50 MB exact file passes).
 */
const MAX_PAGE_BYTES = 50 * 1024 * 1024;

/**
 * MIME allowlist for v1. Pinned by ADR-11C.2 §6 + ADR-11A.0 §8
 * (anti-PDF).
 */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
]);

/**
 * Magic-byte signatures the fetcher accepts as proof-of-format for the
 * v1 MIME allowlist. Post-read sniff (audit 019e3a07 D2 Medium): a
 * caller declaring `image/png` while shipping a PDF or arbitrary
 * payload is rejected here, not deferred to the engine.
 *
 * - PNG: 89 50 4E 47 0D 0A 1A 0A
 * - JPEG: FF D8 FF (SOI; the 4th byte varies across JFIF/Exif/raw)
 */
const PNG_SIGNATURE: ReadonlyArray<number> = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];
const JPEG_SIGNATURE: ReadonlyArray<number> = [0xff, 0xd8, 0xff];

function startsWithBytes(
  bytes: Buffer,
  signature: ReadonlyArray<number>,
): boolean {
  if (bytes.byteLength < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

function bytesMatchDeclaredMime(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png") return startsWithBytes(bytes, PNG_SIGNATURE);
  if (mime === "image/jpeg") return startsWithBytes(bytes, JPEG_SIGNATURE);
  return false;
}

export async function fetchPageBytes(
  submission: OcrSubmission,
  deps: FetcherDeps,
): Promise<FetchedPage> {
  // §4 — defense in depth against bypass of the ingestion validator.
  if (submission.pages.length !== 1) {
    throw new FetcherError(
      `multi-page submissions are not supported in v1 (received ${submission.pages.length} pages)`,
      { code: FETCHER_ERROR_CODES.MULTI_PAGE_UNSUPPORTED },
    );
  }

  // §7 — fail closed on misconfigured root. Validate BEFORE the
  // `resolve` normalization so an empty / non-string / relative root
  // is surfaced with the actionable code, not silently turned into a
  // CWD-rooted path.
  if (
    typeof deps.allowedFileRoot !== "string" ||
    deps.allowedFileRoot.length === 0 ||
    !isAbsolute(deps.allowedFileRoot)
  ) {
    throw new FetcherError(
      `FetcherDeps.allowedFileRoot must be a non-empty absolute path (got ${JSON.stringify(deps.allowedFileRoot)})`,
      { code: FETCHER_ERROR_CODES.FILE_ROOT_UNCONFIGURED },
    );
  }

  // Normalize the root ONCE up front (audit 019e3a07 D3). A valid
  // absolute path containing `..` or `.` segments (e.g.
  // `/tmp/root/../root`) must be collapsed to its canonical form
  // before containment checks, otherwise the prefix test against
  // `resolve(root, candidate)` would falsely reject every legitimate
  // in-root candidate.
  const allowedRoot = resolve(deps.allowedFileRoot);

  const source = submission.pages[0]!.source;

  // §1 — source-kind admission. Cheaper than I/O.
  if (source.kind !== "file") {
    throw new FetcherError(
      `source kind ${JSON.stringify(source.kind)} is not supported in v1 (only "file" is admitted; see ADR-11C.2 §1)`,
      { code: FETCHER_ERROR_CODES.SOURCE_KIND_UNSUPPORTED },
    );
  }

  // §6 — declared-MIME allowlist runs before any I/O. The post-read
  // signature sniff below catches mislabeling.
  if (!ALLOWED_MIME_TYPES.has(source.mime_type)) {
    throw new FetcherError(
      `mime_type ${JSON.stringify(source.mime_type)} is not in the v1 allowlist (${[...ALLOWED_MIME_TYPES].join(", ")})`,
      { code: FETCHER_ERROR_CODES.MIME_UNSUPPORTED },
    );
  }

  // §5 — Layer A lexical containment.
  const lexicalResolved = assertLexicallyContained(
    allowedRoot,
    source.path,
    "source.path",
  );

  // §5 — Layer B real-path containment. Follows symlinks and rejects
  // escapes via the canonical-root prefix test.
  const realPath = assertRealContained(
    allowedRoot,
    lexicalResolved,
    "source.path",
  );

  // §6 — fd-based open/fstat/read so the size + regular-file checks
  // and the byte read all operate on the same inode (audit 019e3a07
  // D2 High). `open` itself fails with ENOENT if the file was unlinked
  // between realpath and open; in that case we surface file_not_found.
  let fh;
  try {
    fh = await open(realPath, "r");
  } catch (err) {
    const errno = (err as NodeJS.ErrnoException).code;
    if (errno === "ENOENT") {
      throw new FetcherError(
        `source.path ${JSON.stringify(realPath)} disappeared between realpath and open`,
        { code: FETCHER_ERROR_CODES.FILE_NOT_FOUND },
      );
    }
    throw new FetcherError(
      `failed to open ${JSON.stringify(realPath)}: ${(err as Error).message}`,
      { code: FETCHER_ERROR_CODES.FILE_NOT_FOUND },
    );
  }

  try {
    const st = await fh.stat();

    // Regular-file gate — directories, FIFOs, sockets, devices all
    // reject. POSIX allows opening a directory for reading; fstat
    // tells the truth.
    if (!st.isFile()) {
      throw new FetcherError(
        `source.path ${JSON.stringify(realPath)} is not a regular file`,
        { code: FETCHER_ERROR_CODES.FILE_NOT_REGULAR },
      );
    }

    // §6 — size_mismatch BEFORE size_cap_exceeded so the more
    // specific signal wins when both could fire.
    if (st.size !== source.byte_size) {
      throw new FetcherError(
        `source.path file size ${st.size} bytes disagrees with submission's source.byte_size ${source.byte_size}`,
        { code: FETCHER_ERROR_CODES.SIZE_MISMATCH },
      );
    }
    if (st.size > MAX_PAGE_BYTES) {
      throw new FetcherError(
        `source.path file size ${st.size} bytes exceeds the ${MAX_PAGE_BYTES} byte per-page cap`,
        { code: FETCHER_ERROR_CODES.SIZE_CAP_EXCEEDED },
      );
    }

    // Read from the same fd. `readFile` on FileHandle reads from the
    // current offset (start of file for a freshly opened "r" fd).
    const bytes = await fh.readFile();

    // Sanity: the fd held the inode; the read length MUST match the
    // fstat'd size. A mismatch indicates a same-inode in-place
    // rewrite, which is out of v1 threat model (worker-owned root).
    if (bytes.byteLength !== st.size) {
      throw new FetcherError(
        `read returned ${bytes.byteLength} bytes but fstat reported ${st.size}; same-inode rewrite race`,
        { code: FETCHER_ERROR_CODES.SIZE_MISMATCH },
      );
    }

    // Magic-byte signature check — closes the "PDF labeled as PNG"
    // gap (audit 019e3a07 D2 Medium).
    if (!bytesMatchDeclaredMime(bytes, source.mime_type)) {
      throw new FetcherError(
        `fetched bytes do not carry a valid ${source.mime_type} signature (declared MIME does not match content)`,
        { code: FETCHER_ERROR_CODES.MIME_SIGNATURE_MISMATCH },
      );
    }

    return {
      bytes,
      mimeType: source.mime_type,
      sizeBytes: bytes.byteLength,
    };
  } finally {
    await fh.close();
  }
}
