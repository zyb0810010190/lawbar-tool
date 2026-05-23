// Impl-parity stub-frontier test. Tracks the NEXT still-stubbed
// method on the SQLite impl. Per B7 plan §1.6 + B6 plan §1.7 split.
//
// Update the target method when the next phase implements it.
// Currently: B7 ships docket entries + deadlines; next stub frontier
// is `appendEvidenceItem` (B8).

import { test } from "node:test";
import assert from "node:assert/strict";

import { makePair } from "./impl-parity-common.mjs";

test("impl-parity B7.0: not_implemented surfaces uniformly on SQLite for non-B1..B7 methods", async () => {
  const { sqlite } = makePair();
  let err;
  try { await sqlite.appendEvidenceItem({}); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.name, "CaseBoxPersistenceError");
  assert.equal(err.code, "not_implemented");
  assert.match(err.message, /appendEvidenceItem/);
});
