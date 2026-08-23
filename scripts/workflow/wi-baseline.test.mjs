// Behavioural tests for scripts/workflow/wi-baseline.sh.
//
// Every case below pins a defect that a real audit found in the version of this logic that
// lived inside docs/development-workflow.md as a fenced code block. Four rounds of adversarial
// review found 46 defects in those documents; the ones reachable by execution are here, and
// each would now fail on the first test run instead of surviving in prose.
//
// Real git repos in real temp directories. No mocking library exists in this repo and none is
// used — a fake git would not have caught the tree-object bug, which is the whole point.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "wi-baseline.sh");

/** A throwaway git repo with one commit, so HEAD means something. */
function makeRepo(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wi-baseline-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  git("add", "-A");
  git("commit", "-qm", "baseline");
  return dir;
}

/** Run a subcommand in `cwd` and return {status, out}. */
function run(cmd, { cwd, env = {} } = {}) {
  const r = spawnSync("/bin/bash", [SCRIPT, cmd], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const REPO_FILES = {
  "src/a.ts": "export const a = 1;\n",
  "src/nested/b.ts": "export const b = 2;\n",
  "other/c.ts": "export const c = 3;\n",
};

// --------------------------------------------------------------------------- check-paths

test("B-1 check-paths accepts real git pathspecs", () => {
  const dir = makeRepo(REPO_FILES);
  try {
    const r = run("check-paths", { cwd: dir, env: { PATHS_UNDER_CHANGE: "src/a.ts\nother/c.ts" } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /pathspecs ok/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("B-2 check-paths rejects the queue's human-readable column", () => {
  // Verified against the real queue: WI-05's Declared files column reads
  // "auditHandlers.ts, persistence read paths", and word-splitting yields the bare words
  // `persistence`, `read`, `paths`. None is a git object, so each silently counted as
  // new-at-HEAD and pushed the greenfield evidence the wrong way.
  const dir = makeRepo(REPO_FILES);
  try {
    const r = run("check-paths", {
      cwd: dir,
      env: { PATHS_UNDER_CHANGE: "src/a.ts\npersistence\nread\npaths" },
    });
    assert.equal(r.status, 1, "prose must be refused");
    assert.match(r.out, /NOT A PATHSPEC: 'persistence'/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("B-3 check-paths fails when nothing is declared", () => {
  const dir = makeRepo(REPO_FILES);
  try {
    assert.equal(run("check-paths", { cwd: dir, env: { PATHS_UNDER_CHANGE: "" } }).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------- preserve

test("B-4 an unset SCRATCH refuses instead of resolving paths under /", () => {
  // The original used "$SCRATCH/..." with SCRATCH defined nowhere in the document, so the
  // cleanup step resolved to `rm -rf /baseline-desktop`. The guard is the whole fix.
  const dir = makeRepo(REPO_FILES);
  try {
    const r = run("preserve", {
      cwd: dir,
      env: { PATHS_UNDER_CHANGE: "src/a.ts", GREENFIELD: "no", SCRATCH: "", ALLOW_DIRTY: "1" },
    });
    assert.equal(r.status, 1);
    assert.match(r.out, /SCRATCH is unset/);
    assert.match(r.out, /refusing to run/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("B-5 a TREE path is verified, not silently skipped", () => {
  // The defect: the verify loop ran only for objects of type `blob` and `continue`d past
  // trees — while still printing "baseline verified against HEAD". A declared path like
  // `services/case-box-persistence/src/sqlite/**` is a tree, so the commonest real case was
  // the unverified one.
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const r = run("preserve", {
      cwd: dir,
      env: { PATHS_UNDER_CHANGE: "src", GREENFIELD: "no", SCRATCH: scratch, ALLOW_DIRTY: "1" },
    });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /baseline verified against HEAD \(2 file\(s\)/,
      "both files inside the tree must be counted, not zero");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-6 a tampered file INSIDE a tree is caught", () => {
  // The load-bearing property of the whole stage. The first draft of this test called
  // `preserve` twice — which re-snapshots from HEAD and overwrites the tampering — and then
  // asserted `status === 0 || /MISMATCH/`, a disjunction satisfied either way. It could not
  // fail. That is why `verify` exists as a separate entry point.
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const env = { PATHS_UNDER_CHANGE: "src", GREENFIELD: "no", SCRATCH: scratch, ALLOW_DIRTY: "1" };
    assert.equal(run("preserve", { cwd: dir, env }).status, 0, "sound baseline must verify");

    const victim = path.join(scratch, "baseline", "src", "nested", "b.ts");
    appendFileSync(victim, "// tampered\n");

    const r = run("verify", { cwd: dir, env });
    assert.equal(r.status, 1, "a tampered baseline must NOT verify");
    assert.match(r.out, /BASELINE MISMATCH: src\/nested\/b\.ts/,
      "and it must name the file, not just fail");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-6b a baseline file that has gone missing is caught, not skipped", () => {
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const env = { PATHS_UNDER_CHANGE: "src", GREENFIELD: "no", SCRATCH: scratch, ALLOW_DIRTY: "1" };
    assert.equal(run("preserve", { cwd: dir, env }).status, 0);
    rmSync(path.join(scratch, "baseline", "src", "a.ts"));
    const r = run("verify", { cwd: dir, env });
    assert.equal(r.status, 1);
    assert.match(r.out, /BASELINE MISSING: src\/a\.ts/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-7b blank-line-only input reaches the empty-baseline guard", () => {
  // B-7 below passes for a DIFFERENT reason now: since preserve self-validates, an empty
  // PATHS_UNDER_CHANGE is refused by the validator and never reaches the guard. Mutation
  // testing exposed that — removing the guard entirely changed nothing. Blank lines pass
  // validation (they are skipped) and then process zero paths, which is the one reachable
  // route to "nothing was even examined".
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const r = run("preserve", {
      cwd: dir,
      env: { PATHS_UNDER_CHANGE: "\n\n", GREENFIELD: "no", SCRATCH: scratch, ALLOW_DIRTY: "1" },
    });
    assert.equal(r.status, 1, "processing zero paths must not report success");
    assert.match(r.out, /BASELINE EMPTY: nothing was even examined/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-7 verifying nothing at all is not success", () => {
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const r = run("preserve", {
      cwd: dir,
      env: { PATHS_UNDER_CHANGE: "", GREENFIELD: "no", SCRATCH: scratch, ALLOW_DIRTY: "1" },
    });
    assert.equal(r.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-8 a genuinely greenfield item passes rather than being blocked", () => {
  // The over-correction: a counter that required verified>0 blocked an item whose declared
  // paths are all new, seconds after printing "two-sided verification does not apply here".
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const r = run("preserve", {
      cwd: dir,
      env: { PATHS_UNDER_CHANGE: "src/brand-new.ts", GREENFIELD: "yes", SCRATCH: scratch, ALLOW_DIRTY: "1" },
    });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /NO BASELINE: src\/brand-new\.ts is new at HEAD/);
    assert.match(r.out, /\(0 file\(s\); 1 new at HEAD\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-9 asserting greenfield while the paths exist at HEAD is refused", () => {
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const r = run("preserve", {
      cwd: dir,
      env: { PATHS_UNDER_CHANGE: "src/a.ts", GREENFIELD: "yes", SCRATCH: scratch, ALLOW_DIRTY: "1" },
    });
    assert.equal(r.status, 1);
    assert.match(r.out, /CONTRADICTION: greenfield asserted, but 1 declared path/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-10 the new-helper case passes but is flagged for review", () => {
  // GREENFIELD=no with nothing at HEAD is legitimate — a change to existing behaviour routed
  // through a new module. It must not be waived silently; that is the bypass two separate
  // audits identified from opposite directions.
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const r = run("preserve", {
      cwd: dir,
      env: { PATHS_UNDER_CHANGE: "src/helper-new.ts", GREENFIELD: "no", SCRATCH: scratch, ALLOW_DIRTY: "1" },
    });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /new-helper case/);
    assert.match(r.out, /name the existing entrypoint in Notes/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-11 GREENFIELD must be asserted explicitly, never defaulted", () => {
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    for (const v of ["", "maybe", "true", "1"]) {
      const r = run("preserve", {
        cwd: dir,
        env: { PATHS_UNDER_CHANGE: "src/a.ts", GREENFIELD: v, SCRATCH: scratch, ALLOW_DIRTY: "1" },
      });
      assert.equal(r.status, 1, `GREENFIELD=${JSON.stringify(v)} must be refused`);
      assert.match(r.out, /GREENFIELD must be yes or no/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-12 a dirty tree refuses to baseline against HEAD, with an actionable remedy", () => {
  // HEAD is the baseline only when the tree is clean. This repo routinely carries dozens of
  // completed-but-uncommitted items, and a HEAD baseline then fails for unrelated older work
  // — which reads as regression evidence and is worse than no result.
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 999;\n");
    const r = run("preserve", {
      cwd: dir,
      env: { PATHS_UNDER_CHANGE: "src/a.ts", GREENFIELD: "no", SCRATCH: scratch },
    });
    assert.equal(r.status, 1);
    assert.match(r.out, /WORKING TREE IS DIRTY/);
    assert.match(r.out, /Commit the completed items first/);
    assert.match(r.out, /only push, PR, merge and branch deletion do/,
      "the remedy must say plainly that committing needs no authorization");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------- classify

test("B-13 the verdict is the failure KIND, and only an assertion is evidence", () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  const log = path.join(scratch, "run.log");
  const cases = [
    ["Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/x/y.js'", 1, 1, /INCONCLUSIVE.*module load failed/],
    ["# pass 6\n# fail 0",                                          0, 1, /NO TEETH.*PASSES against pre-change/],
    ["AssertionError [ERR_ASSERTION]: main.js must route",          1, 0, /TEETH: an assertion failed/],
    ["Segmentation fault",                                          1, 1, /INCONCLUSIVE.*crashed before asserting/],
  ];
  try {
    for (const [body, status, wantExit, wantMsg] of cases) {
      writeFileSync(log, body);
      const r = run("classify", { env: { BASELINE_LOG: log, BASELINE_STATUS: String(status) } });
      assert.match(r.out, wantMsg);
      assert.equal(r.status, wantExit, `exit for ${JSON.stringify(body.slice(0, 28))}: ${r.out}`);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("B-14 a missing module is NOT a greenfield waiver", () => {
  // Both directions of this were argued by separate audits and both are half right: a runtime
  // module error is produced by a typo, a missing fixture, an absent dependency AND by a
  // change deliberately routed through a new wrapper. It cannot grant a pass.
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  const log = path.join(scratch, "run.log");
  try {
    writeFileSync(log, "Error [ERR_MODULE_NOT_FOUND]: Cannot find module\n");
    const r = run("classify", { env: { BASELINE_LOG: log, BASELINE_STATUS: "1" } });
    assert.equal(r.status, 1, "must not exit 0 — that would waive stage 5 on a typo");
    assert.doesNotMatch(r.out, /TEETH:/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("B-15 classify refuses to guess when its inputs are absent", () => {
  assert.equal(run("classify", { env: { BASELINE_LOG: "", BASELINE_STATUS: "1" } }).status, 1);
  assert.equal(run("classify", { env: { BASELINE_LOG: "/nope/nope.log", BASELINE_STATUS: "1" } }).status, 1);
});

test("B-2b a declared path containing a SPACE is refused, not silently fragmented", () => {
  // Space-separated input split "docs/my file.md" into "docs/my" and "file.md". Both pass a
  // shape check (one has a slash, the other a dot), neither resolves to a git object, so both
  // counted as new-at-HEAD — and the script reported "baseline verified against HEAD
  // (0 file(s); 2 new at HEAD)" while granting greenfield having verified nothing.
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const env = { PATHS_UNDER_CHANGE: "docs/my file.md", GREENFIELD: "yes", SCRATCH: scratch, ALLOW_DIRTY: "1" };
    const c = run("check-paths", { cwd: dir, env });
    assert.equal(c.status, 1, "a space inside one line is ambiguous and must be refused");
    assert.match(c.out, /AMBIGUOUS: 'docs\/my file\.md' contains a space/);

    // And preserve must refuse on its own, without relying on the caller having validated.
    const pv = run("preserve", { cwd: dir, env });
    assert.equal(pv.status, 1, "preserve must not trust that check-paths was run first");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-5c the /** pathspec the QUEUE actually writes resolves to real files", () => {
  // WI-01 declares `services/case-box-persistence/tests/**`. Neither `git cat-file -t HEAD:<p>`
  // nor `git ls-tree -- <p>` resolves that syntax, so it was reported as new-at-HEAD and the
  // stage exited 0 having verified nothing — on the very next item in the queue.
  const dir = makeRepo(REPO_FILES);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const r = run("preserve", {
      cwd: dir,
      env: { PATHS_UNDER_CHANGE: "src/**", GREENFIELD: "no", SCRATCH: scratch, ALLOW_DIRTY: "1" },
    });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /\(2 file\(s\); 0 new at HEAD\)/,
      "src/** must verify the two real files, not report them as new");
    assert.doesNotMatch(r.out, /NO BASELINE/, "a tracked subtree is not new at HEAD");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-2c comma-punctuated prose is refused even though each token looks like a path", () => {
  // "src/a.ts, other/c.ts" splits into "src/a.ts," and "other/c.ts" — the first has both a
  // slash and a dot, so a shape check waves it through, and it resolves to nothing.
  const dir = makeRepo(REPO_FILES);
  try {
    const r = run("check-paths", { cwd: dir, env: { PATHS_UNDER_CHANGE: "src/a.ts,\nother/c.ts" } });
    assert.equal(r.status, 1);
    assert.match(r.out, /contains a comma/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("B-13b a non-numeric baseline status is refused, not read as TEETH", () => {
  // `[ "$BASELINE_STATUS" -eq 0 ]` errors on a non-number, the test evaluates false, and
  // control fell through to the AssertionError branch — returning TEETH with exit 0.
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  const log = path.join(scratch, "run.log");
  try {
    writeFileSync(log, "AssertionError [ERR_ASSERTION]: x\n");
    for (const bad of ["oops", "", "1x", "-1"]) {
      const r = run("classify", { env: { BASELINE_LOG: log, BASELINE_STATUS: bad } });
      assert.equal(r.status, 1, `BASELINE_STATUS=${JSON.stringify(bad)} must be refused`);
      assert.doesNotMatch(r.out, /TEETH:/, "garbage input must never produce a positive verdict");
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

// ----------------------------------------------------------------------- package-baseline

/** A temp repo holding a package with a trivial, fast build. */
function makePackageRepo(buildCmd, srcBody) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wi-pkg-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  mkdirSync(path.join(dir, "pkg", "src"), { recursive: true });
  writeFileSync(path.join(dir, "pkg", "package.json"),
    JSON.stringify({ name: "pkg", version: "1.0.0", scripts: { build: buildCmd } }, null, 2));
  writeFileSync(path.join(dir, "pkg", "src", "a.js"), srcBody);
  git("add", "-A");
  git("commit", "-qm", "baseline");
  return dir;
}

test("B-17 package-baseline produces a BUILT copy at the baseline ref", () => {
  // WI-01 asked for an env seam. 17 of the 41 persistence test files use static ESM imports
  // of ../dist, resolved at parse time, so no variable can redirect them — the same finding
  // D-7 recorded for the desktop. Building the baseline is the mechanism that works.
  const dir = makePackageRepo("mkdir -p dist && cp src/a.js dist/a.js", "export const V = 'BASELINE';\n");
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    // Change the working tree AFTER the commit: the baseline must reflect the ref, not this.
    writeFileSync(path.join(dir, "pkg", "src", "a.js"), "export const V = 'CURRENT';\n");
    const r = run("package-baseline", { cwd: dir, env: { PACKAGE_DIR: "pkg", SCRATCH: scratch } });
    assert.equal(r.status, 0, r.out);
    const built = path.join(scratch, "package-baseline", "pkg", "dist", "a.js");
    assert.ok(existsSync(built), "the baseline must actually be built, not just copied");
    assert.match(readFileSync(built, "utf8"), /BASELINE/,
      "the baseline must hold the COMMITTED source, not the dirty working tree");
    assert.doesNotMatch(readFileSync(built, "utf8"), /CURRENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-18 a baseline whose build FAILS is refused, not handed over half-built", () => {
  // A half-built baseline is worse than none: stage 5 would run against it and read the
  // resulting import errors as evidence.
  const dir = makePackageRepo("exit 3", "export const V = 1;\n");
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const r = run("package-baseline", { cwd: dir, env: { PACKAGE_DIR: "pkg", SCRATCH: scratch } });
    assert.equal(r.status, 1);
    assert.match(r.out, /BASELINE BUILD FAILED/);
    assert.match(r.out, /Do not read one/, "and it must say the stage-5 result is unusable");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-18b a build that FAILS but still emits a dist is refused", () => {
  // The dangerous shape, and the one that actually happens: `tsc` emits its output even when
  // type-checking fails. A non-zero build that leaves a dist/ behind would otherwise sail
  // past the dist check and hand over a baseline compiled from code that does not compile.
  // Found by mutation: making the build-failure branch non-fatal survived, because the only
  // fixture exercising it produced no dist and was caught by the later check instead.
  const dir = makePackageRepo("mkdir -p dist && cp src/a.js dist/a.js && exit 3", "export const V = 1;\n");
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const r = run("package-baseline", { cwd: dir, env: { PACKAGE_DIR: "pkg", SCRATCH: scratch } });
    assert.equal(r.status, 1, "a non-zero build must be refused even when dist/ exists");
    assert.match(r.out, /BASELINE BUILD FAILED/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-19 a build that produces no dist is refused", () => {
  const dir = makePackageRepo("true", "export const V = 1;\n");   // succeeds, builds nothing
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    const r = run("package-baseline", { cwd: dir, env: { PACKAGE_DIR: "pkg", SCRATCH: scratch } });
    assert.equal(r.status, 1, "exit 0 with no dist/ is not a usable baseline");
    assert.match(r.out, /produced no dist/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-20 package-baseline honours the SCRATCH guard and an unknown package", () => {
  const dir = makePackageRepo("mkdir -p dist && cp src/a.js dist/a.js", "export const V = 1;\n");
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wi-scratch-"));
  try {
    assert.equal(run("package-baseline", { cwd: dir, env: { PACKAGE_DIR: "pkg", SCRATCH: "" } }).status, 1);
    const r = run("package-baseline", { cwd: dir, env: { PACKAGE_DIR: "no-such-pkg", SCRATCH: scratch } });
    assert.equal(r.status, 1);
    assert.match(r.out, /not a directory/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test("B-16 an unknown subcommand fails loudly rather than doing nothing", () => {
  const r = run("definitely-not-a-command");
  assert.equal(r.status, 2);
  assert.match(r.out, /unknown command/);
});

// GAP 3 — recorded as a todo so it is visible in the lane it belongs to.
//
// Most of the stage-2/stage-5 shell moved out of the workflow document into this script and
// is covered above. The DESKTOP worktree baseline did not: it clones 613 MB of node_modules,
// restores committed tarballs and runs a full build, which is heavy to fixture. It remains a
// markdown code block, and historically that block has been the most defect-prone text in the
// repo — four audits found defects in it.
//
// `package-baseline` is NOT a substitute: it clones node_modules from the LIVE tree, which for
// the desktop means HEAD source against current tarballs — the mixed tree the desktop
// procedure exists to avoid.
test("GAP-3 the desktop worktree baseline procedure is covered by a test", { todo: "heavy fixture: 613 MB clone + tarball restore + full build; still prose in development-workflow.md" }, () => {});
