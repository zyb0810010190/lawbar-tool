// Deadline WRITE tests (WI-702): the two-step Add/Confirm-deadline control + the
// pure host-zone datetime resolver (findUniqueInstant). Split out of
// renderer-view-matter.test.mjs (which is at the loc-guardian 1200-LOC test cap),
// mirroring renderer-deadline-urgency.test.mjs. Pure-Node; mock document + mock api.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { findUniqueInstant } from "../dist/renderer/screens/viewMatterDeadlines.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
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
const PROPOSAL_ENTRY_ID = "01jz0000000000000000prop00";

// A projected pending docket-entry row (DOCKET_ENTRY_RESPONSE_FIELDS subset) as
// returned by casebox:docket:list (WI-D1) — authority identities already stripped.
function proposalRow(over = {}) {
  return {
    id: PROPOSAL_ENTRY_ID,
    proposed_kind: "filing",
    proposed_due_at: "2026-06-20T16:00:00.000Z",
    proposed_due_at_timezone: "America/New_York",
    proposed_at: "2026-06-01T00:00:00.000Z",
    source_type: "manual",
    confirmation_state: "proposed",
    ...over,
  };
}

// makeStubApi (shared harness) predates the docket channels; wrap it here to add
// createDocketEntry / confirmDocketEntry (WI-702) + listDocketEntries /
// dismissDocketEntry (WI-D1/D2/D4) without editing the shared harness. The
// pending-proposals group loads on disclosure, so listDocketEntries must exist
// even for the deadline-write tests (default = empty -> the group stays hidden).
function stubWithDocket(impl = {}) {
  return {
    ...makeStubApi(impl),
    createDocketEntry:
      impl.createDocketEntry ??
      (async () => ({ ok: true, value: { id: PROPOSED_ID, proposed_kind: "filing", proposed_due_at: "2026-06-15T16:00:00.000Z" } })),
    confirmDocketEntry:
      impl.confirmDocketEntry ??
      (async () => ({ ok: true, value: { entry: { id: PROPOSED_ID }, deadline: deadlineRow() } })),
    listDocketEntries:
      impl.listDocketEntries ??
      (async () => ({ ok: true, value: { rows: [], next_cursor: null } })),
    dismissDocketEntry:
      impl.dismissDocketEntry ??
      (async () => ({ ok: true, value: { id: PROPOSAL_ENTRY_ID, confirmation_state: "dismissed" } })),
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
  // zh-CN proposed-row prefix: everything before the "：{kind}，到期 {due}" params.
  const proposedPrefix = CATALOG["deadline.proposedRow"].split("：")[0]; // "已提议（未确认）"
  assert.ok(collectText(findByTestId(root, "view-deadlines-proposed-row")).includes(proposedPrefix));
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
  assert.equal(collectText(findByTestId(root, "view-deadlines-confirm-status")), CATALOG["deadline.status.confirmed"]);
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

// --- WI-D4: pending docket proposals (durable read) + dismiss --------------

test("docket proposals: a durable proposed entry renders after disclosure (reload visibility)", async () => {
  const api = stubWithDocket({
    listDocketEntries: async () => ({ ok: true, value: { rows: [proposalRow()], next_cursor: null } }),
  });
  const { root } = await mountDeadlinesWithAdd(api);
  assert.equal(findByTestId(root, "view-docket-proposals").hasAttribute("hidden"), false);
  assert.equal(findAllByTestId(root, "view-docket-proposal-row").length, 1);
  assert.ok(
    collectText(findByTestId(root, "view-docket-proposals-heading")).includes(
      CATALOG["docket.heading"].replace("{total}", "1"), // "待处理立案提议（1）"
    ),
  );
});

test("docket proposals: empty -> group hidden, no rows", async () => {
  const api = stubWithDocket({
    listDocketEntries: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
  });
  const { root } = await mountDeadlinesWithAdd(api);
  assert.equal(findByTestId(root, "view-docket-proposals").hasAttribute("hidden"), true);
  assert.equal(findAllByTestId(root, "view-docket-proposal-row").length, 0);
});

test("docket proposals: list is filtered to confirmation_state=proposed for this matter", async () => {
  let dto;
  const api = stubWithDocket({
    listDocketEntries: async (d) => { dto = d; return { ok: true, value: { rows: [], next_cursor: null } }; },
  });
  await mountDeadlinesWithAdd(api);
  assert.equal(dto.matterId, VALID_ULID);
  assert.equal(dto.confirmation_state, "proposed");
});

test("docket proposals: list error renders inline role=alert", async () => {
  const api = stubWithDocket({
    listDocketEntries: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "unknown_matter", message: "no such matter" } }),
  });
  const { root } = await mountDeadlinesWithAdd(api);
  const err = findByTestId(root, "view-docket-proposals-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
});

test("docket dismiss: empty reason -> inline error, dismissDocketEntry NOT called", async () => {
  let called = false;
  const api = stubWithDocket({
    listDocketEntries: async () => ({ ok: true, value: { rows: [proposalRow()], next_cursor: null } }),
    dismissDocketEntry: async () => { called = true; return { ok: true, value: {} }; },
  });
  const { root } = await mountDeadlinesWithAdd(api);
  findByTestId(root, "view-docket-dismiss").dispatchEvent({ type: "click" }); // reveal reason input
  findByTestId(root, "view-docket-dismiss-confirm").dispatchEvent({ type: "click" }); // confirm with empty reason
  await flush();
  assert.equal(called, false);
  assert.equal(findByTestId(root, "view-docket-dismiss-error").getAttribute("role"), "alert");
});

test("docket dismiss: forwards exactly {matterId, entryId, dismissal_reason}; row refreshes away on success", async () => {
  let dismissDto;
  let listCalls = 0;
  const api = stubWithDocket({
    listDocketEntries: async () => {
      listCalls += 1;
      return { ok: true, value: { rows: listCalls <= 1 ? [proposalRow()] : [], next_cursor: null } };
    },
    dismissDocketEntry: async (d) => { dismissDto = d; return { ok: true, value: { id: d.entryId, confirmation_state: "dismissed" } }; },
  });
  const { root } = await mountDeadlinesWithAdd(api);
  assert.equal(findAllByTestId(root, "view-docket-proposal-row").length, 1);
  findByTestId(root, "view-docket-dismiss").dispatchEvent({ type: "click" });
  findByTestId(root, "view-docket-dismiss-reason").value = "duplicate of an existing deadline";
  findByTestId(root, "view-docket-dismiss-confirm").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(dismissDto, {
    matterId: VALID_ULID,
    entryId: PROPOSAL_ENTRY_ID,
    dismissal_reason: "duplicate of an existing deadline",
  });
  // success refresh -> the entry left "proposed" -> second list returns empty -> row gone + group hidden
  assert.equal(findAllByTestId(root, "view-docket-proposal-row").length, 0);
  assert.equal(findByTestId(root, "view-docket-proposals").hasAttribute("hidden"), true);
});

test("docket dismiss: server error renders inline role=alert (row kept)", async () => {
  const api = stubWithDocket({
    listDocketEntries: async () => ({ ok: true, value: { rows: [proposalRow()], next_cursor: null } }),
    dismissDocketEntry: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "only a proposed docket entry can be dismissed" } }),
  });
  const { root } = await mountDeadlinesWithAdd(api);
  findByTestId(root, "view-docket-dismiss").dispatchEvent({ type: "click" });
  findByTestId(root, "view-docket-dismiss-reason").value = "x";
  findByTestId(root, "view-docket-dismiss-confirm").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findByTestId(root, "view-docket-dismiss-error").getAttribute("role"), "alert");
});

test("docket dismiss: cancel collapses the reason input without calling dismissDocketEntry", async () => {
  let called = false;
  const api = stubWithDocket({
    listDocketEntries: async () => ({ ok: true, value: { rows: [proposalRow()], next_cursor: null } }),
    dismissDocketEntry: async () => { called = true; return { ok: true, value: {} }; },
  });
  const { root } = await mountDeadlinesWithAdd(api);
  findByTestId(root, "view-docket-dismiss").dispatchEvent({ type: "click" });
  assert.equal(findByTestId(root, "view-docket-dismiss-reason").hasAttribute("hidden"), false);
  findByTestId(root, "view-docket-dismiss-cancel").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  assert.equal(findByTestId(root, "view-docket-dismiss-reason").hasAttribute("hidden"), true);
});

test("docket proposals: Show more appends the next page (proposals beyond page one reachable)", async () => {
  const api = stubWithDocket({
    listDocketEntries: async (d) => {
      if (d.cursor === undefined) {
        return { ok: true, value: { rows: [proposalRow({ id: "01jz0000000000000000prop01" })], next_cursor: "CURSOR1" } };
      }
      return { ok: true, value: { rows: [proposalRow({ id: "01jz0000000000000000prop02" })], next_cursor: null } };
    },
  });
  const { root } = await mountDeadlinesWithAdd(api);
  assert.equal(findAllByTestId(root, "view-docket-proposal-row").length, 1);
  const more = findByTestId(root, "view-docket-proposals-more");
  assert.ok(more !== null, "Show more rendered when next_cursor is non-null");
  more.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-docket-proposal-row").length, 2, "second page appended");
  assert.equal(findByTestId(root, "view-docket-proposals-more"), null, "Show more gone after the last page");
});

test("docket proposals: rapid double-click on Show more does not append the page twice", async () => {
  const resolvers = [];
  const api = stubWithDocket({
    listDocketEntries: async (d) => {
      if (d.cursor === undefined) {
        return { ok: true, value: { rows: [proposalRow({ id: "01jz0000000000000000prop01" })], next_cursor: "C1" } };
      }
      // page 2 hangs so a second click can fire before it resolves.
      return new Promise((res) => { resolvers.push(res); });
    },
  });
  const { root } = await mountDeadlinesWithAdd(api);
  const more = findByTestId(root, "view-docket-proposals-more");
  more.dispatchEvent({ type: "click" }); // starts page-2 fetch (hangs)
  more.dispatchEvent({ type: "click" }); // concurrent click — must be dropped by the in-flight guard
  await flush();
  assert.equal(resolvers.length, 1, "only one page-2 request issued (concurrent click dropped)");
  resolvers[0]({ ok: true, value: { rows: [proposalRow({ id: "01jz0000000000000000prop02" })], next_cursor: null } });
  await flush();
  assert.equal(findAllByTestId(root, "view-docket-proposal-row").length, 2, "page 2 appended exactly once (no duplicate rows)");
});
