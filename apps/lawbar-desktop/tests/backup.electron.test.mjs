// Drives the backup screen in a REAL Electron process.
//
// Everything else in this feature is tested in pure Node with the bridge injected, which proves
// the logic and proves nothing about the wiring. This is the test that would catch a channel name
// that does not match, a preload that never exposed `window.lawbar.backup`, a nav link that does
// not route, or a handler registered after the window loads. Those are exactly the failures that
// leave the owner clicking a button that does nothing — and the readiness window already taught
// this repo what that costs (#283).
//
// ISOLATED PROFILE, ALWAYS. `--user-data-dir` points at a throwaway directory and the launch
// REFUSES if the app ever resolves the litigator's real store. That guard is not ceremony: the
// Electron tests here once ran without it and were opening and WRITING the real case database,
// including its audit-chain tables, on every local `npm test`.
//
// The native directory chooser cannot be driven from a test, so "click the button and pick a
// folder" is not covered here. What IS covered is everything up to it: the screen renders, the
// bridge exists with the right shape, the status channel answers from the main process, and a
// fresh profile correctly reports that it has never been backed up.

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
  const profile = mkdtempSync(path.join(os.tmpdir(), "lawbar-backup-"));
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

/**
 * The product shell, or null when the readiness gate is blocking instead.
 *
 * `null` must never mean "quietly pass". On a FileVault-off host these tests genuinely cannot
 * exercise the product shell, so each one asserts the gate window IS showing rather than
 * returning early — otherwise the whole file becomes four tests that cannot fail on exactly the
 * machines where something is most likely wrong.
 */
async function productWindow(app) {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  const isReadiness = (await win.locator("#readiness-title").count()) > 0;
  return isReadiness ? null : win;
}

/** Assert the gate really is the reason the shell is absent. Never a silent skip. */
async function assertGateIsBlocking(app) {
  const win = await app.firstWindow();
  const title = await win.locator("#readiness-title").innerText();
  assert.ok(title.trim().length > 0,
    "no product shell AND no readiness window: the app showed nothing at all");
}

test("the backup IPC channels answer from the main process", async (t) => {
  const { app } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) {
    await assertGateIsBlocking(app);
    return;
  }
  const status = await win.evaluate(async () => window.lawbar?.backup?.status?.());
  assert.ok(status !== undefined && status !== null, "window.lawbar.backup.status is not wired");
  assert.deepEqual(Object.keys(status).sort(),
    ["daysSinceLastVerified", "hasEverBackedUp", "lastVerifiedAt"],
    "the status payload shape changed");
  assert.equal(status.hasEverBackedUp, false, "a fresh profile has never been backed up");
  assert.equal(status.lastVerifiedAt, null);
});

test("the backup bridge exposes exactly status + run, and run takes no path", async (t) => {
  const { app } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app); return; }
  const shape = await win.evaluate(() => {
    const b = window.lawbar?.backup;
    return b === undefined ? null : { keys: Object.keys(b).sort(), runArity: b.run.length };
  });
  assert.deepEqual(shape?.keys, ["run", "status"]);
  assert.equal(shape?.runArity, 0,
    "run() must take no argument — main owns the destination chooser, not the renderer");
});

test("the backup screen renders, and a fresh profile shows the never-backed-up ALERT", async (t) => {
  const { app } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app); return; }
  await win.evaluate(() => { window.location.hash = "#/backup"; });
  await win.waitForSelector('[data-test-id="backup-title"]', { timeout: 10_000 });
  const never = win.locator('[data-test-id="backup-never"]');
  await never.waitFor({ timeout: 10_000 });
  assert.equal(await never.getAttribute("role"), "alert",
    "never-backed-up must be an alert, not a neutral empty state");
  assert.ok((await never.innerText()).includes("尚未"), "it must say plainly that there is none");
  // The custody caveat is on the screen, not a footnote.
  assert.ok((await win.locator('[data-test-id="backup-custody"]').innerText()).includes("断开"));
  // And the button the owner actually presses is present and enabled.
  const button = win.locator('[data-test-id="backup-run"]');
  assert.equal(await button.isEnabled(), true);
});

test("the sidebar has a reachable Backup link — a capability nobody can find does not exist", async (t) => {
  const { app } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { await assertGateIsBlocking(app); return; }
  const link = win.locator('.sidebar-link[data-nav="backup"]');
  assert.equal(await link.count(), 1, "no sidebar entry for backup");
  assert.equal(await link.getAttribute("href"), "#/backup");
  assert.ok((await link.innerText()).trim().length > 0,
    "an empty label is what a missing data-i18n key produces");
  await link.click();
  await win.waitForSelector('[data-test-id="backup-title"]', { timeout: 10_000 });
});
