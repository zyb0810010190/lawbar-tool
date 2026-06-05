// Deadline WRITE tests (WI-702): the two-step Add/Confirm-deadline control + the
// pure host-zone datetime resolver (findUniqueInstant). Split out of
// renderer-view-matter.test.mjs (which is at the loc-guardian 1200-LOC test cap),
// mirroring renderer-deadline-urgency.test.mjs. Pure-Node; mock document + mock api.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { findUniqueInstant } from "../dist/renderer/screens/viewMatterDeadlines.js";
import {
  VALID_ULID,
  MockDoc,
  findAll,
  findByTestId,
  findAllByTestId,
  collectText,
  flush,
  makeStubApi,
  deadlineRow,
} from "./_view-matter-dom.mjs";

const PROPOSED_ID = "01jz000000000000000000ent0";

// makeStubApi (shared harness) predates the docket channels; wrap it here to add
// createDocketEntry / confirmDocketEntry without editing the shared harness.
function stubWithDocket(impl = {}) {
  return {
    ...makeStubApi(impl),
    createDocketEntry:
      impl.createDocketEntry ??
      (async () => ({ ok: true, value: { id: PROPOSED_ID, proposed_kind: "filing", proposed_due_at: "2026-06-15T16:00:00.000Z" } })),
    confirmDocketEntry:
      impl.confirmDocketEntry ??
      (async () => ({ ok: true, value: { entry: { id: PROPOSED_ID }, deadline: deadlineRow() } })),
  };
}

async function mountDeadlinesWithAdd(api) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  return {
    root,
    kind: findByTestId(root, "view-deadlines-add-kind"),
    due: findByTestId(root, "view-deadlines-add-due"),
    proposeBtn: findByTestId(root, "view-deadlines-add"),
    confirmBtn: findByTestId(root, "view-deadlines-confirm"),
  };
}

// --- findUniqueInstant: deterministic, synthetic zone models (no runner TZ) ---

const INPUT = { y: 2026, mo: 5, da: 15, h: 12, mi: 0 };
const OTHER = { y: 1999, mo: 0, da: 1, h: 0, mi: 0 };

test("findUniqueInstant: unique wall time returns the candidate instant", () => {
  // Only the candidate (1000) maps back to INPUT; nothing nearby does.
  const r = findUniqueInstant(INPUT, () => 1000, (ms) => (ms === 1000 ? INPUT : OTHER));
  assert.equal(r, 1000);
});

test("findUniqueInstant: spring-forward GAP (no round-trip) returns null", () => {
  // The candidate re-derives to a DIFFERENT wall time (Date normalized a nonexistent time).
  const r = findUniqueInstant(INPUT, () => 1000, () => OTHER);
  assert.equal(r, null);
});

test("findUniqueInstant: fall-back OVERLAP (1 hour) returns null", () => {
  // Both the candidate and candidate+1h map to INPUT -> ambiguous.
  const r = findUniqueInstant(
    INPUT,
    () => 1000,
    (ms) => (ms === 1000 || ms === 1000 + 3600000 ? INPUT : OTHER),
  );
  assert.equal(r, null);
});

test("findUniqueInstant: sub-hour (30-minute, Lord-Howe-style) OVERLAP returns null", () => {
  // A ±1h-only probe would MISS this; the minute-granularity scan catches it.
  const r = findUniqueInstant(
    INPUT,
    () => 1000,
    (ms) => (ms === 1000 || ms === 1000 + 1800000 ? INPUT : OTHER),
  );
  assert.equal(r, null);
});

// --- Add/Confirm deadline UI flow ---

test("deadline add: control renders with host-zone (read-only) tz; proposed area hidden", async () => {
  const { root } = await mountDeadlinesWithAdd(stubWithDocket());
  assert.ok(findByTestId(root, "view-deadlines-add-control") !== null);
  const tz = findByTestId(root, "view-deadlines-add-tz");
  assert.equal(tz.getAttribute("value"), Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(tz.hasAttribute("disabled"), true);
  assert.equal(findByTestId(root, "view-deadlines-proposed").hasAttribute("hidden"), true);
});

test("deadline propose: forwards host-local ISO + host tz; proposed row shown", async () => {
  let createDto;
  const api = stubWithDocket({
    createDocketEntry: async (dto) => {
      createDto = dto;
      return { ok: true, value: { id: PROPOSED_ID, proposed_kind: dto.proposed_kind, proposed_due_at: dto.proposed_due_at } };
    },
  });
  const { root, kind, due, proposeBtn } = await mountDeadlinesWithAdd(api);
  kind.value = "filing";
  due.value = "2026-06-15T12:00"; // noon — unique in any host zone
  proposeBtn.dispatchEvent({ type: "click" });
  await flush();
  const expectedIso = new Date(2026, 5, 15, 12, 0, 0, 0).toISOString();
  assert.deepEqual(createDto, {
    matterId: VALID_ULID,
    proposed_kind: "filing",
    proposed_due_at: expectedIso,
    proposed_due_at_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  assert.equal(findByTestId(root, "view-deadlines-proposed").hasAttribute("hidden"), false);
  assert.ok(collectText(findByTestId(root, "view-deadlines-proposed-row")).includes("Proposed (unconfirmed)"));
});

test("deadline propose: missing kind -> inline error, createDocketEntry NOT called", async () => {
  let called = false;
  const api = stubWithDocket({ createDocketEntry: async () => { called = true; return { ok: true, value: { id: PROPOSED_ID } }; } });
  const { root, due, proposeBtn } = await mountDeadlinesWithAdd(api);
  due.value = "2026-06-15T12:00";
  proposeBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  const err = findByTestId(root, "view-deadlines-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
});

test("deadline propose: unparseable due -> inline error, createDocketEntry NOT called", async () => {
  let called = false;
  const api = stubWithDocket({ createDocketEntry: async () => { called = true; return { ok: true, value: { id: PROPOSED_ID } }; } });
  const { root, kind, due, proposeBtn } = await mountDeadlinesWithAdd(api);
  kind.value = "filing";
  due.value = "not-a-datetime";
  proposeBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  assert.equal(findByTestId(root, "view-deadlines-add-error").getAttribute("role"), "alert");
});

test("deadline propose: ok response WITHOUT an entry id -> inline error, proposed area stays hidden", async () => {
  // Defensive (audit L): a successful create that lacks an id would otherwise show
  // an unconfirmable proposed row. It must surface an inline error instead.
  const api = stubWithDocket({ createDocketEntry: async () => ({ ok: true, value: { proposed_kind: "filing" } }) });
  const { root, kind, due, proposeBtn } = await mountDeadlinesWithAdd(api);
  kind.value = "filing";
  due.value = "2026-06-15T12:00";
  proposeBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findByTestId(root, "view-deadlines-add-error").getAttribute("role"), "alert");
  assert.equal(findByTestId(root, "view-deadlines-proposed").hasAttribute("hidden"), true);
});

test("deadline propose: datetime with trailing garbage -> inline error (anchored parse)", async () => {
  let called = false;
  const api = stubWithDocket({ createDocketEntry: async () => { called = true; return { ok: true, value: { id: PROPOSED_ID } }; } });
  const { root, kind, due, proposeBtn } = await mountDeadlinesWithAdd(api);
  kind.value = "filing";
  due.value = "2026-06-15T12:00xEVIL"; // trailing garbage must be rejected by the anchored parser
  proposeBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  assert.equal(findByTestId(root, "view-deadlines-add-error").getAttribute("role"), "alert");
});

test("deadline confirm: ok clears proposed, refreshes list, materialized deadline renders", async () => {
  let listCalls = 0;
  let confirmEntryId;
  const api = stubWithDocket({
    listDeadlines: async () => {
      listCalls++;
      if (listCalls <= 1) return { ok: true, value: { rows: [], next_cursor: null } };
      return { ok: true, value: { rows: [deadlineRow({ kind: "filing" })], next_cursor: null } };
    },
    confirmDocketEntry: async (dto) => {
      confirmEntryId = dto.entryId;
      return { ok: true, value: { entry: { id: dto.entryId }, deadline: deadlineRow({ kind: "filing" }) } };
    },
  });
  const { root, kind, due, proposeBtn, confirmBtn } = await mountDeadlinesWithAdd(api);
  const listAfterOpen = listCalls;
  kind.value = "filing";
  due.value = "2026-06-15T12:00";
  proposeBtn.dispatchEvent({ type: "click" });
  await flush();
  // before confirm the deadline list is unchanged
  assert.equal(listCalls, listAfterOpen, "propose does not refresh the list");
  confirmBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(confirmEntryId, PROPOSED_ID, "confirm uses the entryId from the create response");
  assert.equal(collectText(findByTestId(root, "view-deadlines-confirm-status")), "Confirmed.");
  assert.equal(findByTestId(root, "view-deadlines-proposed").hasAttribute("hidden"), true);
  assert.ok(listCalls > listAfterOpen, "confirm refreshed the deadline list");
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 1);
});

test("deadline confirm: foreign/unknown entryId -> invalid_payload, fail-closed (proposed kept, no refresh)", async () => {
  let listCalls = 0;
  const api = stubWithDocket({
    listDeadlines: async () => { listCalls++; return { ok: true, value: { rows: [], next_cursor: null } }; },
    confirmDocketEntry: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "entryId does not reference a confirmable docket entry in this matter" } }),
  });
  const { root, kind, due, proposeBtn, confirmBtn } = await mountDeadlinesWithAdd(api);
  const listAfterOpen = listCalls;
  kind.value = "filing";
  due.value = "2026-06-15T12:00";
  proposeBtn.dispatchEvent({ type: "click" });
  await flush();
  confirmBtn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-deadlines-confirm-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  // fail-closed: proposed row retained, list NOT refreshed
  assert.equal(findByTestId(root, "view-deadlines-proposed").hasAttribute("hidden"), false);
  assert.equal(listCalls, listAfterOpen, "deadline list NOT refreshed on confirm failure");
});

test("deadline: a superseded (stale) load cannot mutate the refreshed list", async () => {
  const pending = [];
  let n = 0;
  const api = stubWithDocket({
    listDeadlines: async () => {
      n++;
      if (n === 1) return new Promise((res) => pending.push(res)); // initial: hangs
      return { ok: true, value: { rows: [deadlineRow({ kind: "REFRESHED" })], next_cursor: null } };
    },
  });
  const { root, kind, due, proposeBtn, confirmBtn } = await mountDeadlinesWithAdd(api);
  // initial load (#1) is hanging. Propose + confirm triggers refresh (#2).
  kind.value = "filing";
  due.value = "2026-06-15T12:00";
  proposeBtn.dispatchEvent({ type: "click" });
  await flush();
  confirmBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 1);
  assert.ok(collectText(findByTestId(root, "view-deadlines-list")).includes("REFRESHED"));
  // resolve the stale initial load now — it must NOT inject a row.
  pending[0]({ ok: true, value: { rows: [deadlineRow({ kind: "STALE" }), deadlineRow({ id: "01jzdl00000000000000000099", kind: "STALE2" })], next_cursor: null } });
  await flush();
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 1, "stale load dropped by the generation guard");
});
