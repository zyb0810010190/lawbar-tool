// Impl-parity stub-frontier test. Tracks the NEXT still-stubbed
// method on the SQLite impl. Per B9 plan §1.5 (retargets B8.0 → B9.0).
//
// Update the target method when the next phase implements it.
// Currently: B9 ships OCR links; next stub frontier is
// `getDeadlineCalendar` (B10).

import { test } from "node:test";
import assert from "node:assert/strict";

import { makePair } from "./impl-parity-common.mjs";

test("impl-parity B9.0: not_implemented surfaces uniformly on SQLite for non-B1..B9 methods", async () => {
  const { sqlite } = makePair();
  let err;
  try { await sqlite.getDeadlineCalendar({}); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.name, "CaseBoxPersistenceError");
  assert.equal(err.code, "not_implemented");
  assert.match(err.message, /getDeadlineCalendar/);
});
