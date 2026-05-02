// Run the queue conformance harness against the in-memory backend.
// Mirrors the persistence pattern: a tiny entry-point file that wires a
// concrete impl into a shared, backend-agnostic suite.

import { InMemoryOcrQueue, OcrQueueError } from "../dist/index.js";
import { runOcrQueueConformance } from "./conformance/runOcrQueueConformance.mjs";

runOcrQueueConformance({
  label: "InMemoryOcrQueue",
  makeImpl: ({ now, leaseMs, generateReceipt } = {}) =>
    new InMemoryOcrQueue({ now, leaseMs, generateReceipt }),
  OcrQueueError,
});
