// Step 10D — runOcrWorkerLoop tests.
//
// All tests use a stub coordinator (`makeStubCoordinator`) that returns a
// queue of pre-programmed `OcrCoordinatorResult`s. This keeps the loop
// tests focused on stop/idle/hook/error semantics — coordinator behavior
// has its own dedicated test file.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runOcrWorkerLoop } from "../dist/index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake coordinator whose `processOne` returns the next result from
 * a script. If the script is exhausted, it keeps returning `empty` so the
 * loop has something to do without throwing.
 */
function makeStubCoordinator(script) {
  let i = 0;
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async processOne() {
      calls++;
      const next = i < script.length ? script[i++] : { outcome: "empty" };
      // Resolve as a microtask to mimic real async work.
      return Promise.resolve(next);
    },
  };
}

/** Coordinator whose processOne always throws the given error. */
function throwingCoordinator(err) {
  return {
    async processOne() {
      throw err;
    },
  };
}

/** A coordinator whose processOne can be paused mid-call by the test. */
function pausableCoordinator(scriptedResult) {
  let release;
  const ready = new Promise((r) => (release = r));
  let started = false;
  let calls = 0;
  return {
    get started() {
      return started;
    },
    get calls() {
      return calls;
    },
    /** Resolve so that processOne returns. */
    finish() {
      release();
    },
    async processOne() {
      calls++;
      started = true;
      await ready;
      return scriptedResult ?? { outcome: "completed", job_id: "x" };
    },
  };
}

/** Synchronous-ish sleep replacement for tests — instant resolution. */
const fastSleep = async () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("stops after maxIterations", async () => {
  const coord = makeStubCoordinator([
    { outcome: "completed", job_id: "j1" },
    { outcome: "completed", job_id: "j2" },
    { outcome: "completed", job_id: "j3" },
  ]);
  const summary = await runOcrWorkerLoop({
    coordinator: coord,
    maxIterations: 2,
    sleep: fastSleep,
  });
  assert.equal(summary.iterations, 2);
  assert.equal(summary.stop_reason, "max_iterations");
  assert.equal(summary.outcomes.completed, 2);
  assert.equal(coord.calls, 2);
  assert.equal(summary.last_outcome.job_id, "j2");
});

test("sleeps on empty, then resumes", async () => {
  const coord = makeStubCoordinator([
    { outcome: "empty" },
    { outcome: "empty" },
    { outcome: "completed", job_id: "j1" },
  ]);
  const sleepCalls = [];
  const summary = await runOcrWorkerLoop({
    coordinator: coord,
    maxIterations: 3,
    idleDelayMs: 7,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
  });
  // Two empties → two idle sleeps. Completed outcome does NOT sleep.
  assert.deepEqual(sleepCalls, [7, 7]);
  assert.equal(summary.iterations, 3);
  assert.equal(summary.stop_reason, "max_iterations");
  assert.equal(summary.outcomes.empty, 2);
  assert.equal(summary.outcomes.completed, 1);
});

test("graceful stop before next claim prevents another processOne call", async () => {
  // Script is long, but we cap via maxIterations after issuing stop.
  const coord = makeStubCoordinator(Array(20).fill({ outcome: "completed", job_id: "j" }));
  const ctrl = new AbortController();
  // Abort BEFORE the loop starts so iteration 0 never runs.
  ctrl.abort();
  const summary = await runOcrWorkerLoop({
    coordinator: coord,
    stopSignal: ctrl.signal,
    sleep: fastSleep,
  });
  assert.equal(summary.iterations, 0);
  assert.equal(summary.stop_reason, "stopped");
  assert.equal(coord.calls, 0);
});

test("graceful stop after one iteration prevents the next", async () => {
  // Abort after the first onOutcome fires — the loop should not start a
  // second processOne call.
  const coord = makeStubCoordinator([
    { outcome: "completed", job_id: "j1" },
    { outcome: "completed", job_id: "j2" },
    { outcome: "completed", job_id: "j3" },
  ]);
  const ctrl = new AbortController();
  let onOutcomeCalls = 0;
  const summary = await runOcrWorkerLoop({
    coordinator: coord,
    stopSignal: ctrl.signal,
    sleep: fastSleep,
    onOutcome: () => {
      onOutcomeCalls++;
      ctrl.abort();
    },
  });
  assert.equal(summary.iterations, 1);
  assert.equal(summary.stop_reason, "stopped");
  assert.equal(coord.calls, 1);
  assert.equal(onOutcomeCalls, 1);
});

test("stop during in-flight processOne waits for completion", async () => {
  const coord = pausableCoordinator({ outcome: "completed", job_id: "j-in-flight" });
  const ctrl = new AbortController();
  const loopPromise = runOcrWorkerLoop({
    coordinator: coord,
    stopSignal: ctrl.signal,
    sleep: fastSleep,
  });
  // Wait until processOne is actually running.
  await new Promise((r) => setImmediate(r));
  assert.equal(coord.started, true);
  // Abort while processOne is still pending.
  ctrl.abort();
  // Give the loop a chance to observe the abort. Because processOne hasn't
  // resolved yet, the loop must NOT have terminated.
  await new Promise((r) => setImmediate(r));
  // Now release processOne. The loop should record the iteration, then see
  // the abort flag at the top of the next pass, and stop.
  coord.finish();
  const summary = await loopPromise;
  assert.equal(summary.iterations, 1, "in-flight iteration must complete and be counted");
  assert.equal(summary.stop_reason, "stopped");
  assert.equal(summary.last_outcome.job_id, "j-in-flight");
  assert.equal(coord.calls, 1, "must not have started a second processOne");
});

test("unexpected processOne throw calls onError and aborts with stop_reason=error", async () => {
  const boom = new Error("internal coordinator bug");
  const coord = throwingCoordinator(boom);
  const errors = [];
  const summary = await runOcrWorkerLoop({
    coordinator: coord,
    sleep: fastSleep,
    onError: (e) => {
      errors.push(e);
    },
  });
  assert.equal(summary.iterations, 0);
  assert.equal(summary.stop_reason, "error");
  assert.equal(summary.last_error.phase, "processOne");
  assert.match(summary.last_error.message, /internal coordinator bug/);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].phase, "processOne");
  assert.equal(errors[0].cause, boom);
});

test("onOutcome throw does not take down the loop; reported via onError", async () => {
  const coord = makeStubCoordinator([
    { outcome: "completed", job_id: "j1" },
    { outcome: "completed", job_id: "j2" },
  ]);
  const errors = [];
  const summary = await runOcrWorkerLoop({
    coordinator: coord,
    maxIterations: 2,
    sleep: fastSleep,
    onOutcome: () => {
      throw new Error("hook explosion");
    },
    onError: (e) => {
      errors.push(e);
    },
  });
  assert.equal(summary.iterations, 2);
  assert.equal(summary.stop_reason, "max_iterations");
  // Hook fired twice → two onError reports, both with phase=onOutcome.
  assert.equal(errors.length, 2);
  for (const e of errors) {
    assert.equal(e.phase, "onOutcome");
    assert.match(e.message, /hook explosion/);
  }
  // last_error stays undefined: the loop did not terminate on error.
  assert.equal(summary.last_error, undefined);
});

test("onError throw is swallowed (no recursion / death-spiral)", async () => {
  const coord = makeStubCoordinator([
    { outcome: "completed", job_id: "j1" },
  ]);
  const summary = await runOcrWorkerLoop({
    coordinator: coord,
    maxIterations: 1,
    sleep: fastSleep,
    onOutcome: () => {
      throw new Error("hook 1");
    },
    onError: () => {
      throw new Error("onError itself blew up");
    },
  });
  // Loop completed cleanly despite onError throwing.
  assert.equal(summary.iterations, 1);
  assert.equal(summary.stop_reason, "max_iterations");
});

test("requeued / ack_failed / lease_lost / persistence_failed outcomes do not break the loop", async () => {
  const coord = makeStubCoordinator([
    { outcome: "requeued", job_id: "j1", error: { message: "x" } },
    { outcome: "ack_failed", job_id: "j2", error: { code: "stale_receipt", message: "y" } },
    { outcome: "lease_lost", job_id: "j3", error: { code: "lease_expired", message: "z" } },
    { outcome: "persistence_failed", job_id: "j4", error: { message: "w" } },
    { outcome: "completed", job_id: "j5" },
  ]);
  const seen = [];
  const errors = [];
  const sleepCalls = [];
  const summary = await runOcrWorkerLoop({
    coordinator: coord,
    maxIterations: 5,
    idleDelayMs: 99,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    onOutcome: (r) => {
      seen.push(r.outcome);
    },
    onError: (e) => {
      errors.push(e);
    },
  });
  assert.equal(summary.iterations, 5);
  assert.equal(summary.stop_reason, "max_iterations");
  assert.deepEqual(seen, [
    "requeued",
    "ack_failed",
    "lease_lost",
    "persistence_failed",
    "completed",
  ]);
  assert.equal(errors.length, 0, "documented failure outcomes must NOT be routed to onError");
  // No sleeps — none of these outcomes are `empty`, and Step 10D does not
  // pace non-empty outcomes.
  assert.deepEqual(sleepCalls, []);
});

test("includeEmptyOutcomes=false (default) suppresses onOutcome on empty", async () => {
  const coord = makeStubCoordinator([
    { outcome: "empty" },
    { outcome: "empty" },
    { outcome: "completed", job_id: "j1" },
  ]);
  const seen = [];
  const summary = await runOcrWorkerLoop({
    coordinator: coord,
    maxIterations: 3,
    sleep: fastSleep,
    onOutcome: (r) => {
      seen.push(r.outcome);
    },
  });
  assert.deepEqual(seen, ["completed"]);
  // Histogram still records empties.
  assert.equal(summary.outcomes.empty, 2);
  assert.equal(summary.outcomes.completed, 1);
});

test("includeEmptyOutcomes=true emits onOutcome on empty", async () => {
  const coord = makeStubCoordinator([
    { outcome: "empty" },
    { outcome: "completed", job_id: "j1" },
  ]);
  const seen = [];
  await runOcrWorkerLoop({
    coordinator: coord,
    maxIterations: 2,
    sleep: fastSleep,
    includeEmptyOutcomes: true,
    onOutcome: (r) => {
      seen.push(r.outcome);
    },
  });
  assert.deepEqual(seen, ["empty", "completed"]);
});

test("default sleep wakes early when stopSignal aborts", async () => {
  // No custom sleep — exercise the real default. Use a long idleDelayMs
  // so the test would hang if the default did not honor abort.
  const coord = makeStubCoordinator([{ outcome: "empty" }]);
  const ctrl = new AbortController();
  const start = Date.now();
  // Abort shortly after the loop starts.
  setTimeout(() => ctrl.abort(), 5);
  const summary = await runOcrWorkerLoop({
    coordinator: coord,
    stopSignal: ctrl.signal,
    idleDelayMs: 60_000, // would hang for a minute without abort wiring
  });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `expected early wake, took ${elapsed}ms`);
  assert.equal(summary.stop_reason, "stopped");
  assert.equal(summary.iterations, 1);
});
