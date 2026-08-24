// Renderer entry. Router bootstrap that mounts the case-box product UI.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §5 (renderer-internal
// relative imports allowed) + §6 (route → screen mapping).
//
// Imports renderer-internal modules ONLY. The renderer-import lint
// (`scripts/check-renderer-imports.mjs`) enforces that no import resolves to
// `src/caseBox`, `electron`, `node:*`, `case-box-persistence`, etc.

import { getDefaultApi, type CaseBoxApi } from "./api.js";
import { attachRouter, parseHash, type ParsedRoute } from "./router.js";
import { applySidebarCurrent } from "./nav.js";
import { t } from "./i18n/t.js";
import type { CatalogId } from "./i18n/catalog.js";
import { mountListMatters } from "./screens/listMatters.js";
import { mountCreateMatter } from "./screens/createMatter.js";
import { mountViewMatter } from "./screens/viewMatter.js";
import { mountArchiveMatter } from "./screens/archiveMatter.js";
import { mountEditMatter } from "./screens/editMatter.js";
import { mountSettings } from "./screens/settings.js";
import { installDevModeBanner } from "./devModeBanner.js";

type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

interface LawbarThemeApi {
  get(): Promise<{ preference: ThemePreference; resolved: ResolvedTheme }>;
  set(
    mode: ThemePreference,
  ): Promise<{ preference: ThemePreference; resolved: ResolvedTheme }>;
  onSystemChange(
    callback: (resolved: ResolvedTheme, preference: ThemePreference) => void,
  ): void;
}

declare global {
  interface Window {
    lawbar: {
      theme: LawbarThemeApi;
      // The caseBox surface is exposed by preload.mts and consumed via
      // ./api.js getDefaultApi(); typed loosely here so the renderer entry
      // doesn't need to repeat the contract.
      caseBox: unknown;
    };
  }
}

function navigate(hash: string): void {
  if (window.location.hash === hash) {
    // Re-mount even when the hash didn't change (caller intent: re-render).
    // Parse through router.ts's parseHash — the single source of truth — so the
    // re-mount path uses the exact same (strict Crockford ULID) guard as attachRouter,
    // with no duplicate route table to drift.
    void renderRoute(parseHash(hash));
    return;
  }
  window.location.hash = hash;
}

async function renderRoute(route: ParsedRoute): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app");
  if (app === null) {
    throw new Error("renderer bootstrap: #app element not found");
  }
  let api: CaseBoxApi;
  try {
    api = getDefaultApi();
  } catch (err) {
    app.textContent = t("bootstrap.error", { message: (err as Error).message });
    return;
  }

  switch (route.name) {
    case "list":
      await mountListMatters(app, { api, navigate });
      return;
    case "new":
      mountCreateMatter(app, { api, navigate });
      return;
    case "view":
      if (route.params.id === undefined) {
        navigate("#/not-found");
        return;
      }
      await mountViewMatter(app, { api, navigate }, route.params.id);
      return;
    case "archive":
      if (route.params.id === undefined) {
        navigate("#/not-found");
        return;
      }
      await mountArchiveMatter(app, { api, navigate }, route.params.id);
      return;
    case "edit":
      if (route.params.id === undefined) {
        navigate("#/not-found");
        return;
      }
      await mountEditMatter(app, { api, navigate }, route.params.id);
      return;
    case "settings":
      await mountSettings(app, { navigate });
      return;
    case "not-found":
    default:
      app.textContent = "";
      const h1 = document.createElement("h1");
      h1.textContent = t("notFound.title");
      const p = document.createElement("p");
      p.textContent = t("notFound.body");
      const a = document.createElement("a");
      a.setAttribute("href", "#/matters");
      a.textContent = t("notFound.back");
      app.appendChild(h1);
      app.appendChild(p);
      app.appendChild(a);
      return;
  }
}

function setupTheme(): void {
  const root = document.documentElement;
  void window.lawbar.theme.get().then(({ resolved }) => {
    root.setAttribute("data-theme", resolved);
  });
  window.lawbar.theme.onSystemChange((resolved) => {
    root.setAttribute("data-theme", resolved);
  });
}

// Populate the static shell chrome from the i18n catalog (WI-i18n-2). Elements carry
// `data-i18n` (textContent) / `data-i18n-aria` (aria-label) keys; values resolve via t()
// from the zh-CN catalog. A missing key throws (loud) by t()'s policy.
function applyShellI18n(d: Document): void {
  for (const node of Array.from(d.querySelectorAll("[data-i18n]"))) {
    const key = node.getAttribute("data-i18n");
    if (key !== null) node.textContent = t(key as CatalogId);
  }
  for (const node of Array.from(d.querySelectorAll("[data-i18n-aria]"))) {
    const key = node.getAttribute("data-i18n-aria");
    if (key !== null) node.setAttribute("aria-label", t(key as CatalogId));
  }
}

function bootstrap(): void {
  setupTheme();
  applyShellI18n(document);
  // Mounted ONCE, outside `#app`. The router replaces `#app` on every route change, and a warning
  // that vanishes when you navigate is not a warning. Fire-and-forget: a failure here must never
  // block the product UI from rendering.
  void installDevModeBanner(document);
  // attachRouter from ./router.js fires once on attach and then on every
  // hashchange event, so the initial route renders on load.
  attachRouter((route) => {
    // Keep the static shell sidebar's aria-current in sync with the route
    // (UISHELL-L1). Guarded so a missing sidebar (tests/headless) is a no-op.
    try {
      applySidebarCurrent(document, route.name);
    } catch {
      /* no sidebar in this context */
    }
    void renderRoute(route);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrap();
  });
} else {
  bootstrap();
}
