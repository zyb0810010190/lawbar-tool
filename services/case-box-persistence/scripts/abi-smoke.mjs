#!/usr/bin/env node
// ABI smoke check for better-sqlite3 in case-box-persistence.
//
// Fast-fails before the test suite runs so a stale native binding
// surfaces as `[case-box-abi-smoke] FAIL`, not as opaque
// `ERR_DLOPEN_FAILED` inside one of the SQLite test files.
// Mirrors services/ocr-persistence/scripts/abi-smoke.mjs per
// dev-memo/plan-case-box-persistence-B1-matter.md §1.1.
//
// No filesystem I/O beyond `:memory:`. No env deps. Exit 0 on
// success, exit 1 on any throw.

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
  console.log("[case-box-abi-smoke] OK better-sqlite3 native binding loads on this Node ABI");
  process.exit(0);
} catch (err) {
  console.error(`[case-box-abi-smoke] FAIL: ${err?.message ?? err}`);
  process.exit(1);
}
