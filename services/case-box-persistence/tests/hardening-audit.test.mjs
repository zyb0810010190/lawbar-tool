// Hardening: audit-chain invariants (B1/B2/B3). Split from former
// monolithic sqlite.hardening.test.mjs per B8 plan §1.7 (closes B7 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
  openSqliteCaseBoxPersistence,
} from "./hardening-common.mjs";

test("Sqlite-B1: audit-chain-head invariant after createMatter (event_count == COUNT(*) == MAX(sequence))", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("hard1"),
  });
  await persistence.createMatter(makeMatterInput());
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 1);
  assert.equal(count.c, 1);
  assert.equal(maxSeq.m, 1);
  db.close();
});

test("Sqlite-B2: audit-chain-head invariant after createMatter + registerDocument + archiveMatter (3 events)", async () => {
  const { makeDocumentInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("hard3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 3, "event_count must match committed event count");
  assert.equal(count.c, 3, "COUNT(*) must match committed event count");
  assert.equal(maxSeq.m, 3, "MAX(sequence) must match committed event count");
  db.close();
});

test("Sqlite-B1: audit-chain-head invariant after archive + unarchive (3 events)", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("hard2"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  await persistence.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 3, "event_count must match committed event count");
  assert.equal(count.c, 3, "COUNT(*) must match committed event count");
  assert.equal(maxSeq.m, 3, "MAX(sequence) must match committed event count");
  db.close();
});

// ---------------------------------------------------------------------------
// B3 audit-chain tamper detection (per B3 plan §1.5 invariants 1, 1b, 2, 3)
// ---------------------------------------------------------------------------

async function buildChainWithTwoEvents(idPrefix) {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator(idPrefix),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  return { persistence, db };
}

test("Sqlite-B3: verifyAuditChainForMatter detects mutated event_json payload (non-final event)", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("tamp1");
  const firstRow = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC LIMIT 1")
    .get(DEFAULT_MATTER_ID);
  const parsed = JSON.parse(firstRow.event_json);
  parsed.actor_user_id = "tampered-user";
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?").run(JSON.stringify(parsed), firstRow.event_id);
  const reread = db.prepare("SELECT event_json FROM case_box_audit_events WHERE event_id = ?").get(firstRow.event_id);
  assert.notEqual(reread.event_json, firstRow.event_json);
  const result = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(result.ok, false);
  assert.equal(result.errorReason, "prev_event_hash_mismatch");
  assert.equal(result.errorIndex, 1);
  db.close();
});

test("Sqlite-B3: verifyAuditChainForMatter detects last-event tampering via head-anchor mismatch", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("tamp1b");
  const lastRow = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence DESC LIMIT 1")
    .get(DEFAULT_MATTER_ID);
  const parsed = JSON.parse(lastRow.event_json);
  parsed.actor_user_id = "tampered-user";
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?").run(JSON.stringify(parsed), lastRow.event_id);
  const result = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(result.ok, false);
  assert.equal(result.errorReason, "prev_event_hash_mismatch");
  assert.match(result.detail, /head-anchor mismatch/);
  db.close();
});

test("Sqlite-B3: verifyAuditChainForMatter detects broken prev_event_hash", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("tamp2");
  const secondRow = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence DESC LIMIT 1")
    .get(DEFAULT_MATTER_ID);
  const parsed = JSON.parse(secondRow.event_json);
  parsed.prev_event_hash = "0".repeat(64);
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?").run(JSON.stringify(parsed), secondRow.event_id);
  const result = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(result.ok, false);
  assert.equal(result.errorReason, "prev_event_hash_mismatch");
  assert.equal(result.errorIndex, 1);
  db.close();
});

test("Sqlite-B3: verifyAuditChainForMatter detects wrong tenant_id mid-chain", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("tamp3");
  const secondRow = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence DESC LIMIT 1")
    .get(DEFAULT_MATTER_ID);
  const parsed = JSON.parse(secondRow.event_json);
  parsed.tenant_id = "tenant-evil";
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?").run(JSON.stringify(parsed), secondRow.event_id);
  const result = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(result.ok, false);
  assert.equal(result.errorReason, "tenant_id_mismatch");
  assert.equal(result.errorIndex, 1);
  db.close();
});

test("Sqlite-B3: event_count invariant after createMatter + registerDocument + archiveMatter + unarchiveMatter (4 events)", async () => {
  const { makeDocumentInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("inv4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  await persistence.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 4);
  assert.equal(count.c, 4);
  assert.equal(maxSeq.m, 4);
  db.close();
});
