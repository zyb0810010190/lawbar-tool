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
  "validateFact",
  "validatePrivilegeMarker",
  "assertCaseBoxIsSubordinateToOcr",
  "isLocalOnlyActor",
  "defaultsAreLocalFirst",
  "classAllowsExternal",
  "isTerminalMatterState",
  "isTerminalDocumentState",
  "isTerminalEvidenceState",
  "isTerminalDeadlineState",
  "isTerminalFactState",
  "isTerminalPrivilegeMarkerState",
  "isAllowedMatterTransition",
  "isAllowedDocumentTransition",
  "isAllowedEvidenceTransition",
  "isAllowedDeadlineTransition",
  "isAllowedFactTransition",
  "isAllowedPrivilegeMarkerTransition",
  "assertValidMatterTransition",
  "assertValidDocumentTransition",
  "assertValidEvidenceTransition",
  "assertValidDeadlineTransition",
  "assertValidFactTransition",
  "assertValidPrivilegeMarkerTransition",
  "assertFactPromotionInvariants",
  "assertValidNewFact",
  "isFactCandidateOnly",
  "factWasMachineExtracted",
  "isMachineExtractedCandidate",
  "assertValidNewPrivilegeMarker",
  "assertPrivilegeMarkerTimestamps",
  "effectivePrivilegeStatus",
  "isMarkerProtective",
  "isMarkerLifecycleTerminal",
  "isMachineSuggestedMarker",
  // Step 4
  "isKnownAuditEntityType",
  "canonicalAuditEventHashInput",
  "assertReasonForAuditEventKind",
  "buildCaseBoxAuditEvent",
  "verifyAuditChain",
  "asAuditEventHash",
  // Step 5
  "validateConfidentialityClassification",
  "isFirstClassification",
  "isResetToUnclassified",
  "isDowngrade",
  "assertValidConfidentialityTransition",
  "assertValidNewConfidentialityClassification",
  "effectiveConfidentialityLevel",
  "assertExternalHandlingAllowed",
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
  "FACT_STATES",
  "TERMINAL_FACT_STATES",
  "PRIVILEGE_MARKER_STATES",
  "TERMINAL_PRIVILEGE_MARKER_STATES",
  "ALLOWED_MATTER_EDGES",
  "ALLOWED_DOCUMENT_EDGES",
  "ALLOWED_EVIDENCE_EDGES",
  "ALLOWED_DEADLINE_EDGES",
  "ALLOWED_FACT_EDGES",
  "ALLOWED_PRIVILEGE_MARKER_EDGES",
  // Step 4
  "CASE_BOX_AUDIT_ENTITY_TYPES",
  // Step 5
  "CONFIDENTIALITY_LEVELS",
  "CONFIDENTIALITY_CHANGE_REASON_CODES",
];

const expectedObjects = [
  "matterSchema",
  "documentSchema",
  "partySchema",
  "deadlineSchema",
  "evidenceItemSchema",
  "ocrLinkSchema",
  "auditEventSchema",
  "factSchema",
  "privilegeMarkerSchema",
  "confidentialityClassificationSchema",
  "LATTICE_ORDINAL",
];

const expectedConstants = [
  "LOCAL_ONLY_ACTOR_USER_ID",
];

const expectedErrorCtors = [
  "IllegalTransitionError",
  "OcrSubordinationError",
  "FactPromotionInvariantError",
  "FactCreationInvariantError",
  "PrivilegeMarkerCreationError",
  "AuditEventReasonRequiredError",
  "ConfidentialityTransitionError",
  "ConfidentialityCreationError",
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
  assert.ok(pkg.FACT_STATES.length > 0);
  assert.ok(pkg.PRIVILEGE_MARKER_STATES.length > 0);
  assert.ok(pkg.ALLOWED_MATTER_EDGES.length > 0);
  assert.ok(pkg.ALLOWED_DOCUMENT_EDGES.length > 0);
  assert.ok(pkg.ALLOWED_EVIDENCE_EDGES.length > 0);
  assert.ok(pkg.ALLOWED_DEADLINE_EDGES.length > 0);
  assert.ok(pkg.ALLOWED_FACT_EDGES.length > 0);
  assert.ok(pkg.ALLOWED_PRIVILEGE_MARKER_EDGES.length > 0);
  assert.ok(pkg.CASE_BOX_AUDIT_ENTITY_TYPES.length > 0);
  assert.ok(pkg.CONFIDENTIALITY_LEVELS.length > 0);
  assert.ok(pkg.CONFIDENTIALITY_CHANGE_REASON_CODES.length > 0);
});

test("CASE_BOX_AUDIT_EVENT_KINDS is exported as a non-empty object", () => {
  assert.equal(typeof pkg.CASE_BOX_AUDIT_EVENT_KINDS, "object");
  assert.ok(Object.keys(pkg.CASE_BOX_AUDIT_EVENT_KINDS).length > 0);
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

  const e3 = new pkg.FactPromotionInvariantError("self-cycle");
  assert.ok(e3 instanceof Error);
  assert.equal(e3.name, "FactPromotionInvariantError");
  assert.equal(e3.violation, "self-cycle");

  const e4 = new pkg.FactCreationInvariantError("not candidate");
  assert.ok(e4 instanceof Error);
  assert.equal(e4.name, "FactCreationInvariantError");
  assert.equal(e4.violation, "not candidate");

  const e5 = new pkg.PrivilegeMarkerCreationError("not lawyer");
  assert.ok(e5 instanceof Error);
  assert.equal(e5.name, "PrivilegeMarkerCreationError");
  assert.equal(e5.violation, "not lawyer");

  const e6 = new pkg.AuditEventReasonRequiredError("PRIVILEGE_MARKER_WAIVED");
  assert.ok(e6 instanceof Error);
  assert.equal(e6.name, "AuditEventReasonRequiredError");
  assert.equal(e6.kind, "PRIVILEGE_MARKER_WAIVED");

  const e7 = new pkg.ConfidentialityTransitionError("downgrade needs reason");
  assert.ok(e7 instanceof Error);
  assert.equal(e7.name, "ConfidentialityTransitionError");
  assert.equal(e7.violation, "downgrade needs reason");

  const e8 = new pkg.ConfidentialityCreationError("prior mismatch");
  assert.ok(e8 instanceof Error);
  assert.equal(e8.name, "ConfidentialityCreationError");
  assert.equal(e8.violation, "prior mismatch");
});
