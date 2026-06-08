# Design artifact — Renderer accessibility + pagination-safety polish

**WI**: WI-AP1 (ASSET) of `BATCH-CASEBOX-RENDERER-A11Y-POLISH-00`. **Date**: 2026-06-08.
**Status**: design artifact (authoritative for WI-AP2). Implementation-shaping, not a contract change.
**Scope**: renderer-only, **existing IPC only**. No contract / persistence / Electron / DTO / source-IPC change.

This artifact specifies the accessibility and pagination-safety polish that WI-AP2 implements in four
renderer screens:

- `apps/lawbar-desktop/renderer/screens/viewMatterDocuments.ts`
- `apps/lawbar-desktop/renderer/screens/viewMatterFacts.ts`
- `apps/lawbar-desktop/renderer/screens/viewMatterAudit.ts`
- `apps/lawbar-desktop/renderer/screens/viewMatterDeadlines.ts`

The canonical precedent for the pagination guard already exists in the codebase at
`apps/lawbar-desktop/renderer/screens/viewMatterDocketProposals.ts:95-100` — WI-AP2 mirrors it, it does
not invent a new pattern.

---

## 1. Show-more re-entrancy guard (documents, facts, audit)

### Problem
Each of the documents / facts / audit panels paginates via a `loadPage()` closure wired to a "Show more"
button's `click` handler. None of the three has an in-flight guard. A user who double-clicks "Show more"
(or clicks while the IPC round-trip is pending) triggers two concurrent `loadPage()` calls against the
same `cursor`, which **double-fetches the same page and double-appends its rows**. The docket-proposals
panel already solved this:

```ts
let pageLoading = false; // re-entrancy guard: a fast double-click must not append the same page twice
const loadPage = async (): Promise<void> => {
  if (pageLoading) return;       // a fetch is already in flight — drop the concurrent call
  pageLoading = true;
  try {
    env = await api.listX(dto);
  } finally {
    pageLoading = false;         // always clear, even on throw, so the next click works
  }
  // …append rows, re-attach Show-more…
};
```

### Required pattern (apply to all three)
- Declare a closure-scoped `let pageLoading = false;` alongside the existing `cursor` / `moreBtn` state.
- First statement of `loadPage()`: `if (pageLoading) return;` then `pageLoading = true;`.
- Wrap the `await api.list…(…)` IPC call in `try { … } finally { pageLoading = false; }` so the guard
  clears on success **and** on throw (a failed fetch must not permanently wedge pagination).
- The guard is per-panel/per-closure state; it must not be module-global (multiple matters / re-renders
  must each get their own guard).

### Per-file anchors
- **documents** (`viewMatterDocuments.ts`): `loadPage()` ~260-307; `api.listDocuments` ~265. Note it
  removes + recreates `moreBtn` each page — keep that; only add the guard around the fetch.
- **facts** (`viewMatterFacts.ts`): `loadPage()` ~458-507; `api.listFacts` ~463.
- **audit** (`viewMatterAudit.ts`): `loadPage()` ~305-350; `api.listAuditEvents` ~306; appends to the
  `<ol class="view-audit-list">`.

## 2. Button disabled / loading feedback while a page request is in flight

For the **audit** Show-more specifically, the transient in-flight state must be visible/guarded, not just
internally dropped:

- On entering `loadPage()` (after setting `pageLoading = true`), if the Show-more button is currently
  mounted, set `moreBtn.disabled = true` (or equivalent `aria-disabled` + `disabled` attribute) so a
  second click is both ignored (guard) **and** visibly suppressed.
- In the `finally`, restore the button to enabled before (or as part of) re-attaching it for the next page.
- This is required for audit (acceptance criteria call it out). Documents/facts get the same disabled
  treatment if it is mechanically free with the guard; the load-bearing requirement is the no-double-append
  guard for all three and the visible disabled state for audit.

## 3. aria-label assignments

Add a stable, human-readable `aria-label` to each of these controls (screen-reader naming; no visual change):

| Control | File / anchor | aria-label (intent) |
|---|---|---|
| Document-type `<select>` | `viewMatterDocuments.ts:98` (`view-docs-add-type`) | "Document type" |
| Add-document button | `viewMatterDocuments.ts` (`view-docs-add`) | "Add document" |
| Audit chain-head disclosure | `viewMatterAudit.ts:51` (`view-chain-summary` `<summary>`) | "Audit chain head details" |
| Audit Show-more button | `viewMatterAudit.ts:336` (`view-audit-more`) | "Show more audit events" |
| Copy-hash button | `viewMatterAudit.ts:112` (`view-chain-copy`) | "Copy chain-head hash" |

Exact label wording may be refined during impl; the requirement is that each control exposes a non-empty
`aria-label`. The add-document button already has visible text "Add document"; the `aria-label` makes the
accessible name explicit and stable against future text changes.

## 4. aria-live behavior

- **Appended audit list** (`viewMatterAudit.ts` `<ol class="view-audit-list">`): give the list (or its
  container) `aria-live="polite"` so newly appended audit rows are announced when "Show more" loads a page,
  without stealing focus.
- **Deadline urgency banner** (`viewMatterDeadlines.ts:643-655`): the banner already has `role="status"`;
  add an explicit `aria-live="polite"`. `role="status"` implies a polite live region, but explicit
  `aria-live` is the testable, unambiguous contract and avoids reliance on implicit role mapping. This is a
  **single-attribute** change — `viewMatterDeadlines.ts` is 745/800 pure LOC, so the edit must stay minimal.

## 5. Error / loading states must not wipe already-rendered rows

Pagination and any load/error feedback must be **additive**. Specifically:

- A failed `api.list…()` call (or an error envelope) must NOT clear previously rendered rows. The guard's
  `finally` clears `pageLoading`; the error path may surface an inline error node (the audit panel already
  has a `view-audit-error` alert) but must leave the existing list intact.
- The "Show more" flow appends; it never re-renders the whole list from scratch. The existing
  remove-and-recreate of the *Show-more button itself* is fine — that is the button, not the rows.

## 6. Non-goal — audit event labels are NOT humanized in this batch

The audit panel today renders raw `action · entity_type` (e.g. "update · deadline"). Humanizing this to
distinguish *met / missed / withdrawn* is **explicitly out of scope** and must not be attempted here,
because the audit `kind` is **not persisted**: the audit event entity stores only `action` + `entity_type`
(+ hashes / reason / open-index); `buildCaseBoxAuditEvent` maps the input `kind` to `{action, entity_type}`
and **drops the kind** at build time. The renderer therefore cannot recover the kind from existing IPC.
Humanized labels require storing the kind (or a derived label) on the hash-verified audit event — a
contract + persistence + ADR change — and belong in a separate future ADR-first batch, not WI-AP2.

---

## Acceptance (for WI-AP2)
Observable in the existing renderer test harness:
1. Rapid double-click on documents / facts / audit "Show more" → exactly one `api.list…` call and one page
   of rows appended (no double-fetch, no double-append).
2. Document-type select, add-document button, audit disclosure, audit Show-more, copy-hash → each exposes a
   non-empty `aria-label`.
3. Deadline urgency banner → `aria-live="polite"`.
4. Audit Show-more → `disabled` while a page load is in flight (test holds an unresolved api promise to
   observe the transient state, per the review-plan Medium finding).
5. `npm --prefix apps/lawbar-desktop test` passes; loc-guardian reports no over-limit file.
