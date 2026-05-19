// Default HttpsTransport implementation backed by Node's built-in
// `fetch`. See ADR-11D.2 §2 for the seam rationale.
//
// Production wires `makeNodeFetchHttpsTransport()` into FetcherDeps.
// Tests inject a stub that returns canned HttpsTransportResponses
// so the fetcher's gates can be exercised without real network I/O.
//
// WI-02 status: the signature accepts `init.allowedAddresses` (the
// post-DNS, post-private-IP-screen vetted answer set) but this
// default transport ignores it — global `fetch` resolves DNS itself
// on the socket layer, so socket pinning to `allowedAddresses[0]`
// has no hook. WI-03 replaces this with a `node:https.request`-based
// transport that consumes `allowedAddresses[0]` via a custom
// `lookup` callback. Until then, deployments using this transport
// retain the pre-WI-03 SSRF surface: the fetcher refuses non-public
// answers, but the socket still resolves the hostname via the
// platform resolver, so a TOCTOU between the fetcher's DNS check
// and the socket's DNS resolution remains possible.

import type { HttpsTransport, HttpsTransportResponse } from "./types.js";

export function makeNodeFetchHttpsTransport(): HttpsTransport {
  return {
    async fetch(url, init) {
      // WI-02 seam: `init.allowedAddresses` is part of the required
      // shape but this default transport cannot honor it. Tagged
      // with a void reference so a future linter/tsc strictness
      // bump catches the unused field intentionally.
      void init.allowedAddresses;
      const res = await fetch(url, {
        signal: init.signal,
        redirect: "manual",
      });
      const body = res.body;
      if (body === null) {
        // Node returns null when the response has no body (e.g.,
        // 204 No Content, 304 Not Modified). In practice the
        // caller's 200-only status gate fires first, so this
        // branch is rarely reached; we return an empty iterable
        // as a defensive default so any downstream consumer that
        // somehow gets here doesn't crash on `for await` over null.
        return {
          status: res.status,
          headers: res.headers,
          body: emptyAsyncIterable(),
        } satisfies HttpsTransportResponse;
      }
      return {
        status: res.status,
        headers: res.headers,
        body: body as unknown as AsyncIterable<Uint8Array>,
      };
    },
  };
}

async function* emptyAsyncIterable(): AsyncIterable<Uint8Array> {
  // empty
}
