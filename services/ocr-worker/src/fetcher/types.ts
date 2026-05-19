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
  // --- ADR-11D.2 https source codes ---------------------------------
  /**
   * source.url could not be parsed as a URL (audit 019e3af0 D1 Medium
   * fix: distinct from https_network_error so a retry classifier
   * doesn't treat malformed input as a transient network blip).
   */
  URL_MALFORMED: "url_malformed",
  /** url.protocol is not "https:" (schema-bypass defense). */
  HTTP_SCHEME_UNSUPPORTED: "http_scheme_unsupported",
  /** source.url_expires_at is in the past per deps.now(). */
  URL_EXPIRED: "url_expired",
  /** url.host (lower-cased) not in deps.allowedHttpsHosts. */
  HOST_NOT_ALLOWLISTED: "host_not_allowlisted",
  /** DNS resolved the host to a private / loopback / link-local IP. */
  HOST_RESOLVES_TO_PRIVATE_IP: "host_resolves_to_private_ip",
  /** Response was 3xx; v1 does not follow redirects. */
  REDIRECT_UNSUPPORTED: "redirect_unsupported",
  /**
   * Response status was 4xx (404, 401, 403, etc.). Classified as
   * PERMANENT per ADR-11E §1: caller-side errors don't change on
   * retry. Audit 019e3b1f D1 Medium fix: this code is now strictly
   * the 400-499 range only; other non-200/non-3xx codes map to
   * `HTTPS_STATUS_UNEXPECTED` so the code matches reality.
   */
  HTTPS_CLIENT_ERROR_4XX: "https_client_error_4xx",
  /**
   * Response status was 5xx. Classified as TRANSIENT per ADR-11E
   * §1: server hiccups often resolve on retry.
   */
  HTTPS_SERVER_ERROR_5XX: "https_server_error_5xx",
  /**
   * Response status was non-200 and outside the standard 3xx/4xx/5xx
   * families — covers 1xx informational (shouldn't reach a fetch
   * client), 2xx-non-200 (204 No Content, 206 Partial Content),
   * and any 6xx+ that some servers emit. Classified as PERMANENT
   * (caller-side / unsupported behavior; retry doesn't help).
   * Added by audit 019e3b1f D1 Medium fix so the persisted code
   * matches what actually happened.
   */
  HTTPS_STATUS_UNEXPECTED: "https_status_unexpected",
  /** Fetch timed out (AbortController fired). */
  HTTPS_TIMEOUT: "https_timeout",
  /** Generic network error (connection refused, DNS failure, etc). */
  HTTPS_NETWORK_ERROR: "https_network_error",
  /** Fetched bytes' SHA-256 disagrees with source.expected_sha256. */
  CONTENT_HASH_MISMATCH: "content_hash_mismatch",
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
   * Read once at bin startup from `OCR_FETCHER_FILE_ROOT`. The fetcher
   * itself does NOT read `process.env` — keeping that side-effect on
   * the bin seam preserves testability.
   *
   * Optional in the type to allow inline- or https-only deployments,
   * but the file path's own validation throws `file_root_unconfigured`
   * if reached without a non-empty absolute path.
   */
  readonly allowedFileRoot: string;
  /**
   * Set of exact-match host strings the fetcher will resolve for
   * `kind: "https"` submissions. Lower-cased on parse. Empty/missing
   * → every https fetch throws `host_not_allowlisted` (fail-closed).
   * Read at bin startup from `OCR_FETCHER_HTTPS_HOSTS` (ADR-11D.2 §1).
   */
  readonly allowedHttpsHosts?: ReadonlySet<string>;
  /**
   * Transport seam for https fetches. Production uses Node's
   * built-in fetch wrapped in `makeNodeFetchHttpsTransport()`; tests
   * inject a stub that returns canned `HttpsTransportResponse`s.
   * Default is constructed lazily by the fetcher when missing.
   */
  readonly httpsTransport?: HttpsTransport;
  /**
   * Clock for `url_expires_at` comparisons. Defaults to
   * `() => new Date()`. Tests inject a fixed clock to pin
   * expiry-edge behavior.
   */
  readonly now?: () => Date;
  /**
   * DNS lookup seam. Returns all resolved addresses for a hostname.
   * Production defaults to `dns.promises.lookup(host, { all: true })`;
   * tests inject deterministic results (audit 019e3af0 D7 Medium fix:
   * makes mixed v4/v6 + DNS-failure + private-IP cases testable
   * without depending on the system resolver).
   */
  readonly dnsLookup?: DnsLookupFn;
}

export interface DnsAddress {
  readonly address: string;
  /**
   * Address family discriminator. Narrowed to `4 | 6` at the seam
   * (WI-02) so transport implementations cannot accidentally accept
   * `family: 0`, `family: 10`, or any other Node-specific extension
   * value at compile time. Runtime validation of values arriving
   * from a real resolver is the production transport's responsibility
   * (WI-03 / ADR §5).
   */
  readonly family: 4 | 6;
}

export type DnsLookupFn = (hostname: string) => Promise<ReadonlyArray<DnsAddress>>;

// ---------------------------------------------------------------------
// https transport (ADR-11D.2)
// ---------------------------------------------------------------------

export interface HttpsTransport {
  /**
   * Issue a single HTTPS request.
   *
   * `init.allowedAddresses` carries the post-DNS, post-private-IP-screen
   * answer set from the fetcher in resolver order. WI-02 lands the
   * seam; the production transport that actually pins the socket to
   * `allowedAddresses[0]` via `node:https.request` + custom `lookup`
   * is delivered by WI-03 (ADR §3 / §4). The default
   * `makeNodeFetchHttpsTransport` accepts the field and ignores it
   * until then, so callers can already pass the vetted set.
   *
   * The seam contract (per ADR §1):
   * - The fetcher passes the COMPLETE vetted set, not a subset; quiet
   *   subsetting is forbidden.
   * - The fetcher does not reorder by family or any other criterion;
   *   resolver order is preserved.
   * - The transport selects exactly `allowedAddresses[0]` (WI-03);
   *   no internal fallback, retry, or reorder.
   */
  fetch(
    url: URL,
    init: {
      readonly signal: AbortSignal;
      readonly allowedAddresses: ReadonlyArray<DnsAddress>;
    },
  ): Promise<HttpsTransportResponse>;
}

export interface HttpsTransportResponse {
  readonly status: number;
  readonly headers: Headers;
  /**
   * Async iterable of byte chunks. The fetcher consumes this while
   * enforcing the per-page size cap, so a malicious unbounded stream
   * is aborted before it exhausts memory.
   */
  readonly body: AsyncIterable<Uint8Array>;
}

export interface FetchedPage {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
