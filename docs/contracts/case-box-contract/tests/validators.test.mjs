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
  validateFact,
  assertCaseBoxIsSubordinateToOcr,
  assertFactPromotionInvariants,
  assertValidNewFact,
  FactPromotionInvariantError,
  FactCreationInvariantError,
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

test("validateFact happy path: candidate-lawyer-authored ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-candidate-lawyer-authored.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "candidate");
  assert.equal(r.value.source_type, "lawyer_authored");
});

test("validateFact happy path: candidate-llm ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-candidate-llm.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.extractor_name, "claude-opus-4-7");
});

test("validateFact happy path: candidate-ocr-excerpt ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-candidate-ocr-excerpt.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.source_type, "ocr_excerpt");
});

test("validateFact happy path: candidate-imported ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-candidate-imported.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.extractor_name, "clio-import-v1");
});

test("validateFact happy path: accepted-lawyer-authored ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-accepted-lawyer-authored.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "accepted");
});

test("validateFact happy path: accepted-supersedes-prior ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-accepted-supersedes-prior.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(typeof r.value.supersedes_fact_id, "string");
});

test("validateFact happy path: rejected ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-rejected.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "rejected");
  assert.equal(typeof r.value.rejection_reason, "string");
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

test("validateFact error path: candidate with accepted_at returns ok=false (N1)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-candidate-with-accepted-at.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: accepted with no reviewer returns ok=false (N3)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-accepted-no-reviewer.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: rejected with no reason returns ok=false (N4)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-rejected-no-reason.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: lawyer_authored with extractor_name returns ok=false (N5)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-lawyer-authored-with-extractor.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: llm_extraction without extractor_name returns ok=false (N6)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-llm-without-extractor-name.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: imported without extractor_name returns ok=false (N6.5)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-imported-without-extractor-name.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: ocr_excerpt missing fields returns ok=false (N7)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-ocr-excerpt-missing-fields.json")));
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// assertFactPromotionInvariants — validator-only checks.
// ---------------------------------------------------------------------------

test("assertFactPromotionInvariants passes on accepted with no supersedes", () => {
  const fact = readJson(join(validDir, "fact-accepted-lawyer-authored.valid.json"));
  assert.doesNotThrow(() => assertFactPromotionInvariants(fact));
});

test("assertFactPromotionInvariants passes on accepted with supersedes pointing elsewhere", () => {
  const fact = readJson(join(validDir, "fact-accepted-supersedes-prior.valid.json"));
  assert.doesNotThrow(() => assertFactPromotionInvariants(fact));
});

test("assertFactPromotionInvariants throws on self-cycle (id === supersedes_fact_id)", () => {
  const fact = readJson(join(root, "fixtures", "semantic-invalid", "fact-superseded-self-cycle.json"));
  assert.throws(() => assertFactPromotionInvariants(fact), FactPromotionInvariantError);
});

test("assertFactPromotionInvariants throws when supersedes set on non-accepted status", () => {
  const fact = {
    id: "01jrcasebox000000000000fxa",
    status: "candidate",
    supersedes_fact_id: "01jrcasebox000000000000fxb",
  };
  assert.throws(() => assertFactPromotionInvariants(fact), FactPromotionInvariantError);
});

test("assertFactPromotionInvariants treats undefined supersedes_fact_id as null (no throw)", () => {
  const fact = { id: "01jrcasebox000000000000fxc", status: "candidate" };
  assert.doesNotThrow(() => assertFactPromotionInvariants(fact));
});

// ---------------------------------------------------------------------------
// assertValidNewFact — creation-rule guard. Every promotion field must be null
// and status must be candidate. No exceptions.
// ---------------------------------------------------------------------------

test("assertValidNewFact passes for a clean candidate row", () => {
  const fact = readJson(join(validDir, "fact-candidate-lawyer-authored.valid.json"));
  assert.doesNotThrow(() => assertValidNewFact(fact));
});

test("assertValidNewFact throws when status !== candidate (load-bearing for no-auto-accept)", () => {
  const fact = readJson(join(validDir, "fact-accepted-lawyer-authored.valid.json"));
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

test("assertValidNewFact throws when status=candidate but reviewer_actor_user_id set", () => {
  const fact = { status: "candidate", reviewer_actor_user_id: "local-user" };
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

test("assertValidNewFact throws when status=candidate but accepted_at set", () => {
  const fact = { status: "candidate", accepted_at: "2026-05-20T12:00:00.000Z" };
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

test("assertValidNewFact throws when status=candidate but supersedes_fact_id set", () => {
  const fact = { status: "candidate", supersedes_fact_id: "01jrcasebox000000000000aaa" };
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

test("assertValidNewFact throws for status=reviewed (only candidate is allowed at creation)", () => {
  const fact = {
    status: "reviewed",
    reviewer_actor_user_id: "local-user",
    reviewed_at: "2026-05-20T12:00:00.000Z",
  };
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

test("assertValidNewFact throws for status=rejected", () => {
  const fact = {
    status: "rejected",
    reviewer_actor_user_id: "local-user",
    reviewed_at: "2026-05-20T12:00:00.000Z",
    rejected_at: "2026-05-20T12:00:30.000Z",
    rejection_reason: "no",
  };
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
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
