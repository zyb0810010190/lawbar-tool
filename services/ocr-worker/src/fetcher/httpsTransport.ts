// Default HttpsTransport implementation backed by Node's built-in
// `fetch`. See ADR-11D.2 §2 for the seam rationale.
//
// Production wires `makeNodeFetchHttpsTransport()` into FetcherDeps.
// Tests inject a stub that returns canned HttpsTransportResponses
// so the fetcher's gates can be exercised without real network I/O.

import type { HttpsTransport, HttpsTransportResponse } from "./types.js";

export function makeNodeFetchHttpsTransport(): HttpsTransport {
  return {
    async fetch(url, init) {
      const res = await fetch(url, {
        signal: init.signal,
        redirect: "manual",
      });
      const body = res.body;
      if (body === null) {
        // Node returns null for HEAD requests or no-content responses.
        // We never issue HEAD; if the body is null on a GET it means
        // the server returned 204 / 304. Either way, an empty async
        // iterable lets the caller's size-mismatch / 200-only checks
        // surface the right error code (https_status_not_ok for 304;
        // size_mismatch for 204 with declared byte_size > 0).
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
