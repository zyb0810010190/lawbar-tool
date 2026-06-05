// Fact WRITE tests (WI-701 add-fact control + WI-703 default-purpose fix).
// Split out of renderer-view-matter.test.mjs (which was at the loc-guardian
// 1200-LOC test cap) by WI-704, mirroring renderer-deadline-write.test.mjs.
// The "Add fact" block was MOVED here verbatim (no assertion changes). Pure-Node;
// mock document + mock api from the shared harness.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import {
  VALID_ULID,
  MockDoc,
  findAll,
  findByTestId,
  findAllByTestId,
  collectText,
  flush,
  makeStubApi,
} from "./_view-matter-dom.mjs";

// Local copy of the fact-row fixture (the read-fact tests keep their own copy in
// renderer-view-matter.test.mjs; the shared harness is intentionally not edited).
function factRow(overrides = {}) {
  return {
    id: "01jzfact00000000000000000a",
    statement_text: "Defendant filed answer on 2026-06-01.",
    status: "accepted",
    source_type: "lawyer_authored",
    created_at: "2026-06-01T10:30:00Z",
    ...overrides,
  };
}

// --- Add fact (WI-701 write affordance) ---

// makeStubApi (shared harness) predates the fact-create channel, so wrap it here
// to add a createFact stub without editing the out-of-scope shared harness.
function stubWithFact(impl = {}) {
  return {
    ...makeStubApi(impl),
    createFact: impl.createFact ?? (async () => ({ ok: true, value: {} })),
  };
}

// Mount the matter view, open the Facts disclosure, return its add-control nodes.
async function mountFactsWithAdd(api) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" });
  await flush();
  return {
    root,
    statement: findByTestId(root, "view-facts-add-statement"),
    purpose: findByTestId(root, "view-facts-add-purpose"),
    asof: findByTestId(root, "view-facts-add-asof"),
    addBtn: findByTestId(root, "view-facts-add"),
  };
}

test("add fact: control renders inside the Facts disclosure", async () => {
  const { root } = await mountFactsWithAdd(stubWithFact());
  assert.ok(findByTestId(root, "view-facts-add-control") !== null);
  // Purpose select offers exactly the 8 R-5 purposes.
  const opts = findAll(findByTestId(root, "view-facts-add-purpose"), (n) => n.tagName === "OPTION");
  assert.deepEqual(
    opts.map((o) => o.getAttribute("value")),
    ["claim", "defense", "counterclaim", "timeline_event", "work_order_result", "consultation_q", "consultation_a", "other"],
  );
  // as_of_date hidden by default (non-timeline default purpose).
  assert.equal(findByTestId(root, "view-facts-add-asof").hasAttribute("hidden"), true);
});

test("add fact: purpose select browser default resolves to 'other', not the first option (WI-703)", async () => {
  // Regression guard for CBW-UI-701-DEFAULT-PURPOSE. Encodes how a real browser
  // resolves an untouched <select>: the option bearing `selected`, else the FIRST
  // option. Pre-fix no option was selected, so the default would have been the
  // first option ("claim"); post-fix "other" is marked selected.
  const { root } = await mountFactsWithAdd(stubWithFact());
  const options = findAll(findByTestId(root, "view-facts-add-purpose"), (n) => n.tagName === "OPTION");
  // Exactly one option is the selected default, and it is "other".
  const selected = options.filter((o) => o.hasAttribute("selected"));
  assert.equal(selected.length, 1, "exactly one option marked selected");
  assert.equal(selected[0].getAttribute("value"), "other");
  // Browser default-resolution rule: selected option, else first.
  const browserDefault = (options.find((o) => o.hasAttribute("selected")) ?? options[0]).getAttribute("value");
  assert.equal(browserDefault, "other", "untouched purpose select must default to 'other'");
  // The first listed option is "claim" — confirming the pre-fix default would have been wrong.
  assert.equal(options[0].getAttribute("value"), "claim");
});

test("add fact: success forwards DTO and refreshes the list in place", async () => {
  let createDto;
  let listCalls = 0;
  const api = stubWithFact({
    listFacts: async () => {
      listCalls++;
      if (listCalls === 1) return { ok: true, value: { rows: [], next_cursor: null } };
      return { ok: true, value: { rows: [factRow({ statement_text: "Newly added." })], next_cursor: null } };
    },
    createFact: async (dto) => {
      createDto = dto;
      return { ok: true, value: { id: "01jzfactnew0000000000000000", statement_text: "Newly added.", status: "candidate", source_type: "lawyer_authored", created_at: "2026-06-05T00:00:00.000Z", matter_id: VALID_ULID } };
    },
  });
  const { root, statement, addBtn } = await mountFactsWithAdd(api);
  assert.equal(listCalls, 1);
  statement.value = "Newly added.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(createDto, { matterId: VALID_ULID, statement_text: "Newly added.", purpose: "other" });
  assert.equal(collectText(findByTestId(root, "view-facts-add-status")), "Added.");
  assert.equal(listCalls, 2, "list refreshed in place");
  const statements = findAllByTestId(root, "view-facts-statement").map(collectText);
  assert.deepEqual(statements, ["Newly added."]);
  assert.equal(addBtn.hasAttribute("disabled"), false);
});

test("add fact: timeline_event reveals + requires as_of_date; switching away hides + drops it", async () => {
  let createDto;
  const api = stubWithFact({ createFact: async (dto) => { createDto = dto; return { ok: true, value: {} }; } });
  const { statement, purpose, asof, addBtn } = await mountFactsWithAdd(api);
  // reveal
  purpose.value = "timeline_event";
  purpose.dispatchEvent({ type: "change" });
  assert.equal(asof.hasAttribute("hidden"), false);
  assert.equal(asof.getAttribute("aria-required"), "true");
  // switch away → hidden + required state removed
  purpose.value = "claim";
  purpose.dispatchEvent({ type: "change" });
  assert.equal(asof.hasAttribute("hidden"), true);
  assert.equal(asof.hasAttribute("aria-required"), false);
  assert.equal(asof.hasAttribute("required"), false);
  // a stale date value must NOT be forwarded for a non-timeline purpose
  asof.value = "2026-06-15";
  statement.value = "A claim.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(createDto, { matterId: VALID_ULID, statement_text: "A claim.", purpose: "claim" });
});

test("add fact: timeline_event forwards as_of_date", async () => {
  let createDto;
  const api = stubWithFact({ createFact: async (dto) => { createDto = dto; return { ok: true, value: {} }; } });
  const { statement, purpose, asof, addBtn } = await mountFactsWithAdd(api);
  purpose.value = "timeline_event";
  purpose.dispatchEvent({ type: "change" });
  asof.value = "2026-06-15";
  statement.value = "Event happened.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(createDto, { matterId: VALID_ULID, statement_text: "Event happened.", purpose: "timeline_event", as_of_date: "2026-06-15" });
});

test("add fact: empty statement → inline error, createFact NOT called", async () => {
  let called = false;
  const api = stubWithFact({ createFact: async () => { called = true; return { ok: true, value: {} }; } });
  const { root, statement, addBtn } = await mountFactsWithAdd(api);
  statement.value = "   "; // whitespace only
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  const err = findByTestId(root, "view-facts-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
});

test("add fact: backend error envelope → inline role=alert, no refresh, button re-enabled", async () => {
  let listCalls = 0;
  const api = stubWithFact({
    listFacts: async () => { listCalls++; return { ok: true, value: { rows: [], next_cursor: null } }; },
    createFact: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "statement_text must be a non-empty string" } }),
  });
  const { root, statement, addBtn } = await mountFactsWithAdd(api);
  assert.equal(listCalls, 1);
  statement.value = "A fact.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-facts-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "statement_text must be a non-empty string");
  assert.equal(listCalls, 1, "list NOT refreshed on error");
  assert.equal(addBtn.hasAttribute("disabled"), false);
});

test("add fact: timeline_event with empty as_of_date → client precheck, createFact NOT called", async () => {
  let called = false;
  const api = stubWithFact({ createFact: async () => { called = true; return { ok: true, value: {} }; } });
  const { root, statement, purpose, addBtn } = await mountFactsWithAdd(api);
  purpose.value = "timeline_event";
  purpose.dispatchEvent({ type: "change" });
  statement.value = "Event with no date.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false, "createFact not called when the timeline date is empty");
  const err = findByTestId(root, "view-facts-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
});

test("add fact: createFact rejection → generic inline alert, button re-enabled (no unhandled rejection)", async () => {
  const api = stubWithFact({ createFact: async () => { throw new Error("ipc transport boom"); } });
  const { root, statement, addBtn } = await mountFactsWithAdd(api);
  statement.value = "A fact.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-facts-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "Could not add the fact. Please try again.");
  assert.equal(addBtn.hasAttribute("disabled"), false, "button re-enabled in finally");
});

test("add fact: a superseded (stale) load cannot mutate the refreshed list", async () => {
  // The initial load hangs; the post-add refresh supersedes it. When the stale
  // initial response finally resolves, the generation guard must drop it.
  const pending = [];
  let n = 0;
  const api = stubWithFact({
    listFacts: async () => {
      n++;
      if (n === 1) return new Promise((res) => pending.push(res)); // initial: hangs
      return { ok: true, value: { rows: [factRow({ statement_text: "Refreshed." })], next_cursor: null } };
    },
    createFact: async () => ({ ok: true, value: {} }),
  });
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" }); // load #1 (hangs)
  await flush();
  findByTestId(root, "view-facts-add-statement").value = "Refreshed.";
  findByTestId(root, "view-facts-add").dispatchEvent({ type: "click" }); // create + refresh (#2)
  await flush();
  assert.deepEqual(findAllByTestId(root, "view-facts-statement").map(collectText), ["Refreshed."]);
  // Resolve the stale initial load now — it must NOT inject its row.
  pending[0]({ ok: true, value: { rows: [factRow({ statement_text: "STALE." })], next_cursor: null } });
  await flush();
  assert.deepEqual(
    findAllByTestId(root, "view-facts-statement").map(collectText),
    ["Refreshed."],
    "stale load dropped by the generation guard",
  );
});

test("add fact: unknown_matter envelope → inline role=alert with server message", async () => {
  const api = stubWithFact({
    createFact: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "unknown_matter", message: "matter not found" } }),
  });
  const { root, statement, addBtn } = await mountFactsWithAdd(api);
  statement.value = "Some fact.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-facts-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "matter not found");
});
