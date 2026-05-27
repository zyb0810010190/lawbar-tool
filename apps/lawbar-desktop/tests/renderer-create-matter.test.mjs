// createMatter screen tests. Pure-Node; mock document + mock api injected.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.2 + Slice 5 user scope.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountCreateMatter } from "../dist/renderer/screens/createMatter.js";

const NEW_ULID = "01jzcreatemattercreatedfix0";

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
  // The screen calls `newRow.querySelector('#id')`. Support id-selector only.
  querySelector(sel) {
    if (typeof sel === "string" && sel.startsWith("#")) {
      const id = sel.slice(1);
      function walk(node) {
        for (const c of node.children) {
          if (c instanceof MockEl) {
            if (c.getAttribute("id") === id) return c;
            const r = walk(c);
            if (r !== null) return r;
          }
        }
        return null;
      }
      return walk(this);
    }
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

// --- DOM traversal helpers ---

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

function findInputById(root, id) {
  return findOne(root, (n) => n.getAttribute("id") === id);
}

function collectText(node) {
  if (node === null || node === undefined) return "";
  if (node instanceof MockText) return node.textContent;
  if (node._textContent !== "") return node._textContent;
  return node.children.map(collectText).join("");
}

function fire(input, type, value) {
  input.dispatchEvent({
    type,
    target: { value },
    preventDefault: () => {},
  });
}

function fireClick(button) {
  button.dispatchEvent({ type: "click", preventDefault: () => {} });
}

// --- Stub api ---

function makeStubApi(impl = {}) {
  return {
    createMatter: impl.createMatter ?? (async (dto) => ({ ok: true, value: { id: NEW_ULID, ...dto } })),
    getMatter: async () => ({ ok: true, value: null }),
    listMatters: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
    archiveMatter: async () => ({ ok: true, value: {} }),
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

// Fills a known-valid form. Returns nothing; mutates the form.
function fillValidForm(root) {
  fire(findInputById(root, "cm-name"), "input", "matter-fixture-A");
  fireClick(findOne(root, (n) =>
    n.getAttribute("name") === "matter_type" &&
    n.getAttribute("value") === "litigation",
  ));
  fire(findInputById(root, "cm-jurisdiction-value"), "input", "test-jx");
  const firstRow = findAll(root, (n) =>
    n.getAttribute("data-test-id") === "party-row",
  )[0];
  fire(findInputById(firstRow, "cm-party-0-role"), "input", "client");
  fire(findInputById(firstRow, "cm-party-0-display-name"), "input", "syn-party-A");
  fire(findInputById(firstRow, "cm-party-0-party-kind"), "input", "individual");
  fireClick(findOne(root, (n) =>
    n.getAttribute("name") === "confidentiality_class" &&
    n.getAttribute("value") === "normal",
  ));
}

// --- Tests ---

test("mount: renders the New matter title + form scaffold", () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi();
  mountCreateMatter(root, { api, navigate: () => {}, doc });
  const h1 = findOne(root, (n) => n.tagName === "H1");
  assert.equal(collectText(h1), "New matter");
  const form = findByTestId(root, "create-form");
  assert.ok(form !== null);
  assert.equal(form.tagName, "FORM");
});

test("mount: field wiring — every required input has matching id + label[for]", () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  mountCreateMatter(root, { api: makeStubApi(), navigate: () => {}, doc });
  const expectedIds = [
    "cm-name",
    "cm-jurisdiction-value",
    "cm-jurisdiction-locked",
    "cm-party-0-role",
    "cm-party-0-display-name",
    "cm-party-0-party-kind",
    "cm-party-0-notes",
    "cm-retainer-scope",
    "cm-case-type-text",
    "cm-case-progress-text",
    "cm-court-contact-text",
    "cm-contention-summary-text",
  ];
  for (const id of expectedIds) {
    const input = findInputById(root, id);
    assert.ok(input !== null, `missing input id=${id}`);
    const label = findOne(root, (n) =>
      n.tagName === "LABEL" && n.getAttribute("for") === id,
    );
    assert.ok(label !== null, `missing label for=${id}`);
  }
});

test("mount: initial focus moves to the Name input", () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  mountCreateMatter(root, { api: makeStubApi(), navigate: () => {}, doc });
  assert.equal(doc._focused, findInputById(root, "cm-name"));
});

test("submit: valid form calls api.createMatter with stripped + trimmed DTO", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const calls = [];
  const api = makeStubApi({
    createMatter: async (dto) => {
      calls.push(dto);
      return { ok: true, value: { id: NEW_ULID } };
    },
  });
  mountCreateMatter(root, { api, navigate: () => {}, doc });
  fillValidForm(root);
  // Add some whitespace to confirm trim.
  fire(findInputById(root, "cm-name"), "input", "  matter-fixture-A  ");
  fire(findInputById(root, "cm-jurisdiction-value"), "input", " test-jx ");
  fireClick(findByTestId(root, "create-submit"));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  const dto = calls[0];
  assert.equal(dto.name, "matter-fixture-A");
  assert.equal(dto.matter_type, "litigation");
  assert.equal(dto.jurisdiction.value, "test-jx");
  assert.equal(dto.jurisdiction.locked, false);
  assert.equal(dto.confidentiality_class, "normal");
  assert.equal(dto.parties.length, 1);
  assert.deepEqual(dto.parties[0], {
    role: "client",
    display_name: "syn-party-A",
    party_kind: "individual",
  });
  // Empty optional fields MUST NOT appear.
  assert.equal("retainer_scope" in dto, false);
  assert.equal("case_type_text" in dto, false);
  assert.equal("contention_summary_text" in dto, false);
});

test("submit: success → navigate to #/matters/:id of returned matter", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi({
    createMatter: async () => ({ ok: true, value: { id: NEW_ULID } }),
  });
  mountCreateMatter(root, { api, navigate: (h) => navCalls.push(h), doc });
  fillValidForm(root);
  fireClick(findByTestId(root, "create-submit"));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(navCalls, [`#/matters/${NEW_ULID}`]);
});

test("cancel: navigates to #/matters", () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi();
  mountCreateMatter(root, { api, navigate: (h) => navCalls.push(h), doc });
  fireClick(findByTestId(root, "create-cancel"));
  assert.deepEqual(navCalls, ["#/matters"]);
});

test("submit: empty Name blocks the IPC call + shows inline error + focuses Name", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let called = false;
  const api = makeStubApi({
    createMatter: async () => {
      called = true;
      return { ok: true, value: { id: NEW_ULID } };
    },
  });
  mountCreateMatter(root, { api, navigate: () => {}, doc });
  // Fill everything BUT name.
  fireClick(findOne(root, (n) =>
    n.getAttribute("name") === "matter_type" &&
    n.getAttribute("value") === "litigation",
  ));
  fire(findInputById(root, "cm-jurisdiction-value"), "input", "test-jx");
  fire(findInputById(root, "cm-party-0-role"), "input", "client");
  fire(findInputById(root, "cm-party-0-display-name"), "input", "syn-A");
  fire(findInputById(root, "cm-party-0-party-kind"), "input", "individual");
  fireClick(findOne(root, (n) =>
    n.getAttribute("name") === "confidentiality_class" &&
    n.getAttribute("value") === "normal",
  ));
  fireClick(findByTestId(root, "create-submit"));
  await new Promise((r) => setImmediate(r));
  assert.equal(called, false);
  const err = findByTestId(root, "create-form-error");
  assert.ok(err !== null);
  assert.match(collectText(err), /Name is required/);
  assert.equal(doc._focused, findInputById(root, "cm-name"));
});

test("submit: missing matter_type radio blocks submit", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let called = false;
  const api = makeStubApi({ createMatter: async () => { called = true; return { ok: true, value: { id: NEW_ULID } }; } });
  mountCreateMatter(root, { api, navigate: () => {}, doc });
  fire(findInputById(root, "cm-name"), "input", "matter-fixture-A");
  fire(findInputById(root, "cm-jurisdiction-value"), "input", "test-jx");
  fire(findInputById(root, "cm-party-0-role"), "input", "client");
  fire(findInputById(root, "cm-party-0-display-name"), "input", "syn-A");
  fire(findInputById(root, "cm-party-0-party-kind"), "input", "individual");
  fireClick(findOne(root, (n) =>
    n.getAttribute("name") === "confidentiality_class" &&
    n.getAttribute("value") === "normal",
  ));
  fireClick(findByTestId(root, "create-submit"));
  await new Promise((r) => setImmediate(r));
  assert.equal(called, false);
  const err = findByTestId(root, "create-form-error");
  assert.match(collectText(err), /Matter type is required/);
});

test("submit: zero valid parties blocks submit (all blank)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let called = false;
  const api = makeStubApi({ createMatter: async () => { called = true; return { ok: true, value: { id: NEW_ULID } }; } });
  mountCreateMatter(root, { api, navigate: () => {}, doc });
  fire(findInputById(root, "cm-name"), "input", "matter-fixture-A");
  fireClick(findOne(root, (n) =>
    n.getAttribute("name") === "matter_type" &&
    n.getAttribute("value") === "litigation",
  ));
  fire(findInputById(root, "cm-jurisdiction-value"), "input", "test-jx");
  fireClick(findOne(root, (n) =>
    n.getAttribute("name") === "confidentiality_class" &&
    n.getAttribute("value") === "normal",
  ));
  fireClick(findByTestId(root, "create-submit"));
  await new Promise((r) => setImmediate(r));
  assert.equal(called, false);
  const err = findByTestId(root, "create-form-error");
  assert.match(collectText(err), /At least one party with role, display name, and party kind is required/);
});

test("submit: API error envelope renders inline + form state preserved", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi({
    createMatter: async () => ({
      ok: false,
      error: {
        kind: "case_box_persistence_error",
        code: "duplicate_id",
        message: "duplicate identifier",
      },
    }),
  });
  mountCreateMatter(root, { api, navigate: (h) => navCalls.push(h), doc });
  fillValidForm(root);
  fireClick(findByTestId(root, "create-submit"));
  await new Promise((r) => setImmediate(r));
  const err = findByTestId(root, "create-form-error");
  assert.ok(err !== null);
  assert.equal(collectText(err), "duplicate identifier");
  assert.equal(err.getAttribute("role"), "alert");
  // No navigation on error.
  assert.equal(navCalls.length, 0);
  // Form input still in DOM with its value preserved (state-driven).
  assert.ok(findInputById(root, "cm-name") !== null);
});

test("submit: HTML-shaped name passed verbatim to API + echoed safely", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const calls = [];
  const api = makeStubApi({
    createMatter: async (dto) => {
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
  mountCreateMatter(root, { api, navigate: () => {}, doc });
  fillValidForm(root);
  fire(findInputById(root, "cm-name"), "input", "<script>alert(1)</script> evil");
  fireClick(findByTestId(root, "create-submit"));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  // String survives verbatim in the DTO.
  assert.equal(calls[0].name, "<script>alert(1)</script> evil");
  // Error message echoed via setText (text only; no element parsing).
  const err = findByTestId(root, "create-form-error");
  assert.equal(collectText(err), "<not-a-tag> safe-message-fixture");
});

test("submit: normal valid submit emits NO console.warn", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi();
  mountCreateMatter(root, { api, navigate: () => {}, doc });
  fillValidForm(root);
  const captured = await captureWarn(async () => {
    fireClick(findByTestId(root, "create-submit"));
    await new Promise((r) => setImmediate(r));
  });
  assert.deepEqual(
    captured.calls,
    [],
    `unexpected console.warn: ${JSON.stringify(captured.calls)}`,
  );
});

test("parties: Add party appends a row + Remove party hidden on first row only", () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  mountCreateMatter(root, { api: makeStubApi(), navigate: () => {}, doc });
  let rows = findAll(root, (n) => n.getAttribute("data-test-id") === "party-row");
  assert.equal(rows.length, 1);
  // First row has no remove button.
  const removes = findAll(rows[0], (n) => n.getAttribute("data-test-id") === "party-remove");
  assert.equal(removes.length, 0);
  // Add a party.
  fireClick(findByTestId(root, "party-add"));
  rows = findAll(root, (n) => n.getAttribute("data-test-id") === "party-row");
  assert.equal(rows.length, 2);
  // Second row HAS a remove button.
  const removes2 = findAll(rows[1], (n) => n.getAttribute("data-test-id") === "party-remove");
  assert.equal(removes2.length, 1);
});

test("parties: Remove party drops the target row + preserves sibling values", () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  mountCreateMatter(root, { api: makeStubApi(), navigate: () => {}, doc });
  fireClick(findByTestId(root, "party-add"));
  fireClick(findByTestId(root, "party-add"));
  // Now 3 rows: keys 0, 1, 2.
  // Fill row 1's role.
  fire(findInputById(root, "cm-party-0-role"), "input", "first-role");
  fire(findInputById(root, "cm-party-1-role"), "input", "second-role");
  fire(findInputById(root, "cm-party-2-role"), "input", "third-role");
  // Remove the middle row (key=1).
  const removes = findAll(root, (n) => n.getAttribute("data-test-id") === "party-remove");
  // Two remove buttons (key=1 and key=2).
  assert.equal(removes.length, 2);
  fireClick(removes[0]);
  const rows = findAll(root, (n) => n.getAttribute("data-test-id") === "party-row");
  assert.equal(rows.length, 2);
  // Remaining row keys 0 and 2.
  const keys = rows.map((r) => r.getAttribute("data-party-key"));
  assert.deepEqual(keys, ["0", "2"]);
  // Values preserved: row 0 still has "first-role"; row 2 still has "third-role".
  assert.equal(findInputById(root, "cm-party-0-role").getAttribute("value"), "first-role");
  assert.equal(findInputById(root, "cm-party-2-role").getAttribute("value"), "third-role");
});

test("submit: optional free-text fields included when non-empty after trim", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const calls = [];
  const api = makeStubApi({
    createMatter: async (dto) => {
      calls.push(dto);
      return { ok: true, value: { id: NEW_ULID } };
    },
  });
  mountCreateMatter(root, { api, navigate: () => {}, doc });
  fillValidForm(root);
  fire(findInputById(root, "cm-retainer-scope"), "input", "  scope-text  ");
  fire(findInputById(root, "cm-case-type-text"), "input", "litigation-A");
  fire(findInputById(root, "cm-court-contact-text"), "input", "  ");  // whitespace-only → dropped
  fireClick(findByTestId(root, "create-submit"));
  await new Promise((r) => setImmediate(r));
  const dto = calls[0];
  assert.equal(dto.retainer_scope, "scope-text");
  assert.equal(dto.case_type_text, "litigation-A");
  assert.equal("court_contact_text" in dto, false);
});
