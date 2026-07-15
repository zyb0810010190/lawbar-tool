#!/usr/bin/env node
// refresh-internal-lock-integrity.mjs — guarded refresh of the internal-package
// (case-box-contract, case-box-persistence) package-lock.json integrity records from the
// on-disk .tgz bytes.
//
// WHY a repository-owned tool: npm has no CLI/config that recomputes integrity for already-
// packed `file:` `.tgz` specs (proven in WI-INTERNAL-PACKAGE-LOCK-REFRESH RCA:
// `npm install` no-ops or EINTEGRITYs, `--package-lock-only` is a no-op, `--install-links` is
// directory-only). This tool recomputes npm-compatible SHA-512 SRI from the actual tarball
// bytes using node's built-in `crypto` (the SAME algorithm as scripts/workflow/check-internal-
// tarballs.mjs) — NO new dependency — and updates ONLY the two approved integrity fields under
// a fail-closed structural guard.
//
// Modes:
//   --check    (default) no writes; exit 1 if any target integrity is stale, 0 if all current.
//   --refresh  update ONLY the two approved integrity fields; atomic write; restore + exit 1 on
//              any unexpected semantic change.
//
// This tool NEVER auto-runs from `npm install` / `npm ci` / the check gate. It is invoked
// explicitly (bootstrap: pack:internal -> refresh -> check-internal-tarballs).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_ROOT = path.join(REPO_ROOT, "apps", "lawbar-desktop");

// Authoritative internal-package identities (mirrors pack-internal-packages.mjs INTERNAL_PACKAGES
// and check-internal-tarballs.mjs). Name + version + the ONE lock key each maps to.
export const INTERNAL_PACKAGES = Object.freeze([
  { name: "case-box-contract", version: "0.1.0" },
  { name: "case-box-persistence", version: "0.1.0" },
]);

export const SUPPORTED_LOCKFILE_VERSION = 3;

// npm-compatible SRI (identical to check-internal-tarballs.mjs sha512b64).
export function sha512b64(buf) {
  return "sha512-" + crypto.createHash("sha512").update(buf).digest("base64");
}

class RefreshError extends Error {}

// Resolve + validate one target: tarball path (inside the tarball dir; no traversal), lock key,
// expected `resolved`. Throws RefreshError on any structural surprise (fail-closed).
export function resolveTarget(pkg, { tarballDir, lock }) {
  const tgzName = `${pkg.name}-${pkg.version}.tgz`;
  const tgzPath = path.join(tarballDir, tgzName);
  // Path-traversal / outside-dir guard: the resolved absolute path MUST live directly in tarballDir.
  const rel = path.relative(tarballDir, tgzPath);
  if (rel !== tgzName || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new RefreshError(`${pkg.name}: tarball path escapes the approved dir: ${tgzPath}`);
  }
  if (!fs.existsSync(tgzPath) || !fs.statSync(tgzPath).isFile()) {
    throw new RefreshError(`${pkg.name}: tarball missing at ${tgzPath}`);
  }
  const lockKey = `node_modules/${pkg.name}`;
  const pkgs = lock.packages;
  if (pkgs === undefined || pkgs === null || typeof pkgs !== "object") {
    throw new RefreshError("lockfile has no 'packages' object");
  }
  // Exactly-one guard: the ONLY packages[] key ending in "/<name>" must be node_modules/<name>.
  const matches = Object.keys(pkgs).filter((k) => k === lockKey || k.endsWith(`/${pkg.name}`));
  const exact = matches.filter((k) => k === lockKey);
  if (exact.length !== 1) {
    throw new RefreshError(`${pkg.name}: expected exactly one '${lockKey}' lock entry, found ${exact.length}`);
  }
  // Any OTHER nested copy (node_modules/x/node_modules/<name>) is an unexpected shape -> fail.
  const extra = matches.filter((k) => k !== lockKey);
  if (extra.length > 0) {
    throw new RefreshError(`${pkg.name}: unexpected additional lock entries: ${extra.join(", ")}`);
  }
  const entry = pkgs[lockKey];
  if (typeof entry !== "object" || entry === null) {
    throw new RefreshError(`${pkg.name}: lock entry '${lockKey}' is malformed`);
  }
  if (typeof entry.integrity !== "string" || !entry.integrity.startsWith("sha512-")) {
    throw new RefreshError(`${pkg.name}: lock entry '${lockKey}' has no sha512 integrity`);
  }
  if (entry.version !== undefined && entry.version !== pkg.version) {
    throw new RefreshError(`${pkg.name}: lock version ${entry.version} != expected ${pkg.version}`);
  }
  // `resolved` (when present) MUST be EXACTLY the expected internal `file:` tarball spec — an
  // exact match, so a same-suffix remote URL (`https://evil/dist-tarballs/<name>.tgz`) is rejected.
  const expectedResolved = `file:dist-tarballs/${tgzName}`;
  if (entry.resolved !== undefined && entry.resolved !== expectedResolved) {
    throw new RefreshError(`${pkg.name}: lock 'resolved' ${JSON.stringify(entry.resolved)} != expected ${JSON.stringify(expectedResolved)}`);
  }
  return { name: pkg.name, lockKey, tgzPath, currentIntegrity: entry.integrity };
}

function readLock(lockPath) {
  const text = fs.readFileSync(lockPath, "utf-8");
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new RefreshError(`lockfile is not valid JSON: ${e.message}`);
  }
  if (json.lockfileVersion !== SUPPORTED_LOCKFILE_VERSION) {
    throw new RefreshError(`unsupported lockfileVersion ${json.lockfileVersion} (need ${SUPPORTED_LOCKFILE_VERSION})`);
  }
  return { text, json };
}

// Core: compute the desired integrity for each target + whether it is stale.
export function evaluate({ lockPath, tarballDir, packages = INTERNAL_PACKAGES }) {
  const { text, json } = readLock(lockPath);
  const results = [];
  for (const pkg of packages) {
    const t = resolveTarget(pkg, { tarballDir, lock: json });
    const desired = sha512b64(fs.readFileSync(t.tgzPath));
    results.push({ ...t, desiredIntegrity: desired, stale: t.currentIntegrity !== desired });
  }
  return { text, json, results };
}

// Refresh mode: update ONLY the approved integrity fields, atomically, with a semantic
// before/after guard. Returns { changed: [names] }.
export function refresh({ lockPath, tarballDir, packages = INTERNAL_PACKAGES }) {
  const { text: origText, json, results } = evaluate({ lockPath, tarballDir, packages });

  // Fail-closed formatting guard: the unchanged lock MUST round-trip byte-identically through
  // our serializer, else writing would reformat unrelated content. Refuse if it does not.
  const roundTrip = JSON.stringify(json, null, 2) + "\n";
  if (roundTrip !== origText) {
    throw new RefreshError("lockfile formatting is not canonical (2-space + trailing newline); refusing to write");
  }

  const before = JSON.parse(origText);
  const changed = [];
  for (const r of results) {
    if (r.stale) {
      json.packages[r.lockKey].integrity = r.desiredIntegrity;
      changed.push(r.name);
    }
  }
  if (changed.length === 0) return { changed };

  const nextText = JSON.stringify(json, null, 2) + "\n";

  // Semantic before/after guard: the ONLY differences must be the approved integrity values.
  assertOnlyApprovedIntegrityChanged(before, JSON.parse(nextText), results);

  // Atomic write (temp + rename in the same dir).
  const tmp = lockPath + `.refresh.${process.pid}.tmp`;
  fs.writeFileSync(tmp, nextText);
  try {
    // Concurrency guard: the lockfile must not have changed on disk since we snapshot origText,
    // else an intervening unrelated edit would be silently clobbered. Abort without writing.
    if (fs.readFileSync(lockPath, "utf-8") !== origText) {
      throw new RefreshError("lockfile changed on disk during refresh; aborted without writing");
    }
    fs.renameSync(tmp, lockPath);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }

  // Post-write verification: re-read + re-assert; restore original bytes on any surprise.
  try {
    const after = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    assertOnlyApprovedIntegrityChanged(before, after, results);
  } catch (e) {
    fs.writeFileSync(lockPath, origText);
    throw new RefreshError(`post-write verification failed, restored original: ${e.message}`);
  }
  return { changed };
}

// Deep structural assertion: `after` may differ from `before` ONLY in the `integrity` value at
// packages['node_modules/<name>'] for the approved targets (to their desired values). Any other
// path difference throws.
export function assertOnlyApprovedIntegrityChanged(before, after, results) {
  const approved = new Map(results.map((r) => [`packages.node_modules/${r.name}.integrity`, r.desiredIntegrity]));
  const diffs = [];
  collectDiffs(before, after, "", diffs);
  for (const d of diffs) {
    if (approved.has(d.path)) {
      if (d.after !== approved.get(d.path)) {
        throw new RefreshError(`approved field ${d.path} set to unexpected value`);
      }
      continue;
    }
    throw new RefreshError(`unexpected lockfile change at ${d.path} (${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)})`);
  }
  // Every stale approved target MUST have changed (no silent skips).
  for (const r of results) {
    if (r.stale && !diffs.some((d) => d.path === `packages.node_modules/${r.name}.integrity`)) {
      throw new RefreshError(`approved target ${r.name} was not updated`);
    }
  }
}

function collectDiffs(a, b, prefix, out) {
  if (a === b) return;
  const aObj = a && typeof a === "object";
  const bObj = b && typeof b === "object";
  if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ path: prefix, before: a, after: b });
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (!(k in a) || !(k in b)) { out.push({ path: p, before: a[k], after: b[k] }); continue; }
    collectDiffs(a[k], b[k], p, out);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main(argv) {
  const mode = argv.includes("--refresh") ? "refresh" : "check";
  const lockPath = path.join(APP_ROOT, "package-lock.json");
  const tarballDir = path.join(APP_ROOT, "dist-tarballs");
  try {
    if (mode === "check") {
      const { results } = evaluate({ lockPath, tarballDir });
      const stale = results.filter((r) => r.stale);
      for (const r of results) {
        process.stdout.write(`[refresh-internal-lock] ${r.name}: ${r.stale ? "STALE" : "current"}\n`);
      }
      if (stale.length > 0) {
        process.stderr.write(`[refresh-internal-lock] ${stale.length} stale integrity record(s). Run with --refresh (after pack:internal), then npm ci.\n`);
        process.exit(1);
      }
      process.stdout.write("[refresh-internal-lock] all internal-package integrity records are current.\n");
      return;
    }
    const { changed } = refresh({ lockPath, tarballDir });
    if (changed.length === 0) process.stdout.write("[refresh-internal-lock] nothing to refresh (already current).\n");
    else process.stdout.write(`[refresh-internal-lock] refreshed integrity for: ${changed.join(", ")}\n`);
  } catch (e) {
    process.stderr.write(`[refresh-internal-lock] ERROR: ${e.message}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
