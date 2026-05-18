// Page fetcher: turn an OcrSubmission's source field into bytes for
// the engine. See ADR-11C.2 for every gate pinned here.
//
// v1 supports `kind: "file"` only. s3 / https / inline are rejected at
// the boundary with stable code `source_kind_unsupported`. ADR-11C.2 §1
// explains why this lives in the fetcher rather than the ingestion
// validator (vocabulary stays open; admission policy is engine-local).

import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { OcrSubmission } from "ocr-worker-contract";

import {
  FetcherError,
  FETCHER_ERROR_CODES,
  type FetchedPage,
  type FetcherDeps,
} from "./types.js";
import {
  assertLexicallyContained,
  assertRealContainedRegularFile,
} from "./pathContainment.js";

/**
 * Maximum bytes per page. Pinned by ADR-11C.2 §6.
 *
 * 50 MB covers a 600-DPI A4 PNG with comfortable headroom; 300-DPI
 * scans land at ~5–10 MB. Hard cap — operators raise this only by
 * amending the ADR.
 */
const MAX_PAGE_BYTES = 50 * 1024 * 1024;

/**
 * MIME allowlist for v1. Pinned by ADR-11C.2 §6 + ADR-11A.0 §8
 * (anti-PDF). The submission's `mime_type` is authoritative — no
 * byte-signature sniffing. If a caller lies about MIME, the engine
 * will reject the bytes downstream.
 */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
]);

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

  // §7 — fail closed on misconfigured root, before any source-kind
  // dispatch so the operator gets the most actionable error.
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

  const source = submission.pages[0]!.source;

  // §1 — source-kind admission. The match arm pattern is exhaustive
  // over the current submission schema (s3 | https | inline | file).
  // If a future schema patch adds a new kind, TypeScript narrowing
  // will force this switch to handle it (the default arm catches
  // anything not in the union at runtime too).
  if (source.kind !== "file") {
    throw new FetcherError(
      `source kind ${JSON.stringify(source.kind)} is not supported in v1 (only "file" is admitted; see ADR-11C.2 §1)`,
      { code: FETCHER_ERROR_CODES.SOURCE_KIND_UNSUPPORTED },
    );
  }

  // §6 — MIME allowlist runs BEFORE any I/O.
  if (!ALLOWED_MIME_TYPES.has(source.mime_type)) {
    throw new FetcherError(
      `mime_type ${JSON.stringify(source.mime_type)} is not in the v1 allowlist (${[...ALLOWED_MIME_TYPES].join(", ")})`,
      { code: FETCHER_ERROR_CODES.MIME_UNSUPPORTED },
    );
  }

  // §5 — Layer A lexical containment.
  const lexicalResolved = assertLexicallyContained(
    deps.allowedFileRoot,
    source.path,
    "source.path",
  );

  // §5 — Layer B real-path + regular-file check. Returns the stat
  // result so we don't double-stat for the size checks below.
  const { realPath, stat } = assertRealContainedRegularFile(
    deps.allowedFileRoot,
    lexicalResolved,
    "source.path",
  );

  // §6 — size_mismatch BEFORE size_cap_exceeded so the operator sees
  // the more specific signal first when both could fire (a lying
  // submission claiming 1 byte for a 100 MB file would otherwise
  // surface as a size_cap rather than the underlying mismatch).
  if (stat.size !== source.byte_size) {
    throw new FetcherError(
      `source.path file size ${stat.size} bytes disagrees with submission's source.byte_size ${source.byte_size}`,
      { code: FETCHER_ERROR_CODES.SIZE_MISMATCH },
    );
  }
  if (stat.size > MAX_PAGE_BYTES) {
    throw new FetcherError(
      `source.path file size ${stat.size} bytes exceeds the ${MAX_PAGE_BYTES} byte per-page cap`,
      { code: FETCHER_ERROR_CODES.SIZE_CAP_EXCEEDED },
    );
  }

  // §6 — TOCTOU caveat documented in the ADR. v1 trusts the file root
  // is owned by the worker process; a malicious replace between stat
  // and readFile is out of v1 threat model.
  const bytes = await readFile(realPath);

  // Defensive: in the unlikely case the file shrunk/grew between stat
  // and read (TOCTOU), still enforce the cap on the actual bytes.
  if (bytes.byteLength > MAX_PAGE_BYTES) {
    throw new FetcherError(
      `source.path read returned ${bytes.byteLength} bytes, exceeding the ${MAX_PAGE_BYTES} byte cap (TOCTOU race on file root)`,
      { code: FETCHER_ERROR_CODES.SIZE_CAP_EXCEEDED },
    );
  }

  return {
    bytes,
    mimeType: source.mime_type,
    sizeBytes: bytes.byteLength,
  };
}
