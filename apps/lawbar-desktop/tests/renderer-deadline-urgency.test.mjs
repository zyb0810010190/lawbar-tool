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
