# ADR: Case-Box Step 2 — Fact Promotion and Provenance

## Status

**Accepted** — 2026-05-20. Implements ADR-series Step 2 per `docs/adr/case-box-step-0-boundary.md`. Co-committed with the `CaseBoxFact` schema, validator, state machine, helpers, fixtures, and tests in the same WI as this ADR.

Planning record: `dev-memo/plan-case-box-step-2.md` (revised after Codex plan-review thread `019e45b0`).

This ADR is **additive** to `docs/contracts/case-box-contract/`. No Step-1 schema is modified, no OCR-package file is touched, no persistence / ingestion / review / sync / UI / auth / cloud / LLM code is added.

## Context

`case-box-plan` (now `dev-memo/superseded/case-box-plan.md`) identified a fact entity sitting between OCR-derived document text and lawyer-decided evidence: a candidate statement that may be promoted to source-of-truth after a human review. Step 0 (`docs/adr/case-box-step-0-boundary.md`) recorded the cross-cutting rule that "LLM/automation outputs always land as candidate; lawyer promotion is the only path to accepted" (product invariant #4). Step 1 (`case-box-contract`) shipped seven entities but deliberately omitted `CaseBoxFact` because the no-auto-accept and provenance posture deserved its own design pass.

This ADR fixes that design pass and ships the contract.

## Decision

Adopt `CaseBoxFact` as the eighth case-box entity with the following design.

### 1. Lifecycle — four states, no row-level `superseded`

States: `candidate`, `reviewed`, `accepted`, `rejected`. Terminal: `accepted`, `rejected`.

Allowed transitions, all by `lawyer` actor:

```
candidate → reviewed
candidate → rejected   (shortcut: reject without intermediate review)
reviewed  → accepted   (promotion to source-of-truth — load-bearing)
reviewed  → rejected
```

`candidate → accepted` is **deliberately absent**. This is the load-bearing no-auto-accept gate at the state-machine layer.

Promotions are restricted to `lawyer`. `ingestion`, `coordinator`, `review` actors cannot promote.

### 2. Supersession is a relationship, not a state

A fact in state `accepted` is never re-transitioned. Corrections happen by creating a *new* accepted fact whose `supersedes_fact_id` points to the old accepted fact. Both rows remain in state `accepted`; readers (future `case-box-review` chronology view) filter to the latest fact in each supersession chain.

Direction convention:

- **New (replacement) row** carries `supersedes_fact_id = <old row id>`.
- Old row is **untouched** after acceptance — true to the case-box invariant "accepted facts are immutable".

This deliberately does NOT mirror Step 1's `CaseBoxEvidenceItem`, whose `supersedes_evidence_id` field is required on a row whose own status is `superseded` (a shape that is semantically confused; the field name reads "id I supersede" but the schema places it on the superseded row). Step 2 adopts the cleaner convention going forward; renaming the evidence-item field is a future Step-1 schema-rewrite decision and out of Step-2 scope.

Self-cycle (`id === supersedes_fact_id`) is caught by `assertFactPromotionInvariants` at the validator-helper layer. Broader supersession-graph cycles are not detectable from a single row; **`case-box-persistence` (future WI) MUST detect and reject longer chain cycles before inserting any fact with `supersedes_fact_id` set**. This obligation is recorded here as a hard requirement on the persistence layer.

### 3. Creation rule — no-auto-accept closure

All facts MUST be created with `status = "candidate"`. Without exception.

Enforced in three layers:

1. **Schema** — invariant N1 (see §5) makes a candidate row reject any non-null reviewer / promotion / supersession field. Combined with the top-level required-nullable shape, the only schema-valid "freshly created" row is a candidate-with-null-promotion-fields.
2. **Helper** — `assertValidNewFact(fact)` throws `FactCreationInvariantError` for any new fact whose `status !== "candidate"` OR which carries non-null `reviewer_actor_user_id` / `reviewed_at` / `accepted_at` / `rejected_at` / `rejection_reason` / `supersedes_fact_id`.
3. **Persistence (future)** — `case-box-persistence` MUST call `assertValidNewFact` before every insert. This is the third gate. Persistence-layer enforcement is recorded as a hard requirement on the future persistence WI.

Together, these three gates make it impossible to land an `accepted` machine-extracted fact without an explicit lawyer transition through `reviewed`. The state machine alone is not sufficient because it governs transitions, not inserts (Codex plan-review surfaced this Critical gap and the creation rule closes it).

### 4. Provenance fields

`CaseBoxFact` shape:

- **Identity / scope**: `id`, `tenant_id`, `actor_user_id` (creator), `matter_id`.
- **Statement**: `statement_text` (required, non-empty).
- **Status**: one of `candidate` / `reviewed` / `accepted` / `rejected`.
- **Source provenance**: `source_type` (`lawyer_authored` / `llm_extraction` / `ocr_excerpt` / `imported`), `source_document_id`, `source_page_number`, `source_excerpt`, `source_ocr_job_id` (opaque, READ-ONLY reference to ocr-persistence).
- **Extractor provenance**: `extractor_name`, `extractor_version`, `extraction_confidence` (0..1, informational only).
- **Review trail**: `reviewer_actor_user_id`, `reviewed_at`, `accepted_at`, `rejected_at`, `rejection_reason`.
- **Supersession**: `supersedes_fact_id`.
- **Timestamps**: `created_at`.

Every field is `required` at the top level (with `null` as a valid value for the nullable ones). This mirrors Step 1's "explicit-over-implicit" posture: Ajv `useDefaults` is off, so required-nullable forces every consumer to make the nullable choice explicit at write time.

`source_ocr_job_id` is a free string (not `$ref`-d to OCR's status enum or ULID pattern). This preserves the Step-0 boundary rule "OCR references by value only; no cross-schema `$ref`; no FK".

### 5. Schema invariants (`if/then`)

Eight conditional invariants, each ships with concrete `then.properties` redeclaration to silence Ajv `strictRequired` warnings (matches the post-Step-1-audit pattern):

| # | Trigger | Constraint |
|---|---|---|
| N1 | `status === "candidate"` | reviewer / promotion / supersession fields MUST be null |
| N2 | `status === "reviewed"` | `reviewer_actor_user_id` + `reviewed_at` required; `accepted_at` / `rejected_at` / `rejection_reason` / `supersedes_fact_id` MUST be null |
| N3 | `status === "accepted"` | `reviewer_actor_user_id` + `reviewed_at` + `accepted_at` required; `rejected_at` / `rejection_reason` MUST be null |
| N4 | `status === "rejected"` | `reviewer_actor_user_id` + `reviewed_at` + `rejected_at` + `rejection_reason` required; `accepted_at` / `supersedes_fact_id` MUST be null |
| N5 | `source_type === "lawyer_authored"` | `extractor_name` / `extractor_version` / `extraction_confidence` MUST be null |
| N6 | `source_type === "llm_extraction"` | `extractor_name` required (non-null) |
| N6.5 | `source_type === "imported"` | `extractor_name` required (non-null) |
| N7 | `source_type === "ocr_excerpt"` | `source_document_id` + `source_ocr_job_id` + `source_page_number` + `source_excerpt` required (all non-null) |

Self-cycle and supersession-only-when-accepted are caught by the validator helper, not the schema (no cross-field equality in JSON Schema).

### 6. Public surface additions

Validators: `validateFact`.
State machine: `FACT_STATES`, `TERMINAL_FACT_STATES`, `isTerminalFactState`, `ALLOWED_FACT_EDGES`, `isAllowedFactTransition`, `assertValidFactTransition`, `type FactState`.
Helpers: `assertFactPromotionInvariants`, `assertValidNewFact`, `isFactCandidateOnly`, `factWasMachineExtracted`, `isMachineExtractedCandidate`.
Errors: `FactPromotionInvariantError`, `FactCreationInvariantError`.
Schema: `factSchema` (deep-frozen + structured-cloned).
Type: `type CaseBoxFact` from `src/generated/case-box-fact.ts`.

`exports.test.mjs` guards against drift.

## Consequences

### Positive

- Product invariant #4 ("LLM/automation outputs land as candidate") is enforced at three layers (state machine + schema + creation helper). No single-layer bypass.
- Provenance is rich enough for an LLM round-trip (`extractor_name` + `extractor_version` + `extraction_confidence`) without ever executing an LLM in v1.
- Supersession convention is unambiguous and DOES NOT inherit Step-1 evidence-item's confused field-direction shape.
- OCR subordination is preserved: `source_ocr_job_id` is opaque; no cross-schema `$ref`; no FK; verbatim status enums not duplicated.
- v1 ships with an extensible `source_type` set; future additions (e.g. `manual_voice_transcription`) are additive.

### Negative

- One Step-1 evidence-item asymmetry survives this WI: its `supersedes_evidence_id` field shape is semantically confused but not rewritten. A future doc-tidy WI may rename it to `superseded_by_evidence_id` to align with Step-2's convention; that's a breaking change for any downstream consumer and stays out of Step-2 scope.
- `assertValidNewFact` enforcement depends on persistence calling it. Until `case-box-persistence` lands, the creation rule is documented-but-unenforced at the storage layer. This ADR records the persistence obligation; the implementer of `case-box-persistence` MUST honour it.
- Supersession-chain cycle detection is split between contract (self-cycle) and persistence (longer cycles). Documented in three places (this ADR, README, plan §11) to prevent the obligation from getting lost.
- 18-field schema is the largest case-box entity. Maintenance burden is real but bounded; further provenance fields (token counts, tool-use trace, redaction state) are additive evolutions, not v1 requirements.

### Neutral

- OCR pipeline unchanged.
- AGENTS.md unchanged.
- No new runtime dependency (ajv + ajv-formats already present).
- All Step-1 schemas + tests unchanged.

## Cross-references

- `docs/adr/case-box-step-0-boundary.md` — the boundary this ADR ships inside; product invariant #4 is the load-bearing requirement.
- `docs/product/project-requirements-brief.md Appendix A` — cross-cutting invariant #4 ("LLM/automation outputs land as candidate").
- `dev-memo/plan-case-box-step-2.md` — implementation plan; this ADR is the authoritative version of the decisions in §3–§7 of the plan.
- `dev-memo/superseded/case-box-plan.md` — historical pre-Phase-0 plan; `fact` shape sketched here.
- `docs/contracts/case-box-contract/schemas/case-box-fact.schema.json` — schema.
- `docs/contracts/case-box-contract/src/fact-invariants.ts` — `assertValidNewFact`, `assertFactPromotionInvariants`.
- `docs/contracts/case-box-contract/src/transitions.ts` — `FactState`, `ALLOWED_FACT_EDGES`, `assertValidFactTransition`.
- `docs/contracts/case-box-contract/tests/*.test.mjs` — test coverage for every invariant and helper.

## Not in scope

- Persistence (`case-box-persistence` is a future WI; this ADR records its obligations).
- Database / SQLite tables / DDL.
- Ingestion (case-create, document-upload, OCR submission).
- Review read-models (chronology, proof matrix).
- UI / desktop shell / sync bridge / HTTP API.
- Auth provider / cloud storage / LLM execution.
- Evidence-item ↔ fact binding (`supporting_fact_id` on `CaseBoxEvidenceItem`).
- Supersession-chain cycle detection beyond self-cycle.
- Renaming `CaseBoxEvidenceItem.supersedes_evidence_id` to align with Step-2's convention.

## Open questions deliberately deferred

1. **LLM-provenance richness**: token counts, tool-use trace, redaction state. Additive evolutions; not v1 requirements.
2. **`imported` source-type richness**: if a future case-management-system-import WI needs external-system row ids, that's an additive field.
3. **Soft-undo of acceptance**: not in v1. A future requirement would add a new state and modify the state machine.
4. **Evidence-item field-direction rename**: deferred to a doc-tidy WI; out of Step-2 scope.

## Addendum (WI-brief-matter-type, 2026-05-22) — `purpose` and `as_of_date` additions

`CaseBoxFact` gains two optional fields per R-5 of the project-requirements-brief (commit `fe09ea4`):

- **`purpose`** (R-5(e)) — enum `{claim, defense, counterclaim, timeline_event, work_order_result, consultation_q, consultation_a, other}`. Optional-omitted; absent means "other" by convention. Lawyer-facing workflow tag; does NOT interact with the no-auto-accept invariant, the source-type rules, or the supersession chain.
- **`as_of_date`** (R-5(f)) — date-only ISO string (`YYYY-MM-DD`) or null; optional everywhere EXCEPT when `purpose === "timeline_event"`, in which case the schema requires it non-null. Encoded as an `allOf` if/then in `case-box-fact.schema.json`.

Both fields are additive. No existing fixture is invalidated. No state-machine edge changes. `assertValidNewFact` and the no-auto-accept invariant are unchanged.

See `dev-memo/plan-brief-matter-type.md` §4.3 for the schema diff and §5 for the invariant table.
