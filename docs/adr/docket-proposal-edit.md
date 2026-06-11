# ADR — Docket proposal edit (content-only edit of a pending docket entry)

- **Status**: Accepted (cc-suite review-plan READY). Implementation authorized only via the downstream governed WIs DPE2..DPE5 (see §9); the contract layer ships in WI-DPE2.
- **Date**: 2026-06-08.
- **Deciders**: lawbar-tool maintainer.
- **Batch**: `BATCH-CASEBOX-DOCKET-PROPOSAL-EDIT-ADR-00`, WI-DPE1 (ADR-only; authorizes no implementation).
- **Relates to**: `docs/adr/case-box-step-6-deadline-docketing-rules.md` (the docket lifecycle ADR) and
  `docs/adr/audit-event-kind-preservation.md` (audit-event-kind v2 — `event_kind` is now persisted +
  hashed; the audit panel humanizes it via `renderer/screens/auditEventLabels.ts`).
- **Scope note**: This ADR records a decision. It changes no schema, contract, persistence, IPC,
  renderer, or test file. Every implied code change is deferred to separately-governed downstream WIs
  (see §9), contract-first.

---

## 1. Context

Today a docket proposal can only be **created**, **confirmed** (→ materializes a `CaseBoxDeadline`), or
**dismissed** — there is no way to *edit* a pending proposal. The current workaround is dismiss +
create-new, which severs the original entry's identity and provenance continuity.

Verified facts (discovery 2026-06-08):
- `confirmation_state` ∈ {`proposed`, `confirmed`, `dismissed`}; `ALLOWED_DOCKET_ENTRY_EDGES`
  (`transitions.ts`) permits only `proposed → confirmed` and `proposed → dismissed`;
  `confirmed`/`dismissed` are **terminal**. There is **no** `proposed → proposed` edit transition.
- A `proposed` entry is a **mutable single row** (the Step-6 ADR's stated design); the persistence
  `updateDocketEntryRow` already patches `payload_json` (+ lifted columns) in place for confirm/dismiss.
- **Confirm materializes from the CURRENT `payload_json`** (`buildDeadlineRowFromDocketEntry` copies
  `proposed_kind`/`proposed_due_at`/`proposed_owner_user_id`/…) — so an edited proposal confirms
  correctly with **no confirm-path change**.
- Audit kinds for docket: `DOCKET_ENTRY_PROPOSED` (create), `DOCKET_ENTRY_CONFIRMED` (update),
  `DOCKET_ENTRY_DISMISSED` (update, reason-required). **No edit/revise kind.**

The feature is therefore structurally supported but needs additive surfaces across contract (a new
audit kind + an optional field), persistence (an edit op, no migration), IPC, and UI.

## 2. Decision — product semantics

1. **Only `proposed` docket entries are editable.** `confirmed` and `dismissed` are terminal and
   **immutable through this flow** — the edit operation rejects any non-`proposed` entry with an
   `illegal_transition` error (mirroring how dismiss/confirm already reject terminal entries).
2. **Editing is content-only, not provenance-editing** (see §3/§4). The edit refines the *lawyer's
   proposed deadline values*; it never rewrites where the proposal came from.
3. **Confirm-after-edit confirms the current edited proposal**, not the stale original — guaranteed by
   the existing read-current-`payload_json` confirm path; **no change to confirm** is required.
4. The state stays `proposed` across an edit (an edit is a `proposed → proposed` in-place revision, not
   a lifecycle transition); confirmed/dismissed records are never touched.

## 3. Editable fields (the proposed deadline content)

`proposed_kind`, `proposed_due_at`, `proposed_due_at_kind`, `proposed_due_at_timezone`,
`proposed_owner_user_id`, `reminder_offsets`.

(An edit that sets `proposed_due_at_kind = "datetime"` must supply a valid `proposed_due_at_timezone`
per the existing schema conditional D7 + `assertValidIanaTimezone`. The existing v1 rule — **`date_only`
entries CANNOT be confirmed** (`assertValidDocketEntryConfirmation`) — applies unchanged at confirm
time: an entry that is `date_only` (whether originally or after an edit) **stays confirm-blocked** until
upgraded to `datetime` + a valid IANA timezone. **DPE5 (UI) MUST NOT present "edit then confirm" as a
single valid action for a `date_only` entry** — the confirm affordance stays disabled/blocked, with the
"upgrade to datetime + timezone" path being the way to make it confirmable. An edit is allowed to
*upgrade* `date_only → datetime` (supplying a timezone), which then unblocks confirmation; downgrading or
staying `date_only` keeps confirm blocked.)

## 4. Immutable provenance / lifecycle fields

Editing any of these is **forbidden** (overwriting provenance would falsify the source record — a hard
stop): `source_type`, `extractor_name`, `extractor_version`, `extraction_confidence`,
`source_document_id`, `source_page_number`, `source_excerpt`, `source_rule_citation`; all identity
fields (`id`, `tenant_id`, `matter_id`, `actor_user_id`); all lifecycle fields (`confirmation_state`,
`proposed_at`, `created_at`); and all confirmation/dismissal fields (`confirmation_actor_user_id`,
`confirmed_at`, `confirmed_deadline_id`, `dismissal_actor_user_id`, `dismissed_at`, `dismissal_reason`).

A new `assertValidDocketEntryEdit` (downstream, contract WI) enforces: the entry is `proposed`; only
the §3 fields differ between prior and revised; every §4 field is byte-identical; the revised entry is
schema-valid.

**Operational consequence of an immutable `source_rule_citation`** (review clarification): on confirm,
`buildDeadlineRowFromDocketEntry` copies `source_rule_citation` into the materialized
`CaseBoxDeadline`. Because edit cannot change `source_rule_citation`, a proposal whose **legal source /
rule basis is wrong** CANNOT be corrected by editing — the lawyer must **dismiss + create a new
proposal** (or a future supersession flow) with the correct citation. Editing is for refining the
*scheduling content* (kind/date/owner/reminders) of a correctly-sourced proposal, NOT for re-attributing
its legal basis. The UI (DPE5) should make clear that edit changes the proposed deadline content, not
its source.

## 5. Audit strategy — `DOCKET_ENTRY_REVISED`

- Add a new audit kind **`DOCKET_ENTRY_REVISED`** to `CASE_BOX_AUDIT_EVENT_KINDS`:
  `{ action: "update", entity_type: "docket_entry", reasonRequired: false }`.
- **`reasonRequired: false`** — rationale: an edit refines the lawyer's **own pending, non-binding
  draft**; it is not a rejection (dismiss requires a reason for the legal trail; confirm does not). A
  reason adds friction without a legal need at the proposal stage. (Downstream may pass an optional
  reason; it is not required.)
- **Auditability is hash-based.** The `DOCKET_ENTRY_REVISED` event records `before_state_hash` (the
  prior `proposed` entry's state hash) and `after_state_hash` (the revised entry's), making each
  revision tamper-evident — and, because the v2 work hashes `event_kind`, the revision kind itself is
  part of the chain. **Do NOT store full literal before/after values.** Rationale: the prior draft was
  never confirmed (never legally binding); the audit chain proves *that* a revision occurred and that
  the current proposal is the edited one. Storing a full revision history of an unconfirmed draft is
  disproportionate. (If a future requirement needs literal revision history — e.g. a regulator demands
  the original machine extraction be queryable — that is a separate, explicitly-justified WI; the
  immutable `source_*`/`extractor_*` fields already preserve the original *extraction* context.)

## 6. Edited-state visibility — optional `revised_at`

- Add an **OPTIONAL** `revised_at` (nullable ISO-8601 date-time) to `case-box-docket-entry.schema.json`,
  set to the edit timestamp on each revision; null on never-edited entries.
- The UI shows an **"(edited)"** marker/badge on a row whose `revised_at` is present.
- Original provenance (`source_type`, `extractor_*`) stays visible and immutable, so a reader can
  distinguish **machine-suggested** (`source_type = llm_extraction`, no `revised_at`) from
  **user-edited** (`revised_at` present) content.
- `revised_at` rides `payload_json` (no lifted column, no index) — see §7.

## 7. Persistence stance — no migration

- The edit is an **in-place `UPDATE`** on a `proposed` row, in the spirit of the existing
  `updateDocketEntryRow` pattern. **Caveat (review clarification):** the current `updateDocketEntryRow`
  helper updates only `confirmation_state`, `confirmed_deadline_id`, and `payload_json` — it does **not**
  touch the lifted `proposed_kind` column. So DPE3 must either **extend the helper** or add an
  **edit-specific UPDATE** that also patches the lifted `proposed_kind` when `proposed_kind` changes, and
  DPE3 MUST test **lifted-column ↔ `payload_json` consistency** after an edit (the lifted `proposed_kind`
  must always equal `payload_json.proposed_kind`, since `listDocketEntries` filters on the lifted column).
  `confirmation_state` stays `proposed`. `revised_at` lives only in `payload_json` (no new column/index).
- **No schema migration is expected.** If a downstream reviewer proves a new lifted/indexed column is
  genuinely needed (e.g. to filter/sort by revised state), that is **STOP-and-split into a separate,
  explicitly-governed migration WI** with migration tests — never folded silently into the edit op.

## 8. Cross-package coupling (renderer label sync)

Adding `DOCKET_ENTRY_REVISED` to the contract audit-kind enum makes the renderer
`auditEventLabels.ts` `EVENT_KIND_LABELS` map **out of sync** with `CASE_BOX_AUDIT_EVENT_KINDS`, which
the shipped `renderer-audit-labels.test.mjs` sync test would catch (it asserts the map covers exactly
the contract keys). **Decision: the single renderer-label line `DOCKET_ENTRY_REVISED: "Docket proposal
revised"` lands in the CONTRACT WI (DPE2), alongside the kind**, so the contract change and its
mandatory label stay atomic and the sync test never goes red between WIs. DPE2's allowed files
therefore include `apps/lawbar-desktop/renderer/screens/auditEventLabels.ts` + its test, scoped to that
one label entry only. (The fuller audit-panel UX for the revised kind, if any, remains in the UI batch.)

## 9. Downstream WI breakdown (post-acceptance; NOT authorized by this ADR)

- **DPE2 — SOURCE (contract, high-risk, security-WI loop):** add `DOCKET_ENTRY_REVISED` to the kinds map
  + the `case-box-audit-event.schema.json` `event_kind` enum (regen type); add optional `revised_at` to
  `case-box-docket-entry.schema.json` (regen type); add `assertValidDocketEntryEdit` (content-only,
  provenance-immutable, proposed-only) + export; the one `auditEventLabels` line (§8); contract tests
  (edit-valid, provenance-edit-rejected, kind present, label sync green, v1 golden + v2 canonical
  unchanged). **Stop after for study** (contract/audit-chain change).
- **DPE3 — SOURCE (persistence, no migration):** `editDocketEntry` (in-memory + sqlite): proposed-only
  guard, content patch, `revised_at` set, `DOCKET_ENTRY_REVISED` emission; conformance + impl-parity +
  edit-then-confirm-materializes-edited tests.
- **DPE4 — IMPL (IPC/DTO):** `EditDocketEntryDto` + DTO/forbidden-field lists (strip
  authority/provenance/lifecycle), `editDocketEntryHandler` (scoped preflight, proposed-only,
  projection through `DOCKET_ENTRY_RESPONSE_FIELDS` + `revised_at`), `casebox:docket:edit` channel,
  preload + main wiring; projection tests.
- **DPE5 — UI:** edit affordance in `viewMatterDocketProposals.ts` (mirror the dismiss two-step reveal +
  the add-deadline input pattern), "(edited)" badge, validation/disabled states; renderer tests.

## 10. Required cc-suite review

> This idea is not authorized for implementation until:
> 1. This ADR is reviewed via `/cc-suite:review-plan` and returns READY (or only Low-risk clarifications).
> 2. DPE2 (the contract change) is its own governed WI through the full review-plan → tests-first →
>    audit → verify security-WI loop (a new audit-event kind is a contract/security-boundary change).
> 3. Each downstream WI passes its declared gates + cc-suite audit/verify before commit.

## 11. Hard stops

- Any mutation of a `confirmed` or `dismissed` entry.
- Any overwrite of a provenance field (§4) — provenance is immutable.
- Any ambiguity in confirmation semantics (confirm-after-edit MUST confirm the edited proposal).
- Any persistence migration that is not separately, explicitly governed (split into a migration WI).
- Any expansion into reminders/scheduling, audit filtering/search, event-kind UX polish, or workflow
  Low-finding cleanup.

## Consequences

- **Positive**: a lawyer can correct a machine-suggested or mistyped pending proposal in place,
  preserving its identity + provenance + audit continuity, then confirm the corrected deadline — instead
  of the lossy dismiss-and-recreate workaround. Auditability and confirmation/terminal-state integrity
  are preserved.
- **Negative / cost**: a new audit kind is a contract/security-boundary change (full DPE2 governance),
  and it ripples one mandatory renderer-label line; a 4-WI downstream implementation.
- **Follow-up**: literal revision history (if ever required by a regulator) and any indexed
  revised-state filtering remain explicitly-justified future WIs, not part of this design.

## Stop condition

Promoted to the downstream WIs (DPE2 first, contract-governed). This ADR is retired/​superseded only by
a later ADR that changes the docket edit policy.
