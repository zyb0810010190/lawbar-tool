// Fake OCR worker tests. The fake never emits a contract-invalid payload; if
// it tried to, it would throw. These tests still re-validate everything
// independently to catch the case where the fake's internal validation is
// inadvertently bypassed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  processFakeOcrJob,
  FakeWorkerError,
} from "../dist/testing/index.js";
import {
  validateOcrSubmission,
  validateOcrResult,
  validateOcrStatusTransitionSequence,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const validDir = join(here, "..", "fixtures", "valid");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const baseSubmission = readJson(join(validDir, "submission-s3.json"));

// Builds a submission with `n` distinct pages by cloning baseSubmission's
// single page and rewriting page_id / page_number / source.key. Used to
// exercise multi-page result emission.
function makeMultiPageSubmission(n) {
  const sub = structuredClone(baseSubmission);
  const proto = sub.pages[0];
  const pages = [];
  for (let i = 0; i < n; i++) {
    const idx = i + 1;
    // 26-char lowercase page_id, deterministic per index.
    const suffix = `p${String(idx).padStart(2, "0")}`;
    const page_id = (proto.page_id.slice(0, 26 - suffix.length) + suffix).slice(0, 26);
    pages.push({
      page_id,
      page_number: idx,
      source: {
        ...proto.source,
        key: proto.source.key.replace(/page-\d+\.png/, `page-${String(idx).padStart(3, "0")}.png`),
      },
    });
  }
  sub.pages = pages;
  return sub;
}

// Sanity guard: the input we're feeding the fake must itself be valid. If this
// fails, every downstream test would fail for the wrong reason.
test("baseline: fixture submission is contract-valid", () => {
  const r = validateOcrSubmission(baseSubmission);
  assert.equal(r.ok, true, r.ok ? "" : r.summary);
});

// Helper: re-validate every emitted artifact independently.
function assertOutcomeFullyValid(outcome) {
  // Statuses: must form a valid contract sequence.
  const seq = validateOcrStatusTransitionSequence({
    job_id: outcome.job_id,
    transitions: outcome.statuses,
  });
  assert.equal(seq.ok, true, seq.ok ? "" : seq.summary);

  // Every result: must validate against the result schema.
  for (const r of outcome.results) {
    const v = validateOcrResult(r);
    assert.equal(v.ok, true, v.ok ? "" : `${v.summary}`);
    // ID propagation: the fake must rewrite IDs to match the submission.
    assert.equal(r.job_id, outcome.job_id, "result.job_id must match outcome.job_id");
  }
}

// ---------------------------------------------------------------------------
// success
// ---------------------------------------------------------------------------

test("success: terminal_state=succeeded, 3-step sequence, 1 result", () => {
  const outcome = processFakeOcrJob(baseSubmission, { scenario: "success" });

  assert.equal(outcome.terminal_state, "succeeded");
  assert.equal(outcome.statuses.length, 3);
  assert.deepEqual(outcome.statuses.map((s) => s.to), [
    "claimed", "processing", "succeeded",
  ]);
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].status, "succeeded");
  assert.equal(outcome.results[0].partial_failure, null);

  assertOutcomeFullyValid(outcome);
});

// ---------------------------------------------------------------------------
// partial_failure (multi-page partial success)
// ---------------------------------------------------------------------------

test("partial_failure: terminal_state=partial_succeeded on 2-page submission, page_ids match submitted", () => {
  const sub = makeMultiPageSubmission(2);
  const outcome = processFakeOcrJob(sub, { scenario: "partial_failure" });

  assert.equal(outcome.terminal_state, "partial_succeeded");
  assert.equal(outcome.statuses.length, 3);
  assert.equal(outcome.statuses.at(-1).to, "partial_succeeded");

  assert.equal(outcome.results.length, 2);
  const statuses = outcome.results.map((r) => r.status).sort();
  assert.deepEqual(statuses, ["failed", "succeeded"]);

  // The failed page must carry a populated partial_failure.
  const failed = outcome.results.find((r) => r.status === "failed");
  assert.ok(failed, "expected a failed page result");
  assert.ok(failed.partial_failure, "failed page must carry partial_failure");

  // Page_ids must come from the submission, never invented.
  const submittedIds = sub.pages.map((p) => p.page_id).sort();
  const resultIds = outcome.results.map((r) => r.page_id).sort();
  assert.deepEqual(resultIds, submittedIds, "result page_ids must equal submitted page_ids");

  assertOutcomeFullyValid(outcome);
});

test("partial_failure: 3-page submission yields 1 success + 2 failures, all submitted page_ids", () => {
  const sub = makeMultiPageSubmission(3);
  const outcome = processFakeOcrJob(sub, { scenario: "partial_failure" });

  assert.equal(outcome.results.length, 3);
  const succeeded = outcome.results.filter((r) => r.status === "succeeded");
  const failed = outcome.results.filter((r) => r.status === "failed");
  assert.equal(succeeded.length, 1);
  assert.equal(failed.length, 2);

  const submittedIds = sub.pages.map((p) => p.page_id).sort();
  const resultIds = outcome.results.map((r) => r.page_id).sort();
  assert.deepEqual(resultIds, submittedIds);
});

test("partial_failure on single-page submission throws FakeWorkerError (no synthetic pages)", () => {
  // The contract has no representation for "partial" success on one page.
  // The fake must refuse rather than invent an unsubmitted page_id.
  assert.throws(
    () => processFakeOcrJob(baseSubmission, { scenario: "partial_failure" }),
    (err) =>
      err instanceof FakeWorkerError &&
      />= 2 pages/.test(err.message) &&
      /partial_failure/.test(err.message),
  );
});

// ---------------------------------------------------------------------------
// permanent_failure
// ---------------------------------------------------------------------------

test("permanent_failure: terminal_state=dead_lettered, no retry edge", () => {
  const outcome = processFakeOcrJob(baseSubmission, { scenario: "permanent_failure" });

  assert.equal(outcome.terminal_state, "dead_lettered");
  assert.equal(outcome.statuses.length, 4);
  // The contract forbids re-queueing a permanent failure. Verify the
  // transition out of `failed` goes directly to dead_lettered.
  const failedEdge = outcome.statuses.find((t) => t.from === "failed");
  assert.equal(failedEdge.to, "dead_lettered");
  // No transition should re-enter `queued` after the first claim.
  const requeues = outcome.statuses.filter(
    (t, i) => i > 0 && t.to === "queued",
  );
  assert.equal(requeues.length, 0, "permanent failure must not re-queue");

  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].status, "failed");
  assert.equal(outcome.results[0].partial_failure.is_transient, false);

  assertOutcomeFullyValid(outcome);
});

// ---------------------------------------------------------------------------
// transient_then_success
// ---------------------------------------------------------------------------

test("transient_then_success: 7-step sequence with one re-queue, terminal=succeeded", () => {
  const outcome = processFakeOcrJob(baseSubmission, { scenario: "transient_then_success" });

  assert.equal(outcome.terminal_state, "succeeded");
  assert.equal(outcome.statuses.length, 7);

  // Exactly one failed -> queued retry edge.
  const retryEdges = outcome.statuses.filter(
    (t) => t.from === "failed" && t.to === "queued",
  );
  assert.equal(retryEdges.length, 1, "expected exactly one retry edge");

  // The final result is the success outcome (the transient failure is in the
  // status history, not in the emitted result envelope).
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].status, "succeeded");

  assertOutcomeFullyValid(outcome);
});

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------

test("determinism: same submission + scenario produces identical statuses (modulo identity)", () => {
  const a = processFakeOcrJob(baseSubmission, { scenario: "success" });
  const b = processFakeOcrJob(baseSubmission, { scenario: "success" });
  assert.deepEqual(a.statuses, b.statuses, "status sequence must be deterministic");
  // Results: completed_at is derived from the deterministic clock — same input,
  // same output.
  assert.deepEqual(
    a.results.map((r) => r.completed_at),
    b.results.map((r) => r.completed_at),
  );
});

test("determinism: custom clock is honored", () => {
  const fixed = new Date("2030-01-01T00:00:00.000Z");
  let calls = 0;
  const now = () => {
    calls += 1;
    return new Date(fixed.getTime() + calls * 1000);
  };
  const outcome = processFakeOcrJob(baseSubmission, { scenario: "success", now });
  assert.ok(calls >= 3, "clock must be invoked at least once per transition");
  assert.equal(outcome.statuses[0].at, "2030-01-01T00:00:01.000Z");
  assert.equal(outcome.statuses[1].at, "2030-01-01T00:00:02.000Z");
  assert.equal(outcome.statuses[2].at, "2030-01-01T00:00:03.000Z");
});

// ---------------------------------------------------------------------------
// input validation
// ---------------------------------------------------------------------------

test("input validation: invalid submission throws FakeWorkerError", () => {
  const broken = { ...baseSubmission, priority: 250 };
  assert.throws(
    () => processFakeOcrJob(broken, { scenario: "success" }),
    (err) => err instanceof FakeWorkerError && /priority/.test(err.message),
  );
});

test("input validation: missing submission throws FakeWorkerError, not a TypeError", () => {
  assert.throws(
    () => processFakeOcrJob(null, { scenario: "success" }),
    FakeWorkerError,
  );
  assert.throws(
    () => processFakeOcrJob(undefined, { scenario: "success" }),
    FakeWorkerError,
  );
});

// ---------------------------------------------------------------------------
// scenario coverage guard
// ---------------------------------------------------------------------------

test("coverage: every documented scenario is exercised by a test above", () => {
  // Pin the scenario set so adding a new scenario forces a corresponding test.
  const scenarios = ["success", "partial_failure", "permanent_failure", "transient_then_success"];
  for (const s of scenarios) {
    // partial_failure requires multi-page input by contract.
    const sub = s === "partial_failure" ? makeMultiPageSubmission(2) : baseSubmission;
    const outcome = processFakeOcrJob(sub, { scenario: s });
    assertOutcomeFullyValid(outcome);
  }
});

// ---------------------------------------------------------------------------
// Multi-page page-binding (regression for audit Medium D7)
// ---------------------------------------------------------------------------

test("success: multi-page submission yields one succeeded result per submitted page, ids match exactly", () => {
  const sub = makeMultiPageSubmission(3);
  const outcome = processFakeOcrJob(sub, { scenario: "success" });

  assert.equal(outcome.results.length, sub.pages.length);
  const submittedIds = sub.pages.map((p) => p.page_id).sort();
  const resultIds = outcome.results.map((r) => r.page_id).sort();
  assert.deepEqual(resultIds, submittedIds, "result page_ids must equal submitted page_ids");
  for (const r of outcome.results) assert.equal(r.status, "succeeded");

  // page_number must match the submitted page_number (not just page_id).
  const byId = new Map(sub.pages.map((p) => [p.page_id, p.page_number]));
  for (const r of outcome.results) {
    assert.equal(r.page_number, byId.get(r.page_id), "result.page_number must match submitted page_number");
  }
});

test("permanent_failure: multi-page submission yields one failed result per submitted page", () => {
  const sub = makeMultiPageSubmission(2);
  const outcome = processFakeOcrJob(sub, { scenario: "permanent_failure" });

  assert.equal(outcome.terminal_state, "dead_lettered");
  assert.equal(outcome.results.length, 2);
  for (const r of outcome.results) {
    assert.equal(r.status, "failed");
    assert.ok(r.partial_failure);
    assert.equal(r.partial_failure.is_transient, false);
  }
  const submittedIds = sub.pages.map((p) => p.page_id).sort();
  const resultIds = outcome.results.map((r) => r.page_id).sort();
  assert.deepEqual(resultIds, submittedIds);
});

test("transient_then_success: multi-page submission yields one succeeded result per submitted page", () => {
  const sub = makeMultiPageSubmission(3);
  const outcome = processFakeOcrJob(sub, { scenario: "transient_then_success" });

  assert.equal(outcome.terminal_state, "succeeded");
  assert.equal(outcome.results.length, sub.pages.length);
  for (const r of outcome.results) assert.equal(r.status, "succeeded");
  const submittedIds = sub.pages.map((p) => p.page_id).sort();
  const resultIds = outcome.results.map((r) => r.page_id).sort();
  assert.deepEqual(resultIds, submittedIds);
});

// ---------------------------------------------------------------------------
// Metadata echo (regression for audit High D3)
// ---------------------------------------------------------------------------

test("metadata: every emitted result echoes submission.metadata, not the fixture metadata", () => {
  const sub = structuredClone(baseSubmission);
  // Override with a Chinese-string + nested-object metadata so we can prove
  // the fake does not leak fixture metadata.
  sub.metadata = {
    trace_id: "00-deadbeefcafef00ddeadbeefcafef00d-aaaaaaaaaaaaaaaa-01",
    case_label: "民事诉讼-2026沪民2-1234",
    nested: {
      tags: ["紧急", "证据上传"],
      depth: 2,
    },
  };

  const outcome = processFakeOcrJob(sub, { scenario: "success" });
  assert.equal(outcome.results.length, 1);
  for (const r of outcome.results) {
    assert.deepEqual(r.metadata, sub.metadata, "result.metadata must equal submission.metadata");
    assert.notEqual(
      r.metadata.case_label,
      undefined,
      "submission metadata must take effect; not the fixture's",
    );
  }
});

test("metadata: mutating a result's metadata after emission does not mutate the submission's metadata", () => {
  const sub = structuredClone(baseSubmission);
  sub.metadata = { trace_id: "deadbeef", nested: { v: 1 } };
  const outcome = processFakeOcrJob(sub, { scenario: "success" });
  outcome.results[0].metadata.trace_id = "TAMPERED";
  outcome.results[0].metadata.nested.v = 999;
  assert.equal(sub.metadata.trace_id, "deadbeef", "submission trace_id must not change");
  assert.equal(sub.metadata.nested.v, 1, "submission nested.v must not change");
});

// ---------------------------------------------------------------------------
// default scenario
// ---------------------------------------------------------------------------

test("default scenario is 'success' when options omitted", () => {
  const outcome = processFakeOcrJob(baseSubmission);
  assert.equal(outcome.scenario, "success");
  assert.equal(outcome.terminal_state, "succeeded");
  assertOutcomeFullyValid(outcome);
});

// ---------------------------------------------------------------------------
// invalid scenario rejection (regression)
// ---------------------------------------------------------------------------

test("invalid scenario throws FakeWorkerError with a clear message", () => {
  // `as any` cast simulates a runtime-typed caller smuggling an unknown
  // scenario past TypeScript. Without the entry guard, the internal switch
  // falls through to undefined and downstream code crashes.
  assert.throws(
    () => processFakeOcrJob(baseSubmission, { scenario: "boom" }),
    (err) =>
      err instanceof FakeWorkerError &&
      /unknown scenario/.test(err.message) &&
      /boom/.test(err.message),
  );
});
