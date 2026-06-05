# Design artifact — Add and confirm a deadline (propose → confirm write)

**Date**: 2026-06-05.
**WI (suggested)**: `PRODUCT(ui+bridge): add + confirm deadline on a matter` (case-box
deadlines vertical — the write/create path; read path shipped in B7 deadline read surface).
**Type**: UI (write). Manual-merge (renderer UI + renderer IPC bridge wiring). No new
main-process handler — `casebox:docket:create` + `casebox:docket:confirm` already exist on
`ipcMain` (WI-601, PR #51).
**Surface**: an "Add deadline" control + a transient "Proposed (unconfirmed)" area inside the
existing Deadlines disclosure of the matter view (`renderer/screens/viewMatterDeadlines.ts`).
No new screen / route / modal / wizard.
**Grounds**: backend handlers `createDocketEntryHandler` + `confirmDocketEntryHandler`
(`src/caseBox/docketHandlers.ts`); `CreateDocketEntryDto` / `ConfirmDocketEntryDto` /
`DOCKET_ENTRY_RESPONSE_FIELDS` / `CONFIRM_DOCKET_DEADLINE_RESPONSE_FIELDS`
(`src/caseBox/dto.ts`); ADR `docs/adr/case-box-step-6-deadline-docketing-rules.md`; precedent
design `dev-memo/design/2026-06-03-casebox-document-register.md`; urgency design
`dev-memo/design/2026-06-03-casebox-deadline-urgency.md`; code precedent
`viewMatterDocuments.ts renderAddControl` + the `viewMatterDeadlines.ts` urgency banner.

## Problem

The Deadlines section is read-only (`renderDeadlinesDisclosure` → `loadDeadlines`, with the
urgency banner): it shows "No deadlines recorded for this matter." until deadlines exist, but
there is no way to add one. The v1 deadlines path is **propose → confirm**: `appendDocketEntry`
creates a *proposed* entry; only `confirmDocketEntry` materializes the `CaseBoxDeadline` that
surfaces in `listDeadlines`. Both channels are live but unreachable from the renderer. This
slice lets a lawyer **propose a deadline and then confirm it** so it joins the deadline list.

## Smallest safe vertical slice

Lawyer enters `proposed_kind` + `proposed_due_at` (datetime) + `proposed_due_at_timezone`
(IANA) → renderer calls `casebox:docket:create` → main injects identity / provenance and
persists a *proposed* docket entry, returning it → the renderer shows it in a transient
"Proposed (unconfirmed)" row with a **Confirm** button → click Confirm → renderer calls
`casebox:docket:confirm` with `{ matterId, entryId }` → main materializes the deadline → the
deadline list refreshes in place and the new deadline appears (with the existing urgency
classification); the proposed row clears.

Nothing else: no dismiss, no edit, no transition, no reminders.

### Two-step state (important design constraint)

There is **no docket-read IPC** — proposed-but-unconfirmed entries are not separately
listable. The proposed entry lives **only** in the renderer's ephemeral state (the
`casebox:docket:create` response) between propose and confirm. Consequences the design accepts:

- A page reload / matter re-navigation **before** confirming loses the unconfirmed proposal
  from the UI (the persisted proposed entry still exists server-side but cannot be re-surfaced
  without a read channel). This is acceptable for the smallest slice; a future docket-read IPC
  + "pending proposals" surface is **out of scope** (noted below).
- Confirm is the only step that makes a deadline visible in `loadDeadlines`. Until confirm, the
  deadline list is unchanged.

## IPC contract (existing channels — consume, do not change)

```
casebox:docket:create    CreateDocketEntryDto { matterId: string;
                                                 proposed_kind: string;            // required, non-empty
                                                 proposed_due_at: string;          // required ISO-8601 datetime
                                                 proposed_due_at_timezone: string; // required IANA tz
                                                 proposed_owner_user_id?: string } // optional
                          -> IpcEnvelope<RendererDocketEntryRow>   // PROPOSED entry (confirmation_state "proposed")

casebox:docket:confirm   ConfirmDocketEntryDto { matterId: string; entryId: string }
                          -> IpcEnvelope<{ entry: RendererDocketEntryRow;          // now confirmation_state "confirmed"
                                           deadline: RendererConfirmDeadlineRow }> // the materialized CaseBoxDeadline
```

- `create` injects all authority / provenance / lifecycle fields server-side (`id`,
  `tenant_id`, `actor_user_id`, `source_type: "manual"`, `proposed_due_at_kind: "datetime"`,
  provenance `null`, lifecycle `null`, `created_at`). Those are **forbidden in the DTO** →
  `invalid_payload`.
- `confirm` is scoped fail-closed: main runs a scoped `getDocketEntry({ tenant_id, matter_id,
  entry_id })` preflight and rejects a foreign / unknown / wrong-tenant `entryId` with
  `invalid_payload` **without** materializing anything. The renderer must surface that safely.
- Both responses are projected to renderer-safe allowlists (authority identities stripped). The
  materialized `deadline` carries the same non-authority fields the deadline list already
  renders, so it slots straight into `renderDeadlineRow`.

### Renderer bridge wiring (part of this WI)

`electron/preload.mts` adds `createDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:create", dto)`
and `confirmDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:confirm", dto)`;
`renderer/api.ts` adds both to `CaseBoxClient` + `CaseBoxApi` and wires them through
`createCaseBoxApi` with `RENDERER_CREATE_DOCKET_DTO_FIELDS` (`matterId`, `proposed_kind`,
`proposed_due_at`, `proposed_due_at_timezone`, `proposed_owner_user_id`) and
`RENDERER_CONFIRM_DOCKET_DTO_FIELDS` (`matterId`, `entryId`) strip-allowlists — mirroring
`registerDocument`. `preload.mts` (electron/) is not design-gated; `renderer/api.ts` is.

## UI

The Deadlines disclosure gains one **in-section** "Add deadline" control, placed above the
existing banner + list, built with `el()` / `textContent` only — never `innerHTML`. Proposed
elements + test ids (mirroring `view-docs-add-*` and the `view-deadlines-*` family):

- `view-deadlines-add-control` — wrapper `div`.
- `view-deadlines-add-kind` — text `<input>` for `proposed_kind` (placeholder e.g. "filing").
  Required.
- `view-deadlines-add-due` — `<input type="datetime-local">` for `proposed_due_at` (converted
  to ISO-8601 on submit). Required.
- `view-deadlines-add-tz` — `<input>`/`<select>` for `proposed_due_at_timezone` (IANA;
  default pre-filled with the host tz). Required.
- `view-deadlines-add` — "Propose deadline" `<button type="button">`.
- `view-deadlines-add-status` — a `<span>` status line.
- `view-deadlines-proposed` — a transient area (hidden until a proposal exists) holding the
  proposed row + its confirm control:
  - `view-deadlines-proposed-row` — shows the proposed `kind` + `due_at` + a "Proposed
    (unconfirmed)" marker.
  - `view-deadlines-confirm` — "Confirm deadline" `<button type="button">`.
  - `view-deadlines-confirm-status` — a `<span>` status line.

**Propose flow** (mirror `renderAddControl`): click "Propose deadline" → button `disabled` +
status "Proposing…" → `api.createDocketEntry({ matterId, proposed_kind, proposed_due_at,
proposed_due_at_timezone })` → button re-enabled → on success status "Proposed — confirm to add
it." and the `view-deadlines-proposed` area un-hides showing the returned proposed entry; on
error inline alert (no proposed area).

**Confirm flow**: click "Confirm deadline" → confirm button `disabled` + confirm-status
"Confirming…" → `api.confirmDocketEntry({ matterId, entryId })` (entryId from the held proposed
response) → on success: confirm-status "Confirmed.", the `view-deadlines-proposed` area clears
(hidden), and the deadline list refreshes in place (re-run `loadDeadlines` against a cleared
body so the urgency banner + the materialized deadline reflect the new state); on error inline
alert in `view-deadlines-confirm-status`, proposed area retained so the lawyer can retry.

### Error / success states

| Condition | UI |
|---|---|
| Propose success | `view-deadlines-add-status` "Proposed — confirm to add it."; proposed area shown. |
| Propose `invalid_payload` (missing/invalid kind/due/tz, or forbidden field) | `view-deadlines-add-status` gets `role="alert"` + `data-test-id="view-deadlines-add-error"`, server message; proposed area not shown. |
| Confirm success | `view-deadlines-confirm-status` "Confirmed."; proposed area cleared; deadline list refreshes; new deadline visible with urgency pill if applicable. |
| Confirm `invalid_payload` (foreign / unknown / wrong-tenant entryId — fail-closed) | `view-deadlines-confirm-status` `role="alert"` + `data-test-id="view-deadlines-confirm-error"`, server message; proposed area retained. |
| `unknown_matter` / `tenant_mismatch` (either step) | inline `role="alert"` with server message; never the raw matter id. |
| In flight | the active button `disabled`; status text set; `role` removed while loading. |

Every `!env.ok` renders inline (consistent with the existing `view-deadlines-error`); no throw
to console.

## Accessibility notes

- Error statuses use `role="alert"` only when an error is shown (set on failure, removed while
  loading) — matches `view-deadlines-error` on the read surface.
- The transient proposed area uses the `hidden` attribute (removed from the a11y tree) until a
  proposal exists, and is announced via a `role="status"` on the proposed-row marker so a
  screen reader hears "Proposed (unconfirmed)" when it appears — consistent with the existing
  `role="status"` urgency banner.
- Each input has a visible `<label>` (or `aria-label`): kind, due date/time, timezone. Both
  buttons have discernible names ("Propose deadline", "Confirm deadline").
- Keyboard: plain form controls in DOM order; Confirm becomes focusable when the proposed area
  appears; no focus trap, no custom widget; the disclosure stays a native `<details>`.
- The materialized deadline reuses the existing `renderDeadlineRow` urgency pill, whose meaning
  is conveyed by text (`deadlineUrgencyLabel`) + `data-urgency`, not color alone.

## Tests / acceptance (testable)

Renderer unit tests (extend `tests/renderer-view-matter.test.mjs`; bridge in
`tests/renderer-api.test.mjs` + `tests/renderer-dto-sync.test.mjs`), using `_view-matter-dom.mjs`
+ a mock `CaseBoxApi` with an injected fixed clock (the deadline screen already takes `nowMs`):

1. **Propose success** — `createDocketEntry` resolves `ok` → `view-deadlines-proposed` un-hides
   with the proposed kind/due; status "Proposed — confirm to add it."
2. **Propose → Confirm success** — after a proposal, `confirmDocketEntry` resolves `ok` →
   proposed area clears, `listDeadlines` is re-invoked, and the materialized deadline renders
   (with the correct urgency pill against the fixed clock).
3. **Confirm foreign/unknown entryId** — `confirmDocketEntry` returns `invalid_payload` →
   inline `role="alert"` `view-deadlines-confirm-error`; proposed area retained; deadline list
   NOT refreshed.
4. **Propose invalid** — missing `proposed_kind` (client pre-check) or server `invalid_payload`
   → inline `view-deadlines-add-error`; no proposed area.
5. **Server boundary** — `unknown_matter` / `tenant_mismatch` on propose → inline alert with the
   server message; never the raw matter id.
6. **DTO strip** — `createDocketEntry` forwards only the five create fields; `confirmDocketEntry`
   forwards only `matterId` / `entryId` (renderer allowlists; `renderer-dto-sync` parity with
   `CREATE_DOCKET_DTO_FIELDS` / `CONFIRM_DOCKET_DTO_FIELDS`).
7. **Two-step state** — before confirm, the deadline list is unchanged (confirm is the only
   step that calls `listDeadlines` refresh).
8. **Safe DOM** — no `innerHTML`; all text via `el()` / `textContent`.

Gate: `npm --prefix apps/lawbar-desktop test`.

## Out of scope (not bundled)

Deadline dismissal / edit / transition; reminders / notifications / reminder offsets; a
docket-read IPC or a persistent "pending proposals" surface (so unconfirmed proposals survive
reload); rule-citation autofill / jurisdiction deadline rules; bulk add; multi-step wizards or
modals; WeChat Mini Program. All deferred. The reload-loses-unconfirmed-proposal limitation is
an accepted constraint of this slice, not a defect.

## Stop condition

Retire when the Add+Confirm-deadline WI ships (referencing this artifact as its
`Design artifact:`) and the acceptance tests above are green. Stale if the
`casebox:docket:create` / `casebox:docket:confirm` contracts change before the WI lands.
