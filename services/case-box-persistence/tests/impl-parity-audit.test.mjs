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
