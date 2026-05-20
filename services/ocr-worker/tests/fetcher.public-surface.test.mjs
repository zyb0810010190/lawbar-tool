// Public-surface smoke test (WI-03b).
//
// WI-03b introduces internal symbols (HttpsTransportError,
// HttpsTransportErrorCode, isHttpsTransportError) and an internal test
// seam (makeNodeHttpsRequestTransportForTest). They MUST stay out of
// the package's public barrels — `services/ocr-worker/src/index.ts`
// and `services/ocr-worker/src/fetcher/index.ts` — so that internal
// error discriminators never become public API and the test-only
// request-factory seam never widens the surface.
//
// This is a non-skipped runtime assertion. A future change that
// re-exports any of these symbols from either barrel will fail this
// test loudly.

import { test } from "node:test";
import assert from "node:assert/strict";

const INTERNAL_SYMBOLS_FORBIDDEN_IN_PUBLIC_BARRELS = [
  "HttpsTransportError",
  "HttpsTransportErrorCode",
  "isHttpsTransportError",
  "makeNodeHttpsRequestTransportForTest",
];

const REQUIRED_PUBLIC_FETCHER_EXPORTS = [
  // From WI-02 + WI-03a — the public fetcher surface that callers rely
  // on. If a refactor accidentally drops one of these, this assertion
  // surfaces the regression alongside the leak check.
  "fetchPageBytes",
  "FetcherError",
  "FETCHER_ERROR_CODES",
  "makeNodeHttpsRequestTransport",
  "makeNodeFetchHttpsTransport",
  "makePinnedLookup",
];

test("public barrel `ocr-worker/dist/index.js` does NOT re-export WI-03b internal symbols", async () => {
  const publicTop = await import("../dist/index.js");
  for (const name of INTERNAL_SYMBOLS_FORBIDDEN_IN_PUBLIC_BARRELS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(publicTop, name),
      false,
      `internal symbol ${JSON.stringify(name)} leaked into the top-level public barrel`,
    );
  }
});

test("public barrel `ocr-worker/dist/fetcher/index.js` does NOT re-export WI-03b internal symbols", async () => {
  const publicFetcher = await import("../dist/fetcher/index.js");
  for (const name of INTERNAL_SYMBOLS_FORBIDDEN_IN_PUBLIC_BARRELS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(publicFetcher, name),
      false,
      `internal symbol ${JSON.stringify(name)} leaked into the fetcher public barrel`,
    );
  }
});

test("public barrel still exports the WI-02 / WI-03a fetcher surface", async () => {
  const publicTop = await import("../dist/index.js");
  for (const name of REQUIRED_PUBLIC_FETCHER_EXPORTS) {
    assert.ok(
      publicTop[name] !== undefined,
      `expected public top-level export ${JSON.stringify(name)} is missing`,
    );
  }
});

test("internal symbols are reachable via the internal `dist/fetcher/...` paths (so tests are not lying about absence)", async () => {
  // Sanity-check: the absence assertions above are only meaningful if
  // the internal symbols actually exist somewhere. Confirm they live
  // in the internal modules where WI-03b placed them.
  const internalErrors = await import("../dist/fetcher/httpsTransportErrors.js");
  assert.ok(internalErrors.HttpsTransportError, "HttpsTransportError must exist in the internal module");
  assert.ok(typeof internalErrors.isHttpsTransportError === "function", "isHttpsTransportError must be exported from the internal module");

  const internalTransport = await import("../dist/fetcher/httpsTransport.js");
  assert.ok(
    typeof internalTransport.makeNodeHttpsRequestTransportForTest === "function",
    "makeNodeHttpsRequestTransportForTest must exist in the internal transport module",
  );
});
