# Design artifact — Add a fact to a matter (claims / timeline write)

**Date**: 2026-06-05.
**WI (suggested)**: `PRODUCT(ui+bridge): add fact to a matter` (case-box facts vertical — the
write/create path; read path shipped in B6 fact read surface).
**Type**: UI (write). Manual-merge (renderer UI + renderer IPC bridge wiring). No new
main-process handler — `casebox:fact:create` already exists on `ipcMain` (WI-602, PR #52).
**Surface**: an "Add fact" control inside the existing Facts disclosure of the matter view
(`renderer/screens/viewMatterFacts.ts`). No new screen / route / modal / wizard.
**Grounds**: backend handler `createFactHandler` (`src/caseBox/factHandlers.ts`) +
`CreateFactDto` / `CREATE_FACT_RESPONSE_FIELDS` (`src/caseBox/dto.ts`); contract
`case-box-fact.schema.json` (R-5 `purpose` / `as_of_date`); precedent design
`dev-memo/design/2026-06-03-casebox-document-register.md` + code precedent
`viewMatterDocuments.ts renderAddControl`.

## Problem

The Facts section is read-only (`renderFactsDisclosure` → `loadFacts`): it shows "No facts
recorded for this matter." until facts can be added, but there is no way to add one. A lawyer
cannot record a claim, defense, or timeline event. The backend write channel
`casebox:fact:create` is live but unreachable — the renderer bridge (`electron/preload.mts`
whitelist + `renderer/api.ts`) does not expose it. This slice lets a lawyer **add one
manual fact to a matter** so the read surface becomes useful.

## Smallest safe vertical slice

Lawyer types a `statement_text` (and optionally chooses a `purpose`, and — only for a
timeline event — an `as_of_date`) → renderer calls `casebox:fact:create` with just those
fields → main injects identity / status / provenance and persists a `candidate`
lawyer-authored fact → the Facts list refreshes in place and shows it. One in-section control,
exactly like "Add document".

Nothing else: no review/accept/reject, no evidence/document linking, no edit, no delete.

## IPC contract (existing channel — consume, do not change)

```
casebox:fact:create   CreateFactDto { matterId: string;
                                       statement_text: string;        // required, non-empty
                                       purpose?: FactPurpose;         // optional R-5 enum
                                       as_of_date?: string }          // optional, date-only YYYY-MM-DD
                       -> IpcEnvelope<RendererCreatedFactRow>          // candidate, lawyer_authored
```

- `FactPurpose` ∈ { `claim`, `defense`, `counterclaim`, `timeline_event`, `work_order_result`,
  `consultation_q`, `consultation_a`, `other` }. Absent ⇒ persistence defaults to `other`.
- `as_of_date` rules are **server-enforced** (the UI mirrors them, never re-implements them):
  (a) FORMAT — whenever supplied, must match `^\d{4}-\d{2}-\d{2}$` (date-only, no time); (b)
  REQUIREDNESS — required non-empty when `purpose === "timeline_event"`. A violation returns
  `invalid_payload`.
- Server injects every authority / status / provenance field (`id`, `tenant_id`,
  `actor_user_id`, `matter_id`, `status: "candidate"`, `source_type: "lawyer_authored"`, all
  `source_*` / `extractor_*` / `reviewer_*` / review fields `null`, `created_at`). These are
  **forbidden in the DTO** → `invalid_payload`. The renderer never supplies them.
- The response is already projected to a renderer-safe allowlist (authority identities
  stripped); the created fact comes back with `status: "candidate"`.

### Renderer bridge wiring (part of this WI)

`electron/preload.mts` adds `createFact: (dto) => ipcRenderer.invoke("casebox:fact:create", dto)`;
`renderer/api.ts` adds `createFact` to `CaseBoxClient` + `CaseBoxApi` and wires it through
`createCaseBoxApi` with a `RENDERER_CREATE_FACT_DTO_FIELDS` strip-allowlist (`matterId`,
`statement_text`, `purpose`, `as_of_date`) — mirroring `registerDocument`'s
`stripDtoFields(...)`. `preload.mts` is under `electron/`, not `renderer/`, so it is not
design-gated; `renderer/api.ts` is.

## UI

The Facts disclosure gains one **in-section** "Add fact" control above the list (sibling of
the `view-facts-list`), built with `el()` / `textContent` only — never `innerHTML`. Proposed
elements + test ids (mirroring the `view-docs-add-*` family):

- `view-facts-add-control` — wrapper `div`.
- `view-facts-add-statement` — a `<textarea>` for `statement_text` (multi-line; placeholder
  "Statement of fact"). Required.
- `view-facts-add-purpose` — a `<select>` over the 8 `FactPurpose` values (default `other`).
- `view-facts-add-asof` — a date `<input type="date">` for `as_of_date`, **hidden by default**;
  revealed (and marked required, `aria-required="true"`) only when
  `view-facts-add-purpose` value is `timeline_event` (a `change` listener toggles the `hidden`
  attribute). Mirrors the server's conditional rule; the server remains the validator.
- `view-facts-add` — the "Add fact" `<button type="button">`.
- `view-facts-add-status` — a `<span>` status line.

**Flow** (mirror `renderAddControl`): click → button `disabled` + status "Adding…" (role
cleared) → `api.createFact({ matterId, statement_text, purpose, ...(as_of_date when set) })`
→ button re-enabled → on success status "Added." + the list refreshes in place (re-run the
existing `loadFacts` against a cleared body, exactly as documents refresh) → the new
`candidate` fact appears via the existing `renderFactRow`.

### Error / success states

| Condition | UI |
|---|---|
| Success | status `textContent = "Added."`; list refreshes; inputs may be cleared. |
| Empty `statement_text` (client pre-check) OR server `invalid_payload` | status gets `role="alert"` + `data-test-id="view-facts-add-error"`, `textContent = env.error.message` (safe server copy); no refresh. |
| `unknown_matter` / `tenant_mismatch` | same inline `role="alert"` path with the server message. |
| `timeline_event` without `as_of_date` | server returns `invalid_payload`; surfaced inline. The conditional reveal makes this rare, but the server is authoritative. |
| In flight | button `disabled`, status "Adding…", `role` removed so it is not announced as an alert. |

No envelope error ever throws to the console; every `!env.ok` renders inline (consistent with
`loadFacts`' existing `view-facts-error`).

## Accessibility notes

- Error status uses `role="alert"` only when an error is shown (set on failure, removed while
  loading) — matches the read surface's `view-facts-error` and the document Add control.
- The `as_of_date` input, when revealed, is `aria-required="true"`; when hidden it carries the
  `hidden` attribute (removed from the a11y tree), so a screen reader never sees an
  irrelevant date field for non-timeline purposes.
- Each control has an associated visible `<label>` (or `aria-label`) — `statement_text`,
  `purpose`, `as_of_date`. The button has a discernible name ("Add fact").
- Keyboard: the control is plain form elements in DOM order (textarea → select → [date] →
  button); no focus trap, no custom widget. The disclosure remains a native `<details>`.
- Color is not the only signal: success/error is conveyed by text + `role`, not color alone
  (defers to the existing token palette; `ui-tokenize` enforces tokens at implement time).

## Tests / acceptance (testable)

Renderer unit tests (extend `tests/renderer-view-matter.test.mjs`; bridge in
`tests/renderer-api.test.mjs` + `tests/renderer-dto-sync.test.mjs`), using the existing
`_view-matter-dom.mjs` harness + a mock `CaseBoxApi`:

1. **Add success** — `createFact` resolves `ok` → status shows "Added." and `listFacts` is
   re-invoked (list refreshes); the new candidate row renders.
2. **Conditional reveal** — selecting `purpose = timeline_event` un-hides `view-facts-add-asof`
   and sets `aria-required`; selecting any other purpose re-hides it.
3. **timeline_event missing as_of_date** — mock returns `invalid_payload` → inline
   `role="alert"` `view-facts-add-error`, no refresh.
4. **Empty statement** — client pre-check (or server `invalid_payload`) → inline alert, no
   `createFact` call (client pre-check) / no refresh.
5. **Server boundary** — `unknown_matter` / `tenant_mismatch` envelope → inline alert with the
   server message; never the raw matter id.
6. **DTO strip** — `createFact` only forwards `matterId` / `statement_text` / `purpose` /
   `as_of_date` (renderer allowlist); any extra key is dropped before invoke
   (`renderer-dto-sync` parity with `CREATE_FACT_DTO_FIELDS`).
7. **Safe DOM** — no `innerHTML`; all text via `el()` / `textContent` (covered by the existing
   no-hardcoded / import-shape checks + review).

Gate: `npm --prefix apps/lawbar-desktop test`.

## Out of scope (not bundled)

Fact review / accept / reject lifecycle; evidence / document linking; privilege /
confidentiality; fact edit / delete / supersession; bulk import; OCR-extracted facts; status or
purpose list filters; multi-step wizards or modals; WeChat Mini Program. All deferred.

## Stop condition

Retire when the Add-fact WI ships (referencing this artifact as its `Design artifact:`) and the
acceptance tests above are green. Stale if the `casebox:fact:create` DTO contract changes
before the WI lands.
