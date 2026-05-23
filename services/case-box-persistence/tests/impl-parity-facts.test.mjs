// Impl-parity B6 — fact scenarios. Split from former monolithic
// impl-parity.test.mjs per B7 plan §1.7 (closes B6 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MATTER_ID,
  makeDocumentInput,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

async function buildPairForFacts() {
  const { makeFactInput, DEFAULT_FACT_ID } = await import("./conformance/fixtures.mjs");
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  return { inMem, sqlite, db, makeFactInput, DEFAULT_FACT_ID };
}

test("impl-parity B6.1: appendFact happy path identical", async () => {
  const { inMem, sqlite, makeFactInput } = await buildPairForFacts();
  const input = makeFactInput();
  const im = await inMem.appendFact(input);
  const sq = await sqlite.appendFact(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B6.2: appendFact with R-5 purpose + as_of_date", async () => {
  const { inMem, sqlite, makeFactInput } = await buildPairForFacts();
  const input = makeFactInput({ purpose: "timeline_event", as_of_date: "2024-03-15" });
  const im = await inMem.appendFact(input);
  const sq = await sqlite.appendFact(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B6.3: transitionFact candidate → reviewed → accepted identical", async () => {
  const { inMem, sqlite, makeFactInput, DEFAULT_FACT_ID } = await buildPairForFacts();
  await inMem.appendFact(makeFactInput());
  await sqlite.appendFact(makeFactInput());
  const reviewedOpts = { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:30:00.000Z" };
  await inMem.transitionFact(DEFAULT_FACT_ID, reviewedOpts);
  await sqlite.transitionFact(DEFAULT_FACT_ID, reviewedOpts);
  const acceptOpts = { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T16:00:00.000Z" };
  const im = await inMem.transitionFact(DEFAULT_FACT_ID, acceptOpts);
  const sq = await sqlite.transitionFact(DEFAULT_FACT_ID, acceptOpts);
  assert.deepEqual(sq, im);
});

test("impl-parity B6.4: transitionFact candidate → rejected identical", async () => {
  const { inMem, sqlite, makeFactInput, DEFAULT_FACT_ID } = await buildPairForFacts();
  await inMem.appendFact(makeFactInput());
  await sqlite.appendFact(makeFactInput());
  const opts = { to: "rejected", reviewer_actor_user_id: "lawyer", at: "2026-05-21T16:00:00.000Z", rejection_reason: "not supported by evidence" };
  const im = await inMem.transitionFact(DEFAULT_FACT_ID, opts);
  const sq = await sqlite.transitionFact(DEFAULT_FACT_ID, opts);
  assert.deepEqual(sq, im);
});

test("impl-parity B6.5: accepted-fact supersession identical", async () => {
  const { inMem, sqlite, makeFactInput } = await buildPairForFacts();
  const factA = "01jcasefactmockid0000sup01";
  const factB = "01jcasefactmockid0000sup02";
  await inMem.appendFact(makeFactInput({ id: factA }));
  await sqlite.appendFact(makeFactInput({ id: factA }));
  await inMem.appendFact(makeFactInput({ id: factB }));
  await sqlite.appendFact(makeFactInput({ id: factB }));
  // Both: candidate → reviewed → accepted (direct candidate → accepted illegal).
  const reviewedOpts = { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:30:00.000Z" };
  await inMem.transitionFact(factA, reviewedOpts);
  await sqlite.transitionFact(factA, reviewedOpts);
  await inMem.transitionFact(factB, reviewedOpts);
  await sqlite.transitionFact(factB, reviewedOpts);
  const acceptOpts = { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T16:00:00.000Z" };
  await inMem.transitionFact(factA, acceptOpts);
  await sqlite.transitionFact(factA, acceptOpts);
  // factB accepts with supersedes_fact_id = factA.
  const supOpts = { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T17:00:00.000Z", supersedes_fact_id: factA };
  const im = await inMem.transitionFact(factB, supOpts);
  const sq = await sqlite.transitionFact(factB, supOpts);
  assert.deepEqual(sq, im);
});

test("impl-parity B6.6: getFact + listFacts identical", async () => {
  const { inMem, sqlite, makeFactInput, DEFAULT_FACT_ID } = await buildPairForFacts();
  await inMem.appendFact(makeFactInput());
  await sqlite.appendFact(makeFactInput());
  const getQuery = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, fact_id: DEFAULT_FACT_ID };
  const imGet = await inMem.getFact(getQuery);
  const sqGet = await sqlite.getFact(getQuery);
  assert.deepEqual(sqGet, imGet);
  const listQuery = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID };
  const imList = await inMem.listFacts(listQuery);
  const sqList = await sqlite.listFacts(listQuery);
  assert.deepEqual(sqList, imList);
});

test("impl-parity B6.7: listFacts 2-page cursor parity", async () => {
  const { inMem, sqlite, makeFactInput } = await buildPairForFacts();
  const ids = ["01jcasefactmockid00000pp01", "01jcasefactmockid00000pp02", "01jcasefactmockid00000pp03", "01jcasefactmockid00000pp04"];
  const createdAt = ["2026-05-21T09:00:00.000Z", "2026-05-21T10:00:00.000Z", "2026-05-21T11:00:00.000Z", "2026-05-21T12:00:00.000Z"];
  for (let i = 0; i < 4; i++) {
    const input = makeFactInput({ id: ids[i], created_at: createdAt[i] });
    await inMem.appendFact(input);
    await sqlite.appendFact(input);
  }
  const base = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, limit: 2 };
  let imPage = await inMem.listFacts(base);
  let sqPage = await sqlite.listFacts(base);
  assert.deepEqual(sqPage, imPage);
  imPage = await inMem.listFacts({ ...base, cursor: imPage.next_cursor });
  sqPage = await sqlite.listFacts({ ...base, cursor: sqPage.next_cursor });
  assert.deepEqual(sqPage, imPage);
  assert.equal(sqPage.next_cursor, null);
});

test("impl-parity B6.8: rejection parity (cross-tenant, unknown fact transition)", async () => {
  const { inMem, sqlite, makeFactInput } = await buildPairForFacts();
  // Cross-tenant.
  let imErr, sqErr;
  try { await inMem.appendFact(makeFactInput({ tenant_id: "tenant-evil" })); } catch (e) { imErr = e; }
  try { await sqlite.appendFact(makeFactInput({ tenant_id: "tenant-evil" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  // Unknown fact transition.
  imErr = undefined; sqErr = undefined;
  try { await inMem.transitionFact("01jcasefactmockid00000nope", { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T17:00:00.000Z" }); } catch (e) { imErr = e; }
  try { await sqlite.transitionFact("01jcasefactmockid00000nope", { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T17:00:00.000Z" }); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
});
