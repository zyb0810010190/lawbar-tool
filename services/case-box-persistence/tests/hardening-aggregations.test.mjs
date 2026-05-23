// Hardening: B10 read-side aggregation invariants. Per B10 plan §1.4.
// NEW file (no behavioral split — B10 read aggregations start here).

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

test("Sqlite-B10: getMatterSummary cross-tenant existing matter THROWS tenant_mismatch (not null)", async () => {
  // Per B10 plan §1.2 rev-1 reviewer M D1#2 + M D2#2: matter EXISTS
  // under another tenant → throw; do NOT return null.
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("a1"),
  });
  await persistence.createMatter(makeMatterInput());
  let err;
  try {
    await persistence.getMatterSummary({ tenant_id: "tenant-evil", matter_id: DEFAULT_MATTER_ID });
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "tenant_mismatch");
});

test("Sqlite-B10: getMatterSummary unknown matter returns null", async () => {
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("a2"),
  });
  const result = await persistence.getMatterSummary({ tenant_id: "tenant-local-v1", matter_id: "01jcasemattermockid00nope0" });
  assert.equal(result, null);
});

test("Sqlite-B10: MatterSummary count consistency with dense bucket fixture + cross-tenant decoy", async () => {
  const { makeDocumentInput, makeFactInput, makeDocketEntryInput, makeEvidenceItemInput, makeOcrLinkInput, makePrivilegeMarkerInput, makeClassificationInput, DEFAULT_DOCUMENT_ID, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID, DEFAULT_FACT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("a3"),
  });
  // Matter under tenant-local-v1.
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());

  // Facts: 1 candidate (default), 1 reviewed.
  await persistence.appendFact(makeFactInput());
  await persistence.transitionFact(DEFAULT_FACT_ID, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" });

  // Docket entry → confirmed (creates 1 deadline pending).
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  });

  // Privilege marker.
  await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput());

  // Confidentiality classification.
  await persistence.appendConfidentialityClassification(makeClassificationInput());

  // Evidence item (proposed).
  await persistence.appendEvidenceItem(makeEvidenceItemInput());

  // OCR link.
  await persistence.upsertOcrLink(makeOcrLinkInput());

  // Cross-tenant DECOY: another matter under different tenant — must NOT count.
  const otherMatterId = "01jcasemattermockid00other";
  await persistence.createMatter(makeMatterInput({ id: otherMatterId, tenant_id: "tenant-other" }));

  const summary = await persistence.getMatterSummary({ tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID });
  assert.ok(summary);
  assert.equal(summary.counts.documents, 1);
  assert.equal(summary.counts.facts_by_status.candidate, 0);
  assert.equal(summary.counts.facts_by_status.reviewed, 1);
  assert.equal(summary.counts.deadlines_by_status.pending, 1);
  assert.equal(summary.counts.privilege_markers, 1);
  assert.equal(summary.counts.docket_entries_by_state.confirmed, 1);
  assert.equal(summary.counts.confidentiality_classifications, 1);
  assert.equal(summary.counts.evidence_items_by_status.proposed, 1);
  assert.equal(summary.counts.ocr_links, 1);
});

test("Sqlite-B10: getDocumentDetail cross-matter document returns null", async () => {
  const { makeDocumentInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("a4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // Second matter; query with first matter's document_id under second matter_id.
  const otherMatterId = "01jcasemattermockid00other";
  await persistence.createMatter(makeMatterInput({ id: otherMatterId }));
  const result = await persistence.getDocumentDetail({
    tenant_id: "tenant-local-v1",
    matter_id: otherMatterId,
    document_id: DEFAULT_DOCUMENT_ID,
  });
  assert.equal(result, null);
});

test("Sqlite-B10: getFactSupersessionChain 3-step walk in walk order", async () => {
  const { makeDocumentInput, makeFactInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("a5"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // 3 facts. C supersedes B supersedes A. Chain from C walks C → B → A.
  const factA = "01jcasefactmockid00chain01";
  const factB = "01jcasefactmockid00chain02";
  const factC = "01jcasefactmockid00chain03";
  await persistence.appendFact(makeFactInput({ id: factA }));
  await persistence.transitionFact(factA, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T10:00:00.000Z" });
  await persistence.transitionFact(factA, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" });
  await persistence.appendFact(makeFactInput({ id: factB }));
  await persistence.transitionFact(factB, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T12:00:00.000Z" });
  await persistence.transitionFact(factB, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T13:00:00.000Z", supersedes_fact_id: factA });
  await persistence.appendFact(makeFactInput({ id: factC }));
  await persistence.transitionFact(factC, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T14:00:00.000Z" });
  await persistence.transitionFact(factC, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:00:00.000Z", supersedes_fact_id: factB });
  const chain = await persistence.getFactSupersessionChain({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    fact_id: factC,
  });
  assert.equal(chain.length, 3);
  assert.equal(chain[0].id, factC);
  assert.equal(chain[1].id, factB);
  assert.equal(chain[2].id, factA);
});
