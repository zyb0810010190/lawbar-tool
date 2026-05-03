// Run the queue conformance harness against the in-memory backend.
//
// Step 10I-A: the harness now lives in the neutral contract package
// (`ocr-worker-contract/testing`) so `InMemoryOcrQueue` and the future
// SQLite-backed queue in `ocr-persistence` prove the same behavior without
// either side reaching across packages.
//
// `OcrQueueError` is intentionally NOT passed in: the harness defaults to
// the canonical class from `ocr-worker-contract`, and the adapter
// re-exports the same class identity (regression-pinned in
// `queueContractRelocation.test.mjs`). Passing a different class would
// break that pin.

import { InMemoryOcrQueue } from "../dist/index.js";
import { runOcrQueueConformance } from "ocr-worker-contract/testing";

runOcrQueueConformance({
  label: "InMemoryOcrQueue",
  makeImpl: ({ now, leaseMs, generateReceipt } = {}) =>
    new InMemoryOcrQueue({ now, leaseMs, generateReceipt }),
});
