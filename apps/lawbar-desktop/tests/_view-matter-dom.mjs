// Shared DOM test harness for the viewMatter renderer suites.
// Extracted from renderer-view-matter.test.mjs so renderer-view-matter.test.mjs and
// renderer-deadline-urgency.test.mjs share ONE definition (no duplication) and each stays
// under the loc-guardian test threshold. Pure-Node mock document + mock api + fixtures.
// NOT a test file (no test() calls) — it is never run by `node --test`.

export const VALID_ULID = "01jzabcdef0123456789ghjkmn";
export const VALID_ULID_2 = "01jzwxyzpq0123456789rstvwx";
export const EVENT_ULID = "01jzevent0123456789abcdefgh";
export const SAMPLE_HASH =
  "abcd1234ef567890123456789012345678901234567890abcd1234ef56789012";

// --- Minimal MockDocument ---

export class MockText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
  }
}

export class MockEl {
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

export class MockDoc {
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

export function findAll(root, predicate) {
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

export function findOne(root, predicate) {
  const all = findAll(root, predicate);
  return all.length === 0 ? null : all[0];
}

export function findByTestId(root, id) {
  return findOne(root, (n) => n.getAttribute("data-test-id") === id);
}

export function findByTag(root, tag) {
  return findOne(root, (n) => n.tagName === tag.toUpperCase());
}

export function findAllByTestId(root, id) {
  return findAll(root, (n) => n.getAttribute("data-test-id") === id);
}

export function collectText(node) {
  if (node === null || node === undefined) return "";
  if (node instanceof MockText) return node.textContent;
  if (node._textContent !== "") return node._textContent;
  return node.children.map(collectText).join("");
}

// --- Async flush ---
// mountViewMatter chains loadChainHead -> loadAuditEvents -> api.listAuditEvents -> loadPage,
// which is several await hops deep.
export async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

// --- Fixtures ---

export function syntheticMatter(overrides = {}) {
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

export function makeStubApi(impl = {}) {
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
    // WI-DT3: the Deadlines disclosure renders per-row status-transition controls
    // (pending → met/missed/withdrawn; missed → met). Rendering does not call this,
    // but clicking a control does, so every consumer of the shared stub needs it.
    // Defaults to success; WI-DT3's transition tests override it to assert the
    // forwarded payload and to exercise the error path.
    transitionDeadline:
      impl.transitionDeadline ?? (async () => ({ ok: true, value: { id: "stub", status: "met" } })),
    listFacts:
      impl.listFacts ?? (async () => ({ ok: true, value: { rows: [], next_cursor: null } })),
    // WI-D4: the Deadlines disclosure now loads pending docket proposals on open,
    // so every consumer of this shared stub needs listDocketEntries. Default to an
    // empty page (proposals group stays hidden). dismissDocketEntry follows the
    // success-default convention used by the other mutating methods above; WI-D4's
    // own dismiss tests override it and assert the forwarded payload.
    listDocketEntries:
      impl.listDocketEntries ?? (async () => ({ ok: true, value: { rows: [], next_cursor: null } })),
    dismissDocketEntry:
      impl.dismissDocketEntry ??
      (async () => ({ ok: true, value: { id: "stub", confirmation_state: "dismissed" } })),
  };
}

export function captureWarn(fn) {
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

export function auditEvent(overrides = {}) {
  return {
    timestamp: "2026-05-27T10:30:00Z",
    action: "matter.created",
    entity_type: "matter",
    entity_id: EVENT_ULID,
    after_state_hash: SAMPLE_HASH,
    ...overrides,
  };
}

export function deadlineRow(overrides = {}) {
  return {
    id: "01jzdl00000000000000000000",
    kind: "filing",
    due_at: "2026-06-30T10:30:00Z",
    owner_user_id: EVENT_ULID,
    status: "pending",
    ...overrides,
  };
}
