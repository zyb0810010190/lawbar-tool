// The Evidence disclosure on the matter view (WI-10).
//
// The bridge is injected, so these prove the screen's behaviour and nothing about the wiring —
// that is the Electron test's job. What is pinned is what the screen REFUSES to do and what it
// forwards:
//   * it creates evidence ONLY from a registered document: the document list comes from
//     listDocuments, choosing one prefills the title from its filename, and submitting sends
//     exactly (matterId, documentId, evidence_title, + the typed optionals) — no status, no id
//   * a missing document or a blank title is refused on-screen without any call
//   * adopt / exclude forward exactly (matterId, evidenceId, to) and refresh the list
//   * only proposed rows carry review controls; accepted and rejected rows carry none
//   * a boundary code becomes a sentence; raw text never reaches the DOM; the button comes back
//   * with no registered documents the add control says so and cannot submit

import { test } from "node:test";
import assert from "node:assert/strict";

import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import { MockDoc, makeStubApi, findByTestId, findAllByTestId, collectText, flush, VALID_ULID } from "./_view-matter-dom.mjs";

const DOC_A = "01j0000000000000000000docaa".slice(0, 26);
const DOC_B = "01j0000000000000000000docbb".slice(0, 26);
const EV_1 = "01j00000000000000000000ev01".slice(0, 26);
const EV_2 = "01j00000000000000000000ev02".slice(0, 26);

const DOCS = [
  { id: DOC_A, filename: "contract.pdf", doc_type: "exhibit", status: "registered", received_at: "2026-09-10T00:00:00.000Z" },
  { id: DOC_B, filename: "invoice.pdf", doc_type: "exhibit", status: "registered", received_at: "2026-09-10T00:00:00.000Z" },
];

function evidenceRow(overrides = {}) {
  return { id: EV_1, status: "proposed", evidence_title: "合同", source_document_id: DOC_A, party_side: "our", exhibit_page_range: "1-3", ...overrides };
}

async function mount(impl = {}) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDocuments: impl.listDocuments ?? (async () => ({ ok: true, value: { rows: DOCS, next_cursor: null } })),
    ...impl,
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-evidence-summary").dispatchEvent({ type: "click" });
  await flush();
  await flush();
  return { root, doc, api };
}

function setValue(elm, v) { elm.value = v; }

// MARK: - Create from a registered document

test("the add control offers exactly the matter's registered documents, and choosing one prefills the title", async () => {
  const { root } = await mount();
  const select = findByTestId(root, "view-evidence-add-document");
  const options = select.children.filter((c) => c.tagName === "OPTION" || c.tag === "option");
  assert.equal(options.length, 3, "placeholder + two documents");
  assert.deepEqual(options.slice(1).map((o) => o.getAttribute("value")), [DOC_A, DOC_B]);
  setValue(select, DOC_B);
  select.dispatchEvent({ type: "change" });
  assert.equal(findByTestId(root, "view-evidence-add-title").value, "invoice.pdf", "the filename is the default title");
});

test("submit sends exactly (matterId, documentId, evidence_title) plus the typed optionals — nothing else", async () => {
  const calls = [];
  const { root } = await mount({
    createEvidenceItem: async (dto) => { calls.push(dto); return { ok: true, value: evidenceRow() }; },
  });
  setValue(findByTestId(root, "view-evidence-add-document"), DOC_A);
  setValue(findByTestId(root, "view-evidence-add-title"), "  劳动合同 ");
  setValue(findByTestId(root, "view-evidence-add-proof"), "证明劳动关系");
  setValue(findByTestId(root, "view-evidence-add-pages"), "1-5");
  setValue(findByTestId(root, "view-evidence-add-side"), "our");
  findByTestId(root, "view-evidence-add").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(calls, [{ matterId: VALID_ULID, documentId: DOC_A, evidence_title: "劳动合同", proof_statement: "证明劳动关系", exhibit_page_range: "1-5", party_side: "our" }]);
  assert.equal(collectText(findByTestId(root, "view-evidence-add-status")), CATALOG["evidence.added"]);
});

test("optionals left blank are ABSENT from the DTO, not sent as empty strings", async () => {
  const calls = [];
  const { root } = await mount({ createEvidenceItem: async (dto) => { calls.push(dto); return { ok: true, value: evidenceRow() }; } });
  setValue(findByTestId(root, "view-evidence-add-document"), DOC_A);
  setValue(findByTestId(root, "view-evidence-add-title"), "合同");
  findByTestId(root, "view-evidence-add").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(calls, [{ matterId: VALID_ULID, documentId: DOC_A, evidence_title: "合同" }]);
});

test("no document chosen, or a blank title, is refused on-screen and NO call is made", async () => {
  let calls = 0;
  const { root } = await mount({ createEvidenceItem: async () => { calls += 1; return { ok: true, value: evidenceRow() }; } });
  setValue(findByTestId(root, "view-evidence-add-title"), "合同");
  findByTestId(root, "view-evidence-add").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-evidence-add-error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["evidence.error.documentRequired"]);
  setValue(findByTestId(root, "view-evidence-add-document"), DOC_A);
  setValue(findByTestId(root, "view-evidence-add-title"), "   ");
  findByTestId(root, "view-evidence-add").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(collectText(findByTestId(root, "view-evidence-add-error")), CATALOG["evidence.error.titleRequired"]);
  assert.equal(calls, 0);
});

test("with no registered documents, the control says so and cannot submit", async () => {
  const { root } = await mount({ listDocuments: async () => ({ ok: true, value: { rows: [], next_cursor: null } }) });
  assert.equal(collectText(findByTestId(root, "view-evidence-add-no-documents")), CATALOG["evidence.add.noDocuments"]);
  assert.equal(findByTestId(root, "view-evidence-add").getAttribute("disabled"), "true");
});

test("a boundary code on create becomes a sentence, raw text never reaches the DOM, and the button comes back", async () => {
  const { root } = await mount({
    createEvidenceItem: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "unknown_document", message: "/Volumes/Client Name/x.pdf" } }),
  });
  setValue(findByTestId(root, "view-evidence-add-document"), DOC_A);
  setValue(findByTestId(root, "view-evidence-add-title"), "合同");
  findByTestId(root, "view-evidence-add").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-evidence-add-error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["error.unknown_document"]);
  assert.equal(collectText(err).includes("Client Name"), false);
  assert.equal(findByTestId(root, "view-evidence-add").getAttribute("disabled"), null);
});

// MARK: - Rows and review

test("only proposed rows carry adopt/exclude; accepted and rejected rows carry no controls", async () => {
  const { root } = await mount({
    listEvidenceItems: async () => ({ ok: true, value: { rows: [evidenceRow(), evidenceRow({ id: EV_2, status: "accepted", evidence_title: "发票" }), evidenceRow({ id: "x".repeat(26), status: "rejected", evidence_title: "信函" })], next_cursor: null } }),
  });
  const rows = findAllByTestId(root, "view-evidence-row");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.getAttribute("data-status")), ["proposed", "accepted", "rejected"]);
  assert.equal(findAllByTestId(root, "view-evidence-review-control").length, 1, "controls on the proposed row only");
  assert.equal(findAllByTestId(root, "view-evidence-review-accepted").length, 1);
  assert.equal(findAllByTestId(root, "view-evidence-review-rejected").length, 1);
  const statuses = findAllByTestId(root, "view-evidence-status").map(collectText);
  assert.ok(statuses[0].startsWith(CATALOG["evidence.status.proposed"]));
  assert.ok(statuses[1].startsWith(CATALOG["evidence.status.accepted"]));
  assert.ok(statuses[2].startsWith(CATALOG["evidence.status.rejected"]));
  assert.equal(collectText(findAllByTestId(root, "view-evidence-pages")[0]), CATALOG["evidence.pagesPrefix"].replace("{pages}", "1-3"));
});

test("adopt forwards exactly (matterId, evidenceId, to: accepted) and the list refreshes", async () => {
  const calls = [];
  let listed = 0;
  const { root } = await mount({
    listEvidenceItems: async () => { listed += 1; return { ok: true, value: { rows: [evidenceRow(listed > 1 ? { status: "accepted" } : {})], next_cursor: null } }; },
    transitionEvidenceItem: async (dto) => { calls.push(dto); return { ok: true, value: evidenceRow({ status: "accepted" }) }; },
  });
  findByTestId(root, "view-evidence-review-accepted").dispatchEvent({ type: "click" });
  await flush();
  await flush();
  assert.deepEqual(calls, [{ matterId: VALID_ULID, evidenceId: EV_1, to: "accepted" }]);
  assert.equal(findAllByTestId(root, "view-evidence-row")[0].getAttribute("data-status"), "accepted", "refreshed from the list, not patched locally");
  assert.equal(findAllByTestId(root, "view-evidence-review-control").length, 0);
});

test("exclude forwards to: rejected; an illegal_transition code becomes a sentence and the buttons come back", async () => {
  const calls = [];
  const { root } = await mount({
    listEvidenceItems: async () => ({ ok: true, value: { rows: [evidenceRow()], next_cursor: null } }),
    transitionEvidenceItem: async (dto) => { calls.push(dto); return { ok: false, error: { kind: "case_box_persistence_error", code: "illegal_transition", message: "raw" } }; },
  });
  findByTestId(root, "view-evidence-review-rejected").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(calls, [{ matterId: VALID_ULID, evidenceId: EV_1, to: "rejected" }]);
  const err = findByTestId(root, "view-evidence-review-error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["error.illegal_transition"]);
  assert.equal(findByTestId(root, "view-evidence-review-accepted").getAttribute("disabled"), null);
});

test("an empty list shows the empty state and its hint; a throwing bridge shows the load-failed sentence", async () => {
  const a = await mount();
  assert.equal(collectText(findByTestId(a.root, "view-evidence-empty")).includes(CATALOG["evidence.empty"]), true);
  assert.equal(collectText(findByTestId(a.root, "view-evidence-empty")).includes(CATALOG["evidence.emptyHint"]), true);
  const b = await mount({ listEvidenceItems: async () => { throw new Error("IPC dead"); } });
  const err = findByTestId(b.root, "view-evidence-error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["evidence.load.failed"]);
});

// MARK: - Copy conventions

test("every evidence string is zh-CN, and no string claims an item is in the catalogue before adoption", () => {
  const keys = Object.keys(CATALOG).filter((k) => k.startsWith("evidence."));
  assert.ok(keys.length >= 30, `expected the evidence family; found ${keys.length}`);
  for (const k of keys) assert.match(CATALOG[k], /[一-鿿]/, `${k} must be zh-CN`);
  assert.equal(/已进入证据目录|已列入目录/.test(CATALOG["evidence.added"]), false, "added means proposed, not catalogued");
  assert.ok(CATALOG["evidence.added"].includes("待采纳"), "added must say it awaits adoption");
});
