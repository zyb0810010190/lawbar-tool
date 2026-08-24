// First-run security readiness window.
//
// WHY THIS EXISTS. The FileVault gate was correct and complete as a REFUSAL, and a dead end as a
// user journey: it showed an error box and quit. The owner was left with a message and nothing to
// act on, and real usage of the product stands at 2 matters and 3 audit events — an app that
// cannot be started is a sufficient explanation for that on its own.
//
// The product's first promise is not deadlines or audit search. It is "I can safely hold privileged
// local case material". Until now that promise BLOCKED usage without ever completing. This turns
// the refusal into the first step of the journey: state the condition, offer the action that fixes
// it, re-check, and proceed.
//
// THE GATE IS UNCHANGED. `decideAction` still decides, production still blocks on `off` and on
// `unknown`, and no matter can be opened until the probe returns `on`. Only the PRESENTATION of a
// blocked launch changes. If this file ever starts deciding whether to proceed, that is a bug.
//
// The window gets its OWN minimal preload. The main preload exposes the case-box IPC surface, and
// none of that may exist in a window shown before the storage precondition is met.

import { BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";

import { probeFileVault, resolveMode } from "../src/security/fileVaultProbe.js";
import {
  FILEVAULT_SETTINGS_URL,
  READINESS_CHANNEL,
  isAllowedSettingsUrl,
  readinessState,
  type ReadinessState,
} from "../src/security/readinessState.js";

// Re-exported so the Electron layer stays the single import site for callers in electron/.
export { FILEVAULT_SETTINGS_URL, READINESS_CHANNEL, isAllowedSettingsUrl, readinessState };
export type { ReadinessState };

export interface ReadinessHost {
  readonly onProceed: () => void;
  readonly onQuit: () => void;
  readonly dirname: string;
  readonly backgroundColor: string;
}

/**
 * Show the readiness window. Resolves when it closes.
 *
 * Re-checking re-runs the REAL probe rather than trusting anything the window sends. The renderer
 * cannot assert that FileVault is on; it can only ask main to look again.
 */
export function openReadinessWindow(host: ReadinessHost): BrowserWindow {
  const win = new BrowserWindow({
    width: 620,
    height: 620,
    resizable: false,
    title: "lawbar",
    backgroundColor: host.backgroundColor,
    webPreferences: {
      preload: path.join(host.dirname, "readinessPreload.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const send = async (): Promise<ReadinessState> => {
    const mode = resolveMode(process.env);
    const probe = await probeFileVault();
    return readinessState(probe.state, mode, probe.error);
  };

  ipcMain.handle(READINESS_CHANNEL.state, send);

  ipcMain.handle(READINESS_CHANNEL.openSettings, async () => {
    if (!isAllowedSettingsUrl(FILEVAULT_SETTINGS_URL)) return { ok: false };
    await shell.openExternal(FILEVAULT_SETTINGS_URL);
    return { ok: true };
  });

  // The ONLY path out of the block, and it goes through the real probe. If it still says blocked,
  // the window stays and reports what it found.
  ipcMain.handle(READINESS_CHANNEL.recheck, async () => {
    const next = await send();
    if (!next.blocked) {
      win.close();
      host.onProceed();
    }
    return next;
  });

  ipcMain.handle(READINESS_CHANNEL.quit, () => {
    win.close();
    host.onQuit();
  });

  void win.loadFile(path.join(host.dirname, "../renderer/readiness.html"));
  return win;
}

/** Remove the handlers, so a second window does not double-register them. */
export function disposeReadinessHandlers(): void {
  for (const c of Object.values(READINESS_CHANNEL)) ipcMain.removeHandler(c);
}
