# Design artifact — Deadline status-transition controls

**Status**: design artifact (WI-DT2) for BATCH-CASEBOX-DEADLINE-TRANSITION-00.
**Date**: 2026-06-07.
**Author**: Claude Code (UI lane).
**Implements / consumed by**: WI-DT3 (renderer UI) — cite this path in the WI-DT3 PR body to satisfy the path-based UI design-artifact gate.
**Backend**: WI-DT1 `casebox:deadline:transition` (`window.lawbar.caseBox.transitionDeadline`).

This is a text/DOM design (the app renders a token-styled DOM via the `el()` helper; there is no separate visual prototyping tool in this repo). It mirrors the shipped two-step capture used by `viewMatterDocketProposals.ts` (docket dismiss) and the fact-reject flow.

---

## 1. Where it lives

Inside `renderDeadlineRow()` (`apps/lawbar-desktop/renderer/screens/viewMatterDeadlines.ts`), append a **transition controls block** as the last child of the existing `<li class="view-deadlines-row">`, after the meta (`view-deadlines-row-meta`) and the optional detail (`view-deadlines-row-detail`). The current row already shows `kind · status` (`view-deadlines-kind`) and an urgency pill; the controls sit below them.

```
<li class="view-deadlines-row" data-test-id="view-deadlines-row">
  <div class="view-deadlines-row-meta"> due · kind · status · [urgency] </div>
  <div class="view-deadlines-row-detail"> rule · owner </div>          (optional, unchanged)
  <div class="view-deadlines-transition"                                (NEW)
       data-test-id="view-deadlines-transition"> … per-status controls … </div>
</li>
```

If LOC risk appears in `viewMatterDeadlines.ts`, the controls block + its handlers extract to a sibling `viewMatterDeadlineTransitions.ts` (allowed by WI-DT3); the placement above is unchanged.

## 2. Per-status affordances (visibility rule)

The control set is a pure function of the row's current `status` (the renderer never offers an edge the persistence state machine would reject; persistence remains the authority and surfaces `illegal_transition`):

| Current status | Controls shown |
|---|---|
| `pending`  | three buttons: **Mark met**, **Mark missed**, **Withdraw** (single-click each; no reason) |
| `missed`   | one button: **Mark met** → opens the two-step **required-reason** capture |
| `met`      | none (terminal in v1) |
| `withdrawn`| none (terminal in v1) |

For `met` / `withdrawn`, render no transition block (or an empty one) — there is no outgoing edge. Do not render disabled buttons for impossible edges.

## 3. Interaction — pending → met / missed / withdrawn (single-click)

These edges require no reason (`DeadlineTransitionOpts.transition_reason` omitted). One click:

1. Disable all three buttons in the row (busy guard — a fast double-click must not fire twice; mirrors the `pageLoading` re-entrancy guard).
2. Call `api.transitionDeadline({ matterId, deadlineId: d.id, to })`.
3. **On success** (`env.ok`): refresh the deadlines list via the existing generation-guarded `refresh()`/`load()` so the row re-renders with its new status (and loses its now-invalid controls).
4. **On error** (`!env.ok`): render an inline `role="alert"` message in `view-deadlines-transition-error`, **keep the row**, re-enable the buttons, and **do NOT call refresh** (the WI-D4 dismiss-error lesson — refreshing wipes the inline error and the user's place).

## 4. Interaction — missed → met (two-step, required reason)

`missed → met` requires a non-empty `transition_reason` (audit edge `DEADLINE_MISSED_TO_MET`). The reason capture **is** the confirmation (no separate modal — mirrors docket dismiss + fact reject):

1. Initial state: a single **Mark met** button.
2. Click **Mark met** → reveal a required reason `<input>` (`view-deadlines-transition-reason`, `aria-label="Reason met after missed"`) plus **Confirm** and **Cancel** buttons; hide the initial **Mark met** button.
3. **Cancel** → restore the initial state (hide input + Confirm/Cancel, show **Mark met**), discard any typed reason.
4. **Confirm** with an **empty/whitespace** reason → inline `role="alert"` "A reason is required to mark a missed deadline as met"; stay in the capture state; do **not** call the API.
5. **Confirm** with a non-empty reason → disable Confirm (busy guard) and call `api.transitionDeadline({ matterId, deadlineId: d.id, to: "met", transition_reason })`.
   - **Success** → refresh (generation-guarded), as §3.3.
   - **Error** → inline `role="alert"`, keep the row + the typed reason, re-enable Confirm, **no refresh**, as §3.4.

The renderer sends only `{ matterId, deadlineId, to, transition_reason? }`. The server injects the actor + timestamp and enforces the edge/reason rules; the renderer's reason gating is a UX convenience, not the security boundary.

## 5. Inline error + success semantics (summary)

- **Errors never refresh.** The row, its controls, and any typed reason stay; the error shows in an inline `role="alert"`; controls re-enable so the user can retry or cancel.
- **Success always refreshes** through the existing generation-guarded loader so a superseded load cannot clobber a newer one.
- **Busy guard** on every in-flight transition (disable the triggering control) prevents double submission.

## 6. Accessibility

- All controls are `<button type="button">` with explicit, distinct text labels (Mark met / Mark missed / Withdraw / Confirm / Cancel).
- The reason field is a labeled (`aria-label`) required text input; the empty-reason refusal is announced via the `role="alert"` error node.
- Error nodes use `role="alert"` so assistive tech announces them on appearance (consistent with the existing deadlines/docket error nodes).
- Focus: when the two-step capture opens, move focus to the reason input; on cancel, return focus to the **Mark met** button.
- Controls are keyboard-operable (native buttons/input); no custom key handling required.

## 7. data-test-id contract (for WI-DT3 renderer tests)

- `view-deadlines-transition` — the per-row controls container.
- `view-deadlines-transition-met` / `-missed` / `-withdrawn` — the pending-row single-click buttons.
- `view-deadlines-transition-reason` — the missed→met reason input.
- `view-deadlines-transition-confirm` / `-cancel` — the missed→met two-step buttons.
- `view-deadlines-transition-error` — the inline `role="alert"` error node.

## 8. Out of scope

Reminders, scheduling, docket edit, editing a deadline's `due_at`/`kind`/`owner`, any new persistence/contract field, and any transition not in the persistence edge set. `met` and `withdrawn` are terminal in v1 (no "reopen").

## 9. Stop condition

Implemented by WI-DT3; this artifact is retired when WI-DT3 merges. Superseded if the deadline edge set or the Deadlines section layout changes.
