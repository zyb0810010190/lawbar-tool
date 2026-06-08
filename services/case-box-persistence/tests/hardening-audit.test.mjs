// Hardening: audit-chain invariants (B1/B2/B3). Split from former
// monolithic sqlite.hardening.test.mjs per B8 plan §1.7 (closes B7 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalAuditEventHashInput } from "case-box-contract";

import {
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
  openSqliteCaseBoxPersistence,
} from "./hardening-common.mjs";

// sha256-hex of an event's canonical input (mirrors persistence eventHashFn; for constructing legacy
// v1 / mixed rows directly in the DB to prove the contract's v1/v2 verification flows through SQLite).
const hashHex = (e) => createHash("sha256").update(canonicalAuditEventHashInput(e)).digest("hex");

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

// ---------------------------------------------------------------------------
// v2 audit-event-kind conformance (ADR audit-event-kind-preservation, WI-V2).
// TESTS ONLY — no persistence source / SQL migration / indexed column. The contract change flows
// through persistence via the live case-box-contract link (buildCaseBoxAuditEvent emits v2;
// verifyAuditChainForMatter reuses the contract verifier), so these prove the round-trip + verify.
// ---------------------------------------------------------------------------

test("Sqlite-v2: new audit events carry event_kind + audit_schema_version in event_json (NO SQL column)", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("v2rt"),
  });
  await persistence.createMatter(makeMatterInput());
  const e = JSON.parse(
    db.prepare("SELECT event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC LIMIT 1")
      .get(DEFAULT_MATTER_ID).event_json,
  );
  assert.equal(e.event_kind, "MATTER_REGISTERED");
  assert.equal(e.audit_schema_version, 2);
  // The two fields ride event_json ONLY — no dedicated column was added (i.e. no migration).
  const cols = db.prepare("PRAGMA table_info(case_box_audit_events)").all().map((c) => c.name);
  assert.equal(cols.includes("event_kind"), false);
  assert.equal(cols.includes("audit_schema_version"), false);
  // round-trips through the read API too.
  const page = await persistence.listAuditEvents({ tenant_id: e.tenant_id, matter_id: DEFAULT_MATTER_ID });
  assert.equal(page.rows[0].event_kind, "MATTER_REGISTERED");
  assert.equal(page.rows[0].audit_schema_version, 2);
  db.close();
});

test("Sqlite-v2: a v2 audit chain (createMatter + archiveMatter) verifies", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("v2ok");
  const v = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(v.ok, true);
  assert.equal(v.verifiedCount, 2);
  db.close();
});

test("Sqlite-v2: tampering event_kind on a persisted v2 row breaks verifyAuditChainForMatter", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("v2tamp");
  const firstRow = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC LIMIT 1")
    .get(DEFAULT_MATTER_ID);
  const e = JSON.parse(firstRow.event_json); // v2 MATTER_REGISTERED (create/matter)
  e.event_kind = "DEADLINE_MET"; // declares {update, deadline} — inconsistent with this event
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?").run(JSON.stringify(e), firstRow.event_id);
  const v = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(v.ok, false);
  assert.equal(v.errorReason, "event_kind_inconsistent");
  assert.equal(v.errorIndex, 0);
  db.close();
});

test("Sqlite-v2: a SAME-class event_kind tamper (hashed) is caught via prev_event_hash_mismatch", async () => {
  // The load-bearing property through persistence: event_kind is HASHED, so a mutation WITHIN one
  // {action, entity_type, reasonRequired} class (which passes the consistency check) still breaks the
  // chain. MATTER_ARCHIVED and MATTER_UNARCHIVED are both {update, matter, reasonRequired:false}.
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("v2hash"),
  });
  await persistence.createMatter(makeMatterInput()); // seq1 MATTER_REGISTERED
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" }); // seq2 MATTER_ARCHIVED
  await persistence.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" }); // seq3 MATTER_UNARCHIVED
  const mid = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC LIMIT 1 OFFSET 1")
    .get(DEFAULT_MATTER_ID);
  const e = JSON.parse(mid.event_json);
  assert.equal(e.event_kind, "MATTER_ARCHIVED");
  e.event_kind = "MATTER_UNARCHIVED"; // same {update, matter} → consistency passes; but event_kind is hashed
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?").run(JSON.stringify(e), mid.event_id);
  const v = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(v.ok, false);
  assert.equal(v.errorReason, "prev_event_hash_mismatch"); // hashed event_kind change breaks the link to seq3
  assert.equal(v.errorIndex, 2);
  db.close();
});

test("Sqlite-v2: a legacy v1 audit row (no event_kind/version) still verifies", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("v1legacy"),
  });
  await persistence.createMatter(makeMatterInput()); // 1 v2 event
  const row = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC LIMIT 1")
    .get(DEFAULT_MATTER_ID);
  const e = JSON.parse(row.event_json);
  delete e.event_kind; // downgrade to a legacy v1 row (the only/last event)
  delete e.audit_schema_version;
  const h = hashHex(e); // v1 canonicalization
  db.prepare("UPDATE case_box_audit_events SET event_json = ?, event_hash = ? WHERE event_id = ?").run(JSON.stringify(e), h, row.event_id);
  db.prepare("UPDATE case_box_audit_chain_heads SET head_hash = ? WHERE matter_id = ?").run(h, DEFAULT_MATTER_ID);
  const v = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(v.ok, true);
  assert.equal(v.verifiedCount, 1);
  db.close();
});

test("Sqlite-v2: a mixed v1->v2 chain verifies end-to-end through persistence", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("v1v2mix");
  const rows = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC")
    .all(DEFAULT_MATTER_ID);
  // event[0]: downgrade to legacy v1.
  const e1 = JSON.parse(rows[0].event_json);
  delete e1.event_kind;
  delete e1.audit_schema_version;
  const h1 = hashHex(e1);
  db.prepare("UPDATE case_box_audit_events SET event_json = ?, event_hash = ? WHERE event_id = ?").run(JSON.stringify(e1), h1, rows[0].event_id);
  // event[1]: stays v2; re-link prev_event_hash to the new v1 head and recompute its hash.
  const e2 = JSON.parse(rows[1].event_json);
  e2.prev_event_hash = h1;
  const h2 = hashHex(e2);
  db.prepare("UPDATE case_box_audit_events SET event_json = ?, event_hash = ? WHERE event_id = ?").run(JSON.stringify(e2), h2, rows[1].event_id);
  db.prepare("UPDATE case_box_audit_chain_heads SET head_hash = ?, last_event_id = ? WHERE matter_id = ?").run(h2, e2.id, DEFAULT_MATTER_ID);
  const v = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(v.ok, true);
  assert.equal(v.verifiedCount, 2);
  db.close();
});
