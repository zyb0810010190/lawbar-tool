// Tarball PoC packaged-binary test. Per
// dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md (rev-0.3 at 1d04256) §6.2.
//
// Verifies that case-box-contract + case-box-persistence + better-sqlite3
// load + execute correctly inside the packaged Electron main process. The
// mechanism (Option A1):
//   1. Launch the packaged .app via the WI-2 wrapper's launchPackaged
//      helper with LAWBAR_TARBALL_POC_TEST_HOOK=true.
//   2. Wait for app.firstWindow() — guarantees app.whenReady has resolved.
//   3. Bounded poll for globalThis.__lawbarTarballPocProbe via
//      app.evaluate (M1 remediation; timeout default 5s, configurable via
//      LAWBAR_TARBALL_POC_HOOK_TIMEOUT_MS).
//   4. Invoke the probe via app.evaluate. The probe's body runs in the
//      main process's native ESM loader (NOT in app.evaluate's vm context),
//      bypassing the empirically-falsified ESM blocker per parent §26 step 3.
//   5. Assert the result shape.
//   6. Layered structural checks per §8 G-7 (asar list + .node filesystem
//      presence + installed manifest non-`file:` + lockfile integrity).
//
// The WI-2 wrapper (scripts/test-packaged-wrapper.mjs) owns crash detection.
// This test runs UNDER the wrapper via `npm run test:tarball-poc`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchPackaged } from "./_launch-with-pid-log.mjs";

// rev-impl-0.1 M2 fix — proper path-containment check using path.relative.
// Returns true iff `candidatePath` is inside `containerRoot` per POSIX
// containment (relative path is "." or non-empty, does NOT start with "..",
// and is NOT absolute). Defeats prefix false-positives like
// `/x/node_modules_evil` matching `/x/node_modules`.
function isContainedIn(candidatePath, containerRoot) {
  const rel = path.relative(containerRoot, candidatePath);
  if (rel === "") return true; // candidate IS the root
  if (path.isAbsolute(rel)) return false;
  if (rel === "..") return false;
  if (rel.startsWith(".." + path.sep)) return false;
  return true;
}

// Wrapper sentinel — Guard #3 (load-bearing) per
// dev-memo/plan-pkg-verify-detection-redesign-00.md §6 Guard #3 rev-0.1.
const __isCi = process.env.LAWBAR_CI === "true" || process.env.CI === "true";
if (__isCi) {
  const __missing = [];
  if (!process.env.LAWBAR_TEST_PID_LOG) __missing.push("LAWBAR_TEST_PID_LOG");
  if (!process.env.LAWBAR_WRAPPER_VERSION) __missing.push("LAWBAR_WRAPPER_VERSION");
  if (__missing.length > 0) {
    console.error(
      `[tarball-poc] FATAL: must run through scripts/test-packaged-wrapper.mjs in CI; missing env: ${__missing.join(", ")}`,
    );
    process.exit(2);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseDirs = [
  path.join(projectRoot, "dist"),
  path.join(projectRoot, "release"),
];
const PREF_FILE = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "lawbar",
  "theme-preference.json",
);

function clearPref() {
  try { fs.unlinkSync(PREF_FILE); } catch { /* already absent */ }
}

function findPackagedAppDir() {
  // electron-builder emits <outdir>/mac-<arch>/lawbar.app. Host-arch first.
  const isArm64 = os.arch() === "arm64";
  const hostArchSubdirs = isArm64 ? ["mac-arm64"] : ["mac-x64", "mac"];
  const otherArchSubdirs = isArm64 ? ["mac-x64", "mac"] : ["mac-arm64"];
  for (const sub of [...hostArchSubdirs, ...otherArchSubdirs]) {
    for (const dir of releaseDirs) {
      const appBundle = path.join(dir, sub, "lawbar.app");
      if (fs.existsSync(appBundle)) return appBundle;
    }
  }
  return null;
}

// ----------------------------------------------------------------------
// G-6 — runtime probe via globalThis hook + app.evaluate
// ----------------------------------------------------------------------

test("tarball PoC: case-box-* round-trip inside packaged Electron main process", async (t) => {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle !== null, `packaged .app not found under ${releaseDirs.join(" | ")}; run \`npm run dist\` first`);
  const binary = path.join(appBundle, "Contents", "MacOS", "lawbar");

  clearPref();
  const app = await launchPackaged({
    executablePath: binary,
    args: [],
    env: {
      ...process.env,
      LAWBAR_MODE: "dev",
      LAWBAR_TARBALL_POC_TEST_HOOK: "true",
    },
  }, { testName: "tarball PoC round-trip" });
  t.after(async () => {
    await app.close();
    clearPref();
  });

  await app.firstWindow();

  // Bounded readiness poll for the hook (rev-0.1 M1 fix; configurable
  // timeout). The hook is installed at the END of app.whenReady().then(...).
  const hookTimeoutMs = Number(process.env.LAWBAR_TARBALL_POC_HOOK_TIMEOUT_MS ?? "5000");
  const pollStartMs = Date.now();
  let hookReady = false;
  while (Date.now() - pollStartMs < hookTimeoutMs) {
    hookReady = await app.evaluate(() => {
      return typeof globalThis.__lawbarTarballPocProbe === "function";
    });
    if (hookReady) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    hookReady,
    `HARNESS FAILURE: __lawbarTarballPocProbe hook not installed within ${hookTimeoutMs}ms after firstWindow(). `
    + `This is a test-harness timing issue, NOT a package-architecture failure. `
    + `Verify (a) LAWBAR_TARBALL_POC_TEST_HOOK=true is in the launched env; `
    + `(b) electron/main.ts contains the env-gated hook installer; `
    + `(c) bump LAWBAR_TARBALL_POC_HOOK_TIMEOUT_MS if app.whenReady is slow on this hardware.`,
  );

  const result = await app.evaluate(async () => {
    const fn = globalThis.__lawbarTarballPocProbe;
    return await fn();
  });

  assert.equal(result.ok, true, `probe failed: ${result.error ?? "(no error message)"}`);
  assert.ok(typeof result.durationMs === "number" && result.durationMs >= 0, `durationMs missing/invalid: ${result.durationMs}`);
  assert.ok(typeof result.recordedTenantId === "string" && result.recordedTenantId.length > 0, `recordedTenantId missing: ${result.recordedTenantId}`);
  assert.ok(typeof result.recordedMatterId === "string" && result.recordedMatterId.length > 0, `recordedMatterId missing: ${result.recordedMatterId}`);
});

// ----------------------------------------------------------------------
// G-7 — structural inspection (filesystem-only; NOT runtime loadability,
// which is G-6's responsibility).
// ----------------------------------------------------------------------

test("G-7.a — app.asar lists case-box-contract + case-box-persistence module paths", () => {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle !== null);
  // rev-impl-0.1 M1 fix — actually inspect the asar archive contents via
  // the @electron/asar binary that is already in node_modules (transitive
  // dep of electron-builder). Asserts that BOTH module entry points are
  // present in the archive index — file presence + size alone could pass
  // without these paths being packed.
  const asarPath = path.join(appBundle, "Contents", "Resources", "app.asar");
  assert.ok(fs.existsSync(asarPath), `app.asar missing at ${asarPath}`);

  const asarBin = path.resolve(__dirname, "..", "node_modules", ".bin", "asar");
  assert.ok(
    fs.existsSync(asarBin),
    `@electron/asar binary missing at ${asarBin}; run \`npm run bootstrap\` first`,
  );
  const listResult = spawnSync(asarBin, ["list", asarPath], {
    encoding: "utf-8",
    timeout: 30_000,
  });
  assert.equal(
    listResult.status, 0,
    `\`asar list ${asarPath}\` failed (exit ${listResult.status}); stderr=${listResult.stderr}`,
  );
  const entries = new Set(listResult.stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0));
  const expected = [
    "/node_modules/case-box-contract/dist/index.js",
    "/node_modules/case-box-persistence/dist/index.js",
  ];
  for (const e of expected) {
    assert.ok(
      entries.has(e),
      `app.asar does NOT contain ${e}; archive has ${entries.size} entries; check electron-builder \`build.files\` config`,
    );
  }
});

test("G-7.b — better-sqlite3 .node binding exists in app.asar.unpacked", () => {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle !== null);
  const nodePath = path.join(
    appBundle, "Contents", "Resources", "app.asar.unpacked",
    "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node",
  );
  assert.ok(fs.existsSync(nodePath), `better-sqlite3 native binding missing at ${nodePath}`);
  // Runtime loadability is G-6's responsibility (the probe IMPORTS
  // case-box-persistence which transitively LOADS this .node file).
});

test("G-7.c — no symlink escapes under apps/lawbar-desktop/node_modules/", () => {
  const nmRoot = path.resolve(__dirname, "..", "node_modules");
  // rev-impl-0.1 M3 fix — G-7 is an acceptance gate; missing prerequisites
  // MUST fail, not silently skip with console.warn.
  assert.ok(
    fs.existsSync(nmRoot),
    `apps/lawbar-desktop/node_modules/ missing; run \`npm run bootstrap\` first before running G-7 acceptance gates`,
  );
  const distTarballs = path.resolve(__dirname, "..", "dist-tarballs");
  const escapes = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          const real = fs.realpathSync(full);
          // rev-impl-0.1 M2 fix — use path.relative-based containment to
          // defeat prefix-string false-positives (e.g. `/x/node_modules_evil`
          // would have matched `startsWith("/x/node_modules")`).
          const insideNm = isContainedIn(real, nmRoot);
          const insideTarballs = isContainedIn(real, distTarballs);
          if (!insideNm && !insideTarballs) {
            escapes.push({ link: full, target: real });
          }
        } catch (e) {
          escapes.push({ link: full, target: `<dangling: ${e.message}>` });
        }
      } else if (entry.isDirectory()) {
        // Don't descend into nested node_modules — they're inside our scope.
        walk(full);
      }
    }
  }
  walk(nmRoot);
  assert.deepEqual(escapes, [], `symlink escapes found:\n${escapes.map((e) => `  ${e.link} -> ${e.target}`).join("\n")}`);
});

test("G-7.d — no symlinks at all under packaged Contents/Resources/", () => {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle !== null);
  const resourcesRoot = path.join(appBundle, "Contents", "Resources");
  const symlinks = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        symlinks.push(full);
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  }
  walk(resourcesRoot);
  // electron-builder COPIES rather than symlinks. Any symlink here is a
  // build defect.
  assert.deepEqual(symlinks, [], `unexpected symlinks under packaged Contents/Resources/:\n${symlinks.join("\n")}`);
});

test("G-7.e — installed case-box-persistence manifest dep on case-box-contract is non-`file:`", () => {
  const installedManifest = path.resolve(
    __dirname, "..", "node_modules", "case-box-persistence", "package.json",
  );
  // rev-impl-0.1 M3 fix — fail (not skip) if installed manifest missing.
  assert.ok(
    fs.existsSync(installedManifest),
    `apps/lawbar-desktop/node_modules/case-box-persistence/package.json missing; run \`npm run bootstrap\` first before running G-7 acceptance gates`,
  );
  const manifest = JSON.parse(fs.readFileSync(installedManifest, "utf-8"));
  const dep = (manifest.dependencies ?? {})["case-box-contract"];
  assert.ok(typeof dep === "string" && dep.length > 0, "case-box-persistence missing case-box-contract dep entry");
  assert.ok(
    !dep.startsWith("file:") && !dep.startsWith("link:") && !dep.startsWith("git+") && !dep.startsWith("portal:"),
    `installed case-box-persistence case-box-contract dep is "${dep}" — must be non-file: after staging rewrite (e.g. "0.1.0")`,
  );
});

test("G-7.f — package-lock.json contains integrity hashes for both tarball deps", () => {
  const lockfile = path.resolve(__dirname, "..", "package-lock.json");
  // rev-impl-0.1 M3 fix — fail (not skip) if lockfile missing.
  assert.ok(
    fs.existsSync(lockfile),
    `apps/lawbar-desktop/package-lock.json missing; run \`npm run bootstrap\` first before running G-7 acceptance gates`,
  );
  const lock = JSON.parse(fs.readFileSync(lockfile, "utf-8"));
  const packages = lock.packages ?? {};
  const contractEntry = packages["node_modules/case-box-contract"];
  const persistenceEntry = packages["node_modules/case-box-persistence"];
  assert.ok(contractEntry !== undefined, "package-lock.json missing node_modules/case-box-contract entry");
  assert.ok(persistenceEntry !== undefined, "package-lock.json missing node_modules/case-box-persistence entry");
  assert.match(
    contractEntry.integrity ?? "",
    /^sha512-/,
    `case-box-contract integrity must be sha512-...; got ${contractEntry.integrity}`,
  );
  assert.match(
    persistenceEntry.integrity ?? "",
    /^sha512-/,
    `case-box-persistence integrity must be sha512-...; got ${persistenceEntry.integrity}`,
  );
});
