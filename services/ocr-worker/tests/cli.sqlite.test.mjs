// Step 10J — CLI runtime wiring for queue=sqlite.
//
// Verifies buildDefaultDeps constructs SqliteOcrQueue + SqliteOcrPersistence
// against a single shared file path, runs the loop, and closes both DB
// handles on shutdown so the file lock is released.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runOcrWorkerProcess } from "../dist/index.js";

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

function freshTmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "ocr-worker-10j-"));
  const path = join(dir, "ocr.db");
  return {
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("queue=sqlite + persistence=sqlite default deps wiring runs and exits 0", async () => {
  const { path, cleanup } = freshTmpDb();
  try {
    const proc = makeFakeProcess();
    const code = await runOcrWorkerProcess({
      argv: [],
      env: {
        OCR_WORKER_PERSISTENCE: "sqlite",
        OCR_WORKER_QUEUE: "sqlite",
        OCR_WORKER_SQLITE_PATH: path,
        OCR_WORKER_MAX_ITERATIONS: "1",
        OCR_WORKER_IDLE_DELAY_MS: "0",
      },
      process: proc,
    });
    assert.equal(code, 0);
    const lines = getStdoutLines(proc);
    const summary = JSON.parse(lines[lines.length - 1]);
    assert.equal(summary.iterations, 1);
    assert.equal(summary.stop_reason, "max_iterations");
    assert.equal(summary.outcomes.empty, 1);

    // The DB file must still exist on disk (cleanup must close, not unlink).
    const stat = statSync(path);
    assert.ok(stat.size > 0);

    // Reopening the same file in a second worker process proves cleanup
    // released both connection's WAL locks. If the queue or persistence
    // handle had leaked, this run would fail or block.
    const proc2 = makeFakeProcess();
    const code2 = await runOcrWorkerProcess({
      argv: [],
      env: {
        OCR_WORKER_PERSISTENCE: "sqlite",
        OCR_WORKER_QUEUE: "sqlite",
        OCR_WORKER_SQLITE_PATH: path,
        OCR_WORKER_MAX_ITERATIONS: "1",
        OCR_WORKER_IDLE_DELAY_MS: "0",
      },
      process: proc2,
    });
    assert.equal(code2, 0);
  } finally {
    cleanup();
  }
});

test("queue=sqlite without persistence=sqlite → exit 2 (config error)", async () => {
  const proc = makeFakeProcess();
  const code = await runOcrWorkerProcess({
    argv: [],
    env: {
      OCR_WORKER_QUEUE: "sqlite",
      // persistence intentionally unset → defaults to memory
      OCR_WORKER_MAX_ITERATIONS: "1",
    },
    process: proc,
  });
  assert.equal(code, 2);
  const errBuf = proc.stderr_buf.join("");
  assert.match(errBuf, /queue=sqlite requires persistence=sqlite/);
});

test("queue=memory + persistence=sqlite still works (10E unchanged path)", async () => {
  const { path, cleanup } = freshTmpDb();
  try {
    const proc = makeFakeProcess();
    const code = await runOcrWorkerProcess({
      argv: [],
      env: {
        OCR_WORKER_PERSISTENCE: "sqlite",
        OCR_WORKER_SQLITE_PATH: path,
        OCR_WORKER_MAX_ITERATIONS: "1",
        OCR_WORKER_IDLE_DELAY_MS: "0",
      },
      process: proc,
    });
    assert.equal(code, 0);
  } finally {
    cleanup();
  }
});
