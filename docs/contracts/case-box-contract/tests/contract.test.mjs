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

const validateMatter       = ajv.compile(matterSchema);
const validateDocument     = ajv.compile(documentSchema);
const validateParty        = ajv.compile(partySchema);
const validateDeadline     = ajv.compile(deadlineSchema);
const validateEvidenceItem = ajv.compile(evidenceItemSchema);
const validateOcrLink      = ajv.compile(ocrLinkSchema);
const validateAuditEvent   = ajv.compile(auditEventSchema);

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
