// logmd-append-guard.test.mjs — unit tests for the PRC-1 append-only verifier.
// Run: node --test .claude/hooks/tests/logmd-append-guard.test.mjs   (exit 0 = all pass)
//
// Exit codes: 0 allow · 1 deny(violation) · 2 deny(fail-closed) · 3 not-our-file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(fileURLToPath(import.meta.url), "../../logmd-append-guard.mjs");

// Build a temp repo root with an optional pre-existing log.md. Returns {root, logPath}.
function repo({ logContent } = {}) {
  const root = mkdtempSync(join(tmpdir(), "prc1-"));
  mkdirSync(join(root, "dev-memo/run"), { recursive: true });
  const logPath = join(root, "dev-memo/run/log.md");
  if (logContent !== undefined) writeFileSync(logPath, logContent);
  return { root, logPath };
}

// Run the verifier with a PreToolUse payload; returns the exit code.
function run(root, toolInput) {
  const r = spawnSync("node", [GUARD], {
    input: JSON.stringify({ tool_input: toolInput }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return r.status;
}

const ABS = (root) => join(root, "dev-memo/run/log.md");

// --- Write: create-only -----------------------------------------------------

test("write to ABSENT log.md (create) => allow (0)", () => {
  const { root } = repo(); // no log.md
  assert.equal(run(root, { file_path: ABS(root), content: "# trail\n- entry 1\n" }), 0);
});

test("write to EXISTING log.md => deny (1), even if content extends current", () => {
  const { root } = repo({ logContent: "# trail\n- e1\n" });
  // even an "appending" Write is denied — Write is a full replace / TOCTOU-prone
  assert.equal(run(root, { file_path: ABS(root), content: "# trail\n- e1\n- e2\n" }), 1);
});

test("write non-string content => deny (2, malformed)", () => {
  const { root } = repo();
  assert.equal(run(root, { file_path: ABS(root), content: 123 }), 2);
});

// --- Edit: append-only ------------------------------------------------------

test("edit appending at EOF (old=tail, new=tail+entry) => allow (0)", () => {
  const cur = "# trail\n- e1\n";
  const { root } = repo({ logContent: cur });
  assert.equal(run(root, { file_path: ABS(root), old_string: "- e1\n", new_string: "- e1\n- e2\n" }), 0);
});

test("edit that truncates (replace big chunk with small) => deny (1)", () => {
  const cur = "# trail\n- e1\n- e2\n- e3\n";
  const { root } = repo({ logContent: cur });
  assert.equal(run(root, { file_path: ABS(root), old_string: "- e1\n- e2\n- e3\n", new_string: "- e1\n" }), 1);
});

test("edit mid-insert (changes a non-EOF region) => deny (1)", () => {
  const cur = "# trail\n- e1\n- e2\n";
  const { root } = repo({ logContent: cur });
  // insert before e2: result no longer has `cur` as a prefix
  assert.equal(run(root, { file_path: ABS(root), old_string: "- e2\n", new_string: "- e1.5\n- e2\n" }), 1);
});

test("edit with valid old_string NOT found => no-op => allow (0)", () => {
  const { root } = repo({ logContent: "# trail\n- e1\n" });
  assert.equal(run(root, { file_path: ABS(root), old_string: "ZZZ-absent", new_string: "x" }), 0);
});

test("edit with empty old_string => deny (2, malformed)", () => {
  const { root } = repo({ logContent: "# trail\n" });
  assert.equal(run(root, { file_path: ABS(root), old_string: "", new_string: "x" }), 2);
});

test("edit with non-string new_string => deny (2, malformed)", () => {
  const { root } = repo({ logContent: "# trail\n" });
  assert.equal(run(root, { file_path: ABS(root), old_string: "# trail\n", new_string: 5 }), 2);
});

test("edit replace_all that only appends (suffix occurrence) => allow (0)", () => {
  // current ends with "END"; replace_all "END"->"END\n- e\n" ... but "END" also appears once.
  const cur = "# trail\n- e1 END\n";
  const { root } = repo({ logContent: cur });
  // old occurs once, at EOF region; new = old + appended => prefix preserved
  assert.equal(run(root, { file_path: ABS(root), old_string: "- e1 END\n", new_string: "- e1 END\n- e2\n", replace_all: true }), 0);
});

test("edit replace_all that rewrites an earlier occurrence => deny (1)", () => {
  const cur = "X\n- e1\nX\n";
  const { root } = repo({ logContent: cur });
  // replacing all "X" rewrites the FIRST X (non-EOF) => prefix broken
  assert.equal(run(root, { file_path: ABS(root), old_string: "X", new_string: "Y", replace_all: true }), 1);
});

test("edit non-boolean replace_all => deny (2)", () => {
  const { root } = repo({ logContent: "a\n" });
  assert.equal(run(root, { file_path: ABS(root), old_string: "a\n", new_string: "a\nb\n", replace_all: "yes" }), 2);
});

// --- MultiEdit --------------------------------------------------------------

test("multiedit all-appending => allow (0)", () => {
  const cur = "# trail\n- e1\n";
  const { root } = repo({ logContent: cur });
  assert.equal(
    run(root, {
      file_path: ABS(root),
      edits: [
        { old_string: "- e1\n", new_string: "- e1\n- e2\n" },
        { old_string: "- e2\n", new_string: "- e2\n- e3\n" },
      ],
    }),
    0
  );
});

test("multiedit where one edit truncates => deny (1)", () => {
  const cur = "# trail\n- e1\n- e2\n";
  const { root } = repo({ logContent: cur });
  assert.equal(
    run(root, {
      file_path: ABS(root),
      edits: [
        { old_string: "- e2\n", new_string: "- e2\n- e3\n" },
        { old_string: "# trail\n- e1\n", new_string: "# trail\n" }, // deletes e1
      ],
    }),
    1
  );
});

test("multiedit empty array => deny (2)", () => {
  const { root } = repo({ logContent: "a\n" });
  assert.equal(run(root, { file_path: ABS(root), edits: [] }), 2);
});

test("unknown shape (no content/edits/old_string) => deny (2)", () => {
  const { root } = repo({ logContent: "a\n" });
  assert.equal(run(root, { file_path: ABS(root) }), 2);
});

// --- bounded lexical canonicalization (PRC-1) -------------------------------

test("lexical spellings of log.md are all identified + enforced (truncate => deny)", () => {
  const cur = "# trail\n- e1\n- e2\n";
  for (const spelling of [
    "dev-memo/run/log.md",
    "./dev-memo/run/log.md",
    "dev-memo/run//log.md",
    "dev-memo/run/../run/log.md",
  ]) {
    const { root } = repo({ logContent: cur });
    const fp = join(root, spelling); // join collapses some, but pass the spelled relative form too
    // Use the RAW spelled path joined to root so path.resolve must canonicalize it.
    const raw = `${root}/${spelling}`;
    const code = run(root, { file_path: raw, old_string: cur, new_string: "# trail\n" });
    assert.equal(code, 1, `spelling ${spelling} should be identified + denied (truncate)`);
  }
});

test("absolute canonical path enforced", () => {
  const cur = "# trail\n- e1\n";
  const { root } = repo({ logContent: cur });
  assert.equal(run(root, { file_path: ABS(root), old_string: cur, new_string: "x" }), 1);
});

// --- non-log.md paths must NOT be pulled into the special case (exit 3) -----

test("dev-memo/run/config => not-our-file (3)", () => {
  const { root } = repo({ logContent: "a\n" });
  assert.equal(run(root, { file_path: join(root, "dev-memo/run/config"), content: "x" }), 3);
});

test("dev-memo/cc-suite-reliability-log.md => not-our-file (3)", () => {
  const { root } = repo({ logContent: "a\n" });
  assert.equal(run(root, { file_path: join(root, "dev-memo/cc-suite-reliability-log.md"), content: "x" }), 3);
});

test("/tmp/log.md (outside repo) => not-our-file (3)", () => {
  const { root } = repo({ logContent: "a\n" });
  const outside = join(tmpdir(), "log.md");
  assert.equal(run(root, { file_path: outside, content: "x" }), 3);
});

test("missing file_path => deny (2)", () => {
  const { root } = repo();
  assert.equal(run(root, { content: "x" }), 2);
});
