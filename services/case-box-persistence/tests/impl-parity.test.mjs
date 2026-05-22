// Impl-parity tests for case-box-persistence Phase B1 + B2 —
// matter + document scenarios per dev-memo/plan-case-box-persistence-B1-matter.md §1.3
// + dev-memo/plan-case-box-persistence-B2-document.md §1.5.
//
// Each test runs identical inputs against InMemory and Sqlite impls,
// then deep-compares the returned rows. Per umbrella plan §9 risk #1.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CaseBoxPersistenceError,
  InMemoryCaseBoxPersistence,
  openSqliteCaseBoxPersistence,
} from "../dist/index.js";
import {
  DEFAULT_MATTER_ID,
  makeClock,
  makeDocumentInput,
  makeIdGenerator,
  makeMatterInput,
} from "./conformance/fixtures.mjs";

const ISO = "2026-05-22T09:00:00.000Z";
const ID_PREFIX_INMEM = "parityim";
const ID_PREFIX_SQLITE = "paritysq";

function makePair() {
  const inMem = new InMemoryCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(ID_PREFIX_INMEM),
  });
  const { persistence: sqlite, db } = openSqliteCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(ID_PREFIX_SQLITE),
  });
  return { inMem, sqlite, db };
}

test("impl-parity B1.1: createMatter happy path returns identical matter row", async () => {
  const { inMem, sqlite } = makePair();
  const input = makeMatterInput();
  const im = await inMem.createMatter(input);
  const sq = await sqlite.createMatter(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B1.2: createMatter with all R-5(j) free-text fields", async () => {
  const { inMem, sqlite } = makePair();
  const input = makeMatterInput({
    case_type_text: "合同纠纷",
    case_progress_text: "first hearing 2026-07-15",
    court_contact_text: "Shanghai No.1 Intermediate Court",
    contention_summary_text: "breach vs force majeure",
  });
  const im = await inMem.createMatter(input);
  const sq = await sqlite.createMatter(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B1.3: createMatter with successor_matter_id (R5.2)", async () => {
  const { inMem, sqlite } = makePair();
  // Both impls need the successor matter first.
  const successorId = "01jcasemattermockid0000099";
  const successor = makeMatterInput({ id: successorId, matter_type: "litigation" });
  await inMem.createMatter(successor);
  await sqlite.createMatter(successor);
  const original = makeMatterInput({
    matter_type: "advisory",
    successor_matter_id: successorId,
  });
  const im = await inMem.createMatter(original);
  const sq = await sqlite.createMatter(original);
  assert.deepEqual(sq, im);
});

test("impl-parity B1.4: archiveMatter → getMatter round-trip", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  const imArch = await inMem.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const sqArch = await sqlite.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  assert.deepEqual(sqArch, imArch);
  const imGet = await inMem.getMatter(DEFAULT_MATTER_ID);
  const sqGet = await sqlite.getMatter(DEFAULT_MATTER_ID);
  assert.deepEqual(sqGet, imGet);
});

test("impl-parity B1.5: unarchiveMatter → getMatter round-trip", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  await sqlite.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const imUn = await inMem.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const sqUn = await sqlite.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  assert.deepEqual(sqUn, imUn);
});

test("impl-parity B1.6: createMatter rejects same way (duplicate_id) on both impls", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  let imErr, sqErr;
  try { await inMem.createMatter(makeMatterInput()); } catch (e) { imErr = e; }
  try { await sqlite.createMatter(makeMatterInput()); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "duplicate_id");
});

test("impl-parity B5.0: not_implemented surfaces uniformly on SQLite for non-B1..B5 methods", async () => {
  const { sqlite } = makePair();
  let err;
  try { await sqlite.appendFact({ id: "01jcasefactmockid0000000001" }); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.name, "CaseBoxPersistenceError");
  assert.equal(err.code, "not_implemented");
  assert.match(err.message, /appendFact/);
});

// ---------------------------------------------------------------------------
// B2 document parity tests (per B2 plan §1.5)
// ---------------------------------------------------------------------------

test("impl-parity B2.2: registerDocument happy path returns identical document row", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  const input = makeDocumentInput();
  const im = await inMem.registerDocument(DEFAULT_MATTER_ID, input);
  const sq = await sqlite.registerDocument(DEFAULT_MATTER_ID, input);
  assert.deepEqual(sq, im);
});

test("impl-parity B2.3: registerDocument with all R-5 fields (purpose + work_order_status + lifecycle)", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  const input = makeDocumentInput({
    purpose: "lawyer_letter",
    lifecycle_letter_date_text: "2026-05-20",
    lifecycle_service_status_text: "served by EMS, signed receipt",
    lifecycle_client_authorization_text: "verbal then written",
    lifecycle_preliminary_evidence_text: "exhibits A, B attached",
  });
  const im = await inMem.registerDocument(DEFAULT_MATTER_ID, input);
  const sq = await sqlite.registerDocument(DEFAULT_MATTER_ID, input);
  assert.deepEqual(sq, im);
});

test("impl-parity B2.4: registerDocument with R-6 asset fields (mime_type + byte_size + manual_extracted_text)", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  const input = makeDocumentInput({
    mime_type: "application/pdf",
    byte_size: 123456,
    manual_extracted_text: "manual transcription of the document text",
  });
  const im = await inMem.registerDocument(DEFAULT_MATTER_ID, input);
  const sq = await sqlite.registerDocument(DEFAULT_MATTER_ID, input);
  assert.deepEqual(sq, im);
});

test("impl-parity B2.5: registerDocument with supersedes_document_id (R-5(d))", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  const priorId = "01jcasedocmockid00000000pp";
  const priorInput = makeDocumentInput({ id: priorId });
  await inMem.registerDocument(DEFAULT_MATTER_ID, priorInput);
  await sqlite.registerDocument(DEFAULT_MATTER_ID, priorInput);
  const supersedingInput = makeDocumentInput({
    id: "01jcasedocmockid00000000ss",
    supersedes_document_id: priorId,
    received_at: "2026-05-22T10:00:00.000Z",
  });
  const im = await inMem.registerDocument(DEFAULT_MATTER_ID, supersedingInput);
  const sq = await sqlite.registerDocument(DEFAULT_MATTER_ID, supersedingInput);
  assert.deepEqual(sq, im);
});

test("impl-parity B2.6: getDocument round-trip preserves R-5 + R-6 fields", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  const input = makeDocumentInput({
    purpose: "lawyer_letter",
    mime_type: "image/jpeg",
    byte_size: 999000,
    lifecycle_letter_date_text: "2026-05-22",
    manual_extracted_text: "x".repeat(50000),
  });
  await inMem.registerDocument(DEFAULT_MATTER_ID, input);
  await sqlite.registerDocument(DEFAULT_MATTER_ID, input);
  const im = await inMem.getDocument(input.id);
  const sq = await sqlite.getDocument(input.id);
  assert.deepEqual(sq, im);
});

test("impl-parity B2.7: listDocuments empty matter", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  const query = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID };
  const im = await inMem.listDocuments(query);
  const sq = await sqlite.listDocuments(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B2.8: listDocuments multi-page byte-identical next_cursor across 3 pages", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  // Insert 5 documents at distinct received_at timestamps so the sort
  // is deterministic across both impls.
  for (let i = 0; i < 5; i++) {
    const input = makeDocumentInput({
      id: `01jcasedocmockid00000000${String(i).padStart(2, "0")}`,
      received_at: `2026-05-2${i}T09:00:00.000Z`,
    });
    await inMem.registerDocument(DEFAULT_MATTER_ID, input);
    await sqlite.registerDocument(DEFAULT_MATTER_ID, input);
  }
  // Page 1 of 2 (limit=2 → 3 pages of 2 + 1).
  const baseQuery = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, limit: 2 };
  let imPage = await inMem.listDocuments(baseQuery);
  let sqPage = await sqlite.listDocuments(baseQuery);
  assert.deepEqual(sqPage, imPage, "page 1 rows + next_cursor must match");
  assert.equal(typeof sqPage.next_cursor, "string");

  // Page 2 of 3.
  imPage = await inMem.listDocuments({ ...baseQuery, cursor: imPage.next_cursor });
  sqPage = await sqlite.listDocuments({ ...baseQuery, cursor: sqPage.next_cursor });
  assert.deepEqual(sqPage, imPage, "page 2 rows + next_cursor must match");

  // Page 3 of 3.
  imPage = await inMem.listDocuments({ ...baseQuery, cursor: imPage.next_cursor });
  sqPage = await sqlite.listDocuments({ ...baseQuery, cursor: sqPage.next_cursor });
  assert.deepEqual(sqPage, imPage, "page 3 rows + next_cursor (null) must match");
  assert.equal(sqPage.next_cursor, null);
});

test("impl-parity B2.9: listDocuments with status + doc_type filter", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const query = {
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    status: "registered",
    doc_type: "evidence",
  };
  const im = await inMem.listDocuments(query);
  const sq = await sqlite.listDocuments(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B2.10: listDocuments invalid-limit cases produce identical errors", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  const base = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID };
  for (const badLimit of [-1, 0, 999999, "5", 1.5]) {
    let imErr, sqErr;
    try { await inMem.listDocuments({ ...base, limit: badLimit }); } catch (e) { imErr = e; }
    try { await sqlite.listDocuments({ ...base, limit: badLimit }); } catch (e) { sqErr = e; }
    assert.ok(imErr instanceof CaseBoxPersistenceError, `inMem must reject limit=${badLimit}`);
    assert.ok(sqErr instanceof CaseBoxPersistenceError, `sqlite must reject limit=${badLimit}`);
    assert.equal(sqErr.code, imErr.code, `code must match for limit=${badLimit}`);
    assert.equal(sqErr.code, "invalid_argument");
  }
});

test("impl-parity B2.11: registerDocument rejects (tenant_mismatch) on both impls", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  const input = makeDocumentInput({ tenant_id: "tenant-other-v1" });
  let imErr, sqErr;
  try { await inMem.registerDocument(DEFAULT_MATTER_ID, input); } catch (e) { imErr = e; }
  try { await sqlite.registerDocument(DEFAULT_MATTER_ID, input); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "tenant_mismatch");
});

test("impl-parity B2.12: registerDocument rejects (unknown_matter) on both impls", async () => {
  const { inMem, sqlite } = makePair();
  // No matter created on either impl.
  const input = makeDocumentInput();
  let imErr, sqErr;
  try { await inMem.registerDocument(DEFAULT_MATTER_ID, input); } catch (e) { imErr = e; }
  try { await sqlite.registerDocument(DEFAULT_MATTER_ID, input); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "unknown_matter");
});

test("impl-parity B2.13: registerDocument rejects (duplicate_id) on both impls", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  let imErr, sqErr;
  try { await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput()); } catch (e) { imErr = e; }
  try { await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput()); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "duplicate_id");
});

// ---------------------------------------------------------------------------
// B3 audit-read parity tests (per B3 plan §1.6)
// ---------------------------------------------------------------------------

// For B3 audit-read parity: ids are embedded in audit events AND
// drive the audit-event hash. Both impls must use the SAME generator
// prefix so their event sequences hash identically (and listAuditEvents
// rows / verifyAuditChain headHash match deep-equal). Each impl still
// gets its OWN generator instance (separate counters), but with the
// same prefix → identical sequence outputs given identical call order.
const ID_PREFIX_SHARED = "paritysh";

function makeAuditPair() {
  const inMem = new InMemoryCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(ID_PREFIX_SHARED),
  });
  const { persistence: sqlite, db } = openSqliteCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(ID_PREFIX_SHARED),
  });
  return { inMem, sqlite, db };
}

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
// B4 confidentiality classification parity tests (per B4 plan §1.8)
// ---------------------------------------------------------------------------

async function buildPairWithDocument() {
  const { makeClassificationInput } = await import("./conformance/fixtures.mjs");
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  return { inMem, sqlite, db, makeClassificationInput };
}

test("impl-parity B4.1: appendConfidentialityClassification SET happy path", async () => {
  const { inMem, sqlite, makeClassificationInput } = await buildPairWithDocument();
  const input = makeClassificationInput();
  const im = await inMem.appendConfidentialityClassification(input);
  const sq = await sqlite.appendConfidentialityClassification(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B4.2: UPGRADED transition (normal → confidential)", async () => {
  const { inMem, sqlite, makeClassificationInput } = await buildPairWithDocument();
  await inMem.appendConfidentialityClassification(makeClassificationInput());
  await sqlite.appendConfidentialityClassification(makeClassificationInput());
  const upgrade = makeClassificationInput({
    id: "01jcaseclassmockid00000u01",
    level: "confidential",
    prior_level: "normal",
    set_at: "2026-05-21T10:00:00.000Z",
  });
  const im = await inMem.appendConfidentialityClassification(upgrade);
  const sq = await sqlite.appendConfidentialityClassification(upgrade);
  assert.deepEqual(sq, im);
});

test("impl-parity B4.3: DOWNGRADED with reason", async () => {
  const { inMem, sqlite, makeClassificationInput } = await buildPairWithDocument();
  await inMem.appendConfidentialityClassification(makeClassificationInput({ level: "confidential", prior_level: null }));
  await sqlite.appendConfidentialityClassification(makeClassificationInput({ level: "confidential", prior_level: null }));
  const downgrade = makeClassificationInput({
    id: "01jcaseclassmockid00000d01",
    level: "normal",
    prior_level: "confidential",
    change_reason_code: "change_in_legal_assessment",
    change_reason_text: "review complete",
    set_at: "2026-05-21T10:00:00.000Z",
  });
  const im = await inMem.appendConfidentialityClassification(downgrade);
  const sq = await sqlite.appendConfidentialityClassification(downgrade);
  assert.deepEqual(sq, im);
});

test("impl-parity B4.4: RESET_TO_UNCLASSIFIED with reason", async () => {
  const { inMem, sqlite, makeClassificationInput } = await buildPairWithDocument();
  await inMem.appendConfidentialityClassification(makeClassificationInput());
  await sqlite.appendConfidentialityClassification(makeClassificationInput());
  const reset = makeClassificationInput({
    id: "01jcaseclassmockid00000r01",
    level: "unclassified",
    prior_level: "normal",
    change_reason_code: "reset_to_unset",
    change_reason_text: "matter closed",
    set_at: "2026-05-21T10:00:00.000Z",
  });
  const im = await inMem.appendConfidentialityClassification(reset);
  const sq = await sqlite.appendConfidentialityClassification(reset);
  assert.deepEqual(sq, im);
});

test("impl-parity B4.5: getEffectiveClassification multi-row history identical", async () => {
  const { inMem, sqlite, makeClassificationInput } = await buildPairWithDocument();
  const { DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  await inMem.appendConfidentialityClassification(makeClassificationInput());
  await sqlite.appendConfidentialityClassification(makeClassificationInput());
  await inMem.appendConfidentialityClassification(makeClassificationInput({
    id: "01jcaseclassmockid00000u02",
    level: "confidential",
    prior_level: "normal",
    set_at: "2026-05-21T10:00:00.000Z",
  }));
  await sqlite.appendConfidentialityClassification(makeClassificationInput({
    id: "01jcaseclassmockid00000u02",
    level: "confidential",
    prior_level: "normal",
    set_at: "2026-05-21T10:00:00.000Z",
  }));
  const query = {
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    target_type: "document",
    target_id: DEFAULT_DOCUMENT_ID,
  };
  const im = await inMem.getEffectiveClassification(query);
  const sq = await sqlite.getEffectiveClassification(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B4.6: listConfidentialityClassifications byte-identical next_cursor across 2 pages", async () => {
  const { inMem, sqlite, makeClassificationInput } = await buildPairWithDocument();
  // 4 rows with distinct set_at.
  const overrides = [
    { id: "01jcaseclassmockid00000p01", level: "normal", prior_level: null, set_at: "2026-05-21T09:00:00.000Z" },
    { id: "01jcaseclassmockid00000p02", level: "confidential", prior_level: "normal", set_at: "2026-05-21T10:00:00.000Z" },
    { id: "01jcaseclassmockid00000p03", level: "normal", prior_level: "confidential", change_reason_code: "change_in_legal_assessment", change_reason_text: "ok", set_at: "2026-05-21T11:00:00.000Z" },
    { id: "01jcaseclassmockid00000p04", level: "unclassified", prior_level: "normal", change_reason_code: "reset_to_unset", change_reason_text: "ok", set_at: "2026-05-21T12:00:00.000Z" },
  ];
  for (const o of overrides) {
    await inMem.appendConfidentialityClassification(makeClassificationInput(o));
    await sqlite.appendConfidentialityClassification(makeClassificationInput(o));
  }
  const base = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, limit: 2 };
  let imPage = await inMem.listConfidentialityClassifications(base);
  let sqPage = await sqlite.listConfidentialityClassifications(base);
  assert.deepEqual(sqPage, imPage);
  assert.equal(typeof sqPage.next_cursor, "string");
  imPage = await inMem.listConfidentialityClassifications({ ...base, cursor: imPage.next_cursor });
  sqPage = await sqlite.listConfidentialityClassifications({ ...base, cursor: sqPage.next_cursor });
  assert.deepEqual(sqPage, imPage);
  assert.equal(sqPage.next_cursor, null);
});

test("impl-parity B4.7: rejection parity (cross-tenant, duplicate id, same-level)", async () => {
  const { inMem, sqlite, makeClassificationInput } = await buildPairWithDocument();
  // Cross-tenant.
  let imErr, sqErr;
  try { await inMem.appendConfidentialityClassification(makeClassificationInput({ tenant_id: "tenant-evil" })); } catch (e) { imErr = e; }
  try { await sqlite.appendConfidentialityClassification(makeClassificationInput({ tenant_id: "tenant-evil" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "tenant_mismatch");
  // Duplicate id.
  await inMem.appendConfidentialityClassification(makeClassificationInput());
  await sqlite.appendConfidentialityClassification(makeClassificationInput());
  imErr = undefined; sqErr = undefined;
  try { await inMem.appendConfidentialityClassification(makeClassificationInput()); } catch (e) { imErr = e; }
  try { await sqlite.appendConfidentialityClassification(makeClassificationInput()); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "duplicate_id");
});

test("impl-parity B4.8: same-set_at tiebreak parity (id ASC; smaller id wins)", async () => {
  const { inMem, sqlite, makeClassificationInput } = await buildPairWithDocument();
  const { DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  // Two classifications with identical set_at; id-ASC tiebreak: the
  // smaller id should appear LATER (more-latest is min id per the
  // centralized comparator's id ASC tiebreak: smaller id wins).
  const sharedSetAt = "2026-05-21T09:00:00.000Z";
  await inMem.appendConfidentialityClassification(makeClassificationInput({ id: "01jcaseclassmockid00000t02", level: "confidential", prior_level: null, set_at: sharedSetAt }));
  await sqlite.appendConfidentialityClassification(makeClassificationInput({ id: "01jcaseclassmockid00000t02", level: "confidential", prior_level: null, set_at: sharedSetAt }));
  await inMem.appendConfidentialityClassification(makeClassificationInput({ id: "01jcaseclassmockid00000t01", level: "highly_confidential", prior_level: "confidential", set_at: sharedSetAt }));
  await sqlite.appendConfidentialityClassification(makeClassificationInput({ id: "01jcaseclassmockid00000t01", level: "highly_confidential", prior_level: "confidential", set_at: sharedSetAt }));
  const query = {
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    target_type: "document",
    target_id: DEFAULT_DOCUMENT_ID,
  };
  const im = await inMem.getEffectiveClassification(query);
  const sq = await sqlite.getEffectiveClassification(query);
  assert.deepEqual(sq, im, "both impls must select same row via id ASC tiebreak");
});

// ---------------------------------------------------------------------------
// B5 privilege marker parity tests
// ---------------------------------------------------------------------------

async function buildPairWithDoc() {
  const { makePrivilegeMarkerInput } = await import("./conformance/fixtures.mjs");
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  return { inMem, sqlite, db, makePrivilegeMarkerInput };
}

test("impl-parity B5.1: appendPrivilegeMarker happy path identical", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  const input = makePrivilegeMarkerInput();
  const im = await inMem.appendPrivilegeMarker(input);
  const sq = await sqlite.appendPrivilegeMarker(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B5.2: transition proposed → confirmed identical", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  const { DEFAULT_PRIVILEGE_MARKER_ID } = await import("./conformance/fixtures.mjs");
  await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput());
  const opts = { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" };
  const im = await inMem.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, opts);
  const sq = await sqlite.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, opts);
  assert.deepEqual(sq, im);
});

test("impl-parity B5.3: transition proposed → dismissed identical (with reason)", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  const { DEFAULT_PRIVILEGE_MARKER_ID } = await import("./conformance/fixtures.mjs");
  await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput());
  const opts = { to: "dismissed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z", reason: "no privilege basis" };
  const im = await inMem.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, opts);
  const sq = await sqlite.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, opts);
  assert.deepEqual(sq, im);
});

test("impl-parity B5.4: getPrivilegeStatus on confirmed marker identical", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  const { DEFAULT_PRIVILEGE_MARKER_ID, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await inMem.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" });
  await sqlite.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" });
  const query = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, target_type: "document", target_id: DEFAULT_DOCUMENT_ID };
  const im = await inMem.getPrivilegeStatus(query);
  const sq = await sqlite.getPrivilegeStatus(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B5.5: listPrivilegeMarkers byte-identical next_cursor across 2 pages", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  const ids = ["01jcasemarkermockid0000a01", "01jcasemarkermockid0000a02", "01jcasemarkermockid0000a03", "01jcasemarkermockid0000a04"];
  const propsAt = ["2026-05-21T09:00:00.000Z", "2026-05-21T10:00:00.000Z", "2026-05-21T11:00:00.000Z", "2026-05-21T12:00:00.000Z"];
  for (let i = 0; i < 4; i++) {
    const m = makePrivilegeMarkerInput({ id: ids[i], proposed_at: propsAt[i], created_at: propsAt[i] });
    await inMem.appendPrivilegeMarker(m);
    await sqlite.appendPrivilegeMarker(m);
  }
  const base = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, limit: 2 };
  let imPage = await inMem.listPrivilegeMarkers(base);
  let sqPage = await sqlite.listPrivilegeMarkers(base);
  assert.deepEqual(sqPage, imPage);
  imPage = await inMem.listPrivilegeMarkers({ ...base, cursor: imPage.next_cursor });
  sqPage = await sqlite.listPrivilegeMarkers({ ...base, cursor: sqPage.next_cursor });
  assert.deepEqual(sqPage, imPage);
  assert.equal(sqPage.next_cursor, null);
});

test("impl-parity B5.6: rejection parity (cross-tenant, direct confirmed, unknown marker)", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  // Cross-tenant.
  let imErr, sqErr;
  try { await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput({ tenant_id: "tenant-evil" })); } catch (e) { imErr = e; }
  try { await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput({ tenant_id: "tenant-evil" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  // Direct confirmed.
  imErr = undefined; sqErr = undefined;
  try { await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput({ status: "confirmed", confirmed_actor_user_id: "lawyer", confirmed_at: "2026-05-21T10:00:00.000Z" })); } catch (e) { imErr = e; }
  try { await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput({ status: "confirmed", confirmed_actor_user_id: "lawyer", confirmed_at: "2026-05-21T10:00:00.000Z" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  // Unknown marker transition.
  imErr = undefined; sqErr = undefined;
  try { await inMem.transitionPrivilegeMarker("01jcasemarkermockid000nope", { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" }); } catch (e) { imErr = e; }
  try { await sqlite.transitionPrivilegeMarker("01jcasemarkermockid000nope", { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" }); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
});
