// Drives ocr:probe in a REAL Electron process (product plan R3, WI-12 step 2).
//
// The unit test proves the boundary with fakes. This is the test that would catch a channel name
// that does not match, a preload that never exposed `window.lawbar.ocr`, or a main that resolved
// the helper somewhere other than the staged build. It asserts the whole chain from the renderer
// to the Swift binary: the digest the renderer receives IS the sha256 of build/helpers/lawbar-ocr.
//
// ISOLATED PROFILE, WITH A REFUSAL. `--user-data-dir` points at a throwaway directory and the
// launch aborts if the app ever resolves the litigator's real store.
//
// NO SILENT SKIP, AND NO VACUOUS PASS. LAWBAR_MODE=dev turns the Tier 1 FileVault gate from a
// block into a warning, so this suite really runs on a CI runner instead of stopping at the
// readiness window and asserting nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright";

import { readPinnedDigest, sha256OfFile } from "../dist/src/ocr/helper.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_USER_DATA = path.join(os.homedir(), "Library", "Application Support", "lawbar");
const STAGED_HELPER = path.join(projectRoot, "build", "helpers", "lawbar-ocr");
const PIN_FILE = path.join(projectRoot, "dist", "src", "ocr", "helper-pin.json");

async function launchIsolated(t) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "lawbar-ocr-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${profile}`],
    cwd: projectRoot,
    // LAWBAR_MODE=dev turns the Tier 1 FileVault gate from a BLOCK into a warning, exactly as
    // smoke.electron.test.mjs has always done. It is the difference between a test that runs and a
    // test that only looks like it runs: a CI runner has FileVault OFF, so in production mode this
    // suite reached the readiness window and asserted nothing about OCR at all. The gate itself is
    // readiness.electron.test.mjs's subject, and it keeps production mode; proving it twice here
    // bought nothing and cost the entire feature its coverage.
    env: { ...process.env, LAWBAR_MODE: "dev" },
  });
  // TEARDOWN FIRST, before anything that can throw. The assertions below are refusals — they fire
  // when the app resolved the wrong profile, the owner's real one included — and a refusal that
  // leaves an Electron process alive turns a clear failure into a hung job that reports nothing:
  // node:test will not exit while a child process lives. That cost a 40-minute CI job once.
  t.after(async () => {
    await app.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  });
  const resolved = await app.evaluate(async ({ app: a }) => a.getPath("userData"));
  assert.equal(realpathSync(resolved), realpathSync(profile), "the app ignored --user-data-dir");
  assert.notEqual(
    realpathSync(resolved),
    existsSync(REAL_USER_DATA) ? realpathSync(REAL_USER_DATA) : REAL_USER_DATA,
    "REFUSING: the app resolved the REAL user-data directory.",
  );
  return app;
}

/** The product shell, or a loud failure — see ocr-extract.electron.test.mjs for why this is not a branch. */
async function productWindow(app) {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  const readiness = await win.locator("#readiness-title").count();
  assert.equal(readiness, 0,
    "the product shell did not load: the readiness gate is showing even though LAWBAR_MODE=dev disables the block");
  return win;
}

test("window.lawbar.ocr.probe reaches the staged helper, and the digest it returns is the bytes of that file", async (t) => {
  assert.ok(existsSync(STAGED_HELPER), `staged helper missing at ${STAGED_HELPER}; npm run build:helper stages it`);
  const expected = sha256OfFile(STAGED_HELPER);
  assert.equal(readPinnedDigest(PIN_FILE), expected, "the pin main reads must be the staged helper's bytes");

  const app = await launchIsolated(t);
  const win = await productWindow(app);

  const shape = await win.evaluate(() => ({
    hasOcr: typeof window.lawbar?.ocr === "object",
    probeIsFn: typeof window.lawbar?.ocr?.probe === "function",
    keys: Object.keys(window.lawbar?.ocr ?? {}).sort(),
  }));
  assert.equal(shape.hasOcr, true, "preload must expose window.lawbar.ocr");
  assert.equal(shape.probeIsFn, true, "preload must expose window.lawbar.ocr.probe");
  // The whole OCR surface, pinned exactly: probe (step 2) plus extract and pages (WI-12). A method
  // appearing here that main does not register, or that no test drives, is the failure this asserts.
  assert.deepEqual(shape.keys, ["extract", "pages", "probe"], "the ocr bridge exposes exactly these three");

  const r = await win.evaluate(() => window.lawbar.ocr.probe());
  assert.equal(r.ok, true, `probe failed: ${JSON.stringify(r)}`);
  assert.equal(r.value.pinned_digest, expected, "main did not read the pin the build wrote");
  assert.equal(r.value.executable_digest, expected, "main resolved a different executable than the staged helper");
  assert.equal(r.value.helper_build_digest, expected, "the helper that answered is not the staged binary");
  assert.ok(r.value.vision_languages.includes("zh-Hans"), `zh-Hans missing: ${r.value.vision_languages.join(",")}`);
  assert.equal(typeof r.value.roundtrip_ms, "number", "main asks for the round-trip");
  assert.ok(typeof r.value.roundtrip_text === "string" && r.value.roundtrip_text.length > 0);
  assert.ok(r.value.elapsed_ms < 15_000, `elapsed ${r.value.elapsed_ms} ms exceeds the deadline main sets`);
});
