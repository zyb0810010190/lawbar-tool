// PACKAGED ACCEPTANCE — R2 evidence entry (product plan R2, WI-10).
//
// R2's exit evidence: "a new two-client matter with both-side material reaches a correct T3 after
// restart ... Unadopted evidence is absent." This drives the PACKAGED binary twice on one profile,
// through the shipped UI, and then reads CELL TEXT out of the exported DOCX. A round-trip-only
// assertion would prove persistence and be mistaken for proof of usefulness; the DOCX rows are
// the thing a lawyer files, so they are what is asserted.
//
// Session 1: seed a two-party matter with three registered originals (the one evaluate call);
//   create evidence from each document through the Evidence disclosure (our side, opposing side,
//   and one more); ADOPT the first two, EXCLUDE the third.
// Session 2 (same profile, no re-seed): the rows survive the restart with their statuses; export
//   the T3 catalogue; the DOCX table holds exactly the two adopted rows in order with the typed
//   证据名称 / 证明内容 / 页码, and the excluded title appears nowhere in the document.
//
// WHY THE OS SAVE DIALOG IS NOT SHOWN: under the env-gated hook main writes the export to one
// fixed path inside this test's own --user-data-dir. Nothing else changes: the same handler, the
// same packer, the same bytes.
//
// PROFILE SAFETY: a fresh temp --user-data-dir; the litigator's real store is never read; the
// repo tree is scanned before and after for stray database files.

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
import { fileURLToPath } from "node:url";

import { launchPackaged } from "./_launch-with-pid-log.mjs";
import { extractZipEntryText } from "./_docx-unzip.mjs";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";

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

async function openEvidence(win, matterId) {
  await win.waitForSelector("main#app", { timeout: 20000 });
  await win.evaluate((id) => { window.location.hash = `#/matters/${id}`; }, matterId);
  await win.waitForSelector('[data-test-id="view-evidence-summary"]', { timeout: 20000 });
  await win.locator('[data-test-id="view-evidence-summary"]').click();
  await win.waitForSelector('[data-test-id="view-evidence-add-control"]', { timeout: 20000 });
  // The document choices arrive with the first open; wait for all three.
  await win.waitForFunction(() => document.querySelectorAll('[data-test-id="view-evidence-add-document"] option').length === 4, null, { timeout: 20000 });
}

async function addEvidence(win, { documentId, title, proof, pages, side }) {
  await win.locator('[data-test-id="view-evidence-add-document"]').selectOption(documentId);
  await win.locator('[data-test-id="view-evidence-add-title"]').fill(title);
  await win.locator('[data-test-id="view-evidence-add-proof"]').fill(proof);
  await win.locator('[data-test-id="view-evidence-add-pages"]').fill(pages);
  await win.locator('[data-test-id="view-evidence-add-side"]').selectOption(side);
  await win.locator('[data-test-id="view-evidence-add"]').click();
  await win.waitForFunction(
    (added) => document.querySelector('[data-test-id="view-evidence-add-status"]')?.textContent === added,
    CATALOG["evidence.added"],
    { timeout: 20000 },
  );
}

/** Rows as [{title, status}] in DOM order. */
async function readRows(win) {
  return win.evaluate(() =>
    [...document.querySelectorAll('[data-test-id="view-evidence-row"]')].map((r) => ({
      title: r.querySelector('[data-test-id="view-evidence-title"]')?.textContent ?? "",
      status: r.getAttribute("data-status"),
    })),
  );
}

async function review(win, title, action) {
  const row = win.locator('[data-test-id="view-evidence-row"]', { has: win.locator(`[data-test-id="view-evidence-title"]:text-is("${title}")`) });
  await row.locator(`[data-test-id="view-evidence-review-${action}"]`).click();
  await win.waitForFunction(
    ([t, s]) => [...document.querySelectorAll('[data-test-id="view-evidence-row"]')].some((r) => r.querySelector('[data-test-id="view-evidence-title"]')?.textContent === t && r.getAttribute("data-status") === s),
    [title, action],
    { timeout: 20000 },
  );
}

const A = { title: "劳动合同", proof: "证明双方存在劳动关系", pages: "1-5", side: "our" };
const B = { title: "对方付款凭证", proof: "证明对方已部分履行", pages: "6-7", side: "opposing" };
const C = { title: "无关信函", proof: "与本案无关", pages: "8", side: "our" };

test("packaged: evidence created from registered originals, adopted/excluded through the UI, survives a restart, and the exported T3 DOCX holds exactly the adopted rows", async (t) => {
  const profile = mkdtempSync(path.join(tmpdir(), "lawbar-evidence-pkg-"));
  t.after(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} });
  assert.deepEqual(persistenceFiles(profile), [], "fresh temp root must hold no database file");
  const repoBefore = persistenceFiles(REPO_ROOT);

  // ---------- Session 1: seed, create, adopt, exclude ----------
  const first = await launch(profile, "evidence-pkg-session1");
  let seed;
  try {
    const win = await first.firstWindow();
    await win.waitForSelector("main#app", { timeout: 20000 });
    seed = await first.evaluate(async () => {
      const fn = globalThis.__lawbarEvidenceSeed;
      if (typeof fn !== "function") throw new Error("seed hook not installed — LAWBAR_EVIDENCE_TEST_HOOK not honoured");
      return fn();
    });
    assert.equal(seed.documents.length, 3);
    await openEvidence(win, seed.matterId);
    assert.deepEqual(await readRows(win), [], "no evidence before the lawyer creates any");
    await addEvidence(win, { documentId: seed.documents[0].id, ...A });
    await addEvidence(win, { documentId: seed.documents[1].id, ...B });
    await addEvidence(win, { documentId: seed.documents[2].id, ...C });
    assert.deepEqual((await readRows(win)).map((r) => r.status), ["proposed", "proposed", "proposed"]);
    await review(win, A.title, "accepted");
    await review(win, B.title, "accepted");
    await review(win, C.title, "rejected");
    assert.deepEqual(await readRows(win), [
      { title: A.title, status: "accepted" }, { title: B.title, status: "accepted" }, { title: C.title, status: "rejected" },
    ]);
  } finally {
    await first.close().catch(() => {});
  }

  // ---------- Session 2: relaunch on the SAME profile, no re-seed; export ----------
  const second = await launch(profile, "evidence-pkg-session2");
  try {
    const win = await second.firstWindow();
    await openEvidence(win, seed.matterId);
    assert.deepEqual(await readRows(win), [
      { title: A.title, status: "accepted" }, { title: B.title, status: "accepted" }, { title: C.title, status: "rejected" },
    ], "statuses must survive the restart exactly");

    await win.locator('[data-test-id="view-t3-summary"]').click();
    await win.waitForSelector('[data-test-id="view-t3-export-docx"]', { timeout: 20000 });
    await win.locator('[data-test-id="view-t3-export-docx"]').click();
    await win.waitForSelector('[data-test-id="view-t3-export-written"], [data-test-id="view-t3-export-error"], [data-test-id="view-t3-export-cancelled"]', { timeout: 20000 });
    const written = await win.locator('[data-test-id="view-t3-export-written"]').count();
    assert.equal(written, 1, `the export must be written; screen shows: ${await win.locator('[data-test-id="view-t3-export-status"]').textContent()}`);

    const docx = path.join(profile, "t3-export-test.docx");
    assert.ok(existsSync(docx), "the hook must have written the DOCX inside the test profile");
    const xml = extractZipEntryText(readFileSync(docx), "word/document.xml");
    const runs = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
    // The table, in row order, after the four headers.
    const headerAt = runs.findIndex((r) => r === "序号");
    assert.ok(headerAt >= 0, "the 序号 header must be present");
    assert.deepEqual(runs.slice(headerAt, headerAt + 4), ["序号", "证据名称", "证明内容", "页码"]);
    const body = runs.slice(headerAt + 4);
    assert.deepEqual(body.slice(0, 8), ["1", A.title, A.proof, A.pages, "2", B.title, B.proof, B.pages],
      "exactly the two ADOPTED rows, in order, with the typed name / proof / pages");
    assert.equal(body.length, 8, `no further rows expected; got ${JSON.stringify(body)}`);
    assert.equal(xml.includes(C.title), false, "the EXCLUDED item must be absent from the catalogue");
    assert.equal(xml.includes(C.proof), false);
  } finally {
    await second.close().catch(() => {});
  }

  assert.deepEqual(persistenceFiles(REPO_ROOT), repoBefore, "no database file appeared in the repo tree");
});
