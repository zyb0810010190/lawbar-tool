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
  remove() {
    if (this.parentNode !== null) {
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    }
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
    listAuditEvents:
      impl.listAuditEvents ?? (async () => ({ ok: true, value: { rows: [], next_cursor: null } })),
    listDocuments:
      impl.listDocuments ?? (async () => ({ ok: true, value: { rows: [], next_cursor: null } })),
    getDocument: impl.getDocument ?? (async () => ({ ok: true, value: null })),
    registerDocument: impl.registerDocument ?? (async () => ({ ok: true, value: null })),
    listDeadlines:
      impl.listDeadlines ?? (async () => ({ ok: true, value: { rows: [], next_cursor: null } })),
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

// --- BRCBW... no: audit-event log viewer (this WI) ---

// Flush several macro/microtask turns: the disclosure click triggers
// loadChainHead -> loadAuditEvents -> api.listAuditEvents -> loadPage, which is
// several await hops deep.
async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

function auditEvent(overrides = {}) {
  return {
    timestamp: "2026-05-27T10:30:00Z",
    action: "matter.created",
    entity_type: "matter",
    entity_id: EVENT_ULID,
    after_state_hash: SAMPLE_HASH,
    ...overrides,
  };
}

function findAllByTestId(root, id) {
  return findAll(root, (n) => n.getAttribute("data-test-id") === id);
}

test("audit events: disclosure renders ordered event list (count>0)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 2 },
    }),
    listAuditEvents: async () => ({
      ok: true,
      value: {
        rows: [
          auditEvent({ action: "matter.created" }),
          auditEvent({ action: "matter.archived", reason: "closed" }),
        ],
        next_cursor: null,
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await flush();
  const list = findByTestId(root, "view-audit-list");
  assert.ok(list !== null, "audit list rendered");
  assert.equal(list.tagName, "OL");
  const events = findAllByTestId(root, "view-audit-event");
  assert.equal(events.length, 2);
  const actions = findAllByTestId(root, "view-audit-action").map(collectText);
  assert.deepEqual(actions, ["matter.created", "matter.archived"]);
  // reason shown only when present
  const reasons = findAllByTestId(root, "view-audit-reason").map(collectText);
  assert.deepEqual(reasons, ["reason: closed"]);
  // no "Show more" when next_cursor is null
  assert.equal(findByTestId(root, "view-audit-more"), null);
});

test("audit events: count=0 shows no event list (existing empty copy only)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let listCalls = 0;
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: null, lastEventId: null, count: 0 },
    }),
    listAuditEvents: async () => {
      listCalls++;
      return { ok: true, value: { rows: [], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.ok(findByTestId(root, "view-chain-empty") !== null);
  assert.equal(findByTestId(root, "view-audit-list"), null);
  assert.equal(listCalls, 0, "listAuditEvents not called for an empty chain");
});

test("audit events: envelope error renders inline role=alert; head summary intact", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 1 },
    }),
    listAuditEvents: async () => ({
      ok: false,
      error: {
        kind: "case_box_persistence_error",
        code: "invalid_payload",
        message: "audit list failed",
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-audit-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "audit list failed");
  // chain head summary still shown (count rendered)
  assert.equal(collectText(findByTestId(root, "view-chain-count")), "1");
});

test("audit events: next_cursor → 'Show more' appends next page then disappears", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let call = 0;
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 3 },
    }),
    listAuditEvents: async (dto) => {
      call++;
      if (call === 1) {
        return {
          ok: true,
          value: {
            rows: [auditEvent({ action: "ev.one" }), auditEvent({ action: "ev.two" })],
            next_cursor: "cursor-2",
          },
        };
      }
      // second page: cursor must be threaded through
      assert.equal(dto.cursor, "cursor-2");
      return {
        ok: true,
        value: { rows: [auditEvent({ action: "ev.three" })], next_cursor: null },
      };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-audit-event").length, 2);
  const more = findByTestId(root, "view-audit-more");
  assert.ok(more !== null, "Show more present after first page");
  more.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-audit-event").length, 3, "second page appended");
  assert.equal(findByTestId(root, "view-audit-more"), null, "Show more removed when cursor exhausted");
});

// --- Documents section (B2 WI-2a) ---

function docRow(overrides = {}) {
  return {
    id: "01jzdoc0000000000000000000",
    filename: "complaint.pdf",
    doc_type: "pleading",
    status: "registered",
    received_at: "2026-05-27T10:30:00Z",
    ...overrides,
  };
}

test("documents: NOT loaded until summary clicked", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let calls = 0;
  const api = makeStubApi({
    listDocuments: async () => {
      calls++;
      return { ok: true, value: { rows: [], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  assert.equal(calls, 0);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(calls, 1);
});

test("documents: empty state shown when no documents", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDocuments: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  const empty = findByTestId(root, "view-docs-empty");
  assert.ok(empty !== null);
  assert.equal(collectText(empty), "No documents in this matter yet.");
  assert.equal(findAllByTestId(root, "view-docs-item").length, 0);
});

test("documents: populated list renders rows with filename", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDocuments: async () => ({
      ok: true,
      value: {
        rows: [docRow({ filename: "a.pdf" }), docRow({ id: "01jzdoc0000000000000000001", filename: "b.pdf" })],
        next_cursor: null,
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-docs-item").length, 2);
  const names = findAllByTestId(root, "view-docs-filename").map(collectText);
  assert.deepEqual(names, ["a.pdf", "b.pdf"]);
  assert.equal(findByTestId(root, "view-docs-empty"), null);
  assert.equal(findByTestId(root, "view-docs-more"), null);
});

test("documents: list envelope error renders inline role=alert", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDocuments: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "docs failed" },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-docs-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "docs failed");
});

test("documents: next_cursor → Show more appends next page then disappears", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let call = 0;
  const api = makeStubApi({
    listDocuments: async (dto) => {
      call++;
      if (call === 1) {
        return { ok: true, value: { rows: [docRow({ filename: "p1.pdf" })], next_cursor: "cur-2" } };
      }
      assert.equal(dto.cursor, "cur-2");
      return { ok: true, value: { rows: [docRow({ id: "01jzdoc0000000000000000002", filename: "p2.pdf" })], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-docs-item").length, 1);
  const more = findByTestId(root, "view-docs-more");
  assert.ok(more !== null);
  more.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-docs-item").length, 2);
  assert.equal(findByTestId(root, "view-docs-more"), null);
});

test("documents: row details disclosure loads metadata via getDocument", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let getArgs;
  const api = makeStubApi({
    listDocuments: async () => ({ ok: true, value: { rows: [docRow()], next_cursor: null } }),
    getDocument: async (dto) => {
      getArgs = dto;
      return {
        ok: true,
        value: {
          id: dto.documentId,
          filename: "complaint.pdf",
          doc_type: "pleading",
          status: "registered",
          received_at: "2026-05-27T10:30:00Z",
          content_hash: SAMPLE_HASH,
          storage_uri: "file:///local/complaint.pdf",
          page_count: 12,
        },
      };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  // not fetched until the row is expanded
  assert.equal(getArgs, undefined);
  findByTestId(root, "view-docs-item-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(getArgs.matterId, VALID_ULID);
  assert.equal(getArgs.documentId, "01jzdoc0000000000000000000");
  const detail = findByTestId(root, "view-docs-detail");
  assert.ok(detail !== null);
  assert.match(collectText(detail), /file:\/\/\/local\/complaint\.pdf/);
  assert.match(collectText(detail), /12/);
});

// --- Add document (B2 WI-2b) ---

test("add document: success registers (default doc_type) then refreshes the list", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let listCall = 0;
  let regDto;
  const api = makeStubApi({
    listDocuments: async () => {
      listCall++;
      return listCall === 1
        ? { ok: true, value: { rows: [], next_cursor: null } }
        : { ok: true, value: { rows: [docRow({ filename: "new.pdf" })], next_cursor: null } };
    },
    registerDocument: async (dto) => {
      regDto = dto;
      return { ok: true, value: { id: docRow().id, filename: "new.pdf" } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.ok(findByTestId(root, "view-docs-empty") !== null);
  const addBtn = findByTestId(root, "view-docs-add");
  assert.ok(addBtn !== null);
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(regDto, { matterId: VALID_ULID, doc_type: "other" });
  assert.equal(collectText(findByTestId(root, "view-docs-add-status")), "Added.");
  // list refreshed → now shows the registered document
  assert.equal(findAllByTestId(root, "view-docs-item").length, 1);
  assert.equal(addBtn.hasAttribute("disabled"), false);
});

test("add document: cancelled (value null) shows Cancelled, does not refresh", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let listCall = 0;
  const api = makeStubApi({
    listDocuments: async () => {
      listCall++;
      return { ok: true, value: { rows: [], next_cursor: null } };
    },
    registerDocument: async () => ({ ok: true, value: null }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(listCall, 1);
  findByTestId(root, "view-docs-add").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(collectText(findByTestId(root, "view-docs-add-status")), "Cancelled.");
  assert.equal(listCall, 1, "list not refreshed on cancel");
});

test("add document: registration error renders inline role=alert", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    registerDocument: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "not_implemented", message: "register failed" },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  findByTestId(root, "view-docs-add").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-docs-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "register failed");
});

// --- Deadlines section (B7 read-only) ---

function deadlineRow(overrides = {}) {
  return {
    id: "01jzdl00000000000000000000",
    kind: "filing",
    due_at: "2026-06-30T10:30:00Z",
    owner_user_id: EVENT_ULID,
    status: "pending",
    ...overrides,
  };
}

test("deadlines: NOT loaded until summary clicked", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let calls = 0;
  const api = makeStubApi({
    listDeadlines: async () => {
      calls++;
      return { ok: true, value: { rows: [], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  assert.equal(calls, 0);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(calls, 1);
});

test("deadlines: empty state when none", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDeadlines: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  const empty = findByTestId(root, "view-deadlines-empty");
  assert.ok(empty !== null);
  assert.equal(collectText(empty), "No deadlines recorded for this matter.");
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 0);
});

test("deadlines: populated rows render due/kind/status (+rule)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDeadlines: async () => ({
      ok: true,
      value: {
        rows: [
          deadlineRow({ kind: "filing", status: "pending", source_rule_citation: "FRCP 12(a)" }),
          deadlineRow({ id: "01jzdl00000000000000000001", kind: "hearing", status: "met" }),
        ],
        next_cursor: null,
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 2);
  const kinds = findAllByTestId(root, "view-deadlines-kind").map(collectText);
  assert.deepEqual(kinds, ["filing · pending", "hearing · met"]);
  const rules = findAllByTestId(root, "view-deadlines-rule").map(collectText);
  assert.deepEqual(rules, ["rule: FRCP 12(a)"]);
  assert.equal(findByTestId(root, "view-deadlines-more"), null);
});

test("deadlines: envelope error renders inline role=alert", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDeadlines: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "deadlines failed" },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-deadlines-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "deadlines failed");
});

test("deadlines: next_cursor → Show more appends then disappears", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let call = 0;
  const api = makeStubApi({
    listDeadlines: async (dto) => {
      call++;
      if (call === 1) return { ok: true, value: { rows: [deadlineRow()], next_cursor: "cur-2" } };
      assert.equal(dto.cursor, "cur-2");
      return { ok: true, value: { rows: [deadlineRow({ id: "01jzdl00000000000000000002" })], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 1);
  const more = findByTestId(root, "view-deadlines-more");
  assert.ok(more !== null);
  more.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 2);
  assert.equal(findByTestId(root, "view-deadlines-more"), null);
});
