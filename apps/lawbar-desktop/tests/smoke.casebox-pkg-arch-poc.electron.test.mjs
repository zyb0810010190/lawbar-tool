// Packaged smoke for WI-desktop-pkg-arch-tarball-poc per
// dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md §6.
//
// 4 test cases:
//   1. `app.asar` contains case-box-persistence/dist/index.js AND
//      case-box-contract/dist/index.js AND case-box-contract/dist/
//      ajv-instance.js (the specific file that failed in WI-B Option B).
//   2. `app.asar.unpacked` contains better_sqlite3.node (WI-B regression).
//   3. Recursive symlink scan over `Contents/Resources/` finds NO escape.
//   4. Spawn packaged binary with --probe-casebox-pkg-arch; assert
//      PROBE_OK + validatorOk=true.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseDirs = [
  path.join(projectRoot, "dist"),
  path.join(projectRoot, "release"),
];

function findPackagedAppDir() {
  // Per audit L1: prefer newest by mtime so stale dist/ or release/ artifacts
  // don't satisfy the smoke test. Env var `LAWBAR_POC_APP_PATH` overrides
  // when explicit. HOST-ARCH .apps are preferred over cross-arch even when
  // a cross-arch .app is newer (x64 .app can't run natively on arm64; the
  // spawn would either fail or run via Rosetta which is not the test target).
  //
  // Per audit rev-1 follow-on (L-env-var): if LAWBAR_POC_APP_PATH is set,
  // REQUIRE that exact path to exist. Silently falling back to auto-discovery
  // when the user-supplied path is wrong (typo, stale path) could let the
  // test pass against the wrong artifact.
  const explicit = process.env.LAWBAR_POC_APP_PATH;
  if (explicit !== undefined && explicit !== "") {
    if (!fs.existsSync(explicit)) {
      throw new Error(
        `LAWBAR_POC_APP_PATH is set to "${explicit}" but that path does not exist. ` +
        `Refusing to fall back to auto-discovery (would silently test the wrong artifact).`,
      );
    }
    return explicit;
  }

  const isArm64 = os.arch() === "arm64";
  const hostArchSubdirs = isArm64 ? ["mac-arm64"] : ["mac-x64", "mac"];
  const otherArchSubdirs = isArm64 ? ["mac-x64", "mac"] : ["mac-arm64"];

  function pickNewestIn(subdirs) {
    const candidates = [];
    for (const sub of subdirs) {
      for (const dir of releaseDirs) {
        const appBundle = path.join(dir, sub, "lawbar.app");
        if (fs.existsSync(appBundle)) {
          try {
            candidates.push({ path: appBundle, mtime: fs.statSync(appBundle).mtimeMs });
          } catch {
            /* dangling — skip */
          }
        }
      }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0]?.path ?? null;
  }

  // Prefer host-arch (newest). Fall back to cross-arch (newest) only if no
  // host-arch .app exists at all.
  return pickNewestIn(hostArchSubdirs) ?? pickNewestIn(otherArchSubdirs);
}

test("packaged .app contains case-box-persistence AND case-box-contract in app.asar", () => {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle, "packaged .app missing; run `npm run dist` first");
  const asarPath = path.join(appBundle, "Contents", "Resources", "app.asar");
  assert.ok(fs.existsSync(asarPath), `app.asar missing at ${asarPath}`);

  // Direct local-bin invocation (hermetic; no npm exec, no npx, no tar tzf).
  // electron-builder bundles @electron/asar; its bin lands at node_modules/.bin/asar.
  const asarBin = path.join(projectRoot, "node_modules", ".bin", "asar");
  assert.ok(
    fs.existsSync(asarBin),
    `expected local asar bin at ${asarBin}; install electron-builder first`,
  );
  const listing = execFileSync(asarBin, ["list", asarPath], {
    encoding: "utf-8",
  });

  assert.match(listing, /\/node_modules\/case-box-persistence\/dist\/index\.js/);
  assert.match(listing, /\/node_modules\/case-box-contract\/dist\/index\.js/);
  // The SPECIFIC file that defeated WI-B Option B:
  assert.match(listing, /\/node_modules\/case-box-contract\/dist\/ajv-instance\.js/);
});

test("packaged .app contains better_sqlite3.node in app.asar.unpacked (WI-B regression)", () => {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle);
  const native = path.join(
    appBundle, "Contents", "Resources", "app.asar.unpacked",
    "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node",
  );
  assert.ok(fs.existsSync(native), `better_sqlite3.node missing at ${native}`);
});

test("packaged .app: no symlink escapes or dangles within the .app bundle", () => {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle, "packaged .app missing");
  const resourcesDir = path.join(appBundle, "Contents", "Resources");
  const violations = scanForSymlinkViolations(resourcesDir, appBundle);
  assert.deepEqual(
    violations, [],
    `found symlink violations (escape OR dangling) under ${appBundle}: ${JSON.stringify(violations, null, 2)}`,
  );
});

// Per audit M3: dangling/unresolvable symlinks are themselves a packaging
// defect; treat as violations rather than silently skipping. Returns a list
// of { link, kind, realpath?, error? } entries.
//
// Per audit rev-1 follow-on (M-depth-cap): no depth cap. Symlinks are
// inspected (lstat) but NOT recursively followed, so traversal cannot loop
// through symlink cycles. Real directories form a finite acyclic tree under
// the bundle root; unbounded traversal is safe.
function scanForSymlinkViolations(dir, bundleRoot) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return [{ link: dir.replace(bundleRoot + "/", ""), kind: "readdir-failed", error: e.message }];
  }
  const violations = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      let real;
      try {
        real = fs.realpathSync(full);
      } catch (err) {
        // Dangling or unresolvable symlink → violation per audit M3.
        violations.push({
          link: full.replace(bundleRoot + "/", ""),
          kind: "dangling-or-unresolvable",
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      // Allow symlinks WITHIN the bundle; flag any that escape.
      if (!real.startsWith(bundleRoot + path.sep) && real !== bundleRoot) {
        violations.push({
          link: full.replace(bundleRoot + "/", ""),
          kind: "escapes-bundle",
          realpath: real,
        });
      }
    } else if (e.isDirectory()) {
      violations.push(...scanForSymlinkViolations(full, bundleRoot));
    }
  }
  return violations;
}

test(
  "packaged .app --probe-casebox-pkg-arch: validateMatter + createMatter round-trip succeeds",
  { timeout: 15_000 },
  async () => {
    const appBundle = findPackagedAppDir();
    assert.ok(appBundle, "packaged .app missing");
    const binary = path.join(appBundle, "Contents", "MacOS", "lawbar");
    assert.ok(fs.existsSync(binary), `packaged binary missing at ${binary}`);

    const result = await new Promise((resolve, reject) => {
      const child = spawn(binary, ["--probe-casebox-pkg-arch"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      // Per audit rev-2 L2: store the timeout handle and clear it on exit/error
      // so the test process is not held alive by a pending 10s timer even when
      // the probe completes in milliseconds.
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 10_000);
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, stdout, stderr });
      });
    });

    assert.equal(
      result.code, 0,
      `probe exited code=${result.code} signal=${result.signal}\n` +
      `selected .app: ${appBundle}\n` +
      `stdout=${result.stdout}\nstderr=${result.stderr}`,
    );
    assert.match(
      result.stdout,
      /^PROBE_OK matterId=01h0000000000000000000poc1 validatorOk=true/m,
      `probe stdout missing PROBE_OK; got:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.doesNotMatch(
      result.stdout,
      /PROBE_FAIL/,
      `probe stdout contains PROBE_FAIL; got:\n${result.stdout}`,
    );
  },
);
