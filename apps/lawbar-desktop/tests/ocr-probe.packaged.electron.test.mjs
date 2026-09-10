// PACKAGED ACCEPTANCE — the bundled OCR helper is the one that answers (product plan R3, WI-12 step 2).
//
// The plan's first packaged assertion for R3: from a RELOCATED copy of the .app, launched with an
// EMPTY PATH and the repo out of reach, `window.lawbar.ocr.probe()` returns three equal digests —
// the pin packaged inside the asar, the sha256 of the executable inside THAT copy at
// Contents/Resources/helpers/lawbar-ocr, and the helper's own report — proving the helper was
// packaged, was resolved from inside the bundle, ran under main's deadline, and is the binary the
// build shipped. The relocation path contains a space and CJK, the two things a path-through-a-shell
// integration breaks on. The helper is also checked to be universal, since a thin binary packages
// and passes on the build machine and fails on the other architecture.
//
// Then the other side of the claim, inside the same packaged boundary: the copy's helper is
// replaced by a script that reports the real helper's digest. A relaunched app must refuse it as
// helper_stale WITHOUT running it — the pin catches a swapped resource before any process starts.
// Without this second session the first could pass with a main that echoed the helper's self-report.
//
// PROFILE SAFETY. Everything lives in a fresh temp --user-data-dir; the litigator's real store is
// never read. The relocated bundle lives in the same temp root and is removed with it.

if (process.env.LAWBAR_TEST_PID_LOG === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_TEST_PID_LOG not set; run via scripts/test-packaged-wrapper.mjs");
}
if (process.env.LAWBAR_WRAPPER_VERSION === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_WRAPPER_VERSION not set; run via scripts/test-packaged-wrapper.mjs");
}

import test from "node:test";
import assert from "node:assert/strict";
import fs, { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { launchPackaged } from "./_launch-with-pid-log.mjs";
import { sha256OfFile } from "../dist/src/ocr/helper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const projectRoot = path.resolve(__dirname, "..");
const releaseDirs = [path.join(projectRoot, "dist"), path.join(projectRoot, "release")];

function findPackagedAppDir() {
  const isArm64 = os.arch() === "arm64";
  const first = isArm64 ? ["mac-arm64"] : ["mac-x64", "mac"];
  const rest = isArm64 ? ["mac-x64", "mac"] : ["mac-arm64"];
  for (const sub of [...first, ...rest]) for (const dir of releaseDirs) {
    const bundle = path.join(dir, sub, "lawbar.app");
    if (fs.existsSync(bundle)) return bundle;
  }
  return null;
}

const DB_FILE_GLOBS = [/\.db$/, /\.sqlite$/, /\.sqlite3$/, /\.db-wal$/, /\.db-shm$/, /\.sqlite-wal$/, /\.sqlite-shm$/, /case-box\.db/];
function persistenceFiles(rootDir) {
  const out = [];
  (function walk(dir) {
    let entries; try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (["node_modules", "dist", "dist-tarballs", "staging", ".git", "release"].includes(entry)) continue;
      const full = path.join(dir, entry);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full); else if (DB_FILE_GLOBS.some((re) => re.test(entry))) out.push(full);
    }
  })(rootDir);
  return out.sort();
}

async function launchRelocated(bundle, profile, testName) {
  return launchPackaged(
    {
      executablePath: path.join(bundle, "Contents", "MacOS", "lawbar"),
      args: [`--user-data-dir=${profile}`],
      // PATH is EMPTY: nothing the app or the helper does may depend on finding a tool.
      env: { ...process.env, PATH: "", LAWBAR_MODE: "dev" },
      timeout: 30000,
    },
    { testName },
  );
}

/**
 * Probe through the renderer under the TEST's own clock. Main's deadline bounds the helper; this
 * bounds main. Without it a hung main would leave the evaluate pending and every assertion
 * after it unreachable — the test would hang rather than fail.
 */
async function probeThroughRenderer(app, budgetMs = 60_000) {
  const win = await app.firstWindow();
  await win.waitForSelector("main#app", { timeout: 20000 });
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`probe did not answer within ${budgetMs} ms`)), budgetMs); });
  try {
    return await Promise.race([win.evaluate(() => window.lawbar.ocr.probe()), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function withApp(bundle, profile, testName, body) {
  const app = await launchRelocated(bundle, profile, testName);
  try {
    return await body(app);
  } finally {
    await app.close().catch(() => {});
  }
}

test("packaged: probe from a relocated copy with PATH empty returns the pinned digest of the helper INSIDE that copy; a swapped helper is refused unrun after a relaunch", async (t) => {
  const built = findPackagedAppDir();
  assert.ok(built !== null, `packaged .app not found under ${releaseDirs.join(" | ")}; run npm run dist first`);

  const root = mkdtempSync(path.join(tmpdir(), "lawbar-ocr-pkg-"));
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  const profile = path.join(root, "profile");
  fs.mkdirSync(profile);
  assert.deepEqual(persistenceFiles(root), [], "fresh temp root must hold no database file");
  const repoBefore = persistenceFiles(REPO_ROOT);

  // Relocate: a directory whose name has a space and CJK, so a shell-quoted or ASCII-only path
  // resolution inside main or the helper would fail here and nowhere else.
  const relocatedDir = path.join(root, "案 卷 copy");
  fs.mkdirSync(relocatedDir);
  const copied = path.join(relocatedDir, "lawbar.app");
  const cp = spawnSync("/bin/cp", ["-R", built, copied], { encoding: "utf8" });
  assert.equal(cp.status, 0, `cp -R failed: ${cp.stderr}`);

  const helperInCopy = path.join(copied, "Contents", "Resources", "helpers", "lawbar-ocr");
  assert.ok(existsSync(helperInCopy), `the helper was not packaged at ${helperInCopy}`);
  assert.notEqual(statSync(helperInCopy).mode & 0o111, 0, "the packaged helper must be executable");
  const lipo = spawnSync("/usr/bin/lipo", ["-archs", helperInCopy], { encoding: "utf8" });
  assert.equal(lipo.status, 0, lipo.stderr);
  assert.deepEqual(lipo.stdout.trim().split(/\s+/).sort(), ["arm64", "x86_64"], "the packaged helper must be universal");
  const expected = sha256OfFile(helperInCopy);
  const inBuilt = sha256OfFile(path.join(built, "Contents", "Resources", "helpers", "lawbar-ocr"));
  assert.equal(expected, inBuilt, "the copy must carry the same helper bytes as the built bundle");
  const staged = path.join(projectRoot, "build", "helpers", "lawbar-ocr");
  if (existsSync(staged)) assert.equal(expected, sha256OfFile(staged), "the packaged helper must be the staged build");

  // ---------- Session 1: the honest bundle ----------
  const r1 = await withApp(copied, profile, "ocr-probe-pkg-session1", probeThroughRenderer);
  assert.equal(r1.ok, true, `probe failed in the packaged app: ${JSON.stringify(r1)}`);
  assert.equal(r1.value.pinned_digest, expected, "the pin inside the asar is not the helper the bundle carries");
  assert.equal(r1.value.executable_digest, expected, "main did not resolve the helper inside THIS bundle");
  assert.equal(r1.value.helper_build_digest, expected, "the binary that answered is not the one in the bundle");
  assert.ok(r1.value.vision_languages.includes("zh-Hans"), `zh-Hans missing: ${r1.value.vision_languages.join(",")}`);
  assert.equal(typeof r1.value.roundtrip_ms, "number");
  assert.equal(r1.value.roundtrip_text?.replace(/\s+/g, ""), "合同", "the round-trip must read the rendered phrase exactly");

  // ---------- Session 2: a swapped helper in the bundle, claiming the real digest ----------
  // It also leaves a marker if it ever runs. The pin must refuse it before that.
  const ran = path.join(root, "swapped-helper-ran");
  writeFileSync(helperInCopy, `#!/bin/sh\n: > "${ran}"\nprintf '{"kind":"probe","helper_build_digest":"${expected}","helper_version":"impostor","os_version":"0","os_build":"0","arch":"x","vision_languages":["zh-Hans"],"roundtrip_ms":1,"roundtrip_text":"合同"}\\n'\n`);
  chmodSync(helperInCopy, 0o755);
  assert.notEqual(sha256OfFile(helperInCopy), expected, "the swap must not accidentally be the real bytes");
  const r2 = await withApp(copied, profile, "ocr-probe-pkg-session2", probeThroughRenderer);
  assert.deepEqual(r2, { ok: false, code: "helper_stale" }, `a swapped helper was accepted: ${JSON.stringify(r2)}`);
  assert.equal(existsSync(ran), false, "the swapped helper was EXECUTED before being refused");

  assert.deepEqual(persistenceFiles(REPO_ROOT), repoBefore, "no database file may appear in the repo tree");
});
