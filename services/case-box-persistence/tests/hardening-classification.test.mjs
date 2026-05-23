// Hardening: B4 confidentiality classification invariants. Split from
// former monolithic sqlite.hardening.test.mjs per B8 plan §1.7
// (closes B7 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CaseBoxPersistenceError,
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
  openSqliteCaseBoxPersistence,
} from "./hardening-common.mjs";

test("Sqlite-B4: appendConfidentialityClassification rejects cross-tenant target", async () => {
  const { makeDocumentInput, makeClassificationInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("conf1"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  let err;
  try {
    await persistence.appendConfidentialityClassification(makeClassificationInput({ tenant_id: "tenant-evil" }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "tenant_mismatch");
});

test("Sqlite-B4: append-only history preserved across 5 sequential classifications", async () => {
  const { makeDocumentInput, makeClassificationInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("conf2"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const seq = [
    { id: "01jcaseclassmockid00000a01", level: "normal", prior_level: null, change_reason_code: null, change_reason_text: null, set_at: "2026-05-21T09:00:00.000Z" },
    { id: "01jcaseclassmockid00000a02", level: "confidential", prior_level: "normal", change_reason_code: null, change_reason_text: null, set_at: "2026-05-21T10:00:00.000Z" },
    { id: "01jcaseclassmockid00000a03", level: "normal", prior_level: "confidential", change_reason_code: "change_in_legal_assessment", change_reason_text: "review complete", set_at: "2026-05-21T11:00:00.000Z" },
    { id: "01jcaseclassmockid00000a04", level: "unclassified", prior_level: "normal", change_reason_code: "reset_to_unset", change_reason_text: "matter closed phase", set_at: "2026-05-21T12:00:00.000Z" },
    { id: "01jcaseclassmockid00000a05", level: "normal", prior_level: "unclassified", change_reason_code: null, change_reason_text: null, set_at: "2026-05-21T13:00:00.000Z" },
  ];
  for (const overrides of seq) {
    await persistence.appendConfidentialityClassification(makeClassificationInput(overrides));
  }
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_confidentiality_classifications WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(count.c, 5);
  const eff = await persistence.getEffectiveClassification({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    target_type: "document",
    target_id: DEFAULT_DOCUMENT_ID,
  });
  assert.equal(eff.history.length, 5);
});

test("Sqlite-B4: appendConfidentialityClassification downgrade without reason → invalid_payload", async () => {
  const { makeDocumentInput, makeClassificationInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("conf3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendConfidentialityClassification(makeClassificationInput({
    id: "01jcaseclassmockid00000d01",
    level: "confidential",
    prior_level: null,
  }));
  let err;
  try {
    await persistence.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockid00000d02",
      level: "normal",
      prior_level: "confidential",
      change_reason_code: null,
      set_at: "2026-05-21T10:00:00.000Z",
    }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "invalid_payload");
});

test("Sqlite-B4: getEffectiveClassification deny-by-default for target with no history", async () => {
  const { makeDocumentInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("conf4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const eff = await persistence.getEffectiveClassification({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    target_type: "document",
    target_id: DEFAULT_DOCUMENT_ID,
  });
  assert.equal(eff.effectiveLevel, "unclassified");
  assert.deepEqual(eff.history, []);
});

test("Sqlite-B4: audit-chain atomic update after appendConfidentialityClassification (event_count == COUNT == MAX(seq) == 3)", async () => {
  const { makeDocumentInput, makeClassificationInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("conf5"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendConfidentialityClassification(makeClassificationInput());
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 3);
  assert.equal(count.c, 3);
  assert.equal(maxSeq.m, 3);
});
