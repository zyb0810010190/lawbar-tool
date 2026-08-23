// editMatter screen tests. Pure-Node; mock document + mock api injected.
// Per dev-memo/design/2026-08-05-matter-details-edit-screen.md (matter-details-edit
// Phase D) + dev-memo/plan-matter-details-edit-D-docket.md.
//
// Mirrors renderer-archive-matter.test.mjs: MockDoc harness (no jsdom); imports the
// BUILT ../dist/renderer/screens/editMatter.js; asserts copy against the live
// catalog / resolver (t()/CATALOG) so the tests follow the catalog, not literals.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountEditMatter } from "../dist/renderer/screens/editMatter.js";
import { t } from "../dist/renderer/i18n/t.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";

// Reason bounds mirrored from editMatter.ts (REASON_MIN/MAX_LENGTH).
const REASON_MIN = 10;
const REASON_MAX = 500;

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

function findAllByTestId(root, id) {
  return findAll(root, (n) => n.getAttribute("data-test-id") === id);
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

const flush = () => new Promise((r) => setImmediate(r));

// --- Fixtures ---

function activeMatter(overrides = {}) {
  return {
    id: VALID_ULID,
    name: "matter-fixture-A",
    matter_type: "litigation",
    status: "active",
    retainer_scope: "seed-retainer",
    case_type_text: "seed-case-type",
    case_progress_text: "seed-progress",
    court_contact_text: "seed-court",
    contention_summary_text: "seed-contention",
    ...overrides,
  };
}

function makeStubApi(impl = {}) {
  return {
    getMatter: impl.getMatter ?? (async () => ({ ok: true, value: activeMatter() })),
    updateMatterDetails:
      impl.updateMatterDetails ?? (async () => ({ ok: true, value: activeMatter() })),
  };
}

// A valid, seeded edit form ready for interaction.
async function mountForm(overrides = {}) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const updateCalls = [];
  const api = makeStubApi({
    getMatter: overrides.getMatter,
    updateMatterDetails:
      overrides.updateMatterDetails ??
      (async (dto) => {
        updateCalls.push(dto);
        return { ok: true, value: activeMatter() };
      }),
  });
  await mountEditMatter(root, { api, navigate: (h) => navCalls.push(h), doc }, VALID_ULID);
  return { doc, root, navCalls, updateCalls };
}

// --- Tests ---

test("invalid ULID: no IPC calls; safe error rendered + back-to-list link", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let getCalls = 0;
  let updCalls = 0;
  const api = makeStubApi({
    getMatter: async () => { getCalls++; return { ok: true, value: activeMatter() }; },
    updateMatterDetails: async () => { updCalls++; return { ok: true, value: {} }; },
  });
  await mountEditMatter(root, { api, navigate: () => {}, doc }, "not-a-ulid");
  assert.equal(getCalls, 0);
  assert.equal(updCalls, 0);
  const err = findByTestId(root, "edit-invalid-id");
  assert.ok(err !== null);
  const link = findByTestId(root, "edit-back-link-list");
  assert.equal(doc._focused, link);
});

test("getMatter envelope error: safe message inline + back-to-view link + no update call", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let updCalls = 0;
  const api = makeStubApi({
    getMatter: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "invalid payload" },
    }),
    updateMatterDetails: async () => { updCalls++; return { ok: true, value: {} }; },
  });
  await mountEditMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const err = findByTestId(root, "edit-envelope-error");
  assert.ok(err !== null);
  assert.ok(collectText(err).includes(CATALOG["error.invalid_payload"]));
  assert.doesNotMatch(collectText(err), /invalid payload/);
  assert.equal(updCalls, 0);
  const back = findByTestId(root, "edit-back-link-view");
  assert.equal(doc._focused, back);
});

test("getMatter null: not-found copy + back-to-list", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({ getMatter: async () => ({ ok: true, value: null }) });
  await mountEditMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const nf = findByTestId(root, "edit-not-found");
  assert.ok(nf !== null);
  assert.match(collectText(nf), new RegExp(t("matterEdit.staleLinkBody")));
  assert.equal(doc._focused, findByTestId(root, "edit-back-link-list"));
});

test("active matter: form rendered with title (matter name) + all 6 fields seeded + name focused", async () => {
  const { doc, root } = await mountForm();
  const title = findByTestId(root, "edit-title");
  assert.equal(collectText(title), t("matterEdit.title", { name: "matter-fixture-A" }));
  // name input seeded via the value attribute; descriptor textareas seeded via text.
  const nameCtl = findByTestId(root, "edit-field-name");
  assert.equal(nameCtl.getAttribute("value"), "matter-fixture-A");
  assert.equal(collectText(findByTestId(root, "edit-field-retainer_scope")), "seed-retainer");
  assert.equal(collectText(findByTestId(root, "edit-field-case_type_text")), "seed-case-type");
  assert.equal(collectText(findByTestId(root, "edit-field-contention_summary_text")), "seed-contention");
  // Initial focus is the first field (name).
  assert.equal(doc._focused, nameCtl);
});

test("dirty-gate: submit disabled with no change; enabled after a field changes; summary tracks it", async () => {
  const { root } = await mountForm();
  const submit = findByTestId(root, "edit-submit");
  assert.equal(submit.hasAttribute("disabled"), true);
  // "no changes" summary initially.
  assert.ok(findByTestId(root, "edit-changes-none") !== null);
  assert.equal(findAllByTestId(root, "edit-changes-item").length, 0);
  // Change a descriptor -> submit enabled + summary lists the changed label.
  fire(findByTestId(root, "edit-field-retainer_scope"), "input", "updated-retainer");
  assert.equal(submit.hasAttribute("disabled"), false);
  assert.equal(findByTestId(root, "edit-changes-none"), null);
  const items = findAllByTestId(root, "edit-changes-item");
  assert.equal(items.length, 1);
  assert.equal(collectText(items[0]), t("detail.field.retainerScope"));
  // Revert the field back to its seed -> submit disabled again.
  fire(findByTestId(root, "edit-field-retainer_scope"), "input", "seed-retainer");
  assert.equal(submit.hasAttribute("disabled"), true);
  assert.ok(findByTestId(root, "edit-changes-none") !== null);
});

test("dirty-gate: empty name keeps submit disabled even when a descriptor changed", async () => {
  const { root } = await mountForm();
  const submit = findByTestId(root, "edit-submit");
  fire(findByTestId(root, "edit-field-case_type_text"), "input", "new-case-type");
  assert.equal(submit.hasAttribute("disabled"), false);
  fire(findByTestId(root, "edit-field-name"), "input", "   ");
  assert.equal(submit.hasAttribute("disabled"), true);
});

test("empty-name submit: blocked inline (no IPC) + name error shown + focuses name", async () => {
  const { doc, root, updateCalls } = await mountForm();
  fire(findByTestId(root, "edit-field-name"), "input", "");
  fireClick(findByTestId(root, "edit-submit"));
  await flush();
  assert.equal(updateCalls.length, 0);
  const nameErr = findByTestId(root, "edit-name-error");
  assert.equal(nameErr.hasAttribute("hidden"), false);
  assert.equal(collectText(nameErr), t("matterEdit.error.nameRequired"));
  assert.equal(doc._focused, findByTestId(root, "edit-field-name"));
});

test("submit: reason shorter than 10 chars blocks + inline error + no IPC", async () => {
  const { root, updateCalls } = await mountForm();
  fire(findByTestId(root, "edit-field-retainer_scope"), "input", "updated-retainer");
  fire(findByTestId(root, "edit-reason"), "input", "tooshort");
  fireClick(findByTestId(root, "edit-submit"));
  await flush();
  assert.equal(updateCalls.length, 0);
  const err = findByTestId(root, "edit-form-error");
  assert.equal(err.hasAttribute("hidden"), false);
  assert.equal(collectText(err), t("matterEdit.error.reasonTooShort", { min: REASON_MIN }));
});

test("submit: reason longer than 500 chars blocks + inline error + no IPC", async () => {
  const { root, updateCalls } = await mountForm();
  fire(findByTestId(root, "edit-field-retainer_scope"), "input", "updated-retainer");
  fire(findByTestId(root, "edit-reason"), "input", "a".repeat(501));
  fireClick(findByTestId(root, "edit-submit"));
  await flush();
  assert.equal(updateCalls.length, 0);
  const err = findByTestId(root, "edit-form-error");
  assert.equal(collectText(err), t("matterEdit.error.reasonTooLong", { max: REASON_MAX }));
});

test("happy path: valid edit calls updateMatterDetails with {matterId, patch(6 fields), reason} + navigates to view", async () => {
  const { root, navCalls, updateCalls } = await mountForm();
  fire(findByTestId(root, "edit-field-retainer_scope"), "input", "updated-retainer");
  fire(findByTestId(root, "edit-reason"), "input", "  correcting the retainer scope  ");
  fireClick(findByTestId(root, "edit-submit"));
  await flush();
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0], {
    matterId: VALID_ULID,
    patch: {
      name: "matter-fixture-A",
      retainer_scope: "updated-retainer",
      case_type_text: "seed-case-type",
      case_progress_text: "seed-progress",
      court_contact_text: "seed-court",
      contention_summary_text: "seed-contention",
    },
    reason: "correcting the retainer scope", // trimmed
  });
  assert.deepEqual(navCalls, [`#/matters/${VALID_ULID}`]);
});

test("descriptor clear: an emptied descriptor is sent as an explicit '' change", async () => {
  const { root, updateCalls } = await mountForm();
  fire(findByTestId(root, "edit-field-case_type_text"), "input", "");
  fire(findByTestId(root, "edit-reason"), "input", "clearing the case type field");
  fireClick(findByTestId(root, "edit-submit"));
  await flush();
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].patch.case_type_text, "");
  assert.equal(updateCalls[0].patch.name, "matter-fixture-A");
});

test("submit: persistence error preserves form + shows safe message + no navigation", async () => {
  const { root, navCalls } = await mountForm({
    updateMatterDetails: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "matter_archived", message: "matter archived" },
    }),
  });
  fire(findByTestId(root, "edit-field-retainer_scope"), "input", "updated-retainer");
  fire(findByTestId(root, "edit-reason"), "input", "correcting the retainer scope");
  fireClick(findByTestId(root, "edit-submit"));
  await flush();
  const err = findByTestId(root, "edit-form-error");
  assert.equal(collectText(err), CATALOG["error.matter_archived"]);
  assert.doesNotMatch(collectText(err), /matter archived/);
  assert.equal(navCalls.length, 0);
  assert.ok(findByTestId(root, "edit-form") !== null);
});

test("submit: form 'submit' event (Enter-in-input) triggers handleSubmit + preventDefault", async () => {
  const { root, navCalls, updateCalls } = await mountForm();
  fire(findByTestId(root, "edit-field-retainer_scope"), "input", "updated-retainer");
  fire(findByTestId(root, "edit-reason"), "input", "correcting the retainer scope");
  let prevented = false;
  findByTestId(root, "edit-form").dispatchEvent({
    type: "submit",
    preventDefault: () => { prevented = true; },
  });
  await flush();
  assert.equal(prevented, true);
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(navCalls, [`#/matters/${VALID_ULID}`]);
});

test("no-op guard: form-submit with a valid reason but ZERO field changes fires no IPC (M1)", async () => {
  // The submit button is disabled when nothing changed, but a form `submit`
  // event (Enter / programmatic) reaches handleSubmit regardless of button state.
  // The dirty-gate guard must short-circuit so a no-op edit never fires an IPC.
  const { root, navCalls, updateCalls } = await mountForm();
  // No field touched; only a valid reason supplied.
  fire(findByTestId(root, "edit-reason"), "input", "a permanent court-facing reason");
  findByTestId(root, "edit-form").dispatchEvent({ type: "submit", preventDefault: () => {} });
  await flush();
  assert.equal(updateCalls.length, 0);
  assert.deepEqual(navCalls, []);
});

test("cancel: navigates back to the view route", async () => {
  const { root, navCalls } = await mountForm();
  fireClick(findByTestId(root, "edit-cancel"));
  assert.deepEqual(navCalls, [`#/matters/${VALID_ULID}`]);
});

test("archived matter (direct /edit): read-only variant + banner, NO submit, NO update call", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let updCalls = 0;
  const api = makeStubApi({
    getMatter: async () => ({ ok: true, value: activeMatter({ status: "archived" }) }),
    updateMatterDetails: async () => { updCalls++; return { ok: true, value: {} }; },
  });
  await mountEditMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  assert.ok(findByTestId(root, "edit-readonly") !== null);
  const banner = findByTestId(root, "edit-archived-banner");
  assert.ok(banner !== null);
  assert.equal(collectText(banner), t("matterEdit.archivedBanner"));
  // No editable submit control in the read-only variant.
  assert.equal(findByTestId(root, "edit-submit"), null);
  assert.equal(findByTestId(root, "edit-form"), null);
  assert.equal(updCalls, 0);
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
  await mountEditMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const title = findByTestId(root, "edit-title");
  assert.equal(title.children.length, 1);
  assert.ok(title.children[0] instanceof MockText);
  assert.equal(
    title.children[0].textContent,
    t("matterEdit.title", { name: "<script>alert(1)</script> matter-fixture-evil" }),
  );
});
