// Cross-entity invariants not covered by the conformance harness.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CaseBoxPersistenceError,
  InMemoryCaseBoxPersistence,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// 6.2.1 Package depends on case-box-contract only
// ---------------------------------------------------------------------------

test("6.2.1 package.json declares only case-box-contract + better-sqlite3 (B1+: better-sqlite3 allowed; ocr-persistence still forbidden)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const deps = Object.keys(pkg.dependencies ?? {}).sort();
  // Phase B1 (commit <pending>) added better-sqlite3 as a runtime dep and
  // @types/better-sqlite3 as a devDependency. Per the reviewed B1 plan §1.1.
  assert.deepEqual(deps, ["better-sqlite3", "case-box-contract"], `unexpected dependencies: ${JSON.stringify(deps)}`);
  const devDeps = pkg.devDependencies ?? {};
  assert.ok("@types/better-sqlite3" in devDeps, "@types/better-sqlite3 must be a devDependency");
  // ocr-persistence remains forbidden across all phases.
  for (const banned of ["ocr-persistence"]) {
    assert.ok(!(banned in (pkg.dependencies ?? {})), `${banned} must NOT be a dependency`);
    assert.ok(!(banned in (pkg.devDependencies ?? {})), `${banned} must NOT be a devDependency`);
  }
});

// ---------------------------------------------------------------------------
// 6.2.2 No CaseBoxDeadline write API exists on the public surface
// ---------------------------------------------------------------------------

test("6.2.2 prototype excludes deadline-creation APIs", () => {
  const names = Object.getOwnPropertyNames(InMemoryCaseBoxPersistence.prototype);
  for (const forbidden of ["createDeadline", "insertDeadline", "appendDeadline", "writeDeadline", "materializeDeadline"]) {
    assert.ok(!names.includes(forbidden), `prototype should NOT have ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 6.2.3 No public appendAuditEvent / writeAuditEvent / recordAudit API
// ---------------------------------------------------------------------------

test("6.2.3 prototype excludes raw audit-event writers", () => {
  const names = Object.getOwnPropertyNames(InMemoryCaseBoxPersistence.prototype);
  for (const forbidden of ["appendAuditEvent", "writeAuditEvent", "recordAudit", "emitAuditEvent"]) {
    assert.ok(!names.includes(forbidden), `prototype should NOT have ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 6.2.4 Every emitted (action, entity_type) is a CASE_BOX_AUDIT_EVENT_KINDS entry
// ---------------------------------------------------------------------------

import {
  CASE_BOX_AUDIT_EVENT_KINDS,
} from "case-box-contract";
import {
  DEFAULT_MATTER_ID,
  DEFAULT_TENANT_ID,
  makeClock,
  makeDocumentInput,
  makeIdGenerator,
  makeMatterInput,
} from "./conformance/fixtures.mjs";

test("6.2.4 emitted events' (action, entity_type) all match CASE_BOX_AUDIT_EVENT_KINDS", async () => {
  const p = new InMemoryCaseBoxPersistence({ now: makeClock("2026-05-20T09:00:00.000Z"), generateId: makeIdGenerator("inv4") });
  await p.createMatter(makeMatterInput());
  await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "x" });
  await p.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "y" });
  const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
  const knownPairs = Object.values(CASE_BOX_AUDIT_EVENT_KINDS).map((m) => `${m.action}::${m.entity_type}`);
  for (const evt of page.rows) {
    const pair = `${evt.action}::${evt.entity_type}`;
    assert.ok(knownPairs.includes(pair), `emitted (action=${evt.action}, entity_type=${evt.entity_type}) is not a known cc-suite audit kind`);
  }
});

// ---------------------------------------------------------------------------
// 6.2.5 Deep-clone on return for documents
// ---------------------------------------------------------------------------

test("6.2.5 returned document is a deep clone", async () => {
  const p = new InMemoryCaseBoxPersistence({ now: makeClock("2026-05-20T09:00:00.000Z"), generateId: makeIdGenerator("inv5") });
  await p.createMatter(makeMatterInput());
  const doc = await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  doc.filename = "TAMPERED.pdf";
  const got = await p.getDocument(doc.id);
  assert.notEqual(got.filename, "TAMPERED.pdf");
});

// ---------------------------------------------------------------------------
// 6.2.6 All CaseBoxPersistenceError instances carry a documented code
// ---------------------------------------------------------------------------

test("6.2.6 CaseBoxPersistenceError code is one of the documented set (incl. B1+ not_implemented)", async () => {
  const known = new Set([
    "duplicate_id", "unknown_matter", "unknown_document", "tenant_mismatch",
    "matter_id_mismatch", "illegal_transition", "local_only_external_flag_rejected",
    "invalid_payload", "invalid_initial_state", "invalid_argument",
    "not_implemented", // B1+ scaffolding code; retired by B11 when full SQLite impl ships.
  ]);
  // Trigger each code at least once and verify the value is recognized.
  const p = new InMemoryCaseBoxPersistence({ now: makeClock("2026-05-20T09:00:00.000Z"), generateId: makeIdGenerator("inv6") });
  await p.createMatter(makeMatterInput());

  const cases = [
    () => p.createMatter(makeMatterInput({ id: "BAD" })),
    () => p.createMatter(makeMatterInput()), // duplicate id
    () => p.createMatter(makeMatterInput({ id: "01jdupemockid0000000000a02", external_ocr_authorized: true })),
    () => p.createMatter(makeMatterInput({ id: "01jdupemockid0000000000a03", status: "archived" })),
    () => p.getAuditChainHead("01nonexistmatter00000000xx"),
    () => p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "" }),
    () => p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ tenant_id: "other" })),
    () => p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ matter_id: "01othermockmatterid0000007" })),
  ];

  for (const fn of cases) {
    let caught;
    try { await fn(); } catch (e) { caught = e; }
    assert.ok(caught instanceof CaseBoxPersistenceError, `expected CaseBoxPersistenceError, got ${caught && caught.constructor.name}`);
    assert.ok(known.has(caught.code), `unknown code ${caught.code}`);
  }
});

// ---------------------------------------------------------------------------
// 6.2.6b SQLite stub emits not_implemented (per rev-1 reviewer Dim-3 #3:
// 6.2.6 documents the code; this parallel test proves the SQLite impl
// actually emits it).
// ---------------------------------------------------------------------------

test("6.2.6b Sqlite stub methods emit CaseBoxPersistenceError with code='not_implemented'", async () => {
  const { openSqliteCaseBoxPersistence } = await import("../dist/index.js");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("notimp"),
  });
  // Tracks the current stub frontier. B1 matter; B2 document; B3
  // audit-read; B4 confidentiality; B5 privilege; B6 facts; B7 docket
  // + deadlines; B8 evidence items; B9 OCR links. Next still-stubbed:
  // `getDeadlineCalendar` (B10).
  let caught;
  try {
    await persistence.getDeadlineCalendar({});
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "not_implemented");
  assert.match(caught.message, /getDeadlineCalendar/);
});

// ---------------------------------------------------------------------------
// 6.2.7 Prototype allowlist — exactly the 10 documented methods + constructor
// ---------------------------------------------------------------------------

test("6.2.7 InMemoryCaseBoxPersistence.prototype has exactly the documented method allowlist (A1-A9 = 43)", () => {
  const expected = [
    "appendConfidentialityClassification",
    "appendDocketEntry",
    "appendEvidenceItem",
    "appendFact",
    "appendFactOnce",
    "appendPrivilegeMarker",
    "archiveMatter",
    "confirmDocketEntry",
    "constructor",
    "createMatter",
    "dismissDocketEntry",
    "getAuditChainHead",
    "getDeadline",
    "getDeadlineCalendar",
    "getDocketEntry",
    "getDocument",
    "getDocumentDetail",
    "getEffectiveClassification",
    "getEvidenceItem",
    "getFact",
    "getFactSupersessionChain",
    "getMatter",
    "getMatterSummary",
    "getOcrLink",
    "getPrivilegeStatus",
    "listAuditEvents",
    "listConfidentialityClassifications",
    "listDeadlines",
    "listDocketEntries",
    "listDocuments",
    "listEvidenceItems",
    "listFacts",
    "listMatters",
    "listOcrLinks",
    "listPrivilegeMarkers",
    "registerDocument",
    "transitionDeadline",
    "transitionEvidenceItem",
    "transitionFact",
    "transitionPrivilegeMarker",
    "unarchiveMatter",
    "upsertOcrLink",
    "verifyAuditChainForMatter",
  ].sort();
  const actual = Object.getOwnPropertyNames(InMemoryCaseBoxPersistence.prototype).sort();
  assert.deepEqual(actual, expected, `prototype names mismatch: actual=${JSON.stringify(actual)}; expected=${JSON.stringify(expected)}`);
});

// ---------------------------------------------------------------------------
// WI-brief-matter-type-persistence — boundary-level invariant tests
// for INV-4 (document supersession) + INV-5 (matter successor).
// Exercises the PUBLIC createMatter / registerDocument paths.
// ---------------------------------------------------------------------------

test("R5 INV-5: createMatter rejects successor_matter_id pointing to non-existent matter", async () => {
  const p = new InMemoryCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("r5inv5a"),
  });
  let caught;
  try {
    await p.createMatter(makeMatterInput({
      successor_matter_id: "01jdoesnotexist000000000zz",
    }));
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_payload");
});

test("R5 INV-5: createMatter rejects successor_matter_id in different tenant", async () => {
  const p = new InMemoryCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("r5inv5b"),
  });
  const successorId = "01jcasemattermockid0000099";
  await p.createMatter(makeMatterInput({
    id: successorId,
    tenant_id: "other-tenant",
    matter_type: "litigation",
  }));
  let caught;
  try {
    await p.createMatter(makeMatterInput({
      successor_matter_id: successorId,
    }));
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_payload");
});

test("R5 INV-5: createMatter rejects successor_matter_id with matter_type equal to original", async () => {
  const p = new InMemoryCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("r5inv5c"),
  });
  const successorId = "01jcasemattermockid0000098";
  await p.createMatter(makeMatterInput({
    id: successorId,
    matter_type: "litigation",
  }));
  let caught;
  try {
    await p.createMatter(makeMatterInput({
      matter_type: "litigation",
      successor_matter_id: successorId,
    }));
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_payload");
});

test("R5 INV-5: createMatter rejects self-cycle successor_matter_id", async () => {
  const p = new InMemoryCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("r5inv5d"),
  });
  let caught;
  try {
    await p.createMatter(makeMatterInput({
      successor_matter_id: DEFAULT_MATTER_ID,
    }));
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_payload");
});

test("R5 INV-4: registerDocument rejects supersedes_document_id pointing to non-existent doc", async () => {
  const p = new InMemoryCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("r5inv4a"),
  });
  await p.createMatter(makeMatterInput());
  let caught;
  try {
    await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({
      id: "01jcasedocmockid000000002a",
      supersedes_document_id: "01jdoesnotexist000000000zz",
    }));
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_payload");
});

test("R5 INV-4: registerDocument rejects supersedes_document_id pointing to doc in different matter", async () => {
  const p = new InMemoryCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("r5inv4b"),
  });
  await p.createMatter(makeMatterInput());
  await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const otherMatterId = "01jcasemattermockid0000097";
  const otherDocId = "01jcasedocmockid000000097a";
  await p.createMatter(makeMatterInput({ id: otherMatterId }));
  await p.registerDocument(otherMatterId, makeDocumentInput({
    id: otherDocId,
    matter_id: otherMatterId,
  }));
  let caught;
  try {
    await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({
      id: "01jcasedocmockid000000002a",
      supersedes_document_id: otherDocId,
    }));
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_payload");
});

test("R5 INV-4: registerDocument rejects self-cycle supersedes_document_id", async () => {
  const p = new InMemoryCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("r5inv4c"),
  });
  await p.createMatter(makeMatterInput());
  const docId = "01jcasedocmockid000000002a";
  let caught;
  try {
    await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({
      id: docId,
      supersedes_document_id: docId,
    }));
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_payload");
});

test("R5: createMatter + registerDocument happy path with all R-5 fields populated", async () => {
  const p = new InMemoryCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("r5happy"),
  });
  // Create successor matter first (litigation).
  const successorId = "01jcasemattermockid0000096";
  await p.createMatter(makeMatterInput({
    id: successorId,
    matter_type: "litigation",
  }));
  // Create counsel matter pointing to litigation successor + R-5(j) fields.
  await p.createMatter(makeMatterInput({
    matter_type: "advisory",
    successor_matter_id: successorId,
    case_type_text: "ignored for counsel matters but accepted by schema",
    case_progress_text: "ongoing engagement",
    court_contact_text: "n/a for counsel matters",
    contention_summary_text: "n/a for counsel matters",
  }));
  const m = await p.getMatter(DEFAULT_MATTER_ID);
  assert.equal(m.successor_matter_id, successorId);
  assert.equal(m.case_progress_text, "ongoing engagement");
  // Register two documents — second supersedes first.
  await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({
    purpose: "contract_review_input",
    review_date: "2026-04-22",
  }));
  const finalDocId = "01jcasedocmockid000000003a";
  await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({
    id: finalDocId,
    purpose: "contract_review_final",
    supersedes_document_id: "01jcasedocmockid000000001a",
    review_date: "2026-04-26",
    final_version_marker: "final v3",
  }));
  const d = await p.getDocument(finalDocId);
  assert.equal(d.purpose, "contract_review_final");
  assert.equal(d.supersedes_document_id, "01jcasedocmockid000000001a");
});
