#!/usr/bin/env node
// ABI smoke check for better-sqlite3.
//
// Fast-fails before the full test suite runs so a stale native binding
// surfaces as a clear `[abi-smoke] FAIL` line, not as opaque
// `ERR_DLOPEN_FAILED` inside one of dozens of SQLite test files.
// Plan: dev-memo/plan-abi-00-better-sqlite3.md §3.1 Step 2 item 2.
//
// No filesystem I/O beyond `:memory:`. No env deps. Exit 0 on success,
// exit 1 on any throw.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

try {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  const row = db.prepare("SELECT 1 AS x").get();
  db.close();
  if (row?.x !== 1) {
    throw new Error(`unexpected SELECT 1 result: ${JSON.stringify(row)}`);
  }
  console.log("[abi-smoke] OK better-sqlite3 native binding loads on this Node ABI");
  process.exit(0);
} catch (err) {
  console.error(`[abi-smoke] FAIL: ${err?.message ?? err}`);
  process.exit(1);
}
