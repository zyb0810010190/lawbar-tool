// Smoke test that every documented public export exists and has the expected
// typeof. Guards against accidental removal of exports during refactors.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as pkg from "../dist/index.js";

const expectedFns = [
  "validateMatter",
  "validateDocument",
  "validateParty",
  "validateDeadline",
  "validateEvidenceItem",
  "validateOcrLink",
  "validateAuditEvent",
  "assertCaseBoxIsSubordinateToOcr",
  "isLocalOnlyActor",
  "defaultsAreLocalFirst",
  "classAllowsExternal",
  "isTerminalMatterState",
  "isTerminalDocumentState",
  "isTerminalEvidenceState",
  "isTerminalDeadlineState",
  "isAllowedMatterTransition",
  "isAllowedDocumentTransition",
  "isAllowedEvidenceTransition",
  "isAllowedDeadlineTransition",
  "assertValidMatterTransition",
  "assertValidDocumentTransition",
  "assertValidEvidenceTransition",
  "assertValidDeadlineTransition",
];

const expectedArrays = [
  "MATTER_STATES",
  "TERMINAL_MATTER_STATES",
  "DOCUMENT_STATES",
  "TERMINAL_DOCUMENT_STATES",
  "EVIDENCE_STATES",
  "TERMINAL_EVIDENCE_STATES",
  "DEADLINE_STATES",
  "TERMINAL_DEADLINE_STATES",
  "ALLOWED_MATTER_EDGES",
  "ALLOWED_DOCUMENT_EDGES",
  "ALLOWED_EVIDENCE_EDGES",
  "ALLOWED_DEADLINE_EDGES",
];

const expectedObjects = [
  "matterSchema",
  "documentSchema",
  "partySchema",
  "deadlineSchema",
  "evidenceItemSchema",
  "ocrLinkSchema",
  "auditEventSchema",
];

const expectedConstants = [
  "LOCAL_ONLY_ACTOR_USER_ID",
];

const expectedErrorCtors = [
  "IllegalTransitionError",
  "OcrSubordinationError",
];

test("every expected function is exported and callable", () => {
  for (const name of expectedFns) {
    assert.equal(typeof pkg[name], "function", `${name} should be a function`);
  }
});

test("every expected array is exported and non-empty (where applicable)", () => {
  for (const name of expectedArrays) {
    assert.ok(Array.isArray(pkg[name]), `${name} should be an array`);
  }
  // Terminal lists may be empty by design (matter / document); the rest must be non-empty.
  assert.ok(pkg.MATTER_STATES.length > 0);
  assert.ok(pkg.DOCUMENT_STATES.length > 0);
  assert.ok(pkg.EVIDENCE_STATES.length > 0);
  assert.ok(pkg.DEADLINE_STATES.length > 0);
  assert.ok(pkg.ALLOWED_MATTER_EDGES.length > 0);
  assert.ok(pkg.ALLOWED_DOCUMENT_EDGES.length > 0);
  assert.ok(pkg.ALLOWED_EVIDENCE_EDGES.length > 0);
  assert.ok(pkg.ALLOWED_DEADLINE_EDGES.length > 0);
});

test("every expected schema is exported and frozen", () => {
  for (const name of expectedObjects) {
    assert.equal(typeof pkg[name], "object", `${name} should be an object`);
    assert.ok(Object.isFrozen(pkg[name]), `${name} should be frozen`);
  }
});

test("every expected constant is exported with the right value", () => {
  assert.equal(pkg.LOCAL_ONLY_ACTOR_USER_ID, "local-user");
  void expectedConstants;
});

test("every expected error constructor is exported", () => {
  for (const name of expectedErrorCtors) {
    assert.equal(typeof pkg[name], "function", `${name} should be a constructor`);
  }
});

test("error constructors produce Error instances with named .name", () => {
  const e1 = new pkg.IllegalTransitionError("a", "b", "lawyer");
  assert.ok(e1 instanceof Error);
  assert.equal(e1.name, "IllegalTransitionError");
  assert.equal(e1.from, "a");
  assert.equal(e1.to, "b");

  const e2 = new pkg.OcrSubordinationError("boom");
  assert.ok(e2 instanceof Error);
  assert.equal(e2.name, "OcrSubordinationError");
});
