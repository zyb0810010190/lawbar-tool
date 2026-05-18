// Public types for the page fetcher. See ADR-11C.2.

/**
 * Stable, contract-relevant error codes the fetcher raises. Callers
 * (worker bin in 11C.3, the coordinator on failure-mapping) branch on
 * these without parsing the human message. Codes are part of the
 * fetcher's public surface and MUST NOT be renamed or removed without
 * a coordinated change. Runtime-frozen (`Object.freeze`) so the
 * registry cannot be mutated by a misbehaving consumer.
 */
export const FETCHER_ERROR_CODES = Object.freeze({
  /** Submission's source.kind is not admitted by the v1 fetcher. */
  SOURCE_KIND_UNSUPPORTED: "source_kind_unsupported",
  /** Defense-in-depth: ingestion already rejects N>1; fetcher does too. */
  MULTI_PAGE_UNSUPPORTED: "multi_page_unsupported",
  /** deps.allowedFileRoot missing or not an absolute path. */
  FILE_ROOT_UNCONFIGURED: "file_root_unconfigured",
  /** Path escapes the allowed root lexically or via symlink. */
  PATH_ESCAPE: "path_escape",
  /** stat() couldn't see the file at the resolved path. */
  FILE_NOT_FOUND: "file_not_found",
  /** Not a regular file (directory, fifo, socket, device, symlink-to-nonfile). */
  FILE_NOT_REGULAR: "file_not_regular",
  /** Actual file size disagrees with submission's source.byte_size. */
  SIZE_MISMATCH: "size_mismatch",
  /** Actual file size exceeds the 50 MB per-page cap. */
  SIZE_CAP_EXCEEDED: "size_cap_exceeded",
  /** Submission's source.mime_type is not in the v1 allowlist. */
  MIME_UNSUPPORTED: "mime_unsupported",
  /**
   * Fetched bytes do not carry the magic-byte signature for the MIME
   * type the submission declared. Post-read sniff catches a PDF or
   * arbitrary content mislabeled as image/png or image/jpeg (audit
   * 019e3a07 D2 Medium — anti-PDF boundary must be byte-level, not
   * declaration-only).
   */
  MIME_SIGNATURE_MISMATCH: "mime_signature_mismatch",
} as const);

export type FetcherErrorCode =
  (typeof FETCHER_ERROR_CODES)[keyof typeof FETCHER_ERROR_CODES];

/**
 * Fetcher-layer error.
 *
 * Always carries a stable `code` (unlike `IngestionError`, where the
 * code is optional for backward-compat). Class identity is part of
 * the public contract; do NOT redeclare in another module — re-export
 * by value if you need it elsewhere.
 *
 * Cross-realm caveat: `structuredClone(err)` drops the subclass
 * identity (clone becomes plain `Error`) and the `code` own-property.
 * Same-realm rethrow preserves both. JSON.stringify preserves `code`.
 * For cross-boundary transport, serialize to a plain object with
 * explicit `{ name, message, code }` rather than cloning the Error.
 */
export class FetcherError extends Error {
  readonly code: FetcherErrorCode;

  constructor(message: string, options: { code: FetcherErrorCode }) {
    super(message);
    this.name = "FetcherError";
    this.code = options.code;
  }
}

export interface FetcherDeps {
  /**
   * Absolute path under which every `file://` source path must resolve.
   * Read once at bin startup from `OCR_FETCHER_FILE_ROOT` (deferred to
   * ADR-11C.3). The fetcher itself does NOT read `process.env` —
   * keeping that side-effect on the bin seam preserves testability.
   */
  readonly allowedFileRoot: string;
}

export interface FetchedPage {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
