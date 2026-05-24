import { execSync } from "node:child_process";
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function getDark() {
  return execSync(`osascript -e 'tell application "System Events" to tell appearance preferences to get dark mode'`).toString().trim() === "true";
}
function setDark(v) {
  execSync(`osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to ${v}'`);
}

const PREF_FILE = path.join(os.homedir(), "Library", "Application Support", "lawbar", "theme-preference.json");
function clearPref() {
  try { fs.unlinkSync(PREF_FILE); } catch { /* already absent */ }
}

async function probe(label) {
  clearPref();
  const app = await electron.launch({ args: ["."], cwd: process.cwd() });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForSelector("article.panel");
  const dataTheme = await win.getAttribute("html", "data-theme");
  const nativeDark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
  await app.close();
  console.log(`[${label}] OS dark=${getDark()} | nativeTheme.shouldUseDarkColors=${nativeDark} | html data-theme=${dataTheme}`);
}

const originalDark = getDark();
console.log(`[before] originalDark=${originalDark}`);
try {
  setDark(true);
  await new Promise(r => setTimeout(r, 1500));
  await probe("OS=dark, pref=system (default)");
  setDark(false);
  await new Promise(r => setTimeout(r, 1500));
  await probe("OS=light, pref=system (default)");
} finally {
  setDark(originalDark);
  clearPref();
  console.log(`[restored] dark=${getDark()}, pref cleared`);
}
