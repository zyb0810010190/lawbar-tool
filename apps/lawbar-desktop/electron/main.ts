import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadThemePreference } from "../src/persistence/themePreference.js";
import { runCaseBoxProbe } from "../src/probes/caseBoxProbe.js";
import { resolveAndPersist } from "../src/theme/applyTheme.js";
import {
  resolveSystemMode,
  type ThemePreference,
} from "../src/theme/resolveSystemMode.js";
import { DARK_TOKENS, LIGHT_TOKENS } from "../src/theme/tokens.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Native-module probe flag handler (Packaging Smoke WI-B per
// dev-memo/plan-packaging-smoke-wib-00.md §1.2; Option A fallback
// per user authorization — Option B file:-link packaging was
// abandoned). Short-circuits the app launch path; runs direct
// `better-sqlite3` against an isolated temp SQLite file inside the
// packaged binary; prints PROBE_OK / PROBE_FAIL to stdout and exits
// 0/1 BEFORE app.whenReady fires. Production launch (no flag) is
// UNCHANGED — the registrations below still execute but app.whenReady
// never resolves because process.exit terminates the process first.
if (process.argv.includes("--probe-case-box")) {
  void (async () => {
    const result = await runCaseBoxProbe();
    if (result.ok) {
      process.stdout.write(`PROBE_OK durationMs=${result.durationMs ?? 0}\n`);
      process.exit(0);
    } else {
      process.stdout.write(`PROBE_FAIL: ${result.error ?? "(unknown error)"}\n`);
      process.exit(1);
    }
  })();
}

// productName: "lawbar" → app.getPath("userData") resolves to
// ~/Library/Application Support/lawbar on macOS.
app.setName("lawbar");

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const userDataDir = app.getPath("userData");
  const preference = loadThemePreference(userDataDir);
  const systemDark = nativeTheme.shouldUseDarkColors;
  const resolved = resolveSystemMode(preference.mode, systemDark);

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: "lawbar (token fixture)",
    backgroundColor: (resolved === "dark" ? DARK_TOKENS : LIGHT_TOKENS).background,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      // sandbox: false is required for ESM preload in this WI.
      // Security boundary is preserved by contextIsolation + nodeIntegration:false +
      // the narrow contextBridge surface in preload.ts (window.lawbar.theme only).
      // A future WI may switch to a CommonJS-compiled preload + sandbox: true.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("theme:get", () => {
  const userDataDir = app.getPath("userData");
  const preference = loadThemePreference(userDataDir);
  const systemDark = nativeTheme.shouldUseDarkColors;
  const resolved = resolveSystemMode(preference.mode, systemDark);
  return { preference: preference.mode, resolved };
});

ipcMain.handle("theme:set", (_event, mode: ThemePreference) => {
  const userDataDir = app.getPath("userData");
  const systemDark = nativeTheme.shouldUseDarkColors;
  return resolveAndPersist(mode, systemDark, { userDataDir });
});

nativeTheme.on("updated", () => {
  if (mainWindow === null) return;
  const userDataDir = app.getPath("userData");
  const preference = loadThemePreference(userDataDir);
  const systemDark = nativeTheme.shouldUseDarkColors;
  const resolved = resolveSystemMode(preference.mode, systemDark);
  mainWindow.webContents.send("theme:system-change", resolved, preference.mode);
});

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Standard macOS app stays alive until Cmd-Q. For this token-fixture
  // WI we quit on all-windows-closed on all platforms (simpler test).
  app.quit();
});
