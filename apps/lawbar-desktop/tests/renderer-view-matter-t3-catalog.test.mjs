// Renderer DOM tests for the read-only T3 证据目录及说明 preview section
// (WI-FORMS-T3-S2-CATALOG-PREVIEW-00). Pure-Node; the shared mock document + a
// T3-aware stub api (the shared makeStubApi predates the T3 channel, so it is
// wrapped here — the out-of-scope shared harness is not edited). Asserts the
// design §Behavior states table: lazy load, header + 4-column table, reviewNeeded
// marker cells, empty state, envelope-error alert, and the submitter-refusal banner.

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

function modelFixture(overrides = {}) {
  return {
    formType: "证据目录及说明",
    matterId: VALID_ULID,
    litigationPosition: { value: "plaintiff" },
    submitterName: { text: "孙乐驰" },
    rows: [],
    ...overrides,
  };
}

function row(seq, overrides = {}) {
  return {
    sequence: seq,
    evidenceId: `e-${seq}`,
    evidenceName: { text: `名称${seq}` },
    proofStatement: { text: `内容${seq}` },
    pageRange: { text: `${seq}` },
    ...overrides,
  };
}

function stubWithT3(impl = {}) {
  return {
    ...makeStubApi(impl),
    previewT3Catalog:
      impl.previewT3Catalog ??
      (async () => ({ ok: true, value: { kind: "model", model: modelFixture() } })),
    exportT3Docx:
      impl.exportT3Docx ?? (async () => ({ ok: true, value: { written: true } })),
  };
}

async function mountT3(api) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  return root;
}

async function openT3(api) {
  const root = await mountT3(api);
  findByTestId(root, "view-t3-summary").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

test("t3 preview: lazy — previewT3Catalog not called before disclosure open", async () => {
  let calls = 0;
  const api = stubWithT3({
    previewT3Catalog: async () => {
      calls++;
      return { ok: true, value: { kind: "model", model: modelFixture() } };
    },
  });
  const root = await mountT3(api);
  assert.equal(calls, 0, "not called at mount");
  findByTestId(root, "view-t3-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(calls, 1, "called once on first open");
  // a second open must not re-fetch
  findByTestId(root, "view-t3-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(calls, 1, "no re-fetch on re-open");
});

test("t3 preview: renders the 提交人诉讼地位 + 名称 header and the 4-column table rows", async () => {
  const api = stubWithT3({
    previewT3Catalog: async () => ({
      ok: true,
      value: { kind: "model", model: modelFixture({ rows: [row(1), row(2), row(3)] }) },
    }),
  });
  const root = await openT3(api);
  const header = findByTestId(root, "view-t3-header");
  assert.ok(header !== null);
  const headerText = collectText(header);
  assert.match(headerText, /提交人诉讼地位/);
  assert.match(headerText, /原告/);
  assert.match(headerText, /孙乐驰/);
  const table = findByTestId(root, "view-t3-table");
  assert.ok(table !== null);
  const rows = findAllByTestId(root, "view-t3-row");
  assert.equal(rows.length, 3);
  assert.match(collectText(rows[0]), /名称1/);
  assert.match(collectText(rows[0]), /内容1/);
});

test("t3 preview: a reviewNeeded cell renders the explicit marker (never blank)", async () => {
  const api = stubWithT3({
    previewT3Catalog: async () => ({
      ok: true,
      value: {
        kind: "model",
        model: modelFixture({
          rows: [row(1, { evidenceName: { reviewNeeded: true }, proofStatement: { reviewNeeded: true }, pageRange: { reviewNeeded: true } })],
        }),
      },
    }),
  });
  const root = await openT3(api);
  const markers = findAllByTestId(root, "view-t3-review-needed");
  assert.equal(markers.length, 3, "three review-needed cells → three explicit markers");
  assert.match(collectText(markers[0]), /复核/);
});

test("t3 preview: litigationPosition {value} renders the position; {reviewNeeded} renders the marker", async () => {
  const posApi = stubWithT3({
    previewT3Catalog: async () => ({
      ok: true,
      value: { kind: "model", model: modelFixture({ litigationPosition: { value: "defendant" } }) },
    }),
  });
  const posRoot = await openT3(posApi);
  assert.match(collectText(findByTestId(posRoot, "view-t3-header")), /被告/);

  const rnApi = stubWithT3({
    previewT3Catalog: async () => ({
      ok: true,
      value: { kind: "model", model: modelFixture({ litigationPosition: { reviewNeeded: true }, rows: [] }) },
    }),
  });
  const rnRoot = await openT3(rnApi);
  // rows are empty, so the ONLY review-needed marker is the position one.
  const markers = findAllByTestId(rnRoot, "view-t3-review-needed");
  assert.equal(markers.length, 1);
});

test("t3 preview: empty (no accepted rows) renders the empty message, no table", async () => {
  const api = stubWithT3({
    previewT3Catalog: async () => ({ ok: true, value: { kind: "model", model: modelFixture({ rows: [] }) } }),
  });
  const root = await openT3(api);
  assert.ok(findByTestId(root, "view-t3-empty") !== null);
  assert.equal(findByTestId(root, "view-t3-table"), null);
});

test("t3 preview: envelope error renders role=alert view-t3-error with the safe message", async () => {
  const api = stubWithT3({
    previewT3Catalog: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "unknown_matter", message: "unknown matter" },
    }),
  });
  const root = await openT3(api);
  const err = findByTestId(root, "view-t3-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["error.unknown_matter"]);
});

test("t3 preview: refusal success value renders the banner naming the code; no guessed name", async () => {
  for (const code of [
    "submitter_selection_required",
    "submitter_index_out_of_range",
    "submitter_not_client",
    "submitter_selection_stale",
  ]) {
    const api = stubWithT3({
      previewT3Catalog: async () => ({ ok: true, value: { kind: "refusal", code } }),
    });
    const root = await openT3(api);
    const banner = findByTestId(root, "view-t3-refusal");
    assert.ok(banner !== null, `banner present for ${code}`);
    assert.equal(banner.getAttribute("role"), "alert");
    assert.match(collectText(banner), new RegExp(code), `banner names the raw code ${code}`);
    // no table + no header submitter name is rendered on a refusal
    assert.equal(findByTestId(root, "view-t3-table"), null);
    assert.equal(findByTestId(root, "view-t3-header"), null);
  }
});

// ---------- DOCX export trigger (WI-FORMS-T3-S3-DOCX-EXPORT-00) ----------

async function clickExport(api) {
  const root = await mountT3(api);
  findByTestId(root, "view-t3-export-docx").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

test("t3 export: the 导出 DOCX button is present and invokes exportT3Docx with the matterId", async () => {
  let seen = null;
  const api = stubWithT3({
    exportT3Docx: async (dto) => {
      seen = dto;
      return { ok: true, value: { written: true } };
    },
  });
  const root = await mountT3(api);
  const button = findByTestId(root, "view-t3-export-docx");
  assert.ok(button !== null, "export button present");
  assert.equal(button.getAttribute("type"), "button");
  button.dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(seen, { matterId: VALID_ULID }, "export invoked with only the matterId");
});

test("t3 export: written:true renders the success note", async () => {
  const api = stubWithT3({ exportT3Docx: async () => ({ ok: true, value: { written: true } }) });
  const root = await clickExport(api);
  assert.ok(findByTestId(root, "view-t3-export-written") !== null, "success note shown");
  assert.equal(findByTestId(root, "view-t3-export-error"), null);
});

test("t3 export: written:false (cancel) renders the neutral cancelled note, not an error", async () => {
  const api = stubWithT3({ exportT3Docx: async () => ({ ok: true, value: { written: false } }) });
  const root = await clickExport(api);
  assert.ok(findByTestId(root, "view-t3-export-cancelled") !== null, "cancelled note shown");
  assert.equal(findByTestId(root, "view-t3-export-error"), null, "cancel is not an error");
  assert.equal(findByTestId(root, "view-t3-export-written"), null);
});

test("t3 export: a refusal value renders the refusal banner naming the code (no document)", async () => {
  const api = stubWithT3({
    exportT3Docx: async () => ({ ok: true, value: { exported: false, refusal: { code: "submitter_selection_required" } } }),
  });
  const root = await clickExport(api);
  const banner = findByTestId(root, "view-t3-refusal");
  assert.ok(banner !== null, "refusal banner shown");
  assert.equal(banner.getAttribute("role"), "alert");
  assert.match(collectText(banner), /submitter_selection_required/);
  assert.equal(findByTestId(root, "view-t3-export-written"), null);
});

test("t3 export: an error envelope renders role=alert with the safe message", async () => {
  const api = stubWithT3({
    exportT3Docx: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "unknown_matter", message: "unknown matter" },
    }),
  });
  const root = await clickExport(api);
  const err = findByTestId(root, "view-t3-export-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["error.unknown_matter"]);
});

test("t3 export: a REJECTED export call renders the inline error AND re-enables the button (M1)", async () => {
  // The preload/IPC bridge throws instead of returning an envelope. The handler must
  // catch it, render an i18n-backed generic error via role=alert, clear the working
  // indicator, and re-enable the button (never leave the surface stuck disabled).
  const api = stubWithT3({
    exportT3Docx: async () => {
      throw new Error("preload bridge exploded");
    },
  });
  const root = await mountT3(api);
  const button = findByTestId(root, "view-t3-export-docx");
  button.dispatchEvent({ type: "click" });
  await flush();

  // an inline generic error is shown, role=alert; NO raw error text leaks
  const err = findByTestId(root, "view-t3-export-error");
  assert.ok(err !== null, "a rejected export renders the inline error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.doesNotMatch(collectText(err), /preload bridge exploded/, "raw error text is not leaked");
  assert.match(collectText(err), /导出失败/, "the i18n generic export-failed message is shown");
  // the working indicator is cleared
  assert.equal(findByTestId(root, "view-t3-export-working"), null, "working indicator cleared");
  // the button is re-enabled — not left disabled
  assert.equal(button.hasAttribute("disabled"), false, "button re-enabled after a rejected export");
});
