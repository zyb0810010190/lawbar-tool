#!/usr/bin/env node
// Orchestrator per cc-suite audit M2: a clean checkout cannot run
// `npm install` in apps/lawbar-desktop until the two internal-package
// tarballs (case-box-contract + case-box-persistence) exist at the
// paths referenced by apps/lawbar-desktop/package.json's tarball deps.
//
// This script:
//   1. Runs `npm ci` in each internal package (lockfile-pinned; refuses to
//      run if the source package-lock.json is missing or out of sync —
//      converts dependency drift into an explicit error instead of silently
//      mutating source lockfiles; per audit rev-2 M-orchestrator).
//   2. Runs `npm run build` in each internal package.
//   3. Runs `scripts/pack-internal-package.mjs <pkg>` for each.
//
// Order matters: case-box-contract must be packed first because case-box-
// persistence's stage-pack rewrites the case-box-contract dep spec from
// "file:..." to exact-version "0.1.0" (so it works at desktop install time
// via npm's flat-tree hoisting).
//
// Usage: node scripts/build-internal-packages.mjs
// Must be invoked FROM REPO ROOT.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = process.cwd();

// Build order MUST be: contract → persistence (persistence depends on contract).
const ORDER = [
  { name: "case-box-contract", sourceDir: "docs/contracts/case-box-contract" },
  { name: "case-box-persistence", sourceDir: "services/case-box-persistence" },
];

function step(msg) {
  process.stdout.write(`[orchestrator] ${msg}\n`);
}

function fatal(msg) {
  process.stderr.write(`[orchestrator] FAIL: ${msg}\n`);
  process.exit(1);
}

for (const pkg of ORDER) {
  const dir = path.resolve(REPO_ROOT, pkg.sourceDir);
  if (!fs.existsSync(dir)) fatal(`source dir missing: ${dir}`);

  // Per audit rev-1 follow-on (M-orchestrator): use `npm ci` not `npm install`
  // to prevent silent rewrites of source package-lock.json. `npm ci` requires
  // the lockfile to exist AND to be in sync with package.json; if either is
  // false it exits non-zero, which makes dep drift an EXPLICIT error instead
  // of a silent source mutation.
  const lockPath = path.join(dir, "package-lock.json");
  if (!fs.existsSync(lockPath)) {
    fatal(
      `${pkg.sourceDir}/package-lock.json missing; npm ci requires it. ` +
      `Generate via 'npm install' inside the package, commit the lockfile, ` +
      `then re-run this orchestrator.`,
    );
  }

  step(`installing deps for ${pkg.name} (npm ci; lockfile-pinned)`);
  try {
    execFileSync("npm", ["ci"], { cwd: dir, stdio: "inherit" });
  } catch (e) {
    fatal(
      `npm ci failed in ${pkg.sourceDir}: ${e.message}\n` +
      `  Either the lockfile is out of sync with package.json (run 'npm install' ` +
      `inside the package + commit the updated lockfile), or the package has a ` +
      `manifest/lockfile bug that must be fixed before the orchestrator can run.`,
    );
  }

  step(`building ${pkg.name}`);
  try {
    execFileSync("npm", ["run", "build"], { cwd: dir, stdio: "inherit" });
  } catch (e) {
    fatal(`npm run build failed in ${pkg.sourceDir}: ${e.message}`);
  }

  step(`stage-packing ${pkg.name}`);
  try {
    execFileSync(
      "node",
      [path.join("scripts", "pack-internal-package.mjs"), pkg.name],
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
  } catch (e) {
    fatal(`stage-pack failed for ${pkg.name}: ${e.message}`);
  }
}

step("DONE — both internal-package tarballs produced.");
step("Next step: cd apps/lawbar-desktop && npm install");
process.exit(0);
