#!/usr/bin/env node
// check-internal-tarballs.mjs — DESKTOP-DEPS-00 drift guard.
//
// Per docs/adr/ADR-evidence-desktop-internal-deps-packaging.md (Option 1), the
// desktop's internal dependency tarballs (apps/lawbar-desktop/dist-tarballs/*.tgz)
// are committed + pinned by package-lock.json. This guard fails (exit 1) when a
// committed tarball's PAYLOAD has drifted from the current source — so a forgotten
// repack after a contract/persistence source change is caught in CI, not shipped
// (the exact failure mode of DESKTOP-DEPS-STALE-LOCK-01: a stale bundled contract
// missing the LINK_* audit kinds).
//
// It is a SEMANTIC-PAYLOAD comparison, not a fragile grep:
//   1. Self-consistency: each committed manifest.json entry's sizeBytes + integrity
//      MATCH the committed tarball bytes; static identity fields equal expected.
//      (We do NOT compare to a fresh-pack integrity — `npm pack` bytes carry
//      non-reproducible tar/gzip metadata. The EXTRACTED payload IS reproducible.)
//   2. Payload: re-stage each package from source the way pack-internal-packages.mjs
//      does (copy the package tree excluding node_modules/.git, rewrite the staged
//      manifest's internal dep specs, fail-closed scan for residual file:/link:/...),
//      `npm pack` into a temp dir, extract BOTH the fresh and the committed tarballs,
//      and compare the extracted `package/**` file LIST (as a set) + each file's
//      sha256 content hash. Any missing/extra file or content diff fails.
//
// This script mirrors scripts in apps/lawbar-desktop/scripts/pack-internal-packages.mjs
// (kept in sync by intent; the staging/rewrite/scan rules below match it).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_ROOT = path.join(REPO_ROOT, "apps", "lawbar-desktop");
const TARBALL_DIR = path.join(APP_ROOT, "dist-tarballs");
const MANIFEST = path.join(TARBALL_DIR, "manifest.json");

// Mirrors pack-internal-packages.mjs INTERNAL_PACKAGES + FORBIDDEN_SPEC_PREFIXES.
const INTERNAL_PACKAGES = [
  { name: "case-box-contract", sourceDir: path.join(REPO_ROOT, "docs", "contracts", "case-box-contract"), rewrites: {} },
  { name: "case-box-persistence", sourceDir: path.join(REPO_ROOT, "services", "case-box-persistence"), rewrites: { "case-box-contract": "0.1.0" } },
];
const FORBIDDEN_SPEC_PREFIXES = ["file:", "link:", "git+", "portal:"];
const DEP_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies"];
const EXPECTED_GENERATOR = "scripts/pack-internal-packages.mjs";
const EXPECTED_SCHEMA_VERSION = 1;

const failures = [];
function fail(msg) { failures.push(msg); }
function sha512b64(buf) { return "sha512-" + crypto.createHash("sha512").update(buf).digest("base64"); }
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function rewriteAndScanStagedManifest(stageDir, rewrites, pkgName) {
  const mp = path.join(stageDir, "package.json");
  const m = JSON.parse(fs.readFileSync(mp, "utf-8"));
  for (const field of DEP_FIELDS) {
    const map = m[field];
    if (map && typeof map === "object") {
      for (const dep of Object.keys(map)) {
        if (Object.prototype.hasOwnProperty.call(rewrites, dep)) map[dep] = rewrites[dep];
      }
    }
  }
  // fail-closed scan for residual forbidden specs (mirrors pack-internal).
  for (const field of DEP_FIELDS) {
    const map = m[field];
    if (!map) continue;
    for (const [dep, spec] of Object.entries(map)) {
      if (typeof spec === "string" && FORBIDDEN_SPEC_PREFIXES.some((p) => spec.startsWith(p))) {
        fail(`${pkgName}: staged manifest has residual forbidden spec ${field}.${dep} = ${spec}`);
      }
    }
  }
  fs.writeFileSync(mp, JSON.stringify(m, null, 2) + "\n", "utf-8");
}

function extractTarball(tgz, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = spawnSync("tar", ["-xzf", tgz, "-C", destDir], { encoding: "utf-8" });
  if (r.status !== 0) fail(`tar extract failed for ${tgz}: ${r.stderr}`);
}

function walkFiles(root) {
  const out = [];
  (function rec(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) rec(full);
      else if (e.isFile()) out.push(path.relative(root, full));
    }
  })(root);
  return out.sort();
}

function checkLockIntegrity(lock, pkg, committedTgz) {
  // The committed package-lock.json MUST pin the committed tarball bytes, else a
  // clean `npm ci` fails (EINTEGRITY) or silently installs stale content — the
  // exact DESKTOP-DEPS-STALE-LOCK-01 failure. Catches "repacked the tarball but
  // forgot the lock" in an already-bootstrapped workspace.
  const entry = (lock.packages || {})[`node_modules/${pkg.name}`];
  if (!entry) { fail(`${pkg.name}: package-lock.json has no node_modules/${pkg.name} entry`); return; }
  const integ = sha512b64(fs.readFileSync(committedTgz));
  if (entry.integrity !== integ) {
    fail(`${pkg.name}: package-lock.json integrity ${String(entry.integrity).slice(0, 24)}… != committed tarball ${integ.slice(0, 24)}… (run pack:internal, then 'npm run refresh:internal-tarballs', then npm ci)`);
  }
}

function checkManifestSelfConsistency(manifest, pkg, committedTgz) {
  if (manifest.generator !== EXPECTED_GENERATOR) fail(`manifest.generator = ${manifest.generator} (expected ${EXPECTED_GENERATOR})`);
  if (manifest.schemaVersion !== EXPECTED_SCHEMA_VERSION) fail(`manifest.schemaVersion = ${manifest.schemaVersion} (expected ${EXPECTED_SCHEMA_VERSION})`);
  const entry = (manifest.packed || []).find((p) => p.name === pkg.name);
  if (!entry) { fail(`manifest has no entry for ${pkg.name}`); return; }
  const bytes = fs.readFileSync(committedTgz);
  const size = bytes.length;
  const integ = sha512b64(bytes);
  if (entry.sizeBytes !== size) fail(`${pkg.name}: manifest.sizeBytes ${entry.sizeBytes} != committed tarball bytes ${size}`);
  if (entry.integrity !== integ) fail(`${pkg.name}: manifest.integrity ${String(entry.integrity).slice(0, 24)}… != committed tarball ${integ.slice(0, 24)}…`);
  const expectedTarball = `dist-tarballs/${pkg.name}-0.1.0.tgz`;
  if (entry.tarball !== expectedTarball) fail(`${pkg.name}: manifest.tarball ${entry.tarball} != ${expectedTarball}`);
  const expectedSourceDir = path.relative(REPO_ROOT, pkg.sourceDir);
  if (entry.sourceDir !== expectedSourceDir) fail(`${pkg.name}: manifest.sourceDir ${entry.sourceDir} != ${expectedSourceDir}`);
  if (JSON.stringify(entry.rewrites || {}) !== JSON.stringify(pkg.rewrites)) fail(`${pkg.name}: manifest.rewrites drift (${JSON.stringify(entry.rewrites)})`);
  // entry.packedAt is intentionally volatile — NOT compared.
}

function checkPayload(pkg, committedTgz, tmp) {
  // 1) Fresh stage from source + npm pack.
  const stage = fs.mkdtempSync(path.join(tmp, `${pkg.name}-stage-`));
  copyDirSync(pkg.sourceDir, stage);
  rewriteAndScanStagedManifest(stage, pkg.rewrites, pkg.name);
  const packOut = fs.mkdtempSync(path.join(tmp, `${pkg.name}-pack-`));
    // A package whose dist/ has not been built produces a payload-free tarball, and every file
  // in the committed one then reads as "EXTRA" — 200 lines of diff for what is really one
  // missing precondition. `dist/` is gitignored, so this is the normal state of a clean
  // checkout, and it is exactly how this guard came to pass locally and fail in CI.
  if (!fs.existsSync(path.join(stage, "dist"))) {
    console.error(`[check-internal-tarballs] ${path.basename(stage)}: no dist/ to pack.`);
    console.error("  This compares the committed tarball against a FRESH PACK OF SOURCE, so the");
    console.error("  source must be compiled first. Run the package's `build` script, then retry.");
    process.exit(1);
  }
  const r = spawnSync("npm", ["pack", "--pack-destination", packOut], { cwd: stage, encoding: "utf-8" });
  if (r.status !== 0) { fail(`${pkg.name}: npm pack failed: ${r.stderr}`); return; }
  const freshTgz = fs.readdirSync(packOut).find((f) => f.endsWith(".tgz"));
  if (!freshTgz) { fail(`${pkg.name}: fresh pack produced no tarball`); return; }

  // 2) Extract both + compare extracted payloads (file list + content).
  const freshDir = fs.mkdtempSync(path.join(tmp, `${pkg.name}-fresh-`));
  const commDir = fs.mkdtempSync(path.join(tmp, `${pkg.name}-comm-`));
  extractTarball(path.join(packOut, freshTgz), freshDir);
  extractTarball(committedTgz, commDir);
  const freshRoot = path.join(freshDir, "package");
  const commRoot = path.join(commDir, "package");
  const freshFiles = walkFiles(freshRoot);
  const commFiles = walkFiles(commRoot);
  const freshSet = new Set(freshFiles);
  const commSet = new Set(commFiles);
  for (const f of freshFiles) if (!commSet.has(f)) fail(`${pkg.name}: committed tarball MISSING payload file ${f}`);
  for (const f of commFiles) if (!freshSet.has(f)) fail(`${pkg.name}: committed tarball has EXTRA payload file ${f}`);
  for (const f of freshFiles) {
    if (!commSet.has(f)) continue;
    const a = sha256(fs.readFileSync(path.join(freshRoot, f)));
    const b = sha256(fs.readFileSync(path.join(commRoot, f)));
    if (a !== b) fail(`${pkg.name}: payload CONTENT drift in ${f} (committed tarball differs from fresh pack of current source)`);
  }
}

function main() {
  if (!fs.existsSync(MANIFEST)) { console.error(`[check-internal-tarballs] FATAL: missing ${path.relative(REPO_ROOT, MANIFEST)} — run \`npm --prefix apps/lawbar-desktop run pack:internal\``); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
  const lockPath = path.join(APP_ROOT, "package-lock.json");
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, "utf-8")) : null;
  if (!lock) fail(`missing ${path.relative(REPO_ROOT, lockPath)}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-internal-tarballs-"));
  try {
    for (const pkg of INTERNAL_PACKAGES) {
      const committedTgz = path.join(TARBALL_DIR, `${pkg.name}-0.1.0.tgz`);
      if (!fs.existsSync(committedTgz)) { fail(`${pkg.name}: committed tarball missing at ${path.relative(REPO_ROOT, committedTgz)}`); continue; }
      checkManifestSelfConsistency(manifest, pkg, committedTgz);
      if (lock) checkLockIntegrity(lock, pkg, committedTgz);
      checkPayload(pkg, committedTgz, tmp);
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  if (failures.length > 0) {
    console.error("[check-internal-tarballs] DRIFT DETECTED — committed internal tarballs are stale vs current source:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("Fix: `npm --prefix apps/lawbar-desktop run pack:internal && npm --prefix apps/lawbar-desktop run refresh:internal-tarballs`, then `npm --prefix apps/lawbar-desktop ci`, and re-commit the tarballs + lockfile.");
    process.exit(1);
  }
  console.log("[check-internal-tarballs] PASS — committed internal tarballs match current source payloads + manifest is self-consistent.");
}

main();
