// Observability event-shape tests.
//
// Pins the canonical structured-event shape for each coordinator outcome
// so downstream log-parsing / alert-routing consumers can rely on the
// fields and severities being stable. A test failure here is a deliberate
// signal that a breaking change to the event schema is being made — bump
// OCR_COORDINATOR_EVENT_SCHEMA_VERSION and update consumers.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  toCoordinatorEvent,
  formatCoordinatorEventJson,
  OCR_COORDINATOR_EVENT_SCHEMA_VERSION,
} from "../dist/index.js";

const FIXED_AT = "2030-02-01T00:00:00.000Z";
const JOB_ID = "01jrk8m4q4xv2v8d4d4ymf5xnk";

test("schema_version is pinned at 1 (bump deliberately to break consumers)", () => {
  assert.equal(OCR_COORDINATOR_EVENT_SCHEMA_VERSION, 1);
});

test("empty outcome → info empty event, no job_id", () => {
  const event = toCoordinatorEvent({ outcome: "empty" }, { at: FIXED_AT });
  assert.deepEqual(event, {
    schema_version: 1,
    at: FIXED_AT,
    type: "empty",
    severity: "info",
  });
});

test("completed outcome → info event with persist counts", () => {
  const event = toCoordinatorEvent(
    {
      outcome: "completed",
      job_id: JOB_ID,
      statuses_persisted: 3,
      results_persisted: 1,
    },
    { at: FIXED_AT },
  );
  assert.deepEqual(event, {
    schema_version: 1,
    at: FIXED_AT,
    type: "completed",
    severity: "info",
    job_id: JOB_ID,
    statuses_persisted: 3,
    results_persisted: 1,
  });
});

test("completed_already_terminal outcome → info event, no counts (worker never ran)", () => {
  const event = toCoordinatorEvent(
    { outcome: "completed_already_terminal", job_id: JOB_ID },
    { at: FIXED_AT },
  );
  assert.deepEqual(event, {
    schema_version: 1,
    at: FIXED_AT,
    type: "completed_already_terminal",
    severity: "info",
    job_id: JOB_ID,
  });
});

test("requeued outcome → info event carries reason from error.message", () => {
  const event = toCoordinatorEvent(
    {
      outcome: "requeued",
      job_id: JOB_ID,
      error: { message: "worker threw: boom" },
    },
    { at: FIXED_AT },
  );
  assert.deepEqual(event, {
    schema_version: 1,
    at: FIXED_AT,
    type: "requeued",
    severity: "info",
    job_id: JOB_ID,
    reason: "worker threw: boom",
  });
});

test("retried outcome → info event; results_persisted reflects ADR-11F B1 skip", () => {
  const event = toCoordinatorEvent(
    {
      outcome: "retried",
      job_id: JOB_ID,
      statuses_persisted: 4,
      results_persisted: 0,
    },
    { at: FIXED_AT },
  );
  assert.deepEqual(event, {
    schema_version: 1,
    at: FIXED_AT,
    type: "retried",
    severity: "info",
    job_id: JOB_ID,
    statuses_persisted: 4,
    results_persisted: 0,
  });
});

test("dead_lettered outcome → warn severity (operator alert target)", () => {
  const event = toCoordinatorEvent(
    {
      outcome: "dead_lettered",
      job_id: JOB_ID,
      statuses_persisted: 4,
      results_persisted: 1,
    },
    { at: FIXED_AT },
  );
  assert.deepEqual(event, {
    schema_version: 1,
    at: FIXED_AT,
    type: "dead_lettered",
    severity: "warn",
    job_id: JOB_ID,
    statuses_persisted: 4,
    results_persisted: 1,
  });
});

test("persistence_failed outcome → warn event carries message", () => {
  const event = toCoordinatorEvent(
    {
      outcome: "persistence_failed",
      job_id: JOB_ID,
      error: { message: "appendOcrStatusOnce(failed→queued) failed: chain break" },
    },
    { at: FIXED_AT },
  );
  assert.deepEqual(event, {
    schema_version: 1,
    at: FIXED_AT,
    type: "persistence_failed",
    severity: "warn",
    job_id: JOB_ID,
    message: "appendOcrStatusOnce(failed→queued) failed: chain break",
  });
});

test("persistence_failed with queue error code surfaces queue_error_code", () => {
  const event = toCoordinatorEvent(
    {
      outcome: "persistence_failed",
      job_id: JOB_ID,
      error: {
        code: "dedupe_conflict",
        message: "failed→queued persisted but queue.enqueue(retry) failed",
      },
    },
    { at: FIXED_AT },
  );
  assert.equal(event.type, "persistence_failed");
  assert.equal(event.queue_error_code, "dedupe_conflict");
});

test("ack_failed outcome → warn event with queue_error_code", () => {
  const event = toCoordinatorEvent(
    {
      outcome: "ack_failed",
      job_id: JOB_ID,
      error: { code: "stale_receipt", message: "receipt is stale" },
    },
    { at: FIXED_AT },
  );
  assert.deepEqual(event, {
    schema_version: 1,
    at: FIXED_AT,
    type: "ack_failed",
    severity: "warn",
    job_id: JOB_ID,
    queue_error_code: "stale_receipt",
    message: "receipt is stale",
  });
});

test("lease_lost outcome → warn event (distinct from ack_failed, ADR-11G surfaces this for pending-retry alerts)", () => {
  const event = toCoordinatorEvent(
    {
      outcome: "lease_lost",
      job_id: JOB_ID,
      error: { code: "lease_expired", message: "lease ended at 2030-02-01" },
    },
    { at: FIXED_AT },
  );
  assert.deepEqual(event, {
    schema_version: 1,
    at: FIXED_AT,
    type: "lease_lost",
    severity: "warn",
    job_id: JOB_ID,
    message: "lease ended at 2030-02-01",
  });
});

test("missing job_id on non-empty outcome → throws (coordinator-bug surface)", () => {
  assert.throws(
    () =>
      toCoordinatorEvent(
        { outcome: "completed", statuses_persisted: 1, results_persisted: 1 },
        { at: FIXED_AT },
      ),
    /produced no job_id/,
  );
});

test("at defaults to current time when omitted", () => {
  const before = Date.now();
  const event = toCoordinatorEvent({ outcome: "empty" });
  const after = Date.now();
  const stamped = Date.parse(event.at);
  assert.ok(
    stamped >= before && stamped <= after,
    `expected at=${event.at} to fall in [${before}, ${after}]`,
  );
});

test("formatCoordinatorEventJson → single-line JSON terminated with newline", () => {
  const event = toCoordinatorEvent(
    {
      outcome: "completed",
      job_id: JOB_ID,
      statuses_persisted: 3,
      results_persisted: 1,
    },
    { at: FIXED_AT },
  );
  const line = formatCoordinatorEventJson(event);
  assert.ok(line.endsWith("\n"), "must terminate with \\n");
  // No interior newlines.
  assert.equal(line.indexOf("\n"), line.length - 1);
  // Round-trips through JSON.parse.
  const round = JSON.parse(line);
  assert.deepEqual(round, event);
});

test("exhaustiveness: every coordinator outcome maps to an event with a known severity", () => {
  const outcomes = [
    "empty",
    "completed",
    "completed_already_terminal",
    "requeued",
    "retried",
    "dead_lettered",
    "persistence_failed",
    "ack_failed",
    "lease_lost",
  ];
  // Build a minimally-valid result for each outcome that satisfies the
  // L2 invariant checks (per-outcome required fields).
  const buildResult = (outcome) => {
    switch (outcome) {
      case "empty":
        return { outcome };
      case "completed":
      case "retried":
      case "dead_lettered":
        return { outcome, job_id: JOB_ID, statuses_persisted: 0, results_persisted: 0 };
      case "completed_already_terminal":
        return { outcome, job_id: JOB_ID };
      case "requeued":
        return { outcome, job_id: JOB_ID, error: { message: "exhaustiveness probe" } };
      case "persistence_failed":
      case "ack_failed":
      case "lease_lost":
        return { outcome, job_id: JOB_ID, error: { message: "exhaustiveness probe" } };
      default:
        throw new Error(`test bug: no fixture for outcome ${outcome}`);
    }
  };
  for (const outcome of outcomes) {
    const event = toCoordinatorEvent(buildResult(outcome), { at: FIXED_AT });
    assert.equal(event.type, outcome);
    assert.ok(
      event.severity === "info" || event.severity === "warn",
      `unexpected severity for ${outcome}: ${event.severity}`,
    );
  }
});

// L2 invariant-guard regression coverage.

test("L2: completed outcome without statuses_persisted throws (not silent 0)", () => {
  assert.throws(
    () =>
      toCoordinatorEvent(
        { outcome: "completed", job_id: JOB_ID, results_persisted: 1 },
        { at: FIXED_AT },
      ),
    /produced no statuses_persisted/,
  );
});

test("L2: requeued outcome without error.message throws (not 'no reason recorded')", () => {
  assert.throws(
    () => toCoordinatorEvent({ outcome: "requeued", job_id: JOB_ID }, { at: FIXED_AT }),
    /produced no requeued.reason/,
  );
});

test("L2: persistence_failed outcome with empty error.message throws", () => {
  assert.throws(
    () =>
      toCoordinatorEvent(
        { outcome: "persistence_failed", job_id: JOB_ID, error: { message: "" } },
        { at: FIXED_AT },
      ),
    /produced no persistence_failed.message/,
  );
});
