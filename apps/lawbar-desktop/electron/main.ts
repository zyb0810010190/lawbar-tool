import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { closeCaseBoxRuntime, getCaseBoxRuntime } from "../src/caseBox/caseBoxRuntime.js";
import { acquireOrExit } from "../src/caseBox/startupFailure.js";
import { describeUnexpectedFailure } from "../src/caseBox/unexpectedFailure.js";
import { registerCaseBoxIpcHandlers } from "./ipc/caseBoxHandlers.js";
import {
  BACKUP_CHANNEL, backupRunHandler, backupStatusHandler,
} from "../src/backup/backupHandlers.js";
import type { BackupCapableDb } from "../src/backup/runBackup.js";
import { CURRENT_SCHEMA_VERSION } from "case-box-persistence";
import { makeStoreFile } from "../src/caseBox/documentStorage.js";
import { loadThemePreference } from "../src/persistence/themePreference.js";
import {
  decideAction,
  fileVaultBlockMessage,
  probeFileVault,
  resolveMode,
} from "../src/security/fileVaultProbe.js";
import { openReadinessWindow, disposeReadinessHandlers } from "./readiness.js";
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

// The one fact the crash handler below can honestly report. Set ONLY after the runtime is actually
// acquired — an optimistic flag here would turn the message into a guess.
let caseBoxOpened = false;

// Last-resort handlers. Installed at module load, BEFORE app.whenReady, so a throw during startup
// is covered too — the incident that prompted this was a throw in a BrowserWindow listener during
// the pre-gate window. Electron's default is a raw stack dialog, which tells a litigator nothing.
//
// These deliberately QUIT. Continuing after an unexpected throw would leave the app running in a
// state nothing has reasoned about, holding privileged material.
function reportAndQuit(err: unknown): void {
  try {
    const { title, detail } = describeUnexpectedFailure(err, { caseBoxOpened });
    dialog.showErrorBox(title, detail);
  } catch {
    // The reporter itself failing must not replace one crash with another and no message at all.
    process.stderr.write(`[lawbar] unexpected failure, and the reporter also failed: ${String(err)}\n`);
  }
  app.quit();
}

process.on("uncaughtException", reportAndQuit);
process.on("unhandledRejection", reportAndQuit);

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
      // window.lawbar.theme + window.lawbar.caseBox + window.lawbar.appInfo
      // [read-only]; each new surface is a separately authorized + audited WI).
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

// App-info bridge state (WI-DESKTOP-ZH-CN-SETTINGS-ENTRY-00). The FileVault
// state and launch mode are captured ONCE at app.whenReady() below and cached
// here; app:info NEVER re-spawns fdesetup (review-plan M1). version + dataDir
// are cheap synchronous Electron calls. Read-only; no writes.
let cachedFileVaultState: "on" | "off" | "unknown" | "non-macos" = "unknown";
let cachedLaunchMode: "dev" | "production" = "production";

ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  mode: cachedLaunchMode,
  dataDir: app.getPath("userData"),
  fileVaultState: cachedFileVaultState,
  offline: true,
  telemetry: false,
}));

// Tier 1 FileVault enforcement (per dev-memo/plan-encryption-at-rest-00.md
// §4.1). Runs at app launch BEFORE the first BrowserWindow opens. In
// production mode (default; LAWBAR_MODE unset or != "dev"), a missing or
// indeterminate FileVault state blocks launch with a dialog and quits.
// In dev mode (LAWBAR_MODE=dev), the same condition logs a warning to
// stderr and proceeds. Non-macOS platforms skip the check entirely.
// Everything after the gate. Extracted so it can be started EITHER immediately, when the
// precondition already holds, OR by the readiness window once a re-check clears it. The gate
// itself is unchanged and still lives below.
async function startProduct(): Promise<void> {
  const userDataDir = app.getPath("userData");
  // WI-07. This call refuses to open a database that is corrupt, locked, foreign or
  // unreachable. It sat outside any try, so each of those threw unhandled inside
  // `whenReady` and the litigator got no window and no reason. Same shape as the FileVault
  // gate above: tell the user, then quit cleanly.
  const caseBoxRuntime = acquireOrExit(() => getCaseBoxRuntime({ userDataDir }), {
    showErrorBox: (title, content) => dialog.showErrorBox(title, content),
    quit: () => app.quit(),
  });
  if (caseBoxRuntime === null) return;
  caseBoxOpened = true;
  // Document files live in an app-controlled directory beside the SQLite DB.
  const documentStorageRoot = path.join(userDataDir, "case-box-documents");
  // Backup (WI-BACKUP-2). Registered here because this is where the LIVE database handle exists:
  // `caseBoxRuntime.db` is the handle the app already holds, and `db.backup()` snapshots through
  // it rather than opening a second one. Opening a hot-WAL database read-write would checkpoint
  // it on close and mutate the evidence being preserved.
  //
  // The destination chooser lives HERE, not in the renderer. `backup:run` takes no argument.
  const backupDeps = {
    userDataDir,
    documentsRoot: path.join(userDataDir, "case-box-documents"),
    appVersion: app.getVersion(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // `BackupCapableDb` is the narrow slice of better-sqlite3 the engine needs (`backup`,
    // `prepare`, `pragma`). The runtime handle satisfies it structurally; the cast names that
    // rather than widening the engine's dependency to the whole driver.
    getDb: (): BackupCapableDb => caseBoxRuntime.db as unknown as BackupCapableDb,
    openBackupDb: (file: string) =>
      new (caseBoxRuntime.db.constructor as new (p: string, o?: unknown) => unknown)(file, {
        readonly: true,
      }) as BackupCapableDb & { pragma?: (s: string, o?: unknown) => unknown },
    chooseDestination: async (): Promise<string | null> => {
      const win = mainWindow ?? undefined;
      const opts = {
        properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
        message: "选择备份位置（建议使用外部磁盘）",
      };
      const result =
        win !== undefined ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    },
  };
  ipcMain.handle(BACKUP_CHANNEL.status, () => backupStatusHandler(backupDeps));
  ipcMain.handle(BACKUP_CHANNEL.run, () => backupRunHandler(backupDeps));

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
}

// Tier 1 FileVault enforcement (per dev-memo/plan-encryption-at-rest-00.md §4.1). Runs BEFORE the
// first product window. Production (default) blocks on a missing or indeterminate FileVault state;
// dev warns and proceeds; non-macOS skips.
//
// A BLOCK no longer quits into an error box. It opens the readiness window, which states the
// condition, offers the action that fixes it, and re-checks. `decideAction` still decides — the
// window cannot proceed on its own, only ask main to probe again.
void app.whenReady().then(async () => {
  const mode = resolveMode(process.env);
  const probe = await probeFileVault();
  const action = decideAction(probe.state, mode);
  cachedLaunchMode = mode;
  cachedFileVaultState = probe.state;

  if (action === "block") {
    openReadinessWindow({
      dirname: __dirname,
      backgroundColor: (nativeTheme.shouldUseDarkColors ? DARK_TOKENS : LIGHT_TOKENS).background,
      onProceed: () => {
        disposeReadinessHandlers();
        cachedFileVaultState = "on";
        void startProduct();
      },
      onQuit: () => {
        disposeReadinessHandlers();
        app.quit();
      },
    });
    return;
  }

  if (action === "warn") {
    process.stderr.write(
      `[lawbar:fileVault] WARNING — FileVault state=${probe.state}; ` +
        `running in dev mode (LAWBAR_MODE=dev). Production launch would block.\n`,
    );
  }
  await startProduct();
}).catch((err: unknown) => {
  // Without this the whole startup path could throw and leave a live process with no window
  // and no message — which is exactly what happened the first time this ran.
  process.stderr.write(`[lawbar:startup] failed: ${String(err)}\n`);
});

app.on("window-all-closed", () => {
  // Standard macOS app stays alive until Cmd-Q. For this token-fixture
  // WI we quit on all-windows-closed on all platforms (simpler test).
  app.quit();
});

app.on("before-quit", () => {
  closeCaseBoxRuntime();
});
