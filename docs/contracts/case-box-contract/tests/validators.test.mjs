// Per-entity validator wrapper tests. Confirms that the public TS API surfaces
// a typed { ok, value } | { ok: false, summary, errors } result and that the
// happy paths + error paths behave as documented.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validateMatter,
  validateDocument,
  validateParty,
  validateDeadline,
  validateEvidenceItem,
  validateOcrLink,
  validateAuditEvent,
  assertCaseBoxIsSubordinateToOcr,
  OcrSubordinationError,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const validDir = join(root, "fixtures", "valid");
const invalidDir = join(root, "fixtures", "invalid");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------------------------------------------------------------------------
// Happy paths — every validator returns ok=true and the value preserves shape.
// ---------------------------------------------------------------------------

test("validateMatter happy path returns ok=true with value", () => {
  const r = validateMatter(readJson(join(validDir, "matter.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.matter_type, "litigation");
  assert.equal(r.value.external_ocr_authorized, false);
});

test("validateDocument happy path returns ok=true with value", () => {
  const r = validateDocument(readJson(join(validDir, "document.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "registered");
});

test("validateParty happy path returns ok=true", () => {
  const r = validateParty(readJson(join(validDir, "party.valid.json")));
  assert.equal(r.ok, true);
});

test("validateDeadline happy path returns ok=true", () => {
  const r = validateDeadline(readJson(join(validDir, "deadline.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "pending");
});

test("validateEvidenceItem happy path returns ok=true", () => {
  const r = validateEvidenceItem(readJson(join(validDir, "evidence-item.valid.json")));
  assert.equal(r.ok, true);
});

test("validateOcrLink happy path returns ok=true with direction=read-only", () => {
  const r = validateOcrLink(readJson(join(validDir, "ocr-link.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.direction, "read-only");
});

test("validateAuditEvent happy path returns ok=true", () => {
  const r = validateAuditEvent(readJson(join(validDir, "audit-event.valid.json")));
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------------------
// Error paths — every validator returns ok=false with non-empty errors[] and
// a sane summary string.
// ---------------------------------------------------------------------------

test("validateMatter error path returns ok=false with summary + errors", () => {
  const r = validateMatter(readJson(join(invalidDir, "matter-missing-opt-in.json")));
  assert.equal(r.ok, false);
  assert.ok(r.summary.length > 0);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
});

test("validateDocument error path returns ok=false with summary + errors", () => {
  const r = validateDocument(readJson(join(invalidDir, "document-bad-status.json")));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.instancePath === "/status"));
});

test("validateParty error path returns ok=false", () => {
  const r = validateParty(readJson(join(invalidDir, "party-bad-role.json")));
  assert.equal(r.ok, false);
});

test("validateDeadline error path returns ok=false", () => {
  const r = validateDeadline(readJson(join(invalidDir, "deadline-missed-to-met-no-reason.json")));
  assert.equal(r.ok, false);
});

test("validateEvidenceItem error path returns ok=false", () => {
  const r = validateEvidenceItem(readJson(join(invalidDir, "evidence-superseded-no-supersedes.json")));
  assert.equal(r.ok, false);
});

test("validateOcrLink error path returns ok=false (bad direction)", () => {
  const r = validateOcrLink(readJson(join(invalidDir, "ocr-link-bad-direction.json")));
  assert.equal(r.ok, false);
});

test("validateAuditEvent error path returns ok=false (privilege-waive without reason)", () => {
  const r = validateAuditEvent(readJson(join(invalidDir, "audit-event-privilege-waive-no-reason.json")));
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// assertCaseBoxIsSubordinateToOcr — programmatic guard mirroring the schema's
// direction=const literal at IPC / persistence boundaries.
// ---------------------------------------------------------------------------

test("assertCaseBoxIsSubordinateToOcr passes for read-only direction", () => {
  assert.doesNotThrow(() => assertCaseBoxIsSubordinateToOcr({ direction: "read-only" }));
});

test("assertCaseBoxIsSubordinateToOcr throws OcrSubordinationError for any other direction", () => {
  assert.throws(() => assertCaseBoxIsSubordinateToOcr({ direction: "read-write" }), OcrSubordinationError);
  assert.throws(() => assertCaseBoxIsSubordinateToOcr({}), OcrSubordinationError);
  assert.throws(() => assertCaseBoxIsSubordinateToOcr({ direction: null }), OcrSubordinationError);
});

// ---------------------------------------------------------------------------
// Type-narrowing smoke: ok=true must narrow `value` to the typed shape.
// (Pure runtime check — TS narrowing is enforced by tsc on the .ts side.)
// ---------------------------------------------------------------------------

test("ok=true result narrows value (runtime smoke)", () => {
  const r = validateMatter(readJson(join(validDir, "matter.valid.json")));
  if (r.ok) {
    assert.equal(typeof r.value.id, "string");
    assert.equal(typeof r.value.actor_user_id, "string");
  } else {
    throw new Error("expected ok=true");
  }
});
