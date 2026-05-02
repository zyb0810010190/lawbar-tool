// Conformance entry-point for InMemoryOcrPersistence.
//
// Runs the full behavioral conformance harness against the in-memory
// implementation. The same harness will run against the SQLite-backed
// implementation in Step 9.

import {
  InMemoryOcrPersistence,
  OcrPersistenceError,
} from "../dist/index.js";

import { runOcrPersistenceConformance } from "./conformance/runOcrPersistenceConformance.mjs";

runOcrPersistenceConformance({
  label: "InMemoryOcrPersistence",
  OcrPersistenceError,
  makeImpl: ({ now }) => ({
    persistence: new InMemoryOcrPersistence({ now }),
    // No external resources to clean up for the in-memory impl.
  }),
});
