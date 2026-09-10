// PACKAGED ACCEPTANCE — submitter choice, and the catalogue after an ISOLATED RESTORE (WI-11).
//
// R2's exit evidence: "a new two-client matter with both-side material reaches a correct T3 after
// restart and isolated restore." WI-10 proved restart; this proves the two-client case and the
// restore, in the PACKAGED binary, through the shipped UI:
//
// Session 1 (profile A): seed a matter with TWO client parties and one registered original; create
//   one evidence item from it and adopt it; open the T3 disclosure — the model REFUSES (no single
//   client); the picker lists both clients; choose the second; the preview now carries that name;
//   export — the DOCX header carries the chosen 名称 and the table holds the one adopted row.
// Isolated restore: back profile A up with the REAL backup engine, restore the archive into a fresh
//   profile B with the REAL restore tool (the same code paths the drill uses), and launch the packaged
//   app on B.
// Session 2 (profile B): the same matter, the same choice, the same export — and the DOCX is
//   cell-for-cell the DOCX from A.
//
// The OS save dialog is substituted under the env-gated hook with one fixed path inside each
// profile; nothing else changes. Profiles are temp; the real store is never read; the repo tree is
// scanned for stray database files before and after.

if (process.env.LAWBAR_TEST_PID_LOG === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_TEST_PID_LOG not set; run via scripts/test-packaged-wrapper.mjs");
}
if (process.env.LAWBAR_WRAPPER_VERSION === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_WRAPPER_VERSION not set; run via scripts/test-packaged-wrapper.mjs");
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { launchPackaged } from "./_launch-with-pid-log.mjs";
import { extractZipEntryText } from "./_docx-unzip.mjs";
import { runBackup, isInside } from "../dist/src/backup/runBackup.js";
import { restoreFromBackup, REAL_USER_DATA } from "../scripts/restore-from-backup.mjs";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const projectRoot = path.resolve(__dirname, "..");
const releaseDirs = [path.join(projectRoot, "dist"), path.join(projectRoot, "release")];
const require_ = createRequire(import.meta.url);
const Database = require_(path.join(REPO_ROOT, "services/case-box-persistence/node_modules/better-sqlite3"));
const { openSqliteCaseBoxPersistence, CURRENT_SCHEMA_VERSION } = require_(path.join(REPO_ROOT, "services/case-box-persistence/dist/index.js"));

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
      env: { ...process.env, LAWBAR_MODE: "dev", LAWBAR_EVIDENCE_TEST_HOOK: "true" },
      timeout: 30000,
    },
    { testName },
  );
}

async function gotoMatter(win, matterId) {
  await win.waitForSelector("main#app", { timeout: 20000 });
  await win.evaluate((id) => { window.location.hash = `#/matters/${id}`; }, matterId);
  await win.waitForSelector('[data-test-id="view-t3-summary"]', { timeout: 20000 });
}

/** Choose the submitter at `partyIndex`, then export; return the DOCX's ordered <w:t> runs. */
async function chooseAndExport(win, profile, partyIndex) {
  await win.locator('[data-test-id="view-t3-summary"]').click();
  await win.waitForSelector('[data-test-id="view-t3-submitter"]', { timeout: 20000 });
  // Before the choice the model refuses, and says which refusal.
  await win.waitForSelector('[data-test-id="view-t3-refusal"]', { timeout: 20000 });
  const refusal = await win.locator('[data-test-id="view-t3-refusal"]').textContent();
  assert.ok(refusal.includes(CATALOG["viewT3.refusal.submitter_selection_required"]), `expected the selection-required refusal; got ${refusal}`);
  await win.locator('[data-test-id="view-t3-submitter"]').selectOption(String(partyIndex));
  await win.waitForSelector('[data-test-id="view-t3-header"]', { timeout: 20000 });
  const header = await win.locator('[data-test-id="view-t3-header"]').textContent();
  await win.locator('[data-test-id="view-t3-export-docx"]').click();
  await win.waitForSelector('[data-test-id="view-t3-export-written"], [data-test-id="view-t3-export-error"], [data-test-id="view-t3-export-cancelled"], [data-test-id="view-t3-refusal"]', { timeout: 20000 });
  assert.equal(await win.locator('[data-test-id="view-t3-export-written"]').count(), 1, `export must be written; status: ${await win.locator('[data-test-id="view-t3-export-status"]').textContent()}`);
  const docx = path.join(profile, "t3-export-test.docx");
  assert.ok(existsSync(docx), "the hook must have written the DOCX inside the profile");
  const xml = extractZipEntryText(readFileSync(docx), "word/document.xml");
  return { header, runs: [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]) };
}

test("packaged: a two-client matter needs a submitter choice; the chosen name reaches the DOCX; and the catalogue is identical after an isolated restore", async (t) => {
  const profileA = mkdtempSync(path.join(tmpdir(), "lawbar-t3sub-a-"));
  const archiveRoot = mkdtempSync(path.join(tmpdir(), "lawbar-t3sub-archive-"));
  const restoredParent = mkdtempSync(path.join(tmpdir(), "lawbar-t3sub-b-"));
  const profileB = path.join(restoredParent, "restored");
  t.after(() => { for (const d of [profileA, archiveRoot, restoredParent]) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });
  assert.deepEqual(persistenceFiles(profileA), []);
  const repoBefore = persistenceFiles(REPO_ROOT);

  // ---------- Session 1 on A: seed, create + adopt one item, choose, export ----------
  const first = await launch(profileA, "t3-submitter-session1");
  let seed, before;
  try {
    const win = await first.firstWindow();
    await win.waitForSelector("main#app", { timeout: 20000 });
    seed = await first.evaluate(async () => {
      const fn = globalThis.__lawbarT3SubmitterSeed;
      if (typeof fn !== "function") throw new Error("seed hook not installed — LAWBAR_EVIDENCE_TEST_HOOK not honoured");
      return fn();
    });
    assert.equal(seed.clientNames.length, 2);
    await gotoMatter(win, seed.matterId);
    // Create one evidence item from the registered original and adopt it, through the shipped UI.
    await win.locator('[data-test-id="view-evidence-summary"]').click();
    await win.waitForFunction(() => document.querySelectorAll('[data-test-id="view-evidence-add-document"] option').length === 2, null, { timeout: 20000 });
    await win.locator('[data-test-id="view-evidence-add-document"]').selectOption(seed.documentId);
    await win.locator('[data-test-id="view-evidence-add-title"]').fill("合作协议");
    await win.locator('[data-test-id="view-evidence-add-proof"]').fill("证明合作关系成立");
    await win.locator('[data-test-id="view-evidence-add-pages"]').fill("1-4");
    await win.locator('[data-test-id="view-evidence-add"]').click();
    await win.waitForSelector('[data-test-id="view-evidence-review-accepted"]', { timeout: 20000 });
    await win.locator('[data-test-id="view-evidence-review-accepted"]').click();
    await win.waitForFunction(() => document.querySelector('[data-test-id="view-evidence-row"]')?.getAttribute("data-status") === "accepted", null, { timeout: 20000 });

    before = await chooseAndExport(win, profileA, 2); // the SECOND client sits at index 2 (opposing party at 1)
    assert.ok(before.header.includes(seed.clientNames[1]), `the preview header must carry the chosen client; got ${before.header}`);
    const h = before.runs.findIndex((r) => r === "序号");
    assert.ok(h >= 0);
    assert.deepEqual(before.runs.slice(h + 4, h + 8), ["1", "合作协议", "证明合作关系成立", "1-4"]);
    assert.ok(before.runs.slice(0, h).some((r) => r.includes(seed.clientNames[1])), "the DOCX header (before the table) carries the chosen 名称");
    assert.equal(before.runs.some((r) => r.includes(seed.clientNames[0])), false, "the other client is not the submitter");
  } finally {
    await first.close().catch(() => {});
  }

  // ---------- Isolated restore: real engine, real restore tool, fresh profile B ----------
  const opened = openSqliteCaseBoxPersistence({ path: path.join(profileA, "case-box.sqlite") });
  let backup;
  try {
    backup = await runBackup({
      db: opened.db,
      documentsRoot: path.join(profileA, "case-box-documents"),
      userDataDir: profileA,
      destinationRoot: archiveRoot,
      appVersion: "0.1.0-t3-submitter-acceptance",
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }, (file) => new Database(file, { readonly: true }));
  } finally {
    opened.db.close();
  }
  assert.equal(backup.ok, true, backup.ok ? "" : `${backup.code}: ${backup.detail}`);
  const restored = await restoreFromBackup({ archiveDir: backup.dir, into: profileB });
  assert.equal(restored.documents, 1, "the one registered original must be restored");
  assert.equal(isInside(profileA, profileB), false);
  assert.equal(isInside(REAL_USER_DATA, profileB), false, "path isolation: never inside the real profile");
  assert.equal(existsSync(path.join(profileB, "t3-export-test.docx")), false, "the export is not part of the backup; B starts without one");

  // ---------- Session 2 on B: same matter, same choice, same export ----------
  const second = await launch(profileB, "t3-submitter-session2-restored");
  try {
    const win = await second.firstWindow();
    await gotoMatter(win, seed.matterId);
    const after = await chooseAndExport(win, profileB, 2);
    assert.equal(after.header, before.header, "the preview header after the restore must equal the one before");
    assert.deepEqual(after.runs, before.runs, "the DOCX after an isolated restore must be cell-for-cell the DOCX before it");
  } finally {
    await second.close().catch(() => {});
  }

  assert.deepEqual(persistenceFiles(REPO_ROOT), repoBefore, "no database file appeared in the repo tree");
});
