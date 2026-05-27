// renderer/dom.ts behavior tests. Pure-Node; uses an inline minimal
// MockDocument so we do not depend on jsdom.
//
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 Slice 3 scope:
//   - element creation with text + attributes
//   - class handling
//   - labeled field wiring (label for / input id)
//   - focus helper behavior
//   - ARIA live-region announce
//   - Enter/Escape keydown handler
//   - no unsafe HTML interpretation

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  el,
  field,
  setText,
  focusEl,
  focusFirst,
  announce,
  onKeydown,
} from "../dist/renderer/dom.js";

// --- Minimal MockDocument ---

class MockText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
  }
}

class MockEl {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = Object.create(null);
    this._textContent = "";
    this.listeners = Object.create(null);
    this.parentNode = null;
    this._doc = doc;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  hasAttribute(name) {
    return name in this.attributes;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  appendChild(child) {
    if (child instanceof MockText || child instanceof MockEl) {
      child.parentNode = this;
      this.children.push(child);
    }
    return child;
  }
  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this.listeners[type];
    if (list === undefined) return;
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(event) {
    const list = this.listeners[event.type] ?? [];
    for (const h of list) h(event);
  }
  focus() {
    this._doc._focused = this;
  }
  get textContent() {
    if (this._textContent !== "") return this._textContent;
    return this.children
      .map((c) => (c instanceof MockText ? c.textContent : c.textContent))
      .join("");
  }
  set textContent(v) {
    this._textContent = v;
    this.children = []; // matches real DOM behavior: setting textContent wipes children
  }
  // Tiny selector engine. Supports:
  //  - comma-separated alternatives
  //  - leading tag name optionally followed by ":not([attr])" or "[attr]" or
  //    "[attr='value']"
  // Just enough for FOCUSABLE_SELECTOR in dom.ts.
  querySelector(sel) {
    const alts = sel.split(",").map((s) => s.trim());
    return walkFind(this, alts);
  }
}

function parseAlt(alt) {
  // alt example: "input:not([disabled])", "[tabindex]:not([tabindex='-1'])"
  let tag = null;
  let rest = alt;
  const tagMatch = /^([a-z]+)/i.exec(rest);
  if (tagMatch !== null) {
    tag = tagMatch[1].toUpperCase();
    rest = rest.slice(tagMatch[0].length);
  }
  const requires = [];
  const forbids = [];
  const partRe = /(:not\(\[([^\]]+)\]\))|(\[([^\]]+)\])/g;
  let m;
  while ((m = partRe.exec(rest)) !== null) {
    if (m[2] !== undefined) {
      forbids.push(parseAttrMatch(m[2]));
    } else if (m[4] !== undefined) {
      requires.push(parseAttrMatch(m[4]));
    }
  }
  return { tag, requires, forbids };
}

function parseAttrMatch(part) {
  const eq = part.indexOf("=");
  if (eq < 0) return { name: part, value: null };
  const name = part.slice(0, eq);
  let value = part.slice(eq + 1);
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1);
  }
  return { name, value };
}

function matchesAlt(node, parsed) {
  if (parsed.tag !== null && node.tagName !== parsed.tag) return false;
  for (const r of parsed.requires) {
    if (!node.hasAttribute(r.name)) return false;
    if (r.value !== null && node.getAttribute(r.name) !== r.value) return false;
  }
  for (const f of parsed.forbids) {
    if (!node.hasAttribute(f.name)) continue;
    if (f.value === null) return false;
    if (node.getAttribute(f.name) === f.value) return false;
  }
  return true;
}

function walkFind(node, alts) {
  const parsed = alts.map(parseAlt);
  function rec(n) {
    for (const c of n.children) {
      if (c instanceof MockEl) {
        for (const p of parsed) {
          if (matchesAlt(c, p)) return c;
        }
        const r = rec(c);
        if (r !== null) return r;
      }
    }
    return null;
  }
  return rec(node);
}

class MockDoc {
  constructor() {
    this._focused = null;
  }
  createElement(tag) {
    return new MockEl(tag, this);
  }
  createTextNode(text) {
    return new MockText(text);
  }
}

// --- el() ---

test("el: creates an element with the given tag (lowercase API, uppercase tagName)", () => {
  const doc = new MockDoc();
  const node = el("div", {}, [], doc);
  assert.equal(node.tagName, "DIV");
});

test("el: sets string attributes", () => {
  const doc = new MockDoc();
  const node = el("input", { type: "text", name: "matter-name" }, [], doc);
  assert.equal(node.getAttribute("type"), "text");
  assert.equal(node.getAttribute("name"), "matter-name");
});

test("el: boolean true attribute → empty-string value", () => {
  const doc = new MockDoc();
  const node = el("input", { disabled: true }, [], doc);
  assert.equal(node.hasAttribute("disabled"), true);
  assert.equal(node.getAttribute("disabled"), "");
});

test("el: boolean false attribute → not set", () => {
  const doc = new MockDoc();
  const node = el("input", { disabled: false }, [], doc);
  assert.equal(node.hasAttribute("disabled"), false);
});

test("el: undefined attribute → skipped", () => {
  const doc = new MockDoc();
  const node = el("input", { placeholder: undefined }, [], doc);
  assert.equal(node.hasAttribute("placeholder"), false);
});

test("el: number attribute coerces to string", () => {
  const doc = new MockDoc();
  const node = el("input", { tabindex: 0 }, [], doc);
  assert.equal(node.getAttribute("tabindex"), "0");
});

test("el: class attribute set verbatim", () => {
  const doc = new MockDoc();
  const node = el("div", { class: "matter-row matter-row--active" }, [], doc);
  assert.equal(node.getAttribute("class"), "matter-row matter-row--active");
});

test("el: string children become text nodes", () => {
  const doc = new MockDoc();
  const node = el("p", {}, ["matter-fixture-A"], doc);
  assert.equal(node.children.length, 1);
  assert.ok(node.children[0] instanceof MockText);
  assert.equal(node.children[0].textContent, "matter-fixture-A");
});

test("el: element children appended verbatim", () => {
  const doc = new MockDoc();
  const span = el("span", {}, ["x"], doc);
  const node = el("p", {}, [span], doc);
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0], span);
});

test("el: null/undefined children skipped", () => {
  const doc = new MockDoc();
  const node = el("p", {}, ["a", null, undefined, "b"], doc);
  assert.equal(node.children.length, 2);
  assert.equal(node.children[0].textContent, "a");
  assert.equal(node.children[1].textContent, "b");
});

test("el: never uses innerHTML — children are real Node instances", () => {
  const doc = new MockDoc();
  // If `el` ever did `node.innerHTML = "<b>x</b>"` the mock would not catch
  // it. Instead we verify that a string child arrives as a text node — i.e.
  // the literal '<' character survives untouched.
  const node = el("p", {}, ["<script>alert(1)</script>"], doc);
  assert.equal(node.children.length, 1);
  assert.ok(node.children[0] instanceof MockText);
  assert.equal(node.children[0].textContent, "<script>alert(1)</script>");
});

// --- field() ---

test("field: wraps input + label with matching for/id", () => {
  const doc = new MockDoc();
  const input = el("input", { type: "text" }, [], doc);
  const wrap = field({ id: "matter-name", label: "Name" }, input, doc);
  assert.equal(wrap.tagName, "DIV");
  assert.equal(wrap.getAttribute("class"), "field");
  // label first, input second
  assert.equal(wrap.children[0].tagName, "LABEL");
  assert.equal(wrap.children[0].getAttribute("for"), "matter-name");
  assert.equal(wrap.children[1], input);
  assert.equal(input.getAttribute("id"), "matter-name");
});

test("field: required option sets aria-style asterisk in label + required attr on input", () => {
  const doc = new MockDoc();
  const input = el("input", { type: "text" }, [], doc);
  const wrap = field(
    { id: "name", label: "Name", required: true },
    input,
    doc,
  );
  assert.equal(input.hasAttribute("required"), true);
  // Label child is text "Name *"
  assert.equal(wrap.children[0].children[0].textContent, "Name *");
});

test("field: non-required → no asterisk, no required attr", () => {
  const doc = new MockDoc();
  const input = el("input", { type: "text" }, [], doc);
  const wrap = field({ id: "notes", label: "Notes" }, input, doc);
  assert.equal(input.hasAttribute("required"), false);
  assert.equal(wrap.children[0].children[0].textContent, "Notes");
});

// --- setText() ---

test("setText: writes textContent verbatim", () => {
  const doc = new MockDoc();
  const node = el("p", {}, [], doc);
  setText(node, "synthetic-matter-name");
  assert.equal(node.textContent, "synthetic-matter-name");
});

test("setText: HTML-looking input is preserved as text (no parsing)", () => {
  const doc = new MockDoc();
  const node = el("p", {}, [], doc);
  setText(node, "<img src=x onerror=alert(1)>");
  assert.equal(node.textContent, "<img src=x onerror=alert(1)>");
  // Confirm no child elements created
  assert.equal(node.children.length, 0);
});

// --- focusEl() ---

test("focusEl: focuses a non-null node", () => {
  const doc = new MockDoc();
  const node = el("button", {}, ["x"], doc);
  focusEl(node);
  assert.equal(doc._focused, node);
});

test("focusEl: null → no-op", () => {
  // No throw.
  assert.doesNotThrow(() => focusEl(null));
});

// --- focusFirst() ---

test("focusFirst: focuses the first focusable descendant", () => {
  const doc = new MockDoc();
  const input = el("input", { type: "text" }, [], doc);
  const root = el("form", {}, [input], doc);
  focusFirst(root);
  assert.equal(doc._focused, input);
});

test("focusFirst: skips disabled inputs", () => {
  const doc = new MockDoc();
  const disabled = el("input", { type: "text", disabled: true }, [], doc);
  const enabled = el("input", { type: "text" }, [], doc);
  const root = el("form", {}, [disabled, enabled], doc);
  focusFirst(root);
  assert.equal(doc._focused, enabled);
});

test("focusFirst: no focusable descendant → no focus change", () => {
  const doc = new MockDoc();
  const root = el("div", {}, [el("span", {}, ["plain"], doc)], doc);
  focusFirst(root);
  assert.equal(doc._focused, null);
});

// --- announce() ---

test("announce: sets textContent on the live region", () => {
  const doc = new MockDoc();
  const region = el("div", { role: "status", "aria-live": "polite" }, [], doc);
  announce(region, "Matter created");
  assert.equal(region.textContent, "Matter created");
});

test("announce: replacing prior message clears children (matches DOM textContent semantics)", () => {
  const doc = new MockDoc();
  const region = el("div", { role: "status" }, ["initial"], doc);
  announce(region, "updated");
  assert.equal(region.textContent, "updated");
  // No leftover child element with the old text content.
  assert.equal(region.children.length, 0);
});

// --- onKeydown() ---

test("onKeydown: Enter triggers onEnter", () => {
  const doc = new MockDoc();
  const root = el("form", {}, [], doc);
  let count = 0;
  onKeydown(root, { onEnter: () => count++ });
  root.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(count, 1);
});

test("onKeydown: Escape triggers onEscape", () => {
  const doc = new MockDoc();
  const root = el("form", {}, [], doc);
  let count = 0;
  onKeydown(root, { onEscape: () => count++ });
  root.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(count, 1);
});

test("onKeydown: other keys do not trigger handlers", () => {
  const doc = new MockDoc();
  const root = el("form", {}, [], doc);
  let enter = 0;
  let escape = 0;
  onKeydown(root, { onEnter: () => enter++, onEscape: () => escape++ });
  root.dispatchEvent({ type: "keydown", key: "Tab" });
  root.dispatchEvent({ type: "keydown", key: "a" });
  assert.equal(enter, 0);
  assert.equal(escape, 0);
});

test("onKeydown: returned unsubscribe removes the listener", () => {
  const doc = new MockDoc();
  const root = el("form", {}, [], doc);
  let count = 0;
  const off = onKeydown(root, { onEnter: () => count++ });
  root.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(count, 1);
  off();
  root.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(count, 1);
});

test("onKeydown: omitting onEnter/onEscape → that key is no-op", () => {
  const doc = new MockDoc();
  const root = el("form", {}, [], doc);
  assert.doesNotThrow(() => {
    onKeydown(root, {});
    root.dispatchEvent({ type: "keydown", key: "Enter" });
    root.dispatchEvent({ type: "keydown", key: "Escape" });
  });
});
