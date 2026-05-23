// Impl-parity stub-frontier test. Tracks the NEXT still-stubbed
// method on the SQLite impl. Per B10 plan §1.4 (retargets B9.0 → B10.0).
//
// Update the target method when the next phase implements it.
// Currently: B10 ships read-side aggregations; next stub frontier is
// `appendFactOnce` (B11; replay-safe Once variants).

import { test } from "node:test";
import assert from "node:assert/strict";

import { makePair } from "./impl-parity-common.mjs";

test("impl-parity B10.0: not_implemented surfaces uniformly on SQLite for non-B1..B10 methods", async () => {
  const { sqlite } = makePair();
  let err;
  try { await sqlite.appendFactOnce({}); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.name, "CaseBoxPersistenceError");
  assert.equal(err.code, "not_implemented");
  assert.match(err.message, /appendFactOnce/);
});
