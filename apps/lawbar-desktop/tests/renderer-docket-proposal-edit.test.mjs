// WI-DPE5 — renderer docket proposal EDIT affordance + renderer bridge tests.
// Pure-Node (MockDoc + a local stub api; the shared harness _view-matter-dom.mjs is
// import-only here — not edited). Covers: the per-row two-step Edit reveal mirroring
// dismiss; prefill; Save sends exactly {matterId, entryId, six content fields} with
// reminder_offsets passed through UNCHANGED (null + array) and NO authority/revised_at;
// success refresh-in-place keeps proposed; error keeps the form + inline alert; Cancel
// makes no api call; the "(edited)" badge on revised_at; keyboard/focus behavior;
// confirm/dismiss remain distinct. The api-bridge strip is also asserted here against
// the built dist api (RENDERER_EDIT_DOCKET_DTO_FIELDS).

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDocketProposalsSection } from "../dist/renderer/screens/viewMatterDocketProposals.js";
import { createCaseBoxApi } from "../dist/renderer/api.js";
import { RENDERER_EDIT_DOCKET_DTO_FIELDS } from "../dist/renderer/types.js";
import { MockDoc, findByTestId, findAllByTestId, flush } from "./_view-matter-dom.mjs";

const MATTER = "01jzmatter0000000000000000";
const ENTRY = "01jzdock0000000000000000ab";

function proposalRow(over = {}) {
  return {
    id: ENTRY,
    matter_id: MATTER,
    source_type: "manual",
    proposed_kind: "filing",
    proposed_due_at: "2026-06-20T16:00:00.000Z",
    proposed_due_at_kind: "datetime",
    proposed_due_at_timezone: "America/New_York",
    proposed_owner_user_id: "local-user",
    reminder_offsets: [{ offset_days: 7, kind: "advance_notice" }],
    confirmation_state: "proposed",
    proposed_at: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

// Local api stub — only the methods the proposals section calls. Records edit DTOs and
// listDocketEntries call count so refresh-vs-no-refresh is observable.
function makeApi({ rows = [proposalRow()], editImpl } = {}) {
  const editCalls = [];
  let listCount = 0;
  let dismissCount = 0;
  const api = {
    listDocketEntries: async () => {
      listCount += 1;
      return { ok: true, value: { rows, next_cursor: null } };
    },
    editDocketEntry:
      editImpl ??
      (async (dto) => {
        editCalls.push(dto);
        return { ok: true, value: { ...proposalRow(), proposed_kind: dto.proposed_kind, revised_at: "2026-06-02T00:00:00.000Z" } };
      }),
    // dismiss present but must NOT be called by the edit path — counted to prove isolation.
    dismissDocketEntry: async () => {
      dismissCount += 1;
      return { ok: true, value: { id: ENTRY, confirmation_state: "dismissed" } };
    },
  };
  return { api, editCalls, listCount: () => listCount, dismissCount: () => dismissCount };
}

// A manually-resolved deferred, for testing in-flight-save behavior.
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function mountWithRow(over = {}, apiOpts = {}) {
  const doc = new MockDoc();
  const rows = [proposalRow(over)];
  const ctx = makeApi({ rows, ...apiOpts });
  const section = renderDocketProposalsSection(doc, ctx.api, MATTER);
  await section.load();
  await flush();
  return { doc, section, ...ctx };
}

// --- renderer bridge (api.ts) ---

test("bridge: editDocketEntry forwards ONLY the 8 allowlisted fields; strips authority/provenance/revised_at", async () => {
  const calls = [];
  const client = {
    editDocketEntry: async (dto) => {
      calls.push(dto);
      return { ok: true, value: {} };
    },
  };
  const api = createCaseBoxApi(client);
  await api.editDocketEntry({
    matterId: MATTER,
    entryId: ENTRY,
    proposed_kind: "hearing",
    proposed_due_at: "2026-06-20T16:00:00.000Z",
    proposed_due_at_kind: "datetime",
    proposed_due_at_timezone: "America/New_York",
    proposed_owner_user_id: "local-user",
    reminder_offsets: null,
    // smuggled — must be stripped:
    tenant_id: "evil",
    matter_id: "evil",
    entry_id: "evil",
    editor_actor_user_id: "evil",
    revised_at: "2099-01-01T00:00:00.000Z",
    confirmation_state: "confirmed",
    id: "evil",
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), [...RENDERER_EDIT_DOCKET_DTO_FIELDS].sort());
  for (const f of ["tenant_id", "matter_id", "entry_id", "editor_actor_user_id", "revised_at", "confirmation_state", "id"]) {
    assert.equal(f in calls[0], false, `${f} must be stripped`);
  }
});

test("bridge: RENDERER_EDIT_DOCKET_DTO_FIELDS is exactly the 8 edit DTO fields", () => {
  assert.deepEqual(
    [...RENDERER_EDIT_DOCKET_DTO_FIELDS].sort(),
    [
      "entryId",
      "matterId",
      "proposed_due_at",
      "proposed_due_at_kind",
      "proposed_due_at_timezone",
      "proposed_kind",
      "proposed_owner_user_id",
      "reminder_offsets",
    ],
  );
});

// --- UI: edit affordance ---

test("UI: a proposed row shows an Edit affordance distinct from Dismiss", async () => {
  const { section } = await mountWithRow();
  assert.ok(findByTestId(section.element, "view-docket-edit"), "Edit button present");
  assert.ok(findByTestId(section.element, "view-docket-dismiss"), "Dismiss button still present");
});

test("UI: Edit opens a form prefilled with the five editable values; Dismiss hidden while editing", async () => {
  const { section } = await mountWithRow();
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  assert.equal(findByTestId(section.element, "view-docket-edit-kind").value, "filing");
  assert.equal(findByTestId(section.element, "view-docket-edit-due").value, "2026-06-20T16:00:00.000Z");
  assert.equal(findByTestId(section.element, "view-docket-edit-due-kind").value, "datetime");
  assert.equal(findByTestId(section.element, "view-docket-edit-tz").value, "America/New_York");
  assert.equal(findByTestId(section.element, "view-docket-edit-owner").value, "local-user");
  // Dismiss trigger hidden while editing (mutual exclusivity).
  assert.equal(findByTestId(section.element, "view-docket-dismiss").hasAttribute("hidden"), true);
});

test("UI: Save sends exactly {matterId, entryId, six content fields}; reminder_offsets array unchanged; no authority/revised_at", async () => {
  const { section, editCalls } = await mountWithRow();
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  findByTestId(section.element, "view-docket-edit-kind").value = "hearing";
  findByTestId(section.element, "view-docket-edit-save").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(editCalls.length, 1);
  const dto = editCalls[0];
  assert.deepEqual(Object.keys(dto).sort(), [
    "entryId",
    "matterId",
    "proposed_due_at",
    "proposed_due_at_kind",
    "proposed_due_at_timezone",
    "proposed_kind",
    "proposed_owner_user_id",
    "reminder_offsets",
  ]);
  assert.equal(dto.matterId, MATTER);
  assert.equal(dto.entryId, ENTRY);
  assert.equal(dto.proposed_kind, "hearing");
  assert.deepEqual(dto.reminder_offsets, [{ offset_days: 7, kind: "advance_notice" }]);
  assert.equal("revised_at" in dto, false);
  assert.equal("tenant_id" in dto, false);
  assert.equal("editor_actor_user_id" in dto, false);
});

test("UI: Save sends reminder_offsets UNCHANGED when the existing value is null", async () => {
  const { section, editCalls } = await mountWithRow({ reminder_offsets: null });
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  findByTestId(section.element, "view-docket-edit-save").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(editCalls.length, 1);
  assert.equal(editCalls[0].reminder_offsets, null);
});

test("UI: Save reminder_offsets is passed as DATA, not a UI-serialized string", async () => {
  const { section, editCalls } = await mountWithRow();
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  findByTestId(section.element, "view-docket-edit-save").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(Array.isArray(editCalls[0].reminder_offsets), true);
  assert.equal(typeof editCalls[0].reminder_offsets, "object");
});

test("UI: a successful Save refreshes the list (keeps the entry proposed) — list re-fetched", async () => {
  const { section, listCount } = await mountWithRow();
  const before = listCount();
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  findByTestId(section.element, "view-docket-edit-save").dispatchEvent({ type: "click" });
  await flush();
  assert.ok(listCount() > before, "success triggers a refresh (re-fetch)");
});

test("UI: Cancel exits edit mode and makes NO api call", async () => {
  const { section, editCalls, listCount } = await mountWithRow();
  const before = listCount();
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  findByTestId(section.element, "view-docket-edit-cancel").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(editCalls.length, 0, "Cancel must not call editDocketEntry");
  assert.equal(listCount(), before, "Cancel must not refresh");
  // Edit button restored; form hidden (mirrors dismiss reveal/collapse — elements persist).
  assert.ok(findByTestId(section.element, "view-docket-edit"), "Edit button restored");
  assert.equal(findByTestId(section.element, "view-docket-edit").hasAttribute("hidden"), false, "Edit visible again");
  assert.equal(findByTestId(section.element, "view-docket-edit-form").hasAttribute("hidden"), true, "form collapsed");
});

test("UI: an IPC error keeps the form open, shows a normalized inline alert, re-enables Save, does NOT refresh", async () => {
  const editImpl = async () => ({ ok: false, error: { code: "tenant_mismatch", message: "tenant mismatch" } });
  const { section, listCount } = await mountWithRow({}, { editImpl });
  const before = listCount();
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  findByTestId(section.element, "view-docket-edit-save").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(section.element, "view-docket-edit-error");
  assert.ok(err, "inline error shown");
  assert.equal(err.getAttribute("role"), "alert");
  assert.ok(err.textContent.includes("tenant mismatch"));
  assert.ok(!err.textContent.includes(ENTRY), "no id disclosure");
  assert.equal(findByTestId(section.element, "view-docket-edit-form").hasAttribute("hidden"), false, "form stays open");
  assert.equal(findByTestId(section.element, "view-docket-edit-save").hasAttribute("disabled"), false, "Save re-enabled");
  assert.equal(listCount(), before, "no refresh on error");
});

test("UI: client validation blocks an empty proposed_kind with NO api call", async () => {
  const { section, editCalls } = await mountWithRow();
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  findByTestId(section.element, "view-docket-edit-kind").value = "";
  findByTestId(section.element, "view-docket-edit-save").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(editCalls.length, 0, "empty kind must not call the api");
  assert.ok(findByTestId(section.element, "view-docket-edit-error"), "validation error shown");
});

// --- edited-state badge ---

test('badge: "(edited)" renders when revised_at is present', async () => {
  const { section } = await mountWithRow({ revised_at: "2026-06-02T00:00:00.000Z" });
  assert.ok(findByTestId(section.element, "view-docket-proposal-edited"), "edited badge present");
});

test('badge: "(edited)" is ABSENT when revised_at is missing', async () => {
  const { section } = await mountWithRow();
  assert.equal(findByTestId(section.element, "view-docket-proposal-edited"), null, "no badge when never edited");
});

test("badge: revised_at is display-only — no editable control bound to it", async () => {
  const { section } = await mountWithRow({ revised_at: "2026-06-02T00:00:00.000Z" });
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  // there is no revised_at input in the form
  assert.equal(findAllByTestId(section.element, "view-docket-edit-revised").length, 0);
});

// --- a11y / keyboard / focus ---

test("a11y: Edit/Save/Cancel are real buttons; focus moves to the first field on reveal and back to Edit on cancel", async () => {
  const { doc, section } = await mountWithRow();
  const editBtn = findByTestId(section.element, "view-docket-edit");
  assert.equal(editBtn.tagName, "BUTTON");
  editBtn.dispatchEvent({ type: "click" });
  assert.equal(findByTestId(section.element, "view-docket-edit-save").tagName, "BUTTON");
  assert.equal(findByTestId(section.element, "view-docket-edit-cancel").tagName, "BUTTON");
  // focus moved to first field on reveal
  assert.equal(doc._focused, findByTestId(section.element, "view-docket-edit-kind"));
  findByTestId(section.element, "view-docket-edit-cancel").dispatchEvent({ type: "click" });
  // focus returns to the Edit button
  assert.equal(doc._focused, findByTestId(section.element, "view-docket-edit"));
});

test("a11y: Escape cancels the edit", async () => {
  const { section, editCalls } = await mountWithRow();
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  const form = findByTestId(section.element, "view-docket-edit-form");
  form.dispatchEvent({ type: "keydown", key: "Escape" });
  await flush();
  assert.equal(form.hasAttribute("hidden"), true, "Escape collapses the form");
  assert.equal(editCalls.length, 0);
});

test("isolation: opening Edit then Saving never calls dismiss (Edit/Dismiss stay distinct)", async () => {
  const { section, dismissCount } = await mountWithRow();
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  assert.equal(dismissCount(), 0, "Edit reveal must not dismiss");
  findByTestId(section.element, "view-docket-edit-save").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(dismissCount(), 0, "Saving an edit must not dismiss");
});

test("re-entrancy: Escape during an in-flight Save is a no-op (form stays open; no double edit)", async () => {
  const d = deferred();
  const editCalls = [];
  const editImpl = async (dto) => {
    editCalls.push(dto);
    await d.promise;
    return { ok: true, value: { ...proposalRow(), proposed_kind: dto.proposed_kind } };
  };
  const { section } = await mountWithRow({}, { editImpl });
  findByTestId(section.element, "view-docket-edit").dispatchEvent({ type: "click" });
  const form = findByTestId(section.element, "view-docket-edit-form");
  findByTestId(section.element, "view-docket-edit-save").dispatchEvent({ type: "click" }); // saving in flight
  await flush();
  // Escape must NOT collapse while saving (would break the error invariant + re-enable controls).
  form.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(form.hasAttribute("hidden"), false, "form must stay open during save");
  // A second Save while in flight must not fire a second edit.
  findByTestId(section.element, "view-docket-edit-save").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(editCalls.length, 1, "only one edit in flight");
  d.resolve();
  await flush();
});
