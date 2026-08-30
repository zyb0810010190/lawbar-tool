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

/**
 * Wire the readiness window: labels, button behaviour, then the state paint.
 *
 * WHAT ACTUALLY FIXES IT: the try/catch, not the ordering. Mutation testing proved this — moving the
 * state call back above the listeners fails no test, because once the call is guarded the rejection
 * never propagates and the listeners register either way. An earlier version of this comment claimed
 * the ordering was the fix; that was wrong and is corrected here rather than quietly reworded.
 *
 * The ordering is kept as defence in depth, and that is a weaker claim than it looks: it only helps
 * against a FUTURE unguarded await being introduced above these registrations. Worth having, not
 * worth mistaking for the guard.
 *
 * THE DEFECT. This previously did `paint(await api.state())` BEFORE registering any listener,
 * and `main()` is invoked as `void main()`, so a rejecting `state()` was swallowed whole: the three
 * buttons kept the labels set above them and lost every handler. A blocked owner met a window with
 * "Open Settings", "Re-check" and "Quit" all looking live and all doing nothing — including quit, so
 * the UI offered no way out at all. This is the FIRST thing a blocked owner sees and its buttons are
 * their only path forward, which makes it worse than the same defect on any ordinary screen.
 *
 * Listeners are therefore registered first. They depend on `api`, not on the state, so nothing about
 * the state call needs to succeed for them to work. `state()` is then guarded, and its failure is
 * reported in the window rather than swallowed.
 *
 * Exported for tests: `main()` runs at module scope, so there is no other seam to drive.
 */
export async function wire(api: Bridge, doc: Document = document): Promise<void> {
  const id = (k: string): HTMLElement => {
    const el = doc.getElementById(k);
    if (el === null) throw new Error(`readiness: missing #${k}`);
    return el;
  };

  id("readiness-open").addEventListener("click", () => {
    void api.openSettings();
    // Enabling FileVault happens in another app, so nothing here can observe it. Say what to do
    // next rather than leaving the window looking inert.
    id("readiness-status").textContent = t("readiness.afterOpen");
  });

  id("readiness-recheck").addEventListener("click", () => {
    id("readiness-status").textContent = t("readiness.checking");
    void api
      .recheck()
      .then((next: ReadinessState) => {
        // When it is no longer blocked, main closes this window and starts the app. Reaching the
        // line below therefore means it is still blocked.
        id("readiness-title").textContent = next.title;
        renderDetail(id("readiness-detail"), next.detail, doc);
        id("readiness-status").textContent = t("readiness.stillBlocked");
      })
      .catch(() => {
        // A re-check that throws must say so. Silence here reads as "still working", and the owner
        // would keep clicking a button that already failed.
        id("readiness-status").textContent = t("readiness.stateUnavailable");
      });
  });

  id("readiness-quit").addEventListener("click", () => {
    void api.quit();
  });

  try {
    const s = await api.state();
    id("readiness-title").textContent = s.title;
    renderDetail(id("readiness-detail"), s.detail, doc);
  } catch {
    // The buttons above are already live, so the owner still has a way out of this window.
    id("readiness-title").textContent = t("readiness.stateUnavailable");
  }
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
  await wire(api);
}

// Bootstrap only in a real document. Importing this module outside a DOM — which is what a unit
// test does — previously threw `ReferenceError: document is not defined` at module scope, so the
// exported seam could not be reached at all. A renderer entry point should be importable without
// running itself.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void main());
  } else {
    void main();
  }
}
