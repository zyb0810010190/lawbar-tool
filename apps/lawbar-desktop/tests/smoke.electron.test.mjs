// Playwright Electron smoke test.
// Asserts: window opens; title correct; 12 panels render; theme
// switching toggles <html data-theme>.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

test("Electron launches; window opens; title correct; 12 panels render", async (t) => {
  const app = await electron.launch({
    args: ["."],
    cwd: projectRoot,
  });
  t.after(async () => {
    await app.close();
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  const title = await window.title();
  assert.equal(title, "lawbar (token fixture)");

  await window.waitForSelector("article.panel");
  const panelCount = await window.locator("article.panel").count();
  assert.equal(panelCount, 12, "must render exactly 12 token panels");

  // Each panel has the expected data-token attribute.
  const expected = [
    "background",
    "surface",
    "surface-elevated",
    "text",
    "muted-text",
    "border",
    "accent",
    "text-on-accent",
    "danger",
    "warning",
    "success",
    "focus-ring",
  ];
  for (const token of expected) {
    const found = await window.locator(`article.panel[data-token="${token}"]`).count();
    assert.equal(found, 1, `missing panel for token: ${token}`);
  }
});

test("theme switching: light → dark → light updates data-theme attribute", async (t) => {
  const app = await electron.launch({
    args: ["."],
    cwd: projectRoot,
  });
  t.after(async () => {
    await app.close();
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForSelector("article.panel");

  // Force light first
  await window.click("button[data-mode='light']");
  await window.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
  assert.equal(await window.getAttribute("html", "data-theme"), "light");

  // Switch to dark
  await window.click("button[data-mode='dark']");
  await window.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
  assert.equal(await window.getAttribute("html", "data-theme"), "dark");

  // Back to light
  await window.click("button[data-mode='light']");
  await window.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
  assert.equal(await window.getAttribute("html", "data-theme"), "light");
});

test("live OS appearance change (System mode): nativeTheme.themeSource flip propagates to renderer", async (t) => {
  // Programmatic equivalent of the manual macOS Appearance toggle gate
  // documented in dev-memo/plan-first-ui-shell-00.md §3.3. The plan's
  // manual gate (System Preferences toggle while mode === "system")
  // exercises Electron's nativeTheme.on("updated") listener; this test
  // exercises the SAME code path by driving nativeTheme.themeSource
  // from the main process via app.evaluate(), which is what an OS
  // toggle does internally. Recorded as the in-CI evidence for plan
  // §3.3 (manual System Preferences toggle is not available in this
  // CLI environment; see commit message for the osascript-blocked note).
  const app = await electron.launch({
    args: ["."],
    cwd: projectRoot,
  });
  t.after(async () => {
    await app.close();
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForSelector("article.panel");

  // Put renderer in "system" preference so nativeTheme.on("updated")
  // actually propagates.
  await window.click("button[data-mode='system']");
  await window.waitForFunction(
    () => document.querySelector("#mode-display")?.textContent?.startsWith("system"),
  );

  // From the main process, flip nativeTheme.themeSource to "dark".
  // This triggers nativeTheme.on("updated") → main sends
  // "theme:system-change" to renderer → renderer flips <html data-theme>.
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = "dark";
  });
  await window.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "dark",
    null,
    { timeout: 5000 },
  );
  assert.equal(await window.getAttribute("html", "data-theme"), "dark");

  // Flip back to "light" via nativeTheme.
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
