import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { closeCaseBoxRuntime, getCaseBoxRuntime } from "../src/caseBox/caseBoxRuntime.js";
import { registerCaseBoxIpcHandlers } from "./ipc/caseBoxHandlers.js";
import { makeStoreFile } from "../src/caseBox/documentStorage.js";
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
      // the narrow contextBridge surface in preload.mts (currently
      // window.lawbar.theme + window.lawbar.caseBox; each new surface is
      // a separately authorized + audited WI).
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
  const userDataDir = app.getPath("userData");
  const caseBoxRuntime = getCaseBoxRuntime({ userDataDir });
  // Document files live in an app-controlled directory beside the SQLite DB.
  const documentStorageRoot = path.join(userDataDir, "case-box-documents");
  registerCaseBoxIpcHandlers({
    persistenceProvider: () => caseBoxRuntime,
    storeDocumentFile: makeStoreFile(documentStorageRoot),
    // Open a single-file chooser in main; the renderer never supplies a path.
    chooseDocumentFile: async () => {
      const win = mainWindow ?? undefined;
      const result =
        win !== undefined
          ? await dialog.showOpenDialog(win, { properties: ["openFile"] })
          : await dialog.showOpenDialog({ properties: ["openFile"] });
      if (result.canceled || result.filePaths.length === 0) return null;
      const sourcePath = result.filePaths[0];
      return { sourcePath, filename: path.basename(sourcePath) };
    },
    // T3 DOCX export delivery (WI-FORMS-T3-S3): main owns the save dialog + write; the
    // renderer never handles raw `.docx` bytes. The OS dialog owns overwrite
    // confirmation; the default filename ends in `.docx` and the filter is DOCX.
    t3ExportDeps: {
      showSaveDialog: async ({ defaultFileName }) => {
        const win = mainWindow ?? undefined;
        const options = {
          defaultPath: defaultFileName,
          filters: [{ name: "Word 文档", extensions: ["docx"] }],
        };
        const result =
          win !== undefined
            ? await dialog.showSaveDialog(win, options)
            : await dialog.showSaveDialog(options);
        return { canceled: result.canceled, filePath: result.filePath ?? null };
      },
      writeFile: async (filePath, data) => {
        await writeFile(filePath, data);
      },
    },
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Tarball PoC env-gated test hook. Per dev-memo/plan-desktop-pkg-arch-
  // tarball-poc-01.md (rev-0.3 at 1d04256) §6.1: when
  // LAWBAR_TARBALL_POC_TEST_HOOK=true (set ONLY by the wrapper-driven
  // test in tests/tarball-poc.electron.test.mjs), lazily install a probe
  // function on globalThis that the test invokes via app.evaluate. The
  // dynamic import below runs in the main process's NATIVE ESM loader
  // (NOT in app.evaluate's vm context) — this is the load-bearing
  // bypass for parent §26 step 3 ESM evidence-2 blocker. Production
  // launches (env var unset; default) install nothing.
  if (process.env.LAWBAR_TARBALL_POC_TEST_HOOK === "true") {
    const { runTarballPocProbe } = await import("../src/tarball-poc/probe.js");
    (globalThis as { __lawbarTarballPocProbe?: typeof runTarballPocProbe }).__lawbarTarballPocProbe = runTarballPocProbe;
  }

  // D1 link round-trip test seed hook (WI-A3-LINK-D1-ROUNDTRIP-T1; ADR
  // ADR-evidence-a3-link-d1-roundtrip-closure rev-1 §0/§11). DEFAULT-OFF: when
  // (and only when) LAWBAR_CASEBOX_LINK_SEED_TEST_HOOK=true (set ONLY by the
  // wrapper-driven tests/casebox-link-roundtrip.electron.test.mjs), lazily install
  // a fixed-fixture seed function on globalThis that the test invokes via
  // app.evaluate. The dynamic import runs in main's NATIVE ESM loader (NOT in
  // app.evaluate's vm). It registers NO IPC channel, NO preload/contextBridge
  // surface, NO renderer global, and accepts no raw SQL / arbitrary path / payload
  // (see src/caseBox/testSeed/linkRoundtripSeed.ts). Production launches (env var
  // unset; default) install nothing and never import the seed module.
  if (process.env.LAWBAR_CASEBOX_LINK_SEED_TEST_HOOK === "true") {
    const { seedLinkRoundtripFixture } = await import("../src/caseBox/testSeed/linkRoundtripSeed.js");
    (globalThis as { __lawbarCaseBoxLinkSeed?: typeof seedLinkRoundtripFixture }).__lawbarCaseBoxLinkSeed =
      seedLinkRoundtripFixture;
  }
});

app.on("window-all-closed", () => {
  // Standard macOS app stays alive until Cmd-Q. For this token-fixture
  // WI we quit on all-windows-closed on all platforms (simpler test).
  app.quit();
});

app.on("before-quit", () => {
  closeCaseBoxRuntime();
});
