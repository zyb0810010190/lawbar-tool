// Evidence-links UNLINK tests (WI-A3-LINK-UI-T1). Pure-Node; mock document + api.
// Asserts the two-step required-reason unlink: clicking Unlink reveals the warning
// + reason input + confirm; a blank reason is blocked client-side; the confirm
// forwards { matterId, linkId, unlinkReason } and refreshes; the warning copy
// states the unlink breaks the citation and is recorded in the audit trail.

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
    listLinks: impl.listLinks ?? (async () => ({ ok: true, value: [linkRow()] })),
    exportLinkCitations: impl.exportLinkCitations ?? (async () => ({ ok: true, value: { citations: [], byFlag: {} } })),
  };
}

async function openWithActiveLink(api) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-links-summary").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

test("unlink: reason input + warning + confirm hidden until Unlink is clicked", async () => {
  const root = await openWithActiveLink(stubWithLinks());
  assert.equal(findByTestId(root, "view-links-unlink-reason").hasAttribute("hidden"), true);
  assert.equal(findByTestId(root, "view-links-unlink-confirm").hasAttribute("hidden"), true);
  assert.equal(findByTestId(root, "view-links-unlink-warning").hasAttribute("hidden"), true);
  findByTestId(root, "view-links-unlink").dispatchEvent({ type: "click" });
  assert.equal(findByTestId(root, "view-links-unlink-reason").hasAttribute("hidden"), false);
  assert.equal(findByTestId(root, "view-links-unlink-confirm").hasAttribute("hidden"), false);
  assert.equal(findByTestId(root, "view-links-unlink-warning").hasAttribute("hidden"), false);
  // The reason input is marked required for a11y.
  assert.equal(findByTestId(root, "view-links-unlink-reason").getAttribute("aria-required"), "true");
});

test("unlink: warning copy states it breaks the citation and is audited", async () => {
  const root = await openWithActiveLink(stubWithLinks());
  findByTestId(root, "view-links-unlink").dispatchEvent({ type: "click" });
  const warn = collectText(findByTestId(root, "view-links-unlink-warning"));
  assert.ok(warn.includes("引用") && warn.includes("审计"), "warns about the citation + the audit trail");
});

test("unlink: blank reason → inline error, unlinkLink NOT called", async () => {
  let called = false;
  const root = await openWithActiveLink(stubWithLinks({ unlinkLink: async () => { called = true; return { ok: true, value: {} }; } }));
  findByTestId(root, "view-links-unlink").dispatchEvent({ type: "click" });
  findByTestId(root, "view-links-unlink-reason").value = "   ";
  findByTestId(root, "view-links-unlink-confirm").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false, "a blank reason must not call unlinkLink");
  const err = findByTestId(root, "view-links-action-error");
  assert.equal(err.getAttribute("role"), "alert");
});

test("unlink: confirm forwards { matterId, linkId, unlinkReason } and refreshes", async () => {
  let unlinkDto;
  let listCalls = 0;
  const api = stubWithLinks({
    listLinks: async () => { listCalls++; return { ok: true, value: [linkRow()] }; },
    unlinkLink: async (dto) => { unlinkDto = dto; return { ok: true, value: {} }; },
  });
  const root = await openWithActiveLink(api);
  assert.equal(listCalls, 1);
  findByTestId(root, "view-links-unlink").dispatchEvent({ type: "click" });
  findByTestId(root, "view-links-unlink-reason").value = "superseded";
  findByTestId(root, "view-links-unlink-confirm").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(unlinkDto, { matterId: VALID_ULID, linkId: "01jzlink00000000000000000a", unlinkReason: "superseded" });
  assert.equal(listCalls, 2, "list refreshed after unlink");
});

// --- Unlink escape hatch (WI-UI-2) ---
// The two-step unlink reveals a required reason; it must also offer a way back out.
// Action-row convention for an inline confirm row: confirm FIRST, cancel SECOND.

test("unlink: cancel exists, is hidden until Unlink, and is revealed with the confirm", async () => {
  const root = await openWithActiveLink(stubWithLinks());
  const cancel = findByTestId(root, "view-links-unlink-cancel");
  assert.ok(cancel !== null, "unlink-cancel button present");
  assert.equal(cancel.hasAttribute("hidden"), true, "hidden before the reveal");
  findByTestId(root, "view-links-unlink").dispatchEvent({ type: "click" });
  assert.equal(cancel.hasAttribute("hidden"), false, "revealed by the same path as reason + confirm");
  assert.equal(findByTestId(root, "view-links-unlink-confirm").hasAttribute("hidden"), false);
});

test("unlink: action row DOM order is confirm-before-cancel", async () => {
  const root = await openWithActiveLink(stubWithLinks());
  const actions = findByTestId(root, "view-links-actions");
  const indexOfTestId = (id) =>
    actions.children.findIndex(
      (c) => typeof c.getAttribute === "function" && c.getAttribute("data-test-id") === id,
    );
  const confirmAt = indexOfTestId("view-links-unlink-confirm");
  const cancelAt = indexOfTestId("view-links-unlink-cancel");
  assert.ok(confirmAt >= 0 && cancelAt >= 0, "both buttons are direct children of the action row");
  assert.ok(confirmAt < cancelAt, "confirm precedes cancel in DOM order");
});

test("unlink: cancel collapses warning+reason+confirm+itself, clears the reason, unlinkLink NOT called", async () => {
  let called = false;
  const root = await openWithActiveLink(
    stubWithLinks({ unlinkLink: async () => { called = true; return { ok: true, value: {} }; } }),
  );
  findByTestId(root, "view-links-unlink").dispatchEvent({ type: "click" });
  // a blank-reason confirm leaves an inline error the cancel must also clear
  findByTestId(root, "view-links-unlink-reason").value = "   ";
  findByTestId(root, "view-links-unlink-confirm").dispatchEvent({ type: "click" });
  await flush();
  assert.ok(findByTestId(root, "view-links-action-error") !== null, "inline error present before cancel");
  const reason = findByTestId(root, "view-links-unlink-reason");
  reason.value = "typed then abandoned";
  findByTestId(root, "view-links-unlink-cancel").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false, "cancel makes no api call");
  assert.equal(reason.hasAttribute("hidden"), true, "reason input collapsed");
  assert.equal(reason.hasAttribute("aria-required"), false, "aria-required removed");
  assert.equal(reason.value, "", "typed reason cleared");
  assert.equal(findByTestId(root, "view-links-unlink-confirm").hasAttribute("hidden"), true);
  assert.equal(findByTestId(root, "view-links-unlink-cancel").hasAttribute("hidden"), true);
  assert.equal(findByTestId(root, "view-links-unlink-warning").hasAttribute("hidden"), true);
  assert.equal(findByTestId(root, "view-links-action-error"), null, "inline error cleared");
  assert.equal(collectText(findByTestId(root, "view-links-action-status")), "", "status text cleared");
});

test("unlink: after cancel, Unlink can be re-revealed and still unlinks with a reason", async () => {
  let unlinkDto;
  const api = stubWithLinks({ unlinkLink: async (dto) => { unlinkDto = dto; return { ok: true, value: {} }; } });
  const root = await openWithActiveLink(api);
  findByTestId(root, "view-links-unlink").dispatchEvent({ type: "click" });
  findByTestId(root, "view-links-unlink-cancel").dispatchEvent({ type: "click" });
  findByTestId(root, "view-links-unlink").dispatchEvent({ type: "click" });
  assert.equal(findByTestId(root, "view-links-unlink-reason").hasAttribute("hidden"), false);
  findByTestId(root, "view-links-unlink-reason").value = "superseded";
  findByTestId(root, "view-links-unlink-confirm").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(unlinkDto, { matterId: VALID_ULID, linkId: "01jzlink00000000000000000a", unlinkReason: "superseded" });
});

test("unlink: backend error envelope → inline role=alert with server message, no refresh", async () => {
  let listCalls = 0;
  const api = stubWithLinks({
    listLinks: async () => { listCalls++; return { ok: true, value: [linkRow()] }; },
    unlinkLink: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "illegal_transition", message: "link already unlinked" } }),
  });
  const root = await openWithActiveLink(api);
  findByTestId(root, "view-links-unlink").dispatchEvent({ type: "click" });
  findByTestId(root, "view-links-unlink-reason").value = "reason";
  findByTestId(root, "view-links-unlink-confirm").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-links-action-error");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["error.illegal_transition"]);
  assert.equal(listCalls, 1, "list NOT refreshed on error");
});
