// Step 10G — real-process spawn smoke tests for the bin wrapper.
//
// These tests deliberately do NOT use the in-process EventEmitter fake
// from cli.test.mjs. They spawn `bin/ocr-worker.mjs` as a real Node
// child process and observe its real stdout/stderr/exitCode/signals.
//
// NOTE on test runner concurrency (audit 019e3a4c D9 L):
// `services/ocr-worker/package.json#scripts.test` runs `node --test`
// with `--test-concurrency=1`. The SIGINT idle-loop test below uses a
// `waitForLiveChild` liveness gate (`stableTicks * pollMs = 100ms`)
// that is fragile under host load: when other heavy test files
// (mkdtemp + writeFile + spawn) run concurrently with this one, the
// bin's `installShutdownHandlers` can miss the `100ms` window before
// SIGINT arrives, and Node's default SIGINT action terminates the
// process before the worker's graceful exit fires. The deterministic
// fix is sequential test execution. A real readiness-protocol fix
// (worker bin emits a "READY" marker on stdout; test polls for it)
// would let the suite run concurrently again — that's separate
// bin-shaped work tracked outside ADR-11C.3b.
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
 * Bounded liveness gate before sending a signal to the child.
 *
 * Sequence:
 *   1. wait for the child's `"spawn"` event (OS-level fork complete);
 *   2. poll briefly until the child has a numeric `pid`, has not yet
 *      exited (`exitCode === null && signalCode === null`), and has
 *      not been killed (`!killed`) — for a small number of consecutive
 *      stable ticks, so we are not racing the very first tick after
 *      `"spawn"`;
 *   3. if the child exits during the poll, throw with diagnostic;
 *   4. fail with diagnostic if the overall `timeoutMs` is exceeded.
 *
 * This is **not** a formal readiness protocol. The worker has no
 * child-side ready signal (intentionally — adding one would be a
 * production change, out of scope for 10G), so this gate cannot prove
 * "signal handlers are installed." It only proves "the child process
 * is alive and stable" before the test sends a signal. A future
 * explicit readiness handshake on the worker side would let us drop
 * the stable-ticks padding entirely.
 */
async function waitForLiveChild(
  childWrap,
  { timeoutMs = 3000, pollMs = 25, stableTicks = 4 } = {},
) {
  const { child } = childWrap;
  // (1) Wait for spawn or surface immediate spawn-failure / early exit.
  if (child.pid === undefined) {
    await new Promise((res, rej) => {
      const cleanup = () => {
        child.off("spawn", onSpawn);
        child.off("error", onErr);
        child.off("exit", onExit);
      };
      const onSpawn = () => { cleanup(); res(); };
      const onErr = (e) => { cleanup(); rej(e); };
      const onExit = (code, signal) =>
        { cleanup(); rej(new Error(`child exited before spawn: code=${code}, signal=${signal}`)); };
      child.once("spawn", onSpawn);
      child.once("error", onErr);
      child.once("exit", onExit);
    });
  }
  // (2) Poll for stable liveness.
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `child exited before becoming live: code=${child.exitCode}, ` +
        `signal=${child.signalCode}, stderr=${childWrap.stderr()}`,
      );
    }
    if (typeof child.pid === "number" && !child.killed) {
      stable += 1;
      if (stable >= stableTicks) return;
    } else {
      stable = 0;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `child did not become live within ${timeoutMs}ms; ` +
    `pid=${child.pid}, killed=${child.killed}, exitCode=${child.exitCode}, ` +
    `signalCode=${child.signalCode}, stderr=${childWrap.stderr()}`,
  );
}

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

  // Bounded liveness gate: wait for `spawn`, then poll briefly until
  // pid is stable and the child has not exited. This is *not* a formal
  // readiness protocol — the worker has no child-side ready signal —
  // but it replaces a fixed sleep with a bounded, diagnostic check that
  // surfaces premature exits as test failures instead of as flakes.
  await waitForLiveChild(w);
  w.child.kill("SIGINT");

  const { code, signal } = await w.exited;
  // Graceful: the wrapper assigned exitCode=0 from runOcrWorkerProcess,
  // so node exits normally — NOT via the SIGINT default action.
  assert.equal(signal, null, `expected normal exit, got signal=${signal}`);
  assert.equal(code, 0, `stderr=${w.stderr()}`);

  const summary = lastStdoutJson(w.stdout());
  assert.equal(summary.stop_reason, "stopped");
});
