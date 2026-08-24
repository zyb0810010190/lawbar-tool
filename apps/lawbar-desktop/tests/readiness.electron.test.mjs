// Drives the first-run readiness window in a real Electron process.
//
// The unit tests cover the decision logic; this covers the thing that logic exists to produce — a
// window the owner can actually act on. It was written after a manual check appeared to show no
// window at all. That turned out to be a blind screenshot (macOS returns wallpaper only without
// Screen Recording permission, so nothing at all was captured, not even the terminal). The window
// was reporting visible=true with sane bounds the entire time. A test that drives the window is
// the check that could not have been fooled that way, which is why it exists now.
//
// CONDITIONAL ON THE REAL MACHINE STATE. On a host with FileVault ON the gate does not block and
// there is no readiness window — so the test asserts the correct behaviour for whichever state
// `fdesetup` actually reports, rather than assuming one. Skipping instead would let a
// FileVault-on host report "nothing wrong" about a path it never exercised.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_USER_DATA = path.join(os.homedir(), "Library", "Application Support", "lawbar");

/** What `fdesetup` says on THIS machine — the same source the app's probe uses. */
function hostFileVault() {
  try {
    const out = execFileSync("fdesetup", ["status"], { encoding: "utf8" }).trim();
    if (/^FileVault is On\.?$/i.test(out)) return "on";
    if (/^FileVault is Off\.?$/i.test(out)) return "off";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Launch with a throwaway profile, refusing if it ever resolves the litigator's real store. */
async function launchIsolated(t) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "lawbar-readiness-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${profile}`],
    cwd: projectRoot,
    // NO LAWBAR_MODE: production is the default, and production is the path under test.
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

const BLOCKS = hostFileVault() !== "on";

test("a blocked launch opens a window instead of quitting", async (t) => {
  const { app } = await launchIsolated(t);
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  if (!BLOCKS) {
    // FileVault is on here, so the gate passes and the product shell is what loads.
    assert.equal(await win.locator("#app").count(), 1, "expected the product shell on a ready host");
    return;
  }

  // The regression this replaces: an error box, then quit. The window must exist and carry copy.
  const title = win.locator('[data-test-id="readiness-title"]');
  await title.waitFor({ timeout: 15000 });
  assert.ok((await title.textContent()).trim().length > 0, "the window rendered no title");
  assert.ok(
    (await win.locator('[data-test-id="readiness-detail"]').textContent()).includes("FileVault"),
    "the detail must name the condition being reported",
  );
});

test("it offers the action that fixes the condition, not just the diagnosis", async (t) => {
  if (!BLOCKS) return;
  const { app } = await launchIsolated(t);
  const win = await app.firstWindow();
  await win.locator('[data-test-id="readiness-title"]').waitFor({ timeout: 15000 });

  for (const id of ["readiness-open", "readiness-recheck", "readiness-quit"]) {
    const b = win.locator(`[data-test-id="${id}"]`);
    assert.equal(await b.count(), 1, `${id} is missing`);
    assert.ok((await b.textContent()).trim().length > 0, `${id} has no label`);
  }
});

// The property the whole feature stands on: presentation changed, the gate did not.
test("re-checking on a still-blocked host reports it and does NOT let the app through", async (t) => {
  if (!BLOCKS) return;
  const { app, profile } = await launchIsolated(t);
  const win = await app.firstWindow();
  await win.locator('[data-test-id="readiness-title"]').waitFor({ timeout: 15000 });

  await win.locator('[data-test-id="readiness-recheck"]').click();
  const status = win.locator('[data-test-id="readiness-status"]');
  await status.waitFor({ timeout: 15000 });
  assert.ok((await status.textContent()).trim().length > 0, "re-check reported nothing back");

  // SETTLE FIRST. Asserting the instant the click returns is what let a mutation through: a
  // re-check that wrongly proceeds calls startProduct(), and the case database it opens does not
  // exist yet at that moment. The check has to outlast the thing it is trying to catch.
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    assert.equal(
      existsSync(path.join(profile, "case-box.sqlite")), false,
      "a case database was created while the FileVault gate was blocking",
    );
    await new Promise((r) => setTimeout(r, 200));
  }

  // And the window must still be standing — a still-blocked host never gets past it.
  assert.equal(await win.locator('[data-test-id="readiness-title"]').count(), 1,
    "the window closed while the host is still blocked");
});

// The strongest single assertion available: whatever the window does, no case store appears.
test("no case database is created while the gate blocks", async (t) => {
  if (!BLOCKS) return;
  const { app, profile } = await launchIsolated(t);
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  for (const f of ["case-box.sqlite", "case-box.sqlite-wal", "case-box.sqlite-shm"]) {
    assert.equal(existsSync(path.join(profile, f)), false, `${f} was created behind the gate`);
  }
});

// The crash message is only worth anything if something installs it. Electron's default for an
// unhandled throw is a raw stack dialog, which is what the owner actually saw before this existed.
// Asserted in the LIVE main process rather than by reading the source.
test("the last-resort crash handlers are registered in the running main process", async (t) => {
  const { app } = await launchIsolated(t);
  const counts = await app.evaluate(async () => ({
    uncaught: process.listenerCount("uncaughtException"),
    rejection: process.listenerCount("unhandledRejection"),
  }));
  assert.ok(counts.uncaught > 0, "no uncaughtException handler — a throw shows a raw stack");
  assert.ok(counts.rejection > 0, "no unhandledRejection handler");
});

// Installed at module load, so a throw BEFORE the gate is covered too — which is exactly where the
// incident happened, in a BrowserWindow listener during the pre-gate window.
test("they are installed before the gate, not only after the app starts", async (t) => {
  const { app } = await launchIsolated(t);
  // On a blocked host the product never starts, so a handler present here can only have been
  // registered at module load.
  if (!BLOCKS) return;
  const n = await app.evaluate(async () => process.listenerCount("uncaughtException"));
  assert.ok(n > 0, "the handler is registered too late to cover a pre-gate throw");
});

