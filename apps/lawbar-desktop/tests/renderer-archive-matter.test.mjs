// archiveMatter screen tests. Pure-Node; mock document + mock api injected.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.4 + Slice 7 user scope.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountArchiveMatter } from "../dist/renderer/screens/archiveMatter.js";

const VALID_ULID = "01jzabcdef0123456789ghjkmn";

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
    this.children = [];
  }
  querySelector() {
    return null;
  }
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

// --- Traversal helpers ---

function findAll(root, predicate) {
  const out = [];
  function rec(n) {
    if (n instanceof MockEl) {
      if (predicate(n)) out.push(n);
      for (const c of n.children) rec(c);
    }
  }
  rec(root);
  return out;
}

function findOne(root, predicate) {
  const all = findAll(root, predicate);
  return all.length === 0 ? null : all[0];
}

function findByTestId(root, id) {
  return findOne(root, (n) => n.getAttribute("data-test-id") === id);
}

function findByTag(root, tag) {
  return findOne(root, (n) => n.tagName === tag.toUpperCase());
}

function collectText(node) {
  if (node === null || node === undefined) return "";
  if (node instanceof MockText) return node.textContent;
  if (node._textContent !== "") return node._textContent;
  return node.children.map(collectText).join("");
}

function fire(input, type, value) {
  input.dispatchEvent({ type, target: { value }, preventDefault: () => {} });
}

function fireClick(button) {
  button.dispatchEvent({ type: "click", preventDefault: () => {} });
}

// --- Fixtures ---

function activeMatter(overrides = {}) {
  return {
    id: VALID_ULID,
    name: "matter-fixture-A",
    matter_type: "litigation",
    status: "active",
    ...overrides,
  };
}

function makeStubApi(impl = {}) {
  return {
    createMatter: async () => ({ ok: true, value: {} }),
    getMatter: impl.getMatter ?? (async () => ({ ok: true, value: activeMatter() })),
    listMatters: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
    archiveMatter: impl.archiveMatter ?? (async () => ({ ok: true, value: activeMatter({ status: "archived" }) })),
    chainHead: async () => ({ ok: true, value: null }),
  };
}

function captureWarn(fn) {
  const original = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  return Promise.resolve(fn()).then(
    (v) => {
      console.warn = original;
      return { value: v, calls };
    },
    (err) => {
      console.warn = original;
      throw err;
    },
  );
}

// --- Tests ---

test("invalid ULID: no IPC calls; safe error rendered + back-to-list link", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let getCalls = 0;
  let archCalls = 0;
  const api = makeStubApi({
    getMatter: async () => { getCalls++; return { ok: true, value: activeMatter() }; },
    archiveMatter: async () => { archCalls++; return { ok: true, value: {} }; },
  });
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, "not-a-ulid");
  assert.equal(getCalls, 0);
  assert.equal(archCalls, 0);
  const err = findByTestId(root, "archive-invalid-id");
  assert.ok(err !== null);
  const link = findByTestId(root, "archive-back-link-list");
  assert.equal(doc._focused, link);
});

test("getMatter envelope error: safe message inline + back-to-view link + no archive call", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let archCalls = 0;
  const api = makeStubApi({
    getMatter: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "invalid payload" },
    }),
    archiveMatter: async () => { archCalls++; return { ok: true, value: {} }; },
  });
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const err = findByTestId(root, "archive-envelope-error");
  assert.ok(err !== null);
  assert.match(collectText(err), /invalid payload/);
  assert.equal(archCalls, 0);
  const back = findByTestId(root, "archive-back-link-view");
  assert.equal(doc._focused, back);
});

test("getMatter null: not-found copy + back-to-list", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({ getMatter: async () => ({ ok: true, value: null }) });
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const nf = findByTestId(root, "archive-not-found");
  assert.ok(nf !== null);
  assert.match(collectText(nf), /data is in-memory only/);
  assert.equal(doc._focused, findByTestId(root, "archive-back-link-list"));
});

test("already-archived matter: no form, no archive call, link to view", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let archCalls = 0;
  const api = makeStubApi({
    getMatter: async () => ({ ok: true, value: activeMatter({ status: "archived" }) }),
    archiveMatter: async () => { archCalls++; return { ok: true, value: {} }; },
  });
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const already = findByTestId(root, "archive-already-archived");
  assert.ok(already !== null);
  assert.equal(findByTestId(root, "archive-form"), null);
  // Even if user finds a hidden submit, no archive call has fired yet (UI absent).
  assert.equal(archCalls, 0);
  assert.equal(doc._focused, findByTestId(root, "archive-back-link-view"));
});

test("active matter: confirmation form rendered with matter name in title + reason textarea focused", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi();
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const title = findByTestId(root, "archive-title");
  assert.equal(collectText(title), "Archive matter — matter-fixture-A");
  const form = findByTestId(root, "archive-form");
  assert.ok(form !== null);
  const ta = findOne(root, (n) => n.getAttribute("id") === "am-reason");
  assert.equal(doc._focused, ta);
});

test("cancel: navigates back to view route", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi();
  await mountArchiveMatter(root, { api, navigate: (h) => navCalls.push(h), doc }, VALID_ULID);
  fireClick(findByTestId(root, "archive-cancel"));
  assert.deepEqual(navCalls, [`#/matters/${VALID_ULID}`]);
});

test("submit: empty reason blocks the archive IPC + shows inline error + focuses textarea", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let archCalls = 0;
  const api = makeStubApi({
    archiveMatter: async () => { archCalls++; return { ok: true, value: {} }; },
  });
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  fireClick(findByTestId(root, "archive-submit"));
  await new Promise((r) => setImmediate(r));
  assert.equal(archCalls, 0);
  const err = findByTestId(root, "archive-form-error");
  assert.equal(err.hasAttribute("hidden"), false);
  assert.match(collectText(err), /at least 10 characters/);
  const ta = findOne(root, (n) => n.getAttribute("id") === "am-reason");
  assert.equal(doc._focused, ta);
});

test("submit: reason shorter than 10 chars blocks", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let archCalls = 0;
  const api = makeStubApi({
    archiveMatter: async () => { archCalls++; return { ok: true, value: {} }; },
  });
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const ta = findOne(root, (n) => n.getAttribute("id") === "am-reason");
  fire(ta, "input", "tooshort");
  fireClick(findByTestId(root, "archive-submit"));
  await new Promise((r) => setImmediate(r));
  assert.equal(archCalls, 0);
  const err = findByTestId(root, "archive-form-error");
  assert.match(collectText(err), /at least 10 characters/);
});

test("submit: reason longer than 500 chars blocks", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let archCalls = 0;
  const api = makeStubApi({
    archiveMatter: async () => { archCalls++; return { ok: true, value: {} }; },
  });
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const ta = findOne(root, (n) => n.getAttribute("id") === "am-reason");
  fire(ta, "input", "a".repeat(501));
  fireClick(findByTestId(root, "archive-submit"));
  await new Promise((r) => setImmediate(r));
  assert.equal(archCalls, 0);
  const err = findByTestId(root, "archive-form-error");
  assert.match(collectText(err), /500 characters or fewer/);
});

test("submit: valid reason calls api.archiveMatter with stripped DTO + navigates to view", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const calls = [];
  const api = makeStubApi({
    archiveMatter: async (dto) => {
      calls.push(dto);
      return { ok: true, value: activeMatter({ status: "archived" }) };
    },
  });
  await mountArchiveMatter(root, { api, navigate: (h) => navCalls.push(h), doc }, VALID_ULID);
  const ta = findOne(root, (n) => n.getAttribute("id") === "am-reason");
  fire(ta, "input", "  synthetic-archive-reason-fixture  ");
  fireClick(findByTestId(root, "archive-submit"));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    matterId: VALID_ULID,
    reason: "synthetic-archive-reason-fixture", // trimmed
  });
  assert.deepEqual(navCalls, [`#/matters/${VALID_ULID}`]);
});

test("submit: archive API error preserves form + shows safe message + no navigation", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi({
    archiveMatter: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "illegal_transition", message: "illegal transition" },
    }),
  });
  await mountArchiveMatter(root, { api, navigate: (h) => navCalls.push(h), doc }, VALID_ULID);
  const ta = findOne(root, (n) => n.getAttribute("id") === "am-reason");
  fire(ta, "input", "synthetic-reason-A");
  fireClick(findByTestId(root, "archive-submit"));
  await new Promise((r) => setImmediate(r));
  const err = findByTestId(root, "archive-form-error");
  assert.equal(collectText(err), "illegal transition");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(navCalls.length, 0);
  // Form still present with the user's reason captured in state (no DOM rebuild).
  assert.ok(findByTestId(root, "archive-form") !== null);
});

test("HTML-shaped matter name in title renders as text (no parsing)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: activeMatter({ name: "<script>alert(1)</script> matter-fixture-evil" }),
    }),
  });
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const title = findByTestId(root, "archive-title");
  // Title's single text node carries the verbatim string.
  assert.equal(title.children.length, 1);
  assert.ok(title.children[0] instanceof MockText);
  assert.equal(
    title.children[0].textContent,
    "Archive matter — <script>alert(1)</script> matter-fixture-evil",
  );
});

test("HTML-shaped reason passed verbatim to API + echoed safely on error", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const calls = [];
  const api = makeStubApi({
    archiveMatter: async (dto) => {
      calls.push(dto);
      return {
        ok: false,
        error: {
          kind: "case_box_persistence_error",
          code: "invalid_payload",
          message: "<not-a-tag> safe-message-fixture",
        },
      };
    },
  });
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const ta = findOne(root, (n) => n.getAttribute("id") === "am-reason");
  fire(ta, "input", "<img src=x onerror=evil> synthetic-reason");
  fireClick(findByTestId(root, "archive-submit"));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, "<img src=x onerror=evil> synthetic-reason");
  const err = findByTestId(root, "archive-form-error");
  assert.equal(collectText(err), "<not-a-tag> safe-message-fixture");
});

test("normal valid archive emits NO console.warn", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi();
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const ta = findOne(root, (n) => n.getAttribute("id") === "am-reason");
  const captured = await captureWarn(async () => {
    fire(ta, "input", "synthetic-archive-reason-fixture");
    fireClick(findByTestId(root, "archive-submit"));
    await new Promise((r) => setImmediate(r));
  });
  assert.deepEqual(
    captured.calls,
    [],
    `unexpected console.warn: ${JSON.stringify(captured.calls)}`,
  );
});

test("submit: form 'submit' event (Enter-in-input) triggers handleSubmit + preventDefault", async () => {
  // Per audit M2: Enter-in-input must invoke handleSubmit + preventDefault,
  // NOT default browser submission.
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const calls = [];
  const api = makeStubApi({
    archiveMatter: async (dto) => {
      calls.push(dto);
      return { ok: true, value: activeMatter({ status: "archived" }) };
    },
  });
  await mountArchiveMatter(root, { api, navigate: (h) => navCalls.push(h), doc }, VALID_ULID);
  const ta = findOne(root, (n) => n.getAttribute("id") === "am-reason");
  fire(ta, "input", "synthetic-archive-reason-fixture");
  const form = findByTestId(root, "archive-form");
  let prevented = false;
  form.dispatchEvent({
    type: "submit",
    preventDefault: () => {
      prevented = true;
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(prevented, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(navCalls, [`#/matters/${VALID_ULID}`]);
});

test("submit: in-flight submit blocks a second concurrent submit (no double archive)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let resolveArchive;
  const archivePromise = new Promise((r) => { resolveArchive = r; });
  let archCalls = 0;
  const api = makeStubApi({
    archiveMatter: async (dto) => {
      archCalls++;
      await archivePromise;
      return { ok: true, value: activeMatter({ status: "archived" }) };
    },
  });
  await mountArchiveMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const ta = findOne(root, (n) => n.getAttribute("id") === "am-reason");
  fire(ta, "input", "synthetic-archive-reason-fixture");
  const submit = findByTestId(root, "archive-submit");
  fireClick(submit);
  fireClick(submit); // second click while first in-flight
  // First click registered the call; submit button disabled.
  assert.equal(archCalls, 1);
  assert.equal(submit.hasAttribute("disabled"), true);
  resolveArchive();
  await new Promise((r) => setImmediate(r));
});
