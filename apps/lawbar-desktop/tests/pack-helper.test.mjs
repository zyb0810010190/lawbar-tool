// Helper-level tests for scripts/pack-internal-package.mjs per
// dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md §3 + §4 test coverage.
//
// 5 tests:
//   1. missing arg → exit 1 + stderr "usage"
//   2. unknown pkg → exit 1 + stderr "unknown-package"
//   3. case-box-contract happy path → exit 0, tarball at expected path,
//      extracted contains package/dist/index.js
//   4. case-box-persistence happy path → exit 0, tarball at expected path,
//      extracted package.json has dependencies."case-box-contract" = "0.1.0"
//      (NOT "file:..."), extracted contains package/dist/index.js
//   5. npm pack --dry-run --json shape-probe (stop-and-amend; surface
//      shape variance BEFORE stage-pack runs)
//
// Pure Node + npm CLI; NO Electron runtime.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HELPER = path.join(REPO_ROOT, "scripts", "pack-internal-package.mjs");

const CONTRACT_TGZ = path.join(
  REPO_ROOT,
  "docs", "contracts", "case-box-contract",
  "case-box-contract-0.1.0.tgz",
);
const PERSISTENCE_TGZ = path.join(
  REPO_ROOT,
  "services", "case-box-persistence",
  "case-box-persistence-0.1.0.tgz",
);

function runHelper(...args) {
  return spawnSync("node", [HELPER, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
}

function extractTarball(tgzPath) {
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawbar-extract-"));
  execFileSync("tar", ["xzf", tgzPath, "-C", extractDir]);
  return path.join(extractDir, "package");
}

test("helper test 1: missing arg → exit 1 + stderr 'usage'", () => {
  const r = runHelper();
  assert.equal(r.status, 1, `expected exit 1; got ${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stderr, /usage:/);
});

test("helper test 2: unknown pkg → exit 1 + stderr 'unknown-package'", () => {
  const r = runHelper("nonexistent");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown-package/);
});

test("helper test 3: case-box-contract happy path → tarball + dist/index.js present", () => {
  try { fs.unlinkSync(CONTRACT_TGZ); } catch { /* ignore */ }
  const r = runHelper("case-box-contract");
  assert.equal(
    r.status, 0,
    `expected exit 0; got ${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`,
  );
  assert.match(r.stdout, /^PACK_OK case-box-contract -> /);
  assert.ok(fs.existsSync(CONTRACT_TGZ), `tarball missing: ${CONTRACT_TGZ}`);

  const extracted = extractTarball(CONTRACT_TGZ);
  assert.ok(
    fs.existsSync(path.join(extracted, "dist", "index.js")),
    "extracted tarball missing package/dist/index.js",
  );
  fs.rmSync(path.dirname(extracted), { recursive: true, force: true });
});

test("helper test 4: case-box-persistence happy path → manifest rewritten + dist present", () => {
  try { fs.unlinkSync(PERSISTENCE_TGZ); } catch { /* ignore */ }
  // First produce case-box-contract tarball (test 3 may not have run in some orderings)
  if (!fs.existsSync(CONTRACT_TGZ)) {
    const pre = runHelper("case-box-contract");
    assert.equal(pre.status, 0, `pre-pack contract failed: ${pre.stderr}`);
  }
  const r = runHelper("case-box-persistence");
  assert.equal(
    r.status, 0,
    `expected exit 0; got ${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`,
  );
  assert.match(r.stdout, /^PACK_OK case-box-persistence -> /);
  assert.ok(fs.existsSync(PERSISTENCE_TGZ), `tarball missing: ${PERSISTENCE_TGZ}`);

  const extracted = extractTarball(PERSISTENCE_TGZ);
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(extracted, "package.json"), "utf-8"),
  );
  assert.equal(
    pkgJson.dependencies["case-box-contract"],
    "0.1.0",
    `manifest rewrite failed: case-box-contract spec is "${pkgJson.dependencies["case-box-contract"]}"`,
  );
  assert.doesNotMatch(
    pkgJson.dependencies["case-box-contract"],
    /^file:/,
    "manifest still carries file: spec",
  );
  assert.ok(
    fs.existsSync(path.join(extracted, "dist", "index.js")),
    "extracted tarball missing package/dist/index.js",
  );

  // Per audit M1: staged manifest must add `files: ["dist", "README.md"]`
  // even though the SOURCE has no such allowlist.
  assert.deepEqual(
    pkgJson.files,
    ["dist", "README.md"],
    `staged manifest 'files' allowlist mismatch: ${JSON.stringify(pkgJson.files)}`,
  );

  // Per audit M1: tarball MUST NOT ship source/test internals.
  const forbiddenPaths = [
    "src",
    "tests",
    "scripts",
    "tsconfig.json",
  ];
  for (const forbidden of forbiddenPaths) {
    assert.ok(
      !fs.existsSync(path.join(extracted, forbidden)),
      `forbidden path present in extracted tarball: package/${forbidden}`,
    );
  }
  // No nested *.tgz inside the tarball.
  function findTgzRecursive(dir) {
    const found = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) found.push(...findTgzRecursive(full));
      else if (e.name.endsWith(".tgz")) found.push(full);
    }
    return found;
  }
  assert.deepEqual(
    findTgzRecursive(extracted),
    [],
    "nested .tgz files in extracted tarball",
  );

  // SOURCE manifest must be UNCHANGED (staging-pack path)
  const sourcePkgJson = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, "services", "case-box-persistence", "package.json"),
    "utf-8",
  ));
  assert.match(
    sourcePkgJson.dependencies["case-box-contract"],
    /^file:/,
    "SOURCE manifest unexpectedly mutated; staging-pack path violated",
  );
  assert.equal(
    sourcePkgJson.files,
    undefined,
    "SOURCE manifest unexpectedly gained 'files' allowlist; staging-pack path violated",
  );

  fs.rmSync(path.dirname(extracted), { recursive: true, force: true });
});

test("helper test 5: npm pack --dry-run --json shape-probe (stop-and-amend semantics)", () => {
  // Probe the locally-installed npm's --dry-run --json output shape on a known-good
  // package (case-box-contract). If the shape does not match our expectation, the
  // helper's shape detection (§4 step 7a) would exit with pack-dry-run-shape-unknown.
  // This test verifies that the helper's shape detection works locally — i.e., the
  // helper would NOT exit with shape-unknown on this npm version.
  const dryRunOut = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: path.join(REPO_ROOT, "docs", "contracts", "case-box-contract"),
    encoding: "utf-8",
  });
  const parsed = JSON.parse(dryRunOut);
  const entries = Array.isArray(parsed) ? parsed : parsed.packages;
  assert.ok(Array.isArray(entries), "shape-unknown: top-level not array or {packages:[...]}");
  assert.ok(entries.length > 0, "shape-unknown: empty entries");
  const first = entries[0];
  assert.ok(Array.isArray(first.files), "shape-unknown: first entry missing 'files' array");
  for (const f of first.files) {
    assert.equal(typeof f.path, "string", "shape-unknown: 'path' not string");
  }
  // Sanity: dist/index.js should appear (case-box-contract has files allowlist).
  const paths = first.files.map((f) => f.path);
  assert.ok(
    paths.includes("dist/index.js"),
    `expected 'dist/index.js' in pack file list; got: ${paths.slice(0, 10).join(", ")}...`,
  );
});
