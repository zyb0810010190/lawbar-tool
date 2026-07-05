// Step 10G — real-process spawn smoke tests for the bin wrapper.
//
// These tests deliberately do NOT use the in-process EventEmitter fake
// from cli.test.mjs. They spawn `bin/ocr-worker.mjs` as a real Node
// child process and observe its real stdout/stderr/exitCode/signals.
//
// NOTE on the SIGINT idle-loop readiness protocol (WI-GATE5, was audit
// 019e3a4c D9 L): the bin now emits a deterministic child-side readiness
// marker on STDERR ("ocr-worker ready: signal-handlers-armed") right after
// `installShutdownHandlers` arms the SIGINT/SIGTERM listeners (src/cli.ts).
// The SIGINT test below waits for that marker via `waitForStderrMarker`
// before sending SIGINT, so a signal can never precede handler-arm — once
// the marker is observed, a SIGINT is guaranteed to flip the AbortController
// and the worker exits gracefully (0 / stop_reason="stopped") instead of via
// Node's default terminate action. This replaces the earlier
// `waitForLiveChild` liveness poll, which was NOT a readiness protocol
// (it only proved "alive + stable", not "handlers armed") and was fragile
// under host load. The marker is on STDERR, never stdout, so the stdout
// summary-JSON parse stays clean. `package.json#scripts.test` still runs
// with `--test-concurrency=1`; the deterministic marker means that is now
// belt-and-suspenders rather than the sole guard.
//
// The whole point of 10G is to prove:
//   - real `process.argv` flows into config parsing,
//   - real `process.env` flows into config parsing,
//   - real stdout/stderr are written and flushed before exit,
//   - real SIGINT is observed by the runtime's AbortController seam,
//   - real `process.exitCode` propagates correctly to the parent.
//
// 10F could not prove any of these — it ran in-process against a fake
// `process`. 10E specified them but never wrote a wrapper.
//
// Implementation note on test hygiene:
//   - We always register `child.kill("SIGKILL")` on `t.after` so a hung
//     child cannot leak past the test. SIGKILL is forced cleanup; the
//     individual tests that care about *graceful* exit verify it on
//     their own promise before falling through to `t.after`.
//   - Stdout/stderr are buffered to strings and inspected at end.
//   - The summary line is parsed as JSON from the LAST non-empty stdout
//     line, mirroring what cli.ts emits (single-line JSON summary).
//   - We rely on the bin wrapper inheriting NODE_PATH/etc from the
//     test process; no env scrubbing needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN_PATH = resolve(__dirname, "..", "bin", "ocr-worker.mjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Spawn the bin wrapper with the given argv. Returns the child plus
 * deferred buffers / exit promise.
 *
 * The `exited` promise resolves on the child's `"close"` event — NOT
 * `"exit"`. `"exit"` fires when the OS-level process terminates but
 * stdout/stderr pipes may still be draining; reading buffers at that
 * point can return partial output. `"close"` fires after every stdio
 * stream has flushed and ended, which is the right moment to assert
 * on captured stdout/stderr.
 *
 * The promise rejects on `"error"` (e.g. spawn ENOENT) so a spawn
 * failure surfaces as a test failure instead of a hang.
 *
 * Caller MUST `await result.exited` (or kill the child via `t.after`)
 * before the test ends.
 */
function spawnWorker(argv, { env } = {}) {
  const child = spawn(process.execPath, [BIN_PATH, ...argv], {
    env: { ...process.env, ...(env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = [];
  const err = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (s) => out.push(s));
  child.stderr.on("data", (s) => err.push(s));

  // We use the `"exit"` event only to remember the OS-reported
  // (code, signal) pair; we do not resolve on it. The final settlement
  // happens on `"close"` (all stdio drained) or on `"error"`.
  let exitInfo = { code: null, signal: null };
  child.once("exit", (code, signal) => {
    exitInfo = { code, signal };
  });

  const exited = new Promise((resolveExit, rejectExit) => {
    child.once("error", (e) => rejectExit(e));
    child.once("close", () => resolveExit(exitInfo));
  });

  return {
    child,
    exited,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

function lastStdoutJson(stdoutText) {
  const lines = stdoutText.split("\n").filter(Boolean);
  if (lines.length === 0) {
    throw new Error("expected at least one stdout line (loop summary)");
  }
  const last = lines[lines.length - 1];
  try {
    return JSON.parse(last);
  } catch (e) {
    throw new Error(
      `last stdout line was not JSON. Lines:\n${lines.join("\n---\n")}`,
    );
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Deterministic readiness gate (WI-GATE5). Resolves once the child has
 * written the readiness marker to STDERR — emitted by the bin right after
 * `installShutdownHandlers` arms the SIGINT/SIGTERM listeners (src/cli.ts).
 *
 * After this resolves, the child's SIGINT handler is provably armed, so a
 * SIGINT is guaranteed to flip the AbortController and shut the worker down
 * gracefully (exit 0 / stop_reason="stopped") — never Node's default
 * terminate action. This closes the host-load race the earlier
 * `waitForLiveChild` liveness poll could not (it only proved "alive +
 * stable", not "handlers installed").
 *
 * Rejects on early child exit or on timeout, with stderr diagnostics.
 */
async function waitForStderrMarker(
  childWrap,
  marker,
  { timeoutMs = 5000, pollMs = 20 } = {},
) {
  const { child } = childWrap;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childWrap.stderr().includes(marker)) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `child exited before emitting readiness marker: code=${child.exitCode}, ` +
        `signal=${child.signalCode}, stderr=${childWrap.stderr()}`,
      );
    }
    await sleep(pollMs);
  }
  throw new Error(
    `child did not emit readiness marker "${marker}" within ${timeoutMs}ms; ` +
    `exitCode=${child.exitCode}, signalCode=${child.signalCode}, ` +
    `stderr=${childWrap.stderr()}`,
  );
}

// The bin's WI-GATE5 child-side readiness marker (src/cli.ts), written to
// STDERR once the SIGINT/SIGTERM handlers are armed.
const READY_MARKER = "ocr-worker ready: signal-handlers-armed";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("bin --help: exits 0 and prints usage on real stdout", async (t) => {
  const w = spawnWorker(["--help"]);
  t.after(() => {
    if (w.child.exitCode === null) w.child.kill("SIGKILL");
  });
  const { code, signal } = await w.exited;
  assert.equal(signal, null);
  assert.equal(code, 0, `stderr=${w.stderr()}`);
  const out = w.stdout();
  assert.match(out, /OCR worker|Usage:/i);
});

test("bin --max-iterations=1 --idle-delay-ms=0: exits 0 with summary JSON on stdout", async (t) => {
  const w = spawnWorker([
    "--max-iterations=1",
    "--idle-delay-ms=0",
  ]);
  t.after(() => {
    if (w.child.exitCode === null) w.child.kill("SIGKILL");
  });
  const { code, signal } = await w.exited;
  assert.equal(signal, null);
  assert.equal(code, 0, `stderr=${w.stderr()}`);
  const summary = lastStdoutJson(w.stdout());
  assert.equal(summary.stop_reason, "max_iterations");
  assert.equal(summary.iterations, 1);
  assert.equal(summary.outcomes.empty, 1);
});

test("bin with bogus flag: exits 2 with config error on stderr (no summary on stdout)", async (t) => {
  const w = spawnWorker(["--bogus-flag"]);
  t.after(() => {
    if (w.child.exitCode === null) w.child.kill("SIGKILL");
  });
  const { code, signal } = await w.exited;
  assert.equal(signal, null);
  assert.equal(code, 2);
  assert.match(w.stderr(), /config|unknown/i);
  // Summary line MUST NOT have been emitted on a config-error exit.
  assert.equal(w.stdout().trim(), "");
});

test("bin SIGINT during idle loop: exits 0 with stop_reason=stopped", async (t) => {
  // No --max-iterations: the worker will idle forever until SIGINT.
  // --idle-delay-ms=50 keeps the loop responsive without a tight CPU
  // spin and bounds how long the loop takes to reach the next abort
  // check after we send SIGINT.
  const w = spawnWorker(["--idle-delay-ms=50"]);
  t.after(() => {
    if (w.child.exitCode === null) w.child.kill("SIGKILL");
  });

  // Deterministic readiness gate (WI-GATE5): wait for the child's
  // stderr readiness marker — emitted right after the bin arms its
  // SIGINT/SIGTERM handlers — BEFORE sending SIGINT. Once observed, the
  // handler is provably armed, so the SIGINT flips the AbortController
  // and the worker exits gracefully instead of via Node's default
  // terminate action. This removes the host-load race the old
  // `waitForLiveChild` liveness poll could not close.
  await waitForStderrMarker(w, READY_MARKER);
  w.child.kill("SIGINT");

  const { code, signal } = await w.exited;
  // Graceful: the wrapper assigned exitCode=0 from runOcrWorkerProcess,
  // so node exits normally — NOT via the SIGINT default action.
  assert.equal(signal, null, `expected normal exit, got signal=${signal}`);
  assert.equal(code, 0, `stderr=${w.stderr()}`);

  const summary = lastStdoutJson(w.stdout());
  assert.equal(summary.stop_reason, "stopped");
});
