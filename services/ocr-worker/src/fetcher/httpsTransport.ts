// HTTPS transport implementations. See ADR-11D.2-A.
//
// **WI-03a landing**: the canonical factory is now
// `makeNodeHttpsRequestTransport`, backed by `node:https.request` with a
// custom `lookup` callback that pins the socket to
// `init.allowedAddresses[0]` while preserving the original URL hostname
// for Host header, SNI `servername`, and certificate verification.
// Per-request CA injection is supported via `options.ca`.
//
// **WI-03b landing**: each `fetch(url, init)` call runs a pure preflight
// helper that validates `init.allowedAddresses` against ADR §5 BEFORE
// creating `https.request`, BEFORE invoking the custom lookup, and
// BEFORE any socket activity. Validation failures throw
// `HttpsTransportError` with a stable `code` discriminator; the fetcher
// maps these to public `https_network_error` while preserving the
// internal error as `cause`. The validation order is pinned (container
// → per-entry plain-object/own-data-properties → type → trim →
// mapped/scoped literal → net.isIP → family match → isPrivateIp); the
// first invalid element rejects the entire request without filtering
// or reordering. `makeNodeHttpsRequestTransportForTest({ request })`
// exposes an internal request-factory seam so tests can prove the
// fake `request` is never called when validation rejects.
//
// Legacy `makeNodeFetchHttpsTransport` (the WI-02-era global-`fetch`
// default) is retained in WI-03a as a thin compatibility wrapper that
// delegates to `makeNodeHttpsRequestTransport({})`. This preserves the
// existing `fetchPageBytes.ts` default callsite without WI-03a having to
// touch it. Hard removal / deprecation cleanup is deferred outside WI-03a.
//
// **WI-03b scope boundaries** (intentionally NOT implemented here; see
// WI-03c/d in `docs/release/go-live-plan.md`):
//   - Strict `Content-Length` parsing → WI-03c.
//   - Strict `chunk.constructor === Uint8Array` body adaptation → WI-03c.
//   - Per-phase abort mechanics (connect / headers / body) and
//     iterator-throw normalization → WI-03c.
//   - Un-skipping non-validation transport matrix tests + adding the
//     TLS test harness → WI-03d.

import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { Buffer } from "node:buffer";

import type { DnsAddress, HttpsTransport, HttpsTransportResponse } from "./types.js";
import { HttpsTransportError } from "./httpsTransportErrors.js";
import { isPrivateIp } from "./privateIp.js";

/**
 * Callback shape Node invokes on a custom `lookup` function.
 *
 * Node 22 invokes with `options.all === true` and expects the
 * array-callback form (`cb(null, [{address, family}])`); older Nodes
 * may still invoke with the legacy `cb(null, address, family)` shape.
 * `makePinnedLookup` handles both forms and the no-options
 * `lookup(host, cb)` form defensively.
 */
type PinnedLookupCallback = (
  err: NodeJS.ErrnoException | null,
  addressOrList?: string | Array<{ address: string; family: 4 | 6 }>,
  family?: 4 | 6,
) => void;

/**
 * Build a `lookup` callback that pins Node's DNS resolution to a
 * single vetted address. Exported for direct unit testing — WI-03a's
 * security-critical seam needs at least one non-skipped behavioral
 * assertion that the lookup hook does not leak the full vetted list
 * to Node, even while the full TLS test harness is deferred to WI-03d.
 *
 * Per plan locked-decision §3, both lookup callback modes return
 * exactly the single pinned entry; the complete vetted list is never
 * returned wholesale.
 */
export function makePinnedLookup(pinned: DnsAddress) {
  return function pinnedLookup(
    _host: string,
    optsOrCb: unknown,
    maybeCb?: unknown,
  ): void {
    // Normalize the legacy `lookup(host, cb)` shape (no options).
    let opts: { all?: boolean } | undefined;
    let cb: PinnedLookupCallback;
    if (typeof optsOrCb === "function") {
      opts = undefined;
      cb = optsOrCb as PinnedLookupCallback;
    } else {
      opts = optsOrCb as { all?: boolean } | undefined;
      cb = maybeCb as PinnedLookupCallback;
    }
    // Defensive: if Node ever invokes lookup with neither a function
    // in arg 2 nor arg 3, surfacing this as a thrown error (rather
    // than crashing inside Node's request machinery with an opaque
    // "cb is not a function") helps diagnose signature drift.
    if (typeof cb !== "function") {
      throw new TypeError(
        "pinned lookup: expected a callback in arg 2 or arg 3, got " + typeof cb,
      );
    }
    if (opts && opts.all === true) {
      cb(null, [{ address: pinned.address, family: pinned.family }]);
    } else {
      cb(null, pinned.address, pinned.family);
    }
  };
}

// ---------------------------------------------------------------------
// WI-03b — Runtime address validation (pure preflight helper)
// ---------------------------------------------------------------------

/**
 * Validate `allowedAddresses` per the pinned WI-03b order. Pure,
 * synchronous, side-effect-free. Throws `HttpsTransportError` with a
 * stable `code` on the first failure; returns nothing on success.
 *
 * Order (binding — see `docs/release/go-live-plan.md` WI-03b):
 *
 *   1. Container checks (missing / non-array / empty).
 *   2. For each element in array order:
 *      - plain-object check
 *      - own-data-property descriptors for `address` and `family`
 *      - typeof checks
 *      - `address === address.trim()`
 *      - mapped/scoped literal rejection (before family/private)
 *      - `net.isIP(address) !== 0`
 *      - `net.isIP(address) === family`
 *      - `family` value gate (4 or 6)
 *      - `isPrivateIp(address)` defense-in-depth
 *   3. First invalid element rejects the entire request.
 *
 * Mapped/scoped literals (`::ffff:1.2.3.4`, `fe80::1%lo0`) emit
 * `ADDRESS_INVALID_LITERAL`, NOT `ADDRESS_PRIVATE`, even though some
 * scoped forms would be classified private by `isPrivateIp` — the
 * literal-invalidity check runs first by design.
 */
function validateAllowedAddresses(value: unknown): asserts value is ReadonlyArray<DnsAddress> {
  // --- Container checks -----------------------------------------------
  if (value === undefined || value === null) {
    throw new HttpsTransportError(
      "init.allowedAddresses is required",
      { code: "MISSING_ALLOWED_ADDRESSES" },
    );
  }
  if (!Array.isArray(value)) {
    throw new HttpsTransportError(
      `init.allowedAddresses must be an array (got ${typeof value})`,
      { code: "ALLOWED_ADDRESSES_NOT_ARRAY" },
    );
  }
  if (value.length === 0) {
    throw new HttpsTransportError(
      "init.allowedAddresses must contain at least one entry",
      { code: "EMPTY_ALLOWED_ADDRESSES" },
    );
  }

  // --- Per-entry checks, array order, first-invalid wins ---------------
  for (let i = 0; i < value.length; i++) {
    validateAddressEntry(value[i], i);
  }
}

function validateAddressEntry(entry: unknown, index: number): void {
  const at = `allowedAddresses[${index}]`;

  // Plain-object check: not null, not array, prototype is exactly
  // Object.prototype. Rejects Object.create(null), class instances
  // (including Buffer, Date), arrays, functions, primitives.
  if (
    entry === null ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    Object.getPrototypeOf(entry) !== Object.prototype
  ) {
    throw new HttpsTransportError(
      `${at} must be a plain object`,
      { code: "ADDRESS_ENTRY_NOT_PLAIN_OBJECT" },
    );
  }

  // Own-data-property descriptors. Required fields must be own data
  // properties, NOT accessors — accessor descriptors are rejected
  // before reading values so validation remains pure (no getter
  // side effects).
  const addrDesc = Object.getOwnPropertyDescriptor(entry, "address");
  const famDesc = Object.getOwnPropertyDescriptor(entry, "family");

  if (addrDesc === undefined) {
    throw new HttpsTransportError(
      `${at}.address is required`,
      { code: "ADDRESS_MISSING_ADDRESS" },
    );
  }
  if (famDesc === undefined) {
    throw new HttpsTransportError(
      `${at}.family is required`,
      { code: "ADDRESS_MISSING_FAMILY" },
    );
  }
  // Accessor descriptors (getter/setter) reject as not-a-plain-object —
  // a plain object with a getter is structurally fine but would force
  // validation to invoke the getter, breaking the pure-preflight rule.
  if (!("value" in addrDesc) || !("value" in famDesc)) {
    throw new HttpsTransportError(
      `${at} must use own data properties for address and family (accessors rejected)`,
      { code: "ADDRESS_ENTRY_NOT_PLAIN_OBJECT" },
    );
  }

  const address = (entry as { address: unknown }).address;
  const family = (entry as { family: unknown }).family;

  // Type checks
  if (typeof address !== "string") {
    throw new HttpsTransportError(
      `${at}.address must be a string (got ${typeof address})`,
      { code: "ADDRESS_NOT_STRING" },
    );
  }
  if (typeof family !== "number") {
    throw new HttpsTransportError(
      `${at}.family must be a number (got ${typeof family})`,
      { code: "ADDRESS_FAMILY_NOT_NUMBER" },
    );
  }

  // Trim equality — leading/trailing whitespace invalidates the literal
  // before any further parsing.
  if (address !== address.trim()) {
    throw new HttpsTransportError(
      `${at}.address contains leading or trailing whitespace`,
      { code: "ADDRESS_INVALID_LITERAL" },
    );
  }

  // Mapped/scoped literal rejection — must run BEFORE net.isIP/family
  // and BEFORE isPrivateIp so the "literal invalidity wins" ordering
  // rule holds for cases like `fe80::1%lo0`.
  if (address.includes("%")) {
    throw new HttpsTransportError(
      `${at}.address rejects zone/scoped IPv6 (contains "%")`,
      { code: "ADDRESS_INVALID_LITERAL" },
    );
  }
  if (isIPv4MappedIPv6(address)) {
    throw new HttpsTransportError(
      `${at}.address rejects IPv4-mapped IPv6 literal`,
      { code: "ADDRESS_INVALID_LITERAL" },
    );
  }

  // node:net parse check
  const parsed = isIP(address);
  if (parsed === 0) {
    throw new HttpsTransportError(
      `${at}.address is not a valid IPv4 or IPv6 literal`,
      { code: "ADDRESS_INVALID_LITERAL" },
    );
  }

  // Family value gate — must be exactly 4 or 6. Done AFTER literal
  // parsing succeeded; a literal-vs-family mismatch (e.g. family=6
  // with an IPv4 literal) takes precedence over an out-of-range
  // family because the literal already parsed.
  if (parsed !== family) {
    if (family !== 4 && family !== 6) {
      throw new HttpsTransportError(
        `${at}.family must be exactly 4 or 6 (got ${family})`,
        { code: "ADDRESS_FAMILY_INVALID" },
      );
    }
    throw new HttpsTransportError(
      `${at}.family ${family} does not match the parsed address family ${parsed}`,
      { code: "ADDRESS_FAMILY_MISMATCH" },
    );
  }

  // Private-IP defense-in-depth. Runs after literal/mapped/scoped
  // rejection so only syntactically valid, non-mapped, non-scoped
  // literals reach this check.
  //
  // Message intentionally does NOT include the raw address literal:
  // the public `FetcherError` mapping in `fetchPageBytes.ts` embeds
  // `err.message`, and embedding the address would leak it into any
  // sink that logs `FetcherError.message`. The `code` discriminator
  // (`ADDRESS_PRIVATE`) is the diagnostic surface; the original
  // address is still reachable via `err.cause` for in-process
  // inspection if a debugger/test needs it.
  if (isPrivateIp(address)) {
    throw new HttpsTransportError(
      `${at}.address is private/reserved/blocklisted`,
      { code: "ADDRESS_PRIVATE" },
    );
  }
}

/**
 * IPv4-mapped IPv6 literal detector. Catches both:
 *   - dotted form: `::ffff:127.0.0.1`, `::ffff:8.8.8.8`
 *   - hex form:    `::ffff:0102:0304`, `::ffff:7f00:1`
 *
 * `net.isIP` accepts both as IPv6, so this guard exists to enforce
 * the WI-03b rule that mapped forms are NOT acceptable pinning
 * literals regardless of `isIP`'s opinion.
 */
function isIPv4MappedIPv6(address: string): boolean {
  if (isIP(address) !== 6) return false;
  const lower = address.toLowerCase();
  // Dotted form — any IPv6 literal containing a "." is either
  // IPv4-compatible or IPv4-mapped; the WI-03b rule rejects both.
  if (lower.includes(".")) return true;
  // Hex form: address shape ::ffff:XXXX:XXXX with the top 80 bits
  // zero. Use the same expander/inspector pattern as privateIp.ts.
  return hasIPv4MappedHexShape(lower);
}

function hasIPv4MappedHexShape(addr: string): boolean {
  // Expand `::` once.
  const dcIdx = addr.indexOf("::");
  let parts: string[];
  if (dcIdx === -1) {
    parts = addr.split(":");
  } else {
    const left = addr.slice(0, dcIdx);
    const right = addr.slice(dcIdx + 2);
    const leftParts = left === "" ? [] : left.split(":");
    const rightParts = right === "" ? [] : right.split(":");
    const fillCount = 8 - leftParts.length - rightParts.length;
    if (fillCount < 0) return false;
    parts = [...leftParts, ...Array<string>(fillCount).fill("0"), ...rightParts];
  }
  if (parts.length !== 8) return false;
  for (const p of parts) {
    if (p.length === 0 || p.length > 4) return false;
    if (!/^[0-9a-f]+$/.test(p)) return false;
  }
  // Top 5 groups must be zero; 6th group must be 0xffff. Bottom two
  // are the embedded IPv4. Note isIP("::ffff:0:0") returns 6 but the
  // bottom two being zero would mean 0.0.0.0 — still mapped and
  // still rejected.
  for (let i = 0; i < 5; i++) {
    if (Number.parseInt(parts[i]!, 16) !== 0) return false;
  }
  return Number.parseInt(parts[5]!, 16) === 0xffff;
}

// Tests that need the internal error class / guard / code type import
// them directly from `./httpsTransportErrors.ts` via the internal
// build path; nothing from that module is re-exported here, and the
// fetcher's public barrel does not re-export `httpsTransport.ts` via
// `export *`, so adding internal seams to this file cannot widen the
// public surface.

// ---------------------------------------------------------------------
// WI-03c — Response adapter helpers
// ---------------------------------------------------------------------

/**
 * Parse a single Content-Length header from `res.rawHeaders`, enforcing
 * WI-03c rules:
 *
 *   - count = 0 → header absent → return `null`; transport streams
 *     under the existing per-page size cap; no size hint.
 *   - count = 1 → validate syntax (base-10 non-negative integer, no
 *     leading zero on non-`"0"`, no sign, no decimal, no whitespace).
 *   - count > 1 → throw `RESPONSE_CONTENT_LENGTH_DUPLICATE`.
 *
 * Duplicate detection MUST use `res.rawHeaders` (raw occurrence
 * sequence) rather than `res.headers` because Node collapses duplicate
 * `content-length` entries in the parsed `headers` object, masking the
 * multiplicity that ADR §6 requires us to reject.
 *
 * Messages intentionally do NOT include the raw header value (audit
 * 1a9f55c lesson — public `FetcherError.message` embeds internal
 * `err.message`; embedding raw values risks leaking into log sinks).
 */
function parseStrictContentLength(res: IncomingMessage): number | null {
  let count = 0;
  let value: string | undefined;
  const raw = res.rawHeaders;
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i]!.toLowerCase() === "content-length") {
      count++;
      if (count > 1) {
        throw new HttpsTransportError(
          "response Content-Length header appears more than once",
          { code: "RESPONSE_CONTENT_LENGTH_DUPLICATE" },
        );
      }
      value = raw[i + 1];
    }
  }
  if (count === 0) return null;
  if (typeof value !== "string" || !isValidContentLengthValue(value)) {
    throw new HttpsTransportError(
      "response Content-Length has invalid syntax",
      { code: "RESPONSE_CONTENT_LENGTH_INVALID" },
    );
  }
  const parsed = Number.parseInt(value, 10);
  // Re-check after parseInt: Number.MAX_SAFE_INTEGER bound is policy;
  // anything outside the safe-integer range can not faithfully compare
  // against `received` byte counts.
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
    throw new HttpsTransportError(
      "response Content-Length is out of range",
      { code: "RESPONSE_CONTENT_LENGTH_INVALID" },
    );
  }
  return parsed;
}

function isValidContentLengthValue(v: string): boolean {
  if (v.length === 0) return false;
  // Strict syntax: digits only, no whitespace, no sign, no decimal, no
  // exponent. Leading zero only allowed for literal "0" (the empty-body
  // case); "0123" is rejected.
  if (!/^[0-9]+$/.test(v)) return false;
  if (v.length > 1 && v.startsWith("0")) return false;
  return true;
}

/**
 * Build the public `Headers` object from `IncomingMessage`. Multi-value
 * headers (e.g. `set-cookie`) are forwarded via `append`. Undefined
 * values are skipped. Content-Length multiplicity is enforced separately
 * by `parseStrictContentLength`; this function never throws.
 */
function buildResponseHeaders(res: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else if (v !== undefined) {
      headers.set(k, String(v));
    }
  }
  return headers;
}

/**
 * Adapt Node `IncomingMessage` (which yields `Buffer` chunks) into a
 * strict `AsyncIterable<Uint8Array>` per ADR §6 and WI-03c:
 *
 *   - Every yielded chunk satisfies `chunk.constructor === Uint8Array`.
 *     `Buffer` chunks are rewrapped as a zero-copy `Uint8Array` view
 *     over the same memory (`new Uint8Array(buf.buffer, buf.byteOffset,
 *     buf.byteLength)`), preserving `byteLength` for the fetcher's
 *     existing size-cap loop.
 *   - On `AbortSignal` abort the iterator throws `RESPONSE_ABORTED`
 *     (never ends as a partial success). The transport calls
 *     `res.destroy()` so socket resources are released.
 *   - On end-of-stream the running byte count is compared against the
 *     pre-validated Content-Length (if present); a mismatch throws
 *     `RESPONSE_CONTENT_LENGTH_INVALID`.
 *   - Listener-symmetry: the abort listener attached on the signal is
 *     removed in the generator's `finally` regardless of completion,
 *     error, or abort exit.
 *
 * For 3xx responses the iterable is returned eagerly but lazy — no
 * chunks are pre-read until the caller iterates. If the caller never
 * iterates (the fetcher's 3xx branch returns early before the body
 * loop, or the fetcher's existing `AbortController` deadline fires
 * before iteration begins), the eager abort listener installed by
 * `installUnconsumedBodyCleanup` calls `res.destroy()` so the socket
 * is released. That eager listener is removed via `onConsumed` as
 * soon as this generator starts iterating, handing ownership of the
 * abort hook to the in-flight body iterator.
 */
async function* adaptBody(
  res: IncomingMessage,
  expectedBytes: number | null,
  signal: AbortSignal,
  onConsumed: () => void,
): AsyncGenerator<Uint8Array, void, unknown> {
  // Body iteration is starting — release the eager unconsumed-body
  // cleanup listener and take ownership of the abort hook below. The
  // callback is idempotent so abort/error paths can also invoke it
  // safely.
  onConsumed();

  // Fast-fail if the signal is already aborted before iteration begins.
  // We still attach + remove a listener below for symmetry, but the
  // pre-check skips the for-await entirely so no `res.destroy()` race
  // can deliver bytes to the caller before the throw.
  if (signal.aborted) {
    res.destroy();
    throw new HttpsTransportError("body iteration aborted", {
      code: "RESPONSE_ABORTED",
    });
  }

  const onAbort = () => {
    res.destroy();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  let received = 0;
  try {
    for await (const chunk of res as AsyncIterable<unknown>) {
      if (signal.aborted) {
        throw new HttpsTransportError("body iteration aborted", {
          code: "RESPONSE_ABORTED",
        });
      }
      const adapted = adaptChunk(chunk);
      received += adapted.byteLength;
      yield adapted;
    }
    if (expectedBytes !== null && received !== expectedBytes) {
      throw new HttpsTransportError(
        "response body byte count does not match declared Content-Length",
        { code: "RESPONSE_CONTENT_LENGTH_INVALID" },
      );
    }
  } catch (err) {
    if (
      signal.aborted &&
      !(err instanceof HttpsTransportError && err.code === "RESPONSE_ABORTED")
    ) {
      throw new HttpsTransportError("body iteration aborted", {
        code: "RESPONSE_ABORTED",
        cause: err,
      });
    }
    throw err;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Convert a single body chunk to a strict `Uint8Array` (constructor
 * identity, not `instanceof`). `Buffer` is rewrapped as a zero-copy
 * view; bare `Uint8Array` passes through; anything else throws
 * `RESPONSE_BODY_CHUNK_INVALID`.
 */
function adaptChunk(chunk: unknown): Uint8Array {
  if (chunk instanceof Buffer) {
    const view = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    if (view.constructor !== Uint8Array) {
      throw new HttpsTransportError(
        "response body chunk did not adapt to strict Uint8Array",
        { code: "RESPONSE_BODY_CHUNK_INVALID" },
      );
    }
    return view;
  }
  if (chunk instanceof Uint8Array && chunk.constructor === Uint8Array) {
    return chunk;
  }
  throw new HttpsTransportError(
    "response body yielded unexpected chunk type",
    { code: "RESPONSE_BODY_CHUNK_INVALID" },
  );
}

// ---------------------------------------------------------------------
// Transport factory
// ---------------------------------------------------------------------

export interface MakeNodeHttpsRequestTransportOptions {
  /**
   * Per-request trust anchor(s). Forwarded to `https.request` via
   * `options.ca`, which `https.request` passes through to `tls.connect`
   * (Node 22.x). Accepted shapes match `tls.connect` options:
   * a single PEM string, a single PEM `Buffer`, or an array of either.
   *
   * Tests typically pass a generated CA root for a local HTTPS server;
   * production typically omits this and relies on Node's system store.
   * Global TLS process state is never modified by this transport
   * (no `NODE_EXTRA_CA_CERTS`).
   */
  readonly ca?: string | Buffer | Array<string | Buffer>;
}

/**
 * Canonical pinned HTTPS transport (WI-03a).
 *
 * Each invocation of `fetch(url, init)` issues exactly one
 * `https.request` whose socket is pinned to `init.allowedAddresses[0]`
 * via a custom `lookup` callback. The URL hostname remains the original
 * hostname for Host header, SNI `servername`, and certificate
 * verification — the pinned IP is used only to direct the underlying
 * socket connection. The complete vetted address list is consumed by
 * the transport for future policy (WI-03b runtime validation) but is
 * never returned wholesale to Node's lookup callback.
 *
 * TLS defaults are fail-closed: `rejectUnauthorized: true`,
 * `agent: false` (so no pooled sockets can cache lookup results across
 * requests), `servername: url.hostname`.
 *
 * Manual redirect handling: 3xx responses are surfaced unchanged via
 * `{ status, headers, body }`; the transport does not follow
 * `Location`. The fetcher maps 3xx to `redirect_unsupported`.
 *
 * The empty-by-callsite case (`init.allowedAddresses.length === 0`)
 * is prevented by the fetcher per ADR §1 (the fetcher fails closed
 * with `https_network_error` before reaching the transport when DNS
 * returns no addresses). WI-03b will add defense-in-depth runtime
 * validation here.
 */
export function makeNodeHttpsRequestTransport(
  options: MakeNodeHttpsRequestTransportOptions = {},
): HttpsTransport {
  return makeTransportFromRequestFactory(httpsRequest, options);
}

/**
 * Internal test seam (WI-03b). Identical to
 * `makeNodeHttpsRequestTransport` except the `https.request` function
 * is injected, so tests can pass a recording fake to prove the WI-03b
 * preflight validator throws BEFORE the request factory is ever called.
 *
 * **Internal only.** Exported from this module so test files can
 * import by internal path; NOT re-exported from
 * `services/ocr-worker/src/fetcher/index.ts` or
 * `services/ocr-worker/src/index.ts`. A non-skipped public-barrel
 * smoke test asserts this symbol stays absent from both public barrels.
 */
export function makeNodeHttpsRequestTransportForTest(
  deps: { request: typeof httpsRequest },
  options: MakeNodeHttpsRequestTransportOptions = {},
): HttpsTransport {
  return makeTransportFromRequestFactory(deps.request, options);
}

function makeTransportFromRequestFactory(
  requestFactory: typeof httpsRequest,
  options: MakeNodeHttpsRequestTransportOptions,
): HttpsTransport {
  return {
    fetch(url, init) {
      // WI-03b runtime address validation. Runs synchronously BEFORE
      // creating https.request, BEFORE invoking the custom lookup, and
      // BEFORE any socket activity. On failure, the preflight throws
      // `HttpsTransportError`; we rethrow as a rejected promise so the
      // fetcher's `isHttpsTransportError` branch can map it to public
      // `https_network_error` with the internal error preserved as
      // `cause`. The recording fake `request` used by tests is never
      // called when preflight rejects.
      try {
        validateAllowedAddresses(init.allowedAddresses);
      } catch (err) {
        return Promise.reject(err);
      }

      return new Promise<HttpsTransportResponse>((resolve, reject) => {
        const pinned = init.allowedAddresses[0]!;
        let settled = false;
        const settle = (action: () => void) => {
          if (settled) return;
          settled = true;
          action();
        };

        const req = requestFactory(
          url,
          {
            method: "GET",
            // WI-03c phase-1/phase-2 abort wiring. Node listens to this
            // signal internally and will emit 'error' on the request with
            // an AbortError when the signal fires before the response
            // yields. Our `req.on("error")` handler below checks
            // `signal.aborted` and rewraps as `RESPONSE_ABORTED`. We do
            // NOT add our own AbortSignal listener at this phase because
            // Node already owns the wiring; the body iterator (phase 3)
            // adds its own listener separately and tears it down on every
            // exit so listener-symmetry tests can verify add/remove parity.
            signal: init.signal,
            agent: false,
            rejectUnauthorized: true,
            servername: url.hostname,
            ca: options.ca,
            // Pinned lookup. Both modes return only allowedAddresses[0];
            // the full vetted list is never returned to Node. See
            // `makePinnedLookup` above for the typed helper and the
            // direct unit-test seam.
            //
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lookup: makePinnedLookup(pinned) as any,
          },
          (res) => {
            // Defense-in-depth: an `https.IncomingMessage` without a
            // statusCode would mean Node delivered a response object
            // before the status line parsed. Surface as
            // RESPONSE_CONTENT_LENGTH_INVALID rather than fabricating a
            // status so the fetcher does not misclassify.
            if (res.statusCode === undefined) {
              res.destroy();
              settle(() =>
                reject(
                  new HttpsTransportError("response missing statusCode", {
                    code: "RESPONSE_CONTENT_LENGTH_INVALID",
                  }),
                ),
              );
              return;
            }

            // WI-03c — Content-Length parsing happens BEFORE yielding
            // the response. Duplicate detection uses `res.rawHeaders`
            // (the canonical raw-occurrence source); `res.headers` would
            // collapse duplicates and miss the multiplicity check.
            let expectedBytes: number | null;
            try {
              expectedBytes = parseStrictContentLength(res);
            } catch (err) {
              res.destroy();
              settle(() => reject(err));
              return;
            }

            // Convert Node's plain-object headers to the Web Headers
            // contract `HttpsTransportResponse` promises. Multi-value
            // headers are forwarded via append; undefined values skipped.
            const headers = buildResponseHeaders(res);

            // WI-03c audit fix (audit-mpdnpa8n-iusz79): when a caller
            // never iterates the body (e.g. the fetcher's 3xx branch
            // throws REDIRECT_UNSUPPORTED before the body loop), the
            // underlying `IncomingMessage` and its socket would
            // otherwise be held until Node times out. Install an eager
            // abort listener that calls `res.destroy()` so the
            // fetcher's `AbortController` deadline reliably releases
            // resources even when the body is never consumed. The
            // listener is removed as soon as the body generator starts
            // iterating, handing ownership to the in-iterator abort
            // hook (so listener-symmetry holds on every exit).
            let bodyConsumed = false;
            const onAbortEager = () => {
              if (bodyConsumed) return;
              // Idempotent removal: if abort already fired, the second
              // remove is a no-op.
              init.signal.removeEventListener("abort", onAbortEager);
              res.destroy();
            };
            init.signal.addEventListener("abort", onAbortEager);
            const onBodyConsumed = () => {
              if (bodyConsumed) return;
              bodyConsumed = true;
              init.signal.removeEventListener("abort", onAbortEager);
            };

            // WI-03c — wrap `res` in an async generator that yields
            // strict `Uint8Array` chunks, propagates abort via
            // `RESPONSE_ABORTED`, and verifies the Content-Length /
            // body-bytes match on end-of-stream. The generator is lazy:
            // no chunks are pre-read here. For 3xx responses the body
            // is still returned as an `AsyncIterable<Uint8Array>` (may
            // be empty, never undefined); the fetcher decides whether
            // to consume it.
            const body = adaptBody(res, expectedBytes, init.signal, onBodyConsumed);

            settle(() =>
              resolve({
                status: res.statusCode!,
                headers,
                body,
              }),
            );
          },
        );

        req.on("error", (err) => {
          // Phase-1 / phase-2 abort: Node emits 'error' with the abort
          // reason. If the signal is already aborted, classify as
          // RESPONSE_ABORTED so the fetcher maps to https_timeout.
          if (init.signal.aborted) {
            settle(() =>
              reject(
                new HttpsTransportError("request aborted before response yielded", {
                  code: "RESPONSE_ABORTED",
                  cause: err,
                }),
              ),
            );
            return;
          }
          settle(() => reject(err));
        });
        req.end();
      });
    },
  };
}

/**
 * Legacy compatibility wrapper retained by WI-03a so the existing
 * `fetchPageBytes.ts` default callsite (`makeNodeFetchHttpsTransport()`)
 * continues to compile and run unchanged. Internally delegates to
 * `makeNodeHttpsRequestTransport({})`, which means the production
 * default callsite already gets the pinned `https.request` transport
 * even though WI-03a does not touch `fetchPageBytes.ts`.
 *
 * Hard removal / deprecation of this wrapper and migration of the
 * default callsite to call `makeNodeHttpsRequestTransport({})`
 * directly is deferred outside WI-03a (target: WI-03d cleanup, or a
 * dedicated follow-up WI).
 */
export function makeNodeFetchHttpsTransport(): HttpsTransport {
  return makeNodeHttpsRequestTransport({});
}
