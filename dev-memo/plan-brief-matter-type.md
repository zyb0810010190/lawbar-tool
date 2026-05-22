# Plan: WI-brief-matter-type — Matter-type vocabulary + R-5 contract surface

**Status**: READY (revision 2 — second review-plan returned READY with Low-risk clarifications; two Lows applied as opportunistic cleanup; ready to commit).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction (resolves project-brief R-5).
**Branch**: main.
**Authoritative source**: `docs/product/project-requirements-brief.md` (status `READY`, commit `fe09ea4`), §"R-5".

## Review packet (compact)

### Active plan summary

This is the foundational v1 case-box contract WI. It resolves R-5 from the READY project-requirements-brief: align lawyer-facing matter categories (litigation, counsel) with the existing `case-box-matter.schema.json` `matter_type` enum, and add ten additive contract changes (R-5 items (a)..(j)) so that §7.A and §7.B v1 sub-entities are persistable, validatable, and queryable without inventing unreviewed field names. The WI is **contract-only**: schemas, validators, helpers, fixtures, tests in `docs/contracts/case-box-contract/`. ADR amendments to `case-box-step-0` (entity list), `case-box-step-2` (fact purpose + as_of_date), and `case-box-step-6` (deadline kind). Persistence implementation (services/case-box-persistence/) is NOT touched by this WI; it absorbs the contract changes in follow-up WIs after this WI's cc-suite review-plan returns READY.

### Exact target files (this WI)

Schemas — `docs/contracts/case-box-contract/schemas/`:
- `case-box-matter.schema.json` (add `successor_matter_id`, `case_type_text`, `case_progress_text`, `court_contact_text`, `contention_summary_text`).
- `case-box-document.schema.json` (add `purpose`, `work_order_status`, `supersedes_document_id`, free-text lifecycle fields).
- `case-box-fact.schema.json` (add `purpose`, `as_of_date`).
- `case-box-evidence-item.schema.json` (add `party_side`).
- `case-box-docket-entry.schema.json` (extend `proposed_kind` enum).
- `case-box-deadline.schema.json` (extend `kind` enum to mirror docket).
- `case-box-audit-event.schema.json` — **untouched** (these are matter-row / sub-entity-row additions, not new entity_types).

Validators / helpers / state-machines — `docs/contracts/case-box-contract/src/`:
- `validateMatter.ts`, `validateDocument.ts`, `validateFact.ts`, `validateEvidenceItem.ts`, `validateDocketEntry.ts`, `validateDeadline.ts` — each picks up new fields via Ajv recompile (no signature changes).
- New invariant helpers as needed (see §5).
- `generated/` types — regenerated from schemas via existing script.

Tests + fixtures — `docs/contracts/case-box-contract/tests/`, `fixtures/`:
- New valid fixtures exercising each new field (one fixture per new field + one combination fixture per matter type).
- New invalid fixtures exercising new invariants (per §5).
- `contract.test.mjs`, `validators.test.mjs`, `invariants.test.mjs`, `state-machine.test.mjs` updates.

ADR amendments — `docs/adr/`:
- `case-box-step-0-boundary.md` — entity-list note (no full rewrite); R-5 cross-ref.
- `case-box-step-2-fact-promotion-and-provenance.md` — note new `purpose` and `as_of_date` fields with semantics.
- `case-box-step-6-deadline-docketing-rules.md` — note `kind` vocabulary extension.

NOT touched in this WI:
- `services/case-box-persistence/**` (downstream reference only).
- `services/ocr-*/**`.
- `apps/**`.
- `docs/adr/case-box-step-{1,3,4,5,7,8}-*.md` (no changes needed — those ADRs do not reference the new fields).
- `dev-memo/plan-case-box-persistence-*.md` (the A1-A9 plans absorb these in their next phase, not via this WI).

### Exact acceptance criteria

1. All ten R-5 items (a)..(j) land additively. No existing valid fixture is invalidated.
2. The `matter_type = "litigation"` vs `matter_type = "advisory"` distinction is testable via fixture: one valid fixture per matter type using each conditionally-applicable new field.
3. Schema invariants are enforced at the schema layer (Ajv) where mechanically possible; validator-layer guards for cross-field invariants Ajv cannot express.
4. New invariants per §5 each have at least one valid + one invalid fixture and a dedicated test assertion.
5. Optional-vs-nullable convention is **uniform**: optional-omitted for absent values; nullable-required only where invariants force presence (e.g. `as_of_date` non-null when `purpose = "timeline_event"`). The plan records the convention; the implementation enforces it.
6. `additionalProperties` posture per schema is **preserved as-is** (not tightened to `false` in this WI — that is a separate drift-guard decision).
7. Existing case-box-contract test suite (`npm --prefix docs/contracts/case-box-contract test`) is green. New tests cover each new field and each new invariant.
8. ADR amendments are minimal: cross-reference notes only; no rewrite of the existing decision text.
9. cc-suite review-plan returns READY (or only Low-risk clarifications).

### Exact out-of-scope list (informational; mirrors the user-stated constraints)

- No SQLite Phase B work.
- No ABI remediation work.
- No persistence implementation changes (`services/case-box-persistence/`). Persistence will absorb the new fields in a follow-up WI after this plan is committed and the contract WI implements.
- No API / UI / mini-program code.
- No auth provider work.
- No cloud / sync work.
- No LLM implementation.
- No new runtime dependencies.
- No commit-message / branching changes (this WI commits the plan ONLY; implementation is a follow-up WI).
- Lawyer-letter and contract-review lifecycle state machines (R-9, post-v1).
- Dedicated work-order entity (post-v1).
- Controlled vocabulary for `case_type_text` and lifecycle state machine for `case_progress_text` (POST-V1 follow-up).
- Tightening `additionalProperties: false` across case-box schemas (separate drift-guard WI).

### Essential ADR references

- `docs/adr/case-box-step-0-boundary.md` §1 entity list + §"Cross-cutting Invariants".
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` §"Decision" (the no-auto-accept rule must remain intact alongside new `purpose` + `as_of_date`).
- `docs/adr/case-box-step-6-deadline-docketing-rules.md` §"Decision" (the proposed→confirmed lifecycle and date_only ban must remain intact alongside new kind values).

### Review questions for the reviewer

1. Is the `doc_type` (existing structural classification) vs `purpose` (new workflow-role classification) orthogonality clearly stated and not duplicative? Reviewer should specifically verify that `doc_type = "contract"` with `purpose = "engagement_contract"` is sensible and not double-encoding.
2. Are all v1 §7.A and §7.B sub-entity fields named in the brief covered by exactly one of (a)..(j)? (R-5 went through 5 review iterations to close this exact gap; reviewer should re-verify.)
3. Are the new schema invariants in §5 enforceable at the schema layer, or do they require validator-layer guards? Where validator-layer is needed, is the guard reasonable and testable?
4. Is the `retainer_scope` (existing matter field) vs `case_type_text` (new R-5(j) field) distinction clearly stated and not duplicative?
5. Does the deadline `kind` vocabulary extension preserve every existing fixture and validator path?
6. Are persistence impacts in §8 accurately scoped — i.e., can A1-A9 in-memory writers absorb new optional fields without behavioral change, or does §8 understate the impact?

---

## §1 Context + provenance

The READY brief at `docs/product/project-requirements-brief.md` (commit `fe09ea4`) names this WI as the foundational v1 case-box work item — every other v1 case-box / UI / persistence WI blocks on it. R-5 of the brief survived five review-plan iterations (job IDs `review-plan-mpgg9yrg-amf715`, `mpggju0y-85f713`, `mpggqqvc-loxub7`, `mpggv73w-0g9pun`, `mpggyqgv-hmn80f`) and ends at READY (Low-risk clarifications) with the exact ten-item additive contract surface this plan now implements.

This plan does NOT re-litigate R-5's design decisions — those were the brief's job. It translates R-5 into concrete schema diffs, validator additions, fixture coverage, and test obligations, plus the small ADR amendments needed for cross-reference discoverability.

The existing case-box-contract package (`docs/contracts/case-box-contract/`) is at version 0.1.0; eleven schemas + matching validators + state machines + invariants are already shipped through case-box-step-1..6 ADRs. The persistence package (`services/case-box-persistence/`) is at Phase A9 (replay-safe Once variants), in-memory only; SQLite Phase B has not started (and is explicitly out of scope per user instruction).

The current schema reality, verified against the source files:

- `case-box-matter.schema.json`: `matter_type` enum already `["litigation", "arbitration", "advisory", "due_diligence", "criminal_defense", "other"]` (already required). Has `name`, `jurisdiction`, `parties[]`, `retainer_scope`, `confidentiality_class`, `status`, three opt-in booleans (`external_ocr_authorized`, `sync_grant_present`, `llm_extraction_opt_in`), `created_at`, `archived_at`.
- `case-box-document.schema.json`: has `source`, `custody_chain`, `filename`, `content_hash`, `storage_uri`, `ocr_job_id`, `submission_hash`, `language`, `page_count`, `doc_type` (structural enum), `received_at`, `status` (lifecycle). No `purpose`, no `work_order_status`, no `supersedes_document_id`, no free-text lifecycle fields.
- `case-box-fact.schema.json`: no `purpose`, no `as_of_date`.
- `case-box-evidence-item.schema.json`: no `party_side`.
- `case-box-docket-entry.schema.json`: `proposed_kind` enum is `["statute_of_limitations", "court_order", "discovery", "filing", "hearing", "internal"]`. R-5(i) adds `payment | evidence_submission | appeal` — `hearing` is already present.
- `case-box-deadline.schema.json`: `kind` enum mirrors docket's `proposed_kind`. Same delta applies.

`additionalProperties` posture per touched schema, verified against the source files:
- `case-box-matter.schema.json` — default (open). Plan keeps open.
- `case-box-document.schema.json` — default (open). Plan keeps open.
- `case-box-fact.schema.json` — default (open). Plan keeps open.
- `case-box-evidence-item.schema.json` — default (open). Plan keeps open.
- `case-box-docket-entry.schema.json` — **already `additionalProperties: false`** (Step-6 tightened it). New `proposed_kind` enum values land within the closed shape; no other field is added. Plan keeps closed.
- `case-box-deadline.schema.json` — default (open). Plan keeps open.
- `case-box-audit-event.schema.json` — `additionalProperties: false` (Step-4). Plan does NOT touch this schema.

Tightening any currently-open schema to `additionalProperties: false` is a separate drift-guard decision (out of scope for this WI).

---

## §2 Scope

### In scope

1. Schema diffs for ten R-5 items (a)..(j) (§4).
2. New cross-field invariants (§5).
3. Validator updates (Ajv recompile + new invariant helpers).
4. Type regeneration via existing `scripts/gen-types.mjs`.
5. Fixture additions (valid + invalid) per new field and per new invariant.
6. Test additions to `contract.test.mjs`, `validators.test.mjs`, `invariants.test.mjs`.
7. Minimal ADR cross-reference amendments to Steps 0, 2, 6.

### Out of scope

(Restated from Review packet; see Review packet for the canonical list.)
- Persistence implementation changes.
- SQLite Phase B.
- ABI remediation.
- UI / API / mini-program / auth / cloud / LLM.
- Tightening `additionalProperties: false`.
- Lawyer-letter / contract-review lifecycle state machines (R-9).
- Dedicated work-order entity.
- Controlled vocab for free-text fields (POST-V1).

---

## §3 Decision matrix — R-5 (a)..(j)

| # | Item | Schema | Field name | Type | Required? | Schema invariant | Validator guard? |
|---|---|---|---|---|---|---|---|
| (a) | Document workflow purpose | `case-box-document` | `purpose` | enum | optional-omitted | enum value list (see §3.1) | no |
| (b) | Work-order status | `case-box-document` | `work_order_status` | enum | optional-omitted | enum value list `{open, in_progress, answered, closed}`; **schema invariant (one-way)**: if present, `purpose` MUST be `"work_order"` (via `allOf` conditional). NOT required when `purpose = "work_order"`. | no — schema handles fully |
| (c) | Document lifecycle free-text fields | `case-box-document` | `letter_date`, `service_status`, `client_authorization_summary`, `preliminary_evidence_summary`, `review_date`, `final_version_marker` | string (maxLength 4000) | optional-omitted | none at schema | no (v1; these are free-text; lifecycle state machines are R-9 post-v1) |
| (d) | Document supersession | `case-box-document` | `supersedes_document_id` | ULID or null | optional-omitted | none at schema | yes — persistence must enforce same-matter same-tenant (deferred to persistence WI) |
| (e) | Fact workflow purpose | `case-box-fact` | `purpose` | enum | optional-omitted | enum value list (see §3.2) | no |
| (f) | Fact as-of date | `case-box-fact` | `as_of_date` | string (date-only, ISO 8601 `YYYY-MM-DD`) or null | optional-omitted (any purpose). Conditional: when `purpose = "timeline_event"`, MUST be a non-null `YYYY-MM-DD` string. | **schema invariant (one-way)**: when `purpose = "timeline_event"`, `as_of_date` is required-and-non-null. For all other `purpose` values (including absent), `as_of_date` is optional and MAY be absent, present-as-date, or explicit-null. MUST NOT carry time component (`format: "date"`). | no — schema handles fully; `assertValidNewFact` already enforces lifecycle invariants unchanged |
| (g) | Evidence party side | `case-box-evidence-item` | `party_side` | enum `{our, opposing}` or null | optional-omitted | none at schema | no |
| (h) | Matter successor link | `case-box-matter` | `successor_matter_id` | ULID or null | optional-omitted | none at schema | yes — persistence must enforce same-tenant + immutability-of-matter_type (deferred to persistence WI) |
| (i) | Deadline kind extension | `case-box-docket-entry` + `case-box-deadline` | `proposed_kind` / `kind` | enum extension | required (was already required) | enum gains `payment | evidence_submission | appeal` (NOT `hearing` — already present) | no (existing path handles enum) |
| (j) | Matter litigation-specific free-text fields | `case-box-matter` | `case_type_text`, `case_progress_text`, `court_contact_text`, `contention_summary_text` | string (maxLength 4000) | optional-omitted (NOT nullable — implementer pattern per §3.3 is "absent" when the lawyer has not filled the field; explicit `null` is NOT used for R-5(j)) | none at schema | none v1; lawyer-fillable, no validation beyond `maxLength` |

### §3.1 `CaseBoxDocument.purpose` enum (R-5(a))

V1 values:
```
engagement_contract
payment_record
decision_record
court_procedural
counsel_contract
work_order
lawyer_letter
contract_review_input
contract_review_final
screenshot
other
```

**Orthogonal to `doc_type`**: the existing `doc_type` enum `{pleading, contract, correspondence, transcript, exhibit, other}` is a **structural** classification (what kind of document is this physically), while `purpose` is a **workflow-role** classification (why does the lawyer hold it). The two are intentionally orthogonal: a `doc_type = "contract"` with `purpose = "engagement_contract"` is valid and non-redundant; a `doc_type = "correspondence"` with `purpose = "lawyer_letter"` is valid; a `doc_type = "exhibit"` with `purpose = "court_procedural"` is valid (court-filed exhibit). Absent `purpose` defaults to "other" semantically (the field is optional-omitted, not nullable).

**No cross-field invariant** between `doc_type` and `purpose` in v1. (A future controlled-vocab WI may add one; out of scope here.)

### §3.2 `CaseBoxFact.purpose` enum (R-5(e))

V1 values:
```
claim
defense
counterclaim
timeline_event
work_order_result
consultation_q
consultation_a
other
```

Absent `purpose` defaults to "other" semantically.

### §3.3 Optional-vs-nullable convention

For all of (a)..(j):

- **Optional-omitted** is the default. Field is absent from the row when the lawyer has not filled it. The schema lists the field under `properties` without including it in `required`.
- **Nullable-required** is used ONLY when a v1 invariant forces presence-or-explicit-null. The only such field in this WI is **`as_of_date`** under R-5(f): when `purpose = "timeline_event"` it MUST be non-null; otherwise it MAY be omitted OR explicitly null. The schema models this via `allOf` conditional + `anyOf: [{type: "null"}, {type: "string", format: "date"}]`.

This convention matches the existing case-box-contract style (e.g., `case-box-fact.schema.json` already uses `anyOf: [{type: "null"}, ...]` for source provenance fields that are required-when-source_type matches).

---

## §4 Per-schema diff

### §4.1 `case-box-matter.schema.json`

Add to `properties`:

```json
"successor_matter_id": {
  "anyOf": [{ "type": "null" }, { "$ref": "#/$defs/ulid" }],
  "description": "Optional reference to a successor matter. Used for counsel→litigation evolution (R-5(h)). Persistence enforces same-tenant + immutable matter_type."
},
"case_type_text": {
  "type": "string",
  "maxLength": 4000,
  "description": "Free-text case-type descriptor. Lawyer-facing only when matter_type = 'litigation'. POST-V1: controlled vocabulary. (R-5(j))"
},
"case_progress_text": {
  "type": "string",
  "maxLength": 4000,
  "description": "Free-text current-progress descriptor. Lawyer-facing only when matter_type = 'litigation'. POST-V1: lifecycle state machine. (R-5(j))"
},
"court_contact_text": {
  "type": "string",
  "maxLength": 4000,
  "description": "Free-text court contact info. Lawyer-facing only when matter_type = 'litigation'. POST-V1: structured contact entity. (R-5(j))"
},
"contention_summary_text": {
  "type": "string",
  "maxLength": 4000,
  "description": "Free-text summary of parties' main points of contention. Lawyer-facing only when matter_type = 'litigation'. POST-V1: structured sub-entity. (R-5(j))"
}
```

No new `required` entries. No invariant blocks counsel matters from filling these (they remain optional-omitted by lawyer convention; v1 UI restricts surfacing to litigation matters).

`retainer_scope` (existing) is preserved unchanged. The two concepts are distinct: `retainer_scope` describes the lawyer's representation scope; `case_type_text` describes the legal-procedural label of the case. Plan does NOT collapse them.

### §4.2 `case-box-document.schema.json`

Add to `properties`:

```json
"purpose": {
  "enum": [
    "engagement_contract", "payment_record", "decision_record",
    "court_procedural", "counsel_contract", "work_order",
    "lawyer_letter", "contract_review_input", "contract_review_final",
    "screenshot", "other"
  ],
  "description": "Workflow-role classification. Orthogonal to doc_type. Absent = 'other'. (R-5(a))"
},
"work_order_status": {
  "enum": ["open", "in_progress", "answered", "closed"],
  "description": "Lifecycle of a work-order document. Present only when purpose = 'work_order'. (R-5(b))"
},
"supersedes_document_id": {
  "anyOf": [{ "type": "null" }, { "$ref": "#/$defs/ulid" }],
  "description": "Optional reference to a prior document this one supersedes (e.g. contract_review_final supersedes contract_review_input). Persistence enforces same-matter same-tenant. (R-5(d))"
},
"letter_date": { "type": "string", "maxLength": 2000, "description": "Free-text date descriptor for purpose = 'lawyer_letter'. R-5(c) is explicit free-text — NOT a typed date. v1 captures whatever the lawyer wrote on the letter (e.g. '2025年六月初', '6/15/2025', '15 June 2025'). POST-V1: structured date once lifecycle state machine ships. (R-5(c))" },
"service_status": { "type": "string", "maxLength": 2000, "description": "Free-text service / delivery status for purpose = 'lawyer_letter'. (R-5(c))" },
"client_authorization_summary": { "type": "string", "maxLength": 4000, "description": "Free-text client authorization summary for purpose = 'lawyer_letter'. (R-5(c))" },
"preliminary_evidence_summary": { "type": "string", "maxLength": 4000, "description": "Free-text preliminary evidence summary for purpose = 'lawyer_letter'. (R-5(c))" },
"review_date": { "type": "string", "maxLength": 2000, "description": "Free-text review date descriptor for purpose = 'contract_review_*'. R-5(c) is explicit free-text — NOT a typed date. v1 captures whatever the lawyer recorded. POST-V1: structured date once lifecycle state machine ships. (R-5(c))" },
"final_version_marker": { "type": "string", "maxLength": 2000, "description": "Free-text marker on the final-revision document for purpose = 'contract_review_final'. (R-5(c))" }
```

Add `allOf` block (for R-5(b) cross-field invariant):

```json
"allOf": [
  {
    "if": { "properties": { "purpose": { "const": "work_order" } }, "required": ["purpose"] },
    "then": {},
    "else": { "not": { "required": ["work_order_status"] } }
  }
]
```

(Encoding: `work_order_status` MAY exist only when `purpose = "work_order"`. When `purpose` is anything else or omitted, `work_order_status` MUST NOT be present.)

Lifecycle free-text fields ((c)) intentionally have NO schema-level invariants linking them to specific `purpose` values — v1 treats them as informational. A lawyer accidentally setting `letter_date` on a non-`lawyer_letter` document is not corrupt data, just irrelevant. POST-V1 lifecycle ADRs (R-9) introduce strict linkage.

### §4.3 `case-box-fact.schema.json`

Add to `properties`:

```json
"purpose": {
  "enum": [
    "claim", "defense", "counterclaim", "timeline_event",
    "work_order_result", "consultation_q", "consultation_a", "other"
  ],
  "description": "Workflow-role classification. Absent = 'other'. (R-5(e))"
},
"as_of_date": {
  "anyOf": [
    { "type": "null" },
    { "type": "string", "format": "date" }
  ],
  "description": "Optional date-only as-of marker. Required (non-null) when purpose = 'timeline_event'. Date-only (no time component). (R-5(f))"
}
```

Add to `allOf` (for R-5(f) conditional):

```json
{
  "if": { "properties": { "purpose": { "const": "timeline_event" } }, "required": ["purpose"] },
  "then": {
    "properties": {
      "as_of_date": { "type": "string", "format": "date" }
    },
    "required": ["as_of_date"]
  }
}
```

(Encoding: when `purpose = "timeline_event"`, `as_of_date` MUST be present and MUST be a non-null date string.)

The existing fact-lifecycle invariants (status candidate → reviewed → accepted / rejected; source_type rules; supersedes chain) are PRESERVED unchanged — the new fields do not interact with them.

### §4.4 `case-box-evidence-item.schema.json`

Add to `properties`:

```json
"party_side": {
  "anyOf": [
    { "type": "null" },
    { "enum": ["our", "opposing"] }
  ],
  "description": "Optional marker for which party introduced the evidence. v1 covers §7.A 'evidence list for both parties'. (R-5(g))"
}
```

No new invariant. Existing evidence lifecycle (proposed → accepted / rejected / superseded; `supersedes_evidence_id` required when superseded) is unchanged.

### §4.5 `case-box-docket-entry.schema.json` (R-5(i))

`proposed_kind` enum gains exactly three values: `payment`, `evidence_submission`, `appeal`. `hearing` is already present and unchanged.

Final enum: `["statute_of_limitations", "court_order", "discovery", "filing", "hearing", "internal", "payment", "evidence_submission", "appeal"]`.

### §4.6 `case-box-deadline.schema.json` (R-5(i))

`kind` enum mirrors docket-entry's `proposed_kind`. Same three values added. Same order.

The Step-6 ADR's drift-guard between schema enum and TS constant must be updated; the test that compares the two arrays will catch any drift automatically.

### §4.7 ADR amendments

- `docs/adr/case-box-step-0-boundary.md`: append a one-paragraph note to §1 entity list noting R-5 additive fields, with a forward reference to this plan.
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md`: append a one-paragraph note explaining `purpose` and `as_of_date` are additive, do not affect the no-auto-accept invariant.
- `docs/adr/case-box-step-6-deadline-docketing-rules.md`: append a one-paragraph note explaining the kind vocabulary extension and which fixtures cover the new values.

NO existing decision text is rewritten. The amendments are pure additive cross-reference.

---

## §5 New invariants

| # | Invariant | Schema-layer or validator-layer? | Helper / test |
|---|---|---|---|
| INV-1 | One-way constraint: if `work_order_status` is present, then `purpose` MUST be `"work_order"`. The field is NOT required even when `purpose = "work_order"` (a work-order document MAY omit `work_order_status`; the schema does not force it). | Schema (allOf if/then/else, encoded one-way) | Three valid fixtures (work_order with status; work_order without status; non-work_order without status); two invalid fixtures (non-work_order WITH status; status without purpose at all). |
| INV-2 | Required-when-timeline-event: `as_of_date` MUST be a non-null `YYYY-MM-DD` string when `purpose = "timeline_event"`. For all other `purpose` values (including absent `purpose`), `as_of_date` is optional and MAY be present or absent. Explicit `null` is allowed for non-timeline_event cases. | Schema (allOf if/then) — one-way only | Four valid fixtures (timeline_event with date; non-timeline_event without date; non-timeline_event with explicit null; non-timeline_event WITH a valid date — proves the field is allowed everywhere); two invalid fixtures (timeline_event without `as_of_date`; timeline_event with `as_of_date = null`). |
| INV-3 | `as_of_date` is date-only (no time component) | Schema (`format: "date"` enforced via Ajv2020 + ajv-formats; the existing `ajv-instance.ts` already validates `format` as strict for date) | One valid (`"2024-09-15"`); one invalid (`"2024-09-15T10:00:00Z"` rejected because `format: "date"` requires `YYYY-MM-DD`). NO validator-layer guard added; Ajv2020+ajv-formats per the existing `ajv-instance.ts` is sufficient. |
| INV-4 | Document `supersedes_document_id` same-matter same-tenant | Validator + persistence (deferred to persistence WI) | Schema cannot enforce cross-row constraints; this plan adds an `assertValidDocumentSupersession` helper for contract-layer callers; persistence WI enforces at write time. |
| INV-5 | Matter `successor_matter_id` same-tenant + the successor's `matter_type` differs from the original | Validator + persistence (deferred to persistence WI) | Same rationale as INV-4. Plan adds `assertValidMatterSuccessor` helper; persistence enforces at write time. |

INV-4 and INV-5 are recorded here for traceability; their persistence-layer enforcement is part of the follow-up persistence WI (see §8).

---

## §6 Validators + helpers

### §6.1 Validator updates (mechanical)

Each of `validateMatter.ts`, `validateDocument.ts`, `validateFact.ts`, `validateEvidenceItem.ts`, `validateDocketEntry.ts`, `validateDeadline.ts` picks up the new properties via Ajv recompile. No function-signature changes; the public `validate*` shape `{ ok: true, value } | { ok: false, summary, errors }` is preserved.

### §6.2 New invariant helpers

Add a NEW file `src/matter-type-invariants.ts` (sibling of the existing `fact-invariants.ts`, `docket-invariants.ts`, `privilege-invariants.ts`, `confidentiality-invariants.ts` pattern). Existing `invariants.ts` is NOT extended.

Helpers to export (re-exported through `src/index.ts` per existing convention):

- `assertValidDocumentSupersession({ doc, prior }) -> void | throws` — enforces same-matter same-tenant.
- `assertValidMatterSuccessor({ original, successor }) -> void | throws` — enforces same-tenant + different matter_type.

`src/index.ts` gains two new exports: `assertValidDocumentSupersession`, `assertValidMatterSuccessor`. The `exports.test.mjs` sweep test catches export drift automatically.

Both are pure functions; no Ajv dependency; testable without runtime. Persistence-layer enforcement of INV-4 and INV-5 is OUT OF SCOPE for this WI (deferred to persistence absorption WI).

### §6.3 Existing helpers — extend

- `assertValidNewFact` (Step-2): no change required by this WI; the new `purpose` + `as_of_date` are validated by schema. But add explicit test coverage that `assertValidNewFact` continues to reject machine-source facts with `status !== "candidate"` regardless of new fields.
- `assertValidDocketEntryConfirmation` (Step-6): no change required; new `kind` values share the existing confirmation lifecycle.

---

## §7 Test plan

### §7.1 Fixtures

New valid fixtures (placed under `fixtures/valid/`):

| Fixture filename | Exercises |
|---|---|
| `matter-litigation-with-all-r5j.valid.json` | All four R-5(j) free-text fields populated on a litigation matter. |
| `matter-advisory-minimal.valid.json` | Advisory (counsel) matter with no R-5(j) fields (proves they remain optional). |
| `matter-counsel-with-litigation-successor.valid.json` | `matter_type = "advisory"` row with `successor_matter_id` populated, pointing to a follow-on `matter_type = "litigation"` row (the workaround for counsel→litigation evolution per the matter-type-immutability rule). |
| `document-engagement-contract.valid.json` | `purpose = "engagement_contract"`, `doc_type = "contract"`. |
| `document-payment-record.valid.json` | `purpose = "payment_record"`. |
| `document-decision-record.valid.json` | `purpose = "decision_record"`. |
| `document-court-procedural.valid.json` | `purpose = "court_procedural"`. |
| `document-counsel-contract.valid.json` | `purpose = "counsel_contract"`. |
| `document-work-order-open.valid.json` | `purpose = "work_order"`, `work_order_status = "open"`. |
| `document-work-order-without-status.valid.json` | `purpose = "work_order"`, no `work_order_status` — proves the field is optional even for work-order documents. |
| `document-lawyer-letter-with-lifecycle-fields.valid.json` | `purpose = "lawyer_letter"` + `letter_date` (free-text) + `service_status` + `client_authorization_summary` + `preliminary_evidence_summary`. |
| `document-contract-review-input.valid.json` | `purpose = "contract_review_input"`. |
| `document-contract-review-final-supersedes.valid.json` | `purpose = "contract_review_final"` + `supersedes_document_id` pointing to a `contract_review_input` row + `review_date` (free-text) + `final_version_marker`. |
| `document-screenshot.valid.json` | `purpose = "screenshot"`. |
| `document-lifecycle-fields-on-non-matching-purpose.valid.json` | `purpose = "other"` with `letter_date` and `service_status` populated — proves lifecycle free-text fields are deliberately loose for v1 (no invariant linking them to `purpose`). |
| `fact-claim.valid.json` | `purpose = "claim"`. |
| `fact-defense.valid.json` | `purpose = "defense"`. |
| `fact-counterclaim.valid.json` | `purpose = "counterclaim"`. |
| `fact-timeline-event-with-date.valid.json` | `purpose = "timeline_event"`, `as_of_date = "2025-06-15"`. |
| `fact-non-timeline-with-date.valid.json` | `purpose = "claim"`, `as_of_date = "2024-01-15"` — proves `as_of_date` is allowed for any purpose. |
| `fact-non-timeline-with-null-date.valid.json` | `purpose = "other"`, `as_of_date = null` — proves explicit-null is allowed for non-timeline. |
| `fact-work-order-result.valid.json` | `purpose = "work_order_result"`, linked to a `work_order` document via `source_document_id`. |
| `fact-consultation-q.valid.json` | `purpose = "consultation_q"`. |
| `fact-consultation-a.valid.json` | `purpose = "consultation_a"`. |
| `evidence-item-with-party-side-our.valid.json` | `party_side = "our"`. |
| `evidence-item-with-party-side-opposing.valid.json` | `party_side = "opposing"`. |
| `docket-entry-proposed-payment.valid.json` | `proposed_kind = "payment"`. |
| `docket-entry-proposed-evidence-submission.valid.json` | `proposed_kind = "evidence_submission"`. |
| `docket-entry-proposed-appeal.valid.json` | `proposed_kind = "appeal"`. |
| `deadline-payment.valid.json` | `kind = "payment"`. |
| `deadline-evidence-submission.valid.json` | `kind = "evidence_submission"`. |
| `deadline-appeal.valid.json` | `kind = "appeal"`. |

New invalid fixtures (`fixtures/invalid/`):

| Fixture filename | Exercises | Expected violation |
|---|---|---|
| `document-work-order-status-without-purpose.invalid.json` | `work_order_status = "open"`, `purpose` absent entirely | INV-1 fails (one-way: status present requires purpose=work_order). |
| `document-work-order-status-with-wrong-purpose.invalid.json` | `work_order_status = "open"`, `purpose = "engagement_contract"` | INV-1 fails. |
| `fact-timeline-event-without-as-of-date.invalid.json` | `purpose = "timeline_event"`, `as_of_date` absent | INV-2 fails. |
| `fact-timeline-event-with-null-as-of-date.invalid.json` | `purpose = "timeline_event"`, `as_of_date = null` | INV-2 fails (timeline_event requires non-null). |
| `fact-as-of-date-with-time-component.invalid.json` | `as_of_date = "2024-09-15T10:00:00Z"` | INV-3 fails (Ajv2020 + ajv-formats strict `format: "date"`). |

Each invalid fixture carries `_invalid_reason` and `_target_schema` per the existing fixture convention.

### §7.2 Test suite additions

`contract.test.mjs` — sweep test pins new fixture list against explicit-test list (existing pattern).

`validators.test.mjs` — for each new valid fixture, assert `validate*` returns `ok: true`; for each new invalid fixture, assert `ok: false` with the expected schema error key.

`invariants.test.mjs` — direct assertions for `assertValidDocumentSupersession`, `assertValidMatterSuccessor`, and the unchanged behavior of `assertValidNewFact` + `assertValidDocketEntryConfirmation` under new fields.

`state-machine.test.mjs` — no change (state machines are not extended in this WI).

### §7.3 Test command

```
npm --prefix docs/contracts/case-box-contract test
```

Must pass green before commit. Pre-existing OCR-contract tests are unaffected; run for safety:

```
npm --prefix docs/contracts test
```

---

## §8 Persistence downstream impact (reference only; NOT touched in this WI)

The existing in-memory persistence (`services/case-box-persistence/src/inMemory*.ts`, Phase A1-A9) writes and reads rows by value. New optional fields are absorbed trivially:

- **Writers** (`inMemoryMatterRepo.saveMatterOnce`, `inMemoryDocumentRepo.saveDocumentOnce`, etc.): the input shape is widened by TypeScript regeneration of `generated/` types; old callers that omit the new fields continue to work because the fields are optional-omitted.
- **Readers** (`inMemoryAggregations.ts`, list/get helpers): existing readers ignore the new fields. New read paths that surface them are introduced by the follow-up persistence WI, not by this one.

Persistence INV-4 and INV-5 enforcement (`supersedes_document_id` same-matter same-tenant; `successor_matter_id` same-tenant + different matter_type) are **deferred** to the persistence absorption WI. This contract WI ships the invariant helpers; the persistence WI wires them into the Once writers.

Expected downstream changes (FOR THE FOLLOW-UP WI — NOT FOR THIS WI):

1. `inMemoryDocumentRepo.saveDocumentOnce` calls `assertValidDocumentSupersession` when `supersedes_document_id` is set.
2. `inMemoryMatterRepo.saveMatterOnce` calls `assertValidMatterSuccessor` when `successor_matter_id` is set; the original matter's `matter_type` is loaded to verify the differ-rule.
3. `inMemoryAggregations.ts` may gain reader projections (e.g., timeline_event facts ordered by `as_of_date`) — but only when a downstream UI WI demands it.
4. Audit-event emission for new fields uses the EXISTING `entity_type` enum — no audit-event-schema change is needed because we are extending row shapes, not adding new entity types (verified in §4).

A1-A9 behavior is preserved exactly as-is by this WI. The follow-up persistence WI explicitly re-runs the existing inMemory.conformance.test.mjs before adding any new test.

---

## §9 Migration risk

- **Live data**: none. Pre-production.
- **Existing in-memory persistence**: A1-A9 in-memory only; no on-disk state.
- **SQLite**: Phase B not started; absorbing the new fields BEFORE Phase B begins avoids a schema-migration step later.
- **Existing fixtures**: every existing valid fixture remains valid after this WI's schema diffs (all changes are additive optional fields and additive enum values). Verified by §3 design choice.

**Conclusion**: this is the right time to make this change. Cost of delaying past Phase B start is a schema migration.

---

## §10 Sequencing — what comes after this WI

This WI's commit lands the plan. Implementation is a SEPARATE WI (call it WI-brief-matter-type-impl), opened after this plan's cc-suite review-plan returns READY. The implementation WI:

1. Applies the schema diffs in §4.
2. Adds the validators + helpers in §6.
3. Adds the fixtures + tests in §7.
4. Adds the ADR amendments in §4.7.
5. Runs `npm --prefix docs/contracts/case-box-contract test`.
6. Commits.

After the implementation WI lands, the persistence absorption WI (WI-brief-matter-type-persistence) absorbs the new fields into `services/case-box-persistence/` per §8. The persistence WI MUST run `npm --prefix services/case-box-persistence test` to green before commit.

### §10.1 Hard release-gate ordering

The following ordering is a HARD GATE on downstream v1 case-box work (CLIENT-04 screens, UI, case-box-step-1+ implementation, any read-model expansion that surfaces new R-5 fields):

```
plan (this WI)
  → cc-suite review-plan READY
  → commit plan
  → WI-brief-matter-type-impl (contract code)
    → npm --prefix docs/contracts/case-box-contract test GREEN
    → cc-suite review-plan + audit
    → commit
  → WI-brief-matter-type-persistence (persistence absorption)
    → npm --prefix services/case-box-persistence test GREEN
    → cc-suite review-plan + audit
    → commit
  → downstream v1 case-box WIs UNBLOCK
```

Skipping the persistence WI between the implementation WI and any downstream UI / case-box WI is forbidden. Autopilot MUST treat the persistence absorption WI as a blocker; the autopilot loop stops with reason `PERSISTENCE-ABSORPTION-MISSING` if any downstream v1 case-box WI is opened while the persistence WI has not committed green.

---

## §11 Out of scope (canonical, restated)

- Persistence implementation.
- SQLite Phase B.
- ABI remediation.
- UI / API / mini-program.
- Auth / cloud / sync / LLM.
- Tightening `additionalProperties: false` across schemas.
- R-9 lifecycle state machines.
- Dedicated work-order entity.
- POST-V1 controlled vocab for free-text fields.
- Git push.
- Implementation of this plan (separate WI).

---

## §12 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | **High** | R-5(c) free-text fields (`letter_date`, `service_status`, `review_date`, etc.) are accidentally narrowed to typed `format: "date"` schema fields during implementation, breaking the brief's R-5 contract (which says free-text). This was found in plan revision 1 and corrected; the implementation WI must NOT re-introduce typing. | §4.2 schema diff explicitly types all six R-5(c) fields as `string` with `maxLength` only. NO `format: "date"`. Implementation WI's cc-suite review-plan checks this field-by-field. |
| 2 | Medium | `doc_type` and `purpose` are subtly redundant, and lawyers fill them inconsistently. | §3.1 explicitly documents the orthogonality. v1 UI guidance (out of scope) sets `doc_type` from MIME / file inspection and asks the lawyer for `purpose` only. |
| 3 | Medium | Persistence absorption WI is forgotten and new fields silently never reach storage. | §10.1 makes the persistence WI a HARD release-gate before any downstream v1 case-box WI. Autopilot stops with `PERSISTENCE-ABSORPTION-MISSING`. The brief's Suggested follow-up WIs lists the WI explicitly. |
| 4 | Low | Ajv `format: "date"` may misbehave under unusual ajv-instance config. | Implementation WI verifies the existing `ajv-instance.ts` already uses `Ajv2020` + `ajv-formats`, which validates `format: "date"` strictly out of the box. NO validator-layer guard is added unless the test fixture proves the schema-layer check is insufficient. |
| 5 | Low | `case_type_text` and existing `retainer_scope` get confused by lawyers. | §4.1 documents the distinction; v1 UI labels them distinctly. |
| 6 | Low | Drift between schema enum and TS-constant arrays (deadline kind extension). | Existing Step-6 drift-guard test catches any divergence automatically; implementation WI does NOT need new drift-guard code. |
| 7 | Low | Existing valid fixtures accidentally invalidated by the new `allOf` blocks. | Each existing fixture is exercised by the unchanged sweep test; CI fail-loud if any existing fixture breaks. |

No Critical risks identified.

---

## §13 Open questions

(Each should be reviewed during cc-suite review-plan; none is a blocker absent reviewer pushback.)

1. Should `purpose = "other"` be the schema-level default (explicit `default: "other"`) or remain absent-means-other? Plan picks absent-means-other for forward-compat with future controlled-vocab tightening.
2. Should the Step-6 ADR record `payment | evidence_submission | appeal` with example use cases (litigation: payment deadline = fee installment; evidence_submission = §7.A required deadline kind; appeal = §7.A required), or just the enum addition? Plan picks "enum addition only" — examples belong in the ADR's existing "fixture coverage" table, expanded in the implementation WI's docs.
3. Does INV-1 (`work_order_status` present iff `purpose = "work_order"`) need a corresponding INV for `letter_date` / `service_status` etc. linking to `purpose = "lawyer_letter"`? Plan picks NO for v1 — free-text fields are informational; lifecycle linkage is R-9 (post-v1).
4. Should `as_of_date` apply to non-timeline_event facts too (e.g., a `claim` fact can be "as of" a date)? Plan picks "optional for all, required only for timeline_event" so future use cases are not foreclosed.

---

## §14 Required cc-suite review

This plan is HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" — it changes the case-box contract surface, which is foundational and downstream-affecting. cc-suite review-plan via Path 1 broker is required.

After cc-suite returns READY (or only Low-risk clarifications), the plan is committed. Implementation is a separate WI.

---

## §15 References

- `docs/product/project-requirements-brief.md` (status READY, commit `fe09ea4`) — R-5 source of truth.
- `docs/adr/case-box-step-0-boundary.md` §1 entity list + §"Cross-cutting Invariants".
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md`.
- `docs/adr/case-box-step-6-deadline-docketing-rules.md`.
- `docs/contracts/case-box-contract/schemas/case-box-matter.schema.json` (verified `matter_type` enum already present).
- `docs/contracts/case-box-contract/schemas/case-box-document.schema.json` (verified `doc_type` enum, no `purpose`).
- `docs/contracts/case-box-contract/schemas/case-box-fact.schema.json` (verified no `purpose`, no `as_of_date`).
- `docs/contracts/case-box-contract/schemas/case-box-evidence-item.schema.json` (verified no `party_side`).
- `docs/contracts/case-box-contract/schemas/case-box-docket-entry.schema.json` (verified `hearing` already in enum).
- `docs/contracts/case-box-contract/schemas/case-box-deadline.schema.json` (verified `kind` enum mirrors docket).
- `services/case-box-persistence/src/` (Phase A1-A9 in-memory implementation; reference only).
- `.claude/rules/cc-suite.md` §"High-risk WIs" + §"Required recording".
- `.claude/rules/autonomy.md` (this plan is contract-only docs; no hard-stop triggered).
- `.claude/rules/loc-guardian.md` (new files MUST stay under fail threshold; this WI adds one plan file + ~10 fixtures + 3 ADR amendments — none individually large).

## §16 Stop condition

This plan is stale or superseded when:

- The implementation WI commits and updates `case-box-step-0` ADR with the actual landed field names.
- A future R-5 amendment in the brief tightens the contract (additional fields, lifecycle state machines, etc.) — that amendment opens a new plan, this one stops being authoritative.
- The brief itself is amended away from §7.A / §7.B vertical slice (`docs/product/project-requirements-brief.md` status flips to `AMENDMENT-PENDING-REVIEW`).
