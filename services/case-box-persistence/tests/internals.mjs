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

import { _tamperFactSupersedesForTest as _tamperInMem } from "../dist/inMemoryFact.js";
import { _internalFactStateForTest as _internalState } from "../dist/inMemoryRepo.js";

// Polymorphic tamper helper for the supersession-cycle conformance
// test (6.A4.22). InMemory persistence uses the in-memory state seam;
// SQLite persistence (test wrapper exposes `_db`) updates the row +
// payload_json directly via SQL. Per B6 plan §1.4 + §1.6: SQLite
// tamper is the row-mutation analog of B3's payload-tamper hardening.
export function _tamperFactSupersedesAny(persistence, factId, newSupersedes) {
  if (persistence && persistence._db) {
    const row = persistence._db
      .prepare("SELECT payload_json FROM case_box_facts WHERE id = ?")
      .get(factId);
    if (row === undefined) {
      throw new Error(`tamper(sqlite): unknown factId ${factId}`);
    }
    const parsed = JSON.parse(row.payload_json);
    parsed.supersedes_fact_id = newSupersedes;
    persistence._db
      .prepare("UPDATE case_box_facts SET supersedes_fact_id = ?, payload_json = ? WHERE id = ?")
      .run(newSupersedes, JSON.stringify(parsed), factId);
    return;
  }
  _tamperInMem(_internalState(persistence), factId, newSupersedes);
}
