# Design request — Case-box write affordances (Add Fact + Add/Confirm Deadline)

**Date**: 2026-06-05.
**Status**: **DESIGN REQUEST / HANDOFF — NOT an approved UI design artifact.** This file is a
design-source brief for Claude Design. It does **not** satisfy the `Design artifact:` queue
gate (`UI-GATES.md` → `check-queue.sh` / `check-ui-design-artifact.sh`) and does **not**
authorize any `renderer/**` implementation. Renderer implementation remains **blocked** until
Claude Design produces the two deliverables below under `dev-memo/design/` and they are
referenced by a `Type: UI` WI.
**Author**: Claude Code (UI readiness step).
**Scope**: ONE design request covering two related write flows. Not a plan, not a queue, not
implementation.

## Why this request exists

Backend IPC for case-box writes is merged on `main` (BATCH-CASEBOX-WRITE-00, WI-601 #51 +
WI-602 #52, closed), but the renderer cannot reach it: the bridge (`electron/preload.mts`
whitelist + `renderer/api.ts` `CaseBoxClient`/`CaseBoxApi`) exposes none of the write channels,
and the Facts / Deadlines sections of the matter view are read-only (no Add affordance). To
expose these to a lawyer, a UI WI must implement against a human-authored design — which does
not yet exist for the write flows.

## Backend IPC channels now available (consume these; do NOT change them)

```
casebox:fact:create      CreateFactDto { matterId, statement_text, purpose?, as_of_date? }
                          -> IpcEnvelope<RendererCreatedFactRow>     // candidate, lawyer_authored
casebox:docket:create    CreateDocketEntryDto { matterId, proposed_kind, proposed_due_at,
                          proposed_due_at_timezone, proposed_owner_user_id? }
                          -> IpcEnvelope<RendererDocketEntryRow>      // PROPOSED entry (not yet a deadline)
casebox:docket:confirm   ConfirmDocketEntryDto { matterId, entryId }
                          -> IpcEnvelope<{ entry, deadline }>         // materializes the CaseBoxDeadline
```

Server injects all identity / status / provenance / lifecycle fields; the renderer supplies
only the fields above. Responses are already projected to renderer-safe allowlists (authority
identities stripped). The renderer must never supply `tenant_id` / `actor_user_id` / status /
provenance — those are `invalid_payload` by contract.

## Precedent to mirror (do not reinvent the pattern)

- **Design precedent**: `dev-memo/design/2026-06-03-casebox-document-register.md` — the shipped
  write-flow design (problem / smallest-slice / IPC contract / UI / out-of-scope / testable
  acceptance). Match its section shape so the deliverables satisfy `Design artifact:`.
- **Code precedent**: `viewMatterDocuments.ts` `renderAddControl` — the in-section Add control:
  a control row → button disabled + "…ing" while in flight → on success "Added." + list
  refreshes in place → on error an inline `role="alert"`. `el()` / `textContent` only, never
  `innerHTML`. Each Add flow here should be a single in-section control of this exact shape.

## Deliverable A — Add Fact

**Surface**: inside the existing Facts disclosure of the matter view
(`renderer/screens/viewMatterFacts.ts` — today read-only).
**Inputs**: `statement_text` (required, multi-line); optional `purpose` (`<select>` over the
R-5 enum: `claim` / `defense` / `counterclaim` / `timeline_event` / `work_order_result` /
`consultation_q` / `consultation_a` / `other`); conditional `as_of_date` (date-only
`YYYY-MM-DD`) — **shown and required only when `purpose === "timeline_event"`** (the backend
enforces both the date-only format and the timeline-event requiredness; the UI should reveal /
require the field to match, not duplicate validation logic).
**Behaviour**: consumes `casebox:fact:create`; the created fact returns as a `candidate`
lawyer-authored fact and joins the list on refresh.
**Design must cover**: the empty-state → first-fact transition; the `timeline_event` →
`as_of_date` conditional reveal; success / cancel / error copy.
**Expected deliverable file**: `dev-memo/design/<date>-casebox-fact-create.md` (Claude Design
export).

## Deliverable B — Add + Confirm Deadline (two-step)

**Surface**: inside the Deadlines disclosure (`renderer/screens/viewMatterDeadlines.ts` — today
read-only).
**Two-step flow**:
1. **Propose** via `casebox:docket:create` — inputs `proposed_kind`, `proposed_due_at`
   (datetime), `proposed_due_at_timezone` (IANA tz). Returns a *proposed* docket entry — **not
   yet** a deadline.
2. **Confirm** via `casebox:docket:confirm` (`{ matterId, entryId }`) — materializes the
   `CaseBoxDeadline` that then appears in the deadline list.
**Design must cover**: where a proposed-but-unconfirmed entry lives (it is not in the deadline
list until confirmed); the confirm affordance; how a freshly-confirmed deadline joins the
existing list while respecting the already-designed read-only urgency styling
(`dev-memo/design/2026-06-03-casebox-deadline-urgency.md`); success / error copy (e.g. a
foreign / unknown `entryId` confirm returns a safe `invalid_payload`).
**Expected deliverable file**: `dev-memo/design/<date>-casebox-deadline-create-confirm.md`
(Claude Design export).

## Out of scope (do NOT design or bundle)

- Fact review / accept / reject lifecycle.
- Evidence links / privilege / confidentiality.
- Deadline dismissal / edit.
- Reminders / notifications.
- Multi-step wizards (keep each flow a single in-section control like document-register).
- WeChat Mini Program (no repo source or design artifact exists; out of v1 scope).

## Gate status / what unblocks implementation

- This file is **design-source**, not an approved artifact. `check-ui-design-artifact.sh`
  explicitly does **not** treat `dev-memo/design-source/**` as an app-UI implementation path,
  and it is **not** a valid `Design artifact:` reference for a `Type: UI` queue block.
- Implementation unblocks **only** when Claude Design produces deliverables A and B as committed
  docs under `dev-memo/design/`, after which the proposed WIs (Add Fact UI + bridge; Add+Confirm
  Deadline UI + bridge) can carry a concrete `Design artifact:` line and pass the queue gate.
- Until then: no `renderer/**` change, no governed UI queue, no UI implementation.

## Stop condition

Retire / supersede this request once both `dev-memo/design/<date>-casebox-fact-create.md` and
`dev-memo/design/<date>-casebox-deadline-create-confirm.md` exist and are referenced by their
WIs. Stale if the backend write IPC contract changes before the designs land.
