// Impl-parity B3 — audit-read scenarios. Split from former monolithic
// impl-parity.test.mjs per B7 plan §1.7 (closes B6 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";

import { CaseBoxPersistenceError } from "../dist/index.js";
import {
  DEFAULT_MATTER_ID,
  makeDocumentInput,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair, makePair } from "./impl-parity-common.mjs";

async function buildPairChain() {
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await inMem.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "x" });
  await sqlite.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "x" });
  await inMem.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "y" });
  await sqlite.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "y" });
  return { inMem, sqlite, db };
}

test("impl-parity B3.1: listAuditEvents returns identical rows + next_cursor for 4-event chain", async () => {
  const { inMem, sqlite } = await buildPairChain();
  const query = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID };
  const im = await inMem.listAuditEvents(query);
  const sq = await sqlite.listAuditEvents(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B3.2: listAuditEvents pagination byte-identical next_cursor across 2 pages", async () => {
  const { inMem, sqlite } = await buildPairChain();
  const baseQuery = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, limit: 2 };
  let imPage = await inMem.listAuditEvents(baseQuery);
  let sqPage = await sqlite.listAuditEvents(baseQuery);
  assert.deepEqual(sqPage, imPage, "page 1 rows + next_cursor must match");
  assert.equal(typeof sqPage.next_cursor, "string");
  imPage = await inMem.listAuditEvents({ ...baseQuery, cursor: imPage.next_cursor });
  sqPage = await sqlite.listAuditEvents({ ...baseQuery, cursor: sqPage.next_cursor });
  assert.deepEqual(sqPage, imPage, "page 2 rows + next_cursor (null) must match");
  assert.equal(sqPage.next_cursor, null);
});

test("impl-parity B3.3: verifyAuditChainForMatter returns identical { ok: true, ... } for clean chain", async () => {
  const { inMem, sqlite } = await buildPairChain();
  const im = await inMem.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  const sq = await sqlite.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(sq.ok, true);
  assert.equal(im.ok, true);
  assert.equal(sq.verifiedCount, im.verifiedCount);
  assert.equal(sq.headHash, im.headHash);
});

test("impl-parity B3.4: verifyAuditChainForMatter unknown_matter on both impls", async () => {
  const { inMem, sqlite } = makePair();
  // No matter created on either side.
  let imErr, sqErr;
  try { await inMem.verifyAuditChainForMatter(DEFAULT_MATTER_ID); } catch (e) { imErr = e; }
  try { await sqlite.verifyAuditChainForMatter(DEFAULT_MATTER_ID); } catch (e) { sqErr = e; }
  assert.ok(imErr instanceof CaseBoxPersistenceError);
  assert.ok(sqErr instanceof CaseBoxPersistenceError);
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "unknown_matter");
});

// ---------------------------------------------------------------------------
// WI-06 — last-event tamper parity.
//
// B3.3 above asserts the two agree on a CLEAN chain, and B3.4 on unknown_matter. Neither
// covered tampering, and the two did NOT agree there: SQLite cross-checks a head anchor kept
// in `case_box_audit_chain_heads`, which is what catches a mutation of the FINAL event — the
// in-chain prev_event_hash link cannot, because the last event has no successor carrying its
// hash. The in-memory twin had no anchor at all and verified the same corruption clean.
//
// Production is always SQLite (`caseBoxRuntime.ts` makes the twin a unit-test fallback), so
// this was never a user-data risk. It was a double that modelled a WEAKER corruption class
// than the store it stands in for: not merely incomplete, but wrong about a security
// invariant — and the trap would have sprung on whoever finally wrote this very test.

import { tamperStoredEvent } from "./internals.mjs";

/** Mutate the LAST stored event of each implementation, leaving each anchor untouched. */
function tamperLastEventBoth(inMem, sqlite, db, matterId) {
  const seq = db
    .prepare("SELECT MAX(sequence) AS s FROM case_box_audit_events WHERE matter_id = ?")
    .get(matterId).s;

  // In-memory: the existing module-private seam writes the event in place, so the anchor
  // recorded at append time is deliberately NOT updated — the state a real writer cannot
  // produce, which is exactly what a tamper is.
  tamperStoredEvent(inMem, matterId, seq, (e) => ({ ...e, actor_user_id: "MALLORY" }));

  // SQLite: the payload of record is event_json. The denormalised columns are indexes —
  // editing those changes nothing that is read or verified (checked; not a defect).
  const row = db
    .prepare("SELECT event_json FROM case_box_audit_events WHERE matter_id = ? AND sequence = ?")
    .get(matterId, seq);
  const obj = JSON.parse(row.event_json);
  obj.actor_user_id = "MALLORY";
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE matter_id = ? AND sequence = ?")
    .run(JSON.stringify(obj), matterId, seq);
  return seq;
}

test("impl-parity WI06: last-event tamper is rejected by BOTH impls, for the same reason", async () => {
  const { inMem, sqlite, db } = await buildPairChain();

  // Guard the fixture: if they already disagreed while clean, the comparison below proves
  // nothing about tampering.
  const cleanIm = await inMem.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  const cleanSq = await sqlite.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(cleanIm.ok, true, "fixture must start from a chain both accept");
  assert.equal(cleanSq.ok, true);

  tamperLastEventBoth(inMem, sqlite, db, DEFAULT_MATTER_ID);

  const im = await inMem.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  const sq = await sqlite.verifyAuditChainForMatter(DEFAULT_MATTER_ID);

  assert.equal(sq.ok, false, "SQLite must reject a tampered final event");
  assert.equal(im.ok, false, "and so must the twin — this is the divergence WI-06 closed");
  assert.equal(im.errorReason, sq.errorReason,
    "same corruption must produce the same errorReason, or parity is cosmetic");
  assert.equal(im.errorIndex, sq.errorIndex, "and the same errorIndex");
  assert.match(String(im.detail), /head-anchor mismatch/i,
    "the twin must say WHY, not merely fail");
});

test("impl-parity WI06: the head anchor is what does it — a clean chain still agrees after", async () => {
  // Guards against closing the gap by making the twin reject everything.
  const { inMem, sqlite } = await buildPairChain();
  const im = await inMem.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  const sq = await sqlite.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(im.ok, true, "a refuse-everything twin would pass the tamper case and fail here");
  assert.equal(sq.ok, true);
  assert.equal(im.headHash, sq.headHash);
});
