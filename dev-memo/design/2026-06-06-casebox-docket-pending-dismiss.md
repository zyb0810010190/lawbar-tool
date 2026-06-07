# Design artifact — Pending docket proposals: durable read + dismiss

**Date**: 2026-06-06.
**WI**: WI-D4 (BATCH-CASEBOX-DOCKET-LIFECYCLE-00) — renderer bridge + pending-proposals UI + dismiss UI.
**Type**: UI (read + a single dismiss write). Renderer + the preload bridge only: `apps/lawbar-desktop/electron/preload.mts` (invoke bindings — the real renderer IPC bridge) + `renderer/api.ts` + `renderer/types.ts` + the Deadlines screen. NO new main-process handler and NO change to `electron/ipc/**` or `electron/main.ts` — `casebox:docket:list` (WI-D1) and `casebox:docket:dismiss` (WI-D2) already exist on `ipcMain`; WI-D4 only adds the two invoke bindings to `preload.mts`.
**Surface**: a "Pending proposals" group INSIDE the existing Deadlines disclosure of the matter view (`renderer/screens/viewMatterDeadlines.ts`), plus a per-proposal **Dismiss** affordance. No new screen / route / modal / wizard. If the file nears the 800 LOC cap, the proposals group + its handlers extract to a sibling `renderer/screens/viewMatterDocketProposals.ts`.
**Grounds**: handlers `listDocketEntriesHandler` + `dismissDocketEntryHandler` (`src/caseBox/docketHandlers.ts`); `LIST_DOCKET_*` / `DISMISS_DOCKET_*` / `DOCKET_ENTRY_RESPONSE_FIELDS` / `RendererDocketEntryRow` (`src/caseBox/dto.ts`); ADR `docs/adr/case-box-step-6-deadline-docketing-rules.md`; precedent designs `dev-memo/design/2026-06-05-casebox-deadline-create-confirm.md` (propose→confirm) + `dev-memo/design/2026-06-05-casebox-fact-review.md` (per-row review/transition controls + reason capture). Code precedent: `viewMatterFacts.ts` review controls (legal-action-only, text-first status, narrow DTO forward, inline `role=alert`) + the existing `viewMatterDeadlines.ts` disclosure/urgency rendering.

## Problem

A proposed docket entry is **durably persisted** (`appendDocketEntry` writes a `confirmation_state="proposed"` row + a `DOCKET_ENTRY_PROPOSED` audit) but **invisible after reload**: the Deadlines section loads only `casebox:deadline:list` (confirmed deadlines), and the proposed entry lives in the UI only as an ephemeral `proposedEntryId` JS variable. A lawyer who proposes a deadline and reloads before confirming gets an **orphaned proposal** — still in the DB, gone from the screen, with no way to recover or cancel it. This slice surfaces durable pending proposals after reload (read) and lets the lawyer **dismiss/cancel** a stale one.

## Smallest safe vertical slice

On opening (disclosing) the Deadlines section, the renderer additionally calls `casebox:docket:list` filtered to `confirmation_state="proposed"` and renders a **"Pending proposals"** group above the confirmed-deadline list. Each proposed row shows the proposal's human fields and a **Dismiss** affordance. Dismiss collects a required reason, calls `casebox:docket:dismiss` `{ matterId, entryId, dismissal_reason }`, and on success removes the row (re-lists). Nothing else: no edit, no confirm-here (confirm stays in the existing propose→confirm control), no deadline status transition, no reminders.

## Layout (inside the Deadlines disclosure)

```
▼ Deadlines
   ┌─ Pending proposals (N) ────────────────────────────────┐   ← only shown when N >= 1
   │  • Filing — due 2026-06-30 14:00 America/New_York        │
   │      proposed 2026-06-01 · source: manual               │
   │      [ Dismiss ]                                         │
   │  • Hearing — due 2026-07-15 …                            │
   │      [ Dismiss ]                                         │
   └─────────────────────────────────────────────────────────┘
   (urgency banner — existing)
   Deadlines (confirmed) — existing list
      • …
   [ Add deadline ]  ← existing propose→confirm control (unchanged)
```

- The "Pending proposals" group renders ABOVE the confirmed-deadline list and the urgency banner, because an unconfirmed proposal is an action item awaiting the lawyer's decision.
- It is **omitted entirely when there are zero proposals** (no empty "Pending proposals (0)" chrome) — the confirmed list keeps its own existing empty state.
- Per-row fields (read-only, from `DOCKET_ENTRY_RESPONSE_FIELDS`): `proposed_kind` (label), `proposed_due_at` (formatted via the existing `formatLocalDateTime`) + `proposed_due_at_timezone`, `proposed_at` (proposed date), `source_type`. No actor/tenant identity is shown (they are stripped server-side; the renderer never receives them).

## States

- **Not loaded**: like the confirmed deadlines, the proposals group is lazily loaded — nothing fetched until the Deadlines disclosure is opened. (Matches the existing `deadlines: NOT loaded until summary clicked` behavior.)
- **Loading**: a brief "Loading…" affordance while the `casebox:docket:list` call is in flight (reuse the section's existing loading idiom).
- **Empty**: zero proposals → the group is not rendered at all (the confirmed list/urgency render as today).
- **Populated**: N proposed rows, each with a Dismiss affordance.
- **Paginated**: `casebox:docket:list` returns `{ rows, next_cursor }`. WI-D4 renders the **first page** and, when `next_cursor` is **non-null**, renders an explicit **"Show more"** affordance that fetches the next page (passing `cursor`) and **appends** its rows — mirroring the existing facts list `next_cursor` "Show more" pattern (`viewMatterFacts.ts`). Proposed entries beyond page one MUST be reachable (no silent truncation). Do NOT eager-load unbounded pages. The visible count reflects the rows currently loaded; "Show more" disappears once `next_cursor` is null.
- **Dismissing**: while a dismiss call is in flight, the row's Dismiss control is disabled (and shows a transient "Dismissing…" label) to prevent a double-submit.
- **Error (load)**: if `casebox:docket:list` returns an error envelope, render an inline `role="alert"` in the proposals area (mirrors `deadlines: envelope error renders inline role=alert`); the confirmed list still renders independently.
- **Error (dismiss)**: if `casebox:docket:dismiss` returns an error envelope (e.g. the entry was already confirmed/dismissed in another window → `invalid_payload`), render an inline `role="alert"` near that row, re-enable the control, and re-list so the UI reflects current state.

## Dismiss affordance + reason capture

- The dismiss control is a **two-step, in-row** affordance (mirrors the fact-review reject-with-reason precedent, not a separate modal): clicking **Dismiss** reveals a required **reason** text input + a **Confirm dismiss** button and a **Cancel** (back-out) button.
- **Reason is required**: Confirm dismiss is disabled until the reason field is non-empty (and the server also enforces non-empty `dismissal_reason` — defense in depth). The renderer trims and rejects whitespace-only locally before calling.
- On **Confirm dismiss**: call `casebox:docket:dismiss` with exactly `{ matterId, entryId, dismissal_reason }`. The renderer forwards ONLY those three fields (server injects actor + timestamp; the renderer never sends authority/timestamp/state fields).
- On **Cancel**: collapse the reason input back to the single Dismiss control; no call made.

## Destructive / confirmation behavior

- Dismiss is a **reversible-by-re-propose** action (the model is dismiss + re-propose; there is no in-place edit), and it does NOT delete data — it transitions the entry to `dismissed` with an audited reason. It is therefore treated as a **deliberate-but-not-catastrophic** action: the inline reason-capture step IS the confirmation (an explicit second click + a typed reason), consistent with the fact-reject precedent. No separate "Are you sure?" modal.
- Only **proposed** entries are dismissible from this UI (WI-D2 enforces proposed-only server-side; the UI only ever lists `confirmation_state="proposed"` rows, so a Dismiss control never appears on a confirmed/dismissed entry).

## Accessibility & keyboard

- The proposals group is a labelled region (`aria-label="Pending proposals"`); the count is in the visible heading text (not color-only).
- Each row's Dismiss control is a real `<button>`; the revealed reason field is a labelled `<input>`/`<textarea>` with an associated `<label>` (`for`/`id`); Confirm dismiss + Cancel are real `<button>`s — all reachable and operable by keyboard (Tab/Enter/Space), no mouse-only affordance.
- Disabled state during "Dismissing…" uses the `disabled` attribute (announced by AT), not visual-only graying.
- Errors use `role="alert"` so they are announced on appearance.
- Status/labels are **text-first** (e.g. the kind label, "proposed", "Dismissing…"), never color-only — consistent with the WI-804 review-controls convention.

## Relationship to the existing propose → confirm flow

- The existing **Add deadline** control (propose → confirm, `dev-memo/design/2026-06-05-casebox-deadline-create-confirm.md`) is UNCHANGED. After a successful **propose**, that control still shows its transient in-session "Proposed (unconfirmed)" row with a **Confirm** button (ephemeral, same session).
- The NEW "Pending proposals" group is the **durable, reload-surviving** view of the same proposed entries (read from persistence via `casebox:docket:list`), and it is where a lawyer **dismisses** a proposal they no longer want. Confirm remains in the propose→confirm control for this slice (confirming from the pending-proposals list is a possible future enhancement, explicitly out of scope here).
- After a **confirm** (via the existing control), the entry leaves `proposed` → the next list refresh drops it from "Pending proposals" and it appears in the confirmed deadlines list. After a **dismiss**, the entry leaves `proposed` → it drops from "Pending proposals" and does not appear anywhere else (terminal).

## Bridge (renderer wiring)

- `apps/lawbar-desktop/electron/preload.mts` (the real renderer IPC bridge — `renderer/preload.mts` does not exist): add `listDocketEntries` + `dismissDocketEntry` invoke bindings on the case-box client, alongside the existing `listDeadlines`/`createDocketEntry`/`confirmDocketEntry`/`transitionFact` bindings. Invoke bindings only — no main-process handler / `electron/ipc/**` / `electron/main.ts` change.
- `renderer/api.ts`: add `listDocketEntries(dto)` + `dismissDocketEntry(dto)` to `CaseBoxClient`/`CaseBoxApi`, each stripping outgoing DTO fields via `stripDtoFields(dto, RENDERER_LIST_DOCKET_DTO_FIELDS)` / `RENDERER_DISMISS_DOCKET_DTO_FIELDS`.
- `renderer/types.ts`: `ListDocketEntriesDto` + `DismissDocketEntryDto` + `RENDERER_LIST_DOCKET_DTO_FIELDS` (`["matterId","confirmation_state","source_type","limit","cursor"]`) + `RENDERER_DISMISS_DOCKET_DTO_FIELDS` (`["matterId","entryId","dismissal_reason"]`); `renderer-dto-sync` PAIRS assert these are set-equal to the canonical `LIST_DOCKET_DTO_FIELDS` / `DISMISS_DOCKET_DTO_FIELDS`. (WI-D4 MUST NOT touch `src/caseBox/dto.ts`; the canonical constants are imported/read for the sync assertion only.)
- The renderer reads only the human fields it renders; it never inspects authority identities (none are present in the projected response).

## Out of scope (hard stops for WI-D4)

- NO edit-in-place of a proposed entry (no contract operation; needs an ADR).
- NO deadline status transition (met/missed/withdrawn) — separate slice; persistence exists but no IPC.
- NO reminders / scheduling / notifications.
- NO confirm-from-the-pending-list (confirm stays in the existing propose→confirm control).
- NO change to `src/**`, `electron/ipc/**`, `electron/main.ts`, `services/**`, `docs/contracts/**`, or `apps/lawbar-desktop/src/caseBox/dto.ts`. The ONLY non-renderer file WI-D4 touches is `apps/lawbar-desktop/electron/preload.mts` (the two invoke bindings). If WI-D4 appears to require any of the forbidden paths, STOP and report.

## Acceptance hooks for WI-D4

- A test mounts the Deadlines section, lists a proposed entry, and asserts it renders in the "Pending proposals" group (proving reload visibility).
- A test asserts the Dismiss flow forwards exactly `{ matterId, entryId, dismissal_reason }` and that the row disappears / list refreshes on success.
- A test asserts a dismiss error renders inline `role="alert"`.
- A test asserts that when `casebox:docket:list` returns a non-null `next_cursor`, a "Show more" affordance is rendered and clicking it fetches + appends the next page (proposals beyond page one reachable; no silent truncation).
- `renderer-dto-sync` PAIRS for the two new DTO field-sets pass.
- `viewMatterDeadlines.ts` stays under the 800 source LOC cap (extract `viewMatterDocketProposals.ts` if needed); `loc-guardian:scan` clean.
