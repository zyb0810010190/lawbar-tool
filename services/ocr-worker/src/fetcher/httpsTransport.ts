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

        const req = requestFactory(
          url,
          {
            method: "GET",
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
            // before the status line parsed. Surfacing this as a
            // transport error (mapped to https_network_error by the
            // fetcher's existing wrapTimeoutError → generic-error
            // path) is safer than fabricating status 0 and letting
            // the fetcher's HTTPS_STATUS_UNEXPECTED branch misclassify it.
            if (res.statusCode === undefined) {
              reject(new Error("transport: response missing statusCode"));
              return;
            }
            // Convert Node's plain-object headers to the Web Headers
            // contract HttpsTransportResponse promises. Multi-value
            // headers are forwarded via append; undefined values are
            // skipped. Strict Content-Length parsing is deferred to
            // WI-03c, so we do not validate the header value here.
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (Array.isArray(v)) {
                for (const item of v) headers.append(k, item);
              } else if (v !== undefined) {
                headers.set(k, String(v));
              }
            }
            resolve({
              status: res.statusCode,
              headers,
              // IncomingMessage is an async iterable yielding Buffer
              // chunks. Buffer is a Uint8Array subclass, so this works
              // at runtime; WI-03c will tighten to strict
              // `chunk.constructor === Uint8Array` per ADR §6.
              body: res as unknown as AsyncIterable<Uint8Array>,
            });
          },
        );
        req.on("error", reject);
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
