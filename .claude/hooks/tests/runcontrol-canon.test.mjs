// runcontrol-canon.test.mjs — unit tests for the PRC-2 canonicalize+classify helper.
// Run: node --test .claude/hooks/tests/runcontrol-canon.test.mjs   (exit 0 = all pass)
//
// Exit codes: 0 not-protected · 10 blanket-protected · 11 log.md · 2 fail-closed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HELPER = join(fileURLToPath(import.meta.url), "../../runcontrol-canon.mjs");

// Explicit protected basename table (NOT imported from the helper — avoids a tautological test
// per the review). Must mirror protect-run-control.sh.
const PROTECTED = [
  "queue.governed", "queue.linted", "queue.reviewed", "human.ack", "human.override",
  "override-reason.md", "batch-start", "last-batch-audit", "risk.flag", "config",
  "forbidden-paths.txt", ".closeout-pending",
];

function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "prc2-")));
  mkdirSync(join(root, "dev-memo/run"), { recursive: true });
  return root;
}

// classify(root, file_path) -> exit code
function classify(root, fp, toolInput = {}) {
  const r = spawnSync("node", [HELPER], {
    input: JSON.stringify({ tool_input: { file_path: fp, ...toolInput } }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return r.status;
}

// --- lexical normalization forms => blanket (10) ---

test("lexical ./ // .. and absolute spellings of config => blanket 10", () => {
  const root = repo();
  for (const fp of [
    "dev-memo/run/config",
    "dev-memo/run/./config",
    "dev-memo/run//config",
    "dev-memo/run/x/../config",
    "./dev-memo/run/config",
    join(root, "dev-memo/run/config"),
    join(root, "dev-memo/run/./config"),
  ]) {
    assert.equal(classify(root, fp), 10, fp);
  }
});

// --- every protected basename => 10 (enumerated) ---

test("every protected basename classifies as blanket 10", () => {
  const root = repo();
  for (const base of PROTECTED) {
    assert.equal(classify(root, `dev-memo/run/${base}`), 10, base);
  }
});

// --- log.md => 11 ---

test("log.md and its lexical spellings => 11", () => {
  const root = repo();
  for (const fp of ["dev-memo/run/log.md", "dev-memo/run/./log.md", "dev-memo/run/x/../log.md"]) {
    assert.equal(classify(root, fp), 11, fp);
  }
});

// --- PRC-5 + non-protected => 0 ---

test("xdev-memo/run/config (PRC-5) => 0 (different file, not protected)", () => {
  const root = repo();
  assert.equal(classify(root, "xdev-memo/run/config"), 0);
});

test("paths outside dev-memo/run => 0", () => {
  const root = repo();
  for (const fp of [
    "apps/lawbar-desktop/renderer/x.ts",
    "dev-memo/cc-suite-reliability-log.md",
    "dev-memo/run/queue.md", // authored, not protected
    join(tmpdir(), "elsewhere.txt"),
  ]) {
    assert.equal(classify(root, fp), 0, fp);
  }
});

// --- symlinks (the High/Critical closure) ---

test("symlink inside dev-memo/run -> config resolves to blanket 10", () => {
  const root = repo();
  writeFileSync(join(root, "dev-memo/run/config"), "x");
  symlinkSync(join(root, "dev-memo/run/config"), join(root, "dev-memo/run/link"));
  assert.equal(classify(root, "dev-memo/run/link"), 10);
});

test("symlink NAMED OUTSIDE dev-memo/run -> config resolves to blanket 10 (outside-symlink closure)", () => {
  const root = repo();
  writeFileSync(join(root, "dev-memo/run/config"), "x");
  mkdirSync(join(root, "outside"));
  symlinkSync(join(root, "dev-memo/run/config"), join(root, "outside/clink"));
  assert.equal(classify(root, "outside/clink"), 10);
  assert.equal(classify(root, join(root, "outside/clink")), 10);
});

test("symlink -> log.md resolves to 11", () => {
  const root = repo();
  writeFileSync(join(root, "dev-memo/run/log.md"), "# trail\n");
  symlinkSync(join(root, "dev-memo/run/log.md"), join(root, "dev-memo/run/loglink"));
  assert.equal(classify(root, "dev-memo/run/loglink"), 11);
});

test("DANGLING symlink (absent target) outside dev-memo/run -> absent human.ack => 10 (audit High)", () => {
  const root = repo();
  mkdirSync(join(root, "outside"));
  // human.ack does NOT exist; a Write through the dangling symlink would CREATE it
  symlinkSync(join(root, "dev-memo/run/human.ack"), join(root, "outside/acklink"));
  assert.equal(classify(root, "outside/acklink"), 10);
});

test("DANGLING symlink to absent risk.flag => 10", () => {
  const root = repo();
  symlinkSync(join(root, "dev-memo/run/risk.flag"), join(root, "dev-memo/run/rlink"));
  assert.equal(classify(root, "dev-memo/run/rlink"), 10);
});

test("symlink loop resolves best-effort to not-protected (0) without hanging (depth guard)", () => {
  const root = repo();
  mkdirSync(join(root, "outside"));
  symlinkSync(join(root, "outside/b"), join(root, "outside/a"));
  symlinkSync(join(root, "outside/a"), join(root, "outside/b")); // a <-> b loop, both dangling
  assert.equal(classify(root, "outside/a"), 0);
});

// --- not-yet-created target under dev-memo/run (parent realpath + basename) ---

test("not-yet-created config target still classifies 10 (parent realpath)", () => {
  const root = repo();
  // no config file on disk; dev-memo/run exists
  assert.equal(classify(root, "dev-memo/run/config"), 10);
});

// --- fail-closed (2) ---

test("missing file_path => 2", () => {
  const root = repo();
  const r = spawnSync("node", [HELPER], {
    input: JSON.stringify({ tool_input: { content: "x" } }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.equal(r.status, 2);
});

test("unparseable payload => 2", () => {
  const root = repo();
  const r = spawnSync("node", [HELPER], {
    input: "not json",
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.equal(r.status, 2);
});
