// Impl-parity B10 — read-side aggregation scenarios. Per B10 plan §1.4.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DOCUMENT_ID,
  DEFAULT_MATTER_ID,
  makeDocumentInput,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

async function buildPair() {
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  return { inMem, sqlite, db };
}

test("impl-parity B10.1: listMatters DESC happy path identical", async () => {
  const { inMem, sqlite } = await buildPair();
  // Add 2nd matter with later created_at; both impls use shared clock.
  const otherMatterId = "01jcasemattermockid00other";
  await inMem.createMatter(makeMatterInput({ id: otherMatterId }));
  await sqlite.createMatter(makeMatterInput({ id: otherMatterId }));
  const query = { tenant_id: "tenant-local-v1" };
  const im = await inMem.listMatters(query);
  const sq = await sqlite.listMatters(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B10.2: getMatterSummary deep-equal across both impls", async () => {
  const { inMem, sqlite } = await buildPair();
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const query = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID };
  const im = await inMem.getMatterSummary(query);
  const sq = await sqlite.getMatterSummary(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B10.3: getDocumentDetail deep-equal (with ocr_link + classification + privilege + fact_candidates)", async () => {
  const { makeOcrLinkInput, makeClassificationInput, makePrivilegeMarkerInput, makeFactInput } = await import("./conformance/fixtures.mjs");
  const { inMem, sqlite } = await buildPair();
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await inMem.upsertOcrLink(makeOcrLinkInput());
  await sqlite.upsertOcrLink(makeOcrLinkInput());
  await inMem.appendConfidentialityClassification(makeClassificationInput());
  await sqlite.appendConfidentialityClassification(makeClassificationInput());
  await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await inMem.appendFact(makeFactInput({ source_document_id: DEFAULT_DOCUMENT_ID }));
  await sqlite.appendFact(makeFactInput({ source_document_id: DEFAULT_DOCUMENT_ID }));
  const query = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, document_id: DEFAULT_DOCUMENT_ID };
  const im = await inMem.getDocumentDetail(query);
  const sq = await sqlite.getDocumentDetail(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B10.4: getDeadlineCalendar deep-equal with from/to range", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { inMem, sqlite } = await buildPair();
  await inMem.appendDocketEntry(makeDocketEntryInput());
  await sqlite.appendDocketEntry(makeDocketEntryInput());
  const confirmOpts = {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  };
  await inMem.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, confirmOpts);
  await sqlite.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, confirmOpts);
  const query = {
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    from: "2026-01-01T00:00:00.000Z",
    to: "2027-01-01T00:00:00.000Z",
  };
  const im = await inMem.getDeadlineCalendar(query);
  const sq = await sqlite.getDeadlineCalendar(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B10.5: getFactSupersessionChain deep-equal walk order", async () => {
  const { makeFactInput } = await import("./conformance/fixtures.mjs");
  const { inMem, sqlite } = await buildPair();
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const factA = "01jcasefactmockid00chain01";
  const factB = "01jcasefactmockid00chain02";
  for (const id of [factA, factB]) {
    await inMem.appendFact(makeFactInput({ id }));
    await sqlite.appendFact(makeFactInput({ id }));
    await inMem.transitionFact(id, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T10:00:00.000Z" });
    await sqlite.transitionFact(id, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T10:00:00.000Z" });
  }
  await inMem.transitionFact(factA, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" });
  await sqlite.transitionFact(factA, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" });
  const acceptB = { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T12:00:00.000Z", supersedes_fact_id: factA };
  await inMem.transitionFact(factB, acceptB);
  await sqlite.transitionFact(factB, acceptB);
  const query = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, fact_id: factB };
  const im = await inMem.getFactSupersessionChain(query);
  const sq = await sqlite.getFactSupersessionChain(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B10.6: rejection / null parity (unknown matter, cross-tenant matter)", async () => {
  const { inMem, sqlite } = await buildPair();
  // Unknown matter on getMatterSummary → null on both.
  const unknown = { tenant_id: "tenant-local-v1", matter_id: "01jcasemattermockid00nope0" };
  const imNull = await inMem.getMatterSummary(unknown);
  const sqNull = await sqlite.getMatterSummary(unknown);
  assert.equal(sqNull, imNull);
  assert.equal(sqNull, null);
  // Cross-tenant existing matter on getMatterSummary → throw tenant_mismatch on both.
  let imErr, sqErr;
  try { await inMem.getMatterSummary({ tenant_id: "tenant-evil", matter_id: DEFAULT_MATTER_ID }); } catch (e) { imErr = e; }
  try { await sqlite.getMatterSummary({ tenant_id: "tenant-evil", matter_id: DEFAULT_MATTER_ID }); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "tenant_mismatch");
});
