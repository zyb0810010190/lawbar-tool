// Evidence-links LIST tests (WI-A3-LINK-UI-T1). Pure-Node; mock document + mock
// api from the shared harness (the shared makeStubApi predates the link channels,
// so it is wrapped here — the out-of-scope shared harness is not edited).
//
// Asserts the design §2 data contract: a list ROW renders resolver status
// (data-status + visible label) + lifecycle (active/unlinked + reason), and NEVER
// an export flag (export flags live only in the export-citations panel).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import {
  VALID_ULID,
  MockDoc,
  findByTestId,
  findAllByTestId,
  collectText,
  flush,
  makeStubApi,
} from "./_view-matter-dom.mjs";

function linkRow(overrides = {}) {
  return {
    id: "01jzlink00000000000000000a",
    matter_id: VALID_ULID,
    source_type: "evidence",
    source_id: "src-1",
    anchor_id: "anc-1",
    status: "valid",
    created_at: "2026-06-20T10:00:00Z",
    unlinked_at: null,
    unlink_reason: null,
    ...overrides,
  };
}

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

async function mountLinks(api) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  return { doc, root };
}

async function openLinks(api) {
  const { root } = await mountLinks(api);
  findByTestId(root, "view-links-summary").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

test("links list: lazy-loads on disclosure open (listLinks not called before click)", async () => {
  let calls = 0;
  const api = stubWithLinks({ listLinks: async () => { calls++; return { ok: true, value: [] }; } });
  const { root } = await mountLinks(api);
  assert.equal(calls, 0, "listLinks not called at mount");
  findByTestId(root, "view-links-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(calls, 1, "listLinks called once on first open");
});

test("links list: empty state renders heading + body, no rows", async () => {
  const root = await openLinks(stubWithLinks({ listLinks: async () => ({ ok: true, value: [] }) }));
  assert.ok(findByTestId(root, "view-links-empty") !== null);
  assert.equal(findAllByTestId(root, "view-links-row").length, 0);
});

test("links list: a row renders resolver status via data-status + visible label, NO export flag", async () => {
  const root = await openLinks(
    stubWithLinks({ listLinks: async () => ({ ok: true, value: [linkRow({ status: "needs_review" })] }) }),
  );
  const rows = findAllByTestId(root, "view-links-row");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].getAttribute("data-status"), "needs_review");
  assert.equal(rows[0].getAttribute("data-lifecycle"), "active");
  const statusEl = findByTestId(root, "view-links-status");
  assert.equal(statusEl.getAttribute("data-status"), "needs_review");
  assert.ok(collectText(statusEl).length > 0, "status carries a visible label (not color-only)");
  // The data contract: a list row NEVER shows an export flag.
  assert.equal(findAllByTestId(root, "view-links-export-flag").length, 0, "no export flag on a list row");
});

test("links list: an unlinked link shows the unlinked lifecycle marker + reason", async () => {
  const root = await openLinks(
    stubWithLinks({
      listLinks: async () => ({
        ok: true,
        value: [linkRow({ status: "broken", unlinked_at: "2026-06-21T09:00:00Z", unlink_reason: "superseded by exhibit B" })],
      }),
    }),
  );
  const row = findAllByTestId(root, "view-links-row")[0];
  assert.equal(row.getAttribute("data-lifecycle"), "unlinked");
  const lifecycle = findByTestId(row, "view-links-lifecycle");
  assert.equal(lifecycle.getAttribute("data-lifecycle"), "unlinked");
  assert.ok(collectText(findByTestId(row, "view-links-reason")).includes("superseded by exhibit B"));
});

test("links list: an active link offers Unlink; an unlinked link offers Relink", async () => {
  const active = await openLinks(
    stubWithLinks({ listLinks: async () => ({ ok: true, value: [linkRow()] }) }),
  );
  assert.ok(findByTestId(active, "view-links-unlink") !== null);
  assert.equal(findAllByTestId(active, "view-links-relink").length, 0);

  const unlinked = await openLinks(
    stubWithLinks({ listLinks: async () => ({ ok: true, value: [linkRow({ unlinked_at: "2026-06-21T09:00:00Z", unlink_reason: "r" })] }) }),
  );
  assert.ok(findByTestId(unlinked, "view-links-relink") !== null);
  assert.equal(findAllByTestId(unlinked, "view-links-unlink").length, 0);
});

test("links list: backend error envelope → inline role=alert with server safe message", async () => {
  const root = await openLinks(
    stubWithLinks({
      listLinks: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "unknown_matter", message: "matter not found" } }),
    }),
  );
  const err = findByTestId(root, "view-links-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["error.unknown_matter"], "renders the zh-CN code-mapped safe message");
});

test("links list: transport rejection → generic LOAD-failure copy (not the create copy)", async () => {
  const root = await openLinks(stubWithLinks({ listLinks: async () => { throw new Error("ipc boom"); } }));
  const err = findByTestId(root, "view-links-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "无法加载链接，请重试。", "a list-load failure uses the load-failed copy");
});
