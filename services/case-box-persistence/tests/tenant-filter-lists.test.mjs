// Security hardening: listFacts / listDeadlines must tenant-filter the rows
// themselves, not just validate the matter's tenant. Closes FACTS-AUD-1
// (cc-suite audit-mpxoq4ma-dn3m0h): the list SQL filtered WHERE matter_id only,
// so a fact/deadline row whose own tenant_id differed from its matter's (a
// data-integrity violation) would leak. These tests craft such a cross-tenant
// row directly in SQLite (the normal append path cannot create one) and assert
// it is excluded, while a same-tenant row is still returned (pagination intact).

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

const EVIL_TENANT = "tenant-evil";

test("Sqlite-SEC: listFacts excludes a cross-tenant fact row; same-tenant rows returned", async () => {
  const { makeFactInput, DEFAULT_FACT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secf"),
  });
  await persistence.createMatter(makeMatterInput());
  const matter = await persistence.getMatter(DEFAULT_MATTER_ID);
  const tenant = matter.tenant_id;

  const FACT2_ID = "01jcasefactmockid000000002";
  await persistence.appendFact(makeFactInput());
  await persistence.appendFact(makeFactInput({ id: FACT2_ID, statement_text: "second fact" }));

  // Sanity: both same-tenant facts are listed.
  const before = await persistence.listFacts({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(before.rows.length, 2);

  // Craft a cross-tenant row: flip fact #2's own tenant_id column to a foreign
  // tenant (its matter still belongs to `tenant`). The normal append path can
  // never produce this; only a direct write can.
  db.prepare("UPDATE case_box_facts SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, FACT2_ID);

  const after = await persistence.listFacts({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(after.rows.length, 1, "cross-tenant fact row must be excluded");
  assert.equal(after.rows[0].id, DEFAULT_FACT_ID, "the same-tenant fact is still returned");
});

test("Sqlite-SEC: listFacts pagination/cursor still works after the tenant filter", async () => {
  const { makeFactInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secfp"),
  });
  await persistence.createMatter(makeMatterInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;
  // Three facts with distinct created_at so seek order is deterministic.
  await persistence.appendFact(makeFactInput({ id: "01jcasefactpag000000000001", created_at: "2026-05-21T15:00:00.000Z" }));
  await persistence.appendFact(makeFactInput({ id: "01jcasefactpag000000000002", created_at: "2026-05-21T16:00:00.000Z" }));
  await persistence.appendFact(makeFactInput({ id: "01jcasefactpag000000000003", created_at: "2026-05-21T17:00:00.000Z" }));

  const page1 = await persistence.listFacts({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID, limit: 2 });
  assert.equal(page1.rows.length, 2);
  assert.ok(page1.next_cursor !== null);
  const page2 = await persistence.listFacts({
    tenant_id: tenant,
    matter_id: DEFAULT_MATTER_ID,
    limit: 2,
    cursor: page1.next_cursor,
  });
  assert.equal(page2.rows.length, 1);
  assert.equal(page2.next_cursor, null);
  const allIds = [...page1.rows, ...page2.rows].map((f) => f.id);
  assert.equal(new Set(allIds).size, 3, "all three same-tenant facts paginated exactly once");
});

test("Sqlite-SEC: listDeadlines excludes a cross-tenant deadline row; same-tenant survives; pagination intact", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secd"),
  });
  await persistence.createMatter(makeMatterInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;

  const ENTRY2_ID = "01jcasedockmockid000000002";
  const DEADLINE2_ID = "01jcasedlinemockid00000002";
  // Materialize two same-tenant deadlines via the docket confirm flow, with
  // distinct due dates so seek order (due_at ASC) is deterministic.
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  });
  await persistence.appendDocketEntry(
    makeDocketEntryInput({ id: ENTRY2_ID, proposed_due_at: "2026-06-20T17:00:00.000Z" }),
  );
  await persistence.confirmDocketEntry(ENTRY2_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:05:00.000Z",
    deadline_id: DEADLINE2_ID,
  });

  // Sanity: both same-tenant deadlines list, soonest-due first.
  const before = await persistence.listDeadlines({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(before.rows.length, 2);
  assert.equal(before.rows[0].id, DEFAULT_DEADLINE_ID); // due 2026-06-15
  assert.equal(before.rows[1].id, DEADLINE2_ID); // due 2026-06-20

  // Pagination still works after the tenant predicate.
  const page1 = await persistence.listDeadlines({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID, limit: 1 });
  assert.equal(page1.rows.length, 1);
  assert.ok(page1.next_cursor !== null);
  const page2 = await persistence.listDeadlines({
    tenant_id: tenant,
    matter_id: DEFAULT_MATTER_ID,
    limit: 1,
    cursor: page1.next_cursor,
  });
  assert.equal(page2.rows.length, 1);
  assert.equal(page2.next_cursor, null);
  assert.notEqual(page1.rows[0].id, page2.rows[0].id);

  // Craft a cross-tenant row by flipping deadline #1's own tenant_id column.
  db.prepare("UPDATE case_box_deadlines SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, DEFAULT_DEADLINE_ID);

  const after = await persistence.listDeadlines({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(after.rows.length, 1, "cross-tenant deadline row excluded; same-tenant one survives");
  assert.equal(after.rows[0].id, DEADLINE2_ID);
});

// ===========================================================================
// WI-SEC-CASEBOX-TENANT-SCOPING-DEFENSE-00
//
// M-1 (row-level tenant predicate on the remaining 8 SQLite child reads) and
// M-2 (id-addressed mutation UPDATEs scoped to the resolved row's own
// tenant_id+matter_id with a RunResult.changes === 1 assertion). Same
// technique as the FACTS-AUD-1 tests above: craft a cross-tenant row by
// flipping the LIFTED tenant_id column directly (the normal write path can
// never produce one; payload_json keeps the original tenant), then assert the
// read excludes it / the mutation matches zero rows and RAISES.
//
// Every EVIL_TENANT row is synthetic (direct column write); no private
// content. Belt-and-suspenders / atomic-consistency hardening — v1 is
// single-tenant, so these harden a forward multi-tenant runtime. The
// matter-tenant preflight + stable tenant_mismatch/unknown_matter surface are
// preserved (these tests do not exercise the preflight, which the existing
// hardening suites cover).
// ===========================================================================

// --- M-1: child-read row-level tenant_id predicate ------------------------

test("Sqlite-SEC M-1: listEvidenceItems excludes a cross-tenant evidence row; same-tenant survives", async () => {
  const { makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secev"),
  });
  await persistence.createMatter(makeMatterInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;
  const EV2_ID = "01jcaseevidmockid000000002";
  await persistence.appendEvidenceItem(makeEvidenceItemInput());
  await persistence.appendEvidenceItem(makeEvidenceItemInput({ id: EV2_ID, created_at: "2026-05-21T22:05:00.000Z" }));

  const before = await persistence.listEvidenceItems({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(before.rows.length, 2);

  db.prepare("UPDATE case_box_evidence_items SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, EV2_ID);

  const after = await persistence.listEvidenceItems({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(after.rows.length, 1, "cross-tenant evidence row must be excluded");
  assert.equal(after.rows[0].id, DEFAULT_EVIDENCE_ID);
});

test("Sqlite-SEC M-1: listDocketEntries excludes a cross-tenant docket-entry row; same-tenant survives", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secdk"),
  });
  await persistence.createMatter(makeMatterInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;
  const ENTRY2_ID = "01jcasedockmockid000000002";
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.appendDocketEntry(makeDocketEntryInput({ id: ENTRY2_ID, proposed_at: "2026-05-21T20:05:00.000Z" }));

  const before = await persistence.listDocketEntries({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(before.rows.length, 2);

  db.prepare("UPDATE case_box_docket_entries SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, ENTRY2_ID);

  const after = await persistence.listDocketEntries({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(after.rows.length, 1, "cross-tenant docket-entry row must be excluded");
  assert.equal(after.rows[0].id, DEFAULT_DOCKET_ENTRY_ID);
});

test("Sqlite-SEC M-1: listConfidentialityClassifications excludes a cross-tenant classification row", async () => {
  const { makeDocumentInput, makeClassificationInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("seccl"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;
  const CLASS1_ID = "01jcaseclassmockid00000a01";
  const CLASS2_ID = "01jcaseclassmockid00000a02";
  await persistence.appendConfidentialityClassification(
    makeClassificationInput({ id: CLASS1_ID, level: "normal", prior_level: null, set_at: "2026-05-21T09:00:00.000Z" }),
  );
  await persistence.appendConfidentialityClassification(
    makeClassificationInput({ id: CLASS2_ID, level: "confidential", prior_level: "normal", set_at: "2026-05-21T10:00:00.000Z" }),
  );

  const before = await persistence.listConfidentialityClassifications({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(before.rows.length, 2);

  db.prepare("UPDATE case_box_confidentiality_classifications SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, CLASS2_ID);

  const after = await persistence.listConfidentialityClassifications({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(after.rows.length, 1, "cross-tenant classification row must be excluded");
  assert.equal(after.rows[0].id, CLASS1_ID);
});

test("Sqlite-SEC M-1: getEffectiveClassification excludes a cross-tenant classification from history", async () => {
  const { makeDocumentInput, makeClassificationInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secge"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;
  const CLASS1_ID = "01jcaseclassmockid00000b01";
  const CLASS2_ID = "01jcaseclassmockid00000b02";
  await persistence.appendConfidentialityClassification(
    makeClassificationInput({ id: CLASS1_ID, level: "normal", prior_level: null, set_at: "2026-05-21T09:00:00.000Z" }),
  );
  await persistence.appendConfidentialityClassification(
    makeClassificationInput({ id: CLASS2_ID, level: "confidential", prior_level: "normal", set_at: "2026-05-21T10:00:00.000Z" }),
  );
  const query = { tenant_id: tenant, matter_id: DEFAULT_MATTER_ID, target_type: "document", target_id: DEFAULT_DOCUMENT_ID };

  const effBefore = await persistence.getEffectiveClassification(query);
  assert.equal(effBefore.history.length, 2);
  assert.equal(effBefore.effectiveLevel, "confidential");

  db.prepare("UPDATE case_box_confidentiality_classifications SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, CLASS2_ID);

  const effAfter = await persistence.getEffectiveClassification(query);
  assert.equal(effAfter.history.length, 1, "cross-tenant classification excluded from history");
  assert.equal(effAfter.effectiveLevel, "normal");
});

test("Sqlite-SEC M-1: listPrivilegeMarkers excludes a cross-tenant privilege-marker row; same-tenant survives", async () => {
  const { makeDocumentInput, makePrivilegeMarkerInput, DEFAULT_PRIVILEGE_MARKER_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secpm"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;
  const MARKER2_ID = "01jcasepmkmockid0000000002";
  await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput({ id: MARKER2_ID, proposed_at: "2026-05-21T12:00:00.000Z" }));

  const before = await persistence.listPrivilegeMarkers({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(before.rows.length, 2);

  db.prepare("UPDATE case_box_privilege_markers SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, MARKER2_ID);

  const after = await persistence.listPrivilegeMarkers({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(after.rows.length, 1, "cross-tenant privilege-marker row must be excluded");
  assert.equal(after.rows[0].id, DEFAULT_PRIVILEGE_MARKER_ID);
});

test("Sqlite-SEC M-1: getPrivilegeStatus excludes a cross-tenant confirmed marker", async () => {
  const { makeDocumentInput, makePrivilegeMarkerInput, DEFAULT_PRIVILEGE_MARKER_ID, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secgp"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;
  await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await persistence.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
    to: "confirmed",
    actor_user_id: "lawyer",
    at: "2026-05-21T11:00:00.000Z",
  });
  const query = { tenant_id: tenant, matter_id: DEFAULT_MATTER_ID, target_type: "document", target_id: DEFAULT_DOCUMENT_ID };

  const before = await persistence.getPrivilegeStatus(query);
  assert.equal(before.hasProtectiveAssertion, true);
  assert.equal(before.allTargetMarkers.length, 1);

  db.prepare("UPDATE case_box_privilege_markers SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, DEFAULT_PRIVILEGE_MARKER_ID);

  const after = await persistence.getPrivilegeStatus(query);
  assert.equal(after.hasProtectiveAssertion, false, "cross-tenant marker excluded from status");
  assert.equal(after.allTargetMarkers.length, 0);
});

test("Sqlite-SEC M-1: listOcrLinks excludes a cross-tenant ocr-link row; same-tenant survives", async () => {
  const { makeDocumentInput, makeOcrLinkInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secol"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const DOC2_ID = "01jcasedocmockid000000002a";
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ id: DOC2_ID, content_hash: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856" }));
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;
  await persistence.upsertOcrLink(makeOcrLinkInput());
  await persistence.upsertOcrLink(makeOcrLinkInput({ document_id: DOC2_ID, last_seen_at: "2026-05-22T11:00:00.000Z" }));

  const before = await persistence.listOcrLinks({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(before.rows.length, 2);

  db.prepare("UPDATE case_box_ocr_links SET tenant_id = ? WHERE document_id = ?").run(EVIL_TENANT, DOC2_ID);

  const after = await persistence.listOcrLinks({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(after.rows.length, 1, "cross-tenant ocr-link row must be excluded");
  assert.equal(after.rows[0].document_id, DEFAULT_DOCUMENT_ID);
});

test("Sqlite-SEC M-1: listAuditEvents excludes a cross-tenant audit-event row", async () => {
  const { makeDocumentInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secau"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;

  const before = await persistence.listAuditEvents({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.ok(before.rows.length >= 2, "at least a matter-created + document-registered event");

  const lastEventId = db
    .prepare("SELECT event_id FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence DESC LIMIT 1")
    .get(DEFAULT_MATTER_ID).event_id;
  db.prepare("UPDATE case_box_audit_events SET tenant_id = ? WHERE event_id = ?").run(EVIL_TENANT, lastEventId);

  const after = await persistence.listAuditEvents({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(after.rows.length, before.rows.length - 1, "cross-tenant audit-event row must be excluded");
});

// --- M-2: id-addressed mutation scope drift -> zero rows -> RAISES ---------
//
// Tamper ONLY the lifted tenant_id column (payload_json keeps the original
// tenant). The mutation resolves + prepares the next row from payload_json
// (original tenant), so the scoped UPDATE's `WHERE id = ? AND tenant_id = ?
// AND matter_id = ?` binds the original tenant while the row's lifted column
// is EVIL_TENANT -> zero rows matched -> RunResult.changes !== 1 ->
// invalid_argument RAISED before the audit-event write; the transaction rolls
// back (no spurious audit event, row unchanged).

async function auditEventCount(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID).c;
}

test("Sqlite-SEC M-2: transitionFact on a tenant-drifted fact row matches zero rows and RAISES (no audit)", async () => {
  const { makeFactInput, DEFAULT_FACT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("m2fact"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendFact(makeFactInput());
  db.prepare("UPDATE case_box_facts SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, DEFAULT_FACT_ID);

  const eventsBefore = await auditEventCount(db);
  await assert.rejects(
    () => persistence.transitionFact(DEFAULT_FACT_ID, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-22T09:30:00.000Z" }),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_argument",
  );
  assert.equal(await auditEventCount(db), eventsBefore, "no audit event for the scope-drifted fact mutation");
});

test("Sqlite-SEC M-2: transitionDeadline on a tenant-drifted deadline row matches zero rows and RAISES (no audit)", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("m2dl"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  });
  db.prepare("UPDATE case_box_deadlines SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, DEFAULT_DEADLINE_ID);

  const eventsBefore = await auditEventCount(db);
  await assert.rejects(
    () => persistence.transitionDeadline(DEFAULT_DEADLINE_ID, { to: "met", actor_user_id: "lawyer", at: "2026-06-15T17:00:00.000Z" }),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_argument",
  );
  assert.equal(await auditEventCount(db), eventsBefore, "no audit event for the scope-drifted deadline mutation");
});

test("Sqlite-SEC M-2: confirmDocketEntry on a tenant-drifted docket row matches zero rows and RAISES (no audit)", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("m2dkc"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  db.prepare("UPDATE case_box_docket_entries SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, DEFAULT_DOCKET_ENTRY_ID);

  const eventsBefore = await auditEventCount(db);
  await assert.rejects(
    () => persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    }),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_argument",
  );
  assert.equal(await auditEventCount(db), eventsBefore, "no audit event and no deadline written for the scope-drifted confirm");
  const deadlines = db.prepare("SELECT COUNT(*) AS c FROM case_box_deadlines WHERE matter_id = ?").get(DEFAULT_MATTER_ID).c;
  assert.equal(deadlines, 0, "confirm rolled back — no deadline materialized");
});

test("Sqlite-SEC M-2: editDocketEntry on a tenant-drifted docket row matches zero rows and RAISES (no audit)", async () => {
  const { makeDocketEntryInput, makeEditDocketEntryOpts, DEFAULT_DOCKET_ENTRY_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("m2dke"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendDocketEntry(makeDocketEntryInput());
  db.prepare("UPDATE case_box_docket_entries SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, DEFAULT_DOCKET_ENTRY_ID);

  const eventsBefore = await auditEventCount(db);
  await assert.rejects(
    () => persistence.editDocketEntry(makeEditDocketEntryOpts({ proposed_kind: "hearing" })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_argument",
  );
  assert.equal(await auditEventCount(db), eventsBefore, "no audit event for the scope-drifted docket edit");
});

test("Sqlite-SEC M-2: transitionEvidenceItem on a tenant-drifted evidence row matches zero rows and RAISES (no audit)", async () => {
  const { makeEvidenceItemInput, DEFAULT_EVIDENCE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("m2ev"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.appendEvidenceItem(makeEvidenceItemInput());
  db.prepare("UPDATE case_box_evidence_items SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, DEFAULT_EVIDENCE_ID);

  const eventsBefore = await auditEventCount(db);
  await assert.rejects(
    () => persistence.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer" }),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_argument",
  );
  assert.equal(await auditEventCount(db), eventsBefore, "no audit event for the scope-drifted evidence mutation");
});

test("Sqlite-SEC M-2: transitionPrivilegeMarker on a tenant-drifted marker row matches zero rows and RAISES (no audit)", async () => {
  const { makeDocumentInput, makePrivilegeMarkerInput, DEFAULT_PRIVILEGE_MARKER_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("m2pm"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput());
  db.prepare("UPDATE case_box_privilege_markers SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, DEFAULT_PRIVILEGE_MARKER_ID);

  const eventsBefore = await auditEventCount(db);
  await assert.rejects(
    () => persistence.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" }),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_argument",
  );
  assert.equal(await auditEventCount(db), eventsBefore, "no audit event for the scope-drifted privilege mutation");
});

// updateLinkMarkerRow (unlink/relink) is the 7th M-2 mutation and IS scoped +
// changes===1-guarded in source. It is NOT covered by a tamper test here: the
// unlink/relink resolver loads the link's tenant_id + matter_id from the
// LIFTED COLUMNS (SELECT ... FROM case_box_links WHERE id = ?), not from
// payload_json, so tampering the lifted tenant column also moves the value the
// UPDATE binds — the WHERE still matches. The guard defends against a
// concurrent/out-of-band row change BETWEEN the resolver SELECT and the
// UPDATE, which is not reachable through the synchronous single-transaction
// public API. Recorded as not cleanly reachable rather than forced.
