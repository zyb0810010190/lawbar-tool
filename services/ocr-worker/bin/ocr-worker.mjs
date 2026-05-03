#!/usr/bin/env node
// Step 10G — OCR worker bin wrapper.
//
// The smallest possible OS-process shell around `runOcrWorkerProcess`.
// All semantics live in `src/cli.ts`; this file only:
//
//   1. forwards the real `process.argv` (tail) and `process.env`,
//   2. forwards the real `process` (so SIGINT/SIGTERM listeners attach
//      to the actual node process and stdout/stderr go to real fds),
//   3. assigns the runtime's returned numeric code to `process.exitCode`.
//
// Deliberately does NOT call `process.exit()`: letting node drain the
// event loop and flush stdout naturally is the contract `cli.ts` was
// designed against (cleanup runs on every post-buildDeps exit path; we
// don't want to truncate that).

import { runOcrWorkerProcess } from "../dist/index.js";

const code = await runOcrWorkerProcess({
  argv: process.argv.slice(2),
  env: process.env,
  process,
});

process.exitCode = code;
