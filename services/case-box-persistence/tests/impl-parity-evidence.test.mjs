// Impl-parity B8 — evidence-item scenarios. Per B8 plan §1.6.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EVIDENCE_ID,
  DEFAULT_MATTER_ID,
  makeDocumentInput,
  makeEvidenceItemInput,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

async function buildPairForEvidence() {
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  return { inMem, sqlite, db };
}

test("impl-parity B8.1: appendEvidenceItem happy path identical", async () => {
  const { inMem, sqlite } = await buildPairForEvidence();
  const input = makeEvidenceItemInput();
  const im = await inMem.appendEvidenceItem(input);
  const sq = await sqlite.appendEvidenceItem(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B8.2: appendEvidenceItem with party_side + source_document_id identical", async () => {
  const { inMem, sqlite } = await buildPairForEvidence();
  const { DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const input = makeEvidenceItemInput({ party_side: "our", source_document_id: DEFAULT_DOCUMENT_ID });
  const im = await inMem.appendEvidenceItem(input);
  const sq = await sqlite.appendEvidenceItem(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B8.3: transitionEvidenceItem proposed → accepted identical", async () => {
  const { inMem, sqlite } = await buildPairForEvidence();
  await inMem.appendEvidenceItem(makeEvidenceItemInput());
  await sqlite.appendEvidenceItem(makeEvidenceItemInput());
  const opts = { to: "accepted", actor_user_id: "lawyer" };
  const im = await inMem.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, opts);
  const sq = await sqlite.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, opts);
  assert.deepEqual(sq, im);
});

test("impl-parity B8.4: transitionEvidenceItem proposed → rejected identical", async () => {
  const { inMem, sqlite } = await buildPairForEvidence();
  await inMem.appendEvidenceItem(makeEvidenceItemInput());
  await sqlite.appendEvidenceItem(makeEvidenceItemInput());
  const opts = { to: "rejected", actor_user_id: "lawyer" };
  const im = await inMem.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, opts);
  const sq = await sqlite.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, opts);
  assert.deepEqual(sq, im);
});

test("impl-parity B8.5: transitionEvidenceItem accepted → superseded with replacement_evidence_id identical", async () => {
  const { inMem, sqlite } = await buildPairForEvidence();
  const evidenceB = "01jcaseevidmockid000000bb1";
  await inMem.appendEvidenceItem(makeEvidenceItemInput());
  await sqlite.appendEvidenceItem(makeEvidenceItemInput());
  await inMem.appendEvidenceItem(makeEvidenceItemInput({ id: evidenceB }));
  await sqlite.appendEvidenceItem(makeEvidenceItemInput({ id: evidenceB }));
  await inMem.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer" });
  await sqlite.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer" });
  const supOpts = { to: "superseded", actor_user_id: "lawyer", replacement_evidence_id: evidenceB };
  const im = await inMem.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, supOpts);
  const sq = await sqlite.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, supOpts);
  assert.deepEqual(sq, im);
  // Lifted row column populated from opts.replacement_evidence_id (per B8 plan §1.4).
  assert.equal(sq.supersedes_evidence_id, evidenceB);
});

test("impl-parity B8.6: getEvidenceItem + listEvidenceItems + rejection parity", async () => {
  const { inMem, sqlite } = await buildPairForEvidence();
  await inMem.appendEvidenceItem(makeEvidenceItemInput());
  await sqlite.appendEvidenceItem(makeEvidenceItemInput());
  const getQuery = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, evidence_id: DEFAULT_EVIDENCE_ID };
  const imGet = await inMem.getEvidenceItem(getQuery);
  const sqGet = await sqlite.getEvidenceItem(getQuery);
  assert.deepEqual(sqGet, imGet);
  // 2-page cursor parity.
  const ids = ["01jcaseevidmockid00000pp01", "01jcaseevidmockid00000pp02", "01jcaseevidmockid00000pp03", "01jcaseevidmockid00000pp04"];
  const createdAt = ["2026-05-21T09:00:00.000Z", "2026-05-21T10:00:00.000Z", "2026-05-21T11:00:00.000Z", "2026-05-21T12:00:00.000Z"];
  for (let i = 0; i < 4; i++) {
    const input = makeEvidenceItemInput({ id: ids[i], created_at: createdAt[i] });
    await inMem.appendEvidenceItem(input);
    await sqlite.appendEvidenceItem(input);
  }
  const base = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, limit: 2 };
  let imPage = await inMem.listEvidenceItems(base);
  let sqPage = await sqlite.listEvidenceItems(base);
  assert.deepEqual(sqPage, imPage);
  imPage = await inMem.listEvidenceItems({ ...base, cursor: imPage.next_cursor });
  sqPage = await sqlite.listEvidenceItems({ ...base, cursor: sqPage.next_cursor });
  assert.deepEqual(sqPage, imPage);
  // Rejection parity (cross-tenant, unknown evidenceId transition).
  let imErr, sqErr;
  try { await inMem.appendEvidenceItem(makeEvidenceItemInput({ id: "01jcaseevidmockid00000evil", tenant_id: "tenant-evil" })); } catch (e) { imErr = e; }
  try { await sqlite.appendEvidenceItem(makeEvidenceItemInput({ id: "01jcaseevidmockid00000evil", tenant_id: "tenant-evil" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  imErr = undefined; sqErr = undefined;
  const unknownOpts = { to: "accepted", actor_user_id: "lawyer" };
  try { await inMem.transitionEvidenceItem("01jcaseevidmockid00000nope", unknownOpts); } catch (e) { imErr = e; }
  try { await sqlite.transitionEvidenceItem("01jcaseevidmockid00000nope", unknownOpts); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
});
