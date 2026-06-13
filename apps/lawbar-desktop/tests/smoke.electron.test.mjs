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
  // an <h1>案件台账</h1> (PR2 desktop variant; no i18n layer, labels are
  // hardcoded Chinese) and, since v1 backing is in-memory and fresh on
  // launch, an empty-state copy that reassures data stays on this device.
  await window.waitForSelector("h1");
  const h1Text = await window.locator("h1").first().textContent();
  assert.equal(h1Text, "案件台账");

  // The list screen marks its empty state with a stable test id.
  await window.waitForSelector('[data-test-id="list-empty"]', { timeout: 5000 });
  const emptyText = await window
    .locator('[data-test-id="list-empty"]')
    .textContent();
  assert.match(emptyText, /仅保存在本机/);

  // The + New matter button is present so the user can navigate forward.
  const newBtn = window.locator("button.list-new-btn");
  await newBtn.waitFor({ state: "visible" });
});

test("sidebar aria-current follows the hash route (UISHELL-L1)", async (t) => {
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

  // Default route #/matters → Matters link is current, New-matter is not.
  await window.waitForFunction(
    () =>
      document.querySelector('.sidebar-link[data-nav="list"]')?.getAttribute("aria-current") === "page",
    null,
    { timeout: 5000 },
  );
  assert.equal(
    await window.getAttribute('.sidebar-link[data-nav="new"]', "aria-current"),
    null,
  );

  // Navigate to #/matters/new → current moves to the New-matter link only.
  await window.evaluate(() => {
    window.location.hash = "#/matters/new";
  });
  await window.waitForFunction(
    () =>
      document.querySelector('.sidebar-link[data-nav="new"]')?.getAttribute("aria-current") === "page",
    null,
    { timeout: 5000 },
  );
  assert.equal(
    await window.getAttribute('.sidebar-link[data-nav="list"]', "aria-current"),
    null,
  );
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

test("S1 font wiring: body resolves the self-hosted Noto Sans SC stack + faces load locally", async (t) => {
  // Per dev-memo/plan-casebox-ui-design-hardening-00.md §8 S1 smoke bar:
  // "font-family computed style on body includes a CJK family name." Also
  // asserts the self-hosted @font-face actually loaded (no CDN; same-origin
  // ./fonts/*.woff2). HS10 resolved by local WOFF2 — see renderer/fonts/PROVENANCE.md.
  const app = await electron.launch({
    args: ["."],
    cwd: projectRoot,
    env: { ...process.env, LAWBAR_MODE: "dev" },
  });
  t.after(async () => {
    await app.close();
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("load");
  await window.waitForSelector("main#app");

  // 1) The computed body font-family stack LEADS with the self-hosted CJK UI
  //    face (first position, not merely present — proves --font-ui primary).
  const bodyFamily = await window.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  const firstFamily = bodyFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
  assert.equal(
    firstFamily,
    "Noto Sans SC",
    `body font-family must LEAD with the self-hosted CJK face; got stack: ${bodyFamily}`,
  );

  // 2) The self-hosted faces are FETCHABLE from local ./fonts/*.woff2 (not a
  //    CDN). `font-display: swap` faces load lazily — an unused face (serif /
  //    mono, not yet applied to any element in S1) reports unloaded until
  //    requested. `document.fonts.load()` forces the fetch; it resolves only
  //    if the same-origin woff2 is reachable, so a broken @font-face url or a
  //    missing dist/renderer/fonts/ copy fails this assertion.
  await window.evaluate(() => document.fonts.ready);
  const faces = await window.evaluate(async () => {
    const want = [
      '400 16px "Noto Sans SC"',
      '600 16px "Noto Sans SC"',
      '400 16px "Noto Serif SC"',
      '600 16px "Noto Serif SC"',
      '400 16px "JetBrains Mono"',
      '500 16px "JetBrains Mono"',
    ];
    const out = {};
    for (const spec of want) {
      try {
        const matched = await document.fonts.load(spec);
        out[spec] = matched.length; // >0 ⇒ a local face matched + loaded
      } catch (e) {
        out[spec] = `ERR:${String(e)}`;
      }
    }
    return out;
  });
  for (const [spec, n] of Object.entries(faces)) {
    assert.ok(
      typeof n === "number" && n > 0,
      `self-hosted face must load from local woff2 for ${spec}; got ${n}`,
    );
  }

  // 3) No CDN font origin leaked into the document stylesheets.
  const hasCdnFont = await window.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = Array.from(sheet.cssRules ?? []);
      } catch {
        continue;
      }
      for (const rule of rules) {
        const css = rule.cssText ?? "";
        if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(css)) return true;
      }
    }
    return false;
  });
  assert.equal(hasCdnFont, false, "no Google Fonts CDN reference may appear in runtime CSS");
});
