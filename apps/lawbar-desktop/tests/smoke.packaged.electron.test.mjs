// Packaged-binary smoke test (Packaging Smoke WI-A per
// dev-memo/plan-packaging-smoke-00.md §2.2).
//
// Asserts that the .app produced by `npm run dist` behaves
// identically to the dev-mode shell for the 4 properties below.
// MUST be run AFTER `npm run dist` (the test does NOT trigger the
// build itself — that would couple test runtime to electron-builder
// startup cost; see plan §2.3).
//
// Cleanup: the packaged .app writes to the same userData path as
// dev mode (~/Library/Application Support/lawbar/theme-preference.json
// per night-mode foundation §3.2). Each test calls clearPref() at the
// top AND registers t.after { clearPref() } to avoid cross-
// contamination between dev and packaged runs (plan §2.4).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
// electron-builder default output dir is `dist/` (where the TS build
// also lands); some configs override to `release/`. Probe both so the
// test is robust to either.
const releaseDirs = [
  path.join(projectRoot, "dist"),
  path.join(projectRoot, "release"),
];
const PREF_FILE = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "lawbar",
  "theme-preference.json",
);

function clearPref() {
  try { fs.unlinkSync(PREF_FILE); } catch { /* already absent */ }
}

function findPackagedBinary() {
  // electron-builder emits <outdir>/mac-<arch>/lawbar.app/Contents/MacOS/lawbar
  // (where <outdir> is `dist/` by default or `release/` if configured).
  // The x64 variant lives in `mac/` (no arch suffix) when only x64 builds,
  // or `mac-x64/` when both archs build.
  //
  // Selection priority (flattened so host-arch wins GLOBALLY, not just per
  // output root — prevents a stale dist/mac (x64) from masking a fresh
  // release/mac-arm64 on an arm64 host; per rev-1 audit L D1#1):
  //   1. Host-arch match in ANY output dir.
  //   2. Cross-arch fallback in ANY output dir.
  const isArm64 = os.arch() === "arm64";
  const hostArchSubdirs = isArm64 ? ["mac-arm64"] : ["mac-x64", "mac"];
  const otherArchSubdirs = isArm64 ? ["mac-x64", "mac"] : ["mac-arm64"];
  const ordered = [];
  for (const sub of hostArchSubdirs) {
    for (const dir of releaseDirs) ordered.push(path.join(dir, sub));
  }
  for (const sub of otherArchSubdirs) {
    for (const dir of releaseDirs) ordered.push(path.join(dir, sub));
  }
  for (const appDir of ordered) {
    const candidate = path.join(appDir, "lawbar.app", "Contents", "MacOS", "lawbar");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

test("packaged .app exists at one of the expected release paths", () => {
  const binary = findPackagedBinary();
  assert.ok(
    binary !== null,
    `expected a packaged .app under one of ${releaseDirs.join(" | ")}; run \`npm run dist\` first`,
  );
  // Ensure the binary is executable (electron-builder sets +x).
  const stat = fs.statSync(binary);
  // POSIX exec bits: any of owner/group/other +x.
  const isExecutable = (stat.mode & 0o111) !== 0;
  assert.ok(isExecutable, `${binary} is not executable`);
});

test("packaged .app launches; window opens; title correct; 12 panels render with data-token attrs", async (t) => {
  const binary = findPackagedBinary();
  assert.ok(binary !== null, "packaged .app missing");

  clearPref();
  const app = await electron.launch({
    executablePath: binary,
    args: [],
    // LAWBAR_MODE=dev disables the Tier 1 FileVault BLOCK for the
    // packaged-binary smoke (per dev-memo/plan-encryption-at-rest-00.md
    // §4.1). The packaged binary inherits this env from the spawning
    // process; production launches still BLOCK on FileVault-off Macs.
    env: { ...process.env, LAWBAR_MODE: "dev" },
  });
  t.after(async () => {
    await app.close();
    clearPref();
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  const title = await window.title();
  assert.equal(title, "lawbar (token fixture)");

  await window.waitForSelector("article.panel");
  const panelCount = await window.locator("article.panel").count();
  assert.equal(panelCount, 12, "must render exactly 12 token panels");

  const expectedTokens = [
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
  for (const token of expectedTokens) {
    const found = await window.locator(`article.panel[data-token="${token}"]`).count();
    assert.equal(found, 1, `missing packaged panel for token: ${token}`);
  }
});

test("packaged .app theme switching toggles <html data-theme>", async (t) => {
  const binary = findPackagedBinary();
  assert.ok(binary !== null, "packaged .app missing");

  clearPref();
  const app = await electron.launch({
    executablePath: binary,
    args: [],
    // LAWBAR_MODE=dev disables the Tier 1 FileVault BLOCK for the
    // packaged-binary smoke (per dev-memo/plan-encryption-at-rest-00.md
    // §4.1). The packaged binary inherits this env from the spawning
    // process; production launches still BLOCK on FileVault-off Macs.
    env: { ...process.env, LAWBAR_MODE: "dev" },
  });
  t.after(async () => {
    await app.close();
    clearPref();
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForSelector("article.panel");

  await window.click("button[data-mode='dark']");
  await window.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "dark",
  );
  assert.equal(await window.getAttribute("html", "data-theme"), "dark");

  await window.click("button[data-mode='light']");
  await window.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "light",
  );
  assert.equal(await window.getAttribute("html", "data-theme"), "light");
});
