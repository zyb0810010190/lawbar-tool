// Validator API tests. Imports the compiled package surface from ../dist/.
// `npm test` builds first via the prebuild + build chain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validateOcrSubmission,
  validateOcrResult,
  validateOcrJobOutcome,
  validateOcrStatusEnvelope,
  validateOcrStatusTransitionSequence,
  assertValidOcrStatusTransition,
  IllegalTransitionError,
  classifyOcrFailureForRetry,
  validateRetryBehavior,
  validateRetryCounters,
  RetryPolicyError,
  ALLOWED_EDGES,
  TERMINAL_STATES,
  isTerminalState,
  submissionSchema,
  resultSchema,
  statusSchema,
  outcomeSchema,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const validDir = join(root, "fixtures", "valid");
const invalidDir = join(root, "fixtures", "invalid");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------------------------------------------------------------------------
// validateOcrSubmission
// ---------------------------------------------------------------------------

test("validateOcrSubmission: every valid submission fixture passes and returns ok=true with value", () => {
  for (const fname of ["submission-s3.json", "submission-https.json", "submission-inline.json"]) {
    const fixture = readJson(join(validDir, fname));
    const r = validateOcrSubmission(fixture);
    assert.equal(r.ok, true, r.ok ? "" : r.summary);
    if (r.ok) {
      assert.equal(r.value.contract_version, fixture.contract_version);
      assert.equal(r.value.job_id, fixture.job_id);
    }
  }
});

test("validateOcrSubmission: bad-priority fixture returns ok=false and surfaces /priority Ajv error", () => {
  const fixture = readJson(join(invalidDir, "submission-bad-priority.json"));
  const r = validateOcrSubmission(fixture);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.summary, /priority/);
    const offender = r.errors.find((e) => e.instancePath === "/priority");
    assert.ok(offender, "expected an error on /priority");
    // Useful Ajv detail must be preserved.
    assert.equal(typeof offender.keyword, "string");
    assert.ok(offender.params, "params present");
  }
});

test("validateOcrSubmission: missing-page-refs fixture returns ok=false on /pages", () => {
  const fixture = readJson(join(invalidDir, "submission-missing-page-refs.json"));
  const r = validateOcrSubmission(fixture);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.instancePath === "/pages"));
  }
});

// ---------------------------------------------------------------------------
// validateOcrResult
// ---------------------------------------------------------------------------

test("validateOcrResult: valid Chinese litigation result passes", () => {
  const r = validateOcrResult(readJson(join(validDir, "result-chinese-litigation.json")));
  assert.equal(r.ok, true, r.ok ? "" : r.summary);
});

test("validateOcrResult: partial-failure fixture passes", () => {
  const r = validateOcrResult(readJson(join(validDir, "result-partial-failure.json")));
  assert.equal(r.ok, true, r.ok ? "" : r.summary);
});

test("validateOcrResult: malformed polygon fixture fails with /polygon Ajv error", () => {
  const r = validateOcrResult(readJson(join(invalidDir, "result-malformed-polygon.json")));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.instancePath.includes("/polygon")));
  }
});

// ---------------------------------------------------------------------------
// validateOcrStatusEnvelope / validateOcrStatusTransitionSequence
// ---------------------------------------------------------------------------

test("validateOcrStatusEnvelope: accepts a single envelope, rejects a sequence payload", () => {
  const envelope = {
    contract_version: "1.0.0",
    job_id: "01jrk8m4q4xv2v8d4d4ymf5xnk",
    tenant_id: "01jrk8m4q4xv2v8d4d4ymf5tnt",
    state: "processing",
    observed_at: "2026-04-27T08:14:33.200+08:00",
    metadata: {},
  };
  const ok = validateOcrStatusEnvelope(envelope);
  assert.equal(ok.ok, true, ok.ok ? "" : ok.summary);

  // A transition sequence validates against the schema (oneOf branch) but is
  // not a status envelope — the validator narrows to envelope only.
  const seq = readJson(join(validDir, "status-transitions.json"));
  const r = validateOcrStatusEnvelope(seq);
  assert.equal(r.ok, false, "sequence should not be accepted by envelope validator");
});

test("validateOcrStatusTransitionSequence: valid happy-path sequence passes", () => {
  const fixture = readJson(join(validDir, "status-transitions.json"));
  const r = validateOcrStatusTransitionSequence(fixture);
  assert.equal(r.ok, true, r.ok ? "" : r.summary);
});

test("validateOcrStatusTransitionSequence: valid retry-then-success sequence passes", () => {
  const fixture = readJson(join(validDir, "status-transitions-retry.json"));
  const r = validateOcrStatusTransitionSequence(fixture);
  assert.equal(r.ok, true, r.ok ? "" : r.summary);
});

test("validateOcrStatusTransitionSequence: illegal transition (succeeded -> queued) fails with semantic error", () => {
  const fixture = readJson(join(invalidDir, "status-illegal-transition.json"));
  const r = validateOcrStatusTransitionSequence(fixture);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.summary, /succeeded|terminal/i);
    // Semantic error is surfaced through the errors[] structure.
    const semantic = r.errors.find((e) => e.keyword === "transition");
    assert.ok(semantic, "expected a semantic transition error");
  }
});

// ---------------------------------------------------------------------------
// assertValidOcrStatusTransition
// ---------------------------------------------------------------------------

test("assertValidOcrStatusTransition: allowed edge with correct actor does not throw", () => {
  assertValidOcrStatusTransition("queued", "claimed", "queue");
  assertValidOcrStatusTransition("processing", "succeeded", "worker");
  assertValidOcrStatusTransition("processing", "cancelled", "web_app");
  // Without controlledBy, accepts edge owned by any actor.
  assertValidOcrStatusTransition("processing", "succeeded");
});

test("assertValidOcrStatusTransition: forbidden edge throws IllegalTransitionError", () => {
  assert.throws(
    () => assertValidOcrStatusTransition("succeeded", "queued", "queue"),
    IllegalTransitionError,
  );
  // Right edge but wrong actor also throws.
  assert.throws(
    () => assertValidOcrStatusTransition("failed", "queued", "worker"),
    IllegalTransitionError,
  );
});

// ---------------------------------------------------------------------------
// classifyOcrFailureForRetry
// ---------------------------------------------------------------------------

test("classifyOcrFailureForRetry: permanent failure -> dead_letter regardless of attempts", () => {
  const decision = classifyOcrFailureForRetry({
    status: "failed",
    failure: {
      code: "expected_sha256_mismatch",
      message: "hash mismatch",
      is_transient: false,
      attempted_count: 1,
    },
    retry: { max_attempts: 5, attempt: 1 },
  });
  assert.equal(decision.kind, "dead_letter");
});

test("classifyOcrFailureForRetry: transient failure with attempts remaining -> retry", () => {
  const decision = classifyOcrFailureForRetry({
    status: "failed",
    failure: { code: "fetch_timeout", message: "slow", is_transient: true, attempted_count: 1 },
    retry: { max_attempts: 3, attempt: 1 },
  });
  assert.equal(decision.kind, "retry");
  if (decision.kind === "retry") {
    assert.equal(decision.attemptsRemaining, 2);
  }
});

test("classifyOcrFailureForRetry: transient failure with attempts exhausted -> dead_letter", () => {
  const decision = classifyOcrFailureForRetry({
    status: "failed",
    failure: { code: "fetch_timeout", message: "slow", is_transient: true, attempted_count: 3 },
    retry: { max_attempts: 3, attempt: 3 },
  });
  assert.equal(decision.kind, "dead_letter");
});

test("classifyOcrFailureForRetry: succeeded status -> not_failed", () => {
  const decision = classifyOcrFailureForRetry({
    status: "succeeded",
    failure: null,
    retry: { max_attempts: 3, attempt: 1 },
  });
  assert.equal(decision.kind, "not_failed");
});

test("classifyOcrFailureForRetry: failed without partial_failure -> dead_letter (defensive)", () => {
  const decision = classifyOcrFailureForRetry({
    status: "failed",
    failure: null,
    retry: { max_attempts: 3, attempt: 1 },
  });
  assert.equal(decision.kind, "dead_letter");
});

// ---------------------------------------------------------------------------
// Cross-check: every fixture in fixtures/ is exercised by either contract.test
// or validators.test.
// ---------------------------------------------------------------------------

test("sweep: every valid fixture is referenced by a validator test (or by contract.test.mjs)", () => {
  const found = readdirSync(validDir).filter((f) => f.endsWith(".json")).sort();
  // Every name listed here must appear at least once above.
  const referenced = new Set([
    "submission-s3.json",
    "submission-https.json",
    "submission-inline.json",
    "result-chinese-litigation.json",
    "result-partial-failure.json",
    "status-transitions.json",
    "status-transitions-retry.json",
    "ocr-job-outcome.example.json",
  ]);
  for (const f of found) {
    assert.ok(referenced.has(f), `fixture ${f} has no validator test`);
  }
});

// ---------------------------------------------------------------------------
// ALLOWED_EDGES: runtime immutability (regression)
// ---------------------------------------------------------------------------

test("ALLOWED_EDGES: array, edges, and per-edge actor lists are frozen", () => {
  assert.equal(Object.isFrozen(ALLOWED_EDGES), true, "edge array must be frozen");
  for (const edge of ALLOWED_EDGES) {
    assert.equal(Object.isFrozen(edge), true, `edge ${edge.from}->${edge.to} not frozen`);
    assert.equal(
      Object.isFrozen(edge.by),
      true,
      `edge ${edge.from}->${edge.to} actor list not frozen`,
    );
  }
});

test("ALLOWED_EDGES: mutation attempts throw or are silently ignored, never succeed", () => {
  // In strict mode (which ESM modules use), assigning to a frozen array element
  // or pushing to it throws TypeError. We only need to assert that, after the
  // attempt, the runtime state machine data is unchanged.
  const original = ALLOWED_EDGES.length;
  assert.throws(() => {
    ALLOWED_EDGES.push({
      from: "succeeded",
      to: "queued",
      by: ["queue"],
    });
  });
  assert.equal(ALLOWED_EDGES.length, original);

  const firstEdge = ALLOWED_EDGES[0];
  assert.throws(() => {
    firstEdge.to = "dead_lettered";
  });
});

// ---------------------------------------------------------------------------
// TERMINAL_STATES + isTerminalState (regression for audit Medium D3)
// ---------------------------------------------------------------------------

test("TERMINAL_STATES: array is frozen and mutation attempts throw", () => {
  assert.equal(Array.isArray(TERMINAL_STATES), true, "TERMINAL_STATES must be an array");
  assert.equal(Object.isFrozen(TERMINAL_STATES), true, "TERMINAL_STATES must be frozen");
  const before = [...TERMINAL_STATES];
  assert.throws(() => {
    TERMINAL_STATES.push("processing");
  });
  assert.throws(() => {
    TERMINAL_STATES[0] = "processing";
  });
  assert.deepEqual([...TERMINAL_STATES], before, "TERMINAL_STATES must be unchanged after attempts");
});

test("isTerminalState: matches every terminal state and excludes non-terminal", () => {
  for (const s of ["succeeded", "partial_succeeded", "cancelled", "dead_lettered"]) {
    assert.equal(isTerminalState(s), true, `${s} must be terminal`);
  }
  for (const s of ["queued", "claimed", "processing", "failed"]) {
    assert.equal(isTerminalState(s), false, `${s} must not be terminal`);
  }
});

test("validators are unaffected by attempts to mutate the exported TERMINAL_STATES array", () => {
  // The validator reads its own private copy; even if the export were
  // mutable, mutating it must not change validation behavior.
  assert.throws(() => TERMINAL_STATES.push("processing"));
  // A normal queued -> claimed -> processing -> succeeded sequence must still
  // validate, even if a malicious caller tried to poison terminal state list.
  const r = validateOcrStatusTransitionSequence({
    job_id: "01jrk8m4q4xv2v8d4d4ymf5xnk",
    transitions: [
      { from: "queued",     to: "claimed",    controlled_by: "queue",  at: "2030-01-01T00:00:01.000Z" },
      { from: "claimed",    to: "processing", controlled_by: "worker", at: "2030-01-01T00:00:02.000Z" },
      { from: "processing", to: "succeeded",  controlled_by: "worker", at: "2030-01-01T00:00:03.000Z" },
    ],
  });
  assert.equal(r.ok, true, r.ok ? "" : r.summary);
});

// ---------------------------------------------------------------------------
// Exported schemas are deep-frozen (regression for audit Medium D2)
// ---------------------------------------------------------------------------

test("exported schemas are deep-frozen; mutation attempts throw and validators are unaffected", () => {
  assert.equal(Object.isFrozen(submissionSchema), true, "submissionSchema must be frozen");
  assert.equal(Object.isFrozen(resultSchema), true, "resultSchema must be frozen");
  assert.equal(Object.isFrozen(statusSchema), true, "statusSchema must be frozen");

  // Deep freeze: properties.priority is also frozen.
  assert.throws(() => {
    submissionSchema.properties.priority.maximum = 999;
  });

  // Validators must still reject priority=250 — proving downstream cannot
  // weaken validation by mutating the public schema export.
  const fixture = readJson(join(invalidDir, "submission-bad-priority.json"));
  const r = validateOcrSubmission(fixture);
  assert.equal(r.ok, false, "priority=250 must remain rejected after schema mutation attempt");
});

// ---------------------------------------------------------------------------
// Retry numeric guards (regression for audit Medium D3)
// ---------------------------------------------------------------------------

test("validateRetryCounters: rejects fractional, negative, and zero counters", () => {
  assert.match(validateRetryCounters({ max_attempts: 1.5, attempt: 1 }), /max_attempts/);
  assert.match(validateRetryCounters({ max_attempts: 3,   attempt: 1.5 }), /attempt/);
  assert.match(validateRetryCounters({ max_attempts: -1,  attempt: 1 }), /max_attempts/);
  assert.match(validateRetryCounters({ max_attempts: 3,   attempt: -1 }), /attempt/);
  assert.match(validateRetryCounters({ max_attempts: 0,   attempt: 1 }), /max_attempts/);
  assert.match(validateRetryCounters({ max_attempts: 3,   attempt: 0 }), /attempt/);
  assert.match(validateRetryCounters({ max_attempts: 2,   attempt: 5 }), /exceeds/);
  assert.equal(validateRetryCounters({ max_attempts: 3,   attempt: 1 }), null);
});

test("validateRetryBehavior: rejects fractional/negative retry counters before semantic check", () => {
  const r = validateRetryBehavior({
    result_emitted: { status: "failed", partial_failure: { code: "x", message: "y", is_transient: true, attempted_count: 1 } },
    retry_policy: { max_attempts: 3, attempt: 1.5 },
    transitions: [{ from: "failed", to: "queued", controlled_by: "queue", at: "2030-01-01T00:00:00.000Z" }],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /attempt/);
});

test("classifyOcrFailureForRetry: throws RetryPolicyError on fractional attempt", () => {
  assert.throws(
    () =>
      classifyOcrFailureForRetry({
        status: "failed",
        failure: { code: "fetch_timeout", message: "slow", is_transient: true, attempted_count: 1 },
        retry: { max_attempts: 3, attempt: 1.5 },
      }),
    RetryPolicyError,
  );
});

test("classifyOcrFailureForRetry: throws RetryPolicyError on negative max_attempts", () => {
  assert.throws(
    () =>
      classifyOcrFailureForRetry({
        status: "failed",
        failure: { code: "fetch_timeout", message: "slow", is_transient: true, attempted_count: 1 },
        retry: { max_attempts: -3, attempt: 1 },
      }),
    RetryPolicyError,
  );
});

test("classifyOcrFailureForRetry: never returns fractional attemptsRemaining", () => {
  // Sweep a broad set of integer pairs and confirm the field stays integral.
  for (let m = 1; m <= 5; m++) {
    for (let a = 1; a <= m; a++) {
      const decision = classifyOcrFailureForRetry({
        status: "failed",
        failure: { code: "fetch_timeout", message: "slow", is_transient: true, attempted_count: a },
        retry: { max_attempts: m, attempt: a },
      });
      if (decision.kind === "retry") {
        assert.ok(
          Number.isInteger(decision.attemptsRemaining),
          `attemptsRemaining must be integer (m=${m},a=${a})`,
        );
        assert.ok(decision.attemptsRemaining >= 1);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// validateOcrJobOutcome — composed validator (ADR-11A.5 v0.1)
//
// Layers tested below:
//   1. envelope schema       — schema-detectable invalid fixtures
//   2. status sequence       — illegal-edge case built inline
//   3. per-result validity   — one bad results[] element built inline
//   4. terminal coherence    — terminal_state vs statuses[last].to mismatch
//
// Job/submission binding lives in services/ocr-worker/src/outcomeValidation.ts
// and is NOT covered here (no external job context at the contract layer).
// ---------------------------------------------------------------------------

test("validateOcrJobOutcome: valid example fixture passes", () => {
  const fixture = readJson(join(validDir, "ocr-job-outcome.example.json"));
  const r = validateOcrJobOutcome(fixture);
  assert.equal(r.ok, true, r.ok ? "" : r.summary);
  if (r.ok) {
    assert.equal(r.value.terminal_state, "succeeded");
    assert.equal(r.value.statuses[r.value.statuses.length - 1].to, "succeeded");
  }
});

test("validateOcrJobOutcome: outcomeSchema export is the frozen contract schema", () => {
  assert.equal(typeof outcomeSchema, "object");
  assert.equal(outcomeSchema.title, "OcrJobOutcome");
  assert.ok(Object.isFrozen(outcomeSchema), "outcomeSchema must be frozen at the boundary");
});

test("validateOcrJobOutcome: missing-job-id fixture fails at envelope schema", () => {
  const r = validateOcrJobOutcome(readJson(join(invalidDir, "ocr-job-outcome-missing-job-id.json")));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.params && e.params.missingProperty === "job_id"));
  }
});

test("validateOcrJobOutcome: empty-statuses fixture fails at envelope schema", () => {
  const r = validateOcrJobOutcome(readJson(join(invalidDir, "ocr-job-outcome-empty-statuses.json")));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.instancePath === "/statuses"));
  }
});

test("validateOcrJobOutcome: terminal-state-bad-enum fixture fails at envelope schema", () => {
  const r = validateOcrJobOutcome(readJson(join(invalidDir, "ocr-job-outcome-terminal-state-bad-enum.json")));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.instancePath === "/terminal_state"));
  }
});

test("validateOcrJobOutcome: statuses-element-malformed fixture fails at envelope schema", () => {
  const r = validateOcrJobOutcome(readJson(join(invalidDir, "ocr-job-outcome-statuses-element-malformed.json")));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.instancePath.startsWith("/statuses/0")));
  }
});

test("validateOcrJobOutcome: SEMANTIC — terminal_state does not match final transition.to", () => {
  const base = readJson(join(validDir, "ocr-job-outcome.example.json"));
  const drifted = structuredClone(base);
  drifted.terminal_state = "partial_succeeded"; // statuses[last].to is still "succeeded"
  const r = validateOcrJobOutcome(drifted);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.summary, /terminal_state/);
    assert.ok(r.errors.some((e) => e.keyword === "semanticCoherence"));
  }
});

test("validateOcrJobOutcome: SEMANTIC — illegal status transition is rejected by sequence layer", () => {
  const base = readJson(join(validDir, "ocr-job-outcome.example.json"));
  const bad = structuredClone(base);
  // succeeded -> queued is a documented illegal transition (transitions.ts).
  bad.statuses.push({
    from: "succeeded",
    to: "queued",
    controlled_by: "queue",
    at: "2026-04-27T08:14:38.000+08:00",
  });
  bad.terminal_state = "queued";
  const r = validateOcrJobOutcome(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    // The sequence validator surfaces semantic errors via keyword="transition".
    assert.ok(
      r.summary.startsWith("statuses:"),
      `expected statuses-prefixed summary, got: ${r.summary}`,
    );
    assert.ok(r.errors.some((e) => e.keyword === "transition"));
  }
});

test("validateOcrJobOutcome: a malformed results[] element is rejected", () => {
  // Because the outcome schema cross-$refs ocr-result.schema.json by $id,
  // a malformed result element fails at the envelope-schema layer (layer 1)
  // before the explicit per-result loop (layer 3) is reached. Either path is
  // a correct rejection; the assertion here pins the rejection path the
  // composed validator actually takes today.
  const base = readJson(join(validDir, "ocr-job-outcome.example.json"));
  const bad = structuredClone(base);
  delete bad.results[0].engine; // ocr-result requires `engine`
  const r = validateOcrJobOutcome(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(
      r.errors.some((e) => e.instancePath.startsWith("/results/0")),
      `expected an error on /results/0, got: ${r.summary}`,
    );
  }
});
