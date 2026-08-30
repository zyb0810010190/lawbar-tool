// The readiness window must not strand a blocked owner.
//
// WHY THIS EXISTS. `main()` did this:
//
//     paint(await api.state());
//     byId("readiness-open").addEventListener(...)     // and recheck, and quit
//
// The three buttons already had their LABELS set above that await. So when `api.state()` rejected —
// and `main()` is invoked as `void main()`, which swallows the rejection whole — the owner met a
// window showing "Open Settings", "Re-check" and "Quit", all looking live, none of them wired to
// anything. Including quit. The UI offered no way out of itself and said nothing about why.
//
// That is worse than the same defect on an ordinary screen, for two reasons. This is the FIRST thing
// a blocked owner sees, and those three buttons are the only path forward that exists. A dead button
// is also worse than a disabled one: disabled says "not available", live-but-inert says "I clicked
// and nothing happened", which is indistinguishable from the app being broken.
//
// WHAT ACTUALLY FIXES IT is the guard, not the ordering — established by mutation, not assumed.
// Moving the state call back above the listeners kills no test, because a guarded call cannot strand
// them. The listeners-first ordering is defence in depth against a future unguarded await appearing
// above them; it is not what makes these tests pass. Saying otherwise would be exactly the kind of
// confident-but-unverified claim this file's own subject matter is about.
//
// ON VERIFICATION. `wire()` did not exist before this change, so a red-first run against the old
// code is inconclusive — it would fail to compile, which is not evidence. Mutation is the substitute
// this repo prescribes for additive work. Two mutants were run and the RESULTS DIFFERED, which is
// the useful part: removing the guard turns two of these tests red (killed), while reordering the
// state call above the listeners kills nothing (survived). That survivor is not a coverage gap —
// it is the measurement that corrected the claim above.

import test from "node:test";
import assert from "node:assert/strict";

import { wire } from "../dist/renderer/readiness.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";

/** Minimal DOM: the five elements the readiness window addresses by id. */
function makeDoc() {
  const nodes = new Map();
  const mk = (id) => ({
    id,
    textContent: "",
    children: [],
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    click() {
      for (const fn of this.listeners.click ?? []) fn();
    },
    appendChild(c) {
      this.children.push(c);
    },
    get childCount() {
      return this.children.length;
    },
  });
  for (const id of [
    "readiness-title",
    "readiness-detail",
    "readiness-status",
    "readiness-open",
    "readiness-recheck",
    "readiness-quit",
  ]) {
    nodes.set(id, mk(id));
  }
  return {
    getElementById: (id) => nodes.get(id) ?? null,
    createElement: (tag) => ({ tag, textContent: "", children: [], appendChild(c) { this.children.push(c); } }),
    node: (id) => nodes.get(id),
  };
}

const OK_STATE = { title: "标题", detail: "详情", blocked: true };

function makeApi(over = {}) {
  return {
    state: async () => OK_STATE,
    recheck: async () => OK_STATE,
    openSettings: async () => {},
    quit: async () => {},
    ...over,
  };
}

// MARK: - The defect

test("a THROWING state() still leaves every button wired", async () => {
  const doc = makeDoc();
  let opened = 0, quit = 0, rechecked = 0;
  await wire(
    makeApi({
      state: async () => {
        throw new Error("bridge blew up");
      },
      openSettings: async () => { opened += 1; },
      quit: async () => { quit += 1; },
      recheck: async () => { rechecked += 1; return OK_STATE; },
    }),
    doc,
  );

  doc.node("readiness-open").click();
  doc.node("readiness-recheck").click();
  doc.node("readiness-quit").click();

  assert.equal(opened, 1, "Open Settings was dead after a failed state read");
  assert.equal(rechecked, 1, "Re-check was dead after a failed state read");
  assert.equal(quit, 1, "QUIT was dead — the window offered no way out of itself");
});

test("a THROWING state() says so, rather than leaving the window blank", async () => {
  const doc = makeDoc();
  await wire(makeApi({ state: async () => { throw new Error("bridge blew up"); } }), doc);
  const title = doc.node("readiness-title").textContent;
  assert.equal(title, CATALOG["readiness.stateUnavailable"],
    `the window must name the failure; got: ${JSON.stringify(title)}`);
  assert.equal(title.includes("bridge blew up"), false, "raw transport detail must not reach the owner");
});

// MARK: - The control. A guard that also fired on success would be its own defect.

test("a healthy state() paints the real title and detail", async () => {
  const doc = makeDoc();
  await wire(makeApi(), doc);
  assert.equal(doc.node("readiness-title").textContent, OK_STATE.title);
  assert.ok(doc.node("readiness-detail").childCount > 0, "the detail must be rendered");
});

test("a healthy state() leaves the buttons wired too", async () => {
  const doc = makeDoc();
  let quit = 0;
  await wire(makeApi({ quit: async () => { quit += 1; } }), doc);
  doc.node("readiness-quit").click();
  assert.equal(quit, 1);
});

// MARK: - Re-check, which is the button an owner presses repeatedly

test("a THROWING recheck() reports failure instead of leaving the status blank", async () => {
  const doc = makeDoc();
  await wire(makeApi({ recheck: async () => { throw new Error("nope"); } }), doc);
  doc.node("readiness-recheck").click();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const status = doc.node("readiness-status").textContent;
  assert.equal(status, CATALOG["readiness.stateUnavailable"],
    "a re-check that throws must say so — silence reads as 'still working' and invites re-clicking");
});

test("a successful recheck reports still-blocked, not silence", async () => {
  const doc = makeDoc();
  await wire(makeApi(), doc);
  doc.node("readiness-recheck").click();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(doc.node("readiness-status").textContent, CATALOG["readiness.stillBlocked"]);
});
