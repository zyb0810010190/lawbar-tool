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
