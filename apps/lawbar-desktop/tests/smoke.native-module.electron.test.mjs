// Native-module rebuild smoke test (Packaging Smoke WI-B per
// dev-memo/plan-packaging-smoke-wib-00.md §1.4).
//
// Spawns the packaged binary with --probe-case-box flag. Asserts:
//   1. Packaged .app exists and the unpacked native binary
//      (better_sqlite3.node) is present in app.asar.unpacked.
//   2. Probe child process prints PROBE_OK on stdout and exits 0
//      within the 10s timeout.
//   3. Probe does NOT print PROBE_FAIL.
//
// MUST run AFTER `npm run dist` (build path includes
// asarUnpack: better-sqlite3 + postinstall electron-builder
// install-app-deps for the Electron Node ABI rebuild). The
// test does NOT trigger the build itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  const isArm64 = os.arch() === "arm64";
  const hostArchSubdirs = isArm64 ? ["mac-arm64"] : ["mac-x64", "mac"];
  const otherArchSubdirs = isArm64 ? ["mac-x64", "mac"] : ["mac-arm64"];
  const ordered = [];
  for (const sub of hostArchSubdirs) {
    for (const dir of releaseDirs) ordered.push(path.join(dir, sub));
  }
  for (const sub of otherArchSubdirs) {
    for (const dir of releaseDirs) ordered.push(path.join(dir, sub));
  }
  for (const appDir of ordered) {
    const appBundle = path.join(appDir, "lawbar.app");
    if (fs.existsSync(appBundle)) return appBundle;
  }
  return null;
}

test("packaged .app tree contains the rebuilt better_sqlite3.node", () => {
  const appBundle = findPackagedAppDir();
  assert.ok(
    appBundle !== null,
    `expected lawbar.app under ${releaseDirs.join(" | ")}; run \`npm run dist\` first`,
  );

  // Per dev-memo/plan-packaging-smoke-wib-00.md §1.1 acceptance step.
  // WI-B impl (Option A) uses asar: true + asarUnpack of better-sqlite3.
  // The unpacked native binary lives at
  //   Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node
  // (asar: false layout retained in the candidate list for resilience
  // if a future config flips back).
  const candidates = [
    path.join(appBundle, "Contents", "Resources", "app.asar.unpacked", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
    path.join(appBundle, "Contents", "Resources", "app", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  assert.ok(
    found !== undefined,
    `better_sqlite3.node not found under packaged app; probed:\n  ${candidates.join("\n  ")}`,
  );
});

test("packaged .app --probe-case-box: better-sqlite3 loads + CREATE/INSERT/SELECT round-trip succeeds", { timeout: 15_000 }, async () => {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle !== null, "packaged .app missing");
  const binary = path.join(appBundle, "Contents", "MacOS", "lawbar");
  assert.ok(fs.existsSync(binary), `packaged binary missing at ${binary}`);

  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, ["--probe-case-box"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));

    // Defensive timeout — outer test timeout is 15s; kill the child
    // at 10s so we still see captured stdout/stderr in the assertion
    // message instead of an opaque test-runner timeout.
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 10_000);
  });

  assert.equal(
    result.code,
    0,
    `probe exited with code=${result.code} signal=${result.signal}\nstdout=${result.stdout}\nstderr=${result.stderr}`,
  );
  assert.match(
    result.stdout,
    /^PROBE_OK/m,
    `probe stdout missing PROBE_OK; got:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.doesNotMatch(
    result.stdout,
    /PROBE_FAIL/,
    `probe stdout contains PROBE_FAIL; got:\n${result.stdout}`,
  );
});
