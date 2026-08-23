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

// ---------------------------------------------------------------------------
// T3 S0 catalog fields (FORMS-T3-S0-SCHEMA-00 §4 Option A) — payload-only
// additive optional properties. NO DDL: these tests also pin that the SQLite
// schema version did not move and no new evidence columns appeared.
// ---------------------------------------------------------------------------

test("T3-S0: evidence_title + proof_statement + display_order round-trip via SQL persistence (payload-only)", async () => {
  const { makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-07-03T09:00:00.000Z"),
    generateId: makeIdGenerator("t3a"),
  });
  await persistence.createMatter(makeMatterInput());
  const proof = "1、证明原告与被告存在劳动关系；2、证明原告的工龄情况。";
  const appended = await persistence.appendEvidenceItem(makeEvidenceItemInput({
    source_document_id: null,
    evidence_title: "劳动合同",
    proof_statement: proof,
    display_order: 3,
  }));
  assert.equal(appended.evidence_title, "劳动合同");
  assert.equal(appended.proof_statement, proof); // verbatim — no trimming/normalizing of content
  assert.equal(appended.display_order, 3);
  const got = await persistence.getEvidenceItem({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    evidence_id: DEFAULT_EVIDENCE_ID,
  });
  assert.equal(got.evidence_title, "劳动合同");
  assert.equal(got.proof_statement, proof);
  assert.equal(got.display_order, 3);
  // Payload-only: the fields live in payload_json, NOT in lifted columns.
  const cols = db.prepare("PRAGMA table_info(case_box_evidence_items)").all().map((c) => c.name);
  for (const f of ["evidence_title", "proof_statement", "display_order"]) {
    assert.ok(!cols.includes(f), `${f} must NOT be a lifted SQLite column (Option A payload-only)`);
  }
});

test("T3-S0: whitespace-only proof_statement is normalized to ABSENT at append (never stored empty)", async () => {
  const { makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-07-03T09:00:00.000Z"),
    generateId: makeIdGenerator("t3b"),
  });
  await persistence.createMatter(makeMatterInput());
  const input = makeEvidenceItemInput({ source_document_id: null, proof_statement: "   " });
  const appended = await persistence.appendEvidenceItem(input);
  assert.ok(!("proof_statement" in appended), "whitespace-only proof_statement must normalize to absent");
  assert.equal(input.proof_statement, "   ", "caller input must not be mutated");
  const raw = db.prepare("SELECT payload_json FROM case_box_evidence_items WHERE id = ?").get(DEFAULT_EVIDENCE_ID);
  assert.ok(!Object.prototype.hasOwnProperty.call(JSON.parse(raw.payload_json), "proof_statement"),
    "persisted payload_json must not contain an empty proof_statement");
});

test("T3-S0: legacy evidence input without the new fields stays valid and round-trips unchanged", async () => {
  const { makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-07-03T09:00:00.000Z"),
    generateId: makeIdGenerator("t3c"),
  });
  await persistence.createMatter(makeMatterInput());
  const appended = await persistence.appendEvidenceItem(makeEvidenceItemInput({ source_document_id: null }));
  for (const f of ["evidence_title", "proof_statement", "display_order"]) {
    assert.ok(!(f in appended), `legacy row must not grow a ${f} property`);
  }
  const got = await persistence.getEvidenceItem({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    evidence_id: DEFAULT_EVIDENCE_ID,
  });
  for (const f of ["evidence_title", "proof_statement", "display_order"]) {
    assert.ok(!(f in got), `legacy row must not grow a ${f} property on read`);
  }
});

test("T3-S0: notes and document filename are NOT promoted into evidence_title/proof_statement", async () => {
  const { makeDocumentInput, makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-07-03T09:00:00.000Z"),
    generateId: makeIdGenerator("t3d"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const appended = await persistence.appendEvidenceItem(makeEvidenceItemInput({
    notes: "a generic note that must not become display truth",
  }));
  assert.ok(!("evidence_title" in appended), "evidence_title must not be derived from notes/filename");
  assert.ok(!("proof_statement" in appended), "proof_statement must not be derived from notes");
  const got = await persistence.getEvidenceItem({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    evidence_id: DEFAULT_EVIDENCE_ID,
  });
  assert.equal(got.notes, "a generic note that must not become display truth");
  assert.ok(!("evidence_title" in got) && !("proof_statement" in got));
});

test("T3-S0: no DDL — CURRENT_SCHEMA_VERSION is 13 (VS-1) and T3-S0 itself ran no migration", async () => {
  // T3-S0 (evidence payload fields) added no DDL; the current version is 13 because WI-PTA-VS1 added
  // case_box_claim_tracks (v13). The pin tracks the current version, which T3-S0 does not itself bump.
  const { CURRENT_SCHEMA_VERSION } = await import("../dist/index.js");
  assert.equal(CURRENT_SCHEMA_VERSION, 13, "S0 Option A must not bump CURRENT_SCHEMA_VERSION");
  const { db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-07-03T09:00:00.000Z"),
    generateId: makeIdGenerator("t3e"),
  });
  const max = db.prepare("SELECT MAX(version) AS v FROM schema_version").get();
  assert.equal(max.v, 13);
});

test("T3-S0: no T4/T5 leakage — this WI adds no named proof-model properties and T3 round-trips do not synthesize them (schemas remain open; closed-schema rejection is NOT claimed)", async () => {
  const { makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-07-03T09:00:00.000Z"),
    generateId: makeIdGenerator("t3f"),
  });
  await persistence.createMatter(makeMatterInput());
  // The evidence contract has no T4/T5 proof-model properties; this WI adds none.
  // Round-trip a T3-S0 row and assert none of the T4/T5 field names appear.
  // NOTE (audit L2): the contract schemas do not set additionalProperties:false,
  // so unknown extra properties are not REJECTED by AJV — this guard pins only
  // that no named T4/T5 property was introduced or synthesized by this WI.
  const appended = await persistence.appendEvidenceItem(makeEvidenceItemInput({
    source_document_id: null,
    evidence_title: "工资条",
    proof_statement: "证明被告存在拖欠原告工资差额的事实。",
  }));
  const got = await persistence.getEvidenceItem({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    evidence_id: DEFAULT_EVIDENCE_ID,
  });
  for (const forbidden of ["proof_target", "three_properties", "cross_exam_position", "proof_gap", "contradiction_links"]) {
    assert.ok(!(forbidden in appended) && !(forbidden in got), `T4/T5 field ${forbidden} must not exist`);
  }
});
