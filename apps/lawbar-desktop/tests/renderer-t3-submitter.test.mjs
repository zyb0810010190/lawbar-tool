// The submitter picker on the T3 disclosure (WI-11).
//
// The model refuses a matter without exactly one client party and accepts an explicit
// { partyIndex, displayNameEcho }. What is pinned here is what the SCREEN does with that and what it
// refuses to do:
//   * one client party: no picker at all — the model auto-selects, the screen must not second-guess
//   * two client parties: a picker listing EXACTLY the client parties, valued by their index in the
//     FULL parties array (the opposing party in the middle shifts the second client's index to 2)
//   * choosing forwards exactly { matterId, submitterSelection: { partyIndex, displayNameEcho } }
//     to the preview, and the export forwards the same selection
//   * zero client parties: the refusal renders and there is no picker — nothing to choose from
//   * a refusal that comes back AFTER a choice (stale echo) still renders its sentence: the screen
//     does not re-implement the rule or hide the model's answer

import { test } from "node:test";
import assert from "node:assert/strict";

import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import { MockDoc, makeStubApi, findByTestId, findAllByTestId, collectText, flush, VALID_ULID, syntheticMatter } from "./_view-matter-dom.mjs";

const ALPHA = "甲方委托人有限公司";
const BETA = "乙方委托人有限公司";
const TWO_CLIENTS = [
  { role: "client", display_name: ALPHA, party_kind: "organization" },
  { role: "opposing", display_name: "对方当事人", party_kind: "organization" },
  { role: "client", display_name: BETA, party_kind: "organization" },
];
const ONE_CLIENT = [
  { role: "client", display_name: ALPHA, party_kind: "organization" },
  { role: "opposing", display_name: "对方当事人", party_kind: "organization" },
];
const NO_CLIENT = [{ role: "opposing", display_name: "对方当事人", party_kind: "organization" }];

function model(name) {
  return { formType: "证据目录及说明", matterId: VALID_ULID, litigationPosition: { value: "plaintiff" }, submitterName: { text: name }, rows: [] };
}

async function open(parties, impl = {}) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = {
    ...makeStubApi({ getMatter: async () => ({ ok: true, value: syntheticMatter({ parties }) }) }),
    previewT3Catalog: impl.previewT3Catalog ?? (async () => ({ ok: true, value: { kind: "model", model: model(ALPHA) } })),
    exportT3Docx: impl.exportT3Docx ?? (async () => ({ ok: true, value: { written: true } })),
  };
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-t3-summary").dispatchEvent({ type: "click" });
  await flush();
  return { root };
}

test("one client party: no picker is rendered — the model auto-selects", async () => {
  const { root } = await open(ONE_CLIENT);
  assert.equal(findByTestId(root, "view-t3-submitter"), null);
  assert.equal(findByTestId(root, "view-t3-submitter-control"), null);
});

test("zero client parties: the refusal renders and there is no picker — nothing to choose from", async () => {
  const { root } = await open(NO_CLIENT, {
    previewT3Catalog: async () => ({ ok: true, value: { kind: "refusal", code: "submitter_selection_required" } }),
  });
  assert.equal(findByTestId(root, "view-t3-submitter"), null);
  assert.equal(collectText(findByTestId(root, "view-t3-refusal")).includes(CATALOG["viewT3.refusal.submitter_selection_required"]), true);
});

test("two client parties: the picker lists exactly the clients, valued by their index in the FULL parties array", async () => {
  const { root } = await open(TWO_CLIENTS, {
    previewT3Catalog: async () => ({ ok: true, value: { kind: "refusal", code: "submitter_selection_required" } }),
  });
  const select = findByTestId(root, "view-t3-submitter");
  assert.ok(select !== null, "the picker must be offered when there is a choice to make");
  const options = select.children.filter((c) => (c.tagName ?? c.tag ?? "").toLowerCase() === "option");
  assert.deepEqual(options.map((o) => [o.getAttribute("value"), collectText(o)]), [["", CATALOG["viewT3.submitter.placeholder"]], ["0", ALPHA], ["2", BETA]],
    "the opposing party at index 1 is not offered, and the second client keeps index 2");
});

test("choosing forwards exactly { matterId, submitterSelection: { partyIndex, displayNameEcho } } and the model renders with that name", async () => {
  const calls = [];
  const { root } = await open(TWO_CLIENTS, {
    previewT3Catalog: async (dto) => {
      calls.push(dto);
      if (dto.submitterSelection === undefined) return { ok: true, value: { kind: "refusal", code: "submitter_selection_required" } };
      return { ok: true, value: { kind: "model", model: model(dto.submitterSelection.displayNameEcho) } };
    },
  });
  const select = findByTestId(root, "view-t3-submitter");
  select.value = "2";
  select.dispatchEvent({ type: "change" });
  await flush();
  assert.deepEqual(calls, [{ matterId: VALID_ULID }, { matterId: VALID_ULID, submitterSelection: { partyIndex: 2, displayNameEcho: BETA } }]);
  assert.equal(findByTestId(root, "view-t3-refusal"), null, "the refusal is replaced by the model");
  assert.equal(collectText(findByTestId(root, "view-t3-header")).includes(BETA), true);
});

test("the export forwards the same selection the preview used", async () => {
  const exports = [];
  const { root } = await open(TWO_CLIENTS, {
    previewT3Catalog: async (dto) => dto.submitterSelection === undefined
      ? { ok: true, value: { kind: "refusal", code: "submitter_selection_required" } }
      : { ok: true, value: { kind: "model", model: model(ALPHA) } },
    exportT3Docx: async (dto) => { exports.push(dto); return { ok: true, value: { written: true } }; },
  });
  findByTestId(root, "view-t3-export-docx").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(exports, [{ matterId: VALID_ULID }], "before a choice, no selection is invented");
  const select = findByTestId(root, "view-t3-submitter");
  select.value = "0";
  select.dispatchEvent({ type: "change" });
  await flush();
  findByTestId(root, "view-t3-export-docx").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(exports[1], { matterId: VALID_ULID, submitterSelection: { partyIndex: 0, displayNameEcho: ALPHA } });
});

test("a refusal after a choice (stale echo) still renders its own sentence — the screen hides nothing", async () => {
  const { root } = await open(TWO_CLIENTS, {
    previewT3Catalog: async (dto) => ({ ok: true, value: { kind: "refusal", code: dto.submitterSelection === undefined ? "submitter_selection_required" : "submitter_selection_stale" } }),
  });
  const select = findByTestId(root, "view-t3-submitter");
  select.value = "0";
  select.dispatchEvent({ type: "change" });
  await flush();
  const banner = findByTestId(root, "view-t3-refusal");
  assert.equal(banner.getAttribute("role"), "alert");
  assert.equal(collectText(banner).includes(CATALOG["viewT3.refusal.submitter_selection_stale"]), true);
  assert.ok(findByTestId(root, "view-t3-submitter") !== null, "the picker stays so the lawyer can choose again");
});

test("the picker strings are zh-CN and name the role the choice is restricted to", () => {
  for (const k of ["viewT3.submitter.label", "viewT3.submitter.placeholder"]) assert.match(CATALOG[k], /[一-鿿]/, k);
  assert.ok(CATALOG["viewT3.submitter.placeholder"].includes("委托人"), "only clients can be the submitter; the placeholder must say so");
});

// MARK: - Review findings (2026-09-10), each pinned by a test that fails on the pre-fix screen

test("REVIEW: the picker is disabled for the whole export and re-enabled after — a choice mid-export cannot mislabel the DOCX", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { root } = await open(TWO_CLIENTS, {
    previewT3Catalog: async (dto) => dto.submitterSelection === undefined
      ? { ok: true, value: { kind: "refusal", code: "submitter_selection_required" } }
      : { ok: true, value: { kind: "model", model: model(ALPHA) } },
    exportT3Docx: async () => { await gate; return { ok: true, value: { written: true } }; },
  });
  const select = findByTestId(root, "view-t3-submitter");
  select.value = "0";
  select.dispatchEvent({ type: "change" });
  await flush();
  findByTestId(root, "view-t3-export-docx").dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  assert.equal(select.getAttribute("disabled"), "", "while the export is in flight the picker must not accept a different submitter");
  release();
  await flush();
  assert.equal(select.getAttribute("disabled"), null, "and it comes back afterwards");
});

test("REVIEW: two previews in flight — the earlier choice's late answer must NOT render over the later choice", async () => {
  const resolvers = [];
  const { root } = await open(TWO_CLIENTS, {
    previewT3Catalog: async (dto) => {
      if (dto.submitterSelection === undefined) return { ok: true, value: { kind: "refusal", code: "submitter_selection_required" } };
      return new Promise((resolve) => { resolvers.push(() => resolve({ ok: true, value: { kind: "model", model: model(dto.submitterSelection.displayNameEcho) } })); });
    },
  });
  const select = findByTestId(root, "view-t3-submitter");
  select.value = "0"; select.dispatchEvent({ type: "change" });   // ALPHA, slow
  select.value = "2"; select.dispatchEvent({ type: "change" });   // BETA, the lawyer's final choice
  await new Promise((r) => setImmediate(r));
  assert.equal(resolvers.length, 2);
  resolvers[1](); await flush();                                    // BETA answers first
  resolvers[0](); await flush();                                    // ALPHA answers late
  const headers = findAllByTestId(root, "view-t3-header");
  assert.equal(headers.length, 1, "exactly one catalogue is on screen");
  assert.equal(collectText(headers[0]).includes(BETA), true, "and it is the LAST choice's");
  assert.equal(collectText(headers[0]).includes(ALPHA), false);
});
