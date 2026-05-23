// Hardening: B6 facts invariants. Split from former monolithic
// sqlite.hardening.test.mjs per B8 plan §1.7 (closes B7 D4#1).

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

test("Sqlite-B6: appendFact rejects cross-tenant source_document_id", async () => {
  const { makeDocumentInput, makeFactInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f1"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  let err;
  try {
    await persistence.appendFact(makeFactInput({
      tenant_id: "tenant-evil",
      source_document_id: DEFAULT_DOCUMENT_ID,
    }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "tenant_mismatch");
});

test("Sqlite-B6: appendFact rejects cross-matter source_document_id", async () => {
  const { makeDocumentInput, makeFactInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f2"),
  });
  // Create two matters.
  const otherMatterId = "01jcasemattermockid0000002";
  await persistence.createMatter(makeMatterInput());
  await persistence.createMatter(makeMatterInput({ id: otherMatterId }));
  // Document belongs to the FIRST matter.
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // Append fact under the OTHER matter referencing the first matter's document.
  let err;
  try {
    await persistence.appendFact(makeFactInput({
      matter_id: otherMatterId,
      source_document_id: DEFAULT_DOCUMENT_ID,
    }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "matter_id_mismatch");
});

test("Sqlite-B6: transitionFact detects supersession 2-cycle via direct row mutation", async () => {
  const { makeDocumentInput, makeFactInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // Set-up: factA candidate → reviewed; factB candidate → reviewed → accepted.
  // factA stays at "reviewed" so its next transition can be "accepted"
  // with supersedes_fact_id = factB. Cycle is injected on factB by mutating
  // factB.supersedes_fact_id → factA. Walk visits factB → factA, detects
  // cursor === factId (factA), throws invalid_argument.
  const factA = "01jcasefactmockid00000aa01";
  const factB = "01jcasefactmockid00000aa02";
  await persistence.appendFact(makeFactInput({ id: factA }));
  await persistence.appendFact(makeFactInput({ id: factB }));
  await persistence.transitionFact(factA, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:30:00.000Z" });
  await persistence.transitionFact(factB, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:30:00.000Z" });
  await persistence.transitionFact(factB, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T16:00:00.000Z" });
  // Mutate factB.supersedes_fact_id → factA via direct SQL UPDATE.
  const rowB = db.prepare("SELECT payload_json FROM case_box_facts WHERE id = ?").get(factB);
  const parsedB = JSON.parse(rowB.payload_json);
  parsedB.supersedes_fact_id = factA;
  db.prepare("UPDATE case_box_facts SET supersedes_fact_id = ?, payload_json = ? WHERE id = ?").run(factA, JSON.stringify(parsedB), factB);
  // factA reviewed → accepted with supersedes_fact_id = factB.
  // Walk: cursor=factB → factB.supersedes_fact_id=factA → cursor=factA ===
  // factId → cycle thrown.
  let err;
  try {
    await persistence.transitionFact(factA, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T17:00:00.000Z", supersedes_fact_id: factB });
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError, `expected CaseBoxPersistenceError, got ${err?.constructor?.name}`);
  assert.equal(err.code, "invalid_argument");
  assert.match(err.message, /cycle|chain/i);
});

test("Sqlite-B6: audit-chain atomic after createMatter + registerDocument + appendFact + transitionFact (4 events)", async () => {
  const { makeDocumentInput, makeFactInput, DEFAULT_FACT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendFact(makeFactInput());
  await persistence.transitionFact(DEFAULT_FACT_ID, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:30:00.000Z" });
  const head = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const count = db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const maxSeq = db.prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 4);
  assert.equal(count.c, 4);
  assert.equal(maxSeq.m, 4);
});

test("Sqlite-B6: row UPDATE-in-place on transition (single row; status reflects transition)", async () => {
  const { makeDocumentInput, makeFactInput, DEFAULT_FACT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f5"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendFact(makeFactInput());
  // candidate → reviewed → accepted (direct candidate → accepted illegal).
  await persistence.transitionFact(DEFAULT_FACT_ID, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:30:00.000Z" });
  await persistence.transitionFact(DEFAULT_FACT_ID, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T16:00:00.000Z" });
  const rows = db.prepare("SELECT status FROM case_box_facts WHERE matter_id = ?").all(DEFAULT_MATTER_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "accepted");
});

test("Sqlite-B6: R-5 fact fields round-trip via SQL persistence layer", async () => {
  const { makeDocumentInput, makeFactInput, DEFAULT_FACT_ID, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f6"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const input = makeFactInput({
    purpose: "timeline_event",
    as_of_date: "2024-03-15",
  });
  const appended = await persistence.appendFact(input);
  assert.equal(appended.purpose, "timeline_event");
  assert.equal(appended.as_of_date, "2024-03-15");
  const round = await persistence.getFact({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    fact_id: DEFAULT_FACT_ID,
  });
  assert.equal(round.purpose, "timeline_event");
  assert.equal(round.as_of_date, "2024-03-15");
});
