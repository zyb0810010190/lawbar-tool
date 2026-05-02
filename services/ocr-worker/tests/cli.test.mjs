// Step 10E — runOcrWorkerProcess tests.
//
// In-process integration: drives the runtime entrypoint through a fake
// Node `process` (EventEmitter + writable stdout/stderr buffers) and
// optional dep injection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  runOcrWorkerProcess,
  InMemoryOcrQueue,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeFakeProcess() {
  const proc = new EventEmitter();
  proc.stdout_buf = [];
  proc.stderr_buf = [];
  proc.stdout = { write: (s) => proc.stdout_buf.push(String(s)) };
  proc.stderr = { write: (s) => proc.stderr_buf.push(String(s)) };
  return proc;
}

function getStdoutLines(proc) {
  return proc.stdout_buf.join("").split("\n").filter(Boolean);
}
function getStderrText(proc) {
  return proc.stderr_buf.join("");
}

/** Persistence stub that reports every job as missing → coordinator path B2. */
function emptyPersistence() {
  return {
    async getOcrJob() {
      return null;
    },
    async appendOcrStatusOnce() {
      return undefined;
    },
    async saveOcrResultOnce() {
      return undefined;
    },
  };
}

/** Worker stub that should never be invoked when the queue is empty. */
function unusedWorker() {
  return {
    async process() {
      throw new Error("worker should not be called when queue is empty");
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("config error → stderr message + exit code 2", async () => {
  const proc = makeFakeProcess();
  const code = await runOcrWorkerProcess({
    argv: ["--bogus"],
    env: {},
    process: proc,
  });
  assert.equal(code, 2);
  const err = getStderrText(proc);
  assert.match(err, /config|unknown/i);
  // Summary must NOT have been written on a config error.
  assert.equal(getStdoutLines(proc).length, 0);
});

test("missing sqlite_path → exit code 2", async () => {
  const proc = makeFakeProcess();
  const code = await runOcrWorkerProcess({
    argv: [],
    env: { OCR_WORKER_PERSISTENCE: "sqlite" },
    process: proc,
  });
  assert.equal(code, 2);
});

test("--help short-circuits with exit 0 and stdout usage text", async () => {
  const proc = makeFakeProcess();
  const code = await runOcrWorkerProcess({
    argv: ["--help"],
    env: {},
    process: proc,
  });
  assert.equal(code, 0);
  const out = proc.stdout_buf.join("");
  assert.match(out, /OCR worker|usage/i);
});

test("max_iterations=1 with empty queue → exit 0 + summary JSON on stdout", async () => {
  const proc = makeFakeProcess();
  const code = await runOcrWorkerProcess({
    argv: [],
    env: {
      OCR_WORKER_MAX_ITERATIONS: "1",
      OCR_WORKER_IDLE_DELAY_MS: "0",
    },
    process: proc,
    buildDeps: async () => ({
      queue: new InMemoryOcrQueue(),
      persistence: emptyPersistence(),
      worker: unusedWorker(),
    }),
  });
  assert.equal(code, 0);
  const lines = getStdoutLines(proc);
  // Find the summary line — last non-empty stdout line.
  const last = lines[lines.length - 1];
  const summary = JSON.parse(last);
  assert.equal(summary.iterations, 1);
  assert.equal(summary.stop_reason, "max_iterations");
  assert.equal(summary.outcomes.empty, 1);
});

test("SIGINT during idle loop → graceful stop, exit 0", async () => {
  const proc = makeFakeProcess();
  const codeP = runOcrWorkerProcess({
    argv: [],
    env: { OCR_WORKER_IDLE_DELAY_MS: "5" },
    process: proc,
    buildDeps: async () => ({
      queue: new InMemoryOcrQueue(),
      persistence: emptyPersistence(),
      worker: unusedWorker(),
    }),
  });
  // Let the loop run a few idle iterations, then SIGINT.
  await new Promise((r) => setTimeout(r, 30));
  proc.emit("SIGINT");
  const code = await codeP;
  assert.equal(code, 0);
  const lines = getStdoutLines(proc);
  const summary = JSON.parse(lines[lines.length - 1]);
  assert.equal(summary.stop_reason, "stopped");
});

test("buildDeps throws → exit 2 (startup failure)", async () => {
  const proc = makeFakeProcess();
  const code = await runOcrWorkerProcess({
    argv: [],
    env: {},
    process: proc,
    buildDeps: async () => {
      throw new Error("dep wiring blew up");
    },
  });
  assert.equal(code, 2);
  assert.match(getStderrText(proc), /dep wiring blew up/);
});

test("loop error (coordinator throws) → exit 1", async () => {
  const proc = makeFakeProcess();
  // Inject deps + a coordinator override that throws on processOne so the
  // loop returns stop_reason="error".
  const code = await runOcrWorkerProcess({
    argv: [],
    env: { OCR_WORKER_MAX_ITERATIONS: "1", OCR_WORKER_IDLE_DELAY_MS: "0" },
    process: proc,
    buildDeps: async () => ({
      queue: new InMemoryOcrQueue(),
      persistence: emptyPersistence(),
      worker: unusedWorker(),
      // Test seam: a coordinator override skips the default construction.
      coordinator: {
        async processOne() {
          throw new Error("coordinator boom");
        },
      },
    }),
  });
  assert.equal(code, 1);
  const lines = getStdoutLines(proc);
  const summary = JSON.parse(lines[lines.length - 1]);
  assert.equal(summary.stop_reason, "error");
  assert.match(summary.last_error.message, /coordinator boom/);
});

test("cleanup is invoked on graceful stop", async () => {
  const proc = makeFakeProcess();
  let cleanedUp = false;
  await runOcrWorkerProcess({
    argv: [],
    env: { OCR_WORKER_MAX_ITERATIONS: "1", OCR_WORKER_IDLE_DELAY_MS: "0" },
    process: proc,
    buildDeps: async () => ({
      queue: new InMemoryOcrQueue(),
      persistence: emptyPersistence(),
      worker: unusedWorker(),
      cleanup: async () => {
        cleanedUp = true;
      },
    }),
  });
  assert.equal(cleanedUp, true);
});

test("cleanup is invoked even when loop ends in error", async () => {
  const proc = makeFakeProcess();
  let cleanedUp = false;
  await runOcrWorkerProcess({
    argv: [],
    env: { OCR_WORKER_MAX_ITERATIONS: "1", OCR_WORKER_IDLE_DELAY_MS: "0" },
    process: proc,
    buildDeps: async () => ({
      queue: new InMemoryOcrQueue(),
      persistence: emptyPersistence(),
      worker: unusedWorker(),
      coordinator: {
        async processOne() {
          throw new Error("x");
        },
      },
      cleanup: async () => {
        cleanedUp = true;
      },
    }),
  });
  assert.equal(cleanedUp, true);
});

test("signal handlers are uninstalled after process exits", async () => {
  const proc = makeFakeProcess();
  await runOcrWorkerProcess({
    argv: [],
    env: { OCR_WORKER_MAX_ITERATIONS: "1", OCR_WORKER_IDLE_DELAY_MS: "0" },
    process: proc,
    buildDeps: async () => ({
      queue: new InMemoryOcrQueue(),
      persistence: emptyPersistence(),
      worker: unusedWorker(),
    }),
  });
  assert.equal(proc.listenerCount("SIGINT"), 0);
  assert.equal(proc.listenerCount("SIGTERM"), 0);
});

test("default deps path: no buildDeps + max_iterations=1 → exit 0", async () => {
  // Verifies the production default wiring builds without injection.
  const proc = makeFakeProcess();
  const code = await runOcrWorkerProcess({
    argv: [],
    env: { OCR_WORKER_MAX_ITERATIONS: "1", OCR_WORKER_IDLE_DELAY_MS: "0" },
    process: proc,
  });
  assert.equal(code, 0);
  const lines = getStdoutLines(proc);
  const summary = JSON.parse(lines[lines.length - 1]);
  assert.equal(summary.iterations, 1);
  assert.equal(summary.outcomes.empty, 1);
});
