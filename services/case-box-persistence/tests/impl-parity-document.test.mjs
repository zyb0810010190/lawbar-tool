// Impl-parity B2 — document scenarios. Split from former monolithic
// impl-parity.test.mjs per B7 plan §1.7 (closes B6 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";

import { CaseBoxPersistenceError } from "../dist/index.js";
import {
  DEFAULT_MATTER_ID,
  makeDocumentInput,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makePair } from "./impl-parity-common.mjs";

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
