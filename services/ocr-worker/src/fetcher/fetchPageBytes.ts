// Page fetcher: turn an OcrSubmission's source field into bytes for
// the engine. See ADR-11C.2 (file path) + ADR-11D.1 (inline path).
//
// v1 admission set: `kind: "file"` (ADR-11C.2) + `kind: "inline"`
// (ADR-11D.1). `s3` and `https` continue to reject at the boundary
// with stable code `source_kind_unsupported`; ADR-11C.2 §1 explains
// why kind admission lives in the fetcher rather than the ingestion
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

import { createHash } from "node:crypto";
import { lookup as dnsLookupCallback } from "node:dns";
import { promisify } from "node:util";
import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { OcrSubmission } from "ocr-worker-contract";

import {
  FetcherError,
  FETCHER_ERROR_CODES,
  type DnsAddress,
  type DnsLookupFn,
  type FetchedPage,
  type FetcherDeps,
  type HttpsTransport,
} from "./types.js";
import {
  assertLexicallyContained,
  assertRealContained,
} from "./pathContainment.js";
import { isPrivateIp } from "./privateIp.js";
import { makeNodeFetchHttpsTransport } from "./httpsTransport.js";
import { isHttpsTransportError } from "./httpsTransportErrors.js";

const dnsLookupAllRaw = promisify(dnsLookupCallback);
const defaultDnsLookup: DnsLookupFn = async (hostname) => {
  const res = await dnsLookupAllRaw(hostname, { all: true });
  return res as ReadonlyArray<DnsAddress>;
};

/**
 * Maximum bytes per page. Pinned by ADR-11C.2 §6.
 *
 * 50 MB covers a 600-DPI A4 PNG with comfortable headroom; 300-DPI
 * scans land at ~5–10 MB. Hard cap — operators raise this only by
 * amending the ADR. Cap is inclusive (a 50 MB exact file passes).
 */
const MAX_PAGE_BYTES = 50 * 1024 * 1024;

/**
 * Maximum bytes for an INLINE submission. Mirrors the schema's
 * `inline.byte_size.maximum` (1 MB) so an envelope-bypass attempt
 * still fails at the fetcher. Audit 019e3ad6 D5 Medium fix: the
 * fetcher's 50 MB cap is the file-path bound; without an inline-
 * specific cap, a schema-bypassed inline payload up to 50 MB would
 * be accepted, widening the effective contract.
 */
const MAX_INLINE_BYTES = 1 * 1024 * 1024;

/**
 * Overall fetch timeout for `https` sources. The AbortController
 * fires after this duration regardless of which phase (connect /
 * headers / body) is in progress. Pinned by ADR-11D.2 §6.
 */
const HTTPS_FETCH_TIMEOUT_MS = 30_000;

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

  // ADR-11D.1 §1 — dispatch on source.kind. Each branch performs its
  // own MIME allowlist + magic-byte sniff + size-mismatch + size-cap
  // checks; what differs is how the bytes are produced (file I/O for
  // `file`, base64 decode for `inline`).
  const source = submission.pages[0]!.source;
  switch (source.kind) {
    case "file":
      return fetchFromFile(source, deps);
    case "inline":
      return fetchFromInline(source);
    case "https":
      return fetchFromHttps(source, deps);
    default:
      throw new FetcherError(
        `source kind ${JSON.stringify((source as { kind: string }).kind)} is not supported in v1 ` +
          `(admitted: "file", "inline", "https"; see ADR-11C.2 §1 + ADR-11D.1 §1 + ADR-11D.2 §1)`,
        { code: FETCHER_ERROR_CODES.SOURCE_KIND_UNSUPPORTED },
      );
  }
}

// ---------------------------------------------------------------------
// file:// path — ADR-11C.2
// ---------------------------------------------------------------------

async function fetchFromFile(
  source: Extract<OcrSubmission["pages"][number]["source"], { kind: "file" }>,
  deps: FetcherDeps,
): Promise<FetchedPage> {
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

// ---------------------------------------------------------------------
// inline path — ADR-11D.1
// ---------------------------------------------------------------------

/**
 * Decode base64 + run the same MIME / size / signature gates as the
 * file path. Pure (no I/O beyond CPU-bound decode). The schema's
 * envelope validator has already constrained
 * `source.base64` to `[A-Za-z0-9+/=\n\r]+` and `source.byte_size` to
 * `[1, 1048576]` (1 MB); the checks below are defense-in-depth in
 * case the envelope validator is bypassed.
 */
async function fetchFromInline(
  source: Extract<OcrSubmission["pages"][number]["source"], { kind: "inline" }>,
): Promise<FetchedPage> {
  // The submission schema lists `mime_type` as optional on inline
  // (only `kind`, `base64`, `byte_size` are required), but the
  // fetcher requires it: without a declared MIME the allowlist +
  // signature-sniff gates can't run. Schema narrowing would be a
  // breaking contract change; rejecting at the fetcher boundary
  // surfaces the same actionable error without rewiring the contract.
  const declaredMime = source.mime_type;
  if (typeof declaredMime !== "string" || declaredMime.length === 0) {
    throw new FetcherError(
      `inline source.mime_type is required for v1 (schema lists it as optional but the fetcher needs a declared MIME)`,
      { code: FETCHER_ERROR_CODES.MIME_UNSUPPORTED },
    );
  }

  // MIME allowlist before decode — cheap, and rules out the
  // "decode 1 MB just to reject as PDF" wasted work.
  if (!ALLOWED_MIME_TYPES.has(declaredMime)) {
    throw new FetcherError(
      `mime_type ${JSON.stringify(declaredMime)} is not in the v1 allowlist (${[...ALLOWED_MIME_TYPES].join(", ")})`,
      { code: FETCHER_ERROR_CODES.MIME_UNSUPPORTED },
    );
  }

  // Honest base64 caveat (audit 019e3ad6 D1 Medium): Node's
  // `Buffer.from(s, "base64")` is permissive — it accepts
  // non-canonical inputs (extra padding, mixed whitespace, lowercase
  // padding) and silently filters invalid characters. The schema's
  // `base64` pattern enforces only the character ALPHABET at the
  // envelope layer; it does NOT enforce canonical encoding (correct
  // padding count, output length matches `4 * ceil(N / 3)`).
  //
  // So the actual gate here is the size-mismatch check below: a
  // schema-bypassed caller can send malformed-but-decodable base64
  // (e.g., dropped a char or two), but if the decoded length doesn't
  // match the declared `byte_size`, we reject. If they ALSO lie
  // about `byte_size` consistently, the signature sniff catches
  // bytes that don't look like the declared MIME. Defense-in-depth
  // is the pattern; strict base64 canonicality is NOT enforced.
  const bytes = Buffer.from(source.base64, "base64");

  // Pre-check decoded size against the inline cap BEFORE doing other
  // work on it. This is the schema-mirror defense (audit 019e3ad6 D5
  // Medium): without this, a schema-bypassed inline up to 50 MB would
  // pass through.
  if (bytes.byteLength > MAX_INLINE_BYTES) {
    throw new FetcherError(
      `inline decoded length ${bytes.byteLength} bytes exceeds the ${MAX_INLINE_BYTES} byte inline cap (schema's inline.byte_size.maximum)`,
      { code: FETCHER_ERROR_CODES.SIZE_CAP_EXCEEDED },
    );
  }

  // Declared byte_size must match decoded length. Contract pin: the
  // caller asserted how many bytes they sent; if the decoded length
  // disagrees, the submission is corrupt (or the base64 is malformed
  // per the honest-caveat note above).
  if (bytes.byteLength !== source.byte_size) {
    throw new FetcherError(
      `inline decoded length ${bytes.byteLength} bytes disagrees with submission's source.byte_size ${source.byte_size} ` +
        `(check that source.base64 is well-formed canonical base64)`,
      { code: FETCHER_ERROR_CODES.SIZE_MISMATCH },
    );
  }

  // Wide-bound size cap (50 MB) — defense-in-depth in case the
  // narrower inline cap above ever loosens.
  if (bytes.byteLength > MAX_PAGE_BYTES) {
    throw new FetcherError(
      `inline decoded length ${bytes.byteLength} bytes exceeds the ${MAX_PAGE_BYTES} byte per-page cap`,
      { code: FETCHER_ERROR_CODES.SIZE_CAP_EXCEEDED },
    );
  }

  // Magic-byte signature sniff — same as file path. PDF mislabeled as
  // image/png in the inline base64 gets caught here.
  if (!bytesMatchDeclaredMime(bytes, declaredMime)) {
    throw new FetcherError(
      `inline bytes do not carry a valid ${declaredMime} signature (declared MIME does not match content)`,
      { code: FETCHER_ERROR_CODES.MIME_SIGNATURE_MISMATCH },
    );
  }

  return {
    bytes,
    mimeType: declaredMime,
    sizeBytes: bytes.byteLength,
  };
}

// ---------------------------------------------------------------------
// https path — ADR-11D.2
// ---------------------------------------------------------------------

async function fetchFromHttps(
  source: Extract<OcrSubmission["pages"][number]["source"], { kind: "https" }>,
  deps: FetcherDeps,
): Promise<FetchedPage> {
  // --- Pre-network gates (cheap; fail before opening any deadline)

  // Parse the URL — malformed → url_malformed (audit 019e3af0 D1
  // Medium: distinct from https_network_error so a future retry
  // classifier doesn't treat malformed input as transient).
  let url: URL;
  try {
    url = new URL(source.url);
  } catch (err) {
    throw new FetcherError(
      `source.url is not a parseable URL: ${(err as Error).message}`,
      { code: FETCHER_ERROR_CODES.URL_MALFORMED },
    );
  }

  // HTTPS-only. Schema's pattern already enforces this; defense-in-depth.
  if (url.protocol !== "https:") {
    throw new FetcherError(
      `source.url scheme ${JSON.stringify(url.protocol)} is not supported (https: only)`,
      { code: FETCHER_ERROR_CODES.HTTP_SCHEME_UNSUPPORTED },
    );
  }

  // url_expires_at if present. Caller opts in.
  const clock = deps.now ?? (() => new Date());
  if (source.url_expires_at !== undefined) {
    const expiresAt = new Date(source.url_expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new FetcherError(
        `source.url_expires_at is not a valid date: ${JSON.stringify(source.url_expires_at)}`,
        { code: FETCHER_ERROR_CODES.URL_EXPIRED },
      );
    }
    if (expiresAt.getTime() <= clock().getTime()) {
      throw new FetcherError(
        `source.url_expires_at is in the past`,
        { code: FETCHER_ERROR_CODES.URL_EXPIRED },
      );
    }
  }

  // Host allowlist (match on hostname; no port). Fail-closed.
  const host = url.hostname.toLowerCase();
  const allowlist = deps.allowedHttpsHosts;
  if (allowlist === undefined || allowlist.size === 0 || !allowlist.has(host)) {
    throw new FetcherError(
      `source.url host ${JSON.stringify(host)} is not in the configured allowlist`,
      { code: FETCHER_ERROR_CODES.HOST_NOT_ALLOWLISTED },
    );
  }

  // Declared MIME allowlist. Schema lists mime_type optional on
  // https; fetcher requires it (same as inline).
  const declaredMime = source.mime_type;
  if (typeof declaredMime !== "string" || declaredMime.length === 0) {
    throw new FetcherError(
      `https source.mime_type is required for v1 (schema lists it as optional but the fetcher needs a declared MIME)`,
      { code: FETCHER_ERROR_CODES.MIME_UNSUPPORTED },
    );
  }
  if (!ALLOWED_MIME_TYPES.has(declaredMime)) {
    throw new FetcherError(
      `mime_type ${JSON.stringify(declaredMime)} is not in the v1 allowlist (${[...ALLOWED_MIME_TYPES].join(", ")})`,
      { code: FETCHER_ERROR_CODES.MIME_UNSUPPORTED },
    );
  }

  // byte_size required pre-network (audit 019e3af0 D3 Medium fix:
  // schema lists it optional on https, but the fetcher needs it for
  // size_mismatch + size_cap checks). Reject before DNS work.
  if (typeof source.byte_size !== "number" || !Number.isInteger(source.byte_size) || source.byte_size <= 0) {
    throw new FetcherError(
      `https source.byte_size is required for v1 (positive integer; schema lists it optional but the fetcher needs it)`,
      { code: FETCHER_ERROR_CODES.SIZE_MISMATCH },
    );
  }

  // expected_sha256 shape pre-check (audit 019e3af0 D3 Medium fix:
  // schema admits 32–128 hex chars but fetcher only computes
  // SHA-256 = 64 hex; reject any other length explicitly with the
  // hash-mismatch code, since that's what would surface anyway
  // after the fetch).
  if (source.expected_sha256 !== undefined) {
    if (
      typeof source.expected_sha256 !== "string" ||
      source.expected_sha256.length !== 64 ||
      !/^[0-9a-f]{64}$/.test(source.expected_sha256.toLowerCase())
    ) {
      throw new FetcherError(
        `source.expected_sha256 must be exactly 64 lowercase hex chars (SHA-256); v1 does not support other digest sizes`,
        { code: FETCHER_ERROR_CODES.CONTENT_HASH_MISMATCH },
      );
    }
  }

  // --- Single deadline across DNS + headers + body (audit 019e3af0
  // D3 High fix: previous code cleared the timer before body
  // streaming began; a slow-drip body would have run indefinitely).
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
  const controller = new AbortController();
  const deadlineTimer = setTimeout(
    () => controller.abort(),
    HTTPS_FETCH_TIMEOUT_MS,
  );
  // Helper: any error after the deadline fires becomes https_timeout.
  const wrapTimeoutError = (err: unknown): FetcherError => {
    if (err instanceof FetcherError) return err;
    // WI-03b mapping branch: an internal `HttpsTransportError` from
    // transport-entry runtime address validation maps to the existing
    // public `https_network_error` code, preserving the internal error
    // as `cause` so the mapping test can assert
    // `err.cause instanceof HttpsTransportError` AND
    // `err.cause.code === <expected internal code>`. This branch must
    // run BEFORE the generic abort/network catch-all below — otherwise
    // the network-error branch would swallow validation failures
    // without preserving the discriminator chain.
    if (isHttpsTransportError(err)) {
      return new FetcherError(
        `https transport input validation failed: ${err.message}`,
        { code: FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR, cause: err },
      );
    }
    if (
      controller.signal.aborted ||
      (err as { name?: string }).name === "AbortError"
    ) {
      return new FetcherError(
        `https fetch exceeded the ${HTTPS_FETCH_TIMEOUT_MS}ms deadline`,
        { code: FETCHER_ERROR_CODES.HTTPS_TIMEOUT },
      );
    }
    return new FetcherError(
      `https fetch failed: ${(err as Error).message}`,
      { code: FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR },
    );
  };

  try {
    // DNS lookup ALL addresses; every one must pass the
    // non-globally-routable block.
    let addresses: ReadonlyArray<DnsAddress>;
    try {
      addresses = await dnsLookup(url.hostname);
    } catch (err) {
      throw wrapTimeoutError(err);
    }
    if (addresses.length === 0) {
      throw new FetcherError(
        `DNS lookup for ${JSON.stringify(url.hostname)} returned no addresses`,
        { code: FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR },
      );
    }
    for (const a of addresses) {
      if (isPrivateIp(a.address)) {
        throw new FetcherError(
          `host ${JSON.stringify(url.hostname)} resolves to a non-globally-routable address (${a.address})`,
          { code: FETCHER_ERROR_CODES.HOST_RESOLVES_TO_PRIVATE_IP },
        );
      }
    }

    // Transport call. WI-02 seam: the fetcher hands the COMPLETE
    // vetted DNS answer set to the transport in resolver order. The
    // fetcher does NOT subset or reorder (ADR §1 / §4). The
    // production transport (WI-03) will pin the socket to
    // allowedAddresses[0]; the current default transport ignores
    // the field — see makeNodeFetchHttpsTransport for the deferred
    // SSRF residual.
    const transport: HttpsTransport =
      deps.httpsTransport ?? makeNodeFetchHttpsTransport();
    let response;
    try {
      response = await transport.fetch(url, {
        signal: controller.signal,
        allowedAddresses: addresses,
      });
    } catch (err) {
      throw wrapTimeoutError(err);
    }

    // Status check. Per ADR-11E §2 + audit 019e3b1f D1 fix: the
    // code matches the actual status family so downstream
    // analytics + future code-keyed retry policies see truthful
    // data. 4xx is the 400-499 range only; other non-standard
    // non-200 codes map to HTTPS_STATUS_UNEXPECTED.
    if (response.status >= 300 && response.status < 400) {
      throw new FetcherError(
        `response status ${response.status} is a redirect; v1 does not follow redirects`,
        { code: FETCHER_ERROR_CODES.REDIRECT_UNSUPPORTED },
      );
    }
    if (response.status >= 400 && response.status < 500) {
      throw new FetcherError(
        `response status ${response.status} is a 4xx client error`,
        { code: FETCHER_ERROR_CODES.HTTPS_CLIENT_ERROR_4XX },
      );
    }
    if (response.status >= 500 && response.status < 600) {
      throw new FetcherError(
        `response status ${response.status} is a 5xx server error`,
        { code: FETCHER_ERROR_CODES.HTTPS_SERVER_ERROR_5XX },
      );
    }
    if (response.status !== 200) {
      // 1xx informational, 2xx-non-200 (204 No Content, 206 Partial
      // Content), 6xx+ non-standard. Mismatched bucket, but the
      // code now honestly reflects "we got something that isn't a
      // recognized status family for this endpoint".
      throw new FetcherError(
        `response status ${response.status} is an unexpected non-200 status (outside 3xx/4xx/5xx ranges)`,
        { code: FETCHER_ERROR_CODES.HTTPS_STATUS_UNEXPECTED },
      );
    }

    // Early Content-Length cap.
    const cl = response.headers.get("content-length");
    if (cl !== null) {
      const declared = Number.parseInt(cl, 10);
      if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) {
        throw new FetcherError(
          `response Content-Length ${declared} bytes exceeds the ${MAX_PAGE_BYTES} byte per-page cap`,
          { code: FETCHER_ERROR_CODES.SIZE_CAP_EXCEEDED },
        );
      }
    }

    // Stream body under the same deadline. A stalled body now
    // aborts via the same controller (audit 019e3af0 D3 High fix).
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > MAX_PAGE_BYTES) {
          throw new FetcherError(
            `response body exceeded the ${MAX_PAGE_BYTES} byte per-page cap mid-stream`,
            { code: FETCHER_ERROR_CODES.SIZE_CAP_EXCEEDED },
          );
        }
        chunks.push(chunk);
      }
    } catch (err) {
      throw wrapTimeoutError(err);
    }
    const bytes = Buffer.concat(chunks, total);

    // size_mismatch vs declared byte_size.
    if (bytes.byteLength !== source.byte_size) {
      throw new FetcherError(
        `fetched length ${bytes.byteLength} bytes disagrees with submission's source.byte_size ${source.byte_size}`,
        { code: FETCHER_ERROR_CODES.SIZE_MISMATCH },
      );
    }

    // expected_sha256 verification when present. The 64-hex shape
    // was validated pre-network above; here we just compare.
    if (source.expected_sha256 !== undefined) {
      const actual = createHash("sha256").update(bytes).digest("hex");
      const expected = source.expected_sha256.toLowerCase();
      if (actual !== expected) {
        throw new FetcherError(
          `fetched bytes' SHA-256 does not match source.expected_sha256`,
          { code: FETCHER_ERROR_CODES.CONTENT_HASH_MISMATCH },
        );
      }
    }

    // MIME signature sniff.
    if (!bytesMatchDeclaredMime(bytes, declaredMime)) {
      throw new FetcherError(
        `fetched bytes do not carry a valid ${declaredMime} signature (declared MIME does not match content)`,
        { code: FETCHER_ERROR_CODES.MIME_SIGNATURE_MISMATCH },
      );
    }

    return {
      bytes,
      mimeType: declaredMime,
      sizeBytes: bytes.byteLength,
    };
  } finally {
    // Only clear the deadline AFTER body iteration completes (or
    // throws). This is the audit 019e3af0 D3 High fix — previous
    // code cleared in a finally that ran before body streaming.
    clearTimeout(deadlineTimer);
  }
}
