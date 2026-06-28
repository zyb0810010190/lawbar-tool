// Evidence-links EXPORT-CITATIONS tests (WI-A3-LINK-UI-T1). Pure-Node; mock doc + api.
// Asserts the export panel: the header button triggers exportLinkCitations and
// renders { citations, byFlag } read-only; export FLAGS appear ONLY here (the data
// contract, design §2), with a per-citation data-flag; a clean citation shows its
// 卷X页Y text; empty + server-safe-message error paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import {
  VALID_ULID,
  MockDoc,
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

function cleanCitation(overrides = {}) {
  return {
    linkId: "01jzlink00000000000000000a",
    sourceType: "evidence",
    sourceId: "src-1",
    documentId: "doc-1",
    physicalPageIndex: 3,
    linkStatus: "valid",
    exportFlag: null,
    citation: { citationVolume: "1", citationPageLabel: "5", text: "卷1页5" },
    ...overrides,
  };
}

function brokenCitation(overrides = {}) {
  return {
    linkId: "01jzlink00000000000000000b",
    sourceType: "note",
    sourceId: "src-2",
    documentId: null,
    physicalPageIndex: null,
    linkStatus: "broken",
    exportFlag: "BROKEN",
    citation: null,
    ...overrides,
  };
}

async function openLinks(api) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-links-summary").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

test("export: button triggers exportLinkCitations and renders the citation list", async () => {
  let exportCalls = 0;
  const api = stubWithLinks({
    exportLinkCitations: async () => {
      exportCalls++;
      return { ok: true, value: { citations: [cleanCitation(), brokenCitation()], byFlag: { CLEAN: 1, BROKEN: 1 } } };
    },
  });
  const root = await openLinks(api);
  assert.equal(exportCalls, 0, "export not run until the button is clicked");
  findByTestId(root, "view-links-export-btn").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(exportCalls, 1);
  assert.equal(findAllByTestId(root, "view-links-export-citation").length, 2);
});

test("export: each citation carries a data-flag; a clean citation shows its 卷X页Y text", async () => {
  const api = stubWithLinks({
    exportLinkCitations: async () => ({ ok: true, value: { citations: [cleanCitation(), brokenCitation()], byFlag: { CLEAN: 1, BROKEN: 1 } } }),
  });
  const root = await openLinks(api);
  findByTestId(root, "view-links-export-btn").dispatchEvent({ type: "click" });
  await flush();
  const cites = findAllByTestId(root, "view-links-export-citation");
  assert.deepEqual(cites.map((c) => c.getAttribute("data-flag")).sort(), ["BROKEN", "CLEAN"]);
  // The clean citation renders its 卷X页Y text; the broken one does not.
  const texts = findAllByTestId(root, "view-links-export-citation-text").map(collectText);
  assert.deepEqual(texts, ["卷1页5"]);
});

test("export: byFlag summary renders the per-classification counts", async () => {
  const api = stubWithLinks({
    exportLinkCitations: async () => ({ ok: true, value: { citations: [cleanCitation(), brokenCitation()], byFlag: { CLEAN: 1, BROKEN: 1 } } }),
  });
  const root = await openLinks(api);
  findByTestId(root, "view-links-export-btn").dispatchEvent({ type: "click" });
  await flush();
  const summary = collectText(findByTestId(root, "view-links-export-summary"));
  assert.ok(summary.includes("1"), "summary shows counts");
});

test("export: empty citation set → empty state", async () => {
  const api = stubWithLinks({ exportLinkCitations: async () => ({ ok: true, value: { citations: [], byFlag: {} } }) });
  const root = await openLinks(api);
  findByTestId(root, "view-links-export-btn").dispatchEvent({ type: "click" });
  await flush();
  assert.ok(findByTestId(root, "view-links-export-empty") !== null);
});

test("export: backend error envelope → inline role=alert with server message", async () => {
  const api = stubWithLinks({
    exportLinkCitations: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "unknown_matter", message: "matter not found" } }),
  });
  const root = await openLinks(api);
  findByTestId(root, "view-links-export-btn").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-links-export-error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "matter not found");
});

test("export: list rows never carry an export flag (contract: flags only in the panel)", async () => {
  const api = stubWithLinks({
    listLinks: async () => ({ ok: true, value: [{ id: "01jzlink00000000000000000a", matter_id: VALID_ULID, source_type: "evidence", source_id: "src-1", anchor_id: "anc-1", status: "valid", created_at: "2026-06-20T10:00:00Z", unlinked_at: null, unlink_reason: null }] }),
  });
  const root = await openLinks(api);
  // Before opening the export panel, no export-flag element exists anywhere.
  assert.equal(findAllByTestId(root, "view-links-export-flag").length, 0);
  assert.equal(findAllByTestId(root, "view-links-row").length, 1);
});
