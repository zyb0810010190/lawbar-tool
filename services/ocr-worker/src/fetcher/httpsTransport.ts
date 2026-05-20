// HTTPS transport implementations. See ADR-11D.2-A.
//
// **WI-03a landing**: the canonical factory is now
// `makeNodeHttpsRequestTransport`, backed by `node:https.request` with a
// custom `lookup` callback that pins the socket to
// `init.allowedAddresses[0]` while preserving the original URL hostname
// for Host header, SNI `servername`, and certificate verification.
// Per-request CA injection is supported via `options.ca`.
//
// Legacy `makeNodeFetchHttpsTransport` (the WI-02-era global-`fetch`
// default) is retained in WI-03a as a thin compatibility wrapper that
// delegates to `makeNodeHttpsRequestTransport({})`. This preserves the
// existing `fetchPageBytes.ts` default callsite without WI-03a having to
// touch it. Hard removal / deprecation cleanup is deferred outside WI-03a.
//
// **WI-03a scope boundaries** (these are intentionally NOT implemented here;
// see WI-03b/c/d in `docs/release/go-live-plan.md`):
//   - Runtime input validation of `init.allowedAddresses` (plain-object,
//     family, mapped/scoped IPv6, private addresses, etc.) → WI-03b.
//   - Strict `Content-Length` parsing → WI-03c.
//   - Strict `chunk.constructor === Uint8Array` body adaptation → WI-03c.
//   - Per-phase abort mechanics (connect / headers / body) and
//     iterator-throw normalization → WI-03c.
//   - Un-skipping `fetcher.https.transport.test.mjs` and adding the TLS
//     test harness → WI-03d.
//
// Until those sub-WIs land, the transport relies on the WI-02 fetcher's
// existing guarantees (the fetcher rejects empty / mixed-private DNS
// answer sets before calling transport, per ADR §1).

import { request as httpsRequest } from "node:https";

import type { DnsAddress, HttpsTransport, HttpsTransportResponse } from "./types.js";

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
  return {
    fetch(url, init) {
      return new Promise<HttpsTransportResponse>((resolve, reject) => {
        // Trust the fetcher's invariant (ADR §1): allowedAddresses is
        // non-empty. WI-03b adds the runtime defense-in-depth check
        // that maps to `https_network_error`.
        const pinned = init.allowedAddresses[0]!;

        const req = httpsRequest(
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
