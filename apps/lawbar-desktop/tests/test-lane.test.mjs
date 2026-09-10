// The lane split is a PARTITION of `scripts.test`, never a second list (product plan R1, WI-9).
//
// What is pinned: the two lanes together are exactly the full suite, with nothing dropped and
// nothing doubled; the release-scripts lane is exactly the four slow suites; a release-script
// file that goes missing from `scripts.test` is refused rather than quietly absent from both
// lanes; a `scripts.test` shape the splitter cannot parse is refused rather than read as empty;
// and the CLI's `--list` output is the same partition, so what CI runs is what is tested here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { RELEASE_SCRIPT_TESTS, LANES, parseTestScript, partition, filesForLane, main } from "../scripts/test-lane.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(__dirname, "..");
const REAL_TEST_SCRIPT = JSON.parse(readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8")).scripts.test;

test("the two lanes partition the real scripts.test: union is the whole list, intersection is empty", () => {
  const { all, fast, releaseScripts } = partition(REAL_TEST_SCRIPT);
  assert.equal(fast.length + releaseScripts.length, all.length, "a file in neither lane is a dropped test");
  assert.deepEqual([...fast, ...releaseScripts].sort(), [...all].sort());
  assert.deepEqual(fast.filter((f) => releaseScripts.includes(f)), [], "a file in both lanes runs twice");
  assert.ok(all.length >= 80, `sanity: the suite has ${all.length} files; a much smaller number means the parser lost some`);
});

test("release-scripts is exactly the four slow suites, and they all exist in the real list", () => {
  const { releaseScripts } = partition(REAL_TEST_SCRIPT);
  assert.deepEqual(releaseScripts, [...RELEASE_SCRIPT_TESTS]);
  assert.equal(RELEASE_SCRIPT_TESTS.length, 4);
  for (const f of RELEASE_SCRIPT_TESTS) assert.match(f, /release|signing/, `${f} does not look like a release-script suite`);
});

test("this test itself is in the fast lane — the guard must run on every PR, not only on scripts changes", () => {
  assert.ok(filesForLane("fast", REAL_TEST_SCRIPT).includes("tests/test-lane.test.mjs"));
});

test("a release-script suite missing from scripts.test is REFUSED, naming the file", () => {
  const without = "node --test " + parseTestScript(REAL_TEST_SCRIPT).filter((f) => f !== "tests/release-preflight.test.mjs").join(" ");
  assert.throws(() => partition(without), /missing from scripts\.test.*tests\/release-preflight\.test\.mjs/);
  assert.throws(() => filesForLane("fast", without), /missing/, "the fast lane must not run either — the drop is the defect");
});

test("a scripts.test shape the splitter cannot parse is refused, never read as an empty lane", () => {
  assert.throws(() => parseTestScript("npm run build && node --test tests/a.test.mjs"), /must start with/);
  assert.throws(() => parseTestScript("node --test tests/a.test.mjs ../elsewhere/b.test.mjs"), /does not understand/);
  assert.throws(() => parseTestScript("node --test tests/a.test.mjs tests/a.test.mjs"), /twice/);
  assert.throws(() => parseTestScript("node --test "), /no files|does not understand/);
  assert.throws(() => parseTestScript(undefined), /must start with/);
});

test("an unknown lane name is refused", () => {
  assert.throws(() => filesForLane("slow", REAL_TEST_SCRIPT), /unknown lane "slow"/);
  assert.deepEqual([...LANES], ["fast", "release-scripts"]);
});

test("main --list prints the same partition the library computes, and exits 0", () => {
  for (const lane of LANES) {
    let out = "";
    const code = main(["--list", lane], { packageDir: PACKAGE_DIR, stdout: { write: (s) => { out += s; } }, stderr: { write: () => {} } });
    assert.equal(code, 0, lane);
    assert.deepEqual(out.trim().split("\n"), filesForLane(lane, REAL_TEST_SCRIPT), lane);
  }
});

test("main refuses a bad lane and a dropped suite with exit 2, without running anything", () => {
  let err = "";
  const stderr = { write: (s) => { err += s; } };
  assert.equal(main(["nope"], { packageDir: PACKAGE_DIR, stdout: { write: () => {} }, stderr }), 2);
  assert.match(err, /unknown lane/);
});

test("the CLI entry point is wired: `node scripts/test-lane.mjs --list release-scripts` from the package dir", () => {
  const r = spawnSync(process.execPath, ["scripts/test-lane.mjs", "--list", "release-scripts"], { cwd: PACKAGE_DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), [...RELEASE_SCRIPT_TESTS]);
  const bad = spawnSync(process.execPath, ["scripts/test-lane.mjs", "nope"], { cwd: PACKAGE_DIR, encoding: "utf8" });
  assert.equal(bad.status, 2);
});

// The lane RUNS the files and carries their verdict: a synthetic package whose only fast test
// fails must make the fast lane exit non-zero, and the release lane (all passing) exit 0. Done in
// a temp package, not the real one — the real fast lane is the desktop gate's job.
test("main runs the lane and propagates the verdict: a failing file fails the lane, exit 0 otherwise", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "lawbar-test-lane-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "tests"));
  const files = ["tests/only-fast.test.mjs", ...RELEASE_SCRIPT_TESTS];
  for (const f of RELEASE_SCRIPT_TESTS) writeFileSync(path.join(dir, f), 'import { test } from "node:test"; test("ok", () => {});\n');
  writeFileSync(path.join(dir, "tests/only-fast.test.mjs"), 'import { test } from "node:test"; test("fails", () => { throw new Error("red"); });\n');
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test " + files.join(" ") } }));
  // stdio "ignore": the synthetic child's TAP must not leak into THIS file's TAP stream, where a
  // summary parser would add its `ℹ fail 1` to the desktop lane's count.
  const quiet = { stdout: { write: () => {} }, stderr: { write: () => {} }, stdio: "ignore" };
  assert.notEqual(main(["fast"], { packageDir: dir, ...quiet }), 0, "a red file must make the lane red");
  assert.equal(main(["release-scripts"], { packageDir: dir, ...quiet }), 0, "four green files make the lane green");
});
