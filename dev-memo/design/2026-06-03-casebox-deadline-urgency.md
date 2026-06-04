# Design artifact — Deadline urgency surfacing (overdue / due-within-7-days)

**Date**: 2026-06-03.
**WI**: `PRODUCT(ui): surface overdue and due-soon deadlines in the matter deadlines view`.
**Type**: UI. Manual-merge.
**Surface**: the existing Deadlines disclosure on the matter view (`renderer/screens/viewMatterDeadlines.ts`). No new route, no new IPC channel.
**Grounds**: brief §18 v1 day-one MUST-HAVE — *"Visible overdue-deadline list in the case-box UI; dashboard banner when overdue or due within 7 days."* The deadline read surface (`casebox:deadline:list`) and its response fields (`due_at`, `status`) already exist (and were tenant-hardened in PR #34 / projected in PR #35). This slice adds the urgency *presentation* only.

## Problem

A matter's deadlines render as a flat, unordered-by-urgency list with no visual signal for what is overdue or imminent. For a legal deadline tool this is the single highest-value gap — a missed litigation deadline is malpractice. The data needed to flag urgency already crosses the IPC boundary; nothing below the renderer needs to change.

## Scope (this WI)

- **Renderer-only.** No contract, persistence, `services/`, or new IPC channel. Uses the existing `casebox:deadline:list` response.
- **Read-only.** Still NO create / confirm / dismiss / transition — display only.
- Per-matter view only. The **global cross-matter dashboard banner** (a single banner across all matters) is a deferred follow-up because it needs a new cross-matter deadline-aggregation IPC channel (`getDeadlineCalendar` exists in persistence aggregations but is not exposed over IPC).

## Classification (pure, clock-injected)

`classifyDeadlineUrgency(dueAtIso, status, nowMs)` in `renderer/format.ts` — pure, so it is unit-tested deterministically:

| Condition | Urgency |
|---|---|
| `status !== "pending"` (met / missed / withdrawn) | `none` (settled — never urgent) |
| `due_at` unparseable | `none` |
| `due_at < now` | `overdue` |
| `now ≤ due_at ≤ now + 7 days` (boundaries inclusive) | `due-soon` |
| `due_at > now + 7 days` | `none` |

The deadline list arrives sorted `due_at ASC`, so the earliest rows sort to the top naturally — **no client reordering**. The injected `now` defaults to `Date.now()` in production; tests pass a fixed value.

## Visual design

**Banner** (above the list, `role="status"` so screen readers announce it): shown only when ≥1 urgent deadline is loaded. Text: `"{N} overdue · {M} due within 7 days"` (each clause omitted when its count is 0). Styling:
- any overdue → **danger** tokens (`--color-danger` / `--color-danger-subtle` / `--color-danger-border`), via the `view-deadlines-banner--overdue` modifier.
- due-soon only → **warning** tokens (`--color-warning*`).

**Per-row pill** (`view-deadlines-urgency`, appended after the `kind · status` text): `Overdue` (danger tokens) or `Due soon` (warning tokens). Settled / future rows get no pill. `data-urgency` attribute carries the classification for tests.

All colors are existing theme-aware `var(--color-*)` tokens (both light and dark themes define the danger/warning subtle+border variants), so the `renderer-no-hardcoded-color` lint passes and dark mode inherits.

```
┌ Deadlines ─────────────────────────────────────────┐
│ ⚠ 1 overdue · 1 due within 7 days        (banner)  │   ← danger bg when overdue present
│ • 2026-06-01 09:00  filing · pending  [Overdue]    │   ← danger pill
│ • 2026-06-05 17:00  hearing · pending [Due soon]   │   ← warning pill
│ • 2026-07-30 12:00  payment · pending              │   ← no pill (>7 days)
│ • 2026-05-01 12:00  filing · met                   │   ← no pill (settled)
└────────────────────────────────────────────────────┘
```
(The `⚠` above is illustrative; the implementation renders text only — no emoji, no `innerHTML`.)

## Pagination — eager load all pages (correctness)

The deadlines disclosure **exhausts the seek cursor up front** (loads every page before finalising) rather than paginating with a "Show more" button. Rationale (cc-suite audit `audit-mpxsbpuk-asj8i2`, High): the list is sorted `due_at ASC` across **all** statuses, so a page of old settled (`met`/`missed`/`withdrawn`) deadlines can sit ahead of — and hide — a later **pending overdue** deadline. A partial load would make the banner silently undercount (possibly show *no* urgency despite an overdue deadline) — unacceptable for a malpractice-critical view. Per-matter deadline counts are bounded, so exhausting the cursor is cheap. If matters ever grow huge, a server-side overdue aggregate (new IPC) would replace the loop — noted as the global-dashboard follow-up. This removed the previous "Show more" affordance for deadlines (the existing pagination test was rewritten to assert eager loading + a regression test for the hidden-overdue case).

## Tests

- `tests/renderer-deadline-urgency.test.mjs` — pure classifier: overdue / due-soon / none, the now and now+7d boundaries, the just-past-window case, settled statuses, unparseable date, and labels.
- `tests/renderer-view-matter.test.mjs` (extended) — DOM: pills appear on the right rows with the right `data-urgency`; banner text + overdue-vs-warning styling + `role="status"`; due-soon-only banner; no-urgent → banner hidden + no pills. `now` injected for determinism.

## Out of scope / deferred

- Global cross-matter overdue dashboard banner (needs a new aggregation IPC channel).
- Deadline write flows (confirm / dismiss / transition / create) — separate WIs.
- Sorting/grouping beyond the natural `due_at ASC` order.

## Stop condition

Shipped when the per-matter deadlines view shows the overdue/due-soon banner + pills, gates green, cc-suite audit clean. Superseded if a global deadline-dashboard WI later subsumes the per-matter banner.
