// Thin renderer DOM primitives. Pure functions over an injectable Document
// so tests can run under plain `node:test` without jsdom.
//
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §"NEW (impl WI)" dom.ts row +
// §7.3 (a11y) + §7.4 (keyboard/focus).
//
// Design rules:
//   - NEVER use `innerHTML`. User-supplied strings go through `textContent`.
//   - One Document per call; defaults to the global `document` in production.
//   - No framework abstractions. These are the smallest helpers the planned
//     screens need; nothing more.

export type AttrValue = string | number | boolean | undefined;
export type Attrs = { readonly [key: string]: AttrValue };
export type Child = Node | string | null | undefined;

// Create a typed HTML element with attributes and children. Children that are
// strings become text nodes; null/undefined are skipped. Boolean `true`
// attributes are written as empty-string attributes (`disabled=""`); `false`
// and `undefined` are skipped.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: ReadonlyArray<Child> = [],
  doc: Document = document,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === undefined || v === false) continue;
    if (v === true) {
      node.setAttribute(k, "");
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    if (typeof c === "string") {
      node.appendChild(doc.createTextNode(c));
    } else {
      node.appendChild(c);
    }
  }
  return node;
}

// Set element text safely. The single entry point for user-supplied strings.
export function setText(node: HTMLElement, text: string): void {
  node.textContent = text;
}

// Labeled-field wrapper. Per §7.3: every input MUST have an explicit
// `for`/`id` association. Caller passes the input; this helper sets the
// matching `id` on the input and constructs the wrapping label.
export interface FieldOptions {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
}

export function field(
  options: FieldOptions,
  input: HTMLElement,
  doc: Document = document,
): HTMLElement {
  input.setAttribute("id", options.id);
  if (options.required === true) {
    input.setAttribute("required", "");
  }
  const labelText = options.required === true ? `${options.label} *` : options.label;
  const labelEl = el("label", { for: options.id }, [labelText], doc);
  return el("div", { class: "field" }, [labelEl, input], doc);
}

// Move focus to an element if focusable. No-op if null.
export function focusEl(node: HTMLElement | null): void {
  if (node !== null && typeof node.focus === "function") {
    node.focus();
  }
}

// Focus the first enabled focusable descendant of `root`. Per §7.4 initial
// focus rules.
const FOCUSABLE_SELECTOR =
  "input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])";

export function focusFirst(root: HTMLElement): void {
  const first = root.querySelector(FOCUSABLE_SELECTOR);
  // Duck-type instead of `instanceof HTMLElement` so the helper is testable
  // under plain `node:test` where the global `HTMLElement` class does not
  // exist. In a real Chromium renderer this branch matches every focusable
  // element returned by querySelector.
  if (first !== null && typeof (first as { focus?: () => void }).focus === "function") {
    (first as HTMLElement).focus();
  }
}

// Announce text to a screen-reader live region. The screen owns the region;
// this helper just sets `textContent` to make a polite announcement. Per §7.3
// status-region wiring.
export function announce(region: HTMLElement, text: string): void {
  region.textContent = text;
}

// Keydown handler factory. Wires Enter and/or Escape to caller-supplied
// callbacks. Returns the unsubscribe function. Per §7.4 Esc-cancel pattern.
export interface KeydownHandlers {
  readonly onEnter?: () => void;
  readonly onEscape?: () => void;
}

export function onKeydown(root: HTMLElement, handlers: KeydownHandlers): () => void {
  const listener = (event: Event): void => {
    const ke = event as KeyboardEvent;
    if (ke.key === "Enter" && handlers.onEnter !== undefined) {
      handlers.onEnter();
    } else if (ke.key === "Escape" && handlers.onEscape !== undefined) {
      handlers.onEscape();
    }
  };
  root.addEventListener("keydown", listener);
  return () => root.removeEventListener("keydown", listener);
}
