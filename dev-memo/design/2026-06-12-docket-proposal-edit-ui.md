# Design artifact — Docket proposal edit UI (DPE5)

**Status**: design direction (human-authored noun) for `WI-DPE5`. Satisfies the `Type: UI`
design-artifact gate (`UI-GATES.md` §"Queue entry gate" + §"PR-time gate"). NOT implementation-authorizing
on its own — the governed `WI-DPE5` queue block + `/cc-suite:review-plan` authorize implementation.
**Date**: 2026-06-12.
**Feature**: in-place edit of a **proposed** docket entry's content, the terminal UI layer of the
docket-proposal-edit feature (contract DPE2 → hardening FIX1 → persistence DPE3 → IPC/DTO DPE4 → **UI DPE5**).
**Plan**: `dev-memo/plan-batch-casebox-docket-proposal-edit-ui-00.md`.
**Source of truth**: `docs/adr/docket-proposal-edit.md` §3 (six editable fields), §4 (immutable
provenance/lifecycle), §6 ("(edited)" / `revised_at` visibility), §9 (DPE5 = UI).
**Surface**: `apps/lawbar-desktop/renderer/screens/viewMatterDocketProposals.ts` — the pending-proposals
group inside the matter view's Deadlines disclosure.

---

## 1. Intent

Let a lawyer correct the content of a docket proposal they already created (or that was machine-suggested)
**before** confirming it into a deadline — without deleting and re-creating it, and without any risk of the
renderer touching authority, provenance, lifecycle, or audit data. Editing is a content fix on a still-
**proposed** entry; it is **not** a confirmation and **not** a dismissal.

---

## 2. UI pattern — per-row two-step reveal (mirrors dismiss)

The edit affordance reuses the exact interaction shape of the existing in-row **Dismiss** control so the
screen stays visually and behaviorally coherent.

```
┌ Pending proposals (2) ─────────────────────────────────────────────┐
│ • filing · manual   due Jun 20, 2026 4:00 PM   proposed Jun 1       │
│                                            [ Edit ] [ Dismiss ]      │   ← default row
│                                                                     │
│ • hearing · manual  due Jun 22, 2026 9:00 AM  proposed Jun 2 (edited)│  ← revised_at present → badge
│                                            [ Edit ] [ Dismiss ]      │
└─────────────────────────────────────────────────────────────────────┘

Edit pressed on row 1 → two-step reveal (Dismiss hidden while editing):

┌─────────────────────────────────────────────────────────────────────┐
│ • Kind:        [ filing            ]                                 │
│   Due:         [ 2026-06-20T16:00 ]   Kind: (datetime ▾)            │
│   Timezone:    [ America/New_York ]   (host zone)                    │
│   Owner:       [ local-user        ]                                 │
│   Reminders:   advance_notice −7d, final_notice −1d   (read-only)    │   ← passthrough, §4
│                                  [ Save changes ] [ Cancel ]  ⓘ      │
└─────────────────────────────────────────────────────────────────────┘
```

Rules:

- **Edit** and **Confirm** (the deadline-confirm action elsewhere in the Deadlines section) are **distinct**.
  There is **no edit-then-confirm shortcut** (ADR §3): saving an edit leaves the entry **proposed**; the
  lawyer confirms separately when ready.
- Only one mode per row at a time: revealing Edit hides Dismiss; revealing Dismiss hides Edit. (Mirrors the
  existing single-control reveal.)
- The reveal is inline within the row — no modal, matching the dismiss + add-deadline precedents.

---

## 3. Form scope — five editable controls + one passthrough

Editable (renderer controls):

| Field | Control | Validation (UX layer; main is authoritative) |
|---|---|---|
| `proposed_kind` | text | non-empty |
| `proposed_due_at` | datetime / date input | parseable ISO-8601; host-zone resolver reused from add-deadline |
| `proposed_due_at_kind` | select `datetime` / `date_only` | one of the two |
| `proposed_due_at_timezone` | text/display, **host zone** | IANA zone; `null` only with `date_only`; `date_only→datetime` upgrade needs a valid zone (ADR §3) |
| `proposed_owner_user_id` | text | non-empty (single-lawyer default `local-user`) |

Passthrough (NOT a rich editor in DPE5):

- **`reminder_offsets`** — **read-only display + unchanged passthrough on save**:
  - If the existing reminders are available on the projected row, display them read-only (e.g.
    `advance_notice −7d, final_notice −1d`).
  - On **Save**, send the existing `reminder_offsets` value **unchanged** as part of the 6-field content set
    (so the persistence edit never sees a dropped/blanked reminders array).
  - **No add/remove/reorder editor** in this WI. A rich reminder editor is deferred to a separate future
    UI WI if a need arises (`WI-DPE5-L*` / a follow-up), not folded into DPE5.

Rationale for passthrough: `reminder_offsets` is a nested `{offset_days, kind}[]` array; a full editor is
disproportionate to this slice and would widen the surface. Passthrough keeps DPE5 bounded and the security
surface identical to confirm/dismiss while still letting the lawyer fix the five scalar fields.

---

## 4. Forbidden fields — never an editable control

The edit form renders **no** editable control for any of: `tenant_id`, `matter_id`/matter authority,
`actor_user_id`, `editor_actor_user_id`, `id`/`entry_id` (identity), `source_type`,
`source_rule_citation`, `extractor_*`, `extraction_confidence`, `source_document_id`, `source_page_number`,
`source_excerpt` (provenance), `confirmation_state`, `proposed_at`, `confirmation_actor_user_id`,
`confirmed_at`, `confirmed_deadline_id`, `dismissal_actor_user_id`, `dismissed_at`, `dismissal_reason`,
`created_at` (lifecycle/audit), and **`revised_at`**.

- `matterId`/`entryId` are scope the screen already holds (from the listed row); they are **not** user-
  editable form fields — they are passed as the immutable target of the edit.
- `revised_at` may be **displayed** only as renderer-safe edited-state metadata (§5); it is never an input.
- These align with the app's `EDIT_DOCKET_FORBIDDEN_FIELDS` (the server-side authority); the renderer's
  `RENDERER_EDIT_DOCKET_DTO_FIELDS` allowlist + `stripDtoFields` are the renderer-side second layer.

---

## 5. Edited state — "(edited)" badge

- A row whose projected `revised_at` is present renders an **"(edited)"** badge in the meta line (next to
  kind/due/proposed-at), with accessible text (not color-only).
- Presence of the badge is the machine-suggested-vs-user-edited distinction (ADR §6): no `revised_at` +
  `source_type=llm_extraction` = machine-suggested; `revised_at` present = user-edited.
- If a timestamp is shown, it is **secondary and non-authoritative** — e.g. a `title`/tooltip or a muted
  inline `edited <localized time>` via `formatLocalDateTime(revised_at)`. The badge, not the timestamp, is
  the primary signal.
- The badge is derived purely from the projected row; the renderer never computes or writes `revised_at`.

---

## 6. Save / cancel behavior

- **Save changes**: validate the five editable fields → call the DPE4 renderer bridge
  `api.editDocketEntry({ matterId, entryId, proposed_kind, proposed_due_at, proposed_due_at_kind,
  proposed_due_at_timezone, proposed_owner_user_id, reminder_offsets })` — **only** `matterId`, `entryId`,
  and the six content fields (five edited + `reminder_offsets` passthrough). Disable controls, show
  "Saving…".
  - **Success**: the entry stays **proposed** with revised content → refresh/reconcile the row **in place**
    (the section's existing generation-guarded `refresh()`), so it reappears with the new values + the
    "(edited)" badge. No navigation, no confirm side effect.
  - **Error** (`!env.ok`): keep the form open with the entered values, show the **normalized** inline error
    (`env.error.message`, already a static no-leak string from main) via accessible alert semantics,
    re-enable **Save changes**. Do **not** refresh on error (a reload would wipe the inline alert — matches
    the dismiss + confirm-deadline error paths).
- **Cancel**: exit edit mode with **no API call**; discard entered values; restore the Edit/Dismiss buttons;
  clear any status.
- Re-entrancy: a per-control `saving` guard prevents a double-click on Save from firing two `editDocketEntry`
  calls (mirrors the dismiss/`pageLoading` guards).

---

## 7. Accessibility / keyboard

- **Edit**, **Save changes**, **Cancel** are all real `<button type="button">` elements — keyboard
  reachable and operable (Enter/Space), mirroring the dismiss control.
- Each edit input has an associated label / `aria-label`; required fields carry `aria-required="true"`
  (mirrors the dismiss reason input's `aria-required`).
- Inline error uses the screen's existing accessible-alert pattern: `role="alert"` +
  `data-test-id="...-error"` (same as `view-docket-dismiss-error`).
- **Focus**: on reveal, focus moves to the first edit field; on Save-success (after refresh) or Cancel,
  focus returns predictably to the row's Edit button (or the next logical control) — never dropped to
  document top. **Escape** cancels the edit.
- The "(edited)" badge exposes accessible text (e.g. visually-hidden "edited" or `aria-label`), not color
  alone — satisfies the axe regression-gate floor (UI-GATES §B is a floor, not certification).

---

## 8. Scope / exclusions

- **No renderer-wide redesign** — only the per-row edit affordance + the badge are added; the proposals
  section's layout, pagination, generation guard, and the dismiss control are otherwise untouched.
- **No persistence / IPC / contract / error-map change** — DPE5 reuses the frozen DPE3 persistence op,
  the DPE4 `casebox:docket:edit` channel + DTO, and the existing no-leak error mapping verbatim.
- **No new IPC channel.**
- **No rich `reminder_offsets` editor** in DPE5 (passthrough only; §3).
- **confirm / dismiss / create / list behavior unchanged.**
- **Not WI-DPE2-FIX2** (Class-B contract hardening — separate, deferred).
- The visual / a11y / Lighthouse regression gates (UI-GATES §A/B/C) are not yet wired into automation;
  DPE5 relies on this artifact + renderer unit tests + manual review.

---

## 9. Acceptance signals (for the eventual review-plan / tests)

1. Edit reveals a form prefilled with the five editable values + the read-only reminders; Dismiss hidden
   while editing.
2. Save sends exactly `{ matterId, entryId, + six content fields }` — no authority/provenance/lifecycle/
   `revised_at`; `reminder_offsets` is the unchanged existing value.
3. Successful save keeps the entry proposed and refreshes the row in place with new values + "(edited)" badge.
4. Error keeps the form, shows a normalized inline alert, re-enables Save, does not refresh, leaks no
   tenant/matter/id.
5. Cancel makes no API call.
6. Edit/Save/Cancel keyboard reachable; focus returns predictably; Escape cancels.
7. confirm/dismiss/create/list behavior unchanged.

---

## 10. Stop condition

Consumed when `WI-DPE5` is promoted to a governed queue block citing this artifact and review-plan returns
READY. Outdated if the DPE4 DTO/projection surface changes or `docs/adr/docket-proposal-edit.md` §3/§6/§9
is revised.
