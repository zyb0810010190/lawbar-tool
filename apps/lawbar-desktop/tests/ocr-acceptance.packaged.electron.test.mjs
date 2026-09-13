// PACKAGED ACCEPTANCE — a reading the owner produced is still there tomorrow (product plan R3, WI-12).
//
// WHAT THIS ANSWERS THAT NOTHING ELSE DOES. The handler tests prove the ladder with the helper
// faked. The unpackaged Electron tests prove the channels are wired. Both live inside ONE process
// lifetime, in a development layout, against a build that can reach the repository. None of them
// answers the only question a practising litigator actually has:
//
//     I asked the tool to read this document. Tomorrow, is what it read still there?
//
// So this drives the PACKAGED binary, twice, against ONE profile directory, through the shipped
// interface — open the matter, open the document, open the OCR section, press the button, read the
// text; quit; relaunch; look again. Session two never presses the button, and never installs the
// seed hook. If the text is on screen there, it is because the derived store was written to disk in
// the packaged layout and read back by a new process.
//
// IT ALSO PROVES THREE THINGS ONLY THE PACKAGED FORM CAN SHOW:
//   • the ladder runs from inside the bundle — the Swift helper that answers is the one in
//     Contents/Resources, resolved with the repository out of reach;
//   • the derived store lands at <userData>/ocr-derived/ocr.sqlite and NOT in the profile root,
//     where runBackup copies exactly one database by hardcoded name and would silently miss it;
//   • the case box remains the only database beside it, across a restart.
//
// AND THE CLAIM THE PANEL MAY NOT MAKE, checked against the SHIPPED strings rather than the
// catalogue source: nothing on the screen tells the owner the text has been checked or is correct.
// The measurement forbids it — 0.190 folded character error rate on his own scans, 0.31 on lines of
// six characters or fewer, which is where case numbers, dates and amounts live.
//
// PROFILE SAFETY. Everything runs in a fresh temp --user-data-dir; a refusal aborts the launch if
// the app ever resolves the real store, and a pre/post scan asserts no database appears in the repo.

// Guard #3 sentinel pair: this test must run through scripts/test-packaged-wrapper.mjs, which is
// what attributes a crash to the app rather than letting a silently dead process read as a pass.
if (process.env.LAWBAR_TEST_PID_LOG === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_TEST_PID_LOG not set; run via scripts/test-packaged-wrapper.mjs");
}
if (process.env.LAWBAR_WRAPPER_VERSION === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_WRAPPER_VERSION not set; run via scripts/test-packaged-wrapper.mjs");
}

import test from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchPackaged } from "./_launch-with-pid-log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(projectRoot, "..", "..");
const REAL_PROFILE = path.join(os.homedir(), "Library", "Application Support", "lawbar");
const releaseDirs = [path.join(projectRoot, "dist"), path.join(projectRoot, "release")];
const DB_RE = /\.sqlite(-wal|-shm)?$/;

/** The seed's fixed synthetic fixture — see src/caseBox/testSeed/ocrSeed.ts. */
const SEEDED_MATTER_NAME = "Synthetic matter — OCR acceptance";
const SEEDED_TEXT = "SYNTHETIC TEXT LAYER FOR OCR ACCEPTANCE - NOT A CLIENT DOCUMENT";

/** Phrasings a Chinese legal reader takes as certification. None may appear on this screen. */
const CERTIFYING = [
  "已核对", "已核实", "核对无误", "无误", "准确无误", "确认无误", "校验通过", "已验证", "保证准确",
  "已审校", "经人工复核", "与原件一致", "内容属实", "识别准确", "结果可信", "审核通过", "可直接使用",
  "可直接用于", "结果正确", "已确认", "人工校对", "准确", "Verified", "verified",
];

/**
 * The bundle for THIS architecture, proven to be that architecture.
 *
 * `npm run dist` emits both `release/mac` (x86_64) and `release/mac-arm64`, so "the first bundle
 * that exists" is not a safe rule: on Apple silicon the x86_64 build runs perfectly well under
 * Rosetta, and a whole acceptance suite can pass while saying nothing about the binary that ships
 * to this machine. `lipo` is asked rather than the directory name trusted.
 */
function findPackagedAppDir() {
  const wanted = os.arch() === "arm64" ? "arm64" : "x86_64";
  const subs = os.arch() === "arm64" ? ["mac-arm64"] : ["mac-x64", "mac"];
  for (const sub of subs) {
    for (const dir of releaseDirs) {
      const bundle = path.join(dir, sub, "lawbar.app");
      if (!fs.existsSync(bundle)) continue;
      const archs = spawnSync("/usr/bin/lipo", ["-archs", path.join(bundle, "Contents", "MacOS", "lawbar")], { encoding: "utf8" });
      const got = (archs.stdout ?? "").trim().split(/\s+/);
      assert.ok(got.includes(wanted),
        `${bundle} is built for ${got.join(",")}, not ${wanted}: this host would test the wrong binary`);
      return bundle;
    }
  }
  return null;
}

/**
 * Every database file under the profile, by path relative to it — so a second store hiding in a
 * subdirectory, or one named to slip past a prefix test, is visible. Checking only the profile
 * root, and exempting anything STARTING WITH "case-box.sqlite", would let `ocr-derived/cache.sqlite`
 * and `case-box.sqlite-ocr.sqlite` both through.
 */
function profileDatabases(profile) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, `${prefix}${entry}/`);
      else if (DB_RE.test(entry)) out.push(`${prefix}${entry}`);
    }
  };
  walk(profile, "");
  return out.sort();
}

/** The only databases this app may ever have in a profile. Exact names, not prefixes. */
const ALLOWED_DBS = new Set([
  "case-box.sqlite", "case-box.sqlite-wal", "case-box.sqlite-shm",
  "ocr-derived/ocr.sqlite", "ocr-derived/ocr.sqlite-wal", "ocr-derived/ocr.sqlite-shm",
]);

/** Database files anywhere under `root`, so a stray write outside the temp profile is visible. */
function dbFiles(root, depth = 0) {
  if (depth > 4 || !existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root)) {
    if (["node_modules", ".git", "release", "dist"].includes(entry)) continue;
    const p = path.join(root, entry);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) out.push(...dbFiles(p, depth + 1));
    else if (DB_RE.test(entry)) out.push(p);
  }
  return out;
}

async function launch(profile, testName, { seed = false } = {}) {
  const bundle = findPackagedAppDir();
  assert.ok(bundle !== null, `packaged .app not found under ${releaseDirs.join(" | ")}; run \`npm run dist\` first`);
  const app = await launchPackaged(
    {
      executablePath: path.join(bundle, "Contents", "MacOS", "lawbar"),
      args: [`--user-data-dir=${profile}`],
      // PATH is emptied so the helper cannot be satisfied by anything on this machine, and the
      // bundle is the only place it can come from.
      env: {
        ...process.env,
        PATH: "",
        LAWBAR_MODE: "dev",
        ...(seed ? { LAWBAR_OCR_TEST_HOOK: "true" } : {}),
      },
      timeout: 30000,
    },
    { testName },
  );
  const resolved = await app.evaluate(async ({ app: a }) => a.getPath("userData"));
  assert.notEqual(
    fs.realpathSync(resolved),
    existsSync(REAL_PROFILE) ? fs.realpathSync(REAL_PROFILE) : REAL_PROFILE,
    "REFUSING: the packaged app resolved the REAL user-data directory",
  );
  return app;
}

/**
 * Open the OCR section of the seeded document, exactly as a person does: matter list, matter,
 * documents, the document, then the section. Every step is a real click on the shipped interface;
 * none of it reaches into IPC.
 */
async function openOcrSection(win) {
  await win.waitForSelector("main#app", { timeout: 20000 });
  await win.waitForSelector("a.matter-name", { timeout: 20000 });
  await win.locator("a.matter-name", { hasText: SEEDED_MATTER_NAME }).first().click();
  await win.waitForSelector('[data-test-id="view-title"]', { timeout: 15000 });

  await win.locator('[data-test-id="view-docs-summary"]').click();
  const row = win.locator('[data-test-id="view-docs-item-summary"]').first();
  await row.waitFor({ state: "visible", timeout: 15000 });
  await row.click();

  const ocr = win.locator('[data-test-id="view-ocr-summary"]');
  await ocr.waitFor({ state: "visible", timeout: 15000 });
  await ocr.click();
  await win.locator('[data-test-id="view-ocr-caveat"]').waitFor({ state: "visible", timeout: 15000 });
}

/**
 * Everything the OCR section shows, INCLUDING its summary. The summary is a sibling of the body,
 * so scanning the body alone would miss a heading that said 「已核实的识别文字」 — the one line of
 * this panel a reader sees before deciding whether to trust the rest.
 */
const panelText = (win) => win.locator('[data-test-id="view-ocr-details"]').innerText();

test("a reading survives quitting and relaunching, in the packaged app, and never claims to be checked", async (t) => {
  const profile = mkdtempSync(path.join(tmpdir(), "lawbar-ocr-acceptance-"));
  t.after(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} });

  assert.equal(dbFiles(profile).length, 0, "the temp profile must start with no database");
  const repoBefore = dbFiles(REPO_ROOT);
  const derived = path.join(profile, "ocr-derived", "ocr.sqlite");

  // ---------- Session 1: read the document through the shipped interface ----------
  const first = await launch(profile, "ocr-acceptance-session1", { seed: true });
  try {
    let win = await first.firstWindow();
    await win.waitForSelector("main#app", { timeout: 20000 });

    // The ONLY shortcut in this file, and it creates data rather than asserting anything: a matter
    // and one born-digital PDF, written through the real persistence and storage paths. Registering
    // a document through the interface needs a native file dialog, which no test can drive.
    const seeded = await first.evaluate(async () => globalThis.__lawbarOcrSeed());
    assert.ok(seeded.documentId, "the seed must return the identity it created");
    await win.reload();
    win = await first.firstWindow();

    await openOcrSection(win);

    // Nothing has been read yet — and the section says so rather than showing an empty list.
    await win.locator('[data-test-id="view-ocr-none"]').waitFor({ state: "visible", timeout: 10000 });
    assert.equal(existsSync(path.join(profile, "ocr-derived")), false,
      "opening the section must not create the derived store, nor even its directory");
    assert.deepEqual(profileDatabases(profile).filter((f) => f.includes("ocr")), [],
      "no OCR-shaped database may exist anywhere in the profile before anything has been read");

    await win.locator('[data-test-id="view-ocr-read"]').click();

    // THE READING ITSELF, from the helper inside the bundle, with PATH empty.
    const body = win.locator('[data-test-id="view-ocr-page-text"]').first();
    await body.waitFor({ state: "visible", timeout: 60000 });
    assert.match(await body.innerText(), new RegExp(SEEDED_TEXT.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&")),
      "the packaged app did not read the document's own text layer");

    const outcome = await win.locator('[data-test-id="view-ocr-page-outcome"]').first().innerText();
    assert.match(outcome, /文本层/, "a born-digital page must be reported as read from its text layer, not recognised");
    assert.match(outcome, /未经第二引擎比对/, "no control ships, so every page must say nothing has compared it");

    // What the owner is told about the whole document.
    const status = await win.locator('[data-test-id="view-ocr-status"]').innerText();
    assert.match(status, /共 1 页/, `the summary must account for the document; got ${JSON.stringify(status)}`);
    assert.match(status, /1 页需要您对照原件核对/, "every page needs the owner's eyes, and the summary must say so");

    // THE CLAIM, checked against the SHIPPED strings rather than the catalogue source.
    const shown = await panelText(win);
    for (const word of CERTIFYING) {
      assert.equal(shown.includes(word), false, `the shipped panel claims the text is verified: ${word}`);
    }
    assert.match(shown, /不能当作原文引用/, "the caveat must be on screen with the text, not somewhere else");
  } finally {
    await first.close().catch(() => {});
  }

  // ---------- Where the reading landed, and where it did NOT ----------
  assert.ok(existsSync(derived), `the derived store must exist at ${derived} after a reading`);
  const after1 = profileDatabases(profile);
  assert.ok(after1.includes("ocr-derived/ocr.sqlite"), `the derived store is not where it must be; found ${after1.join(", ")}`);
  assert.deepEqual(after1.filter((f) => !ALLOWED_DBS.has(f)), [],
    `an unexpected database exists in the profile: ${after1.join(", ")}. runBackup copies exactly one by hardcoded name`);
  assert.deepEqual(dbFiles(REPO_ROOT), repoBefore, "a database file appeared inside the repo working tree");

  // ---------- THE WITNESS: bind session 2's screen to THIS file on disk ----------
  //
  // Session 2 showing the text again proves the text came back. It does NOT prove where from. An
  // app that silently re-ran OCR on the stored PDF, or that had stashed the result in the renderer's
  // own storage inside the shared Chromium profile, would look identical. So the row in
  // ocr-derived/ocr.sqlite is rewritten to a nonce that appears NOWHERE in the document — not in
  // its text layer, not in its bytes. If session 2 shows the nonce, the screen was fed by this
  // database, and by nothing else.
  // /usr/bin/sqlite3 rather than better-sqlite3: the app's copy is compiled for Electron's ABI and
  // will not load in this process, and node:sqlite is flagged experimental — a witness this test
  // depends on should not be a moving target. The CLI ships with macOS, which the product requires.
  const NONCE = `NONCE-${Date.now()}-A-STRING-NO-DOCUMENT-CONTAINS`;
  const sqlite = (sql) => {
    const r = spawnSync("/usr/bin/sqlite3", [derived, sql], { encoding: "utf8", timeout: 15_000 });
    assert.equal(r.status, 0, `sqlite3 failed: ${r.stderr ?? r.error}`);
    return (r.stdout ?? "").trim();
  };
  assert.equal(sqlite("SELECT count(*) FROM ocr_page;"), "1",
    "exactly one page should be stored on disk after reading a one-page document");
  assert.ok(sqlite("SELECT text FROM ocr_page;").includes(SEEDED_TEXT),
    "the row on disk does not hold what the screen showed, so the screen was not fed by this database");
  sqlite(`UPDATE ocr_page SET text = '${NONCE}';`);
  assert.equal(sqlite("SELECT text FROM ocr_page;"), NONCE, "the witness was not written");

  // ---------- Session 2: a cold start, no seed hook, no button ----------
  const second = await launch(profile, "ocr-acceptance-session2");
  try {
    const win = await second.firstWindow();
    // The hook is NOT installed this time, so nothing can re-create the fixture. If the matter and
    // its document are here, the first session's writes survived.
    const hasHook = await second.evaluate(async () => typeof globalThis.__lawbarOcrSeed === "function");
    assert.equal(hasHook, false, "session 2 must not carry the seed hook, or it could re-create what it claims survived");

    await openOcrSection(win);

    // THE ASSERTION THE WHOLE FILE EXISTS FOR. A new process, a new renderer, the same profile —
    // and the text appears WITHOUT anyone pressing the button again.
    const body = win.locator('[data-test-id="view-ocr-page-text"]').first();
    await body.waitFor({ state: "visible", timeout: 20000 });
    const shownText = await body.innerText();
    assert.match(shownText, new RegExp(NONCE),
      "the reading did not come from ocr-derived/ocr.sqlite: the screen showed something this database does not contain");
    assert.equal(shownText.includes(SEEDED_TEXT), false,
      "the document was silently re-read instead of the stored reading being shown");
    assert.equal(await win.locator('[data-test-id="view-ocr-none"]').count(), 0,
      "the section still reports the document as never read");

    // The control offers to read it AGAIN, which is only true if the store came back with pages.
    assert.match(await win.locator('[data-test-id="view-ocr-read"]').innerText(), /重新识别/);

    // And the restored screen still refuses to certify anything.
    const shown = await panelText(win);
    for (const word of CERTIFYING) {
      assert.equal(shown.includes(word), false, `after a restart the panel claims the text is verified: ${word}`);
    }
  } finally {
    await second.close().catch(() => {});
  }

  const after2 = profileDatabases(profile);
  assert.deepEqual(after2.filter((f) => !ALLOWED_DBS.has(f)), [],
    `an unexpected database exists after the restart: ${after2.join(", ")}`);
  assert.deepEqual(dbFiles(REPO_ROOT), repoBefore, "a database file appeared in the repo working tree");
});
