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
  assertCaseBoxIsSubordinateToOcr,
  OcrSubordinationError,
  ocrLinkSchema,
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
  ];
  for (const f of fixtures) {
    const data = readJson(join(validDir, f));
    assert.equal(typeof data.tenant_id, "string", `${f} missing tenant_id`);
    assert.equal(typeof data.actor_user_id, "string", `${f} missing actor_user_id`);
  }
});

test("party fixture (embedded shape) does NOT require tenant/actor (lives inside matter)", () => {
  const data = readJson(join(validDir, "party.valid.json"));
  assert.equal("tenant_id" in data, false);
  assert.equal("actor_user_id" in data, false);
});
