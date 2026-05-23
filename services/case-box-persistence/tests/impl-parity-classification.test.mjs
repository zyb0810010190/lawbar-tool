// Impl-parity B4 — confidentiality classification scenarios. Split
// from former monolithic impl-parity.test.mjs per B7 plan §1.7
// (closes B6 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MATTER_ID,
  makeDocumentInput,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

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
