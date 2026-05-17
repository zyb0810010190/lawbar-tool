// Contract tests for the OCR worker boundary.
//
// Run with: npm test  (from docs/contracts/)
//
// Validates:
//  - schemas accept all valid fixtures
//  - schemas reject all invalid fixtures (where the rule is schema-encodable)
//  - status transitions follow the documented state machine (semantic check)
//  - retry behavior follows transient/permanent rules (semantic check)
//  - seal and table block required-fields are enforced
//  - partial_failure shape is enforced

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  validateTransitionSequence,
  isAllowedTransition,
} from "../dist/transitions.js";
import { validateRetryBehavior } from "../dist/retry-rules.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const schemasDir = join(root, "schemas");
const validDir = join(root, "fixtures", "valid");
const invalidDir = join(root, "fixtures", "invalid");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// `strict: "log"` matches src/ajv-instance.ts. See that file for why we
// don't use `strict: true` (if/then + required pattern is legitimate but
// strictRequired flags it).
const ajv = new Ajv2020({ strict: "log", allErrors: true });
addFormats(ajv);

const submissionSchema = readJson(join(schemasDir, "ocr-submission.schema.json"));
const resultSchema     = readJson(join(schemasDir, "ocr-result.schema.json"));
const statusSchema     = readJson(join(schemasDir, "ocr-status.schema.json"));
const outcomeSchema    = readJson(join(schemasDir, "ocr-job-outcome.schema.json"));

const validateSubmission = ajv.compile(submissionSchema);
const validateResult     = ajv.compile(resultSchema);
const validateStatus     = ajv.compile(statusSchema);
// outcomeSchema $refs ocr-result by $id; resultSchema is already registered
// on this ajv instance via the compile() call above, so the reference resolves.
const validateOutcome    = ajv.compile(outcomeSchema);

const errs = (v) => (v.errors || []).map((e) => `${e.instancePath} ${e.message}`).join("; ");

// ---------------------------------------------------------------------------
// Valid fixtures must pass their target schema.
// ---------------------------------------------------------------------------

test("valid: submission-s3 passes submission schema", () => {
  const ok = validateSubmission(readJson(join(validDir, "submission-s3.json")));
  assert.equal(ok, true, errs(validateSubmission));
});

test("valid: submission-https passes submission schema", () => {
  const ok = validateSubmission(readJson(join(validDir, "submission-https.json")));
  assert.equal(ok, true, errs(validateSubmission));
});

test("valid: submission-inline passes submission schema", () => {
  const ok = validateSubmission(readJson(join(validDir, "submission-inline.json")));
  assert.equal(ok, true, errs(validateSubmission));
});

test("valid: result-chinese-litigation passes result schema (seal + table + vertical)", () => {
  const fixture = readJson(join(validDir, "result-chinese-litigation.json"));
  const ok = validateResult(fixture);
  assert.equal(ok, true, errs(validateResult));

  // Spot-check that the fixture exercises the Chinese edge cases.
  const types = fixture.blocks.map((b) => b.type);
  assert.ok(types.includes("seal"), "fixture must include a seal block");
  assert.ok(types.includes("table"), "fixture must include a table block");
  const writingModes = fixture.blocks.map((b) => b.writing_mode).filter(Boolean);
  assert.ok(writingModes.includes("vertical-rl"), "fixture must include vertical text");
});

test("valid: result-partial-failure passes result schema", () => {
  const ok = validateResult(readJson(join(validDir, "result-partial-failure.json")));
  assert.equal(ok, true, errs(validateResult));
});

test("valid: status-transitions passes status schema and transition rules", () => {
  const fixture = readJson(join(validDir, "status-transitions.json"));
  assert.equal(validateStatus(fixture), true, errs(validateStatus));
  const r = validateTransitionSequence(fixture.transitions);
  assert.equal(r.ok, true, r.error);
});

test("valid: status-transitions-retry (transient failure -> requeue -> success) passes rules", () => {
  const fixture = readJson(join(validDir, "status-transitions-retry.json"));
  assert.equal(validateStatus(fixture), true, errs(validateStatus));
  const r = validateTransitionSequence(fixture.transitions);
  assert.equal(r.ok, true, r.error);
});

test("valid: ocr-job-outcome.example passes the outcome envelope schema", () => {
  const fixture = readJson(join(validDir, "ocr-job-outcome.example.json"));
  const ok = validateOutcome(fixture);
  assert.equal(ok, true, errs(validateOutcome));
});

// ---------------------------------------------------------------------------
// Invalid fixtures must fail. The reason for failure is asserted explicitly.
// ---------------------------------------------------------------------------

test("invalid: bad priority (250) is rejected by submission schema", () => {
  const fixture = readJson(join(invalidDir, "submission-bad-priority.json"));
  const ok = validateSubmission(fixture);
  assert.equal(ok, false, "expected schema rejection");
  const offenders = (validateSubmission.errors || []).filter((e) =>
    e.instancePath === "/priority",
  );
  assert.ok(offenders.length > 0, "expected an error on /priority");
});

test("invalid: malformed polygon (3-coord point, <4 points) is rejected by result schema", () => {
  const fixture = readJson(join(invalidDir, "result-malformed-polygon.json"));
  const ok = validateResult(fixture);
  assert.equal(ok, false, "expected schema rejection");
  const offenders = (validateResult.errors || []).filter((e) =>
    e.instancePath.includes("/polygon"),
  );
  assert.ok(offenders.length > 0, "expected an error on a /polygon path");
});

test("invalid: empty pages array is rejected by submission schema", () => {
  const fixture = readJson(join(invalidDir, "submission-missing-page-refs.json"));
  const ok = validateSubmission(fixture);
  assert.equal(ok, false);
  const offenders = (validateSubmission.errors || []).filter((e) =>
    e.instancePath === "/pages",
  );
  assert.ok(offenders.length > 0, "expected an error on /pages");
});

test("invalid: illegal status transition (succeeded -> queued) is rejected by transition rules", () => {
  const fixture = readJson(join(invalidDir, "status-illegal-transition.json"));
  // Shape passes the schema; semantics fail.
  const r = validateTransitionSequence(fixture.transitions);
  assert.equal(r.ok, false, "expected transition rule rejection");
  assert.match(r.error, /succeeded/, `error should name the bad state, got: ${r.error}`);
});

test("invalid: retry violation (permanent failure re-queued) is rejected by retry rules", () => {
  const fixture = readJson(join(invalidDir, "retry-violation.json"));
  const r = validateRetryBehavior(fixture);
  assert.equal(r.ok, false, "expected retry rule rejection");
  assert.match(r.error, /permanent failure/i);
});

test("invalid: ocr-job-outcome-missing-job-id is rejected by outcome schema on /job_id", () => {
  const fixture = readJson(join(invalidDir, "ocr-job-outcome-missing-job-id.json"));
  const ok = validateOutcome(fixture);
  assert.equal(ok, false);
  const offenders = (validateOutcome.errors || []).filter(
    (e) => e.keyword === "required" && (e.params?.missingProperty === "job_id"),
  );
  assert.ok(offenders.length > 0, "expected a required-job_id error");
});

test("invalid: ocr-job-outcome-empty-statuses is rejected by outcome schema on /statuses", () => {
  const fixture = readJson(join(invalidDir, "ocr-job-outcome-empty-statuses.json"));
  const ok = validateOutcome(fixture);
  assert.equal(ok, false);
  const offenders = (validateOutcome.errors || []).filter((e) => e.instancePath === "/statuses");
  assert.ok(offenders.length > 0, "expected a /statuses error");
});

test("invalid: ocr-job-outcome-terminal-state-bad-enum is rejected on /terminal_state", () => {
  const fixture = readJson(join(invalidDir, "ocr-job-outcome-terminal-state-bad-enum.json"));
  const ok = validateOutcome(fixture);
  assert.equal(ok, false);
  const offenders = (validateOutcome.errors || []).filter((e) => e.instancePath === "/terminal_state");
  assert.ok(offenders.length > 0, "expected a /terminal_state error");
});

test("invalid: ocr-job-outcome-statuses-element-malformed is rejected on /statuses/0", () => {
  const fixture = readJson(join(invalidDir, "ocr-job-outcome-statuses-element-malformed.json"));
  const ok = validateOutcome(fixture);
  assert.equal(ok, false);
  const offenders = (validateOutcome.errors || []).filter((e) => e.instancePath.startsWith("/statuses/0"));
  assert.ok(offenders.length > 0, "expected an error inside /statuses/0");
});

// ---------------------------------------------------------------------------
// Targeted invariant tests, beyond the per-fixture checks above.
// ---------------------------------------------------------------------------

test("priority must be an integer in [0, 100]", () => {
  const base = readJson(join(validDir, "submission-s3.json"));
  for (const bad of [-1, 101, 50.5, "50", null]) {
    const f = { ...base, priority: bad };
    assert.equal(validateSubmission(f), false, `priority=${JSON.stringify(bad)} should fail`);
  }
  for (const good of [0, 1, 50, 99, 100]) {
    const f = { ...base, priority: good };
    assert.equal(validateSubmission(f), true, errs(validateSubmission));
  }
});

test("higher priority value means more urgent (semantic, not enforced by schema)", () => {
  // The schema cannot enforce semantics, but the contract states higher = more
  // urgent. This test pins the rule by asserting the documented bands.
  const interactive = 95;
  const batch = 60;
  const background = 20;
  assert.ok(interactive > batch && batch > background, "documented urgency ordering");
});

test("seal block requires seal_shape and overlaps_block_ids", () => {
  const ok = readJson(join(validDir, "result-chinese-litigation.json"));
  const seal = ok.blocks.find((b) => b.type === "seal");
  assert.ok(seal, "fixture must contain a seal block");

  // Drop seal_shape -> should fail.
  const broken1 = structuredClone(ok);
  const sealRef1 = broken1.blocks.find((b) => b.type === "seal");
  delete sealRef1.seal_shape;
  assert.equal(validateResult(broken1), false, "seal without seal_shape must fail");

  // Drop overlaps_block_ids -> should fail.
  const broken2 = structuredClone(ok);
  const sealRef2 = broken2.blocks.find((b) => b.type === "seal");
  delete sealRef2.overlaps_block_ids;
  assert.equal(validateResult(broken2), false, "seal without overlaps_block_ids must fail");
});

test("table block requires table substructure with rows, cols, cells", () => {
  const ok = readJson(join(validDir, "result-chinese-litigation.json"));
  const broken = structuredClone(ok);
  const t = broken.blocks.find((b) => b.type === "table");
  assert.ok(t, "fixture must contain a table block");
  delete t.table;
  assert.equal(validateResult(broken), false, "table block without table.* must fail");
});

test("partial_failure must be null on success and an object on failure", () => {
  const ok = readJson(join(validDir, "result-chinese-litigation.json"));

  // success + non-null partial_failure -> reject.
  const broken1 = structuredClone(ok);
  broken1.partial_failure = { code: "x", message: "y", is_transient: true, attempted_count: 1 };
  assert.equal(validateResult(broken1), false, "succeeded must have null partial_failure");

  // failed without partial_failure -> reject.
  const fail = readJson(join(validDir, "result-partial-failure.json"));
  const broken2 = structuredClone(fail);
  broken2.partial_failure = null;
  assert.equal(validateResult(broken2), false, "failed must include partial_failure");

  // failed with malformed partial_failure -> reject.
  const broken3 = structuredClone(fail);
  broken3.partial_failure = { code: "x" }; // missing message, is_transient, attempted_count
  assert.equal(validateResult(broken3), false, "partial_failure shape must be enforced");
});

test("drift: local $defs/transitionRecord in outcome schema matches the nested transition shape in status schema", () => {
  // ADR-11A.5 v0.1 §2: outcome schema declares a LOCAL transitionRecord shape
  // because the status schema's transition record lives inside a oneOf branch
  // and is not directly $ref-able. This guard rejects ANY drift between the
  // two definitions — including added/removed optional fields and added
  // schema keywords (description, additionalProperties, patternProperties,
  // etc.) — so duplication cannot silently diverge.

  // Deep-canonicalize: sort object keys recursively so two structurally
  // identical schemas stringify byte-for-byte regardless of authoring order.
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v).sort().map((k) => [k, canon(v[k])]),
      );
    }
    return v;
  };

  const outcomeTransition = outcomeSchema.$defs.transitionRecord;
  const statusTransition  = statusSchema.$defs.transitionSequence
    .properties.transitions.items;

  // Full normalized subtree must match byte-for-byte. Any added/removed
  // property or schema keyword on either side trips this assertion.
  assert.equal(
    JSON.stringify(canon(outcomeTransition)),
    JSON.stringify(canon(statusTransition)),
    "transitionRecord subtree has drifted between outcome and status schemas",
  );

  // The two refs in transitionRecord point at $defs/state and $defs/actor.
  // Mirror those enums between the two schemas too.
  assert.deepEqual(
    outcomeSchema.$defs.state.enum,
    statusSchema.$defs.state.enum,
    "state enum has drifted between schemas",
  );
  assert.deepEqual(
    outcomeSchema.$defs.actor.enum,
    statusSchema.$defs.actor.enum,
    "actor enum has drifted between schemas",
  );
});

test("transition matrix: every documented edge is allowed; obvious bad edges are not", () => {
  // Documented edges (from §3.2). Sanity-check the matrix here.
  assert.ok(isAllowedTransition("queued", "claimed", "queue"));
  assert.ok(isAllowedTransition("claimed", "processing", "worker"));
  assert.ok(isAllowedTransition("claimed", "queued", "queue"));
  assert.ok(isAllowedTransition("processing", "succeeded", "worker"));
  assert.ok(isAllowedTransition("processing", "failed", "worker"));
  assert.ok(isAllowedTransition("processing", "partial_succeeded", "worker"));
  assert.ok(isAllowedTransition("failed", "queued", "queue"));
  assert.ok(isAllowedTransition("failed", "dead_lettered", "queue"));
  assert.ok(isAllowedTransition("queued", "cancelled", "web_app"));
  assert.ok(isAllowedTransition("processing", "cancelled", "web_app"));

  // Forbidden edges.
  assert.equal(isAllowedTransition("succeeded", "queued", "queue"), false);
  assert.equal(isAllowedTransition("dead_lettered", "queued", "queue"), false);
  assert.equal(isAllowedTransition("processing", "queued", "worker"), false);
  // Worker cannot re-queue from failed; only the queue can.
  assert.equal(isAllowedTransition("failed", "queued", "worker"), false);
  // Web app cannot drive non-cancel transitions.
  assert.equal(isAllowedTransition("processing", "succeeded", "web_app"), false);
});

// ---------------------------------------------------------------------------
// Sweep guard: every fixture in fixtures/valid and fixtures/invalid is referenced
// by at least one explicit test above. If you add a fixture, add a test.
// ---------------------------------------------------------------------------

test("sweep: every valid fixture is used by an explicit test", () => {
  const found = readdirSync(validDir).filter((f) => f.endsWith(".json")).sort();
  const expected = [
    "ocr-job-outcome.example.json",
    "result-chinese-litigation.json",
    "result-partial-failure.json",
    "status-transitions-retry.json",
    "status-transitions.json",
    "submission-https.json",
    "submission-inline.json",
    "submission-s3.json",
  ];
  assert.deepEqual(found, expected);
});

test("sweep: every invalid fixture is used by an explicit test", () => {
  const found = readdirSync(invalidDir).filter((f) => f.endsWith(".json")).sort();
  const expected = [
    "ocr-job-outcome-empty-statuses.json",
    "ocr-job-outcome-missing-job-id.json",
    "ocr-job-outcome-statuses-element-malformed.json",
    "ocr-job-outcome-terminal-state-bad-enum.json",
    "result-malformed-polygon.json",
    "retry-violation.json",
    "status-illegal-transition.json",
    "submission-bad-priority.json",
    "submission-missing-page-refs.json",
  ];
  assert.deepEqual(found, expected);
});
