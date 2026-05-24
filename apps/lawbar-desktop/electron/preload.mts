import { contextBridge, ipcRenderer } from "electron";

import type {
  ResolvedTheme,
  ThemePreference,
} from "../src/theme/resolveSystemMode.js";

export interface ThemeApi {
  get(): Promise<{ preference: ThemePreference; resolved: ResolvedTheme }>;
  set(mode: ThemePreference): Promise<{ preference: ThemePreference; resolved: ResolvedTheme }>;
  onSystemChange(
    callback: (resolved: ResolvedTheme, preference: ThemePreference) => void,
  ): void;
}

const themeApi: ThemeApi = {
  get: () => ipcRenderer.invoke("theme:get"),
  set: (mode: ThemePreference) => ipcRenderer.invoke("theme:set", mode),
  onSystemChange: (callback) => {
    ipcRenderer.on(
      "theme:system-change",
      (_event, resolved: ResolvedTheme, preference: ThemePreference) => {
        callback(resolved, preference);
      },
    );
  },
};

contextBridge.exposeInMainWorld("lawbar", { theme: themeApi });
