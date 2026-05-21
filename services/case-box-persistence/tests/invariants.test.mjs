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

test("6.2.1 package.json declares case-box-contract only (no better-sqlite3, no ocr-persistence)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  assert.deepEqual(deps, ["case-box-contract"], `unexpected dependencies: ${JSON.stringify(deps)}`);
  for (const banned of ["better-sqlite3", "@types/better-sqlite3", "ocr-persistence"]) {
    assert.ok(!(banned in (pkg.dependencies ?? {})));
    assert.ok(!(banned in (pkg.devDependencies ?? {})));
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

test("6.2.6 CaseBoxPersistenceError code is one of the documented set", async () => {
  const known = new Set([
    "duplicate_id", "unknown_matter", "unknown_document", "tenant_mismatch",
    "matter_id_mismatch", "illegal_transition", "local_only_external_flag_rejected",
    "invalid_payload", "invalid_initial_state", "invalid_argument",
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
