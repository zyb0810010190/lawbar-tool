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
const claimTrackSchema = readJson(join(schemasDir, "case-box-claim-track.schema.json"));
const evidencePreparationSchema = readJson(join(schemasDir, "case-box-evidence-preparation.schema.json"));
const crossExaminationOpinionSchema = readJson(join(schemasDir, "case-box-cross-examination-opinion.schema.json"));

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
const validateClaimTrack = ajv.compile(claimTrackSchema);
const validateEvidencePreparation = ajv.compile(evidencePreparationSchema);
const validateCrossExaminationOpinion = ajv.compile(crossExaminationOpinionSchema);

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

// ---------------------------------------------------------------------------
// T3 S0 catalog fields (FORMS-T3-S0-SCHEMA-00 §4 Option A) — additive optional
// payload-only properties: evidence_title / proof_statement / display_order on
// evidence items; litigation_position on matters. Legacy fixtures above (no new
// fields) continue to pass unchanged, proving back-compat.
// ---------------------------------------------------------------------------

test("valid: evidence item with evidence_title + proof_statement + display_order passes", () => {
  const fixture = readJson(join(validDir, "evidence-item-with-t3-fields.valid.json"));
  assert.equal(validateEvidenceItem(fixture), true, errs(validateEvidenceItem));
});

test("valid: matter with litigation_position passes", () => {
  const fixture = readJson(join(validDir, "matter-with-litigation-position.valid.json"));
  assert.equal(validateMatter(fixture), true, errs(validateMatter));
});

test("invalid: evidence with empty-string proof_statement is rejected (minLength 1)", () => {
  const fixture = readJson(join(invalidDir, "evidence-empty-proof-statement.json"));
  assert.equal(validateEvidenceItem(fixture), false);
  const offenders = (validateEvidenceItem.errors || []).filter((e) => e.instancePath === "/proof_statement");
  assert.ok(offenders.length > 0, `expected error on /proof_statement (got ${errs(validateEvidenceItem)})`);
});

test("invalid: evidence with empty-string evidence_title is rejected (minLength 1)", () => {
  const fixture = readJson(join(invalidDir, "evidence-empty-evidence-title.json"));
  assert.equal(validateEvidenceItem(fixture), false);
  const offenders = (validateEvidenceItem.errors || []).filter((e) => e.instancePath === "/evidence_title");
  assert.ok(offenders.length > 0, `expected error on /evidence_title (got ${errs(validateEvidenceItem)})`);
});

test("invalid: evidence with null display_order is rejected (absence-only, no null branch)", () => {
  const fixture = readJson(join(invalidDir, "evidence-null-display-order.json"));
  assert.equal(validateEvidenceItem(fixture), false);
  const offenders = (validateEvidenceItem.errors || []).filter((e) => e.instancePath === "/display_order");
  assert.ok(offenders.length > 0, `expected error on /display_order (got ${errs(validateEvidenceItem)})`);
});

test("invalid: evidence with negative display_order is rejected (minimum 0)", () => {
  const fixture = readJson(join(invalidDir, "evidence-negative-display-order.json"));
  assert.equal(validateEvidenceItem(fixture), false);
  const offenders = (validateEvidenceItem.errors || []).filter((e) => e.instancePath === "/display_order");
  assert.ok(offenders.length > 0, `expected error on /display_order (got ${errs(validateEvidenceItem)})`);
});

test("invalid: evidence with non-integer display_order is rejected (type integer)", () => {
  const fixture = readJson(join(invalidDir, "evidence-non-integer-display-order.json"));
  assert.equal(validateEvidenceItem(fixture), false);
  const offenders = (validateEvidenceItem.errors || []).filter((e) => e.instancePath === "/display_order");
  assert.ok(offenders.length > 0, `expected error on /display_order (got ${errs(validateEvidenceItem)})`);
});

test("invalid: matter with out-of-enum litigation_position is rejected", () => {
  const fixture = readJson(join(invalidDir, "matter-bad-litigation-position.json"));
  assert.equal(validateMatter(fixture), false);
  const offenders = (validateMatter.errors || []).filter((e) => e.instancePath === "/litigation_position");
  assert.ok(offenders.length > 0, `expected enum error on /litigation_position (got ${errs(validateMatter)})`);
});

test("T3 S0 fields are OPTIONAL: schemas' required lists do not include them", () => {
  for (const f of ["evidence_title", "proof_statement", "display_order"]) {
    assert.ok(!evidenceItemSchema.required.includes(f), `${f} must not be required`);
  }
  assert.ok(!matterSchema.required.includes("litigation_position"), "litigation_position must not be required");
});

test("T3 S0 guard: no T4/T5 proof-model fields leaked into the contract schemas", () => {
  const evidenceProps = Object.keys(evidenceItemSchema.properties);
  const matterProps = Object.keys(matterSchema.properties);
  for (const forbidden of ["proof_target", "three_properties", "san_xing", "cross_exam_position", "proof_gap", "contradiction_links"]) {
    assert.ok(!evidenceProps.includes(forbidden), `evidence schema must not contain T4/T5 field ${forbidden}`);
    assert.ok(!matterProps.includes(forbidden), `matter schema must not contain T4/T5 field ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// WI-PTA-04 — ClaimTrack (pre-trial/trial-mode claim track, frozen spec §1/§9).
// Contract-only: standalone entity fixtures, no matter embed, no collection
// wrapper. All four track_type × our_role combinations (scenarios A-D) are
// valid — our_role is independent of plaintiff/defendant (frozen §9). A matter
// may hold one main_claim + any number of counterclaim tracks (no schema max).
// ---------------------------------------------------------------------------

test("valid: ClaimTrack scenario A — main_claim + our_role=asserting", () => {
  const fixture = readJson(join(validDir, "claim-track-main-asserting.valid.json"));
  assert.equal(validateClaimTrack(fixture), true, errs(validateClaimTrack));
  assert.equal(fixture.track_type, "main_claim");
  assert.equal(fixture.our_role, "asserting");
  assert.equal(fixture.response_summary, "", "an asserting track may leave response_summary empty (key present, no null)");
});

test("valid: ClaimTrack scenario B — counterclaim + our_role=responding", () => {
  const fixture = readJson(join(validDir, "claim-track-counterclaim-responding.valid.json"));
  assert.equal(validateClaimTrack(fixture), true, errs(validateClaimTrack));
  assert.equal(fixture.track_type, "counterclaim");
  assert.equal(fixture.our_role, "responding");
  assert.equal(fixture.claim_summary, "", "a responding track may leave claim_summary empty (key present, no null)");
});

test("valid: ClaimTrack scenario C — main_claim + our_role=responding (our side defends the principal claim)", () => {
  const fixture = readJson(join(validDir, "claim-track-main-responding.valid.json"));
  assert.equal(validateClaimTrack(fixture), true, errs(validateClaimTrack));
  assert.equal(fixture.track_type, "main_claim");
  assert.equal(fixture.our_role, "responding");
});

test("valid: ClaimTrack scenario D — counterclaim + our_role=asserting (our side brings a counterclaim)", () => {
  const fixture = readJson(join(validDir, "claim-track-counterclaim-asserting.valid.json"));
  assert.equal(validateClaimTrack(fixture), true, errs(validateClaimTrack));
  assert.equal(fixture.track_type, "counterclaim");
  assert.equal(fixture.our_role, "asserting");
});

test("valid: a matter holds a main_claim + a counterclaim (same matter_id) — main + counterclaim coexist", () => {
  const mainA = readJson(join(validDir, "claim-track-main-asserting.valid.json"));
  const counterB = readJson(join(validDir, "claim-track-counterclaim-responding.valid.json"));
  assert.equal(validateClaimTrack(mainA), true, errs(validateClaimTrack));
  assert.equal(validateClaimTrack(counterB), true, errs(validateClaimTrack));
  assert.equal(mainA.matter_id, counterB.matter_id, "both tracks share one matter_id");
  assert.equal(mainA.track_type, "main_claim");
  assert.equal(counterB.track_type, "counterclaim");
});

test("valid: a matter holds MULTIPLE counterclaim tracks (no schema-level maximum)", () => {
  const counterB = readJson(join(validDir, "claim-track-counterclaim-responding.valid.json"));
  const counterD = readJson(join(validDir, "claim-track-counterclaim-asserting.valid.json"));
  assert.equal(validateClaimTrack(counterB), true, errs(validateClaimTrack));
  assert.equal(validateClaimTrack(counterD), true, errs(validateClaimTrack));
  assert.equal(counterB.matter_id, counterD.matter_id, "both counterclaims share one matter_id");
  assert.equal(counterB.track_type, "counterclaim");
  assert.equal(counterD.track_type, "counterclaim");
  // No maximum-counterclaim constraint appears in the schema.
  assert.equal(claimTrackSchema.maxProperties, undefined);
  assert.equal(JSON.stringify(claimTrackSchema).includes("maxItems"), false, "schema imposes no cardinality cap on counterclaims");
});

test("valid: ClaimTrack accepts an unexpected property (open/additive schema, mirrors sibling entities)", () => {
  const fixture = readJson(join(validDir, "claim-track-unexpected-property.valid.json"));
  assert.equal(validateClaimTrack(fixture), true, errs(validateClaimTrack));
  assert.ok("future_reserved_field" in fixture);
  assert.equal(claimTrackSchema.additionalProperties, undefined, "schema does not set additionalProperties (open, like evidence-item/matter/party)");
});

test("invalid: ClaimTrack with bad track_type enum is rejected", () => {
  const fixture = readJson(join(invalidDir, "claim-track-bad-track-type.json"));
  assert.equal(validateClaimTrack(fixture), false);
  const offenders = (validateClaimTrack.errors || []).filter((e) => e.instancePath === "/track_type");
  assert.ok(offenders.length > 0, `expected enum error on /track_type (got ${errs(validateClaimTrack)})`);
});

test("invalid: ClaimTrack with bad our_role enum is rejected", () => {
  const fixture = readJson(join(invalidDir, "claim-track-bad-our-role.json"));
  assert.equal(validateClaimTrack(fixture), false);
  const offenders = (validateClaimTrack.errors || []).filter((e) => e.instancePath === "/our_role");
  assert.ok(offenders.length > 0, `expected enum error on /our_role (got ${errs(validateClaimTrack)})`);
});

test("invalid: ClaimTrack with bad status enum is rejected", () => {
  const fixture = readJson(join(invalidDir, "claim-track-bad-status.json"));
  assert.equal(validateClaimTrack(fixture), false);
  const offenders = (validateClaimTrack.errors || []).filter((e) => e.instancePath === "/status");
  assert.ok(offenders.length > 0, `expected enum error on /status (got ${errs(validateClaimTrack)})`);
});

test("invalid: ClaimTrack missing required title is rejected", () => {
  const fixture = readJson(join(invalidDir, "claim-track-missing-title.json"));
  assert.equal(validateClaimTrack(fixture), false);
  const offenders = (validateClaimTrack.errors || []).filter((e) => e.keyword === "required" && e.params.missingProperty === "title");
  assert.ok(offenders.length > 0, `expected required error for title (got ${errs(validateClaimTrack)})`);
});

test("invalid: ClaimTrack with empty title is rejected (minLength 1)", () => {
  const fixture = readJson(join(invalidDir, "claim-track-empty-title.json"));
  assert.equal(validateClaimTrack(fixture), false);
  const offenders = (validateClaimTrack.errors || []).filter((e) => e.instancePath === "/title");
  assert.ok(offenders.length > 0, `expected minLength error on /title (got ${errs(validateClaimTrack)})`);
});

test("invalid: ClaimTrack missing required claimant_party_id is rejected", () => {
  const fixture = readJson(join(invalidDir, "claim-track-missing-claimant.json"));
  assert.equal(validateClaimTrack(fixture), false);
  const offenders = (validateClaimTrack.errors || []).filter((e) => e.keyword === "required" && e.params.missingProperty === "claimant_party_id");
  assert.ok(offenders.length > 0, `expected required error for claimant_party_id (got ${errs(validateClaimTrack)})`);
});

test("invalid: ClaimTrack with malformed matter_id (fails ULID pattern) is rejected", () => {
  const fixture = readJson(join(invalidDir, "claim-track-bad-matter-id.json"));
  assert.equal(validateClaimTrack(fixture), false);
  const offenders = (validateClaimTrack.errors || []).filter((e) => e.instancePath === "/matter_id");
  assert.ok(offenders.length > 0, `expected pattern error on /matter_id (got ${errs(validateClaimTrack)})`);
});

test("invalid: ClaimTrack with non-integer sort_order (wrong primitive type) is rejected", () => {
  const fixture = readJson(join(invalidDir, "claim-track-non-integer-sort-order.json"));
  assert.equal(validateClaimTrack(fixture), false);
  const offenders = (validateClaimTrack.errors || []).filter((e) => e.instancePath === "/sort_order");
  assert.ok(offenders.length > 0, `expected type error on /sort_order (got ${errs(validateClaimTrack)})`);
});

test("invalid: ClaimTrack with wrong primitive type for claim_summary (number) is rejected", () => {
  const fixture = readJson(join(invalidDir, "claim-track-wrong-type-claim-summary.json"));
  assert.equal(validateClaimTrack(fixture), false);
  const offenders = (validateClaimTrack.errors || []).filter((e) => e.instancePath === "/claim_summary");
  assert.ok(offenders.length > 0, `expected type error on /claim_summary (got ${errs(validateClaimTrack)})`);
});

test("ClaimTrack schema: all §1 fields are REQUIRED (frozen §1 'Required claim-track fields')", () => {
  const req = new Set(claimTrackSchema.required);
  for (const f of [
    "id", "tenant_id", "actor_user_id", "matter_id", "track_type",
    "claimant_party_id", "respondent_party_id", "our_role", "title",
    "claim_summary", "response_summary", "legal_basis", "calculation_summary",
    "status", "sort_order", "created_at", "updated_at",
  ]) {
    assert.ok(req.has(f), `${f} must be required`);
  }
});

test("ClaimTrack schema: no cross-field invariant (no allOf/if/then coupling track_type to our_role)", () => {
  assert.equal(claimTrackSchema.allOf, undefined, "no allOf coupling");
  assert.equal(claimTrackSchema.if, undefined, "no if/then coupling");
});

// Table-driven required-field coverage: derive the list from the schema's own
// `required` array (NOT a hardcoded copy) so a schema change to the required set
// cannot silently escape this guard. Start from one valid fixture, delete each
// required field in turn, and assert rejection cites that exact property.
test("invalid: ClaimTrack rejects omission of EVERY required field (schema-derived, table-driven)", () => {
  const base = readJson(join(validDir, "claim-track-main-asserting.valid.json"));
  const required = claimTrackSchema.required;
  assert.equal(required.length, 17, "expected 17 frozen §1 required fields");
  // sanity: the pristine base is accepted before any mutation.
  assert.equal(validateClaimTrack(base), true, errs(validateClaimTrack));
  for (const field of required) {
    const mutant = { ...base };
    delete mutant[field];
    assert.equal(validateClaimTrack(mutant), false, `omitting ${field} must be rejected`);
    const offenders = (validateClaimTrack.errors || []).filter(
      (e) => e.keyword === "required" && e.params.missingProperty === field,
    );
    assert.ok(offenders.length > 0, `expected a required-error naming ${field} (got ${errs(validateClaimTrack)})`);
  }
});

// Table-driven malformed-identifier coverage across all four ULID fields.
test("invalid: ClaimTrack rejects a malformed ULID for every identifier field (table-driven)", () => {
  const base = readJson(join(validDir, "claim-track-main-asserting.valid.json"));
  for (const field of ["id", "matter_id", "claimant_party_id", "respondent_party_id"]) {
    const mutant = { ...base, [field]: "NOT-A-ULID" };
    assert.equal(validateClaimTrack(mutant), false, `malformed ${field} must be rejected`);
    const offenders = (validateClaimTrack.errors || []).filter(
      (e) => e.instancePath === `/${field}` && e.keyword === "pattern",
    );
    assert.ok(offenders.length > 0, `expected a ULID pattern error on /${field} (got ${errs(validateClaimTrack)})`);
  }
});

// Timestamp constraint coverage: created_at / updated_at must be RFC3339 date-time.
test("invalid: ClaimTrack rejects a malformed timestamp for created_at and updated_at (table-driven)", () => {
  const base = readJson(join(validDir, "claim-track-main-asserting.valid.json"));
  for (const field of ["created_at", "updated_at"]) {
    const mutant = { ...base, [field]: "2026-07-15 09:00:00" }; // space, no T/zone → not date-time
    assert.equal(validateClaimTrack(mutant), false, `malformed ${field} must be rejected`);
    const offenders = (validateClaimTrack.errors || []).filter(
      (e) => e.instancePath === `/${field}` && e.keyword === "format",
    );
    assert.ok(offenders.length > 0, `expected a date-time format error on /${field} (got ${errs(validateClaimTrack)})`);
  }
});

// Non-empty required string identity fields (tenant_id, actor_user_id, title):
// reject empty string, null, and a non-string primitive. (Audit M1.)
test("invalid: ClaimTrack rejects empty / null / non-string for tenant_id, actor_user_id, title (table-driven)", () => {
  const base = readJson(join(validDir, "claim-track-main-asserting.valid.json"));
  for (const field of ["tenant_id", "actor_user_id", "title"]) {
    for (const bad of ["", null, 123]) {
      const mutant = { ...base, [field]: bad };
      assert.equal(validateClaimTrack(mutant), false, `${field}=${JSON.stringify(bad)} must be rejected`);
      const offenders = (validateClaimTrack.errors || []).filter((e) => e.instancePath === `/${field}`);
      assert.ok(offenders.length > 0, `expected an error on /${field} for ${JSON.stringify(bad)} (got ${errs(validateClaimTrack)})`);
    }
  }
});

// Wrong-primitive-type coverage for EVERY field (audit M2). A wrong primitive
// for a string/ULID/timestamp/enum field is a number; for the integer field it
// is a string. Each must be rejected with an error on that field's path.
test("invalid: ClaimTrack rejects a wrong primitive type for every field (table-driven)", () => {
  const base = readJson(join(validDir, "claim-track-main-asserting.valid.json"));
  const wrongType = {
    tenant_id: 123, actor_user_id: 123, title: 123,
    claim_summary: 123, response_summary: 123, legal_basis: 123, calculation_summary: 123,
    created_at: 123, updated_at: 123,
    track_type: 123, our_role: 123, status: 123,
    id: 123, matter_id: 123, claimant_party_id: 123, respondent_party_id: 123,
    sort_order: "0",
  };
  // Every property in the schema must appear in this table (drift guard).
  assert.deepEqual(
    Object.keys(wrongType).sort(),
    Object.keys(claimTrackSchema.properties).sort(),
    "wrong-type table must cover every schema property",
  );
  for (const [field, bad] of Object.entries(wrongType)) {
    const mutant = { ...base, [field]: bad };
    assert.equal(validateClaimTrack(mutant), false, `${field}=${JSON.stringify(bad)} must be rejected`);
    const offenders = (validateClaimTrack.errors || []).filter((e) => e.instancePath === `/${field}`);
    assert.ok(offenders.length > 0, `expected an error on /${field} for wrong type (got ${errs(validateClaimTrack)})`);
  }
});

// Negative-boundary coverage for sort_order >= 0 (audit L1).
test("invalid: ClaimTrack rejects a negative sort_order (minimum 0)", () => {
  const base = readJson(join(validDir, "claim-track-main-asserting.valid.json"));
  const mutant = { ...base, sort_order: -1 };
  assert.equal(validateClaimTrack(mutant), false);
  const offenders = (validateClaimTrack.errors || []).filter(
    (e) => e.instancePath === "/sort_order" && e.keyword === "minimum",
  );
  assert.ok(offenders.length > 0, `expected a minimum error on /sort_order (got ${errs(validateClaimTrack)})`);
});

// ---------------------------------------------------------------------------
// EvidencePreparation (WI-PTA-05; frozen spec §2). Additive contract model that
// links an EXISTING evidence record to a claim track for pre-trial preparation.
// Contract-only: claim_track_id/evidence_id are ULID-SHAPE refs — referential
// existence, (claim_track_id, evidence_id) DB uniqueness (test #6), and the
// submitted_by_side read-time projection are DEFERRED to persistence/handler WIs
// (PTA-08/11). Every declared key is required; submitted_by_side/key_page/
// key_page_note are required-but-NULLABLE (null accepts, omission rejects).
// ---------------------------------------------------------------------------

const EP_VALID = "evidence-preparation-canonical.valid.json";

test("valid: EvidencePreparation canonical (our_side, confirmed, key_page + note, multi facts)", () => {
  const fixture = readJson(join(validDir, EP_VALID));
  assert.equal(validateEvidencePreparation(fixture), true, errs(validateEvidencePreparation));
  assert.equal(fixture.submitted_by_side, "our_side");
  assert.equal(fixture.review_status, "confirmed");
  assert.equal(fixture.key_page, 5);
  assert.ok(Array.isArray(fixture.facts_to_prove) && fixture.facts_to_prove.length === 2);
});

test("valid: EvidencePreparation null submitted_by_side + null key_page/note + empty facts + empty narratives", () => {
  const fixture = readJson(join(validDir, "evidence-preparation-null-side-empty.valid.json"));
  assert.equal(validateEvidencePreparation(fixture), true, errs(validateEvidencePreparation));
  assert.equal(fixture.submitted_by_side, null, "submitted_by_side null is a valid value (required key present)");
  assert.equal(fixture.key_page, null, "key_page null accepted");
  assert.equal(fixture.key_page_note, null, "key_page_note null accepted");
  assert.deepEqual(fixture.facts_to_prove, [], "empty facts_to_prove array accepted");
  assert.equal(fixture.evidence_purpose, "", "empty narrative string accepted");
  assert.equal(fixture.trial_use_summary, "", "empty narrative string accepted");
});

test("valid: one evidence item has preparation records on MULTIPLE claim tracks (same evidence_id, different claim_track_id)", () => {
  const a = readJson(join(validDir, "evidence-preparation-multi-track-a.valid.json"));
  const b = readJson(join(validDir, "evidence-preparation-multi-track-b.valid.json"));
  assert.equal(validateEvidencePreparation(a), true, errs(validateEvidencePreparation));
  assert.equal(validateEvidencePreparation(b), true, errs(validateEvidencePreparation));
  assert.equal(a.evidence_id, b.evidence_id, "both records reference the same evidence_id");
  assert.notEqual(a.claim_track_id, b.claim_track_id, "on two different claim tracks");
});

test("valid: EvidencePreparation accepts an unexpected property (open/additive schema, mirrors sibling entities)", () => {
  const fixture = readJson(join(validDir, "evidence-preparation-unexpected-property.valid.json"));
  assert.equal(validateEvidencePreparation(fixture), true, errs(validateEvidencePreparation));
  assert.ok("future_reserved_field" in fixture);
  assert.equal(evidencePreparationSchema.additionalProperties, undefined, "schema does not set additionalProperties (open)");
});

// Test #5: contract-level evidence_id REFERENCE SHAPE only — proves the model
// records a ULID-shaped evidence reference. It does NOT (and must not, this WI)
// prove that the referenced evidence record EXISTS; existence is a later
// handler/persistence preflight (PTA-08/11).
test("valid: EvidencePreparation records a ULID-shaped evidence_id reference (frozen test #5 — shape only, not existence)", () => {
  const fixture = readJson(join(validDir, EP_VALID));
  assert.match(fixture.evidence_id, /^[0-9a-z]{26}$/, "evidence_id is a well-formed ULID reference");
  assert.equal(validateEvidencePreparation(fixture), true, errs(validateEvidencePreparation));
});

// Table-driven VALID: submitted_by_side accepts every enum value AND null.
test("valid: EvidencePreparation accepts every submitted_by_side value and null (table-driven)", () => {
  const base = readJson(join(validDir, EP_VALID));
  for (const v of ["our_side", "opposing_side", "third_party", "court_obtained", "unknown", null]) {
    const mutant = { ...base, submitted_by_side: v };
    assert.equal(validateEvidencePreparation(mutant), true, `submitted_by_side=${JSON.stringify(v)} must accept (${errs(validateEvidencePreparation)})`);
  }
});

// Table-driven VALID: review_status accepts every frozen enum value.
test("valid: EvidencePreparation accepts every review_status value (table-driven)", () => {
  const base = readJson(join(validDir, EP_VALID));
  for (const v of ["draft", "in_review", "confirmed"]) {
    const mutant = { ...base, review_status: v };
    assert.equal(validateEvidencePreparation(mutant), true, `review_status=${v} must accept (${errs(validateEvidencePreparation)})`);
  }
});

// Table-driven VALID: facts_to_prove empty / single / multiple; key_page 1 / null.
test("valid: EvidencePreparation accepts empty/single/multiple facts_to_prove and key_page 1/null (table-driven)", () => {
  const base = readJson(join(validDir, EP_VALID));
  for (const facts of [[], ["one fact"], ["fact a", "fact b", "fact c"]]) {
    assert.equal(validateEvidencePreparation({ ...base, facts_to_prove: facts }), true, `facts length ${facts.length} must accept`);
  }
  for (const kp of [1, null]) {
    assert.equal(validateEvidencePreparation({ ...base, key_page: kp }), true, `key_page=${JSON.stringify(kp)} must accept`);
  }
});

test("invalid: EvidencePreparation with bad submitted_by_side enum is rejected", () => {
  const fixture = readJson(join(invalidDir, "evidence-preparation-bad-submitted-by-side.json"));
  assert.equal(validateEvidencePreparation(fixture), false);
  const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === "/submitted_by_side");
  assert.ok(offenders.length > 0, `expected enum error on /submitted_by_side (got ${errs(validateEvidencePreparation)})`);
});

test("invalid: EvidencePreparation with bad review_status enum is rejected", () => {
  const fixture = readJson(join(invalidDir, "evidence-preparation-bad-review-status.json"));
  assert.equal(validateEvidencePreparation(fixture), false);
  const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === "/review_status");
  assert.ok(offenders.length > 0, `expected enum error on /review_status (got ${errs(validateEvidencePreparation)})`);
});

test("invalid: EvidencePreparation facts_to_prove item over 500 chars is rejected (test #7 — short strings)", () => {
  const fixture = readJson(join(invalidDir, "evidence-preparation-facts-over-length.json"));
  assert.equal(fixture.facts_to_prove[0].length, 501);
  assert.equal(validateEvidencePreparation(fixture), false);
  const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === "/facts_to_prove/0" && e.keyword === "maxLength");
  assert.ok(offenders.length > 0, `expected maxLength error on /facts_to_prove/0 (got ${errs(validateEvidencePreparation)})`);
});

test("invalid: EvidencePreparation facts_to_prove empty-string item is rejected (minLength 1 — non-empty short strings)", () => {
  const base = readJson(join(validDir, EP_VALID));
  const mutant = { ...base, facts_to_prove: [""] };
  assert.equal(validateEvidencePreparation(mutant), false, "an empty-string fact item must be rejected");
  const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === "/facts_to_prove/0" && e.keyword === "minLength");
  assert.ok(offenders.length > 0, `expected minLength error on /facts_to_prove/0 (got ${errs(validateEvidencePreparation)})`);
});

test("invalid: EvidencePreparation facts_to_prove non-string item is rejected (test #7)", () => {
  const fixture = readJson(join(invalidDir, "evidence-preparation-facts-non-string-item.json"));
  assert.equal(validateEvidencePreparation(fixture), false);
  const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === "/facts_to_prove/0");
  assert.ok(offenders.length > 0, `expected type error on /facts_to_prove/0 (got ${errs(validateEvidencePreparation)})`);
});

test("invalid: EvidencePreparation facts_to_prove as a non-array (single blob) is rejected (test #7)", () => {
  const fixture = readJson(join(invalidDir, "evidence-preparation-facts-not-array.json"));
  assert.equal(validateEvidencePreparation(fixture), false);
  const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === "/facts_to_prove" && e.keyword === "type");
  assert.ok(offenders.length > 0, `expected array type error on /facts_to_prove (got ${errs(validateEvidencePreparation)})`);
});

test("invalid: EvidencePreparation key_page = 0 is rejected (minimum 1)", () => {
  const fixture = readJson(join(invalidDir, "evidence-preparation-key-page-zero.json"));
  assert.equal(validateEvidencePreparation(fixture), false);
  const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === "/key_page" && e.keyword === "minimum");
  assert.ok(offenders.length > 0, `expected minimum error on /key_page (got ${errs(validateEvidencePreparation)})`);
});

test("invalid: EvidencePreparation key_page negative is rejected (minimum 1)", () => {
  const fixture = readJson(join(invalidDir, "evidence-preparation-key-page-negative.json"));
  assert.equal(validateEvidencePreparation(fixture), false);
  const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === "/key_page" && e.keyword === "minimum");
  assert.ok(offenders.length > 0, `expected minimum error on /key_page (got ${errs(validateEvidencePreparation)})`);
});

// Table-driven required-field coverage: derive from the schema's own `required`
// array (NOT a hardcoded copy). Deleting each required key — including the
// required-but-nullable keys — must reject with a required-error naming it.
test("invalid: EvidencePreparation rejects omission of EVERY required field, incl. required-nullable (schema-derived, table-driven)", () => {
  const base = readJson(join(validDir, EP_VALID));
  const required = evidencePreparationSchema.required;
  assert.equal(required.length, 16, "expected 16 required fields");
  assert.equal(validateEvidencePreparation(base), true, errs(validateEvidencePreparation));
  for (const field of required) {
    const mutant = { ...base };
    delete mutant[field];
    assert.equal(validateEvidencePreparation(mutant), false, `omitting ${field} must be rejected`);
    const offenders = (validateEvidencePreparation.errors || []).filter(
      (e) => e.keyword === "required" && e.params.missingProperty === field,
    );
    assert.ok(offenders.length > 0, `expected a required-error naming ${field} (got ${errs(validateEvidencePreparation)})`);
  }
});

// The three required-but-nullable fields: null ACCEPTS, omission REJECTS.
test("invalid/valid: EvidencePreparation required-nullable fields accept null but reject omission (table-driven)", () => {
  const base = readJson(join(validDir, EP_VALID));
  for (const field of ["submitted_by_side", "key_page", "key_page_note"]) {
    assert.equal(validateEvidencePreparation({ ...base, [field]: null }), true, `${field}=null must accept (${errs(validateEvidencePreparation)})`);
    const omitted = { ...base };
    delete omitted[field];
    assert.equal(validateEvidencePreparation(omitted), false, `omitting ${field} must reject`);
    const offenders = (validateEvidencePreparation.errors || []).filter(
      (e) => e.keyword === "required" && e.params.missingProperty === field,
    );
    assert.ok(offenders.length > 0, `expected required-error naming ${field} (got ${errs(validateEvidencePreparation)})`);
  }
});

// Table-driven malformed-ULID coverage across all four ULID fields.
test("invalid: EvidencePreparation rejects a malformed ULID for every identifier field (table-driven)", () => {
  const base = readJson(join(validDir, EP_VALID));
  for (const field of ["id", "matter_id", "claim_track_id", "evidence_id"]) {
    const mutant = { ...base, [field]: "NOT-A-ULID" };
    assert.equal(validateEvidencePreparation(mutant), false, `malformed ${field} must be rejected`);
    const offenders = (validateEvidencePreparation.errors || []).filter(
      (e) => e.instancePath === `/${field}` && e.keyword === "pattern",
    );
    assert.ok(offenders.length > 0, `expected a ULID pattern error on /${field} (got ${errs(validateEvidencePreparation)})`);
  }
});

// Timestamp constraint coverage: created_at / updated_at must be RFC3339 date-time.
test("invalid: EvidencePreparation rejects a malformed timestamp for created_at and updated_at (table-driven)", () => {
  const base = readJson(join(validDir, EP_VALID));
  for (const field of ["created_at", "updated_at"]) {
    const mutant = { ...base, [field]: "2026-07-16 09:00:00" };
    assert.equal(validateEvidencePreparation(mutant), false, `malformed ${field} must be rejected`);
    const offenders = (validateEvidencePreparation.errors || []).filter(
      (e) => e.instancePath === `/${field}` && e.keyword === "format",
    );
    assert.ok(offenders.length > 0, `expected a date-time format error on /${field} (got ${errs(validateEvidencePreparation)})`);
  }
});

// Non-empty required identity fields (tenant_id, actor_user_id): reject empty,
// null, and non-string.
test("invalid: EvidencePreparation rejects empty / null / non-string for tenant_id, actor_user_id (table-driven)", () => {
  const base = readJson(join(validDir, EP_VALID));
  for (const field of ["tenant_id", "actor_user_id"]) {
    for (const bad of ["", null, 123]) {
      const mutant = { ...base, [field]: bad };
      assert.equal(validateEvidencePreparation(mutant), false, `${field}=${JSON.stringify(bad)} must be rejected`);
      const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === `/${field}`);
      assert.ok(offenders.length > 0, `expected an error on /${field} for ${JSON.stringify(bad)} (got ${errs(validateEvidencePreparation)})`);
    }
  }
});

// Null on NON-nullable fields must be rejected (distinct from the nullable trio).
test("invalid: EvidencePreparation rejects null on non-nullable fields (table-driven)", () => {
  const base = readJson(join(validDir, EP_VALID));
  for (const field of ["id", "matter_id", "claim_track_id", "evidence_id", "evidence_purpose", "facts_to_prove", "trial_use_summary", "review_status", "sort_order", "created_at", "updated_at"]) {
    const mutant = { ...base, [field]: null };
    assert.equal(validateEvidencePreparation(mutant), false, `${field}=null must be rejected (non-nullable)`);
    const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === `/${field}`);
    assert.ok(offenders.length > 0, `expected an error on /${field} for null (got ${errs(validateEvidencePreparation)})`);
  }
});

// Wrong-primitive-type coverage for EVERY field, drift-guarded against the
// schema's own properties.
test("invalid: EvidencePreparation rejects a wrong primitive type for every field (table-driven, drift-guarded)", () => {
  const base = readJson(join(validDir, EP_VALID));
  const wrongType = {
    id: 123, tenant_id: 123, actor_user_id: 123, matter_id: 123,
    claim_track_id: 123, evidence_id: 123,
    submitted_by_side: 123, evidence_purpose: 123, facts_to_prove: 123,
    trial_use_summary: 123, key_page: "1", key_page_note: 123,
    review_status: 123, sort_order: "0", created_at: 123, updated_at: 123,
  };
  assert.deepEqual(
    Object.keys(wrongType).sort(),
    Object.keys(evidencePreparationSchema.properties).sort(),
    "wrong-type table must cover every schema property",
  );
  for (const [field, bad] of Object.entries(wrongType)) {
    const mutant = { ...base, [field]: bad };
    assert.equal(validateEvidencePreparation(mutant), false, `${field}=${JSON.stringify(bad)} must be rejected`);
    const offenders = (validateEvidencePreparation.errors || []).filter((e) => e.instancePath === `/${field}`);
    assert.ok(offenders.length > 0, `expected an error on /${field} for wrong type (got ${errs(validateEvidencePreparation)})`);
  }
});

test("invalid: EvidencePreparation rejects a negative sort_order (minimum 0)", () => {
  const base = readJson(join(validDir, EP_VALID));
  const mutant = { ...base, sort_order: -1 };
  assert.equal(validateEvidencePreparation(mutant), false);
  const offenders = (validateEvidencePreparation.errors || []).filter(
    (e) => e.instancePath === "/sort_order" && e.keyword === "minimum",
  );
  assert.ok(offenders.length > 0, `expected a minimum error on /sort_order (got ${errs(validateEvidencePreparation)})`);
});

test("EvidencePreparation schema shape: 16 required keys; open; no cross-field invariant; key_page nullable int>=1; facts items maxLength 500", () => {
  const req = new Set(evidencePreparationSchema.required);
  for (const f of [
    "id", "tenant_id", "actor_user_id", "matter_id", "claim_track_id", "evidence_id",
    "submitted_by_side", "evidence_purpose", "facts_to_prove", "trial_use_summary",
    "key_page", "key_page_note", "review_status", "sort_order", "created_at", "updated_at",
  ]) {
    assert.ok(req.has(f), `${f} must be required`);
  }
  assert.equal(evidencePreparationSchema.required.length, 16);
  assert.equal(evidencePreparationSchema.additionalProperties, undefined, "open schema");
  assert.equal(evidencePreparationSchema.allOf, undefined, "no allOf coupling");
  assert.equal(evidencePreparationSchema.if, undefined, "no if/then coupling");
  const kp = evidencePreparationSchema.properties.key_page;
  assert.deepEqual(kp.type, ["integer", "null"], "key_page nullable integer");
  assert.equal(kp.minimum, 1, "key_page integer branch minimum 1");
  assert.equal(evidencePreparationSchema.properties.facts_to_prove.items.maxLength, 500, "facts_to_prove item maxLength 500");
  assert.equal(evidencePreparationSchema.properties.facts_to_prove.items.minLength, 1, "facts_to_prove item minLength 1 (non-empty short strings)");
  const sbs = evidencePreparationSchema.properties.submitted_by_side.enum;
  assert.deepEqual(sbs, ["our_side", "opposing_side", "third_party", "court_obtained", "unknown", null]);
});

// ---------------------------------------------------------------------------
// CrossExaminationOpinion (WI-PTA-06; frozen spec §3). Additive contract model:
// a lawyer's structured cross-examination position on one EXISTING evidence item
// within one claim track, in one of two directions. Four dimensions (authenticity,
// legality, relevance, probative-force) each = status enum + free-text reason.
// The cross-field rule (our_response_short_version required iff direction-2) is
// enforced by a SEPARATE TS helper (src/cross-exam-invariants.ts), NOT the schema
// — so the schema stays flat (no if/then) and is tested here for SHAPE only; the
// strict-iff invariant is exercised in validators.test.mjs. Contract-only: the
// (claim_track_id, evidence_id, direction) DB uniqueness (test #12) is DEFERRED to
// WI-PTA-09. No sort_order, no authored_by_side, no rebuttal_evidence_ids.
// ---------------------------------------------------------------------------

const CX_VALID = "cross-examination-opinion-our-objection.valid.json";

test("valid: CrossExaminationOpinion direction our_objection_to_their_evidence (test #9)", () => {
  const fixture = readJson(join(validDir, CX_VALID));
  assert.equal(validateCrossExaminationOpinion(fixture), true, errs(validateCrossExaminationOpinion));
  assert.equal(fixture.direction, "our_objection_to_their_evidence");
  assert.equal(fixture.our_response_short_version, null, "direction-1 leaves our_response_short_version null");
});

test("valid: CrossExaminationOpinion direction their_anticipated_objection_to_our_evidence (test #10)", () => {
  const fixture = readJson(join(validDir, "cross-examination-opinion-anticipated-objection.valid.json"));
  assert.equal(validateCrossExaminationOpinion(fixture), true, errs(validateCrossExaminationOpinion));
  assert.equal(fixture.direction, "their_anticipated_objection_to_our_evidence");
  assert.ok(typeof fixture.our_response_short_version === "string" && fixture.our_response_short_version.length > 0);
});

test("valid: CrossExaminationOpinion covers assorted dimension-status values + empty reasons/narratives", () => {
  const fixture = readJson(join(validDir, "cross-examination-opinion-status-coverage.valid.json"));
  assert.equal(validateCrossExaminationOpinion(fixture), true, errs(validateCrossExaminationOpinion));
  assert.equal(fixture.authenticity_reason, "", "empty reason string accepted (required key)");
  assert.equal(fixture.overall_opinion, "", "empty narrative string accepted");
});

test("valid: CrossExaminationOpinion accepts an unexpected property (open/additive schema)", () => {
  const fixture = readJson(join(validDir, "cross-examination-opinion-unexpected-property.valid.json"));
  assert.equal(validateCrossExaminationOpinion(fixture), true, errs(validateCrossExaminationOpinion));
  assert.ok("future_reserved_field" in fixture);
  assert.equal(crossExaminationOpinionSchema.additionalProperties, undefined, "open schema");
});

// Table-driven VALID: direction accepts both enum values.
test("valid: CrossExaminationOpinion accepts both direction values (table-driven, tests #9/#10)", () => {
  const base = readJson(join(validDir, CX_VALID));
  for (const d of ["our_objection_to_their_evidence", "their_anticipated_objection_to_our_evidence"]) {
    // keep the schema happy in both directions; the invariant is not exercised here (schema-only).
    const mutant = { ...base, direction: d, our_response_short_version: d === "our_objection_to_their_evidence" ? null : "resp" };
    assert.equal(validateCrossExaminationOpinion(mutant), true, `direction=${d} must accept (${errs(validateCrossExaminationOpinion)})`);
  }
});

// Table-driven VALID: each of the 4 dimension-status fields accepts every enum value.
test("valid: CrossExaminationOpinion accepts every dimension-status value on every dimension (table-driven)", () => {
  const base = readJson(join(validDir, CX_VALID));
  const dims = ["authenticity_status", "legality_status", "relevance_status", "probative_force_status"];
  for (const dim of dims) {
    for (const v of ["admitted", "denied", "conditional", "reserved", "not_applicable"]) {
      const mutant = { ...base, [dim]: v };
      assert.equal(validateCrossExaminationOpinion(mutant), true, `${dim}=${v} must accept (${errs(validateCrossExaminationOpinion)})`);
    }
  }
});

test("invalid: CrossExaminationOpinion with bad direction enum is rejected", () => {
  const fixture = readJson(join(invalidDir, "cross-examination-opinion-bad-direction.json"));
  assert.equal(validateCrossExaminationOpinion(fixture), false);
  const offenders = (validateCrossExaminationOpinion.errors || []).filter((e) => e.instancePath === "/direction");
  assert.ok(offenders.length > 0, `expected enum error on /direction (got ${errs(validateCrossExaminationOpinion)})`);
});

test("invalid: CrossExaminationOpinion with bad authenticity_status enum is rejected", () => {
  const fixture = readJson(join(invalidDir, "cross-examination-opinion-bad-authenticity-status.json"));
  assert.equal(validateCrossExaminationOpinion(fixture), false);
  const offenders = (validateCrossExaminationOpinion.errors || []).filter((e) => e.instancePath === "/authenticity_status");
  assert.ok(offenders.length > 0, `expected enum error on /authenticity_status (got ${errs(validateCrossExaminationOpinion)})`);
});

test("invalid: CrossExaminationOpinion with bad preparation_status enum is rejected", () => {
  const fixture = readJson(join(invalidDir, "cross-examination-opinion-bad-preparation-status.json"));
  assert.equal(validateCrossExaminationOpinion(fixture), false);
  const offenders = (validateCrossExaminationOpinion.errors || []).filter((e) => e.instancePath === "/preparation_status");
  assert.ok(offenders.length > 0, `expected enum error on /preparation_status (got ${errs(validateCrossExaminationOpinion)})`);
});

// Table-driven enum-reject across all four dimension-status fields (test #8).
test("invalid: CrossExaminationOpinion rejects an invalid value on every dimension-status field (table-driven, test #8)", () => {
  const base = readJson(join(validDir, CX_VALID));
  for (const dim of ["authenticity_status", "legality_status", "relevance_status", "probative_force_status"]) {
    const mutant = { ...base, [dim]: "bogus" };
    assert.equal(validateCrossExaminationOpinion(mutant), false, `${dim}=bogus must be rejected`);
    const offenders = (validateCrossExaminationOpinion.errors || []).filter((e) => e.instancePath === `/${dim}`);
    assert.ok(offenders.length > 0, `expected enum error on /${dim} (got ${errs(validateCrossExaminationOpinion)})`);
  }
});

test("invalid: CrossExaminationOpinion with malformed evidence_id (ULID pattern) is rejected", () => {
  const fixture = readJson(join(invalidDir, "cross-examination-opinion-bad-evidence-id.json"));
  assert.equal(validateCrossExaminationOpinion(fixture), false);
  const offenders = (validateCrossExaminationOpinion.errors || []).filter((e) => e.instancePath === "/evidence_id" && e.keyword === "pattern");
  assert.ok(offenders.length > 0, `expected pattern error on /evidence_id (got ${errs(validateCrossExaminationOpinion)})`);
});

test("invalid: CrossExaminationOpinion with wrong-type our_response_short_version (number) is rejected", () => {
  const fixture = readJson(join(invalidDir, "cross-examination-opinion-wrong-type-our-response.json"));
  assert.equal(validateCrossExaminationOpinion(fixture), false);
  const offenders = (validateCrossExaminationOpinion.errors || []).filter((e) => e.instancePath === "/our_response_short_version");
  assert.ok(offenders.length > 0, `expected type error on /our_response_short_version (got ${errs(validateCrossExaminationOpinion)})`);
});

// Table-driven required-field coverage: derive from schema.required (21 keys).
test("invalid: CrossExaminationOpinion rejects omission of EVERY required field (schema-derived, table-driven)", () => {
  const base = readJson(join(validDir, CX_VALID));
  const required = crossExaminationOpinionSchema.required;
  assert.equal(required.length, 21, "expected 21 required fields");
  assert.equal(validateCrossExaminationOpinion(base), true, errs(validateCrossExaminationOpinion));
  for (const field of required) {
    const mutant = { ...base };
    delete mutant[field];
    assert.equal(validateCrossExaminationOpinion(mutant), false, `omitting ${field} must be rejected`);
    const offenders = (validateCrossExaminationOpinion.errors || []).filter(
      (e) => e.keyword === "required" && e.params.missingProperty === field,
    );
    assert.ok(offenders.length > 0, `expected required-error naming ${field} (got ${errs(validateCrossExaminationOpinion)})`);
  }
});

// our_response_short_version is the ONLY nullable field: null accepts, omission rejects.
test("invalid/valid: CrossExaminationOpinion our_response_short_version accepts null but rejects omission", () => {
  const base = readJson(join(validDir, CX_VALID));
  assert.equal(validateCrossExaminationOpinion({ ...base, our_response_short_version: null }), true, "null accepts");
  const omitted = { ...base };
  delete omitted.our_response_short_version;
  assert.equal(validateCrossExaminationOpinion(omitted), false, "omission rejects");
});

// Table-driven malformed-ULID across all four ULID fields.
test("invalid: CrossExaminationOpinion rejects a malformed ULID for every identifier field (table-driven)", () => {
  const base = readJson(join(validDir, CX_VALID));
  for (const field of ["id", "matter_id", "claim_track_id", "evidence_id"]) {
    const mutant = { ...base, [field]: "NOT-A-ULID" };
    assert.equal(validateCrossExaminationOpinion(mutant), false, `malformed ${field} must be rejected`);
    const offenders = (validateCrossExaminationOpinion.errors || []).filter(
      (e) => e.instancePath === `/${field}` && e.keyword === "pattern",
    );
    assert.ok(offenders.length > 0, `expected a ULID pattern error on /${field} (got ${errs(validateCrossExaminationOpinion)})`);
  }
});

// Timestamp coverage.
test("invalid: CrossExaminationOpinion rejects a malformed timestamp for created_at and updated_at (table-driven)", () => {
  const base = readJson(join(validDir, CX_VALID));
  for (const field of ["created_at", "updated_at"]) {
    const mutant = { ...base, [field]: "2026-07-16 10:00:00" };
    assert.equal(validateCrossExaminationOpinion(mutant), false, `malformed ${field} must be rejected`);
    const offenders = (validateCrossExaminationOpinion.errors || []).filter(
      (e) => e.instancePath === `/${field}` && e.keyword === "format",
    );
    assert.ok(offenders.length > 0, `expected a date-time format error on /${field} (got ${errs(validateCrossExaminationOpinion)})`);
  }
});

// Non-empty identity fields.
test("invalid: CrossExaminationOpinion rejects empty / null / non-string for tenant_id, actor_user_id (table-driven)", () => {
  const base = readJson(join(validDir, CX_VALID));
  for (const field of ["tenant_id", "actor_user_id"]) {
    for (const bad of ["", null, 123]) {
      const mutant = { ...base, [field]: bad };
      assert.equal(validateCrossExaminationOpinion(mutant), false, `${field}=${JSON.stringify(bad)} must be rejected`);
      const offenders = (validateCrossExaminationOpinion.errors || []).filter((e) => e.instancePath === `/${field}`);
      assert.ok(offenders.length > 0, `expected an error on /${field} for ${JSON.stringify(bad)} (got ${errs(validateCrossExaminationOpinion)})`);
    }
  }
});

// Null on non-nullable fields (every field except our_response_short_version).
test("invalid: CrossExaminationOpinion rejects null on non-nullable fields (table-driven)", () => {
  const base = readJson(join(validDir, CX_VALID));
  const nonNullable = Object.keys(crossExaminationOpinionSchema.properties).filter((k) => k !== "our_response_short_version");
  for (const field of nonNullable) {
    const mutant = { ...base, [field]: null };
    assert.equal(validateCrossExaminationOpinion(mutant), false, `${field}=null must be rejected (non-nullable)`);
    const offenders = (validateCrossExaminationOpinion.errors || []).filter((e) => e.instancePath === `/${field}`);
    assert.ok(offenders.length > 0, `expected an error on /${field} for null (got ${errs(validateCrossExaminationOpinion)})`);
  }
});

// Wrong-primitive-type for EVERY field, drift-guarded against schema.properties.
test("invalid: CrossExaminationOpinion rejects a wrong primitive type for every field (table-driven, drift-guarded)", () => {
  const base = readJson(join(validDir, CX_VALID));
  const wrongType = {
    id: 123, tenant_id: 123, actor_user_id: 123, matter_id: 123,
    claim_track_id: 123, evidence_id: 123, direction: 123,
    authenticity_status: 123, authenticity_reason: 123,
    legality_status: 123, legality_reason: 123,
    relevance_status: 123, relevance_reason: 123,
    probative_force_status: 123, probative_force_reason: 123,
    overall_opinion: 123, courtroom_short_version: 123,
    our_response_short_version: 123, preparation_status: 123,
    created_at: 123, updated_at: 123,
  };
  assert.deepEqual(
    Object.keys(wrongType).sort(),
    Object.keys(crossExaminationOpinionSchema.properties).sort(),
    "wrong-type table must cover every schema property",
  );
  for (const [field, bad] of Object.entries(wrongType)) {
    const mutant = { ...base, [field]: bad };
    assert.equal(validateCrossExaminationOpinion(mutant), false, `${field}=${JSON.stringify(bad)} must be rejected`);
    const offenders = (validateCrossExaminationOpinion.errors || []).filter((e) => e.instancePath === `/${field}`);
    assert.ok(offenders.length > 0, `expected an error on /${field} for wrong type (got ${errs(validateCrossExaminationOpinion)})`);
  }
});

test("CrossExaminationOpinion schema shape: 21 required keys; open; flat (no allOf/if — conditional is a TS helper); exact enums", () => {
  const req = new Set(crossExaminationOpinionSchema.required);
  for (const f of [
    "id", "tenant_id", "actor_user_id", "matter_id", "claim_track_id", "evidence_id", "direction",
    "authenticity_status", "authenticity_reason", "legality_status", "legality_reason",
    "relevance_status", "relevance_reason", "probative_force_status", "probative_force_reason",
    "overall_opinion", "courtroom_short_version", "our_response_short_version", "preparation_status",
    "created_at", "updated_at",
  ]) {
    assert.ok(req.has(f), `${f} must be required`);
  }
  assert.equal(crossExaminationOpinionSchema.required.length, 21);
  assert.equal(crossExaminationOpinionSchema.additionalProperties, undefined, "open schema");
  assert.equal(crossExaminationOpinionSchema.allOf, undefined, "no allOf (conditional lives in cross-exam-invariants.ts)");
  assert.equal(crossExaminationOpinionSchema.if, undefined, "no if/then (conditional lives in cross-exam-invariants.ts)");
  assert.equal("sort_order" in crossExaminationOpinionSchema.properties, false, "no sort_order");
  assert.equal("authored_by_side" in crossExaminationOpinionSchema.properties, false, "no authored_by_side");
  assert.equal("rebuttal_evidence_ids" in crossExaminationOpinionSchema.properties, false, "no rebuttal_evidence_ids");
  assert.deepEqual(crossExaminationOpinionSchema.properties.direction.enum,
    ["our_objection_to_their_evidence", "their_anticipated_objection_to_our_evidence"]);
  assert.deepEqual(crossExaminationOpinionSchema.$defs.dimensionStatus.enum,
    ["admitted", "denied", "conditional", "reserved", "not_applicable"]);
  assert.deepEqual(crossExaminationOpinionSchema.properties.preparation_status.enum,
    ["draft", "review_needed", "ready_for_trial"]);
  assert.deepEqual(crossExaminationOpinionSchema.properties.our_response_short_version.type, ["string", "null"]);
});
