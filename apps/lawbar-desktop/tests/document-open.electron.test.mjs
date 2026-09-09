// Drives the document-open bridge in a REAL Electron process (product plan R1, WI-5).
//
// The handler test proves the logic with the bridge injected. This is the test that would catch a
// channel name that does not match, a preload that never exposed `window.lawbar.documentOpen`, or
// a handler registered after the window loads — the failures that leave the owner pressing a
// control that does nothing, which #283 already taught this repo the cost of.
//
// ISOLATED PROFILE, WITH A REFUSAL. `--user-data-dir` points at a throwaway directory and the
// launch aborts if the app ever resolves the litigator's real store. The Electron tests here once
// ran without that and were opening and WRITING the real case database on every local `npm test`.
//
// NO SILENT SKIP. On a FileVault-off host the product shell never loads; each test then asserts
// the gate window IS showing rather than returning early, so absence of the shell is itself a
// checked claim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_USER_DATA = path.join(os.homedir(), "Library", "Application Support", "lawbar");

async function launchIsolated(t) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "lawbar-docopen-"));
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
  return { app, profile };
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

test("the bridge exposes exactly `open`, and nothing else", async (t) => {
  // NOT asserted here: `open.length`. `contextBridge` hands the renderer a proxy, and every
  // proxied function reports length 0 whatever its real signature — measured: this assertion was
  // first written as `=== 1` and failed with `actual: 0` while the calls themselves worked. An
  // arity check at the bridge therefore cannot distinguish a path parameter from none and would
  // pass for any function. The property that matters — an extra `path` field is refused before
  // any lookup — is proved from the main process by the next test, and the handler's own arity is
  // pinned in its pure-Node test.
  const { app } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app); return; }
  const shape = await win.evaluate(() => {
    const b = window.lawbar?.documentOpen;
    return b === undefined ? null : { keys: Object.keys(b).sort(), openIsFn: typeof b.open === "function" };
  });
  assert.ok(shape, "window.lawbar.documentOpen is not wired");
  assert.deepEqual(shape.keys, ["open"]);
  assert.equal(shape.openIsFn, true);
});

test("the channel answers from the main process: garbage is refused as invalid_request", async (t) => {
  const { app } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app); return; }
  const r = await win.evaluate(() => window.lawbar.documentOpen.open({ matterId: "x", documentId: "y", path: "/etc/passwd" }));
  assert.deepEqual(r, { ok: false, code: "invalid_request" }, "an extra field — a path — must be refused before any lookup");
});

test("an unknown identity is unknown_document, with a code and nothing else", async (t) => {
  const { app } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app); return; }
  const r = await win.evaluate(() => window.lawbar.documentOpen.open({
    matterId: "01j0000000000000000000mattr".slice(0, 26),
    documentId: "01j0000000000000000000docum".slice(0, 26),
  }));
  assert.deepEqual(r, { ok: false, code: "unknown_document" });
});
