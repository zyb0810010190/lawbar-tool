// The renderer's last-resort notice for a promise rejection nothing caught.
//
// The main process has had `uncaughtException` and `unhandledRejection` handlers since the
// crash-dialog work; the renderer had neither, while carrying 42 fire-and-forget call sites. A
// rejection from any of them produced no dialog, no visible console entry, and no change on screen.
// The guard sweep closed every `await api.*` that could reject. This catches what the sweep did not
// find and what gets added later.
//
// THE ASSERTION THAT MATTERS MOST IS THE NEGATIVE ONE. This app now holds real client matters. A
// rejection reason is assembled from whatever the failing code was holding — a matter name, a party
// name, a document title, a validation message quoting a field the lawyer typed. A banner is a
// surface that gets photographed, screen-shared and pasted into bug reports. So the reason must
// never be rendered, and that is asserted with a reason string containing a plausible client name
// rather than a generic one, because a test using "boom" would pass against an implementation that
// happily prints client text.

import test from "node:test";
import assert from "node:assert/strict";

import {
  showRejectionNotice,
  installUnhandledRejectionNotice,
  REJECTION_NOTICE_TEST_ID,
} from "../dist/renderer/unhandledRejectionNotice.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";

/** Minimal document: a body that collects children, and querySelector over data-test-id. */
function makeDoc() {
  const body = { children: [], appendChild(c) { this.children.push(c); } };
  const doc = {
    body,
    createElement: (tag) => ({
      tag,
      attributes: {},
      children: [],
      textContent: "",
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      appendChild(c) { this.children.push(c); },
    }),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    querySelector: (sel) => {
      const m = /\[data-test-id="([^"]+)"\]/.exec(sel);
      if (m === null) return null;
      return body.children.find((c) => c.attributes?.["data-test-id"] === m[1]) ?? null;
    },
  };
  return doc;
}

const text = (node) => {
  if (node === null || node === undefined) return "";
  if (typeof node.textContent === "string" && node.children?.length === 0) return node.textContent;
  return (node.children ?? []).map(text).join("") + (node.textContent ?? "");
};

const notice = (doc) => doc.querySelector(`[data-test-id="${REJECTION_NOTICE_TEST_ID}"]`);

// MARK: - It appears at all

test("a rejection renders a notice", () => {
  const doc = makeDoc();
  showRejectionNotice(doc);
  assert.ok(notice(doc) !== null, "nothing was rendered for an unhandled rejection");
});

test("the notice is announced, not merely printed", () => {
  const doc = makeDoc();
  showRejectionNotice(doc);
  assert.equal(notice(doc).getAttribute("role"), "alert");
});

test("the copy is the catalog value, in zh-CN", () => {
  const doc = makeDoc();
  showRejectionNotice(doc);
  assert.equal(text(notice(doc)).trim(), CATALOG["rejection.notice"].trim());
  assert.match(CATALOG["rejection.notice"], /[一-鿿]/);
});

// MARK: - It must never carry client text

test("the notice does NOT render the rejection reason", () => {
  const doc = makeDoc();
  // A reason shaped like one this app would actually produce: it names a matter and a party.
  showRejectionNotice(doc, "listDocuments failed for matter 陈某某诉某公司 party 陈某某");
  const rendered = text(notice(doc));
  assert.equal(rendered.includes("陈某某"), false,
    "a client name reached a banner that gets photographed and pasted into bug reports");
  assert.equal(rendered.includes("listDocuments"), false, "internal call names must not surface either");
  assert.equal(rendered.trim(), CATALOG["rejection.notice"].trim(),
    "the notice must be exactly the fixed copy — anything variable is a leak surface");
});

// MARK: - It must not become the problem

test("repeated rejections produce ONE notice, not a wall of them", () => {
  const doc = makeDoc();
  for (let i = 0; i < 5; i += 1) showRejectionNotice(doc);
  const all = doc.body.children.filter(
    (c) => c.attributes?.["data-test-id"] === REJECTION_NOTICE_TEST_ID,
  );
  assert.equal(all.length, 1, `a retry loop would bury the app in banners; got ${all.length}`);
});

test("a document with no body does not throw — the handler runs when things are already broken", () => {
  assert.doesNotThrow(() => showRejectionNotice({ body: null }));
  assert.doesNotThrow(() => showRejectionNotice({}));
});

// MARK: - Installation

test("installing registers exactly one listener for unhandledrejection", () => {
  const doc = makeDoc();
  const events = [];
  const win = { addEventListener: (type) => events.push(type) };
  assert.equal(installUnhandledRejectionNotice(win, doc), true);
  assert.deepEqual(events, ["unhandledrejection"]);
});

test("installing twice does not double-register", () => {
  const doc = makeDoc();
  const events = [];
  const win = { addEventListener: (type) => events.push(type) };
  installUnhandledRejectionNotice(win, doc);
  assert.equal(installUnhandledRejectionNotice(win, doc), false, "the second install must be a no-op");
  assert.equal(events.length, 1, "a doubled listener would render, then dedupe — wasted work and a race");
});

test("a window without addEventListener is refused rather than throwing", () => {
  assert.equal(installUnhandledRejectionNotice({}, makeDoc()), false);
});

test("the registered handler renders the notice and suppresses default reporting", () => {
  const doc = makeDoc();
  let handler = null;
  const win = { addEventListener: (_t, fn) => { handler = fn; } };
  installUnhandledRejectionNotice(win, doc);

  let prevented = 0;
  handler({ reason: new Error("matter 陈某某 blew up"), preventDefault: () => { prevented += 1; } });

  assert.ok(notice(doc) !== null, "the handler did not render anything");
  assert.equal(prevented, 1, "default console reporting must be suppressed — the reason may carry client text");
  assert.equal(text(notice(doc)).includes("陈某某"), false);
});
