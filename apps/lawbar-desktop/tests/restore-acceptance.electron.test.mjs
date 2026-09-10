// Guard #3 sentinel pair (WI-2): must be present so the wrapper recognizes
// the test as opted-in to wrapper-driven runs.
if (process.env.LAWBAR_TEST_PID_LOG === undefined) {
  throw new Error(
    "HARNESS FAILURE — LAWBAR_TEST_PID_LOG not set; run via scripts/test-packaged-wrapper.mjs",
  );
}
if (process.env.LAWBAR_WRAPPER_VERSION === undefined) {
  throw new Error(
    "HARNESS FAILURE — LAWBAR_WRAPPER_VERSION not set; run via scripts/test-packaged-wrapper.mjs",
  );
}

// Restore acceptance, through the PACKAGED APPLICATION.
//
// WHAT THIS ADDS OVER backup-restore-current-format.test.mjs. That drill restores an archive and
// then inspects the result with the same libraries that produced it, in the same process. Useful,
// and it cannot answer the question an owner actually has: if I restore this, will the app I
// installed open it? A restored profile that satisfies a Node test and that the packaged binary
// refuses to load — a schema the shipped build does not know, a native ABI mismatch, a path the
// packaged app resolves differently — would pass there and fail here.
//
// So this launches the .app built from THIS source, points it at the restored profile with
// `--user-data-dir`, and reads the case box back through the real IPC channels the renderer uses:
// list the matters, list each matter's documents, and run the full audit-chain verification.
//
// NO USER-FACING RESTORE EXISTS. The restore itself runs through
// `scripts/restore-from-backup.mjs`, a controlled entry point. This test proves the archive is
// restorable and that the shipped app reads the result; it does not claim an owner can perform
// this from the UI.
//
// ISOLATED PROFILES ONLY. Three temp directories — source profile, archive, restored profile —
// all created here under os.tmpdir(). The launch asserts the app resolved the restored profile
// and REFUSES if it ever resolves the real one.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync, readdirSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { launchPackaged } from "./_launch-with-pid-log.mjs";
import { runBackup, isInside } from "../dist/src/backup/runBackup.js";
import { storeDocumentFile } from "../dist/src/caseBox/documentStorage.js";
import { restoreFromBackup, REAL_USER_DATA } from "../scripts/restore-from-backup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const REPO = path.resolve(__dirname, "..", "..", "..");
const require_ = createRequire(import.meta.url);

const Database = require_(path.join(REPO, "services/case-box-persistence/node_modules/better-sqlite3"));
const { openSqliteCaseBoxPersistence, CURRENT_SCHEMA_VERSION } = require_(
  path.join(REPO, "services/case-box-persistence/dist/index.js"),
);
const { makeMatterInput, makeDocumentInput, makeIdGenerator } = await import(
  path.join(REPO, "services/case-box-persistence/tests/conformance/fixtures.mjs")
);

const releaseDirs = [path.join(projectRoot, "dist"), path.join(projectRoot, "release")];

function findPackagedAppDir() {
  const isArm64 = os.arch() === "arm64";
  const order = isArm64 ? ["mac-arm64", "mac-x64", "mac"] : ["mac-x64", "mac", "mac-arm64"];
  for (const sub of order) {
    for (const dir of releaseDirs) {
      const appBundle = path.join(dir, sub, "lawbar.app");
      if (fs.existsSync(appBundle)) return appBundle;
    }
  }
  return null;
}

function tempRoot(label) {
  const d = mkdtempSync(path.join(tmpdir(), `lawbar-restore-acc-${label}-`));
  assert.equal(isInside(REPO, d), false, "temp root must not be inside the repo tree");
  assert.equal(isInside(path.join(os.homedir(), "Library"), d), false,
    "temp root must not be anywhere under ~/Library");
  return d;
}

/**
 * The tenant the DESKTOP APP scopes every read to (`src/security/activeTenant.ts`).
 *
 * The shared persistence fixtures default to `tenant-local-v1`, which is fine everywhere those
 * fixtures are read back by the persistence API directly. Here the reader is the packaged app's
 * IPC layer, and it filters by its own active tenant — so a profile seeded with the fixture
 * default restores perfectly and then lists ZERO matters, which looks exactly like a broken
 * restore. Measured, on the first run of this test. The mismatch is the test's to fix, not the
 * app's: tenant scoping on every read is the behaviour the boundary is supposed to have.
 */
const APP_TENANT_ID = "default-tenant";

/** A synthetic source profile with a real audit chain and real stored exhibits. */
async function makeSourceProfile() {
  const userDataDir = tempRoot("source");
  const docsRoot = path.join(userDataDir, "case-box-documents");
  mkdirSync(docsRoot, { recursive: true });
  const ids = makeIdGenerator("pkgrest");
  const opened = openSqliteCaseBoxPersistence({
    path: path.join(userDataDir, "case-box.sqlite"), generateId: ids,
  });

  const matters = [];
  const documents = [];
  for (const [i, name] of ["SYNTHETIC PACKAGED ONE", "SYNTHETIC PACKAGED TWO"].entries()) {
    const matter = makeMatterInput({ id: ids(), name, tenant_id: APP_TENANT_ID });
    await opened.persistence.createMatter(matter);
    matters.push(matter);

    const documentId = ids();
    const src = path.join(userDataDir, `${documentId}-in.txt`);
    writeFileSync(src, `SYNTHETIC PACKAGED EXHIBIT ${i}`);
    const stored = await storeDocumentFile({
      sourcePath: src, storageRoot: docsRoot, documentId, filename: "exhibit.txt",
    });
    rmSync(src);
    await opened.persistence.registerDocument(matter.id, makeDocumentInput({
      id: documentId, matter_id: matter.id, tenant_id: APP_TENANT_ID,
      filename: stored.stored_filename, content_hash: stored.content_hash,
      storage_uri: stored.storage_uri, byte_size: stored.byte_size,
    }));
    documents.push({
      id: documentId, matterId: matter.id, content_hash: stored.content_hash,
      relativePath: path.join(documentId, stored.stored_filename),
    });
  }
  opened.db.close();
  return { userDataDir, docsRoot, matters, documents };
}

/** Re-open the source read-only just for the backup, so the profile on disk is settled first. */
async function backupSource(source, destRoot) {
  const opened = openSqliteCaseBoxPersistence({
    path: path.join(source.userDataDir, "case-box.sqlite"),
  });
  try {
    return await runBackup({
      db: opened.db,
      documentsRoot: source.docsRoot,
      userDataDir: source.userDataDir,
      destinationRoot: destRoot,
      appVersion: "0.1.0-restore-acceptance",
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }, (file) => new Database(file, { readonly: true }));
  } finally {
    opened.db.close();
  }
}

async function waitForCaseBoxSurface(win) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await win.evaluate(() =>
      typeof window.lawbar?.caseBox?.listMatters === "function" &&
      typeof window.lawbar?.caseBox?.listDocuments === "function" &&
      typeof window.lawbar?.caseBox?.verifyChain === "function",
    );
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test("the packaged app opens a RESTORED profile and verifies its chains and documents", async (t) => {
  const appBundle = findPackagedAppDir();
  assert.ok(
    appBundle !== null,
    `packaged .app not found under ${releaseDirs.join(" | ")}; run \`npm run dist\` first. ` +
      "This is a HARNESS failure, not a skip: a restore acceptance that quietly passes when there " +
      "is no build to test is the exact shape of a test that cannot fail.",
  );

  const source = await makeSourceProfile();
  const destRoot = tempRoot("archive");
  const restoredParent = tempRoot("restored");
  const restored = path.join(restoredParent, "profile");
  t.after(() => {
    rmSync(source.userDataDir, { recursive: true, force: true });
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(restoredParent, { recursive: true, force: true });
  });

  // 1. Back up, in the format the app itself writes.
  const backup = await backupSource(source, destRoot);
  assert.equal(backup.ok, true, backup.ok ? "" : `${backup.code}: ${backup.detail}`);

  // 2. Restore into a fresh, separate profile.
  const result = await restoreFromBackup({ archiveDir: backup.dir, into: restored });
  assert.equal(result.documents, source.documents.length);
  assert.equal(isInside(source.userDataDir, restored), false, "path isolation: not inside the source");
  assert.equal(isInside(REAL_USER_DATA, restored), false, "path isolation: not inside the real profile");

  // 3. Launch THE PACKAGED APP against that profile.
  const executablePath = path.join(appBundle, "Contents", "MacOS", "lawbar");
  const app = await launchPackaged(
    {
      executablePath,
      args: [`--user-data-dir=${restored}`],
      env: { ...process.env, LAWBAR_MODE: "dev" },
      timeout: 30_000,
    },
    { testName: "restore-acceptance-packaged" },
  );
  t.after(async () => { await app.close().catch(() => {}); });

  const resolved = await app.evaluate(async ({ app: a }) => a.getPath("userData"));
  assert.equal(realpathSync(resolved), realpathSync(restored), "the app ignored --user-data-dir");
  assert.notEqual(
    realpathSync(resolved),
    existsSync(REAL_USER_DATA) ? realpathSync(REAL_USER_DATA) : REAL_USER_DATA,
    "REFUSING: the app resolved the REAL user-data directory.",
  );

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  assert.equal(await waitForCaseBoxSurface(win), true,
    "the case-box IPC surface never appeared; the restored profile may not have opened");

  // 4. Read the restored case box back through the REAL IPC channels.
  const listed = await win.evaluate(() => window.lawbar.caseBox.listMatters({}));
  assert.equal(listed.ok, true, JSON.stringify(listed));
  const restoredIds = listed.value.rows.map((r) => r.id).sort();
  assert.deepEqual(restoredIds, source.matters.map((m) => m.id).sort(),
    "the packaged app does not see the matters that were restored");

  for (const matter of source.matters) {
    // The full audit-chain verification, run by the shipped build against restored bytes.
    const verified = await win.evaluate(
      (id) => window.lawbar.caseBox.verifyChain({ matterId: id }), matter.id);
    assert.equal(verified.ok, true, `verifyChain IPC failed for ${matter.id}: ${JSON.stringify(verified)}`);
    assert.equal(verified.value.ok, true,
      `the restored audit chain for ${matter.id} does not verify in the packaged app: ` +
      JSON.stringify(verified.value));

    const docs = await win.evaluate(
      (id) => window.lawbar.caseBox.listDocuments({ matterId: id }), matter.id);
    assert.equal(docs.ok, true, JSON.stringify(docs));
    const expected = source.documents.filter((d) => d.matterId === matter.id);
    assert.equal(docs.value.rows.length, expected.length,
      `the packaged app sees ${docs.value.rows.length} document(s) for ${matter.id}, expected ${expected.length}`);
    assert.deepEqual(docs.value.rows.map((r) => r.id).sort(), expected.map((d) => d.id).sort());
  }

  // 5. And the exhibit BYTES really are on disk under the restored profile, at the paths the
  //    restored records point at — the app listing a document row proves the row survived, not
  //    the file.
  const { createHash } = await import("node:crypto");
  for (const d of source.documents) {
    const file = path.join(restored, "case-box-documents", d.relativePath);
    assert.ok(existsSync(file), `${d.relativePath} is not in the restored profile`);
    const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(digest, d.content_hash, `${d.relativePath} restored with different bytes`);
  }
});

// ---------------------------------------------------------------------------
// The backup button itself, in the shipped build
// ---------------------------------------------------------------------------
//
// WHY THIS BELONGS HERE. Everything else that exercises the new verification runs under plain
// `node`, against `node_modules/` on a real filesystem, calling `runBackup` directly. None of it
// can fail if the SHIPPED app cannot perform a backup — and the change deliberately added a
// SUBPATH import (`case-box-persistence/archive-verify`), resolved through an `exports` map, from
// inside an asar archive, by Electron's ESM loader. That import is static all the way up to
// `electron/main.ts`, so a resolution failure does not degrade gracefully; the app does not start.
//
// The destination chooser is the one thing a test cannot click, and it is also the only thing in
// the way. `dialog` is part of the handle Playwright hands to `app.evaluate`, so replacing
// `showOpenDialog` in the main process supplies a destination and leaves every other step —
// channel, handler, engine, verifier, record — exactly as an owner would run it.

/** Seed a profile directory with a real chain, optionally tampering with it afterwards. */
async function seedProfile(label, { tamper = false } = {}) {
  const dir = tempRoot(label);
  mkdirSync(path.join(dir, "case-box-documents"), { recursive: true });
  const ids = makeIdGenerator(`seed${label.slice(0, 3)}`);
  const opened = openSqliteCaseBoxPersistence({
    path: path.join(dir, "case-box.sqlite"), generateId: ids,
  });
  const matter = makeMatterInput({
    id: ids(), name: "SYNTHETIC PACKAGED BACKUP", tenant_id: APP_TENANT_ID,
  });
  await opened.persistence.createMatter(matter);
  assert.equal((await opened.persistence.verifyAuditChainForMatter(matter.id)).ok, true,
    "the seeded chain must be legitimate before anything is done to it");

  if (tamper) {
    const row = opened.db
      .prepare("SELECT event_id, event_json FROM case_box_audit_events ORDER BY sequence LIMIT 1").get();
    const event = JSON.parse(row.event_json);
    event.actor_user_id = "SYNTHETIC-TAMPER";
    opened.db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?")
      .run(JSON.stringify(event), row.event_id);
    assert.equal((await opened.persistence.verifyAuditChainForMatter(matter.id)).ok, false,
      "precondition: the tamper must actually break the chain");
  }
  opened.db.close();
  return { dir, matterId: matter.id };
}

/** Launch the packaged app on `profile`, with the destination chooser answering `destination`. */
async function launchWithChooser(t, profile, destination) {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle !== null, `packaged .app not found under ${releaseDirs.join(" | ")}`);
  const app = await launchPackaged(
    {
      executablePath: path.join(appBundle, "Contents", "MacOS", "lawbar"),
      args: [`--user-data-dir=${profile}`],
      env: { ...process.env, LAWBAR_MODE: "dev" },
      timeout: 30_000,
    },
    { testName: "packaged-backup-run" },
  );
  t.after(async () => { await app.close().catch(() => {}); });

  const resolved = await app.evaluate(async ({ app: a }) => a.getPath("userData"));
  assert.equal(realpathSync(resolved), realpathSync(profile), "the app ignored --user-data-dir");
  assert.notEqual(
    realpathSync(resolved),
    existsSync(REAL_USER_DATA) ? realpathSync(REAL_USER_DATA) : REAL_USER_DATA,
    "REFUSING: the app resolved the REAL user-data directory.",
  );

  // Answer the native chooser with a directory this test owns. Nothing else is replaced.
  await app.evaluate(({ dialog }, dest) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dest] });
  }, destination);

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await win.evaluate(() =>
      typeof window.lawbar?.backup?.run === "function" &&
      typeof window.lawbar?.backup?.status === "function");
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const ready = await win.evaluate(() => typeof window.lawbar?.backup?.run === "function");
  assert.equal(ready, true, "window.lawbar.backup never appeared in the packaged app");
  return { app, win };
}

// ---------------------------------------------------------------------------
// The backup BUTTON, in the shipped build
// ---------------------------------------------------------------------------
//
// WHAT CHANGED HERE, AND WHY IT MATTERS. These cases used to call
// `win.evaluate(() => window.lawbar.backup.run())`. That does traverse the real preload, the real
// IPC channel and the real handler — but it is not the button, and the first delivery report
// described it as one. An external review caught the overstatement on 2026-09-06.
//
// The gap is not hypothetical. Everything between the click and the bridge call is exactly what
// `evaluate` skips: the screen rendering at all, the listener being attached, the button being
// re-enabled after the promise settles, the result paragraph carrying the right role, and — most
// of all — the STATUS LINE, which is the sentence that tells a litigator whether they are
// protected. A handler that refuses correctly while the page still says "last verified: today"
// is a product that lies, and no amount of bridge-level testing sees it.
//
// So these navigate the app, click, and read the DOM. The one thing replaced is the native
// directory chooser, which cannot be driven from a test.

const CATALOG = (await import(
  pathToFileURL(path.join(projectRoot, "dist/renderer/i18n/catalog.js")).href
)).CATALOG;

/** Open the backup screen the way an owner does — through the sidebar, not a hash assignment. */
async function openBackupScreen(win) {
  const link = win.locator('.sidebar-link[data-nav="backup"]');
  await link.waitFor({ timeout: 15_000 });
  await link.click();
  await win.waitForSelector('[data-test-id="backup-title"]', { timeout: 15_000 });
}

/** Click the button and wait for the run to settle into a result. */
async function clickBackupAndWait(win) {
  const button = win.locator('[data-test-id="backup-run"]');
  assert.equal(await button.isEnabled(), true, "the backup button is not enabled");
  await button.click();
  // The result paragraph replaces the "running" one; waiting for it is waiting for the settle.
  await win.locator('[data-test-id="backup-result"]').waitFor({ timeout: 60_000 });
  return button;
}

test("PACKAGED + BUTTON: a healthy case box backs up, and the page says so", async (t) => {
  const { dir: profile } = await seedProfile("good");
  const destination = tempRoot("gooddest");
  t.after(() => {
    rmSync(profile, { recursive: true, force: true });
    rmSync(destination, { recursive: true, force: true });
  });

  const { win } = await launchWithChooser(t, profile, destination);
  await openBackupScreen(win);

  // Before: the page carries the never-backed-up ALERT, not a neutral empty state.
  const never = win.locator('[data-test-id="backup-never"]');
  await never.waitFor({ timeout: 10_000 });
  assert.equal(await never.getAttribute("role"), "alert");

  const button = await clickBackupAndWait(win);

  const result = win.locator('[data-test-id="backup-result"]');
  assert.equal(await result.innerText(), CATALOG["backup.verified"],
    "the page did not report a verified backup");
  assert.equal(await result.getAttribute("role"), "status",
    "a success must be a status, not an alert");
  assert.equal(await button.isEnabled(), true,
    "the button was left disabled; a second backup would be impossible without a reload");
  assert.equal(await win.locator('[data-test-id="backup-running"]').count(), 0,
    "the running message was never replaced");

  // The status line must have REPAINTED to a success. This is the sentence the owner reads.
  assert.equal(await never.count(), 0, "the page still says no backup has ever been verified");
  const status = win.locator('[data-test-id="backup-status"]');
  assert.equal(await status.count(), 1);
  assert.equal(await status.innerText(), CATALOG["backup.status.today"],
    "the status line did not update to today's verified backup");

  // And the archive on disk is the current format, carrying a manifest — the engine's own signal
  // that verification passed.
  const archives = readdirSync(destination).filter((d) => d.startsWith("lawbar-backup-"));
  assert.equal(archives.length, 1, `expected one archive, found ${archives.length}`);
  const archive = path.join(destination, archives[0]);
  assert.deepEqual(readdirSync(archive).filter((f) => !f.startsWith("._")).sort(),
    ["case-box-documents", "case-box.sqlite", "manifest.json"]);
  const manifest = JSON.parse(fs.readFileSync(path.join(archive, "manifest.json"), "utf8"));
  assert.equal(manifest.chainHeads.length, 1, "the manifest must bind the seeded matter's head");
});

test("PACKAGED + BUTTON: a tampered case box is refused, and the page keeps saying UNPROTECTED",
  async (t) => {
    // The whole point of the preceding work, asserted where it has to hold: the shipped build,
    // the owner's button, the owner's sentence. Before that work this same input produced a
    // success message and a recorded timestamp.
    const { dir: profile } = await seedProfile("bad", { tamper: true });
    const destination = tempRoot("baddest");
    t.after(() => {
      rmSync(profile, { recursive: true, force: true });
      rmSync(destination, { recursive: true, force: true });
    });

    const { win } = await launchWithChooser(t, profile, destination);
    await openBackupScreen(win);
    const button = await clickBackupAndWait(win);

    const result = win.locator('[data-test-id="backup-result"]');
    assert.equal(await result.innerText(), CATALOG["backup.failed.verification"],
      "the page did not report a verification failure");
    assert.equal(await result.getAttribute("role"), "alert",
      "a failed backup must be an alert; a status is read as reassurance");
    assert.equal(await button.isEnabled(), true, "the owner cannot retry: the button stayed disabled");

    // THE SENTENCE THAT MATTERS. A refused run must leave the never-backed-up alert standing.
    const never = win.locator('[data-test-id="backup-never"]');
    assert.equal(await never.count(), 1,
      "the page stopped warning that nothing has ever been verified, after a run that verified nothing");
    assert.equal(await never.innerText(), CATALOG["backup.status.never"]);
    assert.equal(await win.locator('[data-test-id="backup-status"]').count(), 0,
      "a success status line appeared after a failed backup");

    for (const d of readdirSync(destination).filter((d) => d.startsWith("lawbar-backup-"))) {
      assert.equal(existsSync(path.join(destination, d, "manifest.json")), false,
        "a refused archive was left carrying a manifest, which reads as verified");
    }
  });

test("PACKAGED + BUTTON: a failure after an EARLIER success does not refresh the old success",
  async (t) => {
    // The third state, and the one most likely to mislead. With a prior success on record, a
    // failed run must leave that record EXACTLY as it was — not advanced to today (which would
    // report a backup that never happened) and not erased (which would discard a real one).
    // Asserted by comparing the rendered sentence before and after, so no date arithmetic in the
    // test can make it pass by accident.
    const { dir: profile } = await seedProfile("prior", { tamper: true });
    const destination = tempRoot("priordest");
    t.after(() => {
      rmSync(profile, { recursive: true, force: true });
      rmSync(destination, { recursive: true, force: true });
    });

    // An earlier verified backup, 13 days ago. Written directly because the point is the STATE,
    // not how it got there, and the chain in this profile is already tampered.
    const thirteenDaysAgo = new Date(Date.now() - 13 * 86_400_000).toISOString();
    writeFileSync(path.join(profile, "backup-record.json"), JSON.stringify({
      version: 1,
      lastVerifiedAt: thirteenDaysAgo,
      lastVerifiedDir: path.join(destination, "lawbar-backup-earlier"),
      lastDestinationRoot: destination,
      lastVerifiedSameVolume: false,
    }));

    const { win } = await launchWithChooser(t, profile, destination);
    await openBackupScreen(win);

    const status = win.locator('[data-test-id="backup-status"]');
    await status.waitFor({ timeout: 10_000 });
    const sentenceBefore = await status.innerText();
    assert.notEqual(sentenceBefore, CATALOG["backup.status.today"],
      "precondition: the seeded success must NOT already read as today");
    assert.equal(await win.locator('[data-test-id="backup-never"]').count(), 0,
      "precondition: a profile with a recorded success must not show the never-backed-up alert");

    await clickBackupAndWait(win);

    const result = win.locator('[data-test-id="backup-result"]');
    assert.equal(await result.innerText(), CATALOG["backup.failed.verification"]);
    assert.equal(await status.innerText(), sentenceBefore,
      "the failed run rewrote the last-verified sentence the owner reads");
    assert.equal(await win.locator('[data-test-id="backup-never"]').count(), 0,
      "the failed run erased a real earlier backup from the screen");

    // And the record on disk is byte-identical: the screen and the file must agree.
    const record = JSON.parse(fs.readFileSync(path.join(profile, "backup-record.json"), "utf8"));
    assert.equal(record.lastVerifiedAt, thirteenDaysAgo,
      "the failed run advanced or rewrote the persisted last-verified timestamp");
  });
