// Step 10I-B2a — run the contract-level queue conformance harness against
// `SqliteOcrQueue`.
//
// We import the harness from `ocr-worker-contract/testing` (the canonical
// neutral location, see ADR `docs/adr/ocr-queue-boundary-amendment-step-10h-a.md`)
// and the queue itself from the published persistence dist surface — never
// from `src/`. `OcrQueueError` comes from the contract package and is the
// same class identity the harness defaults to, so `instanceof` assertions
// stay honest across the boundary.
//
// Each `makeImpl(...)` call mints a fresh file-backed SQLite database in a
// per-call temp directory. Restart-lineage tests live separately in
// `sqliteQueue.lineage.test.mjs`; this file proves only that the durable
// implementation passes the same conformance matrix as the in-memory
// backend.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteOcrQueue } from "../dist/index.js";
import { runOcrQueueConformance } from "ocr-worker-contract/testing";

// Track every temp dir created by makeImpl. The harness creates a queue per
// test and (with one exception) does not call `close()`. better-sqlite3
// releases its connection on GC / process exit, so we just sweep the dirs
// once at process exit. Keeps test files unchanged when the harness gains
// new cases.
const tempDirs = [];
process.on("exit", () => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

runOcrQueueConformance({
  label: "SqliteOcrQueue",
  makeImpl: ({ now, leaseMs, generateReceipt } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "ocr-queue-conformance-"));
    tempDirs.push(dir);
    const path = join(dir, "queue.sqlite");
    const { queue } = openSqliteOcrQueue({ path, now, leaseMs, generateReceipt });
    return queue;
  },
});
