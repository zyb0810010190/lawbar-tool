// Playwright Electron smoke test for the case-box product UI shell.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 H3 reconciliation (smoke
// migrated in this WI; was a 12-panel-token-fixture smoke previously).
//
// Asserts:
//   1. Window opens; title is "lawbar".
//   2. <main id="app"> exists; #/matters route renders the case-box header
//      and the empty active-list copy (in-memory backing → empty on launch).
//   3. nativeTheme.themeSource flip propagates to <html data-theme>.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

test("Electron launches; window opens; title=lawbar; #app renders case-box list shell", async (t) => {
  const app = await electron.launch({
    args: ["."],
    cwd: projectRoot,
    // LAWBAR_MODE=dev disables the Tier 1 FileVault enforcement BLOCK so
    // smoke tests pass on dev machines where FileVault may be off (per
    // dev-memo/plan-encryption-at-rest-00.md §4.1).
    env: { ...process.env, LAWBAR_MODE: "dev" },
  });
  t.after(async () => {
    await app.close();
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  const title = await window.title();
  assert.equal(title, "lawbar");

  // The router shell mount point.
  await window.waitForSelector("main#app");

  // Default route is #/matters (the list screen). The list screen renders
  // an <h1>lawbar — case-box</h1> and, since v1 backing is in-memory and
  // fresh on launch, an empty-state copy.
  await window.waitForSelector("h1");
  const h1Text = await window.locator("h1").first().textContent();
  assert.equal(h1Text, "lawbar — case-box");

  // The list screen marks its empty state with a stable test id.
  await window.waitForSelector('[data-test-id="list-empty"]', { timeout: 5000 });
  const emptyText = await window
    .locator('[data-test-id="list-empty"]')
    .textContent();
  assert.match(
    emptyText,
    /Data is held in memory only — relaunching the app clears it\./,
  );

  // The + New matter button is present so the user can navigate forward.
  const newBtn = window.locator("button.list-new-btn");
  await newBtn.waitFor({ state: "visible" });
});

test("nativeTheme.themeSource flip propagates to <html data-theme>", async (t) => {
  // Programmatic equivalent of the manual macOS Appearance toggle gate.
  // The renderer's setupTheme() registers an `onSystemChange` callback that
  // flips <html data-theme> when main sends `theme:system-change`. Driving
  // nativeTheme.themeSource from the main process exercises the same code
  // path as a real OS appearance toggle.
  const app = await electron.launch({
    args: ["."],
    cwd: projectRoot,
    env: { ...process.env, LAWBAR_MODE: "dev" },
  });
  t.after(async () => {
    await app.close();
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForSelector("main#app");

  // Flip to dark.
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = "dark";
  });
  await window.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "dark",
    null,
    { timeout: 5000 },
  );
  assert.equal(await window.getAttribute("html", "data-theme"), "dark");

  // Flip back to light.
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = "light";
  });
  await window.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "light",
    null,
    { timeout: 5000 },
  );
  assert.equal(await window.getAttribute("html", "data-theme"), "light");
});
