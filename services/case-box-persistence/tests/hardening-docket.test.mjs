// Hardening: B7 docket entries + deadline materialization invariants
// (per B7 plan §1.6). Split from former monolithic sqlite.hardening.test.mjs
// per B8 plan §1.7 (closes B7 D4#1).

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

test("Sqlite-B7: appendDocketEntry rejects cross-tenant", async () => {
  const { makeDocketEntryInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("d1"),
  });
  await persistence.createMatter(makeMatterInput());
  let err;
  try {
    await persistence.appendDocketEntry(makeDocketEntryInput({ tenant_id: "tenant-evil" }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "tenant_mismatch");
});

test("Sqlite-B7: Mode B confirmDocketEntry MANDATORY crash-injection rolls back domain + audit", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("d2"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  const preHead = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const preEvents = db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const preEntry = db.prepare("SELECT confirmation_state FROM case_box_docket_entries WHERE id = ?").get(DEFAULT_DOCKET_ENTRY_ID);
  process.env.CASE_BOX_B7_CRASH_AFTER = "after_docket_update";
  let err;
  try {
    await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
  } catch (e) { err = e; } finally {
    delete process.env.CASE_BOX_B7_CRASH_AFTER;
  }
  assert.ok(err);
  assert.match(err.message, /crash-injection/);
  const postEntry = db.prepare("SELECT confirmation_state FROM case_box_docket_entries WHERE id = ?").get(DEFAULT_DOCKET_ENTRY_ID);
  assert.equal(postEntry.confirmation_state, preEntry.confirmation_state, "docket entry must NOT mutate after crash");
  assert.equal(postEntry.confirmation_state, "proposed");
  const deadlineCount = db.prepare("SELECT COUNT(*) AS c FROM case_box_deadlines WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(deadlineCount.c, 0, "no deadline row may exist after crash");
  const postHead = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const postEvents = db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(postHead.event_count, preHead.event_count, "audit chain head event_count must NOT advance after crash");
  assert.equal(postEvents.c, preEvents.c, "audit event count must NOT advance after crash");
});

test("Sqlite-B7: Mode B confirmDocketEntry idempotent replay (no new audit on second call)", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("d3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  const confirmOpts = {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  };
  const first = await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, confirmOpts);
  const headAfterFirst = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(first.idempotent, false);
  const second = await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, confirmOpts);
  assert.equal(second.idempotent, true);
  assert.deepEqual(second.entry, first.entry);
  assert.deepEqual(second.deadline, first.deadline);
  const headAfterSecond = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(headAfterSecond.event_count, headAfterFirst.event_count, "idempotent replay must NOT advance event_count");
});

test("Sqlite-B7: audit-chain atomic event_count == 4 after createMatter + appendDocketEntry + confirmDocketEntry (Mode B emits 2 events)", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("d4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  });
  const head = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const count = db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const maxSeq = db.prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 4);
  assert.equal(count.c, 4);
  assert.equal(maxSeq.m, 4);
});

test("Sqlite-B7: deadline UPDATE-in-place on transition (single row; status reflects transition)", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("d5"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  });
  await persistence.transitionDeadline(DEFAULT_DEADLINE_ID, {
    actor_user_id: "lawyer",
    at: "2026-06-15T17:00:00.000Z",
    to: "met",
  });
  const rows = db.prepare("SELECT status FROM case_box_deadlines WHERE matter_id = ?").all(DEFAULT_MATTER_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "met");
});

test("Sqlite-B7: source_docket_entry_id derived from entry.id (NOT payload_json)", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("d6"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  });
  const row = db.prepare("SELECT source_docket_entry_id, payload_json FROM case_box_deadlines WHERE id = ?").get(DEFAULT_DEADLINE_ID);
  assert.equal(row.source_docket_entry_id, DEFAULT_DOCKET_ENTRY_ID);
  const parsed = JSON.parse(row.payload_json);
  assert.equal(parsed.source_docket_entry_id, undefined, "deadline payload_json must NOT carry source_docket_entry_id (lifted column only)");
});

test("Sqlite-B7: listDocketEntries filter parity (confirmation_state filter)", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("d7"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  const proposedOnly = await persistence.listDocketEntries({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    confirmation_state: "proposed",
  });
  assert.equal(proposedOnly.rows.length, 1);
  await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  });
  const stillProposed = await persistence.listDocketEntries({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    confirmation_state: "proposed",
  });
  assert.equal(stillProposed.rows.length, 0, "post-confirm: zero proposed rows");
  const confirmed = await persistence.listDocketEntries({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    confirmation_state: "confirmed",
  });
  assert.equal(confirmed.rows.length, 1);
});

test("Sqlite-B7: Mode B confirmDocketEntry cross-matter duplicate deadline_id → duplicate_id (NOT raw SQLite PK error)", async () => {
  // Audit fix per B7 reviewer M D1#1: cross-matter duplicate deadline_id
  // must surface as the contract's duplicate_id error, not as a raw
  // SQLITE_CONSTRAINT_PRIMARYKEY. Achieved by SqliteBackedIdSet on the
  // confirm shadow's deadlineIds (global PK existence check).
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("d8"),
  });
  const otherMatter = "01jcasemattermockid00other";
  const otherDocketEntry = "01jcasedockmockid00000othr";
  await persistence.createMatter(makeMatterInput());
  await persistence.createMatter(makeMatterInput({ id: otherMatter }));
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  });
  await persistence.appendDocketEntry(makeDocketEntryInput({ id: otherDocketEntry, matter_id: otherMatter }));
  let err;
  try {
    await persistence.confirmDocketEntry(otherDocketEntry, {
      confirmation_actor_user_id: "lawyer",
      confirmed_at: "2026-05-21T22:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "duplicate_id");
});

// ---------------------------------------------------------------------------
// WI-DPE3 — editDocketEntry persistence invariants
// ---------------------------------------------------------------------------

test("Sqlite-DPE3: editDocketEntry audit chain event_count == 3 == COUNT == MAX(sequence)", async () => {
  const { makeDocketEntryInput, makeEditDocketEntryOpts } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("e1"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.editDocketEntry(makeEditDocketEntryOpts());
  const head = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 3); // MATTER_REGISTERED + DOCKET_ENTRY_PROPOSED + DOCKET_ENTRY_REVISED
  const agg = db.prepare("SELECT COUNT(*) c, MAX(sequence) m FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(agg.c, 3);
  assert.equal(agg.m, 3);
  const last = db.prepare("SELECT event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence DESC LIMIT 1").get(DEFAULT_MATTER_ID);
  const lastEvent = JSON.parse(last.event_json);
  assert.equal(lastEvent.event_kind, "DOCKET_ENTRY_REVISED");
  assert.equal(lastEvent.action, "update");
  assert.equal(lastEvent.entity_type, "docket_entry");
  const ver = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(ver.ok, true);
});

test("Sqlite-DPE3: edit keeps lifted proposed_kind === payload_json.proposed_kind; state stays proposed", async () => {
  const { makeDocketEntryInput, makeEditDocketEntryOpts, DEFAULT_DOCKET_ENTRY_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("e2"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.editDocketEntry(makeEditDocketEntryOpts({ proposed_kind: "hearing" }));
  const row = db.prepare(
    "SELECT proposed_kind, confirmation_state, payload_json FROM case_box_docket_entries WHERE id = ?",
  ).get(DEFAULT_DOCKET_ENTRY_ID);
  const payload = JSON.parse(row.payload_json);
  assert.equal(row.proposed_kind, "hearing");
  assert.equal(payload.proposed_kind, "hearing");
  assert.equal(row.proposed_kind, payload.proposed_kind); // lifted column tracks payload
  assert.equal(row.confirmation_state, "proposed");
  assert.equal(typeof payload.revised_at, "string");
});

test("Sqlite-DPE3: edit ignores adversarial caller revised_at (server-derived; absent from entry + audit)", async () => {
  const { makeDocketEntryInput, makeEditDocketEntryOpts, DEFAULT_DOCKET_ENTRY_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("e3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  const FORGED = "1999-01-01T00:00:00.000Z";
  const edited = await persistence.editDocketEntry(makeEditDocketEntryOpts({ revised_at: FORGED }));
  assert.notEqual(edited.revised_at, FORGED);
  const row = db.prepare("SELECT payload_json FROM case_box_docket_entries WHERE id = ?").get(DEFAULT_DOCKET_ENTRY_ID);
  assert.ok(!row.payload_json.includes(FORGED));
  const ev = db.prepare("SELECT event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence DESC LIMIT 1").get(DEFAULT_MATTER_ID);
  assert.ok(!ev.event_json.includes(FORGED));
  const parsed = JSON.parse(ev.event_json);
  assert.equal(parsed.timestamp, edited.revised_at); // one timestamp sample
});
