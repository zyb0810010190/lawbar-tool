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
