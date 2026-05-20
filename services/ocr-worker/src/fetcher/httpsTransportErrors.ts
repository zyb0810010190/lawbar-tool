// Internal HTTPS transport input validation errors (WI-03b).
//
// This module is INTERNAL. It is intentionally NOT re-exported from
// `services/ocr-worker/src/index.ts` or
// `services/ocr-worker/src/fetcher/index.ts`. External callers see
// transport validation failures only via the public `FetcherError`
// with `code: "https_network_error"`, which preserves the original
// `HttpsTransportError` as `cause` (see fetchPageBytes.ts WI-03b
// mapping branch). Tests import this module by internal path.
//
// Codes are stable string literals. Error messages are non-contractual
// — tests assert on `instanceof HttpsTransportError` and `err.code`,
// not on message text. The class identity + code field together form
// the contract.

/**
 * Stable internal discriminator codes for `HttpsTransportError`. These
 * are NOT part of the package's public API; they exist so the fetcher's
 * remap branch and the WI-03b runtime-validation tests can pin behavior
 * to a specific failure mode without parsing message strings.
 *
 * Order matches the pinned validation order in `httpsTransport.ts`:
 * container checks first, then per-entry checks in the documented
 * sequence. See `docs/release/go-live-plan.md` WI-03b for the binding
 * mapping.
 */
export type HttpsTransportErrorCode =
  | "MISSING_ALLOWED_ADDRESSES"
  | "ALLOWED_ADDRESSES_NOT_ARRAY"
  | "EMPTY_ALLOWED_ADDRESSES"
  | "ADDRESS_ENTRY_NOT_PLAIN_OBJECT"
  | "ADDRESS_MISSING_ADDRESS"
  | "ADDRESS_MISSING_FAMILY"
  | "ADDRESS_NOT_STRING"
  | "ADDRESS_FAMILY_NOT_NUMBER"
  | "ADDRESS_INVALID_LITERAL"
  | "ADDRESS_FAMILY_MISMATCH"
  | "ADDRESS_FAMILY_INVALID"
  | "ADDRESS_PRIVATE";

/**
 * Internal transport-input error. Always carries a stable `code`.
 *
 * `name === "HttpsTransportError"`; `cause` is preserved when supplied.
 * Stack is preserved via normal `Error` construction. Messages are
 * non-contractual.
 */
export class HttpsTransportError extends Error {
  readonly code: HttpsTransportErrorCode;

  constructor(
    message: string,
    options: { code: HttpsTransportErrorCode; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HttpsTransportError";
    this.code = options.code;
  }
}

/**
 * Type guard. Asserts both `instanceof HttpsTransportError` and the
 * presence of a string `code` field. Does NOT rely on message text or
 * the `name` property alone — a same-class cross-realm clone would
 * lose `instanceof` and is treated as not-this-error.
 */
export function isHttpsTransportError(
  value: unknown,
): value is HttpsTransportError {
  return (
    value instanceof HttpsTransportError &&
    typeof (value as HttpsTransportError).code === "string"
  );
}
