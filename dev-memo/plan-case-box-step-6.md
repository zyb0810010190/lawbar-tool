# CASE-BOX Step 6 — Plan: Deadline / Docketing Rules

**Status**: **READY TO BUILD** (fourth revision; post plan-review threads `019e47e0` + `019e47ed` + `019e47f5` + `019e47fc` + verified by `019e4802`).
**Date**: 2026-05-20.
**Authorizes**: planning only. Implementation requires a follow-up authorization gate (granted by the parent user turn).
**Track**: ADR-series Step 6 (`docs/adr/case-box-step-6-deadline-docketing-rules.md`, not yet written).
**Out of scope**: persistence, ingestion, review, sync bridge, UI, auth, cloud, LLM execution, OCR worker changes, calendar integration, notifications, deadline continuation/deferment, declarative-rules engine, jurisdiction/court-rule resolution, date_only confirmation.

---

## 0. Naming acknowledgement

`docs/adr/case-box-step-0-boundary.md` ADR-series Step 6 = `case-box-step-6-deadline-declarative-rules.md` per the original Step-0 list; user authorization uses `case-box-step-6-deadline-docketing-rules.md`. This plan uses the user's filename. The declarative-rules engine and jurisdiction resolver are explicitly deferred (post-MVP).

---

## 1. The pre-existing CaseBoxDeadline becomes a materialized-view projection

Step 1 shipped `CaseBoxDeadline` with `due_at: date-time` (required, non-nullable), `status: pending|met|missed|withdrawn`, `kind`, `owner_user_id`, `source_rule_citation` (optional string, **NOT nullable** — omit-when-absent, not write-null), and the `missed→met` `transition_reason` invariant.

**Step 6 leaves `CaseBoxDeadline` schema UNCHANGED.** Per plan-review:

- **`CaseBoxDeadline` is a materialized-view / summary projection.** It records "a confirmed deadline exists with this due_at and this status".
- **NOT authoritative** for date-only semantics, timezone semantics, or extraction provenance.
- **`CaseBoxDocketEntry` is the authoritative carrier** for all those. Consumers needing legal date semantics MUST query the docket entry via `CaseBoxDocketEntry.confirmed_deadline_id`.
- **`CaseBoxDeadline` MAY in a future evolution add a back-reference field** (e.g., `confirmed_from_docket_entry_id`). This WI does NOT add such a field.

Persistence MUST forbid raw `CaseBoxDeadline` insertion (§10 obligation 8). Only the docket-entry confirmation path may materialize one.

---

## 2. Entity decision — companion entity, Step-1 schema unchanged

**Add one new entity: `CaseBoxDocketEntry`.** Companion to `CaseBoxDeadline`. Carries provenance + confirmation lifecycle + authoritative date semantics + reminder-policy hints.

`CaseBoxDocketEntry` is a **mutable single row** (status transitions update the same row). Matches Step-3 `CaseBoxPrivilegeMarker` precedent. Audit log captures changes via `update`-action events with hash chain (Step 4).

---

## 3. The CaseBoxDocketEntry shape

```jsonc
{
  "id": "ULID",                                              // required
  "tenant_id": "string",                                     // required
  "actor_user_id": "string",                                 // required — proposer
  "matter_id": "ULID",                                       // required
  "source_type": "manual|court_order_excerpt|llm_extraction|imported",  // required

  // Proposed deadline payload — authoritative date semantics
  "proposed_kind": "statute_of_limitations|court_order|discovery|filing|hearing|internal",  // required
  "proposed_due_at": "date-time",                            // required (ISO 8601)
  "proposed_due_at_kind": "datetime|date_only",              // required
  "proposed_due_at_timezone": "string | null",               // required (nullable); non-null required when proposed_due_at_kind === "datetime" (D7); semantic IANA validity enforced by TS helper
  "proposed_owner_user_id": "string",                        // required (minLength 1)
  "source_rule_citation": "string | null",                   // required (nullable)

  // Provenance for machine sources
  "extractor_name": "string | null",                         // required (nullable); see D2, D3
  "extractor_version": "string | null",                      // required (nullable)
  "extraction_confidence": "number | null",                  // required (nullable); 0..1

  // Source-of-deadline reference (for court_order_excerpt)
  "source_document_id": "ULID | null",                       // required (nullable); see D4
  "source_page_number": "integer | null",                    // required (nullable); 1-based
  "source_excerpt": "string | null",                         // required (nullable)

  // Docketing-policy fields — contract-only; NO notification execution in this WI
  "reminder_offsets": "array | null",                        // required (nullable); see §6 for pinned nested shape

  // Lifecycle (mutable row)
  "confirmation_state": "proposed|confirmed|dismissed",      // required; ALL entries START as proposed (no direct-confirm; see §4)
  "proposed_at": "date-time",                                // required (creation timestamp)
  "confirmation_actor_user_id": "string | null",             // required (nullable); set on proposed → confirmed update
  "confirmed_at": "date-time | null",                        // required (nullable)
  "confirmed_deadline_id": "ULID | null",                    // required (nullable); set on proposed → confirmed update; refers to the CaseBoxDeadline row persistence materializes in the SAME confirm transaction (Mode B)
  "dismissal_actor_user_id": "string | null",                // required (nullable); set on proposed → dismissed update
  "dismissed_at": "date-time | null",                        // required (nullable)
  "dismissal_reason": "string | null",                       // required (nullable); required when dismissed

  "created_at": "date-time"                                  // required
}
```

### Schema invariants (`if/then`)

**Eight invariants — D-proposed plus D1..D7.** Each `then` clause redeclares constrained properties (post-Step-1-audit pattern).

#### D-proposed: confirmation_state=proposed — confirmation AND dismissal fields MUST be null

```jsonc
{
  "if":   { "properties": { "confirmation_state": { "const": "proposed" } }, "required": ["confirmation_state"] },
  "then": {
    "properties": {
      "confirmation_actor_user_id": { "type": "null" },
      "confirmed_at":               { "type": "null" },
      "confirmed_deadline_id":      { "type": "null" },
      "dismissal_actor_user_id":    { "type": "null" },
      "dismissed_at":               { "type": "null" },
      "dismissal_reason":           { "type": "null" }
    }
  }
}
```

#### D1: manual source — extractor fields MUST be null

```jsonc
{
  "if":   { "properties": { "source_type": { "const": "manual" } }, "required": ["source_type"] },
  "then": {
    "properties": {
      "extractor_name":        { "type": "null" },
      "extractor_version":     { "type": "null" },
      "extraction_confidence": { "type": "null" }
    }
  }
}
```

#### D2: llm_extraction — extractor_name required

```jsonc
{
  "if":   { "properties": { "source_type": { "const": "llm_extraction" } }, "required": ["source_type"] },
  "then": {
    "required": ["extractor_name"],
    "properties": { "extractor_name": { "type": "string", "minLength": 1 } }
  }
}
```

#### D3: imported — extractor_name required

```jsonc
{
  "if":   { "properties": { "source_type": { "const": "imported" } }, "required": ["source_type"] },
  "then": {
    "required": ["extractor_name"],
    "properties": { "extractor_name": { "type": "string", "minLength": 1 } }
  }
}
```

#### D4: court_order_excerpt — source_document_id + source_page_number + source_excerpt required

```jsonc
{
  "if":   { "properties": { "source_type": { "const": "court_order_excerpt" } }, "required": ["source_type"] },
  "then": {
    "required": ["source_document_id", "source_page_number", "source_excerpt"],
    "properties": {
      "source_document_id": { "$ref": "#/$defs/ulid" },
      "source_page_number": { "type": "integer", "minimum": 1 },
      "source_excerpt":     { "type": "string", "minLength": 1 }
    }
  }
}
```

#### D5: confirmation_state=confirmed — confirmation fields required; dismissal fields null

```jsonc
{
  "if":   { "properties": { "confirmation_state": { "const": "confirmed" } }, "required": ["confirmation_state"] },
  "then": {
    "required": ["confirmation_actor_user_id", "confirmed_at", "confirmed_deadline_id"],
    "properties": {
      "confirmation_actor_user_id": { "type": "string", "minLength": 1 },
      "confirmed_at":               { "type": "string", "format": "date-time" },
      "confirmed_deadline_id":      { "$ref": "#/$defs/ulid" },
      "dismissal_actor_user_id":    { "type": "null" },
      "dismissed_at":               { "type": "null" },
      "dismissal_reason":           { "type": "null" }
    }
  }
}
```

#### D6: confirmation_state=dismissed — dismissal fields required; confirmation fields null

```jsonc
{
  "if":   { "properties": { "confirmation_state": { "const": "dismissed" } }, "required": ["confirmation_state"] },
  "then": {
    "required": ["dismissal_actor_user_id", "dismissed_at", "dismissal_reason"],
    "properties": {
      "dismissal_actor_user_id":    { "type": "string", "minLength": 1 },
      "dismissed_at":               { "type": "string", "format": "date-time" },
      "dismissal_reason":           { "type": "string", "minLength": 1 },
      "confirmation_actor_user_id": { "type": "null" },
      "confirmed_at":               { "type": "null" },
      "confirmed_deadline_id":      { "type": "null" }
    }
  }
}
```

#### D7: proposed_due_at_kind=datetime — proposed_due_at_timezone required

```jsonc
{
  "if":   { "properties": { "proposed_due_at_kind": { "const": "datetime" } }, "required": ["proposed_due_at_kind"] },
  "then": {
    "required": ["proposed_due_at_timezone"],
    "properties": { "proposed_due_at_timezone": { "type": "string", "minLength": 1 } }
  }
}
```

Schema only enforces non-empty string. **Strict IANA validity is enforced by the TS helper `assertValidIanaTimezone` (§9), using `Intl.supportedValuesOf("timeZone")` + explicit UTC allowlist.**

---

## 4. State machine — ALL sources start proposed; date_only CANNOT be confirmed in v1

States: `proposed | confirmed | dismissed`.

Terminal: `confirmed`, `dismissed`.

Edges (all `by: ["lawyer"]`):

| # | From | To | Reason required? |
|---|---|---|---|
| 1 | `proposed` | `confirmed` | no — confirmation is the affirmative act |
| 2 | `proposed` | `dismissed` | **yes** — lawyer rejected a proposed deadline |

Excluded edges: `*` → `proposed` (no return); `confirmed → *`, `dismissed → *` (terminal); any non-`lawyer` actor.

### Creation rule

`assertValidNewDocketEntry(entry)`:

- **ALL sources MUST start `proposed`.** No direct-confirm path for any source. (Plan-review-1 D3.1 / D4.1 fix.)
- On initial `proposed`: confirmation + dismissal fields MUST be null (D-proposed enforces).
- Throws `DocketEntryCreationError` on violation.

### Transition rules — generic + confirmation-specific (split per plan-review-3 D1.1/D3.1)

Two helpers, both required:

**`assertValidDocketEntryTransition(from, to, actor, reason?)`** — generic state-machine transition check. Mirrors Step-3 `assertValidPrivilegeMarkerTransition`. Does NOT take an entry; checks state-machine rules only (legal transitions, reason-required, actor gating).

**`assertValidDocketEntryConfirmation(entry, actor)`** — confirmation-specific helper that REQUIRES the full entry. Performs:
1. The generic state-machine check (`assertValidDocketEntryTransition("proposed", "confirmed", actor)`).
2. **Critical v1 invariant**: if `entry.proposed_due_at_kind === "date_only"`, throws `DocketEntryConfirmationError`. Reason: v1 has no jurisdiction/court-rule timezone resolver; confirming a date_only entry into a `CaseBoxDeadline.due_at` (required date-time instant) would silently fabricate a UTC midnight, which is unsafe.

**Mode B (§7) calls `assertValidDocketEntryConfirmation(entry, "lawyer")` — entry is REQUIRED.** There is NO API path that allows confirmation without passing the full entry. This closes the plan-review-3 D1.1/D3.1 gap (optional `entry?` parameter weakened safety; replaced with split helpers).

Date_only entries may exist only in state `proposed` (or `dismissed`). To confirm a date_only-conceived deadline in v1, the lawyer MUST upgrade it to `datetime` with explicit timezone. Future jurisdiction-resolver WI may relax.

This is the v1 recommended choice (per user authorization §3).

### Persistence interaction

Persistence MUST honor:
- `assertValidNewDocketEntry` before INSERT.
- For confirmation UPDATEs (Mode B): call `assertValidDocketEntryConfirmation(entry, "lawyer")` — REQUIRES the entry; throws on date_only.
- For dismissal UPDATEs (Mode C) or other state transitions: call `assertValidDocketEntryTransition(from, to, "lawyer", reason)` — generic, no entry param, NO date_only check (which is correct because date_only check is confirmation-specific).
- See §10 for full persistence obligations.

---

## 5. Date-only vs datetime semantics — authoritative on docket entry; v1 rejects date_only confirmation

`proposed_due_at_kind` is the load-bearing field.

Helper `interpretDocketEntryDueAt(entry, options?)`:

```ts
type DocketEntryDueAtInterpretation =
  | { kind: "datetime"; instant: string; timezone: string }
  | { kind: "date_only"; calendarDate: string; jurisdictionHint: string | null };

export function interpretDocketEntryDueAt(
  entry: CaseBoxDocketEntry,
  options?: { jurisdictionHint?: string },
): DocketEntryDueAtInterpretation;
```

- For `datetime`: returns `{kind, instant, timezone}`. **Throws if `proposed_due_at_timezone` is not a strict IANA zone** (calls `assertValidIanaTimezone`).
- For `date_only`: returns `{kind, calendarDate: <YYYY-MM-DD>, jurisdictionHint: options.jurisdictionHint ?? null}`. Does NOT silently convert to a datetime.

The helper is read-only / interpretation-only. It does NOT confirm or transition the entry. The v1 date_only-confirmation prohibition lives in `assertValidDocketEntryConfirmation`, not here.

---

## 6. Reminder offsets — pinned nested schema

Schema:

```jsonc
"reminder_offsets": {
  "anyOf": [
    { "type": "null" },
    {
      "type": "array",
      "maxItems": 32,
      "items": {
        "type": "object",
        "required": ["offset_days", "kind"],
        "additionalProperties": false,
        "properties": {
          "offset_days": {
            "type": "integer",
            "minimum": 0,
            "maximum": 3650,
            "description": "Days BEFORE the due date. Always non-negative; after-due-date semantics deferred."
          },
          "kind": { "enum": ["advance_notice", "final_notice"] }
        }
      }
    }
  ]
}
```

`offset_days` non-negative (interpreted "days BEFORE the due date"). After-due-date semantics deferred. v1 ships ZERO notification execution; reminder_offsets is shape-only.

---

## 7. Audit-log integration — THREE transaction modes

### Tiny additive Step-4 schema change

`case-box-audit-event.schema.json` `entity_type` enum gains `"docket_entry"`. Drift-guard test catches divergence.

### Audit-event kinds added in Step 6

Three new kinds:

```ts
DOCKET_ENTRY_PROPOSED:    { action: "create", entity_type: "docket_entry", reasonRequired: false },
DOCKET_ENTRY_CONFIRMED:   { action: "update", entity_type: "docket_entry", reasonRequired: false },
DOCKET_ENTRY_DISMISSED:   { action: "update", entity_type: "docket_entry", reasonRequired: true  },
```

`DEADLINE_CONTINUED` is NOT added in this WI (deferred — Step-1 deadline mutation policy is not defined).

### Three transaction modes (Mode A propose / Mode B confirm / Mode C dismiss)

The audit-event sequence depends on which write API the caller uses. Step 6 documents THREE modes; persistence implements all three; the contract layer sees lifecycle events in each.

**Mode A — Propose transaction:**

| Step | Audit event | Notes |
|---|---|---|
| 1 | (none — pre-write) | Call `assertValidNewDocketEntry(entry)`; throws if fails |
| 2 | `DOCKET_ENTRY_PROPOSED` | Action `create`; emitted as part of INSERT of new docket entry row |

End of transaction. The docket entry is in state `proposed`. **No `CaseBoxDeadline` is created.** `confirmed_deadline_id` is null.

Machine sources (LLM, OCR, import) MAY ONLY use Mode A — never Mode B without explicit lawyer action.

**Mode B — Confirm transaction:**

Triggered by a lawyer explicitly confirming an existing `proposed` docket entry.

| Step | Audit event | Notes |
|---|---|---|
| 0 | (none — preflight) | Idempotency check: if entry is already `confirmed` with a `confirmed_deadline_id` that resolves to an existing `CaseBoxDeadline` row by id (regardless of that deadline's `status` — `pending`, `met`, `missed`, OR `withdrawn` all count as "valid materialization" per plan-review-4 D2.1), return the existing materialization and emit NO audit. If entry is in any other state, proceed. |
| 1 | (none — pre-write) | Call `assertValidDocketEntryConfirmation(entry, "lawyer")` — REQUIRES the full entry; throws `DocketEntryConfirmationError` if `entry.proposed_due_at_kind === "date_only"` |
| 2 | (none — pre-write) | Preallocate a ULID for the soon-to-be-materialized `CaseBoxDeadline` |
| 3 | `DOCKET_ENTRY_CONFIRMED` | Action `update`; emitted as part of UPDATE setting `confirmation_state="confirmed"`, `confirmation_actor_user_id`, `confirmed_at`, `confirmed_deadline_id` (← the preallocated ULID) |
| 4 | `DEADLINE_REGISTERED` (existing Step-4 kind) | Action `create`; emitted as part of INSERT of `CaseBoxDeadline` row with `id = <preallocated ULID>` and fields populated per the §10.2 mapping table |

End of transaction. Atomicity: steps 3 + 4 MUST commit or rollback together.

**UX convenience (optional):** persistence MAY expose a `createAndConfirmManualDocketEntry` API that internally bundles a Mode A + Mode B in ONE transaction. The contract still sees TWO lifecycle steps; audit chain still emits THREE events in order (`DOCKET_ENTRY_PROPOSED → DOCKET_ENTRY_CONFIRMED → DEADLINE_REGISTERED`). This is permissible ONLY for `source_type === "manual"`.

**Persistence MUST throw on the source-type check BEFORE opening any mutating transaction, appending any outbox record, inserting any audit row, or inserting/updating any domain row.** Plan-review-4 D4.1: "before any write" means "before any side effect that a conformance test would observe via a fake persistence spy OR via final database state". Persistence conformance tests MUST verify both: (a) a fake-persistence spy receives zero write calls when called with a machine source; (b) final DB state contains zero new rows AND zero new audit events. Single-transaction-with-rollback is NOT acceptable — the source-type check happens FIRST. Plan-review-3 D2.3/D4.2: caller discipline is not enough; persistence MUST enforce.

### Mode C — Dismiss transaction

Triggered by a lawyer dismissing an existing `proposed` docket entry.

| Step | Audit event | Notes |
|---|---|---|
| 1 | (none — pre-write) | Call `assertValidDocketEntryTransition("proposed", "dismissed", "lawyer", reason)`; throws if reason empty |
| 2 | `DOCKET_ENTRY_DISMISSED` | Action `update`; reason MUST equal docket-entry `dismissal_reason` (§10 obligation 9) |

End of transaction. Docket entry is in state `dismissed`. No `CaseBoxDeadline` is created.

### Audit-event hash-state detail (plan-review-2 D2.5 fix)

Step-4 audit-event hash canonicalization (`canonicalAuditEventHashInput`) includes `id`, `tenant_id`, `actor_user_id`, `matter_id`, `action`, `entity_type`, `entity_id`, `before_state_hash`, `after_state_hash`, `prev_event_hash`, `reason`, `timestamp`. Step 6 conforms to that contract; specific Step-6 details:

- `entity_id` = docket entry id for DOCKET_ENTRY_* events; = CaseBoxDeadline id for DEADLINE_REGISTERED events.
- `before_state_hash` = null on create (PROPOSED, REGISTERED); non-null on update (CONFIRMED, DISMISSED).
- `after_state_hash` = hash of the entity state AFTER the write, computed by persistence (Step 4 leaves the SHA-256 algorithm to persistence per the canonical-hash-input contract).
- `reason` field on DISMISSED MUST equal docket-entry `dismissal_reason` (§10 obligation 9).
- `reason` field on CONFIRMED and PROPOSED is typically null (no reason required for those events; the rich kind table flag governs).

---

## 10.2 Materialization field mapping table — Docket entry → CaseBoxDeadline (plan-review-2 D2.1 fix)

When Mode B (confirm transaction) materializes a `CaseBoxDeadline`, persistence MUST map fields per this table:

| CaseBoxDeadline field | Required? | Source from DocketEntry | Transform | Absent/null behavior |
|---|---|---|---|---|
| `id` | required | the preallocated ULID from Mode B step 2 | — | N/A (always present) |
| `tenant_id` | required | `docketEntry.tenant_id` | verbatim | N/A |
| `actor_user_id` | required | `docketEntry.confirmation_actor_user_id` | verbatim (this is the lawyer confirming, not the original proposer) | N/A |
| `matter_id` | required | `docketEntry.matter_id` | verbatim | N/A |
| `kind` | required | `docketEntry.proposed_kind` | verbatim (both enums share the same values) | N/A |
| `source_rule_citation` | optional (STRING, NOT nullable in Step-1 schema) | `docketEntry.source_rule_citation` | when non-null, write verbatim; **when null, OMIT the field entirely** — DO NOT write `null` | omit-field, not null |
| `due_at` | required (date-time, NON-nullable) | `docketEntry.proposed_due_at` | verbatim (only `datetime` kind reaches Mode B per §4 v1 rule; date_only is FORBIDDEN to confirm) | N/A |
| `owner_user_id` | required | `docketEntry.proposed_owner_user_id` | verbatim | N/A |
| `status` | required | constant `"pending"` | the materialized deadline always starts pending; subsequent transitions follow Step-1 deadline lifecycle | N/A |
| `met_at` | optional | n/a at creation | always null at creation (`status="pending"`) | omit |
| `previous_status` | optional | n/a at creation | always null at creation | omit |
| `transition_reason` | optional | n/a at creation | always null at creation | omit |

**Validation risk**: writing `null` for an optional-but-not-nullable Step-1 field (like `source_rule_citation`) would FAIL the existing `validateDeadline` schema check. Persistence MUST use the "omit-when-null" rule. Tests in this WI assert the mapping produces a `validateDeadline`-passing row via a fixture round-trip.

---

## 8. Confidentiality / privilege interaction (unchanged from prior draft)

Docket entries inherit matter-level `confidentiality_class` (Step 1). v1 does NOT add per-entry classification rows. When a docket entry references a source document (court_order_excerpt → source_document_id), persistence MUST resolve the document's per-item classification before any external export. Calendar export is out of scope; future calendar export MUST gate via `assertExternalHandlingAllowed` (Step 5) with a new `"calendar_export"` external action.

**Recorded persistence obligation only; no Step-5 helper extension in this WI.**

---

## 9. Validators, helpers, fixtures, tests

### TypeScript helpers (new)

- **`src/validateDocketEntry.ts`** — `validateDocketEntry(payload): ValidationResult<CaseBoxDocketEntry>`.
- **`src/docket-invariants.ts`** (new):
  - Errors: `DocketEntryCreationError`, `DocketEntryConfirmationError`, `InvalidIanaTimezoneError`.
  - Helpers:
    - `assertValidNewDocketEntry(entry): void` — ALL sources must start `proposed`.
    - `isDocketEntryProposalOnly(entry): boolean`.
    - `docketEntryWasMachineExtracted(entry): boolean` — `source_type ∈ {llm_extraction, imported, court_order_excerpt}`.
    - `requiresHumanConfirmation(entry): boolean` — combines the two.
    - **`assertValidIanaTimezone(tz): void`** (plan-review-2 D3.1 + D4.1 + plan-review-3 D3.2/D1.2 fix) — strict IANA validation:
      - Builds the canonical set ONCE at module init: `const CANONICAL_TZ = new Set(Intl.supportedValuesOf("timeZone"));` (Set handles both Array and Set return types across Node versions per plan-review-3 D3.2).
      - Adds explicit allowlist `["UTC"]` to the set (some Node builds omit it from `supportedValuesOf`).
      - One-time probe at module init for `"Etc/UTC"`: tries `new Intl.DateTimeFormat(undefined, { timeZone: "Etc/UTC" })`; if the constructor does NOT throw AND the canonical set does not already contain `"Etc/UTC"`, adds it to the allowlist. This is the ONLY runtime probe.
      - **`DEPRECATED_TZ_DENYLIST = new Set(["America/Buenos_Aires"])` is checked FIRST**, before consulting the canonical set (plan-review-4 D3.1). This guarantees the deprecated alias is rejected even if a future Node ICU build adds it to `supportedValuesOf`. The denylist is intentionally small (v1); future additions are post-MVP.
      - Rejects: any string in `DEPRECATED_TZ_DENYLIST`, OR any string NOT in the final allowlist. Examples: `"PST"` (alias, not in supportedValuesOf), `"GMT"`, `"Mars/Olympus"`, `""`, `"america/new_york"` (lowercase), `"America/Buenos_Aires"` (always denylisted).
      - Throws `InvalidIanaTimezoneError`.
      - Pure: the probe runs at module init (`Intl` API, no IO).
    - `interpretDocketEntryDueAt(entry, options?)` — §5. Calls `assertValidIanaTimezone` for `datetime` kind.
  - Types: `DocketEntryDueAtInterpretation`.

### State machine (`transitions.ts`)

- `DocketEntryState`, `DOCKET_ENTRY_STATES`, `TERMINAL_DOCKET_ENTRY_STATES = ["confirmed", "dismissed"]`, `isTerminalDocketEntryState`.
- `ALLOWED_DOCKET_ENTRY_EDGES` (2 edges, `proposed → dismissed` reason_required).
- `isAllowedDocketEntryTransition(from, to, controlled_by)`, `assertValidDocketEntryTransition(from, to, controlled_by, reason?)` — generic helpers; NO entry parameter (plan-review-4 D1.1 / D5.1 fix: the optional-`entry?` signature was removed because it weakened the date_only confirmation safety).
- Date_only-confirmation safety lives ONLY in `src/docket-invariants.ts` `assertValidDocketEntryConfirmation(entry, actor)`. Mode B (§7) calls THAT helper, not the generic transition helper.

### Public surface (`src/index.ts`)

Standard re-exports for all new symbols.

### Fixtures

**Valid (8):**

| Path | Purpose |
|---|---|
| `fixtures/valid/docket-entry-proposed-llm.valid.json` | LLM-extracted; status proposed; date_only |
| `fixtures/valid/docket-entry-proposed-court-order-excerpt.valid.json` | OCR-excerpt; datetime + Asia/Shanghai |
| `fixtures/valid/docket-entry-proposed-manual.valid.json` | manual proposed |
| `fixtures/valid/docket-entry-proposed-imported.valid.json` | imported proposed |
| `fixtures/valid/docket-entry-confirmed.valid.json` | confirmed; confirmed_deadline_id set; datetime kind |
| `fixtures/valid/docket-entry-dismissed.valid.json` | dismissed; reason set |
| `fixtures/valid/docket-entry-with-reminder-offsets.valid.json` | reminder_offsets two entries (offset_days=7, 1) |
| `fixtures/valid/docket-entry-reminder-zero-offset.valid.json` | reminder_offsets with offset_days=0 (day-of) |

**Invalid (schema, 18) — extended per plan-review-2 D2.3 + plan-review-4 D1.4:**

- `docket-entry-bad-source-type.json`
- `docket-entry-llm-without-extractor.json` (D2)
- `docket-entry-manual-with-extractor.json` (D1)
- `docket-entry-court-order-without-document.json` (D4)
- `docket-entry-confirmed-without-deadline-id.json` (D5)
- `docket-entry-dismissed-without-reason.json` (D6)
- `docket-entry-datetime-without-timezone.json` (D7)
- `docket-entry-bad-due-at-kind.json`
- `docket-entry-proposed-with-confirmed-at.json` (D-proposed)
- `docket-entry-proposed-with-dismissed-at.json` (D-proposed)
- `docket-entry-reminder-negative-offset.json` (reminder integer minimum)
- `docket-entry-reminder-float-offset.json` (reminder integer type)
- `docket-entry-reminder-too-large.json` (reminder maximum 3650)
- `docket-entry-reminder-bad-kind.json` (reminder enum)
- `docket-entry-reminder-extra-property.json` (reminder additionalProperties: false)
- `docket-entry-reminder-missing-required.json` (reminder required: offset_days OR kind missing)
- `docket-entry-reminder-not-an-array.json` (reminder type: array | null violated)
- `docket-entry-reminder-too-many.json` (reminder maxItems: 32)

**Semantic-invalid (3) — caught by helpers, not schema:**

- `fixtures/semantic-invalid/docket-entry-bad-timezone.json` — datetime kind with `proposed_due_at_timezone="PST"`; schema-passes (non-empty string); caught by `assertValidIanaTimezone`.
- `fixtures/semantic-invalid/docket-entry-bad-timezone-mars.json` — `"Mars/Olympus"`; caught by helper.
- `fixtures/semantic-invalid/docket-entry-date-only-confirmed.json` — date_only entry transitioned to confirmed; would pass schema (D7 doesn't fire for date_only); caught by `assertValidDocketEntryConfirmation` v1 rule.

### Tests

`contract.test.mjs` — every valid + invalid fixture.

`validators.test.mjs`:
- `validateDocketEntry` happy + error paths.
- `assertValidNewDocketEntry`: positive (all 4 source types in `proposed`) + every-source-type-direct-confirm-throws + dismissed-not-allowed-at-creation.
- `isDocketEntryProposalOnly`, `docketEntryWasMachineExtracted`, `requiresHumanConfirmation` truth tables.
- `interpretDocketEntryDueAt`: datetime returns `{kind, instant, timezone}`; date_only returns `{kind, calendarDate, jurisdictionHint}`; date_only NEVER returns a datetime instant.
- **`assertValidIanaTimezone` test matrix** (plan-review-2 D3.1 + plan-review-3 D1.2):
  - Valid: `"UTC"`, `"America/New_York"`, `"Asia/Shanghai"`, `"Europe/London"`.
  - Maybe-valid (depends on Node ICU): `"Etc/UTC"` — test reads the helper's probe result at module init and asserts the helper's allow/deny matches.
  - Invalid (ALWAYS): `"PST"`, `"GMT"`, `"Mars/Olympus"`, `""`, `"america/new_york"` (lowercase), **`"America/Buenos_Aires"` (always rejected; canonical is `America/Argentina/Buenos_Aires`; no runtime probe — plan-review-3 D1.2)**.
- `interpretDocketEntryDueAt` for datetime kind THROWS `InvalidIanaTimezoneError` when timezone is `"PST"`.

`state-machine.test.mjs`:
- **Load-bearing no-auto-confirm test**: `assertValidDocketEntryTransition("proposed", "confirmed", "lawyer")` succeeds; non-lawyer actors throw.
- **Load-bearing date_only-can't-confirm test**: `assertValidDocketEntryConfirmation(dateOnlyEntry, "lawyer")` throws `DocketEntryConfirmationError` (per plan-review-3 D1.1/D3.1: confirmation-specific helper REQUIRES entry; no way to bypass).
- `assertValidDocketEntryConfirmation(datetimeEntry, "lawyer")` succeeds.
- `proposed → dismissed` requires non-empty reason.
- Terminal-state guards: `confirmed → *`, `dismissed → *` throw.
- Self-transitions throw.
- Edge-table drift guard.

`invariants.test.mjs`:
- Every fixture carries `tenant_id` + `actor_user_id`.
- Drift guard: schema `entity_type` enum includes `"docket_entry"`.
- **Materialization mapping round-trip test**: take a confirmed docket entry fixture, apply the §10.2 mapping table programmatically (in TS), feed the result to `validateDeadline`; assert ok=true.
- **`source_rule_citation` null-omission test**: when docket entry has null citation, the mapped deadline OMITS the field; the resulting deadline validates ok=true.
- **Mapping-coverage drift guard** (plan-review-3 D2.4 / D5.2): a test reads `case-box-deadline.schema.json` `required[]` array and asserts EVERY required field has a documented mapping rule in the §10.2 mapping table. If Step-1 later adds a required field, the test fails until the mapping table is updated.

`exports.test.mjs` — extend four lists.

### Mechanical files (unchanged from prior draft)

Same as prior version: NEW schema + validator + invariants + generated type + 8 valid + 18 invalid + 3 semantic-invalid fixtures + test extensions + README + ADR. Step-4 audit-event schema gains one entity_type enum value.

NOT touched: Step-1 `CaseBoxDeadline` schema, Step-2/3/5 schemas, AGENTS.md, `package.json`, OCR packages, persistence / ingestion / review / sync / UI / auth / cloud / LLM / calendar / notification files.

---

## 10. Persistence obligations recorded

For `case-box-persistence` (future WI):

1. **Append-only audit, mutable docket-entry row**: docket entries are mutable (lifecycle UPDATEs the same row). Audit log captures every change via separate events (Step 4 hash chain).
2. **Builder-only audit emission** via `buildCaseBoxAuditEvent({ kind: DOCKET_ENTRY_PROPOSED | CONFIRMED | DISMISSED | ... })`.
3. **Creation rule** — call `assertValidNewDocketEntry` before every INSERT.
4. **Transition rule** — for Mode B (confirm), call `assertValidDocketEntryConfirmation(entry, "lawyer")`. For Mode C (dismiss) or any other transition, call `assertValidDocketEntryTransition(from, to, "lawyer", reason)`. Persistence MUST NOT use the generic transition helper for confirmation paths (per plan-review-4 D1.1).
5. **Transaction modes** (§7):
   - Mode A (Propose): INSERT docket entry + emit DOCKET_ENTRY_PROPOSED.
   - Mode B (Confirm): preallocate `CaseBoxDeadline` ULID + UPDATE docket entry to `confirmed` with that ULID + INSERT `CaseBoxDeadline` per §10.2 mapping + emit DOCKET_ENTRY_CONFIRMED + emit DEADLINE_REGISTERED. ATOMIC.
   - Mode C (Dismiss): UPDATE docket entry to `dismissed` + emit DOCKET_ENTRY_DISMISSED.
   - Convenience: persistence MAY expose `createAndConfirmManualDocketEntry` bundling Mode A + Mode B; only for `source_type=manual`.
6. **Confirmation materialization MUST follow §10.2 mapping table** including the source_rule_citation omit-when-null rule. Idempotency: re-running Mode B on an already-confirmed entry MUST be a no-op (UPSERT semantics) — no second `CaseBoxDeadline`. Rollback: if any step in Mode B fails, the entire transaction MUST rollback.
7. **Atomic audit + domain writes** (plan-review-2 D3.2 / plan-review-3 D4.1): the Step-0 / Step-4 storage-separation guidance says audit MAY live in a separate SQLite file. Persistence implementing Mode B MUST either (a) **RECOMMENDED for v1**: put audit + domain rows under one SQLite connection/transaction (achieves atomicity directly), OR (b) implement an outbox/recovery protocol that MUST define ALL of the following minimum semantics: durable pending-event log with monotonic sequence id; ordered retry with at-least-once delivery; idempotency keys tying each event to its source mutation; audit-chain-hash recovery procedure if events are emitted out-of-order; conformance tests proving rollback semantics. Choosing (b) without defining all of these is forbidden. v1 RECOMMENDED: choose (a).
8. **`confirmed_deadline_id` uniqueness** (plan-review-2 D1.2): when non-null, `confirmed_deadline_id` MUST be UNIQUE across all docket entries. Persistence MUST add a unique index. At most one active confirmed docket entry per CaseBoxDeadline. (Replacement/continuance is deferred to a future WI.)
9. **`dismissal_reason` audit equality** (plan-review-2 D2.4): when emitting `DOCKET_ENTRY_DISMISSED`, the audit event's `reason` field MUST equal `docketEntry.dismissal_reason`. Persistence MUST assert.
10. **NO RAW `CaseBoxDeadline` insertion** (plan-review-2 D5.1 / D4.3): persistence MUST NOT expose any application-write API that directly INSERTs a `CaseBoxDeadline`. The ONLY write path is Mode B (materialization-from-confirmed-docket-entry). This applies to ALL source_types — even `manual`. Raw fixture construction in CONTRACT tests is allowed (the test harness builds rows directly for `validateDeadline`); raw persistence-API insertion is FORBIDDEN.
11. **Date_only confirmation forbidden** in v1 (§4). Persistence MUST call `assertValidDocketEntryConfirmation(entry, "lawyer")` for the Mode B confirmation transition; the helper REQUIRES the entry and throws on date_only. The generic `assertValidDocketEntryTransition` does NOT take an entry and does NOT perform this check.
12. **Date_only persistence**: docket entries with `proposed_due_at_kind="date_only"` are persisted normally; the v1 prohibition is only on CONFIRMATION. A lawyer may save a date_only proposed entry indefinitely or dismiss it; they cannot confirm it.
13. **IANA timezone validation**: persistence MUST call `assertValidIanaTimezone` before any insert/update where `proposed_due_at_timezone` is non-null.
14. **Actor-as-lawyer**: persistence MUST resolve the principal → role before calling `assertValidDocketEntryTransition(..., "lawyer")`. v1 (local-only) maps `actor_user_id === "local-user"` to lawyer per Step-0 §7.
15. **Confidentiality inheritance**: a docket entry inherits matter-level confidentiality. When a docket entry references a source document (court_order_excerpt), persistence MUST resolve the document's per-item classification before any external export.
16. **Deadline continuation policy NOT in v1**: persistence MUST NOT mutate `CaseBoxDeadline.due_at` of an already-confirmed deadline. Lifecycle status transitions (pending → met / missed / withdrawn) are the only allowed mutations on `CaseBoxDeadline`.
17. **No deadline raw deletion** — persistence MUST NOT delete `CaseBoxDeadline` rows. Plan-review-3 D2.1 correction: confirmed docket entries are TERMINAL. To express "this confirmed deadline turned out to not apply", persistence MUST use the existing Step-1 deadline lifecycle: transition `CaseBoxDeadline.status → withdrawn` and emit `DEADLINE_WITHDRAWN` (existing Step-4 kind). The docket entry stays `confirmed` (immutable post-confirmation); only the materialized `CaseBoxDeadline` transitions to withdrawn. The docket entry remains the authoritative provenance record.

### Sequencing gate (plan-review-2 D5.2)

**Step 6's contract layer is necessary but NOT sufficient for deadline safety.** Three-layer enforcement (schema + helper + persistence) only achieves real runtime no-auto-confirm protection once `case-box-persistence` (a future WI) implements the write APIs that honor §10 obligations 1–17. Until persistence ships:

- The contract carries the shape, validators, and helper enforcement points.
- Any test or application that bypasses the helpers and writes raw schema-valid data can defeat the three-layer enforcement.
- This WI's acceptance criteria must explicitly note that the SAFETY guarantees of Step 6 depend on the future persistence WI; the persistence WI MUST add conformance tests proving raw `CaseBoxDeadline` insertion is impossible.

The ADR documents this explicitly.

---

## 11. Out of scope

- Calendar integration / sync / notifications.
- External calendar provider choice.
- LLM execution for deadline extraction.
- OCR worker changes.
- Persistence.
- Deadline computation engine (declarative rules for "30 days after service").
- **Jurisdiction / court-rule resolution** — explicit deferral per §4. Without a resolver, date_only confirmation is forbidden in v1. (Plan-review-2 D5.3 fix.)
- API / UI / auth / cloud / sync execution.
- Per-entry confidentiality classification.
- Recurring deadlines.
- `DEADLINE_CONTINUED` audit kind — deferred until a future WI defines deadline mutation policy.
- Deadline continuance/deferment semantics.
- `CaseBoxDeadline` schema modifications.
- Direct-confirm manual creation — REMOVED; all entries start proposed.
- Step-5 helper extension for `calendar_export` external action.
- **Jurisdiction immutability after first confirmed deadline** (Step-0 hint at "case.jurisdiction immutable once any deadline exists") — Step 6 does NOT implement this; future jurisdiction/resolver WI handles it.
- Raw `CaseBoxDeadline` insertion path for ANY source (manual or machine).

---

## 12. Acceptance criteria

1. `case-box-docket-entry.schema.json` exists with D-proposed + D1..D7.
2. `src/generated/case-box-docket-entry.ts` regenerated.
3. `src/validateDocketEntry.ts` exists.
4. `src/docket-invariants.ts` exports every helper including `assertValidIanaTimezone` using `Intl.supportedValuesOf("timeZone")` + UTC allowlist (not bare `Intl.DateTimeFormat` check).
5. `src/index.ts` re-exports every new symbol; deep-frozen schema.
6. `src/audit-log.ts` extended with 3 new kinds; `CASE_BOX_AUDIT_ENTITY_TYPES` includes `"docket_entry"`.
7. `case-box-audit-event.schema.json` `entity_type` enum widened.
8. `scripts/gen-types.mjs` extended.
9. `src/transitions.ts` extended; `assertValidDocketEntryTransition` is generic (no entry param); `src/docket-invariants.ts` exports `assertValidDocketEntryConfirmation(entry, actor)` which REQUIRES the full entry (plan-review-3 D1.1/D3.1 — no optional-parameter ambiguity).
10. case-box-contract test suite green (Step-5's 275 stay green).
11. OCR contract tests stay 102/102 green.
12. Zero Ajv strictRequired warnings.
13. `tsc` passes clean.
14. **No Step-1/2/3/5 schema modified.** (Process check.) Step-4 audit-event schema gains one enum value.
15. **No OCR-package file modified.** (Process check.)
16. **No persistence / ingestion / review / sync / UI / auth / cloud / LLM / calendar / notification file added or modified.** (Process check.)
17. **No new runtime dependency.** (Process check.) `Intl.supportedValuesOf("timeZone")` is a Node ≥18 built-in; engine pin is ≥22, so always available.
18. **AGENTS.md unchanged.** (Process check.)
19. README + ADR co-committed.
20. **Load-bearing no-auto-confirm test**: `assertValidNewDocketEntry` rejects ALL sources with initial `confirmation_state === "confirmed"`.
21. **Load-bearing date-only-can't-confirm test**: `assertValidDocketEntryConfirmation(dateOnlyEntry, "lawyer")` throws `DocketEntryConfirmationError`. There is NO way to perform a confirmation without passing the entry; the API surface forbids it.
22. **Strict IANA test matrix**: `assertValidIanaTimezone` accepts `["UTC", "America/New_York", "Asia/Shanghai", "Europe/London"]`; rejects `["PST", "GMT", "Mars/Olympus", "", "america/new_york", "America/Buenos_Aires"]` ALWAYS (the deprecated alias is in `DEPRECATED_TZ_DENYLIST` and is rejected even if a future Node ICU adds it to `Intl.supportedValuesOf("timeZone")`). Only `"Etc/UTC"` is runtime-probed at module init; the test asserts the helper's behavior matches the probe.
23. **State-machine load-bearing**: non-lawyer actors throw.
24. **Dismiss reason required**: `proposed → dismissed` with empty reason throws.
25. **Drift guard**: Step-4 schema `entity_type.enum` matches updated `CASE_BOX_AUDIT_ENTITY_TYPES` (9 values).
26. **D-proposed enforced**: schema rejects a proposed-state row with non-null confirmed_at.
27. **Edge table drift guard**: documented edges (2) match actual ALLOWED_DOCKET_ENTRY_EDGES.
28. **`DEADLINE_CONTINUED` NOT added** in this WI.
29. **Reminder offsets fixtures comprehensive**: negative, float, too-large, bad-kind, extra-property, missing-required, not-array, too-many all rejected.
30. **Materialization mapping round-trip test**: a confirmed docket entry produces (via §10.2 mapping) a `validateDeadline`-passing CaseBoxDeadline row.
31. **`source_rule_citation` omit-when-null test**: the mapping omits the field; result validates.
32. **Sequencing-gate language present in ADR + release summary** (plan-review-3 D5.1): the ADR explicitly states "Step 6 ships the contract layer; runtime deadline safety awaits the future case-box-persistence WI conformance tests." The README + ADR summary MUST NOT claim runtime no-auto-confirm safety until persistence ships.
33. **Mapping-coverage drift guard test present**: reads `case-box-deadline.schema.json` required[] and asserts §10.2 mapping covers every entry. Future Step-1 required-field addition fails the test until mapping updates (plan-review-3 D2.4/D5.2).
34. **Confirmed-deadline correction path test**: a `DEADLINE_WITHDRAWN` audit-event emission on a CaseBoxDeadline materialized from a confirmed docket entry is verified to work (the docket entry stays `confirmed`; the CaseBoxDeadline status transitions to `withdrawn`).
35. **No optional `entry?` parameter** on `assertValidDocketEntryTransition`: type-level test verifies the signature is `(from, to, controlled_by, reason?)` with NO entry argument. The date_only check is owned exclusively by `assertValidDocketEntryConfirmation`.
36. **Mode B idempotency preflight test**: re-running Mode B on an already-confirmed entry returns existing materialization, emits no audit events, creates no second CaseBoxDeadline.

Criteria #14–#18 are process / git-diff checks.

---

## 13. Audit questions

1. **No-auto-confirm at creation layer**: ALL sources rejected if initial state is confirmed?
2. **No-auto-confirm at state-machine layer**: non-lawyer actors throw?
3. **No-auto-confirm at schema layer**: D-proposed + D5 enforce?
4. **Date_only-can't-confirm**: `assertValidDocketEntryConfirmation(entry, "lawyer")` v1 rule throws on date_only confirmation (NOT the generic transition helper)?
5. **Strict IANA validation**: `Intl.supportedValuesOf` used + UTC allowlist; "PST" rejected?
6. **Audit kinds added correctly**: 3 kinds (DOCKET_ENTRY_PROPOSED / CONFIRMED / DISMISSED) with right action/entity_type/reasonRequired?
7. **DEADLINE_CONTINUED NOT added**: deferred?
8. **Drift guard updated**: schema entity_type enum + TS constant both include "docket_entry"?
9. **CaseBoxDeadline (Step 1) unchanged**: `git diff` empty for that schema file?
10. **Materialized-view documented**: README + ADR explicit?
11. **§10.2 mapping table present**: every CaseBoxDeadline field has a mapping rule?
12. **`source_rule_citation` null-omission rule**: documented + tested?
13. **Persistence obligations recorded**: every item in §10 in the ADR?
14. **No calendar/notification code**: pure helpers + types only?
15. **Confidentiality inheritance**: documented as persistence obligation?
16. **No recurring deadlines**: shape carries no recurrence field?
17. **Reminder offsets schema fully pinned + tests comprehensive**: required + additionalProperties: false + integer bounds + max items + ALL malformed-shape fixtures?
18. **Source-of-deadline coherence**: D4 requires source_document_id + page + excerpt for court_order_excerpt?
19. **AGENTS.md unchanged**?
20. **Source-vocabulary drift documented**: §15 tech-debt note explicit?
21. **Direct-confirm path removed**: ALL sources start proposed?
22. **ULID preallocation obligation**: persistence MUST preallocate before Mode B?
23. **Materialization atomicity (Mode B)**: rollback on any step failure?
24. **No raw `CaseBoxDeadline` insertion**: persistence MUST NOT for ANY source?
25. **Atomic audit + domain**: persistence MUST choose single-transaction OR outbox?
26. **`confirmed_deadline_id` uniqueness**: persistence MUST enforce unique index?
27. **`dismissal_reason` audit equality**: persistence MUST assert?
28. **Date_only persisted but unconfirmable**: docket entries with date_only allowed in `proposed`; v1 cannot confirm?
29. **Sequencing gate documented**: contract layer alone is necessary-but-not-sufficient?
30. **Jurisdiction immutability**: explicitly deferred?

---

## 14. Risks / open items

- **Materialization atomicity is persistence's job.** The contract documents Mode B; persistence MUST honor it including transactional bundling and rollback on partial failure.
- **`assertValidIanaTimezone` semantics depend on Node version + ICU build.** `Intl.supportedValuesOf("timeZone")` is the canonical source but may omit `UTC` on some builds. The helper handles this with a runtime probe at module init. Tests assert behavior matches the probe result. Documented v1 stance: prefer strict + allowlist UTC; do not depend on alias canonicalization behavior.
- **Date_only confirmation forbidden in v1** is conservative. Lawyers needing to confirm a date_only deadline must convert to datetime + supply timezone. Future jurisdiction-resolver WI may relax.
- **`CaseBoxDeadline` raw-insertion ban** is the load-bearing no-auto-confirm gate. Without it, machine sources can bypass three-layer enforcement. Persistence WI MUST enforce; contract tests cannot.
- **Mode B atomicity across separate audit/domain SQLite files** (Step-0 §confidentiality posture suggests audit may live separately): persistence chooses single-transaction connection OR outbox protocol. Documented obligation; not contract-enforced.
- **`confirmed_deadline_id` uniqueness** is a persistence-layer index. Contract documents; no schema enforcement.
- **Direct-confirm UX cost**: lawyers explicitly perform two steps (or use the convenience API). Acceptable for v1.
- **`CaseBoxDeadline` as materialized view** silently lossy for date_only — but v1 forbids date_only confirmation, so this risk is bounded.
- **Source vocabulary drift** across Steps 2/3/6 documented in §15.
- **Mutable docket entries** match Step-3 PrivilegeMarker precedent; audit chain covers history.
- **Three-layer enforcement only real once persistence ships** — sequencing gate documented in §10 + ADR.

---

## 15. Source vocabulary drift (documented tech debt)

| Step | Entity | Enum values |
|---|---|---|
| Step 2 | CaseBoxFact | `lawyer_authored`, `llm_extraction`, `ocr_excerpt`, `imported` |
| Step 3 | CaseBoxPrivilegeMarker | `lawyer_authored`, `llm_suggested`, `imported` |
| Step 6 | CaseBoxDocketEntry | `manual`, `court_order_excerpt`, `llm_extraction`, `imported` |

Resolution: documented v1 tech debt. Future doc-tidy WI reconciles. Step 6 keeps locally-scoped vocabulary and does NOT silently invent a shared enum.

---

## 16. Plan-review thread history

- **Round 1**: Codex thread `019e47e0` — MAJOR GAPS (4 Critical + many High). Fixes 1–8 applied per user instruction (materialized-view stance, D-proposed, direct-confirm removed, DEADLINE_CONTINUED deferred, IANA helper, reminder pinning, no-raw-insert persistence obligation, drift docs).
- **Round 4**: Codex thread `019e47fc` — NEEDS REVISION (1 High + 2 Medium + Low cosmetics). All round-3 fixes confirmed applied EXCEPT a leftover §9 reference to the optional-`entry?` parameter (which contradicted §4 split-helper design). This round-4 revision deletes every `entry?` reference from `assertValidDocketEntryTransition`; renames §7 heading to "THREE transaction modes"; updates fixture count label to 18; adds `DEPRECATED_TZ_DENYLIST` for `America/Buenos_Aires`; sharpens "before any write" semantics for the convenience API; clarifies idempotency preflight "valid materialization" definition includes withdrawn-status deadlines; rewrites date_only audit questions to name `assertValidDocketEntryConfirmation` (not the generic transition).
- **Round 3**: Codex thread `019e47f5` — NEEDS REVISION (2 High + several Medium). Fixes applied: split confirmation-helper (D1.1/D3.1); dismiss-after-confirmed path (D2.1) resolved via DEADLINE_WITHDRAWN on the materialized deadline + confirmed docket entry stays terminal; America/Buenos_Aires always-reject (D1.2); "TWO modes" → "THREE modes" (D1.3); §10 obligation #11 → #9 references (D1.4); Mode B idempotency preflight (D2.2); convenience-API non-manual-reject persistence enforcement (D2.3/D4.2); mapping-coverage drift test (D2.4/D5.2); `Intl.supportedValuesOf` Set-or-Array via `new Set(...)` (D3.2); outbox protocol tightened with v1 RECOMMENDED single-transaction (D4.1); acceptance criterion for "contract-only" claim (D5.1).
- **Round 2**: Codex thread `019e47ed` — NEEDS REVISION (no Critical; 4 High + 5 Medium). This (Round-2) revision applies the user's 11 additional fixes:

| Round-2 finding | Resolution in this revision |
|---|---|
| D1.1 High — audit transaction contradicts removed direct-confirm | §7 split into Mode A / Mode B / Mode C; convenience API explicitly optional |
| D2.1 High — materialization field mapping incomplete | §10.2 mapping table added with omit-when-null rule for source_rule_citation |
| D2.2 High — date_only projection still under-defined | §4: date_only confirmation FORBIDDEN in v1; lawyer must upgrade to datetime+tz |
| D3.1 High — Intl.DateTimeFormat is not strict IANA | §9: `assertValidIanaTimezone` uses `Intl.supportedValuesOf("timeZone")` + UTC allowlist + runtime probe for Etc/UTC |
| D4.1 High — IANA acceptance policy ambiguous | §9: precise policy spelled out (supportedValuesOf + UTC + probed Etc/UTC; reject aliases like PST/GMT; `America/Buenos_Aires` ALWAYS denylisted via DEPRECATED_TZ_DENYLIST in round-4 fix, checked before canonical set) |
| D5.1 / D4.3 High — raw insertion left as MAY | §10 obligation 10: MUST NOT, for ALL source_types |
| D5.2 High — three-layer enforcement only real with persistence | §10 sequencing-gate paragraph added; acceptance §12.32 |
| D1.2 Medium — confirmed_deadline_id uniqueness | §10 obligation 8 |
| D2.4 Medium — dismissal_reason audit equality | §10 obligation 9 |
| D2.5 Medium — hash-state audit detail | §7 audit-event hash-state subsection |
| D3.2 Medium — atomic audit + domain conflict | §10 obligation 7: single-transaction OR outbox |
| D4.2 Medium — API naming | §7 + §10 obligation 5: convenience API named, contract sees lifecycle steps |
| D5.3 Medium — jurisdiction-immutability deferred | §11 explicit deferral entry |

---

## 17. References

- `docs/adr/case-box-step-0-boundary.md` — boundary; ADR-series Step list.
- `docs/adr/case-box-step-4-audit-log-shape.md` — audit-log shape; extended with 3 new kinds + 1 new entity_type value.
- `docs/adr/case-box-step-5-confidentiality-classification.md` — classification; docket entries inherit matter-level.
- `docs/product/product-target-architecture.md` — cross-cutting invariant #4.
- `dev-memo/superseded/case-box-plan.md` — original `deadline` shape.
- `docs/contracts/case-box-contract/schemas/case-box-deadline.schema.json` — Step-1 deadline schema (UNCHANGED; materialized-view projection).
- `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json` — Step-4 schema; one enum value added.
- `docs/contracts/case-box-contract/src/audit-log.ts` — Step-4 helpers; 3 new kinds added.
- Codex plan-review threads `019e47e0` (round 1) and `019e47ed` (round 2).
- `AGENTS.md` — Stop-and-Ask gates.
