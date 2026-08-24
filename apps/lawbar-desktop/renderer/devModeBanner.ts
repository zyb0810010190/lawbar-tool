// Persistent dev-mode banner.
//
// WHY THIS EXISTS. `LAWBAR_MODE=dev` disables the Tier 1 FileVault gate — the one precondition
// protecting privileged client material at rest. Until now the only way to tell you were in dev
// mode was to open Settings and read a field, and the blocking dialog itself used to offer the flag
// as a remedy. A mode that weakens a confidentiality control must not be something you can be in
// without noticing.
//
// So this is deliberately unmissable and NOT dismissable. A banner you can close is a banner that
// gets closed once and never seen again, which is exactly the failure it exists to prevent.
//
// It also carries the data directory, because the safe way to use dev mode is against a SEPARATE
// profile holding only synthetic matters (see scripts/evaluate.mjs). Showing the path is what lets
// you confirm at a glance which store you are actually looking at — the distinction that matters
// most if two windows are ever open.
//
// UI-layer only: no new IPC channel, no contract change. It reads the existing read-only
// `app:info` bridge that Settings already consumes.

import { el, setText } from "./dom.js";
import { t } from "./i18n/t.js";
import type { AppInfo } from "./screens/settings.js";

export interface DevModeBannerDeps {
  readonly doc?: Document;
  // Injectable for tests; defaults to the preload bridge.
  readonly getAppInfo?: () => Promise<AppInfo>;
}

function defaultGetAppInfo(): Promise<AppInfo> {
  const w = window as unknown as {
    lawbar?: { appInfo?: { get: () => Promise<AppInfo> } };
  };
  const api = w.lawbar?.appInfo;
  if (api === undefined) {
    return Promise.reject(new Error("devModeBanner: appInfo bridge unavailable"));
  }
  return api.get();
}

/**
 * Mount the banner into `host` when the app is running in dev mode. Renders nothing in production.
 *
 * Fails SILENTLY if app-info is unavailable. That direction is deliberate and worth stating: the
 * banner is a warning, and a broken warning must not take the application down with it. The
 * asymmetry is safe because the absence of the banner is not read as an assurance — production is
 * the default and the unmarked state.
 */
export async function mountDevModeBanner(
  host: HTMLElement,
  deps: DevModeBannerDeps = {},
): Promise<void> {
  const doc = deps.doc ?? document;
  let info: AppInfo;
  try {
    info = await (deps.getAppInfo ?? defaultGetAppInfo)();
  } catch {
    return;
  }
  if (info.mode !== "dev") return;

  const banner = el(
    "div",
    {
      class: "dev-mode-banner",
      "data-test-id": "dev-mode-banner",
      // `alert`, not `status`: this is not incidental information, and assistive tech should
      // surface it without waiting to be asked.
      role: "alert",
    },
    [],
    doc,
  );

  banner.appendChild(
    el("strong", { class: "dev-mode-banner-title" }, [t("devMode.banner.title")], doc),
  );
  banner.appendChild(
    el("span", { class: "dev-mode-banner-body" }, [t("devMode.banner.body")], doc),
  );
  banner.appendChild(
    el(
      "span",
      { class: "dev-mode-banner-path", "data-test-id": "dev-mode-banner-path" },
      [t("devMode.banner.dataDir", { dir: info.dataDir })],
      doc,
    ),
  );

  host.appendChild(banner);
}

// Exported for the shell bootstrap: the banner lives OUTSIDE `#app`, because the router replaces
// that element's contents on every route change and a warning that disappears when you navigate is
// not a warning.
export function devModeBannerHost(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(".app-window");
}

/** Convenience used by the renderer entry; separated so the mount point is testable. */
export async function installDevModeBanner(
  doc: Document,
  deps: DevModeBannerDeps = {},
): Promise<void> {
  const host = devModeBannerHost(doc);
  if (host === null) return;
  await mountDevModeBanner(host, { ...deps, doc });
}
