// First-run readiness page. Runs only in the pre-gate window; never in the product shell.
//
// It renders what main reports and can assert nothing itself. "Re-check" asks main to run the real
// `fdesetup` probe again — a renderer that could declare FileVault on would BE the gate.

import { t } from "./i18n/t.js";

interface ReadinessState {
  readonly fileVaultState: "on" | "off" | "unknown" | "non-macos";
  readonly blocked: boolean;
  readonly title: string;
  readonly detail: string;
}

interface Bridge {
  state(): Promise<ReadinessState>;
  openSettings(): Promise<{ ok: boolean }>;
  recheck(): Promise<ReadinessState>;
  quit(): Promise<void>;
}

function bridge(): Bridge | null {
  const w = window as unknown as { lawbarReadiness?: Bridge };
  return w.lawbarReadiness ?? null;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`readiness: missing #${id}`);
  return el;
}

/**
 * The detail text arrives as paragraphs separated by blank lines. Rendered as <p> elements via
 * textContent — never innerHTML. The string is ours, but a pre-gate window is the last place to
 * establish a habit of interpolating markup.
 */
export function renderDetail(host: HTMLElement, detail: string, doc: Document = document): void {
  host.textContent = "";
  for (const para of detail.split("\n\n")) {
    const trimmed = para.trim();
    if (trimmed === "") continue;
    const p = doc.createElement("p");
    p.textContent = trimmed;
    host.appendChild(p);
  }
}

function paint(s: ReadinessState): void {
  byId("readiness-title").textContent = s.title;
  renderDetail(byId("readiness-detail"), s.detail);
}

async function main(): Promise<void> {
  const api = bridge();
  byId("readiness-open").textContent = t("readiness.openSettings");
  byId("readiness-recheck").textContent = t("readiness.recheck");
  byId("readiness-quit").textContent = t("readiness.quit");
  if (api === null) {
    byId("readiness-title").textContent = t("readiness.bridgeMissing");
    return;
  }

  paint(await api.state());

  byId("readiness-open").addEventListener("click", () => {
    void api.openSettings();
    // Enabling FileVault happens in another app, so nothing here can observe it. Say what to do
    // next rather than leaving the window looking inert.
    byId("readiness-status").textContent = t("readiness.afterOpen");
  });

  byId("readiness-recheck").addEventListener("click", () => {
    byId("readiness-status").textContent = t("readiness.checking");
    void api.recheck().then((next) => {
      // When it is no longer blocked, main closes this window and starts the app. Reaching the
      // line below therefore means it is still blocked.
      paint(next);
      byId("readiness-status").textContent = t("readiness.stillBlocked");
    });
  });

  byId("readiness-quit").addEventListener("click", () => {
    void api.quit();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void main());
} else {
  void main();
}
