// Evidence-links CREATE tests (WI-A3-LINK-UI-T1). Pure-Node; mock document + api.
// Asserts: the sourceType select offers the 5-enum; the create form forwards
// { matterId, sourceType, sourceId, anchorId } and refreshes the list in place;
// client-side required guards; inline server-safe-message error on failure.

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

function stubWithLinks(impl = {}) {
  return {
    ...makeStubApi(impl),
    createLink: impl.createLink ?? (async () => ({ ok: true, value: {} })),
    unlinkLink: impl.unlinkLink ?? (async () => ({ ok: true, value: {} })),
    relinkLink: impl.relinkLink ?? (async () => ({ ok: true, value: {} })),
    listLinks: impl.listLinks ?? (async () => ({ ok: true, value: [] })),
    exportLinkCitations: impl.exportLinkCitations ?? (async () => ({ ok: true, value: { citations: [], byFlag: {} } })),
  };
}

async function mountCreate(api) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-links-summary").dispatchEvent({ type: "click" });
  await flush();
  return {
    root,
    sourceType: findByTestId(root, "view-links-create-source-type"),
    sourceId: findByTestId(root, "view-links-create-source-id"),
    anchorId: findByTestId(root, "view-links-create-anchor-id"),
    btn: findByTestId(root, "view-links-create-btn"),
  };
}

test("create link: sourceType select offers exactly the 5-enum, defaults to evidence", async () => {
  const { sourceType } = await mountCreate(stubWithLinks());
  const opts = findAll(sourceType, (n) => n.tagName === "OPTION");
  assert.deepEqual(
    opts.map((o) => o.getAttribute("value")),
    ["evidence", "note", "question", "calcTerm", "claimElement"],
  );
  const selected = opts.filter((o) => o.hasAttribute("selected"));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].getAttribute("value"), "evidence");
});

test("create link: success forwards the 4-field DTO and refreshes the list in place", async () => {
  let createDto;
  let listCalls = 0;
  const api = stubWithLinks({
    listLinks: async () => { listCalls++; return { ok: true, value: [] }; },
    createLink: async (dto) => { createDto = dto; return { ok: true, value: { id: "01jzlinknew0000000000000000" } }; },
  });
  const { root, sourceType, sourceId, anchorId, btn } = await mountCreate(api);
  assert.equal(listCalls, 1);
  sourceType.value = "note";
  sourceId.value = "src-9";
  anchorId.value = "anc-9";
  btn.dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(createDto, { matterId: VALID_ULID, sourceType: "note", sourceId: "src-9", anchorId: "anc-9" });
  assert.equal(collectText(findByTestId(root, "view-links-create-status")), "已创建。");
  assert.equal(listCalls, 2, "list refreshed in place after create");
  assert.equal(btn.hasAttribute("disabled"), false);
});

test("create link: empty sourceId → inline error, createLink NOT called", async () => {
  let called = false;
  const { root, anchorId, btn } = await mountCreate(stubWithLinks({ createLink: async () => { called = true; return { ok: true, value: {} }; } }));
  anchorId.value = "anc-1";
  btn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  const err = findByTestId(root, "view-links-create-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
});

test("create link: empty anchorId → inline error, createLink NOT called", async () => {
  let called = false;
  const { root, sourceId, btn } = await mountCreate(stubWithLinks({ createLink: async () => { called = true; return { ok: true, value: {} }; } }));
  sourceId.value = "src-1";
  btn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  assert.ok(findByTestId(root, "view-links-create-error") !== null);
});

test("create link: backend error envelope → inline role=alert with server message, no refresh", async () => {
  let listCalls = 0;
  const api = stubWithLinks({
    listLinks: async () => { listCalls++; return { ok: true, value: [] }; },
    createLink: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "invalid_argument", message: "unknown anchor: anc-x" } }),
  });
  const { root, sourceId, anchorId, btn } = await mountCreate(api);
  assert.equal(listCalls, 1);
  sourceId.value = "src-1";
  anchorId.value = "anc-x";
  btn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-links-create-error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "unknown anchor: anc-x");
  assert.equal(listCalls, 1, "list NOT refreshed on error");
  assert.equal(btn.hasAttribute("disabled"), false);
});

test("create link: transport rejection → generic inline alert, button re-enabled", async () => {
  const api = stubWithLinks({ createLink: async () => { throw new Error("ipc boom"); } });
  const { root, sourceId, anchorId, btn } = await mountCreate(api);
  sourceId.value = "src-1";
  anchorId.value = "anc-1";
  btn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-links-create-error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "无法创建链接，请重试。");
  assert.equal(btn.hasAttribute("disabled"), false);
});
