// classifyDeadlineUrgency + deadlineUrgencyLabel unit tests (brief §18 overdue /
// due-within-7-days surfacing). Pure-Node; clock injected, so deterministic.
//
// Rules:
//   - only `pending` deadlines are ever urgent; met/missed/withdrawn → "none".
//   - due_at strictly before now            → "overdue".
//   - due_at in [now, now + 7 days]         → "due-soon" (boundaries inclusive).
//   - due_at after now + 7 days             → "none".
//   - unparseable due_at                    → "none".

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDeadlineUrgency,
  deadlineUrgencyLabel,
  DEADLINE_DUE_SOON_WINDOW_MS,
} from "../dist/renderer/format.js";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { renderDeadlinesDisclosure } from "../dist/renderer/screens/viewMatterDeadlines.js";
import {
  MockDoc,
  makeStubApi,
  deadlineRow,
  findByTestId,
  findAllByTestId,
  collectText,
  flush,
  VALID_ULID,
} from "./_view-matter-dom.mjs";

const NOW = Date.parse("2026-06-03T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

// --- classification ---

test("pending deadline due in the past → overdue", () => {
  assert.equal(classifyDeadlineUrgency(iso(NOW - 3600_000), "pending", NOW), "overdue");
});

test("pending deadline due within 7 days → due-soon", () => {
  assert.equal(classifyDeadlineUrgency(iso(NOW + 3 * 86_400_000), "pending", NOW), "due-soon");
});

test("pending deadline due exactly now → due-soon (not overdue)", () => {
  assert.equal(classifyDeadlineUrgency(iso(NOW), "pending", NOW), "due-soon");
});

test("pending deadline due at exactly now + 7 days → due-soon (boundary inclusive)", () => {
  assert.equal(
    classifyDeadlineUrgency(iso(NOW + DEADLINE_DUE_SOON_WINDOW_MS), "pending", NOW),
    "due-soon",
  );
});

test("pending deadline due just past the 7-day window → none", () => {
  assert.equal(
    classifyDeadlineUrgency(iso(NOW + DEADLINE_DUE_SOON_WINDOW_MS + 60_000), "pending", NOW),
    "none",
  );
});

test("pending deadline far in the future → none", () => {
  assert.equal(classifyDeadlineUrgency(iso(NOW + 30 * 86_400_000), "pending", NOW), "none");
});

for (const settled of ["met", "missed", "withdrawn"]) {
  test(`${settled} deadline with a past due_at is never urgent → none`, () => {
    assert.equal(classifyDeadlineUrgency(iso(NOW - 86_400_000), settled, NOW), "none");
  });
}

test("unparseable due_at → none (no throw)", () => {
  assert.equal(classifyDeadlineUrgency("not-a-date", "pending", NOW), "none");
});

// --- labels ---

test("deadlineUrgencyLabel maps each urgency", () => {
  assert.equal(deadlineUrgencyLabel("overdue"), "Overdue");
  assert.equal(deadlineUrgencyLabel("due-soon"), "Due soon");
  assert.equal(deadlineUrgencyLabel("none"), "");
});

// --- DOM: eager-load so the urgency banner is complete (moved from renderer-view-matter) ---

test("deadlines: all pages are eager-loaded (no Show more) so the urgency banner is complete", async () => {
  // The view exhausts the seek cursor up front: settled and pending deadlines
  // share the due_at ASC order, so a partial load could hide a later pending
  // overdue deadline and undercount the banner. Both pages must auto-load.
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let call = 0;
  const api = makeStubApi({
    listDeadlines: async (dto) => {
      call++;
      if (call === 1) return { ok: true, value: { rows: [deadlineRow()], next_cursor: "cur-2" } };
      assert.equal(dto.cursor, "cur-2");
      return { ok: true, value: { rows: [deadlineRow({ id: "01jzdl00000000000000000002" })], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  // Both pages loaded without any "Show more" click.
  assert.equal(call, 2);
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 2);
  assert.equal(findByTestId(root, "view-deadlines-more"), null);
});

test("deadlines: a pending overdue deadline behind a page of settled ones is still counted", async () => {
  // Regression for the cc-suite High: page 1 is all settled (old met) rows; the
  // pending overdue deadline only appears on page 2. Eager-loading must surface
  // it in the banner.
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDeadlines: async (dto) => {
      if (dto.cursor === undefined) {
        return {
          ok: true,
          value: {
            rows: [
              deadlineRow({ id: "01jzdl00000000000000000010", status: "met", due_at: "2025-01-01T00:00:00.000Z" }),
              deadlineRow({ id: "01jzdl00000000000000000011", status: "met", due_at: "2025-02-01T00:00:00.000Z" }),
            ],
            next_cursor: "cur-2",
          },
        };
      }
      return {
        ok: true,
        value: {
          rows: [
            deadlineRow({ id: "01jzdl00000000000000000012", status: "pending", due_at: "2026-06-01T00:00:00.000Z" }),
          ],
          next_cursor: null,
        },
      };
    },
  });
  root.appendChild(renderDeadlinesDisclosure(doc, api, VALID_ULID, URGENCY_NOW));
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 3);
  const banner = findByTestId(root, "view-deadlines-banner");
  assert.equal(banner.hasAttribute("hidden"), false);
  assert.equal(collectText(banner), "1 overdue");
});

// --- DOM: deadline urgency surfacing (brief §18 overdue / due-within-7-days) ---
// renderDeadlinesDisclosure takes an injected `nowMs` so these assertions are
// deterministic regardless of when the suite runs.

const URGENCY_NOW = Date.parse("2026-06-03T12:00:00.000Z");

async function mountDeadlinesUrgency(rows, now = URGENCY_NOW) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDeadlines: async () => ({ ok: true, value: { rows, next_cursor: null } }),
  });
  root.appendChild(renderDeadlinesDisclosure(doc, api, VALID_ULID, now));
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

test("deadline urgency: overdue + due-soon rows get pills; a settled row does not", async () => {
  const root = await mountDeadlinesUrgency([
    deadlineRow({ id: "01jzdl00000000000000000001", status: "pending", due_at: "2026-06-01T00:00:00.000Z" }),
    deadlineRow({ id: "01jzdl00000000000000000002", status: "pending", due_at: "2026-06-05T00:00:00.000Z" }),
    deadlineRow({ id: "01jzdl00000000000000000003", status: "met", due_at: "2026-05-01T00:00:00.000Z" }),
  ]);
  const pills = findAllByTestId(root, "view-deadlines-urgency");
  assert.equal(pills.length, 2);
  assert.deepEqual(
    pills.map((p) => p.getAttribute("data-urgency")),
    ["overdue", "due-soon"],
  );
  assert.deepEqual(pills.map(collectText), ["Overdue", "Due soon"]);
});

test("deadline urgency: banner summarises overdue + due-soon counts with overdue styling", async () => {
  const root = await mountDeadlinesUrgency([
    deadlineRow({ id: "01jzdl00000000000000000001", status: "pending", due_at: "2026-06-01T00:00:00.000Z" }),
    deadlineRow({ id: "01jzdl00000000000000000002", status: "pending", due_at: "2026-06-05T00:00:00.000Z" }),
  ]);
  const banner = findByTestId(root, "view-deadlines-banner");
  assert.ok(banner !== null);
  assert.equal(banner.hasAttribute("hidden"), false);
  assert.equal(collectText(banner), "1 overdue · 1 due within 7 days");
  assert.ok(banner.getAttribute("class").includes("view-deadlines-banner--overdue"));
  assert.equal(banner.getAttribute("role"), "status");
  assert.equal(banner.getAttribute("aria-live"), "polite");
});

test("deadline urgency: due-soon only → warning banner without the overdue modifier", async () => {
  const root = await mountDeadlinesUrgency([
    deadlineRow({ id: "01jzdl00000000000000000002", status: "pending", due_at: "2026-06-05T00:00:00.000Z" }),
  ]);
  const banner = findByTestId(root, "view-deadlines-banner");
  assert.equal(banner.hasAttribute("hidden"), false);
  assert.equal(collectText(banner), "1 due within 7 days");
  assert.equal(banner.getAttribute("class").includes("view-deadlines-banner--overdue"), false);
});

test("deadline urgency: no urgent deadlines → banner stays hidden, no pills", async () => {
  const root = await mountDeadlinesUrgency([
    deadlineRow({ id: "01jzdl00000000000000000004", status: "pending", due_at: "2026-09-01T00:00:00.000Z" }),
    deadlineRow({ id: "01jzdl00000000000000000003", status: "met", due_at: "2026-05-01T00:00:00.000Z" }),
  ]);
  const banner = findByTestId(root, "view-deadlines-banner");
  assert.equal(banner.hasAttribute("hidden"), true);
  assert.equal(findAllByTestId(root, "view-deadlines-urgency").length, 0);
});

test("deadlines: a repeated (non-advancing) cursor aborts the eager-load with an inline alert", async () => {
  // Audit High fix: if listDeadlines keeps returning the SAME non-null next_cursor, the eager
  // loop must NOT spin forever — it aborts on the repeat and renders an inline alert.
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let call = 0;
  const api = makeStubApi({
    listDeadlines: async () => {
      call++;
      return {
        ok: true,
        value: {
          rows: [deadlineRow({ id: `01jzdl0000000000000000000${call}` })],
          next_cursor: "cur-stuck", // never advances
        },
      };
    },
  });
  root.appendChild(renderDeadlinesDisclosure(doc, api, VALID_ULID, URGENCY_NOW));
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-deadlines-error");
  assert.ok(err !== null, "expected an inline alert when the cursor does not advance");
  assert.equal(err.getAttribute("role"), "alert");
  assert.ok(call <= 3, `eager-load should abort quickly on a stuck cursor, got ${call} calls`);
});

// --- DOM: deadline status transitions (WI-DT3, per the WI-DT2 design artifact) ---
// pending -> met/missed/withdrawn (single-click); missed -> met (two-step required
// reason). Errors keep the row + inline alert + no refresh; success refreshes.

const TX_FUTURE = "2026-12-31T00:00:00.000Z"; // far future → no urgency pill noise
const TX_DL = "01jzdl00000000000000000abc";

async function mountTransition(rows, apiOverrides = {}) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDeadlines: async () => ({ ok: true, value: { rows, next_cursor: null } }),
    ...apiOverrides,
  });
  root.appendChild(renderDeadlinesDisclosure(doc, api, VALID_ULID, URGENCY_NOW));
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

test("transition: pending row offers met / missed / withdrawn", async () => {
  const root = await mountTransition([deadlineRow({ id: TX_DL, status: "pending", due_at: TX_FUTURE })]);
  assert.ok(findByTestId(root, "view-deadlines-transition-met") !== null);
  assert.ok(findByTestId(root, "view-deadlines-transition-missed") !== null);
  assert.ok(findByTestId(root, "view-deadlines-transition-withdrawn") !== null);
});

test("transition: missed row offers only Mark met, reason hidden until clicked", async () => {
  const root = await mountTransition([deadlineRow({ id: TX_DL, status: "missed", due_at: TX_FUTURE })]);
  assert.ok(findByTestId(root, "view-deadlines-transition-met") !== null);
  assert.equal(findByTestId(root, "view-deadlines-transition-missed"), null);
  assert.equal(findByTestId(root, "view-deadlines-transition-withdrawn"), null);
  assert.equal(findByTestId(root, "view-deadlines-transition-reason").hasAttribute("hidden"), true);
});

test("transition: met / withdrawn rows have no transition controls", async () => {
  const metRoot = await mountTransition([deadlineRow({ id: TX_DL, status: "met", due_at: TX_FUTURE })]);
  assert.equal(findByTestId(metRoot, "view-deadlines-transition"), null);
  const wdRoot = await mountTransition([deadlineRow({ id: TX_DL, status: "withdrawn", due_at: TX_FUTURE })]);
  assert.equal(findByTestId(wdRoot, "view-deadlines-transition"), null);
});

test("transition: pending → met single-click forwards {to:met} (no reason) and refreshes", async () => {
  let captured = null;
  let listCalls = 0;
  const row = deadlineRow({ id: TX_DL, status: "pending", due_at: TX_FUTURE });
  const root = await mountTransition([row], {
    listDeadlines: async () => {
      listCalls += 1;
      return { ok: true, value: { rows: [row], next_cursor: null } };
    },
    transitionDeadline: async (dto) => {
      captured = dto;
      return { ok: true, value: { id: TX_DL, status: "met" } };
    },
  });
  assert.equal(listCalls, 1);
  findByTestId(root, "view-deadlines-transition-met").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(captured, { matterId: VALID_ULID, deadlineId: TX_DL, to: "met" });
  assert.equal("transition_reason" in captured, false);
  assert.equal(listCalls, 2); // success refreshed the list
});

test("transition: error keeps the row + inline alert, does NOT refresh", async () => {
  let listCalls = 0;
  const row = deadlineRow({ id: TX_DL, status: "pending", due_at: TX_FUTURE });
  const root = await mountTransition([row], {
    listDeadlines: async () => {
      listCalls += 1;
      return { ok: true, value: { rows: [row], next_cursor: null } };
    },
    transitionDeadline: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "illegal_transition", message: "nope" },
    }),
  });
  const missedBtn = findByTestId(root, "view-deadlines-transition-missed");
  missedBtn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-deadlines-transition-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "nope");
  assert.ok(findByTestId(root, "view-deadlines-row") !== null); // row kept
  assert.equal(listCalls, 1); // NOT refreshed (no wipe)
  assert.equal(missedBtn.hasAttribute("disabled"), false); // re-enabled for retry
});

test("transition: missed → met Cancel discards the typed reason (no stale reason on reopen)", async () => {
  let captured = null;
  const root = await mountTransition([deadlineRow({ id: TX_DL, status: "missed", due_at: TX_FUTURE })], {
    transitionDeadline: async (dto) => {
      captured = dto;
      return { ok: true, value: { id: TX_DL, status: "met" } };
    },
  });
  findByTestId(root, "view-deadlines-transition-met").dispatchEvent({ type: "click" });
  await flush();
  const reason = findByTestId(root, "view-deadlines-transition-reason");
  reason.value = "stale reason"; // typed then abandoned
  findByTestId(root, "view-deadlines-transition-cancel").dispatchEvent({ type: "click" });
  await flush();
  // Reopen the capture — the previously typed reason must be gone.
  findByTestId(root, "view-deadlines-transition-met").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findByTestId(root, "view-deadlines-transition-reason").value ?? "", "");
  assert.equal(captured, null); // nothing submitted
});

test("transition: missed → met refuses empty reason, then forwards transition_reason", async () => {
  let captured = null;
  let calls = 0;
  const root = await mountTransition([deadlineRow({ id: TX_DL, status: "missed", due_at: TX_FUTURE })], {
    transitionDeadline: async (dto) => {
      captured = dto;
      calls += 1;
      return { ok: true, value: { id: TX_DL, status: "met" } };
    },
  });
  // Open the two-step capture.
  findByTestId(root, "view-deadlines-transition-met").dispatchEvent({ type: "click" });
  await flush();
  const reason = findByTestId(root, "view-deadlines-transition-reason");
  assert.equal(reason.hasAttribute("hidden"), false);
  // Confirm with an empty reason → refused, no API call.
  findByTestId(root, "view-deadlines-transition-confirm").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(calls, 0);
  assert.equal(findByTestId(root, "view-deadlines-transition-error").getAttribute("role"), "alert");
  // Provide a reason → forwarded.
  reason.value = "clerk error; filed on time";
  findByTestId(root, "view-deadlines-transition-confirm").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(captured, {
    matterId: VALID_ULID,
    deadlineId: TX_DL,
    to: "met",
    transition_reason: "clerk error; filed on time",
  });
  assert.equal(calls, 1);
});

test("transition: missed → met Cancel collapses back to Mark met", async () => {
  const root = await mountTransition([deadlineRow({ id: TX_DL, status: "missed", due_at: TX_FUTURE })]);
  findByTestId(root, "view-deadlines-transition-met").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findByTestId(root, "view-deadlines-transition-reason").hasAttribute("hidden"), false);
  findByTestId(root, "view-deadlines-transition-cancel").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findByTestId(root, "view-deadlines-transition-reason").hasAttribute("hidden"), true);
  assert.equal(findByTestId(root, "view-deadlines-transition-met").hasAttribute("hidden"), false);
});
