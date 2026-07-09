// Settings screen (#/settings). Per WI-DESKTOP-ZH-CN-SETTINGS-ENTRY-00 +
// dev-memo/design/2026-07-09-desktop-zh-cn-settings-entry.md.
//
// Read-only. Surfaces the app's local-first / offline / privacy posture and a
// few dynamic facts (version, launch mode, data location, FileVault state) that
// come from the additive read-only preload bridge `window.lawbar.appInfo.get()`
// (backed by ipcMain.handle("app:info"); the FileVault state is the launch-time
// probe, never re-spawned here). This screen NEVER mutates anything.

import { el, focusEl, setText } from "../dom.js";
import { t } from "../i18n/t.js";

// The read-only app-info payload. Mirrors electron/preload.mts AppInfoApi and
// the main-process ipcMain.handle("app:info") return shape.
export interface AppInfo {
  readonly version: string;
  readonly mode: "dev" | "production";
  readonly dataDir: string;
  readonly fileVaultState: "on" | "off" | "unknown" | "non-macos";
  readonly offline: boolean;
  readonly telemetry: boolean;
}

export interface SettingsDeps {
  readonly navigate: (hash: string) => void;
  readonly doc?: Document;
  // Injectable for tests; defaults to the preload bridge in production.
  readonly getAppInfo?: () => Promise<AppInfo>;
}

function defaultGetAppInfo(): Promise<AppInfo> {
  const w = window as unknown as {
    lawbar?: { appInfo?: { get: () => Promise<AppInfo> } };
  };
  const api = w.lawbar?.appInfo;
  if (api === undefined) {
    return Promise.reject(new Error("settings: appInfo bridge unavailable"));
  }
  return api.get();
}

function row(labelText: string, valueText: string, doc: Document): HTMLElement {
  return el(
    "div",
    { class: "settings-row" },
    [
      el("span", { class: "settings-row-label" }, [labelText], doc),
      el("span", { class: "settings-row-value" }, [valueText], doc),
    ],
    doc,
  );
}

export async function mountSettings(
  root: HTMLElement,
  deps: SettingsDeps,
): Promise<void> {
  const doc = deps.doc ?? document;
  const getAppInfo = deps.getAppInfo ?? defaultGetAppInfo;

  setText(root, "");
  const title = el(
    "h1",
    { "data-test-id": "settings-title" },
    [t("settings.title")],
    doc,
  );
  const body = el(
    "div",
    { class: "settings-body", "data-test-id": "settings-body" },
    [
      el(
        "p",
        { class: "settings-loading", "data-test-id": "settings-loading" },
        [t("settings.loading")],
        doc,
      ),
    ],
    doc,
  );
  root.appendChild(title);
  root.appendChild(body);
  focusEl(title);

  let info: AppInfo;
  try {
    info = await getAppInfo();
  } catch {
    // Bridge unavailable (e.g. headless test without preload): keep the title
    // and a loading line rather than surfacing a raw error. Read-only screen.
    return;
  }

  const modeText =
    info.mode === "dev" ? t("settings.mode.dev") : t("settings.mode.production");
  const fileVaultText = t(
    info.fileVaultState === "on"
      ? "settings.fileVault.on"
      : info.fileVaultState === "off"
        ? "settings.fileVault.off"
        : info.fileVaultState === "non-macos"
          ? "settings.fileVault.non-macos"
          : "settings.fileVault.unknown",
  );

  const appSection = el(
    "section",
    { class: "settings-section", "data-test-id": "settings-section-app" },
    [
      el("h2", {}, [t("settings.section.app")], doc),
      row(t("settings.field.version"), info.version, doc),
      row(t("settings.field.mode"), modeText, doc),
    ],
    doc,
  );

  const dataSection = el(
    "section",
    { class: "settings-section", "data-test-id": "settings-section-data" },
    [
      el("h2", {}, [t("settings.section.dataPrivacy")], doc),
      row(t("settings.field.dataDir"), info.dataDir, doc),
      row(t("settings.field.localFirst"), t("settings.value.localFirst"), doc),
      row(t("settings.field.offline"), t("settings.value.offline"), doc),
      row(t("settings.field.fileVault"), fileVaultText, doc),
      el(
        "p",
        { class: "settings-note", "data-test-id": "settings-filevault-note" },
        [t("settings.fileVault.note")],
        doc,
      ),
      row(t("settings.field.privacy"), t("settings.value.privacy"), doc),
    ],
    doc,
  );

  setText(body, "");
  body.appendChild(appSection);
  body.appendChild(dataSection);
}
