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

// WI-OCR-CONFIG-PATH-REDACTION-22: the startup config summary (stderr) must NOT leak
// the operator's config path — not the full path, not the (potentially client-named)
// parent directory, and not the basename. It emits only a `fp:<hash>` fingerprint so an
// operator can correlate without any path component being exposed.
test("startup config log redacts sqlite_path to a fingerprint (no path / dir / basename leak)", async () => {
  // A temp dir + db filename deliberately carrying identifying-looking tokens.
  const root = mkdtempSync(join(tmpdir(), "ocr-worker-22-SECRETclientdir-"));
  const dbPath = join(root, "ClientMatter-case.db");
  try {
    const proc = makeFakeProcess();
    const code = await runOcrWorkerProcess({
      argv: [],
      env: {
        OCR_WORKER_PERSISTENCE: "sqlite",
        OCR_WORKER_QUEUE: "sqlite",
        OCR_WORKER_SQLITE_PATH: dbPath,
        OCR_WORKER_MAX_ITERATIONS: "1",
        OCR_WORKER_IDLE_DELAY_MS: "0",
      },
      process: proc,
    });
    assert.equal(code, 0);
    const stderr = proc.stderr_buf.join("");
    // No path components leak to the startup log.
    assert.doesNotMatch(stderr, /SECRETclientdir/, "must not log the (identifying) parent dir");
    assert.doesNotMatch(stderr, /ClientMatter-case\.db/, "must not log the (identifying) basename");
    assert.ok(!stderr.includes(root), "must not log the full config directory");
    assert.ok(!stderr.includes(dbPath), "must not log the full sqlite_path");
    // The redacted fingerprint IS present for operator correlation.
    assert.match(stderr, /"sqlite_path":"fp:[0-9a-f]{8}"/, "sqlite_path redacted to fp:<hash>");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// WI-22 audit H1: the fetcher_file_root stat-failure error must NOT leak the path via
// the native statSync message ("ENOENT ... stat '/…/client-folder'"). It reports the
// errno CODE only, with the path redacted to a fingerprint.
test("fetcher_file_root stat error redacts the path (errno code only, no native-message leak)", async () => {
  const { path: sqlitePath, cleanup } = freshTmpDb();
  // An ABSOLUTE but MISSING fetcher root carrying identifying tokens: config parse
  // accepts the absolute string; the buildDefaultDeps stat check then fails.
  const missingRoot = join(tmpdir(), "ocr-worker-22-SECRETfetchdir-missing", "ClientRoot-XYZ");
  try {
    const proc = makeFakeProcess();
    const code = await runOcrWorkerProcess({
      argv: [],
      env: {
        OCR_WORKER: "paddleocr-onnx",
        OCR_FETCHER_FILE_ROOT: missingRoot,
        OCR_WORKER_PERSISTENCE: "sqlite",
        OCR_WORKER_QUEUE: "sqlite",
        OCR_WORKER_SQLITE_PATH: sqlitePath,
        OCR_WORKER_MAX_ITERATIONS: "1",
        OCR_WORKER_IDLE_DELAY_MS: "0",
      },
      process: proc,
      // no buildDeps override -> real buildDefaultDeps -> the stat check fires
    });
    assert.equal(code, 2, "missing fetcher_file_root -> startup failure exit 2");
    const stderr = proc.stderr_buf.join("");
    assert.doesNotMatch(stderr, /SECRETfetchdir/, "must not log the parent dir (native stat message)");
    assert.doesNotMatch(stderr, /ClientRoot-XYZ/, "must not log the basename");
    assert.ok(!stderr.includes(missingRoot), "must not log the full fetcher_file_root");
    assert.match(
      stderr,
      /fetcher_file_root "fp:[0-9a-f]{8}" cannot be stat'd/,
      "redacted path + errno-code error message",
    );
  } finally {
    cleanup();
  }
});

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
