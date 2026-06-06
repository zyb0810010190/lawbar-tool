# Design artifact — Review a fact (review / accept / reject lifecycle)

**Date**: 2026-06-05.
**WI (target)**: `PRODUCT(ui+bridge): fact review controls + status rendering` (BATCH-CASEBOX-FACT-REVIEW-00, WI-804 — the renderer half; the transition IPC shipped in WI-802).
**Type**: UI (write). Manual-merge (renderer UI + renderer IPC bridge wiring). No new main-process handler — `casebox:fact:transition` already exists on `ipcMain` (WI-802, PR #57).
**Surface**: per-fact Review / Accept / Reject controls + review-state rendering inside the existing Facts disclosure of the matter view (`renderer/screens/viewMatterFacts.ts`). No new screen / route / modal / wizard.
**Grounds**: backend handler `transitionFactHandler` (`src/caseBox/factHandlers.ts`, WI-802) + `TransitionFactDto` / `TRANSITION_FACT_RESPONSE_FIELDS` (`src/caseBox/dto.ts`); persistence `transitionFact` + the contract status enum (`case-box-fact.schema.json`: `candidate|reviewed|accepted|rejected`); ADR `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` (no auto-accept); precedent designs `dev-memo/design/2026-06-05-casebox-fact-create.md` + `…-casebox-deadline-create-confirm.md`; code precedent `viewMatterDocuments.ts renderAddControl`.

## Problem

The Facts section lists facts (each created as a `candidate`, WI-602/701) but a lawyer cannot **act on** them — there is no way to mark a candidate fact reviewed, accept a reviewed fact, or reject a fact with a reason. The transition channel `casebox:fact:transition` is live (WI-802) but unreachable from the renderer (the bridge does not expose it, and the fact rows do not render review state). This slice lets a lawyer **move a fact through its review lifecycle** from the matter view.

## Smallest safe vertical slice

For each fact row, surface the transitions that are legal **from its current status**, plus render the current status clearly. Clicking a transition calls `casebox:fact:transition`; on success the facts list refreshes in place and the row shows its new status. One in-section control per row, mirroring the document-register / add-fact control shape.

## 1. Matter-view placement for the review controls

- The controls live on each fact row inside the existing **Facts disclosure** (`renderFactsDisclosure` → the per-row `renderFactRow`), NOT a new screen/modal. The WI-701 "Add fact" control stays above the list; review controls are per row, below each fact's statement/meta.
- Reuse the WI-701 `listContainer` + `runLoad`/`loadGen` structure so a successful transition refreshes the list in place (and the stale-load guard already added there applies).

## 2. Per-fact status rendering (candidate / reviewed / accepted / rejected)

Each row renders a status pill/label driven by the fact's `status` (already in the list response). Convey status by **text first** (never color alone):

- `candidate` — "Candidate" (neutral). Shows the Review and Reject actions.
- `reviewed` — "Reviewed" + the reviewed timestamp (`reviewed_at`). Shows the Accept and Reject actions.
- `accepted` — "Accepted" + `accepted_at`. Terminal in v1 — no further actions.
- `rejected` — "Rejected" + `rejected_at` + the `rejection_reason` text. Terminal in v1 — no further actions.

The data needed (`status`, `reviewed_at`, `accepted_at`, `rejected_at`, `rejection_reason`) is ALREADY in `LIST_FACTS_RESPONSE_FIELDS`; this slice only widens the renderer's `FactRow` display, no IPC change for reading. Use a per-status CSS class (token-driven) plus a `data-status` attribute and visible label so status is not color-only.

## 3. Review / Accept / Reject interaction model (legal edges only)

The handler/persistence enforce the state machine; the UI offers only the legal `to` for the current status (and must not offer an illegal one):

| Current status | Offered actions (`to`) |
|---|---|
| `candidate` | **Review** (`→ reviewed`), **Reject** (`→ rejected`) |
| `reviewed`  | **Accept** (`→ accepted`), **Reject** (`→ rejected`) |
| `accepted`  | none (terminal) |
| `rejected`  | none (terminal) |

There is **no `candidate → accepted` shortcut** — Accept is offered only on a `reviewed` fact (the contract/ADR bans auto-accept; the server returns `illegal_transition` if it is ever attempted, which the UI surfaces as an inline error). `candidate → rejected` IS offered (a candidate may be rejected without first being reviewed).

## 4. Rejection-reason UX

- **Reject** reveals a required `rejection_reason` text input (a small inline field or a compact confirm row on the row), then a "Confirm reject" action. The DTO is built with `to: "rejected"` + the non-empty `rejection_reason`.
- `rejection_reason` is **required** for reject: an empty/whitespace reason renders an inline `role="alert"` error and does NOT call the channel (client precheck; the server also enforces it → `invalid_payload`).
- `rejection_reason` is **never sent** for non-reject transitions (Review / Accept). The DTO for those is `{ matterId, factId, to }` with no `rejection_reason` key (the server rejects a `rejection_reason` supplied for a non-rejected `to` with `invalid_payload`; the UI must not send it).

## 5. Loading / error / stale-request behavior

Mirror the WI-701 add-fact control:
- On click: disable the row's action buttons + show a transient "…ing" status; wrap the call + refresh in `try/catch/finally` (finally re-enables the buttons; catch shows a generic inline `role="alert"`).
- On `ok`: the facts list refreshes **in place** (re-run `loadFacts` against the `listContainer`; the `loadGen`/`isCurrent` stale-load guard ensures a superseded load cannot mutate the refreshed list); the row reflects the new status.
- On `!ok`: an inline `role="alert"` carries the server's safe message (e.g. `illegal_transition`, `invalid_payload`, `unknown_matter`, `tenant_mismatch`) — never a raw id; the list is NOT refreshed.

## 6. Accessibility

- Every action is a real `<button>` with a discernible name ("Review", "Accept", "Reject", "Confirm reject") and is keyboard reachable in DOM order; no custom widgets, no focus trap; the disclosure stays a native `<details>`.
- The rejection-reason input has an associated visible `<label>` / `aria-label`; when revealed it is `aria-required="true"`, and is removed from the a11y tree (`hidden`) when not rejecting.
- Status is conveyed by **visible text** (the status label + timestamp + rejection reason), not color alone; the status element carries `data-status` for testability.
- Inline errors use `role="alert"` only when shown; in-flight status text has its `role` removed so it is not announced as an alert.
- Disabled/pending state: action buttons get the `disabled` attribute while a transition is in flight (a practical pending announcement); the status text updates to "…ing" then the terminal copy.

## 7. Safety / authority boundary

- The renderer forwards ONLY `{ matterId, factId, to, rejection_reason? }`. The bridge (`renderer/api.ts` + `RENDERER_TRANSITION_FACT_DTO_FIELDS`, parity-checked by `renderer-dto-sync`) strips any other key.
- The server / main process INJECTS `reviewer_actor_user_id` (active actor) + the `at` timestamp and computes the lifecycle fields (`status`, `reviewed_at`, `accepted_at`, `rejected_at`). The renderer MUST NOT supply reviewer actor, timestamps, status, `*_at`, `supersedes_fact_id`, `tenant_id`, or `actor_user_id` (the WI-802 handler rejects them as `invalid_payload`).
- The response is projected through `TRANSITION_FACT_RESPONSE_FIELDS` (authority identities stripped); the renderer renders only non-authority fields.

## 8. Test expectations for WI-804

- **Bridge strip/forward** (`renderer-api.test.mjs`): `transitionFact` forwards only the allowlisted fields; smuggled authority/lifecycle keys are dropped before invoke.
- **DTO parity** (`renderer-dto-sync.test.mjs`): `RENDERER_TRANSITION_FACT_DTO_FIELDS` ↔ `TRANSITION_FACT_DTO_FIELDS` field sets are equal.
- **Browser-faithful UI tests in a NEW dedicated file** `tests/renderer-fact-review.test.mjs` (mirroring `renderer-deadline-write.test.mjs` / `renderer-fact-write.test.mjs`): per-status the correct actions render (and illegal ones do NOT — e.g. no Accept on a candidate, no actions on accepted/rejected); Review/Accept transition success refreshes the list in place; Reject requires a non-empty reason (empty → inline error, channel NOT called) and never sends `rejection_reason` for non-reject; a backend `illegal_transition`/`invalid_payload` envelope renders inline `role="alert"` with no refresh; a stale superseded load cannot mutate the refreshed list; status text is present and not color-only (assert the visible label + `data-status`).
- **Do NOT modify `renderer-view-matter.test.mjs`** (it is at the loc-guardian 1200-LOC margin from the WI-704 split — keep it untouched; the new review tests go in the dedicated file). Wire the new test file into the `package.json` `test` script.

## Out of scope (not bundled)

Fact supersession (`supersedes_fact_id`) / replace-on-accept; un-reject / re-open of a terminal fact; bulk review; evidence/privilege linkage; review history / audit timeline rendering (the audit chain is a separate surface); filtering the fact list by status; the `reviewed → reviewed` no-op. All deferred.

## Stop condition

Retire when the WI-804 review-UI WI ships (referencing this artifact as its `Design artifact:`) and the acceptance tests above are green. Stale if the `casebox:fact:transition` DTO contract changes before WI-804 lands.
