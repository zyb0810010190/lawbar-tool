// Minimal bridge for the first-run readiness window.
//
// DELIBERATELY NARROW. The main preload exposes the whole case-box IPC surface; none of it may
// exist in a window shown BEFORE the storage precondition is met. This exposes four calls and no
// way to reach a matter, a document or the audit chain.
//
// `recheck` cannot assert that FileVault is on — it asks main to run the real probe again. A
// renderer that could declare itself ready would be the gate.

import { contextBridge, ipcRenderer } from "electron";

export interface ReadinessBridge {
  state(): Promise<unknown>;
  openSettings(): Promise<unknown>;
  recheck(): Promise<unknown>;
  quit(): Promise<unknown>;
}

const bridge: ReadinessBridge = {
  state: () => ipcRenderer.invoke("readiness:state"),
  openSettings: () => ipcRenderer.invoke("readiness:openSettings"),
  recheck: () => ipcRenderer.invoke("readiness:recheck"),
  quit: () => ipcRenderer.invoke("readiness:quit"),
};

contextBridge.exposeInMainWorld("lawbarReadiness", bridge);
