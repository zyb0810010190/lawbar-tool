// cli.test.mjs — contract tests for the Evidence-Genie M0 harness shim.
// Run: node --test tests/  (or: npm --prefix native/evidence-core test)
//
// Captures stdout AND exit code SEPARATELY (no shell pipe that could mask a non-zero exit), then parses the
// JSON. Also asserts the shim writes nothing under dev-memo/run/evidence/ (pre/post content comparison).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "cli.mjs");
const REPO_ROOT = path.join(HERE, "..", "..", ".."); // native/evidence-core/tests -> repo root
const EVIDENCE_DIR = path.join(REPO_ROOT, "dev-memo", "run", "evidence");

import {
  GATE_COMMANDS,
  UTILITY_COMMANDS,
  ALL_COMMANDS,
  SCHEMA_VERSION,
} from "../lib/commands.mjs";

// Run the CLI, returning { code, stdout } with code captured separately from stdout (no pipe masking).
function run(args) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout };
  } catch (e) {
    // On a non-zero exit, execFileSync throws; e.status is the exit code, e.stdout has captured stdout.
    return { code: e.status ?? 1, stdout: (e.stdout ?? "").toString() };
  }
}

function snapshotEvidenceDir() {
  if (!existsSync(EVIDENCE_DIR)) return { exists: false, entries: [] };
  return { exists: true, entries: readdirSync(EVIDENCE_DIR).sort() };
}

test("version: passed, exit 0, stable schemaVersion, not the real core", () => {
  const { code, stdout } = run(["version"]);
  assert.equal(code, 0);
  const j = JSON.parse(stdout);
  assert.equal(j.schemaVersion, SCHEMA_VERSION);
  assert.equal(j.ok, true);
  assert.equal(j.command, "version");
  assert.equal(j.status, "passed");
  assert.equal(j.result.isRealNativeCore, false);
  assert.deepEqual(j.result.gateCommands, GATE_COMMANDS);
  assert.deepEqual(j.result.utilityCommands, UTILITY_COMMANDS);
});

test("healthcheck: passed, exit 0", () => {
  const { code, stdout } = run(["healthcheck"]);
  assert.equal(code, 0);
  const j = JSON.parse(stdout);
  assert.equal(j.status, "passed");
  assert.equal(j.ok, true);
});

test("all 8 gate commands: not_implemented, non-zero exit, ok=false, error.code", () => {
  for (const cmd of GATE_COMMANDS) {
    const { code, stdout } = run([cmd]);
    assert.notEqual(code, 0, `${cmd} must exit non-zero`);
    const j = JSON.parse(stdout);
    assert.equal(j.status, "not_implemented", `${cmd} status`);
    assert.equal(j.ok, false, `${cmd} ok`);
    assert.equal(j.command, cmd);
    assert.equal(j.error.code, "not_implemented");
    assert.equal(j.result, undefined, `${cmd} must not carry a result`);
  }
});

test("renderer-conformance specifically remains not_implemented (A0.7 not built)", () => {
  const { code, stdout } = run(["renderer-conformance"]);
  assert.notEqual(code, 0);
  assert.equal(JSON.parse(stdout).status, "not_implemented");
});

test("unknown command: deterministic error JSON, non-zero exit", () => {
  const { code, stdout } = run(["bogus-command"]);
  assert.notEqual(code, 0);
  const j = JSON.parse(stdout);
  assert.equal(j.status, "error");
  assert.equal(j.ok, false);
  assert.equal(j.error.code, "unknown_command");
  assert.deepEqual(j.error.knownCommands, ALL_COMMANDS);
});

test("no command: malformed error, non-zero exit", () => {
  const { code, stdout } = run([]);
  assert.notEqual(code, 0);
  assert.equal(JSON.parse(stdout).status, "error");
});

test("output is deterministic (identical across runs)", () => {
  for (const cmd of ALL_COMMANDS) {
    const a = run([cmd]).stdout;
    const b = run([cmd]).stdout;
    assert.equal(a, b, `${cmd} output must be byte-identical across runs`);
  }
});

test("no command writes anything under dev-memo/run/evidence/ (pre/post comparison)", () => {
  const before = snapshotEvidenceDir();
  for (const cmd of [...ALL_COMMANDS, "bogus-command", ""]) {
    run(cmd === "" ? [] : [cmd]);
  }
  const after = snapshotEvidenceDir();
  // Fail only on a CHANGE caused by the shim — not on a pre-existing directory.
  assert.equal(after.exists, before.exists, "evidence dir existence must be unchanged by the shim");
  assert.deepEqual(after.entries, before.entries, "evidence dir contents must be unchanged by the shim");
});
