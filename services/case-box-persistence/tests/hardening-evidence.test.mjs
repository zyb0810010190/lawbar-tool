// Hardening: B8 evidence-item invariants. Per B8 plan §1.6.
// NEW file (no behavioral split — B8 evidence tests start here).

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

test("Sqlite-B8: appendEvidenceItem rejects cross-tenant source_document_id", async () => {
  const { makeDocumentInput, makeEvidenceItemInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("e1"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  let err;
  try {
    await persistence.appendEvidenceItem(makeEvidenceItemInput({
      tenant_id: "tenant-evil",
      source_document_id: DEFAULT_DOCUMENT_ID,
    }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "tenant_mismatch");
});

test("Sqlite-B8: appendEvidenceItem rejects cross-matter source_document_id", async () => {
  const { makeDocumentInput, makeEvidenceItemInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("e2"),
  });
  const otherMatterId = "01jcasemattermockid0000002";
  await persistence.createMatter(makeMatterInput());
  await persistence.createMatter(makeMatterInput({ id: otherMatterId }));
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  let err;
  try {
    await persistence.appendEvidenceItem(makeEvidenceItemInput({
      matter_id: otherMatterId,
      source_document_id: DEFAULT_DOCUMENT_ID,
    }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "matter_id_mismatch");
});

test("Sqlite-B8: audit-chain atomic event_count == 4 after createMatter + registerDocument + appendEvidenceItem + transitionEvidenceItem", async () => {
  const { makeDocumentInput, makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("e3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendEvidenceItem(makeEvidenceItemInput());
  await persistence.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer" });
  const head = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const count = db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const maxSeq = db.prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 4);
  assert.equal(count.c, 4);
  assert.equal(maxSeq.m, 4);
});

test("Sqlite-B8: row UPDATE-in-place on transition (single row; status reflects transition)", async () => {
  const { makeDocumentInput, makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("e4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendEvidenceItem(makeEvidenceItemInput());
  await persistence.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer" });
  const rows = db.prepare("SELECT status FROM case_box_evidence_items WHERE matter_id = ?").all(DEFAULT_MATTER_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "accepted");
});

test("Sqlite-B8: R-5 party_side round-trip via SQL persistence layer", async () => {
  const { makeDocumentInput, makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("e5"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const appended = await persistence.appendEvidenceItem(makeEvidenceItemInput({ party_side: "our" }));
  assert.equal(appended.party_side, "our");
  const got = await persistence.getEvidenceItem({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    evidence_id: DEFAULT_EVIDENCE_ID,
  });
  assert.equal(got.party_side, "our");
});

test("Sqlite-B8: accepted → superseded persists supersedes_evidence_id column from opts.replacement_evidence_id", async () => {
  // Per B8 plan §1.4 + rev-1 reviewer M D2#1: opts uses
  // `replacement_evidence_id`; row column is `supersedes_evidence_id`.
  // Helper writes the opt value into the row column.
  const { makeDocumentInput, makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("e6"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // Set up: evidence A (will be accepted then superseded by B); evidence B (replacement).
  const evidenceB = "01jcaseevidmockid000000bb1";
  await persistence.appendEvidenceItem(makeEvidenceItemInput());
  await persistence.appendEvidenceItem(makeEvidenceItemInput({ id: evidenceB }));
  await persistence.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer" });
  await persistence.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
    to: "superseded",
    actor_user_id: "lawyer",
    replacement_evidence_id: evidenceB,
  });
  // Lifted row column matches the opt value.
  const row = db.prepare("SELECT supersedes_evidence_id, status FROM case_box_evidence_items WHERE id = ?").get(DEFAULT_EVIDENCE_ID);
  assert.equal(row.status, "superseded");
  assert.equal(row.supersedes_evidence_id, evidenceB);
});
