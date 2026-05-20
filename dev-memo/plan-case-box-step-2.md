# CASE-BOX Step 2 — Plan: Fact Promotion and Provenance

**Status**: drafting (revised post plan-review thread `019e45b0`).
**Date**: 2026-05-20.
**Authorizes**: planning only. Implementation requires a follow-up authorization gate.
**Track**: ADR-series Step 2 (`docs/adr/case-box-step-2-fact-promotion-and-provenance.md`, not yet written).
**Out of scope**: persistence, ingestion, review, sync bridge, UI, auth, cloud, LLM execution, OCR worker changes.

---

## 0. Naming conflict to acknowledge

`docs/adr/case-box-step-0-boundary.md` "ADR series phasing" lists:

- **Step 2 = `case-box-step-2-fact-promotion-and-provenance.md`** (this plan's target).

`docs/product/product-target-architecture.md` "Future Work Items" table lists:

- **CASE-BOX Step 2 = `case-box-persistence`** (a different WI).

The two numbering schemes are not aligned. The user's authorization references the **ADR-series Step 2** (fact promotion and provenance), so this plan targets that. The product-target-architecture table is informational and uses an MVP-1-phasing numbering. A future low-priority doc-tidy WI should rename the product-table entries to disambiguate (e.g. "Phase 2 = case-box-persistence"); this plan does not unilaterally edit it.

---

## 1. New domain entities or schema extensions

**One new entity: `CaseBoxFact`.** Step 2 is purely additive. No Step-1 schema is modified.

The existing `CaseBoxEvidenceItem` already covers matter↔document↔page-range binding. `CaseBoxFact` is the underlying *statement-level* entity that an evidence item eventually cites. v1 evidence-item is left untouched; binding evidence-to-fact (`supporting_fact_id`) is a deliberate later step, not Step 2.

---

## 2. Extend case-box-contract, or new package?

**Extend `case-box-contract`.** Same boundary, same vocabulary, same package style. A separate `case-box-fact-contract` would force a second `npm install` with no clear benefit. Mirrors Step 1's "7 entities in one package" choice.

---

## 3. Supersession convention — decide first

The plan-review thread (`019e45b0`) correctly flagged that the original draft contradicted itself on supersession direction AND falsely claimed parity with Step 1. The Step-1 evidence-item schema is itself semantically confused (the field `supersedes_evidence_id` reads as "id I supersede" but is required on the row whose own status is `superseded`). Resolving that is out of Step-2 scope.

Step 2 adopts a clean, unambiguous convention that does NOT mirror Step 1's confused shape:

| Concept | Step 2 convention |
|---|---|
| Field name | `supersedes_fact_id` (nullable ULID) |
| Direction | **The new (replacement) row's `supersedes_fact_id` points to the old row.** |
| Row whose field is set | The **new** accepted fact, not the old one. |
| Old fact's state when replaced | Stays `accepted`. Accepted facts are immutable per ADR cross-cutting invariant #6. |
| Row-level "superseded" state | **None.** There is no `superseded` row state. Supersession is a relationship-level concept only. |
| Validation | Self-cycle ban (`supersedes_fact_id !== id`) at validator-helper level. Broader cycle detection deferred to persistence. |
| Read-model behavior | Future `case-box-review` chronology view filters to "latest fact per supersession chain"; that's a derivation, not a state. |

This means:
- **`supersedes_fact_id` can only be set on rows whose own `status` is `accepted`.** (You can't write a candidate that already claims to supersede; supersession only takes effect once the new fact is accepted.)
- **Old fact's row never changes after acceptance.** This honors the case-box-plan invariant "Accepted facts are immutable; corrections require new fact + supersedes".
- **Schema does NOT need an `accepted → superseded` edge.** It does not exist.

Documented explicitly in the schema description + README + ADR so a future reader does not reverse it.

---

## 4. Proposed state machine for fact lifecycle

**Four states. No row-level "superseded" state.**

| State | Meaning | Terminal? |
|---|---|---|
| `candidate` | Default initial state for every fact regardless of source. Any extractor (lawyer, LLM, OCR excerpt, import) creates here. | No |
| `reviewed` | A human (lawyer) has examined the candidate but has not yet decided. Useful as a "marked for later" worklist anchor. | No |
| `accepted` | A human has affirmed the fact. Immutable; replacements happen via a new accepted fact whose `supersedes_fact_id` points here. | **Yes** |
| `rejected` | A human has refused the fact. Immutable. | **Yes** |

Allowed edges (`ALLOWED_FACT_EDGES`):

| # | From | To | Actor | Note |
|---|---|---|---|---|
| 1 | `candidate` | `reviewed` | `lawyer` | lawyer examined this candidate |
| 2 | `candidate` | `rejected` | `lawyer` | shortcut: reject without intermediate review |
| 3 | `reviewed` | `accepted` | `lawyer` | promotion to SoT |
| 4 | `reviewed` | `rejected` | `lawyer` | reject after review |

Edges deliberately **excluded**:

| From | To | Why excluded |
|---|---|---|
| `candidate` | `accepted` | **Bans auto-promote.** A fact MUST transit through `reviewed` (= a lawyer looked at it) before becoming `accepted`. Load-bearing for no-auto-accept. |
| `reviewed` | `candidate`, `*` → `candidate` | A fact never returns to candidate. Re-add = create a new fact. |
| `accepted` | `*` | Accepted facts are immutable; replacement = new accepted fact + `supersedes_fact_id`. |
| `rejected` | `*` | Rejected is terminal. Re-add = create a new fact. |
| any non-`lawyer` actor for promotions | — | Promotions restricted to `by: ["lawyer"]`. |

Terminal:

```ts
TERMINAL_FACT_STATES = Object.freeze(["accepted", "rejected"] as const);
```

`accepted` IS terminal because the state machine has no out-edges; supersession is a relationship, not a transition (see §3).

---

## 5. Initial-state rule (creation-time enforcement)

The state machine governs transitions only. Codex plan-review flagged (Critical) that without a creation-rule, a caller could insert a row directly in `status="accepted"`, fully populate the reviewer fields, and bypass the state machine entirely.

**Closed by an explicit creation rule:**

> **All facts MUST be created with `status = "candidate"`. Without exception.**

Enforced by:

1. **Schema-level** — `if status === "candidate" then reviewer_actor_user_id / reviewed_at / accepted_at / rejected_at / rejection_reason MUST be null` (invariant N1 in §6). The combination "created row + non-candidate status" is therefore detectable: a freshly-created row carries the supersession + acceptance fields, but the schema rejects any non-candidate row that lacks the corresponding reviewer fields. There is no shape that is BOTH "freshly created" AND "non-candidate" AND "schema-valid".
2. **Helper-level** — new helper `assertValidNewFact(fact)`:
   - Throws `FactCreationInvariantError` if `fact.status !== "candidate"`.
   - Throws if `fact.supersedes_fact_id !== null` (you can't create a candidate that already claims supersession; supersession is set on the *new accepted* fact at promotion time, in a write that ingestion/persistence routes).
   - Throws if `fact.reviewer_actor_user_id !== null` / `reviewed_at !== null` / `accepted_at !== null` / `rejected_at !== null` / `rejection_reason !== null`.
   - Test-enforced: `validators.test.mjs` covers positive and every-negative-permutation of these.
3. **Persistence-level** — `case-box-persistence` (later step) MUST call `assertValidNewFact` before any insert. **This is a recorded requirement for the persistence WI, captured in §10 audit questions and §11 risks so it does not get lost.**

The combination of (1) schema invariant + (2) creation helper makes no-auto-accept enforced at the contract layer. Persistence calling the helper is the third gate.

---

## 6. Provenance fields and schema invariants

`CaseBoxFact` shape (proposed, JSON Schema 2020-12):

```jsonc
{
  "id": "ULID",                                  // required
  "tenant_id": "string",                         // required
  "actor_user_id": "string",                     // required — creator
  "matter_id": "ULID",                           // required
  "statement_text": "string",                    // required, minLength 1
  "status": "candidate|reviewed|accepted|rejected",  // required

  // --- Source-of-fact provenance ---
  "source_type": "lawyer_authored|llm_extraction|ocr_excerpt|imported",  // required
  "source_document_id":  "ULID | null",          // required (nullable); points to CaseBoxDocument
  "source_page_number":  "integer | null",       // required (nullable); 1-based
  "source_excerpt":      "string | null",        // required (nullable); the text the fact derives from
  "source_ocr_job_id":   "string | null",        // required (nullable); opaque READ-ONLY ref to ocr-persistence

  // --- Extractor provenance (machine sources) ---
  "extractor_name":       "string | null",       // required (nullable)
  "extractor_version":    "string | null",       // required (nullable)
  "extraction_confidence": "number | null",      // required (nullable); 0.0..1.0; informational only

  // --- Review / promotion provenance ---
  "reviewer_actor_user_id": "string | null",     // required (nullable); set when status leaves "candidate"
  "reviewed_at":            "date-time | null",  // required (nullable); set when reviewer_actor_user_id is set
  "accepted_at":            "date-time | null",  // required (nullable); set iff status === "accepted"
  "rejected_at":            "date-time | null",  // required (nullable); set iff status === "rejected"
  "rejection_reason":       "string | null",     // required (nullable); minLength 1 when set; required when status === "rejected"

  // --- Supersession (relationship, not state) ---
  "supersedes_fact_id":  "ULID | null",          // required (nullable); MAY be non-null only when status === "accepted"; MUST !== id

  // --- Timestamps ---
  "created_at": "date-time"                      // required
}
```

### Invariant matrix (encoded via `if/then` and validator helpers)

The seven `if/then` invariants below are numbered N1..N7. Acceptance criterion §9.1 references them by number. Every invariant ships as a JSON-Schema `if/then` clause AND has a corresponding negative-fixture test.

#### N1: candidate fact carries no review or supersession metadata

```jsonc
{
  "if":   { "properties": { "status": { "const": "candidate" } }, "required": ["status"] },
  "then": {
    "properties": {
      "reviewer_actor_user_id": { "type": "null" },
      "reviewed_at":            { "type": "null" },
      "accepted_at":            { "type": "null" },
      "rejected_at":            { "type": "null" },
      "rejection_reason":       { "type": "null" },
      "supersedes_fact_id":     { "type": "null" }
    }
  }
}
```

#### N2: reviewed fact has reviewer + reviewed_at, no accepted/rejected fields

```jsonc
{
  "if":   { "properties": { "status": { "const": "reviewed" } }, "required": ["status"] },
  "then": {
    "required": ["reviewer_actor_user_id", "reviewed_at"],
    "properties": {
      "reviewer_actor_user_id": { "type": "string", "minLength": 1 },
      "reviewed_at":            { "type": "string", "format": "date-time" },
      "accepted_at":            { "type": "null" },
      "rejected_at":            { "type": "null" },
      "rejection_reason":       { "type": "null" },
      "supersedes_fact_id":     { "type": "null" }
    }
  }
}
```

#### N3: accepted fact has reviewer + reviewed_at + accepted_at; rejection fields null

```jsonc
{
  "if":   { "properties": { "status": { "const": "accepted" } }, "required": ["status"] },
  "then": {
    "required": ["reviewer_actor_user_id", "reviewed_at", "accepted_at"],
    "properties": {
      "reviewer_actor_user_id": { "type": "string", "minLength": 1 },
      "reviewed_at":            { "type": "string", "format": "date-time" },
      "accepted_at":            { "type": "string", "format": "date-time" },
      "rejected_at":            { "type": "null" },
      "rejection_reason":       { "type": "null" }
    }
  }
}
```

Note: `supersedes_fact_id` is unconstrained here (MAY be ULID or null). The self-cycle ban is a separate validator-layer check (helper, not schema).

#### N4: rejected fact has reviewer + reviewed_at + rejected_at + rejection_reason; accepted_at null; supersedes_fact_id null

```jsonc
{
  "if":   { "properties": { "status": { "const": "rejected" } }, "required": ["status"] },
  "then": {
    "required": ["reviewer_actor_user_id", "reviewed_at", "rejected_at", "rejection_reason"],
    "properties": {
      "reviewer_actor_user_id": { "type": "string", "minLength": 1 },
      "reviewed_at":            { "type": "string", "format": "date-time" },
      "rejected_at":            { "type": "string", "format": "date-time" },
      "rejection_reason":       { "type": "string", "minLength": 1 },
      "accepted_at":            { "type": "null" },
      "supersedes_fact_id":     { "type": "null" }
    }
  }
}
```

#### N5: lawyer_authored source MUST NOT carry extractor metadata

```jsonc
{
  "if":   { "properties": { "source_type": { "const": "lawyer_authored" } }, "required": ["source_type"] },
  "then": {
    "properties": {
      "extractor_name":        { "type": "null" },
      "extractor_version":     { "type": "null" },
      "extraction_confidence": { "type": "null" }
    }
  }
}
```

#### N6: llm_extraction source MUST carry extractor_name

```jsonc
{
  "if":   { "properties": { "source_type": { "const": "llm_extraction" } }, "required": ["source_type"] },
  "then": {
    "required": ["extractor_name"],
    "properties": {
      "extractor_name": { "type": "string", "minLength": 1 }
    }
  }
}
```

#### N7: ocr_excerpt source MUST carry source_document_id, source_ocr_job_id, source_page_number, source_excerpt

```jsonc
{
  "if":   { "properties": { "source_type": { "const": "ocr_excerpt" } }, "required": ["source_type"] },
  "then": {
    "required": ["source_document_id", "source_ocr_job_id", "source_page_number", "source_excerpt"],
    "properties": {
      "source_document_id":  { "type": "string", "pattern": "^[0-9a-z]{26}$" },
      "source_ocr_job_id":   { "type": "string", "minLength": 1 },
      "source_page_number":  { "type": "integer", "minimum": 1 },
      "source_excerpt":      { "type": "string", "minLength": 1 }
    }
  }
}
```

### `imported` source_type semantics

Plan-review correctly flagged that `imported` had no semantics. Defined:

> **`imported`** = the fact was imported from an external case-management system (e.g. Clio, NetDocuments, a CSV migration script). It is treated as a machine source for promotion purposes (initial status MUST be `candidate`; cannot be auto-accepted). The import process MUST record a synthetic extractor identity in `extractor_name` (e.g. `"clio-import-v1"`, `"csv-import-v1"`) so the lawyer can see the provenance. No invariant requires `source_document_id` etc. — imported facts often arrive without document linkage.

Encoded as an additive invariant **N6.5** (treated as part of N6 family — extends "machine sources need an extractor name"):

```jsonc
{
  "if":   { "properties": { "source_type": { "const": "imported" } }, "required": ["source_type"] },
  "then": {
    "required": ["extractor_name"],
    "properties": {
      "extractor_name": { "type": "string", "minLength": 1 }
    }
  }
}
```

So the total invariant count is N1, N2, N3, N4, N5, N6, N6.5, N7 = **8 if/then clauses** in the schema. Acceptance §9.1 lists all eight explicitly.

### Validator-only checks (not schema)

- **Self-cycle ban**: `supersedes_fact_id === id` → `FactPromotionInvariantError`. Cannot be encoded in pure JSON Schema (no cross-field equality).
- **`supersedes_fact_id` set only when accepted**: validator-helper level (cleaner error than `if/then`'s `oneOf`/`not` combinatorics).
- **Creation rule (`assertValidNewFact`)** from §5.

---

## 7. Validation helpers, state machine, and tests

### TypeScript helpers (new files)

- **`src/validateFact.ts`** — `validateFact(payload: unknown): ValidationResult<CaseBoxFact>`. Same pattern as Step-1 validators. Pure, memoized, no IO.
- **`src/fact-invariants.ts`** (new file; splits cleanly from `invariants.ts` to keep file size manageable):
  - `assertFactPromotionInvariants(fact): void` — runs the validator-only checks (self-cycle, supersedes_fact_id only when accepted). Throws `FactPromotionInvariantError`.
  - `assertValidNewFact(fact): void` — creation-rule guard (§5). Throws `FactCreationInvariantError`.
  - `isFactCandidateOnly(fact): boolean` — `fact.status === "candidate"`.
  - `factWasMachineExtracted(fact): boolean` — `source_type ∈ {"llm_extraction", "ocr_excerpt", "imported"}`.
  - `isMachineExtractedCandidate(fact): boolean` — `factWasMachineExtracted(fact) && isFactCandidateOnly(fact)`. (Renamed from earlier draft's misleading `requiresHumanReviewBeforeAccept`.)

### State machine additions (in existing `transitions.ts`)

- `FactState`, `FACT_STATES`, `TERMINAL_FACT_STATES`, `isTerminalFactState`.
- `ALLOWED_FACT_EDGES` (4 edges from §4) with `reason_required: false` everywhere. `freezeEdges` wraps it.
- `isAllowedFactTransition`, `assertValidFactTransition` (matches existing `assertNonTerminal` + `from === to` + edge-lookup pattern).

Codex plan-review confirmed `transitions.ts` (309 lines at Step 1) can absorb the addition without exceeding maintainability. Confirmed: keep.

### Schema loading (`src/loadSchemas.ts`)

```ts
import factSchema from "../schemas/case-box-fact.schema.json" with { type: "json" };
export { factSchema };
```

(Plan-review flagged this was missing from the original checklist. Now explicit.)

### Public surface (`src/index.ts`)

Add to existing exports:

- Validators: `validateFact`.
- Helpers: `assertFactPromotionInvariants`, `assertValidNewFact`, `isFactCandidateOnly`, `factWasMachineExtracted`, `isMachineExtractedCandidate`.
- Errors: `FactPromotionInvariantError`, `FactCreationInvariantError`.
- State-machine: `FACT_STATES`, `TERMINAL_FACT_STATES`, `isTerminalFactState`, `ALLOWED_FACT_EDGES`, `isAllowedFactTransition`, `assertValidFactTransition`, `type FactState`.
- Schema: `factSchema` (deep-frozen + structuredCloned in the existing block).
- Types: `type CaseBoxFact` from generated.

### Fixtures

| Path | Purpose |
|---|---|
| `fixtures/valid/fact-candidate-lawyer-authored.valid.json` | minimal candidate, lawyer source, all opt-out fields null |
| `fixtures/valid/fact-candidate-llm.valid.json` | LLM-extracted candidate; `extractor_name = "claude-opus-4-7"`, confidence set, reviewer fields null |
| `fixtures/valid/fact-candidate-ocr-excerpt.valid.json` | OCR-excerpt candidate; source_document_id + source_ocr_job_id + page + excerpt all set |
| `fixtures/valid/fact-candidate-imported.valid.json` | imported candidate; `extractor_name = "clio-import-v1"` |
| `fixtures/valid/fact-accepted-lawyer-authored.valid.json` | full review trail; reviewer + reviewed_at + accepted_at set; rejection fields null |
| `fixtures/valid/fact-accepted-supersedes-prior.valid.json` | new accepted fact with `supersedes_fact_id` pointing to a different valid-looking ULID |
| `fixtures/valid/fact-rejected.valid.json` | rejected; reviewer + reviewed_at + rejected_at + rejection_reason set; accepted_at null |
| `fixtures/invalid/fact-candidate-with-accepted-at.json` | candidate but `accepted_at` non-null (N1 violation) |
| `fixtures/invalid/fact-accepted-no-reviewer.json` | accepted but reviewer + reviewed_at + accepted_at all missing (N3 violation) |
| `fixtures/invalid/fact-rejected-no-reason.json` | rejected but `rejection_reason` null (N4 violation) |
| `fixtures/invalid/fact-lawyer-authored-with-extractor.json` | `source_type = "lawyer_authored"` with `extractor_name = "claude"` (N5 violation) |
| `fixtures/invalid/fact-llm-without-extractor-name.json` | `source_type = "llm_extraction"` with `extractor_name = null` (N6 violation) |
| `fixtures/invalid/fact-imported-without-extractor-name.json` | `source_type = "imported"` with `extractor_name = null` (N6.5 violation) |
| `fixtures/invalid/fact-ocr-excerpt-missing-fields.json` | `source_type = "ocr_excerpt"` with `source_document_id = null` (N7 violation) |

**Self-cycle is NOT a schema-invalid fixture.** It is a *semantic-test-only fixture* under `fixtures/semantic-invalid/fact-superseded-self-cycle.json`. Tests for it use `assertFactPromotionInvariants(...)`, not `validateFact(...)`. Plan-review flagged this; the directory split makes it impossible to accidentally include it in the schema fixture sweep.

### Tests

`contract.test.mjs` — extend with explicit assertions for every valid + invalid fact fixture. Mirrors Step-1 per-fixture style.

`validators.test.mjs` — extend with:
- `validateFact` happy + each-of-7-error paths.
- `assertFactPromotionInvariants`: positive cases per status, self-cycle throws, supersedes_fact_id-when-not-accepted throws.
- `assertValidNewFact`: positive (status=candidate, all opt-out fields null, no supersedes) + every-permutation negative.

`state-machine.test.mjs` — extend with:
- **The load-bearing no-auto-accept test**: `assertValidFactTransition("candidate", "accepted", "lawyer")` throws `IllegalTransitionError`.
- Per-edge per-actor matrix: each legal edge succeeds by `lawyer`; each legal edge throws by `coordinator` / `ingestion` / `review`.
- Terminal-state guards: `accepted → *`, `rejected → *` all throw.
- Self-transitions: all four self-transitions throw.

`invariants.test.mjs` — extend with:
- `isFactCandidateOnly` truth table.
- `factWasMachineExtracted` truth table for all four `source_type` values.
- `isMachineExtractedCandidate` combined test.
- Every fact fixture carries `tenant_id` + `actor_user_id` (same posture as Step 1).

`exports.test.mjs` — extend `expectedFns`, `expectedArrays`, `expectedObjects`, `expectedErrorCtors` with every new symbol.

### Generated types

`scripts/gen-types.mjs` gets one more entry:
```js
{ schema: "case-box-fact.schema.json", name: "CaseBoxFact", out: "case-box-fact.ts" }
```

`npm run gen:types` regenerates `src/generated/case-box-fact.ts`. Committed alongside the schema.

### Mechanical file checklist (explicit, per plan-review)

Files that MUST be added or extended:

| File | Action |
|---|---|
| `docs/contracts/case-box-contract/schemas/case-box-fact.schema.json` | NEW |
| `docs/contracts/case-box-contract/src/loadSchemas.ts` | EXTEND (import + re-export factSchema) |
| `docs/contracts/case-box-contract/src/validateFact.ts` | NEW |
| `docs/contracts/case-box-contract/src/fact-invariants.ts` | NEW (split from `invariants.ts` for size) |
| `docs/contracts/case-box-contract/src/transitions.ts` | EXTEND (FactState + ALLOWED_FACT_EDGES + asserters + error classes if new) |
| `docs/contracts/case-box-contract/src/index.ts` | EXTEND (re-exports + deep-frozen factSchema) |
| `docs/contracts/case-box-contract/src/generated/case-box-fact.ts` | NEW (generated, committed) |
| `docs/contracts/case-box-contract/scripts/gen-types.mjs` | EXTEND (one entry) |
| `docs/contracts/case-box-contract/fixtures/valid/*.json` | 7 NEW |
| `docs/contracts/case-box-contract/fixtures/invalid/*.json` | 7 NEW |
| `docs/contracts/case-box-contract/fixtures/semantic-invalid/*.json` | 1 NEW (self-cycle) — new directory |
| `docs/contracts/case-box-contract/tests/contract.test.mjs` | EXTEND |
| `docs/contracts/case-box-contract/tests/validators.test.mjs` | EXTEND |
| `docs/contracts/case-box-contract/tests/state-machine.test.mjs` | EXTEND |
| `docs/contracts/case-box-contract/tests/invariants.test.mjs` | EXTEND |
| `docs/contracts/case-box-contract/tests/exports.test.mjs` | EXTEND |
| `docs/contracts/case-box-contract/README.md` | EXTEND (entity + invariant docs) |
| `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` | NEW (the ADR is co-committed in the implementation WI; this plan stays as historical record) |

Files that MUST NOT be touched:
- Any Step-1 schema under `docs/contracts/case-box-contract/schemas/case-box-{matter,document,party,deadline,evidence-item,ocr-link,audit-event}.schema.json`.
- Any OCR package (`docs/contracts/{src,schemas,*}` outside `case-box-contract/`, `services/ocr-*`).
- `AGENTS.md` (existing test command already runs the case-box-contract suite).
- `package.json` (no new runtime deps; ajv + ajv-formats already present).
- `tsconfig.json` (no new compilation roots).

---

## 8. Out of scope (per user spec)

- Persistence — no case-box-persistence work. Insert/update/query is a later step.
- Database / SQLite tables / DDL.
- UI — no Mac app screens, no renderer components.
- API / sync bridge / HTTP routes.
- Auth provider — `actor_user_id` and `reviewer_actor_user_id` remain free-form strings.
- Cloud / LLM execution — `extractor_name` etc. are shape-only.
- Evidence-item ↔ fact binding (`supporting_fact_id`) — deferred.
- OCR packages — untouched.
- Cycle detection beyond self-cycle — persistence's job.
- New runtime dependencies — none.

---

## 9. Acceptance criteria

1. `case-box-fact.schema.json` exists, validates with Ajv 2020-12, declares all **eight** `if/then` invariants N1, N2, N3, N4, N5, N6, N6.5, N7 from §6. Every conditional `then` clause redeclares its constrained properties (matches the post-Step-1-audit pattern).
2. `src/generated/case-box-fact.ts` regenerated and committed.
3. `src/validateFact.ts` exists; mirrors Step-1 validator pattern (memoized, pure).
4. `src/fact-invariants.ts` exports `assertFactPromotionInvariants`, `assertValidNewFact`, `isFactCandidateOnly`, `factWasMachineExtracted`, `isMachineExtractedCandidate`, `FactPromotionInvariantError`, `FactCreationInvariantError`.
5. `src/transitions.ts` extended with `FactState`, `FACT_STATES`, `TERMINAL_FACT_STATES = ["accepted", "rejected"]`, `ALLOWED_FACT_EDGES` (4 edges), `isAllowedFactTransition`, `assertValidFactTransition`.
6. `src/index.ts` re-exports every new symbol; `exports.test.mjs` proves it.
7. `src/index.ts` deep-freezes `factSchema` via the existing structuredClone+deepFreeze block.
8. `scripts/gen-types.mjs` extended with the fact entry; running it produces no unexpected diff in other generated files.
9. `case-box-contract` test suite green; Step-1's 76 tests stay green; new tests bring the total higher.
10. OCR contract tests (`npm --prefix docs/contracts test`) stay 102/102 green.
11. `node --test` emits **zero Ajv `strictRequired` warnings** (carries the post-Step-1-audit baseline).
12. `tsc -p docs/contracts/case-box-contract/tsconfig.json` passes clean.
13. **No Step-1 schema file is modified.** (Process check: `git diff --name-only HEAD` shows no `case-box-{matter,document,party,deadline,evidence-item,ocr-link,audit-event}.schema.json` modifications.)
14. **No OCR-package file modified.** (Process check.)
15. **No persistence / ingestion / review / sync / UI / auth / cloud / LLM file added or modified.** (Process check.)
16. **No new runtime dependency.** (Process check: `package.json` `dependencies` unchanged.)
17. **AGENTS.md unchanged.** (Process check.)
18. README updated to list `CaseBoxFact` + new invariants (including no-auto-accept + supersession-direction notes).
19. ADR `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` written and committed in the same WI as the code.
20. State-machine test `assertValidFactTransition("candidate", "accepted", "lawyer")` throws — recorded as the load-bearing no-auto-accept assertion.
21. Creation-rule test: `assertValidNewFact` rejects every non-candidate initial state.

Acceptance criteria #13–#17 are process / git-diff checks rather than automated tests. They are verified by the implementer at commit time, recorded in the commit message, and the audit step re-checks them.

---

## 10. Audit questions (for post-implementation audit)

1. **No-auto-accept at state-machine level**: does `assertValidFactTransition("candidate", "accepted", "lawyer")` throw `IllegalTransitionError`?
2. **No-auto-accept at creation level**: does `assertValidNewFact({status: "accepted", ...})` throw `FactCreationInvariantError`?
3. **No-auto-accept at schema level**: does an `if status === "candidate"` row with non-null `accepted_at` fail `validateFact`?
4. **Actor gating**: does every promotion edge throw when actor is `coordinator` / `ingestion` / `review`?
5. **Status × field matrix**: do all 7 schema invariants (N1, N2, N3, N4, N5, N6, N6.5, N7) reject every documented negative case?
6. **OCR provenance fullness**: does `ocr_excerpt` reject missing `source_document_id`, `source_ocr_job_id`, `source_page_number`, OR `source_excerpt`?
7. **Imported provenance**: does `imported` reject missing `extractor_name`?
8. **Self-cycle**: does `assertFactPromotionInvariants({id: "X", supersedes_fact_id: "X", status: "accepted", ...})` throw?
9. **Supersession only when accepted**: does `assertFactPromotionInvariants({status: "candidate", supersedes_fact_id: "Y"})` throw? (Documented in §6 validator-only checks.)
10. **Persistence-cycle-detection commitment**: is the future persistence WI explicitly bound to detect graph-walk cycles? (Documented in §5 + recorded as a future-WI gate in the ADR.)
11. **OCR subordination preserved**: does `source_ocr_job_id` remain an opaque string (no `$ref` to OCR schemas)?
12. **Tenant + actor on every fact fixture**: does the invariant test catch a missing one?
13. **Public surface coverage**: does `exports.test.mjs` fail when a new export is silently removed?
14. **Schema deep-freeze**: is `factSchema` frozen at the public boundary?
15. **Validator purity**: no input mutation (Ajv config unchanged from Step 1: `strict: "log"`, `allErrors: true`, no `useDefaults`, no `removeAdditional`).
16. **No strictRequired noise**: do the new `if/then` clauses redeclare constrained properties inside `then.properties`?
17. **No leak of internal error types**: are `FactPromotionInvariantError` and `FactCreationInvariantError` re-exported on purpose, not by accident?
18. **Generated-type stability**: does `npm run gen:types` produce a diff-free result on re-run?
19. **AGENTS.md untouched**: `git diff AGENTS.md` empty after commit.
20. **No new runtime dep**: `git diff package.json package-lock.json` — only metadata if anything.

---

## 11. Risks / open items

- **Persistence cycle-detection commitment must not get lost.** §5 lists it as an obligation. The ADR co-committed with the implementation MUST repeat it. Otherwise, when `case-box-persistence` lands several steps later, an implementer may not realize they own cycle detection.
- **Provenance fields may evolve.** LLM provenance is a moving target (token counts, redaction state, tool-use trace). v1 keeps the minimal `extractor_name` / `extractor_version` / `extraction_confidence` triple; richer provenance is a future additive schema-evolution step. JSON-schema-to-typescript generates `[k: string]: unknown` index signatures, so additional fields will not break existing consumers.
- **Step-1's evidence-item supersession-pointer-direction semantic is confused** (§3 paragraph 1). This plan does NOT fix it. A future doc-tidy WI may rename `supersedes_evidence_id` to `superseded_by_evidence_id` to match the cleaner Step-2 convention — but that is a Step-1 schema rewrite (breaking change for any downstream consumer) and out of Step-2 scope.
- **Naming-conflict bleed-over** between ADR-series Step 2 and product-target-architecture Step 2 (§0). Plan headers + new ADR title are explicit. No automatic doc-renumbering.
- **`imported` source-type semantics still has design space.** v1 treats imported as machine-source-equivalent (must be `candidate` on creation, needs `extractor_name`). If a future case-management-system-import WI needs richer provenance (e.g. external-system row id), that's an additive evolution.
- **`accepted` is terminal** in the state machine. If a future requirement adds e.g. "soft-undo of acceptance", that's a state-machine + schema evolution (likely needs a new state) — out of Step-2 scope.

---

## 12. Plan-review thread

Codex review of the prior draft: thread `019e45b0`. Findings classified and resolved in this revision as follows:

| Codex finding | Resolution |
|---|---|
| D5.1 Critical — no-auto-accept leaks via direct creation | §5 added creation rule + `assertValidNewFact` helper; tested. |
| D1.1 High — supersession direction contradiction + false "mirrors Step 1" claim | §3 picks a clean convention (new row points to old; no row-level `superseded` state); documented as DIVERGENT from Step 1's confused shape. |
| D1.2 High — six vs seven invariants | §6 numbered N1..N7 plus N6.5 for imported; eight total invariants explicit; §9.1 references them by number. |
| D2.1 High — missing negative invariants | §6 N1..N4 fully specify status × field matrix (null required for fields not relevant to the status). |
| D3.1 High — conditional schema shape not concrete | §6 ships concrete JSON snippets for every invariant. |
| D4.1 High — `supersedes_fact_id` semantics ambiguous | §3 fixes direction; §6 + §10 + §11 all repeat the convention. README + ADR + schema description must repeat per acceptance #18. |
| D4.2 High — no-auto-accept undefined for creation | §5 + acceptance #20–21 + audit #2 close this. |
| D2.2 Medium — ocr_excerpt should require source_excerpt + page | N7 in §6 now requires all four ocr-excerpt fields. |
| D2.3 Medium — imported has no semantics | §6 `imported source_type semantics` paragraph + N6.5. |
| D2.4 Medium — fixture plan too thin; self-cycle wrongly in invalid set | §7 fixtures table now lists 7 valid + 7 invalid + 1 semantic-invalid (self-cycle in separate directory). |
| D3.2 Medium — self-cycle isn't schema-failable | §7 moves it to `fixtures/semantic-invalid/`; tests use `assertFactPromotionInvariants`. |
| D3.3 Medium — loadSchemas + index deep-freeze missing | §7 mechanical checklist now explicit. |
| D4.3 Medium — `requiresHumanReviewBeforeAccept` misnamed | §7 renames to `isMachineExtractedCandidate`. |
| D4.4 Medium — process-only acceptance criteria | §9 marks #13–#17 as process / git-diff checks rather than automated tests. |
| D5.3 Medium — cycle-detection deferral risk | §5 + §10 #10 + §11 first bullet + acceptance criterion (recorded in the ADR rather than as a Step-2 test gate). |
| D1.3 Medium — edge-note conflict (cascade of §6) | §4 edge table now reflects 4-edge model; `accepted → superseded` removed. |
| D5.2 High — supersession decision buried in §6 | §3 now decides supersession convention BEFORE §4 state machine. |
| D1.4 Low — "accepted reachable from superseded" wording | Section rewritten; no longer present. |
| D3.4 Low — transitions.ts size | §7 confirms keep-in-place; no split needed for Step 2. |
| D5.4 Low — naming conflict | §0 unchanged; correctly identified. |

---

## 13. References

- `docs/adr/case-box-step-0-boundary.md` — boundary, dependency direction, cross-cutting invariants, ADR-series Step list.
- `docs/product/product-target-architecture.md` — v1 product summary; cross-cutting invariant #4 ("LLM / automation outputs land as candidate") is the load-bearing constraint Step 2 encodes.
- `dev-memo/plan-case-box-step-1.md` — Step 1 plan (Step 2 plan mirrors its structure).
- `dev-memo/superseded/case-box-plan.md` — historical reference for the `fact` shape; this Step 2 plan promotes and tightens it.
- `docs/contracts/case-box-contract/src/transitions.ts` — Step-1 state machines and `AllowedEdge<S>` pattern.
- `docs/contracts/case-box-contract/src/invariants.ts` — Step-1 semantic helpers; Step 2 adds `fact-invariants.ts` for size reasons.
- `docs/contracts/case-box-contract/schemas/case-box-deadline.schema.json` — post-audit-fix `if/then` redeclare-property pattern that Step-2 invariants must mirror.
- `docs/contracts/case-box-contract/schemas/case-box-evidence-item.schema.json` — Step-1 supersession shape (semantically confused; Step 2 documents the divergence in §3 + §11).
- Codex plan-review thread: `019e45b0`.
- `AGENTS.md` — coordinator-ownership rule, mutation policy, Stop-and-Ask gates.
