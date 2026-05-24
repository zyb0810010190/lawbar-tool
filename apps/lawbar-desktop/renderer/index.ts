// Renderer entry. ZERO imports per dev-memo/plan-first-ui-shell-00.md
// §1 rev-2. All palette values live in renderer/index.css as CSS
// custom properties; this script only toggles <html data-theme>,
// renders the 12 token panels, and calls window.lawbar.theme.* via
// the preload bridge.

type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

interface LawbarThemeApi {
  get(): Promise<{ preference: ThemePreference; resolved: ResolvedTheme }>;
  set(mode: ThemePreference): Promise<{ preference: ThemePreference; resolved: ResolvedTheme }>;
  onSystemChange(
    callback: (resolved: ResolvedTheme, preference: ThemePreference) => void,
  ): void;
}

declare global {
  interface Window {
    lawbar: { theme: LawbarThemeApi };
  }
}

const TOKENS = [
  "background",
  "surface",
  "surface-elevated",
  "text",
  "muted-text",
  "border",
  "accent",
  "text-on-accent",
  "danger",
  "warning",
  "success",
  "focus-ring",
] as const;

async function render(): Promise<void> {
  const main = document.querySelector("main");
  if (main === null) {
    throw new Error("renderer bootstrap: <main> not found");
  }

  const { resolved, preference } = await window.lawbar.theme.get();
  document.documentElement.setAttribute("data-theme", resolved);

  main.innerHTML = `
    <header>
      <h1>lawbar (token fixture)</h1>
      <p>NOT product UI. Token-compliance fixture. Mode: <span id="mode-display"></span></p>
      <div role="group" aria-label="Theme selector">
        <button type="button" data-mode="system">System</button>
        <button type="button" data-mode="light">Light</button>
        <button type="button" data-mode="dark">Dark</button>
      </div>
    </header>
    <section id="panels" aria-label="Theme tokens"></section>
  `;

  updateModeDisplay(preference, resolved);

  const panels = document.querySelector("#panels");
  if (panels === null) {
    throw new Error("renderer bootstrap: #panels not found");
  }

  panels.innerHTML = TOKENS.map((token) => `
    <article class="panel" data-token="${token}">
      <div class="swatch" style="background: var(--color-${token});" aria-hidden="true"></div>
      <h2>${token}</h2>
      <code>var(--color-${token})</code>
    </article>
  `).join("");

  document.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode as ThemePreference | undefined;
      if (mode === undefined) return;
      void (async () => {
        const result = await window.lawbar.theme.set(mode);
        document.documentElement.setAttribute("data-theme", result.resolved);
        updateModeDisplay(result.preference, result.resolved);
      })();
    });
  });

  window.lawbar.theme.onSystemChange((newResolved, newPreference) => {
    document.documentElement.setAttribute("data-theme", newResolved);
    updateModeDisplay(newPreference, newResolved);
  });
}

function updateModeDisplay(preference: ThemePreference, resolved: ResolvedTheme): void {
  const el = document.querySelector("#mode-display");
  if (el !== null) {
    el.textContent = `${preference} → ${resolved}`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void render();
  });
} else {
  void render();
}

// Force TS to treat this file as a module without emitting any
// runtime `import`. The compiled JS has zero `import` statements;
// it is a pure global script in the renderer.
export {};
