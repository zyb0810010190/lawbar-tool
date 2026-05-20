// Invariant tests: local-first defaults, OCR subordination, opt-in flags.
// These tests pin the v1 product-direction commitments encoded by the
// contract package. See docs/adr/case-box-step-0-boundary.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  isLocalOnlyActor,
  LOCAL_ONLY_ACTOR_USER_ID,
  defaultsAreLocalFirst,
  classAllowsExternal,
  validateMatter,
  validateOcrLink,
  validateFact,
  assertCaseBoxIsSubordinateToOcr,
  OcrSubordinationError,
  ocrLinkSchema,
  isFactCandidateOnly,
  factWasMachineExtracted,
  isMachineExtractedCandidate,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const validDir = join(root, "fixtures", "valid");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------------------------------------------------------------------------
// Local-only actor sentinel.
// ---------------------------------------------------------------------------

test("LOCAL_ONLY_ACTOR_USER_ID is exactly 'local-user'", () => {
  assert.equal(LOCAL_ONLY_ACTOR_USER_ID, "local-user");
});

test("isLocalOnlyActor('local-user') is true; any other value is false", () => {
  assert.equal(isLocalOnlyActor("local-user"), true);
  assert.equal(isLocalOnlyActor("zyb@example.com"), false);
  assert.equal(isLocalOnlyActor(""), false);
  assert.equal(isLocalOnlyActor("LOCAL-USER"), false);
});

// ---------------------------------------------------------------------------
// Local-first matter defaults.
// ---------------------------------------------------------------------------

test("defaultsAreLocalFirst: all three opt-in flags false → true", () => {
  assert.equal(
    defaultsAreLocalFirst({
      external_ocr_authorized: false,
      sync_grant_present: false,
      llm_extraction_opt_in: false,
    }),
    true,
  );
});

test("defaultsAreLocalFirst: flipping any flag flips the helper", () => {
  for (const flag of ["external_ocr_authorized", "sync_grant_present", "llm_extraction_opt_in"]) {
    const m = { external_ocr_authorized: false, sync_grant_present: false, llm_extraction_opt_in: false };
    m[flag] = true;
    assert.equal(defaultsAreLocalFirst(m), false, `flipping ${flag} should flip helper`);
  }
});

test("defaultsAreLocalFirst: missing flags → false (not local-first because shape is incomplete)", () => {
  assert.equal(defaultsAreLocalFirst({}), false);
  assert.equal(defaultsAreLocalFirst({ external_ocr_authorized: false }), false);
});

test("valid matter fixture satisfies defaultsAreLocalFirst", () => {
  const r = validateMatter(readJson(join(validDir, "matter.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(defaultsAreLocalFirst(r.value), true);
});

// ---------------------------------------------------------------------------
// Confidentiality class gate.
// ---------------------------------------------------------------------------

test("classAllowsExternal: only 'normal' returns true", () => {
  assert.equal(classAllowsExternal("normal"), true);
  assert.equal(classAllowsExternal("heightened"), false);
  assert.equal(classAllowsExternal("sealed"), false);
  assert.equal(classAllowsExternal(""), false);
});

// ---------------------------------------------------------------------------
// OCR subordination — schema pins direction=const; assert helper at boundary.
// ---------------------------------------------------------------------------

test("ocr-link schema pins direction to the literal 'read-only'", () => {
  const dir = ocrLinkSchema.properties?.direction;
  assert.ok(dir && typeof dir === "object", "direction property must exist");
  assert.equal(dir.const, "read-only");
});

test("valid ocr-link fixture is direction=read-only", () => {
  const r = validateOcrLink(readJson(join(validDir, "ocr-link.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.direction, "read-only");
});

test("assertCaseBoxIsSubordinateToOcr rejects any non-read-only direction", () => {
  assert.throws(() => assertCaseBoxIsSubordinateToOcr({ direction: "write" }), OcrSubordinationError);
  assert.throws(() => assertCaseBoxIsSubordinateToOcr({ direction: "" }), OcrSubordinationError);
});

// ---------------------------------------------------------------------------
// Tenant + actor forward-compat shape: every entity carries both fields.
// ---------------------------------------------------------------------------

test("every entity fixture carries tenant_id and actor_user_id", () => {
  const fixtures = [
    "matter.valid.json",
    "document.valid.json",
    "deadline.valid.json",
    "evidence-item.valid.json",
    "ocr-link.valid.json",
    "audit-event.valid.json",
    "fact-candidate-lawyer-authored.valid.json",
    "fact-candidate-llm.valid.json",
    "fact-candidate-ocr-excerpt.valid.json",
    "fact-candidate-imported.valid.json",
    "fact-accepted-lawyer-authored.valid.json",
    "fact-accepted-supersedes-prior.valid.json",
    "fact-rejected.valid.json",
    "privilege-marker-proposed-llm.valid.json",
    "privilege-marker-proposed-lawyer-draft.valid.json",
    "privilege-marker-confirmed-lawyer-direct.valid.json",
    "privilege-marker-confirmed-on-fact.valid.json",
    "privilege-marker-dismissed.valid.json",
    "privilege-marker-waived.valid.json",
  ];
  for (const f of fixtures) {
    const data = readJson(join(validDir, f));
    assert.equal(typeof data.tenant_id, "string", `${f} missing tenant_id`);
    assert.equal(typeof data.actor_user_id, "string", `${f} missing actor_user_id`);
  }
});

// ---------------------------------------------------------------------------
// Fact helpers.
// ---------------------------------------------------------------------------

test("isFactCandidateOnly truth table", () => {
  assert.equal(isFactCandidateOnly({ status: "candidate" }), true);
  assert.equal(isFactCandidateOnly({ status: "reviewed" }), false);
  assert.equal(isFactCandidateOnly({ status: "accepted" }), false);
  assert.equal(isFactCandidateOnly({ status: "rejected" }), false);
});

test("factWasMachineExtracted: machine source types true, lawyer false", () => {
  assert.equal(factWasMachineExtracted({ source_type: "llm_extraction" }), true);
  assert.equal(factWasMachineExtracted({ source_type: "ocr_excerpt" }), true);
  assert.equal(factWasMachineExtracted({ source_type: "imported" }), true);
  assert.equal(factWasMachineExtracted({ source_type: "lawyer_authored" }), false);
});

test("isMachineExtractedCandidate true iff candidate AND machine source", () => {
  assert.equal(isMachineExtractedCandidate({ status: "candidate", source_type: "llm_extraction" }), true);
  assert.equal(isMachineExtractedCandidate({ status: "candidate", source_type: "lawyer_authored" }), false);
  assert.equal(isMachineExtractedCandidate({ status: "accepted",  source_type: "llm_extraction" }), false);
  assert.equal(isMachineExtractedCandidate({ status: "rejected",  source_type: "ocr_excerpt" }), false);
});

test("valid fact fixtures all parse via validateFact", () => {
  const fixtures = [
    "fact-candidate-lawyer-authored.valid.json",
    "fact-candidate-llm.valid.json",
    "fact-candidate-ocr-excerpt.valid.json",
    "fact-candidate-imported.valid.json",
    "fact-accepted-lawyer-authored.valid.json",
    "fact-accepted-supersedes-prior.valid.json",
    "fact-rejected.valid.json",
  ];
  for (const f of fixtures) {
    const r = validateFact(readJson(join(validDir, f)));
    assert.equal(r.ok, true, `${f} should validate (got ${r.ok === false ? r.summary : "ok"})`);
  }
});

test("fact source_ocr_job_id remains opaque string (OCR subordination preserved)", () => {
  const ocrExcerpt = readJson(join(validDir, "fact-candidate-ocr-excerpt.valid.json"));
  assert.equal(typeof ocrExcerpt.source_ocr_job_id, "string");
  // schema does not cross-$ref to OCR; the value is a free string, not a UUID/ULID constraint inherited from OCR.
});

test("party fixture (embedded shape) does NOT require tenant/actor (lives inside matter)", () => {
  const data = readJson(join(validDir, "party.valid.json"));
  assert.equal("tenant_id" in data, false);
  assert.equal("actor_user_id" in data, false);
});
