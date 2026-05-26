#!/usr/bin/env node
// pack-internal-packages.mjs — pre-build helper for the tarball PoC. Per
// dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md (rev-0.3; committed at
// 1d04256) §5.1 + package-arch-00.md §11.0.
//
// For each internal package (case-box-contract, case-box-persistence):
//   1. Creates a fresh temp staging dir.
//   2. Copies the package contents into staging.
//   3. Rewrites the STAGED package.json (NOT the source) to remove any
//      source-relative `file:` dep specs on internal packages — replacing
//      with exact non-`file:` version identity per package-arch §11.0.
//   4. Fail-closed scan over `dependencies`, `optionalDependencies`,
//      `peerDependencies`, and `bundleDependencies` for residual
//      `file:` / `link:` / `git+` / `portal:` specs. Exits non-zero with
//      a clear error if any are present.
//   5. Runs `npm pack` on the STAGED copy. Output tarball is moved to
//      apps/lawbar-desktop/dist-tarballs/.
//   6. Captures tarball filename + sha512 integrity hash; appends to
//      apps/lawbar-desktop/dist-tarballs/manifest.json.
//   7. Cleans up the staging dir.
//
// Source manifests are NEVER mutated.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..", "..");
const TARBALL_OUTPUT_DIR = path.join(APP_ROOT, "dist-tarballs");

// Internal packages to pack. The `rewrites` map names dep specs that must
// be rewritten in the STAGED manifest. Keys are dep names; values are the
// non-`file:` identity to substitute.
const INTERNAL_PACKAGES = [
  {
    name: "case-box-contract",
    sourceDir: path.join(REPO_ROOT, "docs", "contracts", "case-box-contract"),
    rewrites: {},
  },
  {
    name: "case-box-persistence",
    sourceDir: path.join(REPO_ROOT, "services", "case-box-persistence"),
    // Rewrite the source-relative file: dep on case-box-contract per
    // package-arch §11.0 staging-rewrite rule. Identity matches the
    // case-box-contract version we just packed.
    rewrites: { "case-box-contract": "0.1.0" },
  },
];

const FORBIDDEN_SPEC_PREFIXES = ["file:", "link:", "git+", "portal:"];

function log(msg) {
  console.log(`[pack-internal] ${msg}`);
}

function fatal(msg) {
  console.error(`[pack-internal] FATAL: ${msg}`);
  process.exit(1);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) fatal(`source directory missing: ${src}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
    // Skip symlinks + sockets + other entry types deliberately.
  }
}

function rewriteStagedManifest(stagedDir, rewrites, pkgName) {
  const manifestPath = path.join(stagedDir, "package.json");
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw);

  const depFields = ["dependencies", "optionalDependencies", "peerDependencies"];
  let anyMutated = false;
  for (const field of depFields) {
    const map = manifest[field];
    if (map === undefined || map === null) continue;
    for (const [depName, target] of Object.entries(rewrites)) {
      if (depName in map) {
        const before = map[depName];
        map[depName] = target;
        log(`  ${pkgName}: rewrote ${field}["${depName}"] "${before}" → "${target}"`);
        anyMutated = true;
      }
    }
  }
  if (Object.keys(rewrites).length > 0 && !anyMutated) {
    log(`  ${pkgName}: no rewrites needed (no matching deps in source manifest)`);
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return manifest;
}

function failClosedScan(manifest, pkgName) {
  const depFields = ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies"];
  const offenders = [];
  for (const field of depFields) {
    const value = manifest[field];
    if (value === undefined || value === null) continue;
    // bundleDependencies is an array of dep names; the others are objects.
    if (Array.isArray(value)) continue;
    for (const [depName, spec] of Object.entries(value)) {
      if (typeof spec !== "string") continue;
      for (const prefix of FORBIDDEN_SPEC_PREFIXES) {
        if (spec.startsWith(prefix)) {
          offenders.push({ field, depName, spec });
          break;
        }
      }
    }
  }
  if (offenders.length > 0) {
    console.error(`[pack-internal] FAIL: residual forbidden dep specs in ${pkgName}'s staged manifest:`);
    for (const o of offenders) {
      console.error(`  ${o.field}["${o.depName}"] = "${o.spec}"`);
    }
    fatal(`staged manifest for ${pkgName} contains forbidden specs; staging-rewrite incomplete`);
  }
  log(`  ${pkgName}: fail-closed scan passed (no file:/link:/git+/portal: in deps/optionalDeps/peerDeps/bundleDeps)`);
}

function npmPackStaging(stagedDir, pkgName, outputDir) {
  // `npm pack --pack-destination <dir>` writes the tarball directly to
  // outputDir. cwd MUST be the staged dir.
  const result = spawnSync("npm", ["pack", "--pack-destination", outputDir, "--silent"], {
    cwd: stagedDir,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    console.error(`[pack-internal] npm pack stdout: ${result.stdout}`);
    console.error(`[pack-internal] npm pack stderr: ${result.stderr}`);
    fatal(`npm pack failed for ${pkgName} (exit ${result.status})`);
  }
  // npm pack --silent still prints the tarball filename to stdout. Get it.
  const tarballName = result.stdout.trim().split(/\n/).pop();
  if (typeof tarballName !== "string" || tarballName.length === 0) {
    fatal(`npm pack succeeded but did not output a tarball name for ${pkgName}`);
  }
  const tarballPath = path.join(outputDir, tarballName);
  if (!fs.existsSync(tarballPath)) {
    fatal(`expected tarball at ${tarballPath} but it does not exist`);
  }
  return tarballPath;
}

function sha512Of(filePath) {
  const data = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha512").update(data).digest("base64");
  return `sha512-${hash}`;
}

function main() {
  ensureDir(TARBALL_OUTPUT_DIR);

  const manifestRows = [];

  for (const pkg of INTERNAL_PACKAGES) {
    log(`packing ${pkg.name} from ${pkg.sourceDir}`);
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `lawbar-pack-${pkg.name}-`));
    try {
      copyDirSync(pkg.sourceDir, stagingDir);
      const stagedManifest = rewriteStagedManifest(stagingDir, pkg.rewrites, pkg.name);
      failClosedScan(stagedManifest, pkg.name);

      const tarballPath = npmPackStaging(stagingDir, pkg.name, TARBALL_OUTPUT_DIR);
      const integrity = sha512Of(tarballPath);
      const sizeBytes = fs.statSync(tarballPath).size;
      log(`  ${pkg.name}: packed → ${path.basename(tarballPath)} (${sizeBytes} bytes; ${integrity.slice(0, 24)}...)`);
      manifestRows.push({
        name: pkg.name,
        sourceDir: path.relative(REPO_ROOT, pkg.sourceDir),
        tarball: path.relative(APP_ROOT, tarballPath),
        sizeBytes,
        integrity,
        rewrites: pkg.rewrites,
        packedAt: new Date().toISOString(),
      });
    } finally {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[pack-internal] could not clean staging dir ${stagingDir}: ${e.message}`);
      }
    }
  }

  const manifestFile = path.join(TARBALL_OUTPUT_DIR, "manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify({ packed: manifestRows, generator: "scripts/pack-internal-packages.mjs", schemaVersion: 1 }, null, 2) + "\n", "utf-8");
  log(`wrote ${path.relative(APP_ROOT, manifestFile)}`);
  log(`DONE: packed ${manifestRows.length} internal package(s)`);
}

main();
