// The open-original control on a document row (product plan R1, WI-6).
//
// The bridge is injected, so these prove the screen's behaviour and nothing about the wiring —
// that is the Electron test's job. What is pinned here is what the screen REFUSES to say:
//
//   * it never sends anything but (matterId, documentId) — no path, no filename
//   * `document_altered` is a finding, not a retryable failure: no 请重试, no "操作失败"
//   * "done" claims only what was proved: verified, a read-only copy, the original untouched
//   * a refusal code that does not exist yet degrades to a sentence, never to a blank
//   * nothing derived from the filesystem or the OS reaches the DOM
//   * with no bridge there is no control — a button that cannot deliver is the #283 defect

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderDocumentsDisclosure } from "../dist/renderer/screens/viewMatterDocuments.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import { MockDoc, makeStubApi, findByTestId, collectText, flush, VALID_ULID } from "./_view-matter-dom.mjs";

const DOC_ID = "01j0000000000000000000docum".slice(0, 26);
const ROW = { id: DOC_ID, filename: "exhibit.pdf", doc_type: "pleading", status: "registered", received_at: "2026-09-08T00:00:00.000Z" };
// Every field renderDocumentDetail reads, with plausible values — a missing one would render the
// word "undefined" rather than throw, which is a worse failure because nothing notices it.
const DETAIL = { id: DOC_ID, filename: "exhibit.pdf", doc_type: "pleading", status: "registered", received_at: ROW.received_at,
  content_hash: "a".repeat(64), storage_uri: "file:///store/x", byte_size: 17, page_count: 3, mime_type: "application/pdf", language: "zh" };

/** Mount, open the lazy disclosure, expand the one row so its detail (and the control) render. */
async function mountWithRow(openOriginal) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDocuments: async () => ({ ok: true, value: { rows: [ROW], next_cursor: null } }),
    getDocument: async () => ({ ok: true, value: DETAIL }),
  });
  root.appendChild(renderDocumentsDisclosure(doc, api, VALID_ULID, openOriginal));
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  findByTestId(root, "view-docs-item-summary").dispatchEvent({ type: "click" });
  await flush();
  return { root, doc };
}

async function press(root) {
  findByTestId(root, "view-docs-open").dispatchEvent({ type: "click" });
  await flush();
  return findByTestId(root, "view-docs-open-status");
}

// MARK: - What is sent

test("the control sends exactly (matterId, documentId) — no path, no filename", async () => {
  const calls = [];
  const { root } = await mountWithRow(async (...a) => { calls.push(a); return { ok: true }; });
  await press(root);
  assert.deepEqual(calls, [[VALID_ULID, DOC_ID]], "an identity and nothing else crosses the boundary");
});

test("with no bridge, NO control is rendered — never a button that cannot deliver", async () => {
  const { root } = await mountWithRow(null);
  assert.equal(findByTestId(root, "view-docs-open"), null);
  assert.equal(findByTestId(root, "view-docs-open-control"), null);
});

// MARK: - What is said

test("success says verified + read-only copy + original untouched, and no more", async () => {
  const { root } = await mountWithRow(async () => ({ ok: true }));
  const status = await press(root);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(collectText(status), CATALOG["document.open.done"]);
  const v = CATALOG["document.open.done"];
  assert.ok(v.includes("核验") && v.includes("只读"), "it must say what was proved: verified, read-only");
  assert.ok(v.includes("原件本身未被打开"), "and that the original itself was not opened");
});

test("document_altered is a FINDING about the evidence — never an invitation to retry", async () => {
  const { root } = await mountWithRow(async () => ({ ok: false, code: "document_altered" }));
  const status = await press(root);
  assert.equal(status.getAttribute("role"), "alert");
  const v = collectText(status);
  assert.equal(v, CATALOG["document.open.failed.altered"]);
  assert.equal(/请重试/.test(v), false, "repeating the open returns the same verdict; 请重试 would call a changed exhibit a glitch");
  assert.ok(v.includes("哈希") && v.includes("拒绝"), "it must name the mismatch and the refusal");
  assert.ok(v.includes("核查"), "and tell the owner what to do instead of retrying");
});

test("each refusal code maps to its own sentence, and an unknown code degrades to a sentence", async () => {
  const cases = [
    ["unknown_document", "document.open.failed.unknown"],
    ["document_missing", "document.open.failed.missing"],
    ["document_unverifiable", "document.open.failed.unverifiable"],
    ["open_failed", "document.open.failed.open"],
    ["invalid_request", "document.open.failed.request"],
    ["something_from_a_later_version", "document.open.failed.request"],
  ];
  for (const [code, key] of cases) {
    const { root } = await mountWithRow(async () => ({ ok: false, code, reason: "outside_store" }));
    const status = await press(root);
    assert.equal(status.getAttribute("role"), "alert", code);
    assert.equal(collectText(status), CATALOG[key], code);
    assert.ok(collectText(status).length > 0, `${code} must never render blank`);
  }
});

test("a rejecting bridge is caught: a sentence, no raw text, and the button comes back", async () => {
  const { root } = await mountWithRow(async () => { throw new Error("IPC dead: /Volumes/Client Name/x.pdf"); });
  const status = await press(root);
  assert.equal(status.getAttribute("role"), "alert");
  assert.equal(collectText(status), CATALOG["document.open.failed.open"]);
  assert.equal(collectText(status).includes("Client Name"), false, "no OS or path text reaches the screen");
  assert.equal(findByTestId(root, "view-docs-open").disabled, false, "the owner must be able to try again");
});

test("the button is disabled while the open is in flight, and re-enabled after a refusal", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { root } = await mountWithRow(async () => { await gate; return { ok: false, code: "open_failed" }; });
  const btn = findByTestId(root, "view-docs-open");
  btn.dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  assert.equal(btn.disabled, true, "a second click mid-verification would queue a second open");
  assert.equal(collectText(findByTestId(root, "view-docs-open-status")), CATALOG["document.open.working"]);
  release();
  await flush();
  assert.equal(btn.disabled, false);
});

// MARK: - Copy conventions for this family

test("open-failure copy either follows 无法…请重试。 or names a corrective action", () => {
  // Same deliberate deviation the backup screen made, pinned the same way so it is a decision and
  // not an accident of key naming. `altered` and `unverifiable` name what to CHECK; `missing`
  // names what to RESTORE; the rest keep the shared retry form.
  const CORRECTIVE = ["请刷新", "恢复", "核查"];
  const keys = Object.keys(CATALOG).filter((k) => k.startsWith("document.open.failed."));
  assert.equal(keys.length, 6, `expected the six-code family; found ${keys.length}`);
  for (const k of keys) {
    const v = CATALOG[k];
    assert.match(v, /[一-鿿]/, `${k} must be zh-CN`);
    const shared = /^无法.+，请重试。$/.test(v);
    const corrective = CORRECTIVE.some((c) => v.includes(c));
    assert.ok(shared || corrective, `${k} neither follows the shared failure form nor tells the owner what to change: ${v}`);
  }
});

test("no open-family string claims the original itself was opened", () => {
  for (const [k, v] of Object.entries(CATALOG)) {
    if (!k.startsWith("document.open.")) continue;
    assert.equal(/已打开原件|打开了原件/.test(v), false, `${k} must not say the original was opened; only a read-only copy ever is: ${v}`);
  }
});
