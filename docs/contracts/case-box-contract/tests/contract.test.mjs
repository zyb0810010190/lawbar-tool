// Contract tests for the case-box boundary.
//
// Run with: npm test (from docs/contracts/case-box-contract/)
//
// Asserts every valid fixture passes its target schema and every invalid
// fixture fails for the documented reason. Mirrors the OCR contract's
// per-fixture explicit pattern (no auto-sweep) so each failure surfaces the
// specific invariant that broke.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const schemasDir = join(root, "schemas");
const validDir = join(root, "fixtures", "valid");
const invalidDir = join(root, "fixtures", "invalid");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const ajv = new Ajv2020({ strict: "log", allErrors: true });
addFormats(ajv);

const matterSchema       = readJson(join(schemasDir, "case-box-matter.schema.json"));
const documentSchema     = readJson(join(schemasDir, "case-box-document.schema.json"));
const partySchema        = readJson(join(schemasDir, "case-box-party.schema.json"));
const deadlineSchema     = readJson(join(schemasDir, "case-box-deadline.schema.json"));
const evidenceItemSchema = readJson(join(schemasDir, "case-box-evidence-item.schema.json"));
const ocrLinkSchema      = readJson(join(schemasDir, "case-box-ocr-link.schema.json"));
const auditEventSchema   = readJson(join(schemasDir, "case-box-audit-event.schema.json"));
const factSchema         = readJson(join(schemasDir, "case-box-fact.schema.json"));
const privilegeMarkerSchema = readJson(join(schemasDir, "case-box-privilege-marker.schema.json"));
const confidentialityClassificationSchema = readJson(join(schemasDir, "case-box-confidentiality-classification.schema.json"));
const docketEntrySchema = readJson(join(schemasDir, "case-box-docket-entry.schema.json"));

const validateMatter       = ajv.compile(matterSchema);
const validateDocument     = ajv.compile(documentSchema);
const validateParty        = ajv.compile(partySchema);
const validateDeadline     = ajv.compile(deadlineSchema);
const validateEvidenceItem = ajv.compile(evidenceItemSchema);
const validateOcrLink      = ajv.compile(ocrLinkSchema);
const validateAuditEvent   = ajv.compile(auditEventSchema);
const validateFact         = ajv.compile(factSchema);
const validatePrivilegeMarker = ajv.compile(privilegeMarkerSchema);
const validateConfidentialityClassification = ajv.compile(confidentialityClassificationSchema);
const validateDocketEntry = ajv.compile(docketEntrySchema);

const errs = (v) => (v.errors || []).map((e) => `${e.instancePath} ${e.message}`).join("; ");

// ---------------------------------------------------------------------------
// Valid fixtures
// ---------------------------------------------------------------------------

test("valid: matter passes matter schema", () => {
  assert.equal(validateMatter(readJson(join(validDir, "matter.valid.json"))), true, errs(validateMatter));
});

test("valid: document passes document schema", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document.valid.json"))), true, errs(validateDocument));
});

test("valid: party passes party schema", () => {
  assert.equal(validateParty(readJson(join(validDir, "party.valid.json"))), true, errs(validateParty));
});

test("valid: deadline passes deadline schema", () => {
  assert.equal(validateDeadline(readJson(join(validDir, "deadline.valid.json"))), true, errs(validateDeadline));
});

test("valid: evidence-item passes evidence-item schema", () => {
  assert.equal(validateEvidenceItem(readJson(join(validDir, "evidence-item.valid.json"))), true, errs(validateEvidenceItem));
});

test("valid: ocr-link passes ocr-link schema (direction=read-only)", () => {
  assert.equal(validateOcrLink(readJson(join(validDir, "ocr-link.valid.json"))), true, errs(validateOcrLink));
});

test("valid: audit-event (create) passes audit-event schema", () => {
  assert.equal(validateAuditEvent(readJson(join(validDir, "audit-event.valid.json"))), true, errs(validateAuditEvent));
});

test("valid: fact-candidate-lawyer-authored passes fact schema", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-candidate-lawyer-authored.valid.json"))), true, errs(validateFact));
});

test("valid: fact-candidate-llm passes fact schema", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-candidate-llm.valid.json"))), true, errs(validateFact));
});

test("valid: fact-candidate-ocr-excerpt passes fact schema", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-candidate-ocr-excerpt.valid.json"))), true, errs(validateFact));
});

test("valid: fact-candidate-imported passes fact schema", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-candidate-imported.valid.json"))), true, errs(validateFact));
});

test("valid: fact-accepted-lawyer-authored passes fact schema", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-accepted-lawyer-authored.valid.json"))), true, errs(validateFact));
});

test("valid: fact-accepted-supersedes-prior passes fact schema", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-accepted-supersedes-prior.valid.json"))), true, errs(validateFact));
});

test("valid: fact-rejected passes fact schema", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-rejected.valid.json"))), true, errs(validateFact));
});

test("valid: privilege-marker-proposed-llm passes marker schema", () => {
  assert.equal(validatePrivilegeMarker(readJson(join(validDir, "privilege-marker-proposed-llm.valid.json"))), true, errs(validatePrivilegeMarker));
});

test("valid: privilege-marker-proposed-lawyer-draft passes marker schema", () => {
  assert.equal(validatePrivilegeMarker(readJson(join(validDir, "privilege-marker-proposed-lawyer-draft.valid.json"))), true, errs(validatePrivilegeMarker));
});

test("valid: privilege-marker-confirmed-lawyer-direct passes marker schema", () => {
  assert.equal(validatePrivilegeMarker(readJson(join(validDir, "privilege-marker-confirmed-lawyer-direct.valid.json"))), true, errs(validatePrivilegeMarker));
});

test("valid: privilege-marker-confirmed-on-fact passes marker schema", () => {
  assert.equal(validatePrivilegeMarker(readJson(join(validDir, "privilege-marker-confirmed-on-fact.valid.json"))), true, errs(validatePrivilegeMarker));
});

test("valid: privilege-marker-dismissed passes marker schema", () => {
  assert.equal(validatePrivilegeMarker(readJson(join(validDir, "privilege-marker-dismissed.valid.json"))), true, errs(validatePrivilegeMarker));
});

test("valid: privilege-marker-waived passes marker schema", () => {
  assert.equal(validatePrivilegeMarker(readJson(join(validDir, "privilege-marker-waived.valid.json"))), true, errs(validatePrivilegeMarker));
});

// ---------------------------------------------------------------------------
// Invalid fixtures — each is rejected, and the rejection cites the right path.
// ---------------------------------------------------------------------------

test("invalid: matter missing external_ocr_authorized is rejected", () => {
  const fixture = readJson(join(invalidDir, "matter-missing-opt-in.json"));
  assert.equal(validateMatter(fixture), false);
  const offenders = (validateMatter.errors || []).filter((e) =>
    e.keyword === "required" && (e.params?.missingProperty === "external_ocr_authorized")
  );
  assert.ok(offenders.length > 0, "expected required-property error on external_ocr_authorized");
});

test("invalid: document with status outside enum is rejected", () => {
  const fixture = readJson(join(invalidDir, "document-bad-status.json"));
  assert.equal(validateDocument(fixture), false);
  const offenders = (validateDocument.errors || []).filter((e) => e.instancePath === "/status");
  assert.ok(offenders.length > 0, "expected enum error on /status");
});

test("invalid: party with role 'judge' is rejected", () => {
  const fixture = readJson(join(invalidDir, "party-bad-role.json"));
  assert.equal(validateParty(fixture), false);
  const offenders = (validateParty.errors || []).filter((e) => e.instancePath === "/role");
  assert.ok(offenders.length > 0, "expected enum error on /role");
});

test("invalid: deadline missed→met without transition_reason is rejected", () => {
  const fixture = readJson(join(invalidDir, "deadline-missed-to-met-no-reason.json"));
  assert.equal(validateDeadline(fixture), false);
  const offenders = (validateDeadline.errors || []).filter((e) =>
    e.keyword === "required" && (e.params?.missingProperty === "transition_reason")
  );
  assert.ok(offenders.length > 0, "expected required-property error on transition_reason");
});

test("invalid: evidence with status=superseded but no supersedes_evidence_id is rejected", () => {
  const fixture = readJson(join(invalidDir, "evidence-superseded-no-supersedes.json"));
  assert.equal(validateEvidenceItem(fixture), false);
  const offenders = (validateEvidenceItem.errors || []).filter((e) =>
    e.instancePath === "/supersedes_evidence_id" || (e.params?.missingProperty === "supersedes_evidence_id")
  );
  assert.ok(offenders.length > 0, `expected error citing supersedes_evidence_id (got ${errs(validateEvidenceItem)})`);
});

test("invalid: ocr-link with direction='read-write' is rejected", () => {
  const fixture = readJson(join(invalidDir, "ocr-link-bad-direction.json"));
  assert.equal(validateOcrLink(fixture), false);
  const offenders = (validateOcrLink.errors || []).filter((e) => e.instancePath === "/direction");
  assert.ok(offenders.length > 0, "expected const-mismatch error on /direction");
});

test("invalid: audit-event privilege-waive without reason is rejected", () => {
  const fixture = readJson(join(invalidDir, "audit-event-privilege-waive-no-reason.json"));
  assert.equal(validateAuditEvent(fixture), false);
  const offenders = (validateAuditEvent.errors || []).filter((e) =>
    e.keyword === "required" && (e.params?.missingProperty === "reason")
  );
  assert.ok(offenders.length > 0, "expected required-property error on reason");
});

// ---------------------------------------------------------------------------
// Fact — invalid fixtures cover N1, N3, N4, N5, N6, N6.5, N7.
// Self-cycle (validator-only) is under fixtures/semantic-invalid/.
// ---------------------------------------------------------------------------

test("invalid: fact-candidate-with-accepted-at is rejected (N1)", () => {
  const fixture = readJson(join(invalidDir, "fact-candidate-with-accepted-at.json"));
  assert.equal(validateFact(fixture), false);
  const offenders = (validateFact.errors || []).filter((e) => e.instancePath === "/accepted_at");
  assert.ok(offenders.length > 0, `expected error on /accepted_at (got ${errs(validateFact)})`);
});

test("invalid: fact-accepted-no-reviewer is rejected (N3)", () => {
  const fixture = readJson(join(invalidDir, "fact-accepted-no-reviewer.json"));
  assert.equal(validateFact(fixture), false);
  // Fields are present but null; schema's `then.properties` enforces `type: string`,
  // so Ajv emits `type` errors on each reviewer field rather than `required`.
  const offenders = (validateFact.errors || []).filter((e) =>
    ["/reviewer_actor_user_id", "/reviewed_at", "/accepted_at"].includes(e.instancePath)
  );
  assert.ok(offenders.length > 0, `expected type errors on reviewer fields (got ${errs(validateFact)})`);
});

test("invalid: fact-rejected-no-reason is rejected (N4)", () => {
  const fixture = readJson(join(invalidDir, "fact-rejected-no-reason.json"));
  assert.equal(validateFact(fixture), false);
  const offenders = (validateFact.errors || []).filter((e) =>
    (e.instancePath === "/rejection_reason") ||
    (e.keyword === "required" && e.params?.missingProperty === "rejection_reason")
  );
  assert.ok(offenders.length > 0, `expected error on rejection_reason (got ${errs(validateFact)})`);
});

test("invalid: fact-lawyer-authored-with-extractor is rejected (N5)", () => {
  const fixture = readJson(join(invalidDir, "fact-lawyer-authored-with-extractor.json"));
  assert.equal(validateFact(fixture), false);
  const offenders = (validateFact.errors || []).filter((e) => e.instancePath === "/extractor_name");
  assert.ok(offenders.length > 0, `expected error on /extractor_name (got ${errs(validateFact)})`);
});

test("invalid: fact-llm-without-extractor-name is rejected (N6)", () => {
  const fixture = readJson(join(invalidDir, "fact-llm-without-extractor-name.json"));
  assert.equal(validateFact(fixture), false);
  const offenders = (validateFact.errors || []).filter((e) =>
    (e.instancePath === "/extractor_name") ||
    (e.keyword === "required" && e.params?.missingProperty === "extractor_name")
  );
  assert.ok(offenders.length > 0, `expected error citing extractor_name (got ${errs(validateFact)})`);
});

test("invalid: fact-imported-without-extractor-name is rejected (N6.5)", () => {
  const fixture = readJson(join(invalidDir, "fact-imported-without-extractor-name.json"));
  assert.equal(validateFact(fixture), false);
  const offenders = (validateFact.errors || []).filter((e) =>
    (e.instancePath === "/extractor_name") ||
    (e.keyword === "required" && e.params?.missingProperty === "extractor_name")
  );
  assert.ok(offenders.length > 0, `expected error citing extractor_name (got ${errs(validateFact)})`);
});

test("invalid: fact-ocr-excerpt-missing-fields is rejected (N7)", () => {
  const fixture = readJson(join(invalidDir, "fact-ocr-excerpt-missing-fields.json"));
  assert.equal(validateFact(fixture), false);
  const offenders = (validateFact.errors || []).filter((e) =>
    (e.instancePath === "/source_document_id") ||
    (e.keyword === "required" && e.params?.missingProperty === "source_document_id")
  );
  assert.ok(offenders.length > 0, `expected error citing source_document_id (got ${errs(validateFact)})`);
});

// ---------------------------------------------------------------------------
// Privilege marker invalid fixtures
// ---------------------------------------------------------------------------

test("invalid: privilege-marker-confirmed-no-basis is rejected (basis_text minLength)", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-confirmed-no-basis.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) => e.instancePath === "/basis_text");
  assert.ok(offenders.length > 0, `expected error on /basis_text (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-confirmed-no-confirmer is rejected (M2)", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-confirmed-no-confirmer.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) =>
    ["/confirmed_actor_user_id", "/confirmed_at"].includes(e.instancePath)
  );
  assert.ok(offenders.length > 0, `expected type errors on confirmation fields (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-dismissed-no-reason is rejected (M3)", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-dismissed-no-reason.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) => e.instancePath === "/dismissal_reason");
  assert.ok(offenders.length > 0, `expected error on /dismissal_reason (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-waived-no-reason is rejected (M4)", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-waived-no-reason.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) => e.instancePath === "/waiver_reason");
  assert.ok(offenders.length > 0, `expected error on /waiver_reason (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-waived-no-confirmer is rejected (M4 — must have been confirmed first)", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-waived-no-confirmer.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) =>
    ["/confirmed_actor_user_id", "/confirmed_at"].includes(e.instancePath)
  );
  assert.ok(offenders.length > 0, `expected type errors on confirmation fields (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-llm-without-extractor is rejected (M6)", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-llm-without-extractor.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) => e.instancePath === "/extractor_name");
  assert.ok(offenders.length > 0, `expected error on /extractor_name (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-imported-without-extractor is rejected (M7)", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-imported-without-extractor.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) => e.instancePath === "/extractor_name");
  assert.ok(offenders.length > 0, `expected error on /extractor_name (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-lawyer-with-extractor is rejected (M5)", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-lawyer-with-extractor.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) => e.instancePath === "/extractor_name");
  assert.ok(offenders.length > 0, `expected error on /extractor_name (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-bad-kind is rejected", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-bad-kind.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) => e.instancePath === "/kind");
  assert.ok(offenders.length > 0, `expected enum error on /kind (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-bad-target-type is rejected", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-bad-target-type.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) => e.instancePath === "/target_type");
  assert.ok(offenders.length > 0, `expected enum error on /target_type (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-missing-kind is rejected (top-level required)", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-missing-kind.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) =>
    e.keyword === "required" && e.params?.missingProperty === "kind"
  );
  assert.ok(offenders.length > 0, `expected required-property error on kind (got ${errs(validatePrivilegeMarker)})`);
});

test("invalid: privilege-marker-proposed-with-confirmed-at is rejected (M1)", () => {
  const fixture = readJson(join(invalidDir, "privilege-marker-proposed-with-confirmed-at.json"));
  assert.equal(validatePrivilegeMarker(fixture), false);
  const offenders = (validatePrivilegeMarker.errors || []).filter((e) => e.instancePath === "/confirmed_at");
  assert.ok(offenders.length > 0, `expected error on /confirmed_at (got ${errs(validatePrivilegeMarker)})`);
});

// ---------------------------------------------------------------------------
// Step-4 audit-event schema tightenings
// ---------------------------------------------------------------------------

test("invalid: audit-event with extra property is rejected (additionalProperties: false)", () => {
  const fixture = readJson(join(invalidDir, "audit-event-extra-property.json"));
  assert.equal(validateAuditEvent(fixture), false);
  const offenders = (validateAuditEvent.errors || []).filter((e) => e.keyword === "additionalProperties");
  assert.ok(offenders.length > 0, `expected additionalProperties error (got ${errs(validateAuditEvent)})`);
});

test("invalid: audit-event with bad entity_type is rejected (entity_type enum)", () => {
  const fixture = readJson(join(invalidDir, "audit-event-bad-entity-type.json"));
  assert.equal(validateAuditEvent(fixture), false);
  const offenders = (validateAuditEvent.errors || []).filter((e) => e.instancePath === "/entity_type");
  assert.ok(offenders.length > 0, `expected enum error on /entity_type (got ${errs(validateAuditEvent)})`);
});

// ---------------------------------------------------------------------------
// Confidentiality classification fixtures
// ---------------------------------------------------------------------------

test("valid: confidentiality-first-normal passes", () => {
  assert.equal(validateConfidentialityClassification(readJson(join(validDir, "confidentiality-first-normal.valid.json"))), true, errs(validateConfidentialityClassification));
});

test("valid: confidentiality-first-restricted passes", () => {
  assert.equal(validateConfidentialityClassification(readJson(join(validDir, "confidentiality-first-restricted.valid.json"))), true, errs(validateConfidentialityClassification));
});

test("valid: confidentiality-upgrade passes", () => {
  assert.equal(validateConfidentialityClassification(readJson(join(validDir, "confidentiality-upgrade.valid.json"))), true, errs(validateConfidentialityClassification));
});

test("valid: confidentiality-downgrade-with-reason passes", () => {
  assert.equal(validateConfidentialityClassification(readJson(join(validDir, "confidentiality-downgrade-with-reason.valid.json"))), true, errs(validateConfidentialityClassification));
});

test("valid: confidentiality-other-reason passes", () => {
  assert.equal(validateConfidentialityClassification(readJson(join(validDir, "confidentiality-other-reason.valid.json"))), true, errs(validateConfidentialityClassification));
});

test("invalid: confidentiality-bad-level is rejected", () => {
  const fixture = readJson(join(invalidDir, "confidentiality-bad-level.json"));
  assert.equal(validateConfidentialityClassification(fixture), false);
  const offenders = (validateConfidentialityClassification.errors || []).filter((e) => e.instancePath === "/level");
  assert.ok(offenders.length > 0);
});

test("invalid: confidentiality-bad-target-type is rejected (matter not in v1 enum)", () => {
  const fixture = readJson(join(invalidDir, "confidentiality-bad-target-type.json"));
  assert.equal(validateConfidentialityClassification(fixture), false);
  const offenders = (validateConfidentialityClassification.errors || []).filter((e) => e.instancePath === "/target_type");
  assert.ok(offenders.length > 0);
});

test("invalid: confidentiality-bad-reason-code is rejected", () => {
  const fixture = readJson(join(invalidDir, "confidentiality-bad-reason-code.json"));
  assert.equal(validateConfidentialityClassification(fixture), false);
  const offenders = (validateConfidentialityClassification.errors || []).filter((e) => e.instancePath === "/change_reason_code");
  assert.ok(offenders.length > 0);
});

test("invalid: confidentiality-other-reason-without-text is rejected (C1)", () => {
  const fixture = readJson(join(invalidDir, "confidentiality-other-reason-without-text.json"));
  assert.equal(validateConfidentialityClassification(fixture), false);
  const offenders = (validateConfidentialityClassification.errors || []).filter((e) =>
    e.instancePath === "/change_reason_text" ||
    (e.keyword === "required" && e.params?.missingProperty === "change_reason_text")
  );
  assert.ok(offenders.length > 0);
});

test("invalid: confidentiality-empty-reason-text is rejected (C1 minLength)", () => {
  const fixture = readJson(join(invalidDir, "confidentiality-empty-reason-text.json"));
  assert.equal(validateConfidentialityClassification(fixture), false);
  const offenders = (validateConfidentialityClassification.errors || []).filter((e) => e.instancePath === "/change_reason_text");
  assert.ok(offenders.length > 0);
});

test("invalid: confidentiality-missing-set-at is rejected", () => {
  const fixture = readJson(join(invalidDir, "confidentiality-missing-set-at.json"));
  assert.equal(validateConfidentialityClassification(fixture), false);
  const offenders = (validateConfidentialityClassification.errors || []).filter((e) =>
    e.keyword === "required" && e.params?.missingProperty === "set_at"
  );
  assert.ok(offenders.length > 0);
});

// ---------------------------------------------------------------------------
// Step 6 — Docket entry fixtures
// ---------------------------------------------------------------------------

test("valid: docket-entry-proposed-llm passes", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-proposed-llm.valid.json"))), true, errs(validateDocketEntry));
});

test("valid: docket-entry-proposed-court-order-excerpt passes", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-proposed-court-order-excerpt.valid.json"))), true, errs(validateDocketEntry));
});

test("valid: docket-entry-proposed-manual passes", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-proposed-manual.valid.json"))), true, errs(validateDocketEntry));
});

test("valid: docket-entry-proposed-imported passes", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-proposed-imported.valid.json"))), true, errs(validateDocketEntry));
});

test("valid: docket-entry-confirmed passes", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-confirmed.valid.json"))), true, errs(validateDocketEntry));
});

test("valid: docket-entry-dismissed passes", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-dismissed.valid.json"))), true, errs(validateDocketEntry));
});

test("valid: docket-entry-with-reminder-offsets passes", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-with-reminder-offsets.valid.json"))), true, errs(validateDocketEntry));
});

test("valid: docket-entry-reminder-zero-offset passes", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-reminder-zero-offset.valid.json"))), true, errs(validateDocketEntry));
});

test("invalid: docket-entry-bad-source-type is rejected", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-bad-source-type.json"))), false);
});

test("invalid: docket-entry-llm-without-extractor is rejected (D2)", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-llm-without-extractor.json"))), false);
});

test("invalid: docket-entry-manual-with-extractor is rejected (D1)", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-manual-with-extractor.json"))), false);
});

test("invalid: docket-entry-court-order-without-document is rejected (D4)", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-court-order-without-document.json"))), false);
});

test("invalid: docket-entry-confirmed-without-deadline-id is rejected (D5)", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-confirmed-without-deadline-id.json"))), false);
});

test("invalid: docket-entry-dismissed-without-reason is rejected (D6)", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-dismissed-without-reason.json"))), false);
});

test("invalid: docket-entry-datetime-without-timezone is rejected (D7)", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-datetime-without-timezone.json"))), false);
});

test("invalid: docket-entry-proposed-with-confirmed-at is rejected (D-proposed)", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-proposed-with-confirmed-at.json"))), false);
});

test("invalid: docket-entry-reminder-negative-offset is rejected", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-reminder-negative-offset.json"))), false);
});

test("invalid: docket-entry-reminder-bad-kind is rejected", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-reminder-bad-kind.json"))), false);
});

test("invalid: docket-entry-reminder-extra-property is rejected (additionalProperties: false)", () => {
  assert.equal(validateDocketEntry(readJson(join(invalidDir, "docket-entry-reminder-extra-property.json"))), false);
});

// WI-DPE2 — optional nullable revised_at (docs/adr/docket-proposal-edit.md §6).
// Additive + optional: existing entries (no revised_at) still validate; an entry
// with a date-time revised_at or null validates; a non-date-time revised_at is rejected.

test("valid: docket entry WITHOUT revised_at still passes (optional, additive)", () => {
  const base = readJson(join(validDir, "docket-entry-proposed-manual.valid.json"));
  assert.equal("revised_at" in base, false);
  assert.equal(validateDocketEntry(base), true, errs(validateDocketEntry));
});

test("valid: docket entry WITH a date-time revised_at passes", () => {
  const base = readJson(join(validDir, "docket-entry-proposed-manual.valid.json"));
  assert.equal(validateDocketEntry({ ...base, revised_at: "2026-06-01T00:00:00.000Z" }), true, errs(validateDocketEntry));
});

test("valid: docket entry WITH revised_at = null passes (nullable)", () => {
  const base = readJson(join(validDir, "docket-entry-proposed-manual.valid.json"));
  assert.equal(validateDocketEntry({ ...base, revised_at: null }), true, errs(validateDocketEntry));
});

test("invalid: docket entry with a non-date-time revised_at is rejected", () => {
  const base = readJson(join(validDir, "docket-entry-proposed-manual.valid.json"));
  assert.equal(validateDocketEntry({ ...base, revised_at: "not-a-date-time" }), false);
});

// ---------------------------------------------------------------------------
// WI-brief-matter-type — R-5 (a)..(j) additive contract surface
// See dev-memo/plan-brief-matter-type.md.
// ---------------------------------------------------------------------------

// --- Matter R-5(h), (j) ---

test("valid: matter-litigation-with-all-r5j passes (R-5(j) four free-text fields)", () => {
  assert.equal(validateMatter(readJson(join(validDir, "matter-litigation-with-all-r5j.valid.json"))), true, errs(validateMatter));
});

test("valid: matter-advisory-minimal passes (counsel matter, R-5(j) fields absent)", () => {
  assert.equal(validateMatter(readJson(join(validDir, "matter-advisory-minimal.valid.json"))), true, errs(validateMatter));
});

test("valid: matter-counsel-with-litigation-successor passes (R-5(h) successor_matter_id)", () => {
  assert.equal(validateMatter(readJson(join(validDir, "matter-counsel-with-litigation-successor.valid.json"))), true, errs(validateMatter));
});

// --- Document R-5(a), (b), (c), (d) ---

test("valid: document-engagement-contract passes (R-5(a) purpose enum)", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-engagement-contract.valid.json"))), true, errs(validateDocument));
});

test("valid: document-payment-record passes", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-payment-record.valid.json"))), true, errs(validateDocument));
});

test("valid: document-decision-record passes", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-decision-record.valid.json"))), true, errs(validateDocument));
});

test("valid: document-court-procedural passes", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-court-procedural.valid.json"))), true, errs(validateDocument));
});

test("valid: document-counsel-contract passes", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-counsel-contract.valid.json"))), true, errs(validateDocument));
});

test("valid: document-work-order-open passes (R-5(b) work_order_status with matching purpose)", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-work-order-open.valid.json"))), true, errs(validateDocument));
});

test("valid: document-work-order-without-status passes (work_order purpose; status optional)", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-work-order-without-status.valid.json"))), true, errs(validateDocument));
});

test("valid: document-lawyer-letter-with-lifecycle-fields passes (R-5(c) free-text fields)", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-lawyer-letter-with-lifecycle-fields.valid.json"))), true, errs(validateDocument));
});

test("valid: document-contract-review-input passes", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-contract-review-input.valid.json"))), true, errs(validateDocument));
});

test("valid: document-contract-review-final-supersedes passes (R-5(d) supersedes_document_id)", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-contract-review-final-supersedes.valid.json"))), true, errs(validateDocument));
});

test("valid: document-screenshot passes", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-screenshot.valid.json"))), true, errs(validateDocument));
});

test("valid: document-lifecycle-fields-on-non-matching-purpose passes (v1 loose linkage)", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-lifecycle-fields-on-non-matching-purpose.valid.json"))), true, errs(validateDocument));
});

test("invalid: document-work-order-status-without-purpose is rejected (INV-1)", () => {
  const fixture = readJson(join(invalidDir, "document-work-order-status-without-purpose.json"));
  assert.equal(validateDocument(fixture), false);
});

test("invalid: document-work-order-status-with-wrong-purpose is rejected (INV-1)", () => {
  const fixture = readJson(join(invalidDir, "document-work-order-status-with-wrong-purpose.json"));
  assert.equal(validateDocument(fixture), false);
});

// --- Fact R-5(e), (f) ---

test("valid: fact-claim passes (R-5(e) purpose enum)", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-claim.valid.json"))), true, errs(validateFact));
});

test("valid: fact-defense passes", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-defense.valid.json"))), true, errs(validateFact));
});

test("valid: fact-counterclaim passes", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-counterclaim.valid.json"))), true, errs(validateFact));
});

test("valid: fact-timeline-event-with-date passes (R-5(f) as_of_date)", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-timeline-event-with-date.valid.json"))), true, errs(validateFact));
});

test("valid: fact-non-timeline-with-date passes (as_of_date allowed for any purpose)", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-non-timeline-with-date.valid.json"))), true, errs(validateFact));
});

test("valid: fact-non-timeline-with-null-date passes (explicit null allowed for non-timeline)", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-non-timeline-with-null-date.valid.json"))), true, errs(validateFact));
});

test("valid: fact-work-order-result passes", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-work-order-result.valid.json"))), true, errs(validateFact));
});

test("valid: fact-consultation-q passes", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-consultation-q.valid.json"))), true, errs(validateFact));
});

test("valid: fact-consultation-a passes", () => {
  assert.equal(validateFact(readJson(join(validDir, "fact-consultation-a.valid.json"))), true, errs(validateFact));
});

test("invalid: fact-timeline-event-without-as-of-date is rejected (INV-2)", () => {
  const fixture = readJson(join(invalidDir, "fact-timeline-event-without-as-of-date.json"));
  assert.equal(validateFact(fixture), false);
  const offenders = (validateFact.errors || []).filter((e) =>
    (e.keyword === "required" && e.params?.missingProperty === "as_of_date") ||
    e.instancePath === "/as_of_date"
  );
  assert.ok(offenders.length > 0, `expected error citing as_of_date (got ${errs(validateFact)})`);
});

test("invalid: fact-timeline-event-with-null-as-of-date is rejected (INV-2; null not allowed for timeline_event)", () => {
  const fixture = readJson(join(invalidDir, "fact-timeline-event-with-null-as-of-date.json"));
  assert.equal(validateFact(fixture), false);
});

test("invalid: fact-as-of-date-with-time-component is rejected (INV-3 format=date)", () => {
  const fixture = readJson(join(invalidDir, "fact-as-of-date-with-time-component.json"));
  assert.equal(validateFact(fixture), false);
  const offenders = (validateFact.errors || []).filter((e) => e.instancePath === "/as_of_date");
  assert.ok(offenders.length > 0, `expected format error on /as_of_date (got ${errs(validateFact)})`);
});

// --- Evidence R-5(g) ---

test("valid: evidence-item-with-party-side-our passes", () => {
  assert.equal(validateEvidenceItem(readJson(join(validDir, "evidence-item-with-party-side-our.valid.json"))), true, errs(validateEvidenceItem));
});

test("valid: evidence-item-with-party-side-opposing passes", () => {
  assert.equal(validateEvidenceItem(readJson(join(validDir, "evidence-item-with-party-side-opposing.valid.json"))), true, errs(validateEvidenceItem));
});

// --- Docket-entry R-5(i) — new kind values ---

test("valid: docket-entry-proposed-payment passes (R-5(i) kind=payment)", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-proposed-payment.valid.json"))), true, errs(validateDocketEntry));
});

test("valid: docket-entry-proposed-evidence-submission passes (R-5(i) kind=evidence_submission)", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-proposed-evidence-submission.valid.json"))), true, errs(validateDocketEntry));
});

test("valid: docket-entry-proposed-appeal passes (R-5(i) kind=appeal)", () => {
  assert.equal(validateDocketEntry(readJson(join(validDir, "docket-entry-proposed-appeal.valid.json"))), true, errs(validateDocketEntry));
});

// --- Deadline R-5(i) — new kind values ---

test("valid: deadline-payment passes", () => {
  assert.equal(validateDeadline(readJson(join(validDir, "deadline-payment.valid.json"))), true, errs(validateDeadline));
});

test("valid: deadline-evidence-submission passes", () => {
  assert.equal(validateDeadline(readJson(join(validDir, "deadline-evidence-submission.valid.json"))), true, errs(validateDeadline));
});

test("valid: deadline-appeal passes", () => {
  assert.equal(validateDeadline(readJson(join(validDir, "deadline-appeal.valid.json"))), true, errs(validateDeadline));
});

// ---------------------------------------------------------------------------
// WI-brief-doc-asset-impl — R-6/R-7 Option α (mime_type + byte_size + manual_extracted_text)
// See dev-memo/plan-brief-doc-asset-impl.md §2.3, §2.4.
// ---------------------------------------------------------------------------

test("valid: document-with-mime-and-size passes (mime_type + byte_size)", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-with-mime-and-size.valid.json"))), true, errs(validateDocument));
});

test("valid: document-with-manual-extracted-text passes (all three asset fields)", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-with-manual-extracted-text.valid.json"))), true, errs(validateDocument));
});

test("valid: document-omits-asset-fields passes (proves three fields are optional-omitted)", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-omits-asset-fields.valid.json"))), true, errs(validateDocument));
});

test("invalid: document-negative-byte-size is rejected (minimum: 0)", () => {
  const fixture = readJson(join(invalidDir, "document-negative-byte-size.json"));
  assert.equal(validateDocument(fixture), false);
  const offenders = (validateDocument.errors || []).filter((e) => e.instancePath === "/byte_size");
  assert.ok(offenders.length > 0, `expected error on /byte_size (got ${errs(validateDocument)})`);
});

test("invalid: document-byte-size-non-integer is rejected (type: integer)", () => {
  const fixture = readJson(join(invalidDir, "document-byte-size-non-integer.json"));
  assert.equal(validateDocument(fixture), false);
  const offenders = (validateDocument.errors || []).filter((e) => e.instancePath === "/byte_size");
  assert.ok(offenders.length > 0, `expected error on /byte_size (got ${errs(validateDocument)})`);
});

test("invalid: document-manual-extracted-text-over-maxlength is rejected (maxLength: 200000)", () => {
  const fixture = readJson(join(invalidDir, "document-manual-extracted-text-over-maxlength.json"));
  assert.equal(validateDocument(fixture), false);
  const offenders = (validateDocument.errors || []).filter((e) => e.instancePath === "/manual_extracted_text");
  assert.ok(offenders.length > 0, `expected error on /manual_extracted_text (got ${errs(validateDocument)})`);
});

test("invalid: document-mime-type-over-maxlength is rejected (maxLength: 255)", () => {
  const fixture = readJson(join(invalidDir, "document-mime-type-over-maxlength.json"));
  assert.equal(validateDocument(fixture), false);
  const offenders = (validateDocument.errors || []).filter((e) => e.instancePath === "/mime_type");
  assert.ok(offenders.length > 0, `expected error on /mime_type (got ${errs(validateDocument)})`);
});
