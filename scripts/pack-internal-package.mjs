#!/usr/bin/env node
// Staging-pack helper per dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md §4.
//
// Copies an internal package source to a temp dir; rewrites known `file:` deps
// to non-`file:` exact-version pins; verifies no unexpected `file:`/`link:`
// specs remain (fail-closed); runs `npm pack --dry-run --json` with shape
// detection (stop-and-amend on unknown shape); runs `npm pack`; moves the
// produced tarball next to the source.
//
// Usage: node scripts/pack-internal-package.mjs <pkg-name>
// Must be invoked FROM REPO ROOT (helper is repo-root-scoped).

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = process.cwd();

// Hard-coded registry of internal packages. Keep alphabetized by package name.
const PACKAGE_REGISTRY = {
  "case-box-contract": {
    sourceDir: "docs/contracts/case-box-contract",
    expectedVersion: "0.1.0",
    rewrites: [],
    requiredEntries: ["dist/index.js"],
  },
  "case-box-persistence": {
    sourceDir: "services/case-box-persistence",
    expectedVersion: "0.1.0",
    rewrites: [
      { depKey: "case-box-contract", from: /^file:/, to: "0.1.0" },
    ],
    // case-box-persistence has NO `files` allowlist in its source manifest
    // (it ships dist/ via .gitignore-default behavior for in-place test use).
    // For the desktop tarball install we add an explicit allowlist in the
    // staged manifest so the published tarball ships ONLY runtime artifacts.
    // Per cc-suite audit M1 (audit-mpkv1hf9-blgax0).
    manifestSet: {
      files: ["dist", "README.md"],
    },
    requiredEntries: ["dist/index.js"],
    // Per audit M1: assert these paths are ABSENT from the packed tarball.
    forbiddenEntries: [
      "src/",
      "tests/",
      "scripts/",
      "tsconfig.json",
    ],
  },
};

function fail(category, pkgName, detail) {
  process.stderr.write(`[pack:${pkgName}] ${category}: ${detail}\n`);
  process.exit(1);
}

function usage() {
  process.stderr.write(
    "usage: node scripts/pack-internal-package.mjs <pkg-name>\n" +
    `available: ${Object.keys(PACKAGE_REGISTRY).join(", ")}\n`,
  );
  process.exit(1);
}

const pkgName = process.argv[2];
if (!pkgName) usage();

const entry = PACKAGE_REGISTRY[pkgName];
if (!entry) {
  process.stderr.write(`[pack] unknown-package: ${pkgName}\n`);
  usage();
}

const sourceDir = path.resolve(REPO_ROOT, entry.sourceDir);
if (!fs.existsSync(sourceDir)) {
  fail("missing-source-dir", pkgName, `not found: ${sourceDir}`);
}
const sourceDist = path.join(sourceDir, "dist");
if (!fs.existsSync(sourceDist)) {
  fail("missing-dist", pkgName, `${sourceDist} (run \`npm run build\` in the package first)`);
}

const sourcePkgJsonPath = path.join(sourceDir, "package.json");
const sourcePkgJson = JSON.parse(fs.readFileSync(sourcePkgJsonPath, "utf-8"));
if (sourcePkgJson.version !== entry.expectedVersion) {
  fail(
    "version-mismatch",
    pkgName,
    `source version=${sourcePkgJson.version} expected=${entry.expectedVersion}`,
  );
}

let tempDir;
try {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lawbar-pack-${pkgName}-`));
} catch (e) {
  fail("temp-dir-create-failed", pkgName, e instanceof Error ? e.message : String(e));
}

try {
  // Recursive copy of source to temp dir, excluding node_modules + .git
  await fsp.cp(sourceDir, tempDir, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}node_modules`) && !src.includes(`${path.sep}.git`),
  });
} catch (e) {
  fail("copy-failed", pkgName, e instanceof Error ? e.message : String(e));
}

// Apply registry rewrites to temp dir's package.json
const tempPkgJsonPath = path.join(tempDir, "package.json");
let tempPkgJson;
try {
  tempPkgJson = JSON.parse(fs.readFileSync(tempPkgJsonPath, "utf-8"));
} catch (e) {
  fail("manifest-rewrite-failed", pkgName, `cannot read temp package.json: ${e}`);
}

for (const rewrite of entry.rewrites) {
  const deps = tempPkgJson.dependencies ?? {};
  const current = deps[rewrite.depKey];
  if (current === undefined) {
    fail(
      "manifest-rewrite-failed",
      pkgName,
      `registry says rewrite ${rewrite.depKey}, but dependency absent in source`,
    );
  }
  if (!rewrite.from.test(current)) {
    fail(
      "manifest-rewrite-failed",
      pkgName,
      `registry expected ${rewrite.depKey}="${rewrite.from}", got "${current}"`,
    );
  }
  deps[rewrite.depKey] = rewrite.to;
  tempPkgJson.dependencies = deps;
}

// rev-1 per audit M1: apply top-level property additions (e.g. `files`
// allowlist) to the staged manifest. The source manifest is NOT touched.
if (entry.manifestSet) {
  for (const [key, value] of Object.entries(entry.manifestSet)) {
    tempPkgJson[key] = value;
  }
}

try {
  fs.writeFileSync(tempPkgJsonPath, JSON.stringify(tempPkgJson, null, 2) + "\n", "utf-8");
} catch (e) {
  fail("manifest-rewrite-failed", pkgName, `cannot write temp package.json: ${e}`);
}

// Fail-closed scan: re-read post-rewrite manifest; reject any unexpected
// file:/link: spec across dependencies/optionalDependencies/peerDependencies.
const postRewrite = JSON.parse(fs.readFileSync(tempPkgJsonPath, "utf-8"));
for (const depMap of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  const deps = postRewrite[depMap] ?? {};
  for (const [key, value] of Object.entries(deps)) {
    if (typeof value === "string" && /^(?:file:|link:)/.test(value)) {
      fail(
        "manifest-rewrite-failed",
        pkgName,
        `unexpected ${depMap}.${key}="${value}"; helper registry has no rewrite for it`,
      );
    }
  }
}

// npm pack --dry-run --json
let dryRunOut;
try {
  dryRunOut = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: tempDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  fail("dry-run-failed", pkgName, e instanceof Error ? e.message : String(e));
}

// Shape detection (stop-and-amend on unknown shape; no fallback parser)
let dryRunParsed;
try {
  dryRunParsed = JSON.parse(dryRunOut);
} catch (e) {
  fail(
    "pack-dry-run-shape-unknown",
    pkgName,
    `npm pack --dry-run --json did not return valid JSON. Plan must be amended.\nRaw (first 1000 chars):\n${dryRunOut.slice(0, 1000)}`,
  );
}
// Accept both the bare-array shape and the {packages:[...]}-wrapped shape.
let entries;
if (Array.isArray(dryRunParsed)) {
  entries = dryRunParsed;
} else if (dryRunParsed && Array.isArray(dryRunParsed.packages)) {
  entries = dryRunParsed.packages;
} else {
  fail(
    "pack-dry-run-shape-unknown",
    pkgName,
    `unexpected top-level shape (neither array nor {packages:[...]}). Plan must be amended.\nRaw (first 1000 chars):\n${dryRunOut.slice(0, 1000)}`,
  );
}
if (entries.length === 0) {
  fail("pack-dry-run-shape-unknown", pkgName, "no entries returned");
}
const first = entries[0];
if (!first || !Array.isArray(first.files)) {
  fail(
    "pack-dry-run-shape-unknown",
    pkgName,
    `first entry missing 'files' array. Plan must be amended.\nRaw (first 1000 chars):\n${dryRunOut.slice(0, 1000)}`,
  );
}
const filesArr = first.files;
for (const f of filesArr) {
  if (!f || typeof f.path !== "string") {
    fail(
      "pack-dry-run-shape-unknown",
      pkgName,
      `file entry missing string 'path' field. Plan must be amended.`,
    );
  }
}
// Required-entries assertion
const paths = filesArr.map((f) => f.path);
for (const required of entry.requiredEntries) {
  if (!paths.includes(required)) {
    fail("dry-run-missing-entry", pkgName, `required entry not in tarball: ${required}`);
  }
}

// rev-1 per audit M1: forbidden-entries assertion. Any path that begins with a
// forbidden prefix (e.g. "src/", "tests/") OR matches a forbidden filename
// (e.g. "tsconfig.json") OR matches the nested-tarball pattern (`*.tgz`)
// triggers a fail-closed exit. Defence against the `files` allowlist being
// dropped from the staged manifest by an editor mistake.
const forbiddenEntries = entry.forbiddenEntries ?? [];
const forbiddenViolations = [];
for (const filePath of paths) {
  if (/\.tgz$/.test(filePath)) {
    forbiddenViolations.push(`nested tarball: ${filePath}`);
    continue;
  }
  for (const forbidden of forbiddenEntries) {
    // Prefix match for dir-shaped entries ("src/"); exact match for files.
    if (forbidden.endsWith("/")) {
      if (filePath.startsWith(forbidden)) {
        forbiddenViolations.push(`${filePath} (under ${forbidden})`);
        break;
      }
    } else if (filePath === forbidden) {
      forbiddenViolations.push(filePath);
      break;
    }
  }
}
if (forbiddenViolations.length > 0) {
  fail(
    "dry-run-missing-entry",
    pkgName,
    `forbidden entries in tarball:\n  ${forbiddenViolations.join("\n  ")}`,
  );
}

// Real pack
let packOut;
try {
  packOut = execFileSync("npm", ["pack", "--json"], {
    cwd: tempDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  fail("npm-pack-failed", pkgName, e instanceof Error ? e.message : String(e));
}
let packParsed;
try {
  packParsed = JSON.parse(packOut);
} catch (e) {
  fail("npm-pack-failed", pkgName, `pack JSON parse: ${e}`);
}
const packEntries = Array.isArray(packParsed) ? packParsed : packParsed.packages ?? [];
if (packEntries.length === 0) {
  fail("npm-pack-failed", pkgName, "no tarball entry returned");
}
const tarballName = packEntries[0].filename;
if (!tarballName) fail("npm-pack-failed", pkgName, "no filename");

const producedPath = path.join(tempDir, tarballName);
const outputPath = path.join(sourceDir, tarballName);
try {
  await fsp.copyFile(producedPath, outputPath);
  await fsp.unlink(producedPath);
} catch (e) {
  fail("move-failed", pkgName, e instanceof Error ? e.message : String(e));
}

process.stdout.write(`PACK_OK ${pkgName} -> ${path.relative(REPO_ROOT, outputPath)}\n`);

try {
  await fsp.rm(tempDir, { recursive: true, force: true });
} catch (e) {
  // Non-fatal warning protocol per audit L2 (matches plan's `cleanup-failed`
  // category). PACK_OK has already been emitted; the produced tarball is
  // valid and in place. The temp dir leak is a hygiene concern only.
  process.stderr.write(
    `[pack:${pkgName}] cleanup-failed (non-fatal): ${e instanceof Error ? e.message : String(e)}\n` +
    `  temp dir leaked at: ${tempDir}\n` +
    `  manual cleanup: rm -rf ${tempDir}\n`,
  );
}
process.exit(0);
