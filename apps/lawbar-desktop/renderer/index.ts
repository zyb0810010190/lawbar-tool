// Renderer entry. Router bootstrap that mounts the case-box product UI.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §5 (renderer-internal
// relative imports allowed) + §6 (route → screen mapping).
//
// Imports renderer-internal modules ONLY. The renderer-import lint
// (`scripts/check-renderer-imports.mjs`) enforces that no import resolves to
// `src/caseBox`, `electron`, `node:*`, `case-box-persistence`, etc.

import { getDefaultApi, type CaseBoxApi } from "./api.js";
import { attachRouter, type ParsedRoute } from "./router.js";
import { mountListMatters } from "./screens/listMatters.js";
import { mountCreateMatter } from "./screens/createMatter.js";
import { mountViewMatter } from "./screens/viewMatter.js";
import { mountArchiveMatter } from "./screens/archiveMatter.js";

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
    void renderRoute({ name: parseRouteName(hash), params: parseParams(hash) });
    return;
  }
  window.location.hash = hash;
}

function parseRouteName(hash: string): ParsedRoute["name"] {
  if (hash === "#/matters" || hash === "" || hash === "#") return "list";
  if (hash === "#/matters/new") return "new";
  if (/^#\/matters\/[0-9a-z]{26}$/.test(hash)) return "view";
  if (/^#\/matters\/[0-9a-z]{26}\/archive$/.test(hash)) return "archive";
  return "not-found";
}

function parseParams(hash: string): { id?: string } {
  const view = /^#\/matters\/([0-9a-z]{26})$/.exec(hash);
  if (view !== null) return { id: view[1] };
  const archive = /^#\/matters\/([0-9a-z]{26})\/archive$/.exec(hash);
  if (archive !== null) return { id: archive[1] };
  return {};
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
    app.textContent = `Bootstrap error: ${(err as Error).message}`;
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
    case "not-found":
    default:
      app.textContent = "";
      const h1 = document.createElement("h1");
      h1.textContent = "Not found";
      const p = document.createElement("p");
      p.textContent =
        "The requested screen does not exist or the matter ID is malformed.";
      const a = document.createElement("a");
      a.setAttribute("href", "#/matters");
      a.textContent = "Back to matters";
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

function bootstrap(): void {
  setupTheme();
  // attachRouter from ./router.js fires once on attach and then on every
  // hashchange event, so the initial route renders on load.
  attachRouter((route) => {
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
