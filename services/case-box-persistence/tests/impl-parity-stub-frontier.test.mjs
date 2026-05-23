// Impl-parity stub-frontier test. Tracks the NEXT still-stubbed
// method on the SQLite impl. Per B8 plan §1.6 (retargets B7.0 → B8.0).
//
// Update the target method when the next phase implements it.
// Currently: B8 ships evidence items; next stub frontier is
// `upsertOcrLink` (B9).

import { test } from "node:test";
import assert from "node:assert/strict";

import { makePair } from "./impl-parity-common.mjs";

test("impl-parity B8.0: not_implemented surfaces uniformly on SQLite for non-B1..B8 methods", async () => {
  const { sqlite } = makePair();
  let err;
  try { await sqlite.upsertOcrLink({}); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.name, "CaseBoxPersistenceError");
  assert.equal(err.code, "not_implemented");
  assert.match(err.message, /upsertOcrLink/);
});
