// Evidence-links RELINK tests (WI-A3-LINK-UI-T1). Pure-Node; mock document + api.
// Asserts the one-click relink (no reason): the per-(unlinked)-row Relink button
// forwards { matterId, linkId } and refreshes; inline server-safe-message error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import {
  VALID_ULID,
  MockDoc,
  findByTestId,
  collectText,
  flush,
  makeStubApi,
} from "./_view-matter-dom.mjs";

function unlinkedRow(overrides = {}) {
  return {
    id: "01jzlink00000000000000000a",
    matter_id: VALID_ULID,
    source_type: "evidence",
    source_id: "src-1",
    anchor_id: "anc-1",
    status: "broken",
    created_at: "2026-06-20T10:00:00Z",
    unlinked_at: "2026-06-21T09:00:00Z",
    unlink_reason: "superseded",
    ...overrides,
  };
}

function stubWithLinks(impl = {}) {
  return {
    ...makeStubApi(impl),
    createLink: impl.createLink ?? (async () => ({ ok: true, value: {} })),
    unlinkLink: impl.unlinkLink ?? (async () => ({ ok: true, value: {} })),
    relinkLink: impl.relinkLink ?? (async () => ({ ok: true, value: {} })),
    listLinks: impl.listLinks ?? (async () => ({ ok: true, value: [unlinkedRow()] })),
    exportLinkCitations: impl.exportLinkCitations ?? (async () => ({ ok: true, value: { citations: [], byFlag: {} } })),
  };
}

async function openWithUnlinkedLink(api) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-links-summary").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

test("relink: one click forwards { matterId, linkId } (no reason) and refreshes", async () => {
  let relinkDto;
  let listCalls = 0;
  const api = stubWithLinks({
    listLinks: async () => { listCalls++; return { ok: true, value: [unlinkedRow()] }; },
    relinkLink: async (dto) => { relinkDto = dto; return { ok: true, value: {} }; },
  });
  const root = await openWithUnlinkedLink(api);
  assert.equal(listCalls, 1);
  findByTestId(root, "view-links-relink").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(relinkDto, { matterId: VALID_ULID, linkId: "01jzlink00000000000000000a" });
  assert.equal(Object.prototype.hasOwnProperty.call(relinkDto, "unlinkReason"), false, "relink carries no reason");
  assert.equal(listCalls, 2, "list refreshed after relink");
});

test("relink: backend error envelope → inline role=alert with server message, no refresh", async () => {
  let listCalls = 0;
  const api = stubWithLinks({
    listLinks: async () => { listCalls++; return { ok: true, value: [unlinkedRow()] }; },
    relinkLink: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "illegal_transition", message: "link already active" } }),
  });
  const root = await openWithUnlinkedLink(api);
  findByTestId(root, "view-links-relink").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-links-action-error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["error.illegal_transition"]);
  assert.equal(listCalls, 1, "list NOT refreshed on error");
});

test("relink: transport rejection → generic inline alert", async () => {
  const api = stubWithLinks({ relinkLink: async () => { throw new Error("ipc boom"); } });
  const root = await openWithUnlinkedLink(api);
  findByTestId(root, "view-links-relink").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-links-action-error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "无法恢复链接，请重试。");
});
