// nav.ts tests (PR3 — UISHELL-L1 dynamic sidebar aria-current).
// Pure Node; a tiny mock document with just the surface applySidebarCurrent uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { activeNavKey, applySidebarCurrent } from "../dist/renderer/nav.js";

// --- activeNavKey: route → which sidebar link is the current PAGE -------------

test("activeNavKey: list route → 'list'", () => {
  assert.equal(activeNavKey("list"), "list");
});
test("activeNavKey: new route → 'new'", () => {
  assert.equal(activeNavKey("new"), "new");
});
test("activeNavKey: detail/archive/not-found → null (no exact sidebar page)", () => {
  assert.equal(activeNavKey("view"), null);
  assert.equal(activeNavKey("archive"), null);
  assert.equal(activeNavKey("not-found"), null);
});

// --- applySidebarCurrent: drives aria-current on the matching link -----------

class MockLink {
  constructor(navKey) {
    this.attributes = { class: "sidebar-link", "data-nav": navKey };
  }
  getAttribute(n) {
    return n in this.attributes ? this.attributes[n] : null;
  }
  setAttribute(n, v) {
    this.attributes[n] = String(v);
  }
  removeAttribute(n) {
    delete this.attributes[n];
  }
}

class MockDoc {
  constructor(links) {
    this._links = links;
  }
  querySelectorAll(sel) {
    assert.equal(sel, ".sidebar-link[data-nav]");
    const arr = this._links.slice();
    arr.forEach = Array.prototype.forEach.bind(arr); // NodeList-like forEach
    return arr;
  }
}

function makeDoc() {
  return new MockDoc([new MockLink("list"), new MockLink("new")]);
}

test("applySidebarCurrent: list route marks ONLY the Matters link current", () => {
  const doc = makeDoc();
  applySidebarCurrent(doc, "list");
  assert.equal(doc._links[0].getAttribute("aria-current"), "page");
  assert.equal(doc._links[1].getAttribute("aria-current"), null);
});

test("applySidebarCurrent: new route marks ONLY the New-matter link current (UISHELL-L1)", () => {
  const doc = makeDoc();
  applySidebarCurrent(doc, "new");
  assert.equal(doc._links[0].getAttribute("aria-current"), null);
  assert.equal(doc._links[1].getAttribute("aria-current"), "page");
});

test("applySidebarCurrent: detail route clears aria-current from all links", () => {
  const doc = makeDoc();
  // Pre-set a stale current (as the old hardcoded markup would have).
  doc._links[0].setAttribute("aria-current", "page");
  applySidebarCurrent(doc, "view");
  assert.equal(doc._links[0].getAttribute("aria-current"), null);
  assert.equal(doc._links[1].getAttribute("aria-current"), null);
});

test("applySidebarCurrent: switching routes moves current, never leaves two", () => {
  const doc = makeDoc();
  applySidebarCurrent(doc, "list");
  applySidebarCurrent(doc, "new");
  const current = doc._links.filter((l) => l.getAttribute("aria-current") === "page");
  assert.equal(current.length, 1);
  assert.equal(current[0].getAttribute("data-nav"), "new");
});
