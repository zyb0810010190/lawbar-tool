// renderer-error-message.test.mjs — safe zh-CN error display mapping
// (WI-DESKTOP-ZH-CN-ERROR-SURFACES-04). Proves: every stable error CODE maps to
// a zh-CN safe message; unknown/missing codes fall back to error.unknown; and the
// raw English `message` (which may carry identifiers / SQL / paths) is NEVER
// surfaced — only the code-keyed catalog string is returned.

import { test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage, KNOWN_ERROR_CODES } from "../dist/renderer/i18n/errorMessage.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";

// The stable CaseBoxPersistenceErrorCode set + the mapThrownError fallback.
// Derived from the single source of truth (KNOWN_ERROR_CODES) rather than a
// hardcoded list, so a new persistence code (kept in step by the contract-sync
// test below) is automatically covered here — and each code is asserted to carry
// an error.<code> zh-CN catalog entry, which the app requires at runtime.
const CODES = [...KNOWN_ERROR_CODES];

test("every stable error code maps to its zh-CN catalog message", () => {
  for (const code of CODES) {
    const key = `error.${code}`;
    assert.equal(errorMessage({ code }), CATALOG[key], `code ${code} → ${key}`);
    // The message is real zh-CN copy (contains a CJK character), never English.
    assert.match(errorMessage({ code }), /[一-鿿]/, `${code} must render Chinese`);
  }
});

test("unknown / missing code falls back to error.unknown", () => {
  assert.equal(errorMessage({ code: "SOME_FUTURE_CODE" }), CATALOG["error.unknown"]);
  assert.equal(errorMessage({}), CATALOG["error.unknown"]);
  assert.equal(errorMessage({ code: undefined }), CATALOG["error.unknown"]);
  assert.equal(errorMessage({ code: "" }), CATALOG["error.unknown"]);
});

test("the raw English/diagnostic message is NEVER surfaced — only the code-keyed string", () => {
  // A hostile/leaky raw message must be ignored entirely; output depends only on code.
  const leaky = {
    code: "invalid_payload",
    message:
      "SQLITE_CONSTRAINT: UNIQUE failed at /Users/lawyer/Library/Application Support/lawbar/case-box.sqlite; tenant=acme-123 <script>alert(1)</script>",
  };
  const shown = errorMessage(leaky);
  assert.equal(shown, CATALOG["error.invalid_payload"]);
  // No fragment of the raw message leaks through.
  assert.doesNotMatch(shown, /SQLITE|sqlite|Application Support|tenant=|script|acme-123/);
});

test("the mapping does not depend on message presence (code-only envelopes work)", () => {
  assert.equal(errorMessage({ code: "unknown_matter" }), CATALOG["error.unknown_matter"]);
});

// --- contract-sync: renderer error-code set stays in step with case-box-persistence ---
// (Addresses the WI-04 audit Low: the renderer duplicates the code list because
//  CaseBoxPersistenceErrorCode is a type-only export. This test fails if the
//  persistence union gains/loses a code without the renderer + catalog keeping up.)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// KNOWN_ERROR_CODES is imported at the top of this file (single source of truth
// for the CODES table above); reused here for the contract-sync assertion.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function persistenceErrorCodes() {
  const dts = readFileSync(
    path.join(__dirname, "..", "node_modules", "case-box-persistence", "dist", "errors.d.ts"),
    "utf8",
  );
  const m = dts.match(/CaseBoxPersistenceErrorCode\s*=\s*([^;]+);/);
  assert.ok(m, "could not locate CaseBoxPersistenceErrorCode union in errors.d.ts");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

test("KNOWN_ERROR_CODES matches EXACTLY the case-box-persistence CaseBoxPersistenceErrorCode union", () => {
  const contract = persistenceErrorCodes().sort();
  const renderer = [...KNOWN_ERROR_CODES].sort();
  assert.deepEqual(
    renderer,
    contract,
    "renderer KNOWN_ERROR_CODES drifted from case-box-persistence codes — add the new error.<code> " +
      "catalog key + KNOWN_ERROR_CODES entry (or remove the stale one).",
  );
});

test("every known error code has an error.<code> catalog key; error.unknown exists", () => {
  for (const code of KNOWN_ERROR_CODES) {
    assert.ok(`error.${code}` in CATALOG, `missing catalog key error.${code}`);
  }
  assert.ok("error.unknown" in CATALOG, "missing catalog key error.unknown");
});
