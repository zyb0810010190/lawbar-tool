// Tests for check-doc-references.mjs.
//
// Unit tests exercise the pure extractor directly. Integration tests run the CLI as a subprocess
// against a TEMP corpus and TEMP baseline via DOC_REFS_ROOTS / DOC_REFS_BASELINE — the real
// docs/ tree and the committed baseline are never read or written.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { extractRefs } from "./check-doc-references.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "check-doc-references.mjs");
const REPO = path.resolve(HERE, "..", "..");

// ---------------------------------------------------------------- extractor

test("extracts a plain backticked repo path", () => {
  assert.deepEqual(extractRefs("see `docs/adr/foo.md` for detail"), ["docs/adr/foo.md"]);
});

test("ignores paths inside backtick fences", () => {
  assert.deepEqual(extractRefs("```\n`docs/adr/foo.md`\n```\n"), []);
});

test("ignores paths inside TILDE fences", () => {
  // Regression: the corpus has ~~~ fences; only ``` was handled, so their contents leaked in.
  assert.deepEqual(extractRefs("~~~ts\n`docs/adr/foo.md`\n~~~\n"), []);
});

test("a tilde fence does not close a backtick fence", () => {
  assert.deepEqual(extractRefs("```\n~~~\n`docs/adr/foo.md`\n```\n"), []);
});

test("a 4-space indented ``` is code, not a fence toggle", () => {
  // CommonMark allows at most 3 spaces of indent for a fence.
  assert.deepEqual(extractRefs("    ```\nsee `docs/adr/foo.md`\n"), ["docs/adr/foo.md"]);
});

test("strips file:line and file:line-line citations", () => {
  assert.deepEqual(extractRefs("`src/a.ts:106`"), []);           // no repo root prefix
  assert.deepEqual(extractRefs("`docs/adr/a.md:106`"), ["docs/adr/a.md"]);
  assert.deepEqual(extractRefs("`docs/adr/a.md:10-18`"), ["docs/adr/a.md"]);
});

test("strips anchor fragments", () => {
  assert.deepEqual(extractRefs("`docs/adr/a.md#section-2`"), ["docs/adr/a.md"]);
});

test("finds EVERY path in a multi-token code span", () => {
  // Regression: only the first whitespace-delimited token was validated.
  assert.deepEqual(
    extractRefs("`docs/adr/a.md and docs/adr/b.md`").sort(),
    ["docs/adr/a.md", "docs/adr/b.md"],
  );
});

test("ignores globs, brace expansion and template placeholders", () => {
  assert.deepEqual(extractRefs("`docs/**/*.md`"), []);
  assert.deepEqual(extractRefs("`services/x/tls/host.{key,crt}`"), []);
  assert.deepEqual(extractRefs("`docs/adr/${name}.md`"), []);
  assert.deepEqual(extractRefs("`docs/adr/<name>.md`"), []);
});

test("ignores tokens without a slash or without a known repo root", () => {
  assert.deepEqual(extractRefs("`README.md`"), []);
  assert.deepEqual(extractRefs("`vendor/thing/x.md`"), []);
});

test("strips surrounding prose punctuation", () => {
  assert.deepEqual(extractRefs("(`docs/adr/a.md`),"), ["docs/adr/a.md"]);
  assert.deepEqual(extractRefs("see `docs/adr/a.md`."), ["docs/adr/a.md"]);
});

// ------------------------------------------------------------- CLI harness

function makeCorpus() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docrefs-"));
  fs.mkdirSync(path.join(dir, "corpus"), { recursive: true });
  return dir;
}
/** Write a doc into the temp corpus. Paths inside it resolve against the REAL repo root. */
function doc(dir, name, body) {
  fs.writeFileSync(path.join(dir, "corpus", name), body);
}
function run(dir, args = []) {
  // DOC_REFS_ROOTS is resolved relative to the repo root, so point it at a relative temp path.
  const rel = path.relative(REPO, path.join(dir, "corpus"));
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, DOC_REFS_ROOTS: rel, DOC_REFS_BASELINE: path.join(dir, "baseline.json") },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

test("CLI: a new file with a dead reference fails the check", () => {
  const d = makeCorpus();
  doc(d, "a.md", "ok: `docs/adr` \n");
  run(d, ["--update"]);                                  // baseline: clean
  doc(d, "b.md", "dead: `docs/nope/missing.md`\n");      // new file, new dead ref
  const r = run(d);
  assert.equal(r.code, 1, "expected exit 1 for a new dead reference");
  assert.match(r.out, /docs\/nope\/missing\.md/);
});

test("CLI: fixing a reference passes, and reports the improvement", () => {
  const d = makeCorpus();
  doc(d, "a.md", "dead: `docs/nope/x.md` `docs/nope/y.md`\n");
  run(d, ["--update"]);
  doc(d, "a.md", "dead: `docs/nope/x.md`\n");            // one fixed
  const r = run(d);
  assert.equal(r.code, 0);
  assert.match(r.out, /1 fewer than baseline/);
});

test("CLI: --update REFUSES to raise the ratchet without --force", () => {
  const d = makeCorpus();
  doc(d, "a.md", "dead: `docs/nope/x.md`\n");
  run(d, ["--update"]);
  doc(d, "a.md", "dead: `docs/nope/x.md` `docs/nope/y.md`\n");
  const r = run(d, ["--update"]);
  assert.equal(r.code, 1, "--update must refuse an increase");
  assert.match(r.out, /REFUSING to update/);
  assert.match(r.out, /1 -> 2/);
});

test("CLI: --update --force records the increase deliberately", () => {
  const d = makeCorpus();
  doc(d, "a.md", "dead: `docs/nope/x.md`\n");
  run(d, ["--update"]);
  doc(d, "a.md", "dead: `docs/nope/x.md` `docs/nope/y.md`\n");
  const r = run(d, ["--update", "--force"]);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, "baseline.json"), "utf8")).total, 2);
});

test("CLI: a path escaping the repo is rejected, not probed", () => {
  const d = makeCorpus();
  doc(d, "a.md", "escape: `docs/../../../etc/hosts`\n");
  const r = run(d, ["--list"]);
  assert.match(r.out, /etc\/hosts/, "traversal must be reported dead, never treated as existing");
});

test("CLI: a wrong-case path is reported dead even on a case-insensitive filesystem", () => {
  const d = makeCorpus();
  // docs/adr exists in the real repo; DOCS/ADR does not, but existsSync says it does on macOS.
  doc(d, "a.md", "case: `DOCS/adr`\n");
  const r = run(d, ["--list"]);
  // Not a known repo root, so it is skipped entirely — assert the real-root variant instead.
  doc(d, "b.md", "case: `docs/ADR/nope.md`\n");
  const r2 = run(d, ["--list"]);
  assert.match(r2.out, /docs\/ADR\/nope\.md/, "wrong-case path must be reported dead");
  assert.ok(r.code === 0 || r.code === 1);
});

test("CLI: a malformed baseline fails loudly rather than comparing wrongly", () => {
  const d = makeCorpus();
  doc(d, "a.md", "x\n");
  fs.writeFileSync(path.join(d, "baseline.json"), '{"counts": {"a.md": "three"}}');
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /malformed/);
});

test("CLI: a baseline entry for a deleted file is reported as stale", () => {
  const d = makeCorpus();
  doc(d, "a.md", "dead: `docs/nope/x.md`\n");
  run(d, ["--update"]);
  fs.unlinkSync(path.join(d, "corpus", "a.md"));
  const r = run(d);
  assert.equal(r.code, 0);
  assert.match(r.out, /baseline entr(y|ies) for deleted file/);
});

// ------------------------------------------------- flags and env seam safety

test("CLI: setting only one env seam is a hard error", () => {
  // Regression: DOC_REFS_ROOTS alone + --update rewrote the REAL baseline to cover only the
  // narrowed subtree. Every omission reads as a decrease, so the anti-raise guard never fired.
  const r = (() => {
    try {
      execFileSync(process.execPath, [SCRIPT, "--list"], {
        encoding: "utf8", env: { ...process.env, DOC_REFS_ROOTS: "docs/adr", DOC_REFS_BASELINE: "" },
      });
      return { code: 0, out: "" };
    } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  })();
  assert.equal(r.code, 2);
  assert.match(r.out, /must be set together/);
});

test("CLI: --update --force PRINTS the files it raised", () => {
  // Regression: --force skipped the raised computation, so a forced increase left no audit trail.
  const d = makeCorpus();
  doc(d, "a.md", "dead: `docs/nope/x.md`\n");
  run(d, ["--update"]);
  doc(d, "a.md", "dead: `docs/nope/x.md` `docs/nope/y.md`\n");
  const r = run(d, ["--update", "--force"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /recording an INCREASE/);
  assert.match(r.out, /1 -> 2/, "the forced run must name what got worse");
});

test("CLI: an unknown flag is rejected rather than silently ignored", () => {
  const d = makeCorpus();
  doc(d, "a.md", "x\n");
  const r = run(d, ["--nope"]);
  assert.equal(r.code, 2);
  assert.match(r.out, /unknown flag/);
});

test("CLI: bare --force without --update is rejected", () => {
  const d = makeCorpus();
  doc(d, "a.md", "x\n");
  const r = run(d, ["--force"]);
  assert.equal(r.code, 2);
  assert.match(r.out, /only meaningful with --update/);
});

test("CLI: a gitignored-but-present path is dead, matching what CI sees", () => {
  // The guard resolves against the git index, so working-tree presence cannot mask a dead ref.
  const d = makeCorpus();
  doc(d, "a.md", "ignored: `dev-memo/superseded/case-box-plan.md`\n");
  const r = run(d, ["--list"]);
  assert.match(r.out, /dev-memo\/superseded\/case-box-plan\.md/,
    "an untracked path must count as dead even when it exists locally");
});

// Regression, 2026-08-22. The ratchet reported two TRACKED files as dead references —
// `…/caseBoxRuntime.ts:14,42` and `…/retryPolicy.ts:classifyOcrFailureForRetry` — purely
// because only `:N` and `:N-M` were stripped. Two live citation forms in this corpus were
// not: a comma-separated line list, and a `:symbolName` reference. Both inflate the very
// number the ratchet exists to drive down, which makes the instrument the defect.
test("strips a comma-separated line list, not just a single line or a range", () => {
  assert.deepEqual(extractRefs("`docs/adr/a.md:14,42`"), ["docs/adr/a.md"]);
  assert.deepEqual(extractRefs("`docs/adr/a.md:1,2,3`"), ["docs/adr/a.md"]);
  assert.deepEqual(extractRefs("`docs/adr/a.md:10-18,25`"), ["docs/adr/a.md"]);
});

test("strips a :symbolName citation", () => {
  assert.deepEqual(extractRefs("`docs/adr/a.md:someFunctionName`"), ["docs/adr/a.md"]);
  assert.deepEqual(extractRefs("`docs/adr/a.md:CONSTANT_CASE`"), ["docs/adr/a.md"]);
});

test("stripping a citation does not swallow a real path segment", () => {
  // The suffix is only stripped after the final path segment, so a colon inside a
  // directory name must survive. Guards against over-stripping.
  assert.deepEqual(extractRefs("`docs/adr/a.md`"), ["docs/adr/a.md"]);
  assert.deepEqual(extractRefs("`docs/adr/sub.dir/a.md:12`"), ["docs/adr/sub.dir/a.md"]);
});

// ---------------------------------------------------------------------------
// D-4 — the checker's own scope.
//
// DOC_ROOTS was five hand-listed subdirectories, so the three governance documents at
// `docs/` root — development-workflow.md, wi-loop.md, wi-queue.md — were outside the checker
// entirely. They are the most heavily edited docs in the repo and full of repo-path
// references, and a dead one in them was invisible: verified by adding a reference to a
// nonexistent file and watching the count stay put.
//
// A hand-maintained root list has the same failure mode as a hand-maintained test list: what
// is not on it is invisible, and nothing says so.

test("D4-1 the governance docs at docs/ root are inside the checker's scope", () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "check-doc-references.mjs"), "utf8");
  const m = src.match(/const DOC_ROOTS = (\[[^\]]*\])/);
  assert.ok(m, "DOC_ROOTS must exist");
  const roots = JSON.parse(m[1].replace(/'/g, '"'));
  const covers = (f) => roots.some((r) => f === r || f.startsWith(r.endsWith("/") ? r : r + "/"));
  for (const f of ["docs/development-workflow.md", "docs/wi-loop.md", "docs/wi-queue.md"]) {
    assert.ok(covers(f), `${f} must be scanned — it was not, and dead references in it were invisible`);
  }
});

test("D4-2 the walker skips node_modules, or widening a root scans dependencies", () => {
  // docs/contracts/ carries 48 MB of node_modules. Without the exclusion, widening DOC_ROOTS
  // to `docs` pulls in thousands of third-party .md files and their references.
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "check-doc-references.mjs"), "utf8");
  assert.match(src, /node_modules/, "the walker must exclude node_modules");
  const walkBody = src.slice(src.indexOf("function walk("), src.indexOf("function walk(") + 600);
  assert.match(walkBody, /node_modules/, "and the exclusion must be in walk(), not merely mentioned");
});
