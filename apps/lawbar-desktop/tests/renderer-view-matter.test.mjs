// viewMatter screen tests. Pure-Node; mock document + mock api injected.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.3 + Slice 6 user scope.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";

const VALID_ULID = "01jzabcdef0123456789ghjkmn";
const VALID_ULID_2 = "01jzwxyzpq0123456789rstvwx";
const EVENT_ULID = "01jzevent0123456789abcdefgh";
const SAMPLE_HASH =
  "abcd1234ef567890123456789012345678901234567890abcd1234ef56789012";

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

// --- Fixtures ---

function syntheticMatter(overrides = {}) {
  return {
    id: VALID_ULID,
    name: "matter-fixture-A",
    matter_type: "litigation",
    jurisdiction: { value: "test-jx", locked: false },
    parties: [
      { role: "client", display_name: "syn-party-A", party_kind: "individual" },
    ],
    confidentiality_class: "normal",
    created_at: "2026-05-27T10:30:00Z",
    status: "active",
    ...overrides,
  };
}

function makeStubApi(impl = {}) {
  return {
    createMatter: async () => ({ ok: true, value: {} }),
    getMatter: impl.getMatter ?? (async () => ({ ok: true, value: syntheticMatter() })),
    listMatters: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
    archiveMatter: async () => ({ ok: true, value: {} }),
    chainHead: impl.chainHead ?? (async () => ({ ok: true, value: { headHash: null, lastEventId: null, count: 0 } })),
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

test("invalid ULID: no IPC call; safe error rendered + back link", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let getCalls = 0;
  const api = makeStubApi({
    getMatter: async () => {
      getCalls++;
      return { ok: true, value: syntheticMatter() };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, "not-a-ulid");
  assert.equal(getCalls, 0);
  const err = findByTestId(root, "view-invalid-id");
  assert.ok(err !== null);
  const link = findByTestId(root, "view-back-link");
  assert.ok(link !== null);
  assert.equal(doc._focused, link);
});

test("envelope error: renders safe message inline with role=alert + back link", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: false,
      error: {
        kind: "case_box_persistence_error",
        code: "invalid_payload",
        message: "invalid payload",
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const err = findByTestId(root, "view-envelope-error");
  assert.ok(err !== null);
  const alert = findOne(err, (n) => n.getAttribute("role") === "alert");
  assert.equal(collectText(alert), "invalid payload");
  const link = findByTestId(root, "view-back-link");
  assert.ok(link !== null);
  assert.equal(doc._focused, link);
});

test("value=null: renders not-found copy + back link + focuses back link", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({ ok: true, value: null }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const nf = findByTestId(root, "view-not-found");
  assert.ok(nf !== null);
  assert.match(collectText(nf), /link may be out of date/);
  assert.equal(doc._focused, findByTestId(root, "view-back-link"));
});

test("active matter: renders title + status pill + detail fields + Archive button + focuses Archive", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({ ok: true, value: syntheticMatter() }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const title = findByTestId(root, "view-title");
  assert.equal(collectText(title), "matter-fixture-A");
  const pill = findOne(
    root,
    (n) => (n.getAttribute("class") ?? "").startsWith("status-pill"),
  );
  assert.match(pill.getAttribute("class"), /status-pill--active/);
  // Detail fields list
  const fields = findByTestId(root, "view-fields");
  assert.ok(fields !== null);
  assert.match(collectText(fields), /Litigation matter/);
  assert.match(collectText(fields), /test-jx/);
  assert.match(collectText(fields), /Normal/);
  // Archive button visible + focused
  const archive = findByTestId(root, "view-archive");
  assert.ok(archive !== null);
  assert.equal(doc._focused, archive);
});

test("Archive button: navigates to #/matters/:id/archive", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi();
  await mountViewMatter(
    root,
    { api, navigate: (h) => navCalls.push(h), doc },
    VALID_ULID,
  );
  const archive = findByTestId(root, "view-archive");
  archive.dispatchEvent({ type: "click" });
  assert.deepEqual(navCalls, [`#/matters/${VALID_ULID}/archive`]);
});

test("Back link: navigates to #/matters + preventDefault on click", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi();
  await mountViewMatter(
    root,
    { api, navigate: (h) => navCalls.push(h), doc },
    VALID_ULID,
  );
  let prevented = false;
  const back = findByTestId(root, "view-back-link");
  back.dispatchEvent({
    type: "click",
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(navCalls, ["#/matters"]);
});

test("archived matter: NO Archive button; shows 'Reason recorded in audit log.' + focuses back link", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({
        status: "archived",
        archived_at: "2026-05-27T11:00:00Z",
      }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  assert.equal(findByTestId(root, "view-archive"), null);
  const fields = findByTestId(root, "view-fields");
  assert.match(collectText(fields), /Reason recorded in audit log\./);
  assert.match(collectText(fields), /Archived at/);
  assert.equal(doc._focused, findByTestId(root, "view-back-link"));
});

test("parties: each party row renders role / display_name / party_kind + optional notes", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({
        parties: [
          { role: "client", display_name: "syn-A", party_kind: "individual" },
          { role: "counsel", display_name: "syn-B", party_kind: "firm", notes: "fixture-notes" },
        ],
      }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const parties = findByTestId(root, "view-parties");
  const items = findAll(parties, (n) => n.tagName === "LI");
  assert.equal(items.length, 2);
  assert.match(collectText(items[0]), /client — syn-A \(individual\)/);
  assert.match(collectText(items[1]), /counsel — syn-B \(firm\)/);
  // Notes appear on row 2 only.
  const notes = findAll(items[1], (n) => n.getAttribute("class") === "party-notes");
  assert.equal(notes.length, 1);
  assert.equal(collectText(notes[0]), "fixture-notes");
  const notesOnRow0 = findAll(items[0], (n) => n.getAttribute("class") === "party-notes");
  assert.equal(notesOnRow0.length, 0);
});

test("optional free-text fields: rendered only when non-empty", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({
        retainer_scope: "scope-text-fixture",
        case_type_text: "",
        court_contact_text: "  ",
        contention_summary_text: "summary-text-fixture",
      }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const fields = collectText(findByTestId(root, "view-fields"));
  assert.match(fields, /Retainer scope/);
  assert.match(fields, /scope-text-fixture/);
  assert.match(fields, /Contention summary/);
  assert.match(fields, /summary-text-fixture/);
  // Empty + whitespace-only fields NOT rendered.
  assert.doesNotMatch(fields, /Case type/);
  assert.doesNotMatch(fields, /Court contact/);
});

test("HTML-shaped matter name + party display_name render as text only", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({
        name: "<script>alert(1)</script> matter-fixture-evil",
        parties: [
          {
            role: "<script>x</script>",
            display_name: "<img src=x onerror=evil>",
            party_kind: "individual",
          },
        ],
      }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  // Title text node carries the literal string verbatim.
  const title = findByTestId(root, "view-title");
  assert.equal(title.children.length, 1);
  assert.ok(title.children[0] instanceof MockText);
  assert.equal(
    title.children[0].textContent,
    "<script>alert(1)</script> matter-fixture-evil",
  );
  // Party row carries the literal too.
  const parties = findByTestId(root, "view-parties");
  assert.match(
    collectText(parties),
    /<script>x<\/script> — <img src=x onerror=evil> \(individual\)/,
  );
});

test("chain head disclosure: NOT loaded until summary clicked", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let chainCalls = 0;
  const api = makeStubApi({
    chainHead: async () => {
      chainCalls++;
      return { ok: true, value: { headHash: null, lastEventId: null, count: 0 } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  assert.equal(chainCalls, 0);
  const summary = findByTestId(root, "view-chain-summary");
  summary.dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  assert.equal(chainCalls, 1);
});

test("chain head: count=0 renders 'No audit events recorded yet.'", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: null, lastEventId: null, count: 0 },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  const empty = findByTestId(root, "view-chain-empty");
  assert.ok(empty !== null);
  assert.equal(collectText(empty), "No audit events recorded yet.");
});

test("chain head: present hash renders truncated form via §6.5 rule + full hash inside <details>", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 5 },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  // Truncated = first 8 + "..." + last 8
  const trunc = findByTestId(root, "view-chain-headhash-truncated");
  assert.equal(
    collectText(trunc),
    `${SAMPLE_HASH.slice(0, 8)}...${SAMPLE_HASH.slice(-8)}`,
  );
  // Full hash present inside its own disclosure.
  const full = findByTestId(root, "view-chain-headhash-full");
  assert.equal(collectText(full), SAMPLE_HASH);
  // Count rendered.
  const count = findByTestId(root, "view-chain-count");
  assert.equal(collectText(count), "5");
  // Last event short tag = first 8 chars
  const lastShort = findByTestId(root, "view-chain-lastevent-short");
  assert.equal(collectText(lastShort), EVENT_ULID.slice(0, 8));
});

test("chain head: clipboard unavailable in Node → copy button disabled with tooltip", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 1 },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  const copy = findByTestId(root, "view-chain-copy");
  assert.ok(copy !== null);
  assert.equal(copy.hasAttribute("disabled"), true);
  assert.equal(copy.getAttribute("title"), "Copy unavailable in this context.");
});

test("chain head: envelope error renders inline with role=alert", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: false,
      error: {
        kind: "case_box_persistence_error",
        code: "unknown_matter",
        message: "unknown matter",
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  const err = findByTestId(root, "view-chain-error");
  assert.equal(collectText(err), "unknown matter");
  assert.equal(err.getAttribute("role"), "alert");
});

test("chain head: clicking summary twice triggers IPC ONCE (lazy + memoized)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let chainCalls = 0;
  const api = makeStubApi({
    chainHead: async () => {
      chainCalls++;
      return { ok: true, value: { headHash: null, lastEventId: null, count: 0 } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const summary = findByTestId(root, "view-chain-summary");
  summary.dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  summary.dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  assert.equal(chainCalls, 1);
});

test("normal active render emits NO console.warn", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi();
  const result = await captureWarn(() =>
    mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID),
  );
  assert.deepEqual(
    result.calls,
    [],
    `unexpected console.warn: ${JSON.stringify(result.calls)}`,
  );
});

test("jurisdiction locked indicator: shows (locked) when locked=true", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({
        jurisdiction: { value: "test-jx", locked: true },
      }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const fields = collectText(findByTestId(root, "view-fields"));
  assert.match(fields, /test-jx \(locked\)/);
});

test("full ULID disclosure: short tag (8) + full ULID present", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({ ok: true, value: syntheticMatter({ id: VALID_ULID_2 }) }),
  });
  // The route must match the same matter id so the ULID validation accepts it.
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID_2);
  const summary = findByTestId(root, "view-full-id-summary");
  assert.match(collectText(summary), new RegExp(VALID_ULID_2.slice(0, 8)));
  const full = findByTestId(root, "view-full-id");
  assert.equal(collectText(full), VALID_ULID_2);
});
