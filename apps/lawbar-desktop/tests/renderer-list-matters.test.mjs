// listMatters screen tests. Pure-Node; mock document + mock api injected.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.1 + Slice 4 user scope.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountListMatters, PAGE_SIZE } from "../dist/renderer/screens/listMatters.js";

const VALID_ULID_1 = "01jzabcdef0123456789ghjkmn";
const VALID_ULID_2 = "01jzwxyzpq0123456789rstvwx";
const VALID_ULID_3 = "01jz000000abcdefghjkmnpqrs";

// --- Minimal MockDocument (same shape as renderer-dom.test.mjs's; intentionally
// inlined per Slice 4 "no opportunistic refactors" constraint) ---

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
  querySelector(_sel) {
    // Not used by listMatters; provide a stub so tests do not crash if the
    // module changes.
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

// --- DOM traversal helpers (test-local; not part of the screen) ---

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

function findAllByTag(root, tag) {
  return findAll(root, (n) => n.tagName === tag.toUpperCase());
}

function collectTextContent(node) {
  if (node === null || node === undefined) return "";
  if (node instanceof MockText) return node.textContent;
  if (node._textContent !== "") return node._textContent;
  return node.children.map(collectTextContent).join("");
}

// --- Fixtures ---

function syntheticMatter(id, overrides = {}) {
  return {
    id,
    name: `matter-fixture-${id.slice(0, 4)}`,
    matter_type: "litigation",
    confidentiality_class: "normal",
    created_at: "2026-05-27T10:30:00Z",
    status: "active",
    ...overrides,
  };
}

function makeStubApi(impl = {}) {
  return {
    createMatter: async () => ({ ok: true, value: {} }),
    getMatter: async () => ({ ok: true, value: null }),
    listMatters: impl.listMatters ?? (async () => ({ ok: true, value: { rows: [], next_cursor: null } })),
    archiveMatter: async () => ({ ok: true, value: {} }),
    chainHead: async () => ({ ok: true, value: null }),
  };
}

// --- console.warn capture (DTO stripping should NOT warn under normal use) ---

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

test("PAGE_SIZE constant equals 20 per §6.1", () => {
  assert.equal(PAGE_SIZE, 20);
});

test("mount: scaffold renders header (h1 案件台账), desk-tabs in a tabs-row, and + 新建案件 button", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi();
  await mountListMatters(root, { api, navigate: () => {}, doc });
  const h1 = findByTag(root, "h1");
  assert.ok(h1 !== null, "expected an <h1>");
  assert.equal(collectTextContent(h1), "案件台账");
  // PR2 desktop variant: tabs use .desk-tab inside a .tabs-row tablist.
  const tabsRow = findOne(
    root,
    (n) => (n.getAttribute("class") ?? "").includes("tabs-row"),
  );
  assert.ok(tabsRow !== null, "expected a .tabs-row tablist");
  assert.equal(tabsRow.getAttribute("role"), "tablist");
  const tabs = findAll(root, (n) => n.getAttribute("role") === "tab");
  assert.equal(tabs.length, 2);
  for (const t of tabs) {
    assert.ok(
      (t.getAttribute("class") ?? "").includes("desk-tab"),
      "each tab should carry .desk-tab",
    );
  }
  assert.equal(collectTextContent(tabs[0]), "进行中");
  assert.equal(collectTextContent(tabs[1]), "已归档");
  const newBtn = findOne(
    root,
    (n) =>
      n.tagName === "BUTTON" &&
      collectTextContent(n) === "+ 新建案件",
  );
  assert.ok(newBtn !== null, "expected the + 新建案件 button");
  assert.ok(
    (newBtn.getAttribute("class") ?? "").includes("list-new-btn"),
    "new-matter button must keep the .list-new-btn class (smoke contract)",
  );
});

test("mount: default tab is active, marked aria-selected", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi();
  await mountListMatters(root, { api, navigate: () => {}, doc });
  const activeTab = findOne(root, (n) => n.getAttribute("data-status") === "active");
  const archivedTab = findOne(root, (n) => n.getAttribute("data-status") === "archived");
  assert.equal(activeTab.getAttribute("aria-selected"), "true");
  assert.equal(archivedTab.getAttribute("aria-selected"), "false");
});

test("mount: empty active state shows the in-memory-volatility copy", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listMatters: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
  });
  await mountListMatters(root, { api, navigate: () => {}, doc });
  const empty = findByTestId(root, "list-empty");
  assert.ok(empty !== null);
  assert.ok(
    (empty.getAttribute("class") ?? "").includes("list-empty-desktop"),
    "empty state uses the desktop variant class",
  );
  assert.match(collectTextContent(empty), /仅保存在本机/);
});

test("mount: empty archived state shows the archived copy", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listMatters: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
  });
  await mountListMatters(root, { api, navigate: () => {}, doc }, "archived");
  const empty = findByTestId(root, "list-empty");
  assert.ok(empty !== null);
  assert.match(collectTextContent(empty), /暂无已归档案件/);
});

test("mount: loaded state renders the table with one row per matter", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const matters = [
    syntheticMatter(VALID_ULID_1),
    syntheticMatter(VALID_ULID_2, { matter_type: "advisory" }),
    syntheticMatter(VALID_ULID_3, { confidentiality_class: "sealed" }),
  ];
  const api = makeStubApi({
    listMatters: async () => ({ ok: true, value: { rows: matters, next_cursor: null } }),
  });
  await mountListMatters(root, { api, navigate: () => {}, doc });
  const table = findByTestId(root, "matter-table");
  assert.ok(table !== null, "expected the matter table");
  assert.ok(
    (table.getAttribute("class") ?? "").includes("matter-table-desktop"),
    "table uses the desktop variant class",
  );
  const tbody = findByTag(table, "tbody");
  const trs = findAllByTag(tbody, "tr");
  assert.equal(trs.length, 3);
  // Columns: [0]序号 [1]名称(link) [2]类型 [3]保密级别(pill) [4]创建时间 [5]状态(pill)
  // Row 1: ordinal + name link.
  const cells1 = findAllByTag(trs[0], "td");
  assert.equal(collectTextContent(cells1[0]), "1");
  const link0 = findByTag(trs[0], "a");
  assert.equal(link0.getAttribute("data-matter-id"), VALID_ULID_1);
  assert.equal(link0.getAttribute("href"), `#/matters/${VALID_ULID_1}`);
  assert.equal(collectTextContent(link0), `matter-fixture-${VALID_ULID_1.slice(0, 4)}`);
  assert.ok(
    (link0.getAttribute("class") ?? "").includes("matter-name"),
    "name link carries .matter-name (desktop serif)",
  );
  // Row 2: matter_type "advisory" → Chinese "顾问".
  const cells2 = findAllByTag(trs[1], "td");
  assert.equal(collectTextContent(cells2[0]), "2");
  assert.equal(collectTextContent(cells2[2]), "顾问");
  // Row 3: confidentiality_class "sealed" → conf-pill "密封".
  const cells3 = findAllByTag(trs[2], "td");
  const confPill = findOne(cells3[3], (n) =>
    (n.getAttribute("class") ?? "").startsWith("conf-pill"),
  );
  assert.ok(confPill !== null, "confidentiality renders as a conf-pill");
  assert.match(confPill.getAttribute("class"), /conf-pill--sealed/);
  assert.equal(collectTextContent(confPill), "密封");
});

test("mount: error envelope renders inline error with role=alert and safe message only", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listMatters: async () => ({
      ok: false,
      error: {
        kind: "case_box_persistence_error",
        code: "invalid_payload",
        message: "invalid payload",
      },
    }),
  });
  await mountListMatters(root, { api, navigate: () => {}, doc });
  const err = findByTestId(root, "list-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectTextContent(err), "invalid payload");
});

test("mount: + New matter button calls navigate with the new-matter hash", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi();
  await mountListMatters(root, {
    api,
    navigate: (h) => navCalls.push(h),
    doc,
  });
  const newBtn = findOne(
    root,
    (n) =>
      n.tagName === "BUTTON" &&
      collectTextContent(n) === "+ 新建案件",
  );
  newBtn.dispatchEvent({ type: "click" });
  assert.deepEqual(navCalls, ["#/matters/new"]);
});

test("mount: clicking a matter row link calls navigate with the view hash and prevents default", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi({
    listMatters: async () => ({
      ok: true,
      value: { rows: [syntheticMatter(VALID_ULID_1)], next_cursor: null },
    }),
  });
  await mountListMatters(root, {
    api,
    navigate: (h) => navCalls.push(h),
    doc,
  });
  const link = findOne(
    root,
    (n) => n.tagName === "A" && n.getAttribute("data-matter-id") === VALID_ULID_1,
  );
  let prevented = false;
  link.dispatchEvent({
    type: "click",
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(navCalls, [`#/matters/${VALID_ULID_1}`]);
});

test("mount: tab click reloads with the new status (Active → Archived)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const calls = [];
  const api = makeStubApi({
    listMatters: async (dto) => {
      calls.push(dto);
      return { ok: true, value: { rows: [], next_cursor: null } };
    },
  });
  await mountListMatters(root, { api, navigate: () => {}, doc });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, "active");
  const archivedTab = findOne(
    root,
    (n) => n.getAttribute("data-status") === "archived",
  );
  archivedTab.dispatchEvent({ type: "click" });
  // The handler is sync-fire-and-forget; await a microtask so the second
  // listMatters call resolves before we inspect.
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].status, "archived");
});

test("mount: Load more button appears when next_cursor !== null and triggers another fetch with the cursor", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const calls = [];
  const api = makeStubApi({
    listMatters: async (dto) => {
      calls.push(dto);
      if (dto.cursor === undefined) {
        return {
          ok: true,
          value: {
            rows: [syntheticMatter(VALID_ULID_1)],
            next_cursor: "opaque-cursor-A",
          },
        };
      }
      return {
        ok: true,
        value: { rows: [syntheticMatter(VALID_ULID_2)], next_cursor: null },
      };
    },
  });
  await mountListMatters(root, { api, navigate: () => {}, doc });
  let more = findByTestId(root, "list-load-more");
  assert.ok(more !== null);
  more.dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  // Second fetch carried the cursor.
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cursor, "opaque-cursor-A");
  // After second page, accumulated rows = 2; load-more disappears.
  const trs = findAllByTag(root, "tr");
  // 1 header row + 2 data rows
  assert.equal(trs.length, 3);
  more = findByTestId(root, "list-load-more");
  assert.equal(more, null);
});

test("mount: matter name containing HTML-shaped string renders as text only", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listMatters: async () => ({
      ok: true,
      value: {
        rows: [
          syntheticMatter(VALID_ULID_1, {
            name: "<script>alert(1)</script> matter-fixture-evil",
          }),
        ],
        next_cursor: null,
      },
    }),
  });
  await mountListMatters(root, { api, navigate: () => {}, doc });
  const link = findOne(
    root,
    (n) => n.tagName === "A" && n.getAttribute("data-matter-id") === VALID_ULID_1,
  );
  assert.ok(link !== null);
  // The link's only child is a text node with the verbatim string.
  assert.equal(link.children.length, 1);
  assert.ok(link.children[0] instanceof MockText);
  assert.equal(
    link.children[0].textContent,
    "<script>alert(1)</script> matter-fixture-evil",
  );
});

test("mount: normal render does not emit console.warn (no extra DTO fields passed)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listMatters: async () => ({
      ok: true,
      value: { rows: [syntheticMatter(VALID_ULID_1)], next_cursor: null },
    }),
  });
  // Note: this test uses the stub api directly (not the real
  // createCaseBoxApi wrapper). To be tighter, we could route through
  // createCaseBoxApi(mockClient) and assert no warn there. Doing that here
  // because the screen invokes deps.api.listMatters({ status, limit }) which
  // only uses allowlisted fields.
  const result = await captureWarn(() =>
    mountListMatters(root, { api, navigate: () => {}, doc }),
  );
  assert.deepEqual(
    result.calls,
    [],
    `unexpected console.warn calls: ${JSON.stringify(result.calls)}`,
  );
});

test("mount: status pill receives the matter's status as a class modifier", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listMatters: async () => ({
      ok: true,
      value: {
        rows: [
          syntheticMatter(VALID_ULID_1, { status: "active" }),
          syntheticMatter(VALID_ULID_2, { status: "archived" }),
        ],
        next_cursor: null,
      },
    }),
  });
  await mountListMatters(root, { api, navigate: () => {}, doc });
  const pills = findAll(root, (n) =>
    (n.getAttribute("class") ?? "").startsWith("status-pill"),
  );
  assert.equal(pills.length, 2);
  assert.match(pills[0].getAttribute("class"), /status-pill--active/);
  assert.match(pills[1].getAttribute("class"), /status-pill--archived/);
  assert.equal(collectTextContent(pills[0]), "进行中");
  assert.equal(collectTextContent(pills[1]), "已归档");
});
