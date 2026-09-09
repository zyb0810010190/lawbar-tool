// PACKAGED ACCEPTANCE — opening a registered original (product plan R1, WI-7).
//
// The plan requires three things proved in the PACKAGED app, not the dev build: a registered
// original opens; what is handed to the OS is a READ-ONLY COPY, never the original; and an altered
// original is refused AFTER A RESTART. This drives the packaged binary twice against one profile,
// through the real UI — expand the matter's documents, expand the row, press 打开原件, read the
// status line — with no page.evaluate into the IPC surface. The one evaluate call is the seed hook,
// which is how the fixture gets into a packaged app whose register-document path needs a native
// file dialog no test can drive.
//
// WHY THE OS IS NOT ACTUALLY ASKED TO OPEN ANYTHING. In production `reveal` is `shell.openPath`,
// which would launch Preview on whatever machine runs this test. Under the env-gated hook main
// appends the path it WOULD have opened to a log inside this test's own --user-data-dir instead.
// That path is what the "read-only copy, not the original" assertions are made against.
//
// PROFILE SAFETY. Everything lives in a fresh temp --user-data-dir. The litigator's real store is
// never read. Pre/post scans assert no database file appears in the temp root before launch or in
// the repo tree afterwards, as the smoke matrix does.

if (process.env.LAWBAR_TEST_PID_LOG === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_TEST_PID_LOG not set; run via scripts/test-packaged-wrapper.mjs");
}
if (process.env.LAWBAR_WRAPPER_VERSION === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_WRAPPER_VERSION not set; run via scripts/test-packaged-wrapper.mjs");
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync, appendFileSync, existsSync, realpathSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { launchPackaged } from "./_launch-with-pid-log.mjs";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const projectRoot = path.resolve(__dirname, "..");
const releaseDirs = [path.join(projectRoot, "dist"), path.join(projectRoot, "release")];
const sha = (b) => createHash("sha256").update(b).digest("hex");

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

async function launch(profile, testName) {
  const bundle = findPackagedAppDir();
  assert.ok(bundle !== null, `packaged .app not found under ${releaseDirs.join(" | ")}; run npm run dist first`);
  return launchPackaged(
    {
      executablePath: path.join(bundle, "Contents", "MacOS", "lawbar"),
      args: [`--user-data-dir=${profile}`],
      env: { ...process.env, LAWBAR_MODE: "dev", LAWBAR_DOCUMENT_OPEN_TEST_HOOK: "true" },
      timeout: 30000,
    },
    { testName },
  );
}

/** Navigate to the matter, expand its documents, expand the one row, press 打开原件, return the status text. */
async function pressOpenOriginal(win, matterId) {
  await win.waitForSelector("main#app", { timeout: 20000 });
  await win.evaluate((id) => { window.location.hash = `#/matters/${id}`; }, matterId);
  await win.waitForSelector('[data-test-id="view-docs-summary"]', { timeout: 20000 });
  await win.locator('[data-test-id="view-docs-summary"]').click();
  await win.waitForSelector('[data-test-id="view-docs-item-summary"]', { timeout: 20000 });
  await win.locator('[data-test-id="view-docs-item-summary"]').first().click();
  await win.waitForSelector('[data-test-id="view-docs-open"]', { timeout: 20000 });
  await win.locator('[data-test-id="view-docs-open"]').click();
  // The status line is set to 正在核验 synchronously and replaced when main answers; wait for the
  // replacement rather than reading the placeholder.
  await win.waitForFunction(
    (working) => {
      const el = document.querySelector('[data-test-id="view-docs-open-status"]');
      return el !== null && el.textContent !== "" && el.textContent !== working;
    },
    CATALOG["document.open.working"],
    { timeout: 20000 },
  );
  const status = win.locator('[data-test-id="view-docs-open-status"]');
  return { text: (await status.textContent()) ?? "", role: await status.getAttribute("role") };
}

test("packaged: a registered original opens as a READ-ONLY COPY, and an altered original is refused after a restart", async (t) => {
  const profile = mkdtempSync(path.join(tmpdir(), "lawbar-docopen-pkg-"));
  t.after(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} });
  assert.deepEqual(persistenceFiles(profile), [], "fresh temp root must hold no database file");
  const repoBefore = persistenceFiles(REPO_ROOT);

  const revealLog = path.join(profile, "document-open-reveal.log");

  // ---------- Session 1: seed, open, prove the copy ----------
  const first = await launch(profile, "document-open-pkg-session1");
  let seed;
  try {
    const win = await first.firstWindow();
    await win.waitForSelector("main#app", { timeout: 20000 });
    // The seed is the ONE evaluate: fixed fixture, no arguments, installed only under the hook.
    seed = await first.evaluate(async () => {
      const fn = globalThis.__lawbarDocumentOpenSeed;
      if (typeof fn !== "function") throw new Error("seed hook not installed — LAWBAR_DOCUMENT_OPEN_TEST_HOOK not honoured");
      return fn();
    });
    assert.ok(seed?.matterId && seed?.documentId && seed?.filename, "seed must return the identity and filename");

    const r1 = await pressOpenOriginal(win, seed.matterId);
    assert.equal(r1.role, "status", `expected success; got ${JSON.stringify(r1)}`);
    assert.equal(r1.text, CATALOG["document.open.done"]);

    // What main WOULD have handed to the OS.
    assert.ok(existsSync(revealLog), "the hook must have recorded the revealed path");
    const revealed = readFileSync(revealLog, "utf8").trim().split("\n");
    assert.equal(revealed.length, 1, "exactly one reveal");
    const copy = revealed[0];
    const original = path.join(profile, "case-box-documents", seed.documentId, seed.filename);
    assert.ok(existsSync(original), "the seeded original must be in the store where production puts it");
    // realpath on BOTH sides: tmpdir() answers /var/folders/… while the app resolves the same
    // directory to /private/var/folders/…, so a plain path comparison here could never be equal
    // and the assertion could never fire. It was found that way — the mutant that reveals the
    // original tripped the lawbar-open-* check below instead of this one.
    assert.notEqual(realpathSync(copy), realpathSync(original), "THE ORIGINAL WAS HANDED OVER — the copy contract is broken");
    assert.ok(path.basename(path.dirname(copy)).startsWith("lawbar-open-"), `the copy must live in a lawbar-open-* temp dir, got ${copy}`);
    const mode = statSync(copy).mode & 0o777;
    assert.equal(mode & 0o222, 0, `the copy must not be writable; mode ${mode.toString(8)}`);
    assert.equal(sha(readFileSync(copy)), sha(readFileSync(original)), "the copy must be byte-identical to the original");
    assert.equal(sha(readFileSync(original)), seed.contentHash, "and the original must be exactly what was registered");
  } finally {
    await first.close().catch(() => {});
  }

  // ---------- Between sessions: alter the ORIGINAL in the store ----------
  const original = path.join(profile, "case-box-documents", seed.documentId, seed.filename);
  appendFileSync(original, Buffer.from("\ntampered after registration"));
  assert.notEqual(sha(readFileSync(original)), seed.contentHash, "precondition: the original now differs");

  // ---------- Session 2: relaunch on the SAME profile, no re-seed ----------
  const second = await launch(profile, "document-open-pkg-session2");
  try {
    const win = await second.firstWindow();
    const r2 = await pressOpenOriginal(win, seed.matterId);
    assert.equal(r2.role, "alert", `expected a refusal; got ${JSON.stringify(r2)}`);
    assert.equal(r2.text, CATALOG["document.open.failed.altered"],
      "an altered original must be refused as ALTERED after a restart, with the finding copy");
    const revealedAfter = readFileSync(revealLog, "utf8").trim().split("\n");
    assert.equal(revealedAfter.length, 1, "nothing was handed to the OS for an altered original");
  } finally {
    await second.close().catch(() => {});
  }

  // ---------- Invariants ----------
  assert.deepEqual(persistenceFiles(REPO_ROOT), repoBefore, "no database file appeared in the repo tree");
});
