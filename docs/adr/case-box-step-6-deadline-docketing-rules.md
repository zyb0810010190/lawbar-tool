# ADR: Case-Box Step 6 — Deadline / Docketing Rules

## Status

**Accepted** — 2026-05-20. Implements ADR-series Step 6 per `docs/adr/case-box-step-0-boundary.md`. Co-committed with `CaseBoxDocketEntry` entity, helpers, and tiny additive Step-4 schema change. Planning record: `dev-memo/plan-case-box-step-6.md` (revised four times through plan-review threads `019e47e0`, `019e47ed`, `019e47f5`, `019e47fc`, verified `019e4802`).

This WI ships the **contract layer only**. Runtime no-auto-confirm safety awaits the future `case-box-persistence` WI; this ADR documents that explicitly.

## Context

Step 1 shipped `CaseBoxDeadline` with `due_at: date-time`, `status: pending|met|missed|withdrawn`, and a `missed→met` reason invariant. The Step-1 schema has NO provenance, NO confirmation lifecycle, and NO timezone / date-only semantics. A machine-extracted deadline (LLM reading a court order, OCR excerpt parsing) could be written directly as `pending` — bypassing any human-confirmation rule. Date_only deadlines (e.g., "must file on June 15") would be silently fabricated into a UTC midnight datetime.

Step 6 closes both gaps WITHOUT touching the Step-1 deadline schema. The chosen approach:

1. **Add `CaseBoxDocketEntry`** — companion entity carrying provenance + confirmation lifecycle + authoritative date semantics.
2. **Treat `CaseBoxDeadline` as a materialized-view projection** — confirmed docket entries materialize a `CaseBoxDeadline` row, but the docket entry remains the authoritative source for date-only / timezone semantics.
3. **Tiny additive Step-4 schema change** — `case-box-audit-event.schema.json` `entity_type` enum gains `"docket_entry"`.

Codex plan-review surfaced four rounds of findings (MAJOR GAPS → NEEDS REVISION → NEEDS REVISION → READY). Major fixes accumulated across rounds: split confirmation-specific helper (`assertValidDocketEntryConfirmation`) from generic transition helper; D-proposed schema invariant; direct-confirm path removed; `DEADLINE_CONTINUED` audit kind deferred; strict IANA validator with `Intl.supportedValuesOf` + denylist-first; reminder_offsets nested schema pinned; raw `CaseBoxDeadline` insertion banned in v1; mapping-coverage drift guard; date_only confirmation forbidden in v1.

## Decision

### 1. New entity — `CaseBoxDocketEntry`

Companion to `CaseBoxDeadline`. Mutable single row (matches Step-3 PrivilegeMarker precedent). Required fields (every one explicitly nullable-or-required to avoid Ajv strictRequired warnings):

- `id`, `tenant_id`, `actor_user_id`, `matter_id`, `proposed_at`, `created_at` — standard provenance.
- `source_type` — `manual | court_order_excerpt | llm_extraction | imported`.
- `proposed_kind` — same vocabulary as Step-1 `CaseBoxDeadline.kind`.
- `proposed_due_at` — ISO date-time string.
- `proposed_due_at_kind` — `datetime | date_only`. Load-bearing for v1 confirmation gate.
- `proposed_due_at_timezone` — IANA timezone string (semantic validity enforced by helper); D7 schema requires non-null when `proposed_due_at_kind === "datetime"`.
- `proposed_owner_user_id` — who owns the deadline.
- `source_rule_citation`, `extractor_name`, `extractor_version`, `extraction_confidence`, `source_document_id`, `source_page_number`, `source_excerpt` — provenance per source_type (D1–D4).
- `reminder_offsets` — array of `{offset_days: integer 0..3650, kind: "advance_notice" | "final_notice"}` (maxItems 32), or null. Shape-only; no v1 notification execution.
- `confirmation_state` — `proposed | confirmed | dismissed`. ALL entries start `proposed`.
- `confirmation_actor_user_id`, `confirmed_at`, `confirmed_deadline_id` — set on Mode B; D5 requires non-null when confirmed; null when proposed/dismissed.
- `dismissal_actor_user_id`, `dismissed_at`, `dismissal_reason` — set on Mode C; D6 requires non-null + non-empty when dismissed; null otherwise.

Schema invariants D-proposed + D1..D7 enforce structural integrity. `additionalProperties: false`.

### 2. CaseBoxDeadline becomes a materialized-view projection

Step-1 `CaseBoxDeadline` schema is UNCHANGED. After Step 6, it carries the resolved `due_at` instant + `status` lifecycle (`pending → met / missed / withdrawn`). It is NOT authoritative for date-only semantics, timezone, or extraction provenance — those live on the referenced docket entry.

Consumers needing legal date semantics MUST query the docket entry. Future calendar / notification / sync features MUST go through this read path.

### 3. No direct-confirm path; ALL entries start proposed

The original draft allowed `manual` source to start directly in `confirmed`. Plan-review (round 2) rejected this: it created a `confirmed_deadline_id` chicken-and-egg problem AND conflicted with the no-auto-confirm posture. Resolution:

- Every source MUST be created in `confirmation_state = "proposed"`.
- Confirmation happens via a separate `proposed → confirmed` transition (Mode B).
- Persistence MAY bundle creation + confirmation in one transaction for UX (a manual-only convenience API) but the contract sees two lifecycle steps.

### 4. Two specialized transition helpers — confirmation is its own API

To eliminate the optional-`entry?` parameter ambiguity (plan-review round 3):

- **`assertValidDocketEntryTransition(from, to, controlled_by, reason?)`** — generic state-machine check. Used for `proposed → dismissed` (Mode C). Does NOT take an entry; does NOT perform the date_only check.
- **`assertValidDocketEntryConfirmation(entry, controlled_by)`** — confirmation-specific. REQUIRES the full entry. Performs the state-machine check AND the v1 date_only-forbidden rule. There is NO API path that allows confirmation without passing the full entry.

### 5. v1 forbids date_only confirmation

`assertValidDocketEntryConfirmation` throws `DocketEntryConfirmationError` if `entry.proposed_due_at_kind === "date_only"`. Reason: v1 has no jurisdiction / court-rule timezone resolver; confirming a date_only entry into `CaseBoxDeadline.due_at` (required date-time instant) would silently fabricate a UTC midnight, which is unsafe. To confirm a date_only-conceived deadline, the lawyer MUST upgrade to `datetime` + supply an IANA timezone.

Date_only entries may exist indefinitely in state `proposed`, or be `dismissed`. They CANNOT be `confirmed` in v1.

### 6. Three transaction modes — Mode A propose / Mode B confirm / Mode C dismiss

**Mode A (Propose):** INSERT docket entry; emit `DOCKET_ENTRY_PROPOSED`. No `CaseBoxDeadline` materialized.

**Mode B (Confirm):** Triggered by lawyer confirmation of an existing proposed entry.

1. Preflight idempotency check: if entry is already `confirmed` with a `confirmed_deadline_id` that resolves to an existing `CaseBoxDeadline` row (regardless of that deadline's `status` — pending, met, missed, OR withdrawn all count as "valid materialization"), return existing materialization and emit NO audit.
2. Call `assertValidDocketEntryConfirmation(entry, "lawyer")` — throws on date_only.
3. Persistence preallocates the `CaseBoxDeadline` ULID.
4. UPDATE docket entry to `confirmation_state="confirmed"`, populate confirmation fields with the preallocated ULID; emit `DOCKET_ENTRY_CONFIRMED`.
5. INSERT `CaseBoxDeadline` per the §7 mapping table; emit `DEADLINE_REGISTERED` (existing Step-4 kind).

Steps 4 + 5 are atomic — both commit or both roll back.

**Mode C (Dismiss):** UPDATE docket entry to `dismissed` with non-empty `dismissal_reason`; emit `DOCKET_ENTRY_DISMISSED`. Audit event's `reason` field MUST equal `docketEntry.dismissal_reason`.

**Manual convenience API:** Persistence MAY expose `createAndConfirmManualDocketEntry` bundling Mode A + Mode B in one transaction. ONLY for `source_type === "manual"`. Persistence MUST throw on the source-type check BEFORE any side effect (no opened transaction, no outbox record, no audit row, no domain row).

### 7. Materialization field mapping — DocketEntry → CaseBoxDeadline

| CaseBoxDeadline field | Required? | Source | Transform |
|---|---|---|---|
| `id` | required | Mode B preallocated ULID | — |
| `tenant_id` | required | `entry.tenant_id` | verbatim |
| `actor_user_id` | required | `entry.confirmation_actor_user_id` | the confirming lawyer, not the original proposer |
| `matter_id` | required | `entry.matter_id` | verbatim |
| `kind` | required | `entry.proposed_kind` | verbatim |
| `source_rule_citation` | **optional STRING (not nullable)** | `entry.source_rule_citation` | when non-null write verbatim; **when null OMIT the field — DO NOT write null** |
| `due_at` | required date-time | `entry.proposed_due_at` | verbatim (only `datetime` kind reaches Mode B per §5) |
| `owner_user_id` | required | `entry.proposed_owner_user_id` | verbatim |
| `status` | required | constant `"pending"` | always starts pending |
| `met_at`, `previous_status`, `transition_reason` | optional | n/a at creation | omit at creation |

**Mapping-coverage drift guard**: a test reads `case-box-deadline.schema.json` `required[]` and asserts every required field has a documented mapping rule. If Step-1 later adds a required field, the test fails until this table is updated.

### 8. Audit-log integration

Three new kinds added to `CASE_BOX_AUDIT_EVENT_KINDS`:

- `DOCKET_ENTRY_PROPOSED` (action: `create`, entity_type: `docket_entry`, reasonRequired: false)
- `DOCKET_ENTRY_CONFIRMED` (action: `update`, entity_type: `docket_entry`, reasonRequired: false)
- `DOCKET_ENTRY_DISMISSED` (action: `update`, entity_type: `docket_entry`, reasonRequired: true)

Step-4 schema `entity_type` enum gains `"docket_entry"` (tiny additive change; drift-guard test enforces alignment). `DEADLINE_CONTINUED` is NOT added — deferred until a future WI defines deadline mutation policy.

### 9. Strict IANA timezone validation

`assertValidIanaTimezone(tz)` policy:

1. Reject if not a non-empty string.
2. **Denylist check FIRST**: `DEPRECATED_TZ_DENYLIST = new Set(["America/Buenos_Aires"])` — always rejected even if a future Node ICU adds it to `supportedValuesOf`. (Canonical is `America/Argentina/Buenos_Aires`.)
3. Accepted set: `new Set(Intl.supportedValuesOf("timeZone"))` + `"UTC"` (always) + `"Etc/UTC"` (only if a one-time module-init probe via `Intl.DateTimeFormat` succeeds).
4. Any value not in the accepted set → throws `InvalidIanaTimezoneError`.

Pure: probe runs once at module init, no IO.

### 10. Source-vocabulary drift acknowledged as v1 tech debt

| Step | Entity | Enum values |
|---|---|---|
| Step 2 | CaseBoxFact | `lawyer_authored`, `llm_extraction`, `ocr_excerpt`, `imported` |
| Step 3 | CaseBoxPrivilegeMarker | `lawyer_authored`, `llm_suggested`, `imported` |
| Step 6 | CaseBoxDocketEntry | `manual`, `court_order_excerpt`, `llm_extraction`, `imported` |

Future doc-tidy WI will reconcile. Step 6 does NOT introduce a shared `source_type` enum.

## Persistence obligations recorded

For `case-box-persistence` (future WI):

1. **Append-only audit; mutable docket-entry row.** Audit chain captures lifecycle events.
2. **Builder-only audit emission** via `buildCaseBoxAuditEvent(...)`.
3. **Creation rule**: call `assertValidNewDocketEntry` before INSERT.
4. **Transition rules**: Mode B calls `assertValidDocketEntryConfirmation(entry, "lawyer")`; Mode C / other transitions call `assertValidDocketEntryTransition(from, to, "lawyer", reason)`. Persistence MUST NOT use the generic helper for confirmation paths.
5. **ULID preallocation**: Mode B preallocates the `CaseBoxDeadline` ULID before the docket-entry update.
6. **Atomic materialization**: Mode B steps 4 + 5 (docket update + deadline insert) MUST commit or roll back together. Idempotent re-runs (preflight detects already-confirmed) emit no audit and create no duplicates.
7. **Atomic audit + domain writes**: v1 RECOMMENDED is single SQLite connection / transaction. Alternative outbox protocol is allowed ONLY if it defines: durable pending-event log with monotonic sequence id; ordered retry with at-least-once delivery; idempotency keys; chain-hash recovery; conformance tests.
8. **`confirmed_deadline_id` uniqueness**: when non-null, MUST be unique across all docket entries. Persistence adds a unique index.
9. **`dismissal_reason` audit equality**: when emitting `DOCKET_ENTRY_DISMISSED`, the audit event's `reason` field MUST equal `docketEntry.dismissal_reason`.
10. **NO RAW `CaseBoxDeadline` insertion**: persistence MUST NOT expose any application-write API that directly INSERTs a `CaseBoxDeadline`. The ONLY write path is Mode B. This applies to ALL source_types including manual. Conformance tests MUST prove raw insertion is impossible.
11. **Date_only confirmation forbidden**: persistence MUST call `assertValidDocketEntryConfirmation` for Mode B; the helper throws on date_only. The generic transition helper does NOT perform this check.
12. **Date_only entries persistable**: docket entries with `proposed_due_at_kind="date_only"` are persisted normally; v1 prohibits only their confirmation.
13. **IANA timezone validation**: persistence MUST call `assertValidIanaTimezone` before any insert/update where `proposed_due_at_timezone` is non-null.
14. **Actor-as-lawyer**: persistence MUST resolve principal → role before calling helpers with `"lawyer"`. v1 (local-only) maps `actor_user_id === "local-user"` to lawyer per Step-0 §7.
15. **Confidentiality inheritance**: docket entries inherit matter-level confidentiality. Source-document references (court_order_excerpt) require the document's per-item classification to be resolved before any external export.
16. **No `CaseBoxDeadline.due_at` mutation in v1**: continuance / deferment deferred. Only the status lifecycle transitions (pending → met / missed / withdrawn) are allowed mutations on a materialized deadline.
17. **Deadline correction path**: a confirmed deadline that "didn't apply" is NOT corrected by reverting the docket entry (confirmed is terminal). Instead, `CaseBoxDeadline.status` transitions to `withdrawn` via the existing Step-1 lifecycle + `DEADLINE_WITHDRAWN` audit kind (Step 4). The docket entry remains the authoritative provenance record.

## Sequencing gate

**Step 6 ships the contract layer only.** The full three-layer enforcement (schema + helper + persistence) does NOT achieve runtime no-auto-confirm safety until `case-box-persistence` (a future WI) implements §10 obligations 1–17. Until persistence ships:

- The contract carries the shape, validators, and helper enforcement points.
- Any code that bypasses the helpers and writes raw schema-valid data can defeat the protections.
- The persistence WI's conformance tests MUST prove raw `CaseBoxDeadline` insertion is impossible.

ADR/release summaries MUST say "Step 6 ships contract-only; runtime deadline safety awaits persistence conformance." Do not claim runtime safety until persistence ships.

## Consequences

### Positive

- `unclassified`-style load-bearing default: date_only deadlines CANNOT be confirmed in v1, preventing silent UTC-midnight fabrication.
- Confirmation safety is structurally enforced: the confirmation-specific helper REQUIRES the entry; there is no optional-parameter ambiguity to forget.
- Machine-extracted deadlines cannot become authoritative without human action.
- Manual workflow is structurally identical to machine workflows (both go through proposed → confirmed), so no special case exists in the contract.
- `CaseBoxDeadline` schema is unchanged; existing Step-1 fixtures stay valid.
- Tiny additive Step-4 schema change preserves backward compatibility.
- Reminder offsets shape is pinned for future calendar/notification work.
- Audit chain extends cleanly with three new kinds.

### Negative

- Direct-confirm UX cost: lawyers must propose + confirm (two steps). UI may collapse them, but the contract sees two steps.
- `CaseBoxDeadline` is now lossy for date semantics; consumers needing them must query the docket entry.
- Date_only confirmation forbidden in v1: lawyer must upgrade to datetime + timezone or dismiss + recreate.
- v1 categorically forbids `DEADLINE_CONTINUED` mutation; correction requires `DEADLINE_WITHDRAWN`.
- Source vocabulary drift across Steps 2/3/6 documented as accepted v1 tech debt.
- Persistence MUST implement complex transactional logic (Mode B atomicity + idempotency + ULID preallocation + raw-insertion ban) that the contract cannot enforce.
- Runtime no-auto-confirm safety depends on persistence implementation; contract tests alone are insufficient.

### Neutral

- OCR pipeline unchanged.
- AGENTS.md unchanged.
- No new runtime dependency (`Intl.supportedValuesOf` is a Node ≥18 built-in).
- Step-1/2/3/5 schemas unchanged.

## Cross-references

- `docs/adr/case-box-step-0-boundary.md` — boundary; confidentiality posture; ADR series.
- `docs/adr/case-box-step-3-privilege-marker-model.md` — mutable-row precedent.
- `docs/adr/case-box-step-4-audit-log-shape.md` — extended with 3 new kinds + 1 new entity_type enum value.
- `docs/adr/case-box-step-5-confidentiality-classification.md` — docket entries inherit matter-level classification.
- `docs/contracts/case-box-contract/schemas/case-box-docket-entry.schema.json` — schema.
- `docs/contracts/case-box-contract/src/docket-invariants.ts` — all helpers.
- `docs/contracts/case-box-contract/src/transitions.ts` — generic transition helper.
- `dev-memo/plan-case-box-step-6.md` — implementation plan (4 revisions).
- Codex plan-review threads `019e47e0`, `019e47ed`, `019e47f5`, `019e47fc`, `019e4802`.

## Not in scope

- Persistence implementation.
- Calendar / sync / notification execution.
- LLM extraction execution.
- Deadline declarative-rules engine.
- Jurisdiction / court-rule resolver.
- Date_only confirmation.
- Deadline continuance/deferment.
- `DEADLINE_CONTINUED` audit kind.
- Per-entry confidentiality classification.
- Per-page-range deadlines.
- Recurring deadlines.
- Step-1 `CaseBoxDeadline` schema modifications.
- Step-5 `assertExternalHandlingAllowed` extension for `calendar_export`.
- Source-vocabulary reconciliation across Steps 2/3/6.

## Open questions deliberately deferred

1. Jurisdiction / court-rule resolver — required before date_only confirmation can be safely allowed.
2. Per-action calendar export gate — Step-5 helper extension.
3. Deadline continuance/deferment policy — defines `CaseBoxDeadline.due_at` mutation rules.
4. Outbox protocol concrete semantics — if persistence chooses outbox over single-transaction.
5. Replacement / supersession of confirmed deadlines — currently only via WITHDRAWN + new docket entry.
6. Source-vocabulary doc-tidy across Steps 2/3/6.
