import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadThemePreference } from "../src/persistence/themePreference.js";
import {
  decideAction,
  probeFileVault,
  resolveMode,
} from "../src/security/fileVaultProbe.js";
import { resolveAndPersist } from "../src/theme/applyTheme.js";
import {
  resolveSystemMode,
  type ThemePreference,
} from "../src/theme/resolveSystemMode.js";
import { DARK_TOKENS, LIGHT_TOKENS } from "../src/theme/tokens.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Tier 1 FileVault enforcement (per dev-memo/plan-encryption-at-rest-00.md
// §4.1). Runs at app launch BEFORE the first BrowserWindow opens. In
// production mode (default; LAWBAR_MODE unset or != "dev"), a missing or
// indeterminate FileVault state blocks launch with a dialog and quits.
// In dev mode (LAWBAR_MODE=dev), the same condition logs a warning to
// stderr and proceeds. Non-macOS platforms skip the check entirely.
void app.whenReady().then(async () => {
  const mode = resolveMode(process.env);
  const probe = await probeFileVault();
  const action = decideAction(probe.state, mode);
  if (action === "block") {
    const detail =
      `lawbar requires FileVault to be enabled before launch in production mode.\n\n` +
      `Detected state: ${probe.state}\n` +
      (probe.error !== undefined ? `Probe error: ${probe.error}\n\n` : "\n") +
      `Enable FileVault in System Settings → Privacy & Security → FileVault, ` +
      `or set LAWBAR_MODE=dev for development builds.`;
    dialog.showErrorBox("FileVault required", detail);
    app.quit();
    return;
  }
  if (action === "warn") {
    process.stderr.write(
      `[lawbar:fileVault] WARNING — FileVault state=${probe.state}; ` +
        `running in dev mode (LAWBAR_MODE=dev). Production launch would block.\n`,
    );
  }
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
