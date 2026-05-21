// Test-only seam for case-box-persistence audit-chain tamper tests.
//
// Imports the module-private `_tamperStoredEventForTest` function from
// `../dist/inMemoryRepo.js` — that function is NOT re-exported from the
// package's `src/index.ts`, so external consumers using
// `case-box-persistence` (via the `exports` field) cannot reach it.
//
// The conformance §6.2.7 prototype allowlist check protects the public
// surface: `_tamperStoredEventForTest` is a top-level function, not a
// method on `InMemoryCaseBoxPersistence`, so the prototype's
// `Object.getOwnPropertyNames` stays clean.

export { _tamperStoredEventForTest as tamperStoredEvent } from "../dist/inMemoryRepo.js";
export { _tamperFactSupersedesForTest } from "../dist/inMemoryFact.js";
// Module-private fact-state accessor for the conformance harness. Lets
// the cycle-walk test inject pre-corrupt state. Not re-exported from
// src/index.ts — invisible to package consumers.
export { _internalFactStateForTest } from "../dist/inMemoryRepo.js";
