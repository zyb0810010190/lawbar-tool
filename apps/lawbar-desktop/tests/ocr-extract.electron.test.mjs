// ocr:extract and ocr:pages in a REAL Electron process (product plan R3, WI-12).
//
// The handler tests prove the ladder with the helper faked. This is the test that would catch what
// they cannot: a channel name that does not match, a preload that never exposed the method, a
// handler registered after the window loads, or a store that fails to open in the packaged layout.
// This repository has shipped that failure before — a control the owner pressed that did nothing.
//
// It also pins two things only a real process can show:
//   • THE DERIVED STORE IS LAZY. A profile that never OCRs must not grow a second database, or the
//     readiness guarantee ("no store is written behind the FileVault gate") quietly weakens.
//   • THE STORE IS NOT BESIDE THE CASE BOX. The backup copies exactly one database by name; a
//     second one in the profile root would be silently missing from every verified backup.
//
// ISOLATED PROFILE, WITH A REFUSAL. `--user-data-dir` points at a throwaway directory and the
// launch aborts if the app ever resolves the litigator's real store.
//
// NO SILENT SKIP. On a FileVault-off host the product shell never loads; the test then asserts the
// gate window IS showing rather than returning early.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_USER_DATA = path.join(os.homedir(), "Library", "Application Support", "lawbar");

/**
 * Close an Electron app so that it CANNOT outlive the test run.
 *
 * `app.close()` asks the app to quit and waits. That wait has no bound, and this app has work on
 * `before-quit` (it closes the derived store), so a bug there would hang the await — and a hung
 * teardown is the same 40-minute CI death as a leaked process, just with a different stack. So:
 * ask nicely under a deadline, and if the deadline passes, kill the process outright.
 *
 * The close error is RETURNED, not swallowed. A quit that fails is a real defect in a court-facing
 * app — the store must close cleanly or a later launch finds a locked database — and a teardown
 * that hides it is a test that cannot fail.
 */
async function closeApp(app, deadlineMs = 20_000) {
  let timer;
  const timedOut = Symbol("timedOut");
  try {
    const raced = await Promise.race([
      app.close().then(() => null, (e) => e),
      new Promise((r) => { timer = setTimeout(() => r(timedOut), deadlineMs); }),
    ]);
    if (raced !== timedOut) return raced;
  } finally {
    clearTimeout(timer);
  }
  // It would not go. Take it, so node:test can exit and report.
  const proc = app.process?.();
  try { proc?.kill("SIGKILL"); } catch { /* already gone */ }
  return new Error(`the app did not quit within ${deadlineMs} ms and was killed`);
}

async function launchIsolated(t, { seed = false } = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "lawbar-ocr-extract-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${profile}`],
    cwd: projectRoot,
    env: { ...process.env, LAWBAR_MODE: "", ...(seed ? { LAWBAR_OCR_TEST_HOOK: "true" } : {}) },
  });
  // TEARDOWN FIRST, before anything that can throw. The isolation assertions below are refusals —
  // they fire when the app resolved the wrong profile — and a refusal that leaves an Electron
  // process alive turns a clear failure into a hung job that reports nothing at all.
  //
  // ALWAYS close, on every path. A test that returns early — the FileVault gate branch below does,
  // and on a CI runner it always does — must still not leave an Electron process alive: node:test
  // will not exit while one is, and the job dies on the 40-minute limit instead of reporting.
  // That happened. A test may ALSO close the app itself to assert that quitting works; closing an
  // already-closed app returns cleanly, so the second close reports nothing new.
  t.after(async () => {
    const err = await closeApp(app);
    rmSync(profile, { recursive: true, force: true });
    if (err) throw err;
  });
  const resolved = await app.evaluate(async ({ app: a }) => a.getPath("userData"));
  assert.equal(realpathSync(resolved), realpathSync(profile), "the app ignored --user-data-dir");
  assert.notEqual(
    realpathSync(resolved),
    existsSync(REAL_USER_DATA) ? realpathSync(REAL_USER_DATA) : REAL_USER_DATA,
    "REFUSING: the app resolved the REAL user-data directory.",
  );
  return { app, profile };
}

async function productWindow(app) {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  const isReadiness = (await win.locator("#readiness-title").count()) > 0;
  return isReadiness ? null : win;
}

async function assertGateIsBlocking(app, profile) {
  const win = await app.firstWindow();
  const title = await win.locator("#readiness-title").innerText();
  assert.ok(title.trim().length > 0, "no product shell AND no readiness window: the app showed nothing at all");
  // The gate branch is not a free pass: behind the gate the app must write NOTHING, and that has
  // to include the derived store, or a blocked launch could still create a database.
  assertNoOcrStore(profile, "behind the FileVault gate");
}

/** No OCR database anywhere it could exist, and none where the backup would miss it. */
function assertNoOcrStore(profile, when) {
  assert.equal(existsSync(path.join(profile, "ocr-derived")), false, `${when}: no derived store may exist`);
  const root = readdirSync(profile).filter((f) => f.endsWith(".sqlite"));
  assert.deepEqual(root.filter((f) => f !== "case-box.sqlite"), [],
    `${when}: only the case box may be a database in the profile root`);
}

/**
 * The seed hooks install at the END of startProduct, AFTER the window opens — so a test that has a
 * window does not yet necessarily have a seed. Poll briefly rather than assume: asserting the hook
 * exists the instant the window appears is a race that fails on a slow machine and passes on a
 * fast one, which is the worst kind of test.
 */
async function seedFixture(app) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const ready = await app.evaluate(async () => typeof globalThis.__lawbarOcrSeed === "function");
    if (ready) break;
    if (Date.now() > deadline) throw new Error("seed hook never installed — LAWBAR_OCR_TEST_HOOK not honoured");
    await new Promise((r) => setTimeout(r, 100));
  }
  return app.evaluate(async () => globalThis.__lawbarOcrSeed());
}

test("the OCR bridge exposes exactly probe, extract and pages, and both new channels answer", async (t) => {
  const { app, profile } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app, profile); return; }

  const shape = await win.evaluate(() => ({
    keys: Object.keys(window.lawbar?.ocr ?? {}).sort(),
    types: ["probe", "extract", "pages"].map((k) => typeof window.lawbar?.ocr?.[k]),
  }));
  assert.deepEqual(shape.keys, ["extract", "pages", "probe"], "the bridge must expose exactly these three");
  assert.deepEqual(shape.types, ["function", "function", "function"]);

  // A registered channel that answers proves the handler is bound. An unknown matter is the
  // cheapest way to ask: it exercises the whole path and stores nothing.
  const ref = { matterId: "no-such-matter", documentId: "no-such-document" };
  const extract = await win.evaluate((r) => window.lawbar.ocr.extract(r), ref);
  assert.deepEqual(extract, { ok: false, code: "unknown_document" },
    "if this rejects or returns undefined, the channel is not registered at all");
  const pages = await win.evaluate((r) => window.lawbar.ocr.pages(r), ref);
  assert.deepEqual(pages, { ok: false, code: "unknown_document" });
});

test("a malformed request is refused by main, not by the preload, and never reaches persistence", async (t) => {
  const { app, profile } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app, profile); return; }

  // The preload rebuilds the payload from two named fields, so an extra field cannot cross; what
  // CAN cross is a missing or empty one, and main must refuse that itself.
  for (const bad of [{ matterId: "", documentId: "d" }, { matterId: "m" }, {}]) {
    const res = await win.evaluate((r) => window.lawbar.ocr.extract(r), bad);
    assert.deepEqual(res, { ok: false, code: "invalid_request" }, JSON.stringify(bad));
  }
  // An extra field is dropped by the bridge rather than refused — the request that arrives is the
  // two known fields, so it fails scoping like any other unknown document.
  const extra = await win.evaluate(() => window.lawbar.ocr.extract({ matterId: "m", documentId: "d", secret: "/Users/x" }));
  assert.deepEqual(extra, { ok: false, code: "unknown_document" });
});

test("END TO END: a real born-digital document is read, stored in the DERIVED store only, and read back", async (t) => {
  const { app, profile } = await launchIsolated(t, { seed: true });
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app, profile); return; }

  const seeded = await seedFixture(app);
  assert.ok(seeded.matterId && seeded.documentId, "the seed must return the identity it created");

  const ref = { matterId: seeded.matterId, documentId: seeded.documentId };
  const res = await win.evaluate((r) => window.lawbar.ocr.extract(r), ref);
  assert.equal(res.ok, true, `extract failed: ${JSON.stringify(res)}`);
  assert.equal(res.value.pageCount, 1);
  assert.equal(res.value.fromTextLayer, 1, "a born-digital page must be read by TIER 0, never recognised");
  assert.equal(res.value.recognised, 0);
  assert.equal(res.value.failed, 0);
  assert.equal(res.value.missing, 0);
  assert.equal(res.value.needsReview, 1, "no control ships, so the page still needs the owner's eyes");

  const back = await win.evaluate((r) => window.lawbar.ocr.pages(r), ref);
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal(back.value.pages.length, 1);
  assert.equal(back.value.pages[0].outcome, "text_layer");
  assert.equal(back.value.pages[0].control, "unchecked");
  assert.ok(back.value.pages[0].text.includes(seeded.expectedText),
    `the layer's own text must come back; got ${JSON.stringify(back.value.pages[0].text)}`);

  // NOW the store exists — and only where it belongs. This is the assertion the earlier tests
  // could not make, because nothing in them ever opened it successfully.
  assert.ok(existsSync(path.join(profile, "ocr-derived", "ocr.sqlite")), "the derived store must be created on first use");
  const root = readdirSync(profile).filter((f) => f.endsWith(".sqlite"));
  assert.deepEqual(root, ["case-box.sqlite"],
    `the derived store must NOT be in the profile root, where the backup would miss it; found ${root.join(", ")}`);
});

test("the app quits cleanly once the derived store is open", async (t) => {
  // A closer that throws, or a handle left open, would make quitting hang or fail. Teardown would
  // catch that too, but it would be reported against whichever test happened to run — this test
  // closes with the store OPEN on purpose, so the failure is attributed to the thing that caused it.
  const { app, profile } = await launchIsolated(t, { seed: true });
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app, profile); return; }
  const seeded = await seedFixture(app);
  await win.evaluate((r) => window.lawbar.ocr.extract(r), { matterId: seeded.matterId, documentId: seeded.documentId });
  assert.ok(existsSync(path.join(profile, "ocr-derived", "ocr.sqlite")), "the store must be open for this to mean anything");
  await app.close();
});

test("the derived store is LAZY and is never created in the profile root beside the case box", async (t) => {
  const { app, profile } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app, profile); return; }

  // A refused request must not open the store: a profile that never OCRs never grows one.
  await win.evaluate(() => window.lawbar.ocr.pages({ matterId: "nope", documentId: "nope" }));
  const root = readdirSync(profile);
  assert.equal(root.includes("ocr-derived"), false, "a refused request must not open the derived store");
  assert.deepEqual(root.filter((f) => f.startsWith("ocr.sqlite")), [],
    "and nothing OCR-shaped may ever appear in the profile ROOT, where the backup would miss it");
  // Whatever else the app wrote, no second database may sit beside case-box.sqlite.
  const dbsInRoot = root.filter((f) => f.endsWith(".sqlite"));
  assert.deepEqual(dbsInRoot.sort(), dbsInRoot.filter((f) => f === "case-box.sqlite").sort(),
    `only the case box may be a database in the profile root; found ${dbsInRoot.join(", ")}`);
});
