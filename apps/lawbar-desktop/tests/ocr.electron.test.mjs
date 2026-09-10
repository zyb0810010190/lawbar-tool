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
// NO SILENT SKIP. On a FileVault-off host the product shell never loads; the test then asserts
// the gate window IS showing rather than returning early.

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
    env: { ...process.env, LAWBAR_MODE: "" },
  });
  const resolved = await app.evaluate(async ({ app: a }) => a.getPath("userData"));
  assert.equal(realpathSync(resolved), realpathSync(profile), "the app ignored --user-data-dir");
  assert.notEqual(
    realpathSync(resolved),
    existsSync(REAL_USER_DATA) ? realpathSync(REAL_USER_DATA) : REAL_USER_DATA,
    "REFUSING: the app resolved the REAL user-data directory.",
  );
  t.after(async () => {
    await app.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  });
  return app;
}

async function productWindow(app) {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  const isReadiness = (await win.locator("#readiness-title").count()) > 0;
  return isReadiness ? null : win;
}

async function assertGateIsBlocking(app) {
  const win = await app.firstWindow();
  const title = await win.locator("#readiness-title").innerText();
  assert.ok(title.trim().length > 0, "no product shell AND no readiness window: the app showed nothing at all");
}

test("window.lawbar.ocr.probe reaches the staged helper, and the digest it returns is the bytes of that file", async (t) => {
  assert.ok(existsSync(STAGED_HELPER), `staged helper missing at ${STAGED_HELPER}; npm run build:helper stages it`);
  const expected = sha256OfFile(STAGED_HELPER);
  assert.equal(readPinnedDigest(PIN_FILE), expected, "the pin main reads must be the staged helper's bytes");

  const app = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app); return; }

  const shape = await win.evaluate(() => ({
    hasOcr: typeof window.lawbar?.ocr === "object",
    probeIsFn: typeof window.lawbar?.ocr?.probe === "function",
    keys: Object.keys(window.lawbar?.ocr ?? {}).sort(),
  }));
  assert.equal(shape.hasOcr, true, "preload must expose window.lawbar.ocr");
  assert.equal(shape.probeIsFn, true, "preload must expose window.lawbar.ocr.probe");
  assert.deepEqual(shape.keys, ["probe"], "ocr exposes exactly one channel in step 2");

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
