// Verifies the load-bearing seam in validateOcrJobOutcome:
//
//   if (!ajv.getSchema(RESULT_SCHEMA_ID)) ajv.addSchema(resultSchema);
//
// When `validateOcrJobOutcome` is the FIRST validator invoked in a Node
// process, `validateOcrResult` has not yet compiled `resultSchema` onto
// the shared Ajv instance. The outcome schema's cross-$ref would then
// fail to resolve without this guard. This test file intentionally calls
// NO other validator from `../dist/index.js` before validateOcrJobOutcome
// so the guard branch is exercised in isolation.
//
// `node --test` runs each test-file argument in its own subprocess
// (Node 22+ default), so the module-level Ajv state is fresh per file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validateOcrJobOutcome } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const validDir = join(here, "..", "fixtures", "valid");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

test("validateOcrJobOutcome registers resultSchema on first call when validateOcrResult has not run", () => {
  // First validator call in this process. If the addSchema guard inside
  // getValidator() did not run, the cross-$ref to ocr-result.schema.json
  // would fail at compile time and getValidator() would throw.
  const r = validateOcrJobOutcome(readJson(join(validDir, "ocr-job-outcome.example.json")));
  assert.equal(r.ok, true, r.ok ? "" : r.summary);
});

test("validateOcrJobOutcome remains idempotent on a second call", () => {
  // After the first call, the validator is cached. A second call should
  // not throw "schema with key or id already exists" — that's why
  // getValidator() guards with ajv.getSchema before addSchema.
  const r = validateOcrJobOutcome(readJson(join(validDir, "ocr-job-outcome.example.json")));
  assert.equal(r.ok, true, r.ok ? "" : r.summary);
});
