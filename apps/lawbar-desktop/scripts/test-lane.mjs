#!/usr/bin/env node
// test-lane.mjs — run a NAMED SUBSET of the desktop suite without a second hand-maintained list.
//
// WHY THIS EXISTS (product plan R1, WI-9). Four test files — the release-script harness, the two
// preflight suites and verify-macos-signing — spawn `bash` and `codesign` repeatedly and take about
// 21 of the full lane's 27 minutes, and nothing in them can change when renderer copy changes.
// Running them on every PR is most of the macOS bill. The CI split wants two lanes: everything
// else ("fast") on every PR, the four ("release-scripts") when apps/lawbar-desktop/scripts/** or
// the workflow moves.
//
// WHY NOT TWO MORE FILE LISTS IN package.json. `scripts.test` is ALREADY a hand-maintained list,
// and this repo has a documented trap around it: a test file that is not appended there never
// runs and looks like coverage. Two more lists would triple the ways to drop a test silently.
// So the ONLY list stays `scripts.test`; this script reads it, and the two lanes are a partition
// of it: `release-scripts` = the four named below, `fast` = everything else. Each of the four
// must be present in `scripts.test` or the script refuses to run — a file that vanished from the
// full lane must not silently vanish from the split lanes as well.
//
// Fail-closed on shape: `scripts.test` must be exactly `node --test <tests/*.test.mjs ...>`. If
// someone rewrites it into something this parser does not understand, the answer is an error,
// not an empty lane that passes.
//
// Usage:
//   node scripts/test-lane.mjs fast
//   node scripts/test-lane.mjs release-scripts
//   node scripts/test-lane.mjs --list fast        # print the files, run nothing
//
// The npm `pretest` chain (build, import lint, no-real-data, ui-color) does NOT run for
// `npm run test:<lane>`; the package.json scripts that call this prepend it explicitly.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const LANES = Object.freeze(["fast", "release-scripts"]);

/** The four release-script suites. Order is the order they appear in `scripts.test`. */
export const RELEASE_SCRIPT_TESTS = Object.freeze([
  "tests/release-script-harness.test.mjs",
  "tests/release-preflight.test.mjs",
  "tests/release-preflight-failclosed.test.mjs",
  "tests/verify-macos-signing.test.mjs",
]);

const PREFIX = "node --test ";
const FILE_RE = /^tests\/[A-Za-z0-9._-]+\.test\.mjs$/;

/** Parse `scripts.test` into its file list, refusing any shape other than the one expected. */
export function parseTestScript(testScript) {
  if (typeof testScript !== "string" || !testScript.startsWith(PREFIX)) {
    throw new Error(`scripts.test must start with "${PREFIX}"; refusing to guess a file list`);
  }
  const files = testScript.slice(PREFIX.length).trim().split(/\s+/);
  for (const f of files) {
    if (!FILE_RE.test(f)) throw new Error(`scripts.test carries a token this lane splitter does not understand: ${JSON.stringify(f)}`);
  }
  const dup = files.find((f, i) => files.indexOf(f) !== i);
  if (dup !== undefined) throw new Error(`scripts.test lists ${dup} twice`);
  if (files.length === 0) throw new Error("scripts.test lists no files");
  return files;
}

/** Split the full list into the two lanes. Throws if any release-script suite is missing from it. */
export function partition(testScript) {
  const all = parseTestScript(testScript);
  const missing = RELEASE_SCRIPT_TESTS.filter((f) => !all.includes(f));
  if (missing.length > 0) {
    throw new Error(`release-script suite(s) missing from scripts.test — a dropped test is not a faster lane: ${missing.join(", ")}`);
  }
  const releaseScripts = all.filter((f) => RELEASE_SCRIPT_TESTS.includes(f));
  const fast = all.filter((f) => !RELEASE_SCRIPT_TESTS.includes(f));
  return { all, fast, releaseScripts };
}

export function filesForLane(lane, testScript) {
  const p = partition(testScript);
  if (lane === "fast") return p.fast;
  if (lane === "release-scripts") return p.releaseScripts;
  throw new Error(`unknown lane ${JSON.stringify(lane)}; expected one of ${LANES.join(", ")}`);
}

function readTestScript(packageDir) {
  const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  return pkg?.scripts?.test;
}

export function main(argv, { packageDir, stdout = process.stdout, stderr = process.stderr, stdio = "inherit" } = {}) {
  const list = argv[0] === "--list";
  const lane = list ? argv[1] : argv[0];
  let files;
  try {
    files = filesForLane(lane, readTestScript(packageDir));
  } catch (err) {
    stderr.write(`test-lane: ${err.message}\n`);
    return 2;
  }
  if (list) {
    stdout.write(files.join("\n") + "\n");
    return 0;
  }
  stderr.write(`test-lane: ${lane} — ${files.length} file(s)\n`);
  // A nested `node --test` that inherits NODE_TEST_CONTEXT from an enclosing runner reports to
  // that runner over IPC and exits 0 whatever its files did. This lane is never a child test;
  // drop the variable so the child's exit status is the verdict.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--test", ...files], { cwd: packageDir, stdio, env });
  if (r.error) {
    stderr.write(`test-lane: could not start node --test: ${r.error.message}\n`);
    return 2;
  }
  return r.status ?? 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  process.exit(main(process.argv.slice(2), { packageDir: path.resolve(here, "..") }));
}
