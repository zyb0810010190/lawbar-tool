# CASE-BOX Step 5 — Plan: Confidentiality Classification Model

**Status**: drafting (revised post plan-review thread `019e47c9`).
**Date**: 2026-05-20.
**Authorizes**: planning only. Implementation requires a follow-up authorization gate (granted by the parent user turn).
**Track**: ADR-series Step 5 (`docs/adr/case-box-step-5-confidentiality-classification.md`, not yet written).
**Out of scope**: persistence, ingestion, review, sync bridge, UI, auth, cloud, LLM execution, OCR worker changes.

---

## 0. Naming acknowledgement

`docs/adr/case-box-step-0-boundary.md` ADR-series Step 5 = `case-box-step-5-confidentiality-no-cloud-default.md` per the original Step-0 list; the user's authorization uses `case-box-step-5-confidentiality-classification.md`. This plan uses the user's filename. Same convention as Step 2/3/4 §0.

---

## 1. The pre-existing matter-level confidentiality

`CaseBoxMatter.confidentiality_class` from Step 1 (enum `["normal", "heightened", "sealed"]`) is the **matter-wide default**. Step 5 does NOT modify it.

Step 0 §5 confidentiality posture is **load-bearing**: "documents never leave local storage unless `confidentiality_class = normal` AND user explicitly authorized external worker for that doc". Plan-review D1.3 / D5.2 caught the original draft trying to undercut this with a "per-item normal in heightened matter" override path. The revised plan honors Step-0: **heightened or sealed matters categorically deny external handling in v1**. Per-item override is a future evolution requiring its own audited declassification surface.

---

## 2. Entity decision

**Add one new entity: `CaseBoxConfidentialityClassification`.** Per-target, append-only (each classification change is a new row), latest row = current classification.

v1 target types: `document`, `fact`. Matter-level classification stays on the matter row (Step 1's `confidentiality_class`). Step 5 does NOT add a `target_type = "matter"` value — that would create two sources of truth for matter classification. Plan-review D4.4 caught the conflict; resolution: matter classification lives ONLY on the matter row.

---

## 3. Classification vocabulary

Per-item levels:

| Level | Meaning |
|---|---|
| `unclassified` | Initial state; lawyer has not classified the item. **Outside the ordinal lattice** (plan-review D4.1) — neither most nor least restrictive in the ordering; rather, an "unset" sentinel. Operationally most restrictive: no external handling allowed. |
| `normal` | Ordinary work product; least restrictive in the ordinal lattice |
| `confidential` | Client-sensitive |
| `highly_confidential` | Strongly sensitive (e.g., trade secret, regulated PII) |
| `restricted` | Most restrictive in the ordinal lattice; air-gapped within the lawyer's workspace; no external handling can be authorized |

Ordinal lattice (least restrictive → most restrictive, for downgrade/upgrade detection on transitions BETWEEN non-unclassified levels):

```
ordinal 1: normal
ordinal 2: confidential
ordinal 3: highly_confidential
ordinal 4: restricted
```

`unclassified` is OUTSIDE the lattice. Transitions:

- **First classification** (`null prior_level` → any level): no downgrade; no reason required.
- **Reset to unclassified** (`<any non-null> → unclassified`): operationally discouraged; reason required.
- **Within lattice** (between two non-unclassified levels):
  - Upgrade (greater ordinal → less): `confidential → highly_confidential` — no reason required.
  - Downgrade (lesser ordinal → greater): `confidential → normal` — reason required.

`privileged` is NOT a classification level. Privilege is a separate dimension handled by Step 3 (`CaseBoxPrivilegeMarker`). The §5 handling-decision helper considers BOTH dimensions.

---

## 4. Schema shape

```jsonc
{
  "id": "ULID",                                  // required
  "tenant_id": "string",                         // required
  "actor_user_id": "string",                     // required — classifying lawyer
  "matter_id": "ULID",                           // required
  "target_type": "document|fact",                // required (matter not in v1; Step 1's matter row carries matter-level)
  "target_id": "ULID",                           // required
  "level": "unclassified|normal|confidential|highly_confidential|restricted",  // required
  "prior_level": "unclassified|normal|confidential|highly_confidential|restricted | null",  // required (nullable; null only on first row for the target)
  "change_reason_code": "discovery_production|client_authorization|court_order|change_in_legal_assessment|data_minimization|reset_to_unset|other | null",  // required (nullable; non-null required for downgrade and for reset-to-unclassified — see C2)
  "change_reason_text": "string | null",          // required (nullable; non-null + minLength 1 required when change_reason_code === "other")
  "set_at": "date-time"                           // required
}
```

Plan-review D2.4: free-text `change_reason` was too weak. v1 adopts a **controlled reason-code enum** + free text. The enum values are listed above. `other` mandates the free-text field, otherwise free-text is optional. Tests cover each enum value.

### Schema invariants (`if/then`)

Four invariants, named C1..C4.

#### C1: change_reason_text is required when change_reason_code === "other"

```jsonc
{
  "if":   { "properties": { "change_reason_code": { "const": "other" } }, "required": ["change_reason_code"] },
  "then": {
    "required": ["change_reason_text"],
    "properties": {
      "change_reason_text": { "type": "string", "minLength": 1 }
    }
  }
}
```

#### C2: change_reason_text must be non-empty string when set

```jsonc
{
  "if":   { "properties": { "change_reason_text": { "type": "string" } }, "required": ["change_reason_text"] },
  "then": {
    "properties": {
      "change_reason_text": { "type": "string", "minLength": 1 }
    }
  }
}
```

#### C3: prior_level === null → first row → change_reason_code MAY be null

(Default; no `if/then` needed because all fields are nullable at the top level.)

#### C4: target_type ∈ {document, fact}

Encoded by the top-level enum.

### Validator-only helpers

Schema cannot enforce cross-row consistency. These belong to TS helpers:

- **`isDowngrade(prior, next)`** — pure helper.
- **`isResetToUnclassified(prior, next)`** — pure helper (any non-null → unclassified).
- **`isFirstClassification(prior, next)`** — `prior === null && next !== null`.
- **`assertValidConfidentialityTransition(prior, next, change_reason_code)`** — throws `ConfidentialityTransitionError` if:
  - downgrade (within lattice, greater ordinal → less) without non-null `change_reason_code`;
  - reset-to-unclassified without non-null `change_reason_code` (or `change_reason_code !== "reset_to_unset"`);
  - upgrade or first-classification with non-null `change_reason_code` — actually no, that's allowed (it's evidence). Helper does NOT forbid extra reasons.
- **`assertValidNewConfidentialityClassification(row, priorRow | null)`** — takes history input (plan-review D3.1):
  - If `priorRow === null`, this is the first classification for the target: `prior_level` MUST be null; otherwise throws.
  - If `priorRow !== null`, `row.prior_level` MUST equal `priorRow.level`; otherwise throws (cross-row consistency).
  - Calls `assertValidConfidentialityTransition(row.prior_level, row.level, row.change_reason_code)`.
  - Throws `ConfidentialityCreationError`.

---

## 5. The handling-decision helper

Plan-review D2.2 / D5.1: original single `explicitOptInPresent: boolean` conflated three distinct opt-ins. Revised input takes three separate flags AND a privilege-clearance state (plan-review D2.1 / D5.1 / D1.1: absence of confirmed marker is NOT clearance).

```ts
export type ExternalAction = "external_ocr" | "sync_transmit" | "llm_extraction";

/**
 * Privilege review state — caller-computed. The contract layer does NOT
 * compute this; it's the caller's responsibility based on privilege
 * markers AND the lawyer's review record.
 *
 * "not_reviewed" is the legal default — the lawyer has not yet
 * confirmed whether the target is privileged. External handling is
 * DENIED.
 *
 * "reviewed_no_privilege_applies" means a lawyer has reviewed and
 * affirmatively determined the target is not subject to any privilege.
 * (v1 has no "lawyer-cleared-as-not-privileged" Step-3 state; this
 * input is the caller's interpretation of dismissed-everywhere +
 * lawyer-action.)
 *
 * "privileged_protected" means at least one confirmed privilege marker
 * is active. External handling DENIED unless explicit per-action waiver
 * exists (out of v1 scope).
 *
 * "privileged_with_waiver" means a confirmed marker exists AND a
 * separate explicit waiver authorizes the specific action. v1: the
 * contract has no waiver entity beyond Step-3's CaseBoxPrivilegeMarker
 * (which only models the marker's own lifecycle); the v1 helper still
 * DENIES this case because the waiver-per-external-action mechanism
 * is post-MVP. Reserved for future.
 */
export type PrivilegeReviewState =
  | "not_reviewed"
  | "reviewed_no_privilege_applies"
  | "privileged_protected"
  | "privileged_with_waiver";

export interface AssertExternalHandlingInput {
  readonly matter: { confidentiality_class: "normal" | "heightened" | "sealed" };
  readonly classifications: ReadonlyArray<CaseBoxConfidentialityClassification>;
  readonly privilegeReviewState: PrivilegeReviewState;
  readonly targetType: "document" | "fact";
  readonly targetId: string;
  readonly externalAction: ExternalAction;
  // Action-specific opt-ins; ALL THREE flags are required for clarity.
  // Caller MUST set each true ONLY when the respective opt-in exists.
  readonly externalOcrAuthorized: boolean;
  readonly syncGrantPresent: boolean;
  readonly llmExtractionOptIn: boolean;
}

export interface HandlingDecision {
  readonly allowed: boolean;
  readonly denialReasons: ReadonlyArray<HandlingDenialReason>;
  readonly evidence: HandlingEvidence;
}

export type HandlingDenialReason =
  | "unclassified_default_denies_external"
  | "classification_restricted"
  | "classification_highly_confidential"
  | "classification_confidential_disallows_action"
  | "matter_heightened"
  | "matter_sealed"
  | "privilege_not_reviewed"
  | "privilege_protected"
  | "missing_action_specific_opt_in"
  | "external_action_not_recognized";

export interface HandlingEvidence {
  readonly effectiveLevel: ConfidentialityLevel;
  readonly matterConfidentialityClass: "normal" | "heightened" | "sealed";
  readonly privilegeReviewState: PrivilegeReviewState;
  readonly externalAction: ExternalAction;
  readonly optInForAction: boolean; // resolved per action
}
```

### Algorithm (revised)

1. **Filter classifications** by `(target_type, target_id)`; pick latest by `set_at` (ties broken by `id` lexicographic). If none, effective level = `unclassified`.
2. **Resolve action-specific opt-in**:
   - `external_ocr` → `externalOcrAuthorized`
   - `sync_transmit` → `syncGrantPresent`
   - `llm_extraction` → `llmExtractionOptIn`
3. **Accumulate denial reasons** (in this order — predictable for tests):
   - If `externalAction` not in v1 enum → `external_action_not_recognized`. Return immediately.
   - **Unclassified default** (load-bearing safety): if effective level === `unclassified` → `unclassified_default_denies_external`.
   - **Restricted**: if effective level === `restricted` → `classification_restricted`.
   - **Highly confidential**: if effective level === `highly_confidential` → `classification_highly_confidential`.
   - **Confidential**: if effective level === `confidential` → `classification_confidential_disallows_action` (v1 HARD DENIES confidential for ALL actions including LLM; plan-review D1.2 resolved). Confidential + LLM is denied in v1; Step 8 LLM-extractor ADR may revisit.
   - **Matter sealed** (Step-0 wording): if matter `confidentiality_class === "sealed"` → `matter_sealed`.
   - **Matter heightened** (Step-0 wording): if matter `confidentiality_class === "heightened"` → `matter_heightened`. (v1: no per-item override; plan-review D1.3.)
   - **Privilege**: if `privilegeReviewState === "not_reviewed"` → `privilege_not_reviewed`; else if `"privileged_protected"` → `privilege_protected`; else if `"privileged_with_waiver"` → `privilege_protected` (v1 helper still denies; reserved for future).
   - **Action-specific opt-in**: if resolved opt-in is `false` → `missing_action_specific_opt_in`.
4. `allowed = denialReasons.length === 0`.
5. Return.

### Multi-denial expected

A typical denial may carry 3+ reasons (e.g., `unclassified_default_denies_external` + `matter_heightened` + `privilege_not_reviewed` + `missing_action_specific_opt_in`). Tests verify each reason fires independently AND verify multi-reason scenarios. Plan-review D2.3 mandated cross-product coverage.

### NO green-light field

`HandlingDecision` has NO `safeToProcess` / `canTransmit` / `approvedForExternal` / `isAllowed` (the actual `allowed` field is OK because callers see the rest of the shape and the type test verifies no synonyms). Compile-time guarded.

---

## 6. Audit-log integration

Three event kinds (plan-review D4.2 dropped OVERRIDDEN):

```ts
CLASSIFICATION_SET:        { action: "create", entity_type: "confidentiality_classification", reasonRequired: false },
CLASSIFICATION_UPGRADED:   { action: "create", entity_type: "confidentiality_classification", reasonRequired: false },
CLASSIFICATION_DOWNGRADED: { action: "create", entity_type: "confidentiality_classification", reasonRequired: true  },
```

`CLASSIFICATION_RESET_TO_UNCLASSIFIED` is a fourth kind (reason required) for the niche "reset to unset" path. Persistence chooses the appropriate kind based on the transition.

Persistence MUST emit one audit event per classification insert.

---

## 7. Tiny additive Step-4 schema change

`case-box-audit-event.schema.json` `entity_type` enum gains `"confidentiality_classification"`. Same shape as Step-4's own additive change. Drift guard catches divergence between schema enum and TS constant.

---

## 8. Lifecycle / state machine

NO row-level state machine. Each row is immutable once written; latest row is current effective level. Transitions are the relationship between consecutive rows.

NO changes to `src/transitions.ts`.

---

## 9. Validators, helpers, fixtures, tests

### TypeScript helpers (new)

- **`src/validateConfidentialityClassification.ts`** — same pattern as Step-1/2/3 validators.
- **`src/confidentiality-invariants.ts`** (new file):
  - `CONFIDENTIALITY_LEVELS = ["unclassified", "normal", "confidential", "highly_confidential", "restricted"]` (frozen).
  - `LATTICE_ORDINAL = { normal: 1, confidential: 2, highly_confidential: 3, restricted: 4 }` (frozen; `unclassified` deliberately absent).
  - `REASON_CODES` (frozen array of enum values).
  - `isDowngrade(prior, next)`, `isResetToUnclassified(prior, next)`, `isFirstClassification(prior, next)`.
  - `assertValidConfidentialityTransition(prior, next, change_reason_code)`.
  - `effectiveConfidentialityLevel(targetType, targetId, classifications)` — picks latest by `set_at`, tie-broken by `id` (plan-review D3.2).
  - `assertExternalHandlingAllowed(input)` — §5 helper.
  - `assertValidNewConfidentialityClassification(row, priorRow | null)` — takes history input (plan-review D3.1).
  - Errors: `ConfidentialityTransitionError`, `ConfidentialityCreationError`.
  - Types: `ConfidentialityLevel`, `PrivilegeReviewState`, `HandlingDecision`, `HandlingDenialReason`, `HandlingEvidence`, `ExternalAction`, `AssertExternalHandlingInput`, `ConfidentialityChangeReasonCode`.

### Public surface (`src/index.ts`)

Every symbol above + the schema (deep-frozen) + generated type.

### Audit-log helpers extension

`CASE_BOX_AUDIT_ENTITY_TYPES` gains `"confidentiality_classification"`. `CASE_BOX_AUDIT_EVENT_KINDS` gains 4 entries (SET, UPGRADED, DOWNGRADED, RESET_TO_UNCLASSIFIED).

### Schema-changes drift guard

Step-4 already has a drift-guard test asserting schema `entity_type.enum` matches TS `CASE_BOX_AUDIT_ENTITY_TYPES`. Both must update together; test catches divergence automatically.

### Fixtures

| Path | Purpose |
|---|---|
| `fixtures/valid/confidentiality-first-normal.valid.json` | first row; prior_level null; level normal; no reason |
| `fixtures/valid/confidentiality-first-restricted.valid.json` | first row; prior_level null; level restricted |
| `fixtures/valid/confidentiality-upgrade.valid.json` | prior normal → confidential; no reason |
| `fixtures/valid/confidentiality-downgrade-with-reason.valid.json` | prior confidential → normal; change_reason_code=client_authorization |
| `fixtures/valid/confidentiality-other-reason.valid.json` | prior confidential → normal; change_reason_code=other; change_reason_text="custom reason" |
| `fixtures/invalid/confidentiality-bad-level.json` | level not in enum |
| `fixtures/invalid/confidentiality-bad-target-type.json` | target_type not in enum |
| `fixtures/invalid/confidentiality-bad-reason-code.json` | change_reason_code not in enum |
| `fixtures/invalid/confidentiality-other-reason-without-text.json` | code=other but text=null (C1) |
| `fixtures/invalid/confidentiality-empty-reason-text.json` | text is empty string (C2) |
| `fixtures/invalid/confidentiality-missing-set-at.json` | set_at omitted |
| `fixtures/semantic-invalid/confidentiality-downgrade-no-reason.json` | downgrade without code; passes schema, caught by helper |
| `fixtures/semantic-invalid/confidentiality-prior-level-mismatch.json` | prior_level doesn't match prior row's level; caught by `assertValidNewConfidentialityClassification` |

### Tests

- **`contract.test.mjs`** — every valid + invalid fixture, per-fixture explicit.
- **`validators.test.mjs`** — `validateConfidentialityClassification` happy + error paths; `isDowngrade` / `isResetToUnclassified` / `isFirstClassification` truth tables; `assertValidConfidentialityTransition` positive + every negative; `assertValidNewConfidentialityClassification` first-row + matching-prior-row + cross-row mismatch.
- **`invariants.test.mjs`** — `effectiveConfidentialityLevel` (empty, single, latest-wins, tied-set_at-id-tiebreak, target-type-filter, target-id-filter); **all denial-reason combinations** for `assertExternalHandlingAllowed`:

Cross-product test matrix (plan-review D2.3 mandate):

| Level | Matter | PrivilegeReview | Action | OptIn | Expected |
|---|---|---|---|---|---|
| unclassified | normal | reviewed_no_privilege | external_ocr | true | deny (unclassified) |
| restricted | normal | reviewed_no_privilege | external_ocr | true | deny (restricted) |
| highly_confidential | normal | reviewed_no_privilege | external_ocr | true | deny (highly_confidential) |
| confidential | normal | reviewed_no_privilege | external_ocr | true | deny (confidential — v1 hard deny) |
| confidential | normal | reviewed_no_privilege | sync_transmit | true | deny (confidential) |
| confidential | normal | reviewed_no_privilege | llm_extraction | true | deny (confidential) |
| normal | sealed | reviewed_no_privilege | external_ocr | true | deny (matter_sealed) |
| normal | heightened | reviewed_no_privilege | external_ocr | true | deny (matter_heightened) |
| normal | normal | not_reviewed | external_ocr | true | deny (privilege_not_reviewed) |
| normal | normal | privileged_protected | external_ocr | true | deny (privilege_protected) |
| normal | normal | privileged_with_waiver | external_ocr | true | deny (privilege_protected — v1 still denies; reserved for future) |
| normal | normal | reviewed_no_privilege | external_ocr | false | deny (missing_action_specific_opt_in) |
| **normal** | **normal** | **reviewed_no_privilege** | **external_ocr** | **true** | **ALLOWED** |
| normal | normal | reviewed_no_privilege | sync_transmit | true | ALLOWED |
| normal | normal | reviewed_no_privilege | llm_extraction | true | ALLOWED |
| restricted | sealed | not_reviewed | external_ocr | false | deny (4 reasons: restricted + sealed + not_reviewed + missing_opt_in) |
| (bogus action) | normal | reviewed_no_privilege | "wibble" | true | deny (external_action_not_recognized; early return) |

- **HandlingDecision shape test**: no `safeToProcess` / `canTransmit` / `approvedForExternal` field; compile-time guarded.
- **Multi-denial test**: a worst-case input accumulates 4 denial reasons.
- **`unclassified_default_denies_external` is ALWAYS present** when effective level is unclassified, even when other denial reasons also fire (load-bearing safety guard).
- `exports.test.mjs` — extend the four lists.
- `state-machine.test.mjs` — extend drift-guard test (now 8 entity types).

### Mechanical files

| File | Action |
|---|---|
| `schemas/case-box-confidentiality-classification.schema.json` | NEW |
| `schemas/case-box-audit-event.schema.json` | TINY ADDITIVE: add `"confidentiality_classification"` to `entity_type` enum |
| `src/loadSchemas.ts` | EXTEND |
| `src/validateConfidentialityClassification.ts` | NEW |
| `src/confidentiality-invariants.ts` | NEW |
| `src/index.ts` | EXTEND |
| `src/audit-log.ts` | EXTEND (4 new kinds + ENTITY_TYPES extension) |
| `src/generated/case-box-confidentiality-classification.ts` | NEW (generated) |
| `src/generated/case-box-audit-event.ts` | REGENERATED |
| `scripts/gen-types.mjs` | EXTEND |
| `fixtures/valid/confidentiality-*.valid.json` | 5 NEW |
| `fixtures/invalid/confidentiality-*.json` | 6 NEW |
| `fixtures/semantic-invalid/confidentiality-*.json` | 2 NEW |
| `tests/contract.test.mjs` | EXTEND |
| `tests/validators.test.mjs` | EXTEND |
| `tests/invariants.test.mjs` | EXTEND |
| `tests/state-machine.test.mjs` | EXTEND (drift guard for 8 entity types) |
| `tests/exports.test.mjs` | EXTEND |
| `README.md` | EXTEND |
| `docs/adr/case-box-step-5-confidentiality-classification.md` | NEW (co-committed) |

---

## 10. Persistence obligations recorded

1. **Append-only**: insert only; never UPDATE classification rows.
2. **Builder-only audit emission**: emit via `buildCaseBoxAuditEvent({ kind: CLASSIFICATION_SET | UPGRADED | DOWNGRADED | RESET_TO_UNCLASSIFIED, ... })`.
3. **Creation rule**: call `assertValidNewConfidentialityClassification(row, priorRow)` before every insert (load history first).
4. **Transition rule**: implicitly enforced by `assertValidNewConfidentialityClassification` calling `assertValidConfidentialityTransition` (plan-review D3.1).
5. **Latest-wins resolution**: order by `set_at` DESC, tie-break by `id` ASC. Match the contract function exactly.
6. **External handling gate**: before invoking external OCR / sync transmit / LLM extraction, call `assertExternalHandlingAllowed` AND check `decision.allowed === true`.
7. **Privilege-review-state computation**: persistence (or the calling layer) MUST compute `PrivilegeReviewState` from privilege markers + lawyer-review state. v1 candidates:
   - All confirmed markers waived AND no active markers → `reviewed_no_privilege_applies`? Actually no — that's "all markers waived", not "lawyer reviewed and cleared". Until Step 3 ships a "lawyer-cleared-not-privileged" state, the only safe path is to require an explicit lawyer-review record per (target, action). The contract documents this; the helper trusts the caller's input.
   - **Recorded persistence obligation**: persistence MUST treat `not_reviewed` as the default for ANY target the lawyer has not explicitly cleared.
8. **Reason audit equality** (plan-review D5.4): when classification change is a DOWNGRADE or RESET, persistence MUST assert audit event's `reason` field equals `change_reason_code` (or a structured combination of `change_reason_code` + `change_reason_text`).
9. **Suspicious-sequence detection** (plan-review D5.4 advisory): persistence MAY log a warning when a downgrade happens within N seconds of an upgrade for the same target. Not a hard contract obligation; recorded as recommended UX.
10. **NO matter-level classification row**: persistence MUST reject inserts with `target_type === "matter"` (the v1 schema enum doesn't include it; defense in depth).
11. **`unclassified` is the absence-of-row default**: persistence MUST NOT auto-create a `normal` classification row for new documents/facts.

---

## 11. Out of scope

- Persistence implementation.
- External OCR / sync / LLM execution.
- Per-page-range classification.
- Privilege-cleared-not-privileged state (Step 3 future evolution).
- Per-action privilege waiver (post-MVP).
- Matter-level classification row overrides (matter row's `confidentiality_class` is the only matter-level source).
- Heightened-matter per-item declassification override (post-MVP; v1 categorically denies heightened/sealed matter external handling).
- LLM extraction at `confidential` level (v1 hard deny; Step 8 LLM ADR may revisit).
- Bulk reclassification operations.
- Sync destination trust classes (cloud vs local-companion vs third-party — post-MVP).
- Reason-code expansion beyond v1 list.
- Cross-tenant classification.

---

## 12. Acceptance criteria

1. `case-box-confidentiality-classification.schema.json` exists with C1, C2 invariants.
2. `src/generated/case-box-confidentiality-classification.ts` regenerated.
3. `src/validateConfidentialityClassification.ts` exists.
4. `src/confidentiality-invariants.ts` exports every helper.
5. `src/index.ts` re-exports every new symbol; deep-frozen schema.
6. `src/audit-log.ts` extended with 4 new kinds; `CASE_BOX_AUDIT_ENTITY_TYPES` includes `"confidentiality_classification"`.
7. `case-box-audit-event.schema.json` `entity_type` enum widened.
8. `scripts/gen-types.mjs` extended.
9. case-box-contract test suite green (Step-4's 225 stay green; new tests bring total higher).
10. OCR contract tests stay 102/102 green.
11. Zero Ajv strictRequired warnings.
12. `tsc` passes clean.
13. **No Step-1/2/3 schema modified.** (Process check.) Step-4 audit-event schema gains one enum value (tiny additive — drift-guard preserved).
14. **No OCR-package file modified.** (Process check.)
15. **No persistence / ingestion / review / sync / UI / auth / cloud / LLM file added or modified.** (Process check.)
16. **No new runtime dependency.** (Process check.)
17. **AGENTS.md unchanged.** (Process check.)
18. README + ADR co-committed.
19. **Load-bearing unclassified-default test**: empty classifications → `allowed=false` with `unclassified_default_denies_external` in `denialReasons`.
20. **Load-bearing restricted test**: restricted denies ALL three actions.
21. **Load-bearing privilege-not-reviewed test**: `not_reviewed` denies external handling even on `normal` items.
22. **Load-bearing matter-sealed test**: matter sealed denies regardless of per-item level.
23. **Load-bearing matter-heightened test**: matter heightened denies regardless of per-item level (v1; no per-item override).
24. **Load-bearing action-specific opt-in test**: omitting `externalOcrAuthorized` denies `external_ocr` even when other opt-ins are true.
25. **Confidential + LLM hard-deny test**: even with all opt-ins, confidential + LLM denied.
26. **Downgrade reason required test**: `confidential → normal` without `change_reason_code` throws.
27. **Reset-to-unclassified reason required test**: `normal → unclassified` without `change_reason_code` throws.
28. **Reason-code "other" → text required test**: `change_reason_code === "other"` with null `change_reason_text` rejected by schema.
29. **HandlingDecision no-green-light test**: NO `safeToProcess` / `canTransmit` / `approvedForExternal` field.
30. **Multi-denial test**: a worst-case input accumulates 4+ denial reasons.
31. **Cross-row consistency test**: `assertValidNewConfidentialityClassification` throws when `row.prior_level !== priorRow.level`.
32. **Drift guard test**: Step-4 schema `entity_type.enum` equals updated `CASE_BOX_AUDIT_ENTITY_TYPES` (8 values).

Criteria #13–#17 are process / git-diff checks.

---

## 13. Audit questions

1. **`unclassified` default denial is always present** when effective level is unclassified, even alongside other denials?
2. **`unclassified` is outside the ordinal lattice**: helper does NOT classify unclassified as a downgrade target?
3. **Privilege `not_reviewed` is the legal default**: documented in ADR + helper denies?
4. **Action-specific opt-ins**: three separate flags, not one?
5. **Confidential is hard-denied for all actions in v1**: documented in ADR + tested?
6. **Heightened/sealed matters categorically deny external handling**: no per-item override path?
7. **`privileged_with_waiver` v1-deny**: documented as reserved; helper still denies?
8. **Reason-code enum**: every value tested?
9. **`change_reason_code === "other"` requires text**: schema invariant C1 enforced + tested?
10. **Cross-row consistency**: `assertValidNewConfidentialityClassification` checks `prior_level` matches?
11. **Tie-break in `effectiveConfidentialityLevel`**: deterministic by `set_at` DESC then `id` ASC?
12. **Audit kinds added correctly**: 4 kinds with `entity_type: "confidentiality_classification"`; all `action: "create"`?
13. **Drift guard updated**: schema enum + TS constant both include `"confidentiality_classification"`?
14. **NO `safeToProcess` field**: type test passes?
15. **Persistence obligations recorded**: every item in §10 in the ADR?
16. **AGENTS.md unchanged**: `git diff` empty?
17. **`target_type` enum does NOT include `"matter"`**: matter-level lives only on Step-1 matter row?
18. **No-action-recognized early-return**: bogus action returns immediately with only that one denial reason?

---

## 14. Risks / open items

- **`PrivilegeReviewState` is caller-computed**: the helper trusts the caller. The contract documents that `not_reviewed` is the legal default; persistence MUST treat any target the lawyer has not explicitly cleared as `not_reviewed`. UI/persistence implementation review must verify this.
- **`reviewed_no_privilege_applies` has no Step-3 marker state**: this is a v1 gap. Step 3 has `dismissed` (proposal dismissed) but not "lawyer reviewed target and cleared privilege". The helper input lets callers express it; the responsibility for honest input is the caller's.
- **`privileged_with_waiver` deferred**: v1 helper denies all four privilege states except `reviewed_no_privilege_applies`. Per-action privilege waiver is post-MVP.
- **Heightened/sealed matter categorical deny**: aligns with Step-0; tightens from the original Step-5 draft. If a lawyer needs heightened-matter external handling for v1, the workflow is to declassify the entire matter (which the lawyer authors directly on the matter row).
- **Confidential + LLM v1 hard deny**: may be too strict for some use cases. Step 8 LLM-extractor ADR may relax with explicit per-case opt-in + audit.
- **Reason-code enum** is v1; future evolution may add codes.
- **`other` code requires free text**: schema-enforced. UI must surface a freeform text input when "other" is selected.
- **Cross-row consistency** depends on persistence loading the prior row before insert. Documented obligation; the helper takes it as input.
- **`sync_grant_present` is a binary flag**: future per-destination grants (cloud vs local-companion vs third-party) are out of scope.
- **Tiny additive Step-4 schema change** is the second such change. Future Step-N changes that need new entity_type values keep extending the enum.

---

## 15. Plan-review thread

Codex review of the prior draft: thread `019e47c9`. Findings classified and resolved in this revision:

| Codex finding | Resolution |
|---|---|
| D1.1 / D2.1 Critical — privilege-clearance gap | §5 adds `privilegeReviewState` input with 4 values; default `not_reviewed` denies; ADR documents that absence of confirmed marker is NOT clearance |
| D5.2 Critical — heightened-matter bypass via first classification | §1 + §5 v1 categorically denies heightened/sealed matter external handling; per-item override removed; documented out-of-scope future |
| D2.2 Critical — single opt-in boolean conflates three | §5 splits into `externalOcrAuthorized`, `syncGrantPresent`, `llmExtractionOptIn` |
| D5.1 Critical — helper unsafe against caller misuse | §5 redesigned: structured input + structured output + no green-light field |
| D1.2 High — confidential + LLM self-contradictory | §3 + §5: v1 hard-denies confidential for ALL actions including LLM; documented as Step-8 revisit candidate |
| D1.3 High — heightened matter + per-item normal conflicts with Step-0 | §1 + §5: v1 honors Step-0; categorical deny |
| D2.3 High — fixture/test matrix incomplete | §9 expanded test matrix (17 rows in §9 table) |
| D2.4 High — reason-text minLength 1 too weak | §4 adopts `change_reason_code` enum + optional `change_reason_text`; "other" requires text |
| D3.1 High — `assertValidNewConfidentialityClassification` missing history input | §4 + §9: signature is `(row, priorRow | null)` |
| D4.1 High — `unclassified` ordinal confusion | §3: `unclassified` is OUTSIDE the lattice; transitions explicitly defined |
| D4.2 High — OVERRIDDEN kind undefined | §6 dropped OVERRIDDEN; kept SET/UPGRADED/DOWNGRADED + added RESET_TO_UNCLASSIFIED |
| D4.3 High — sync_grant overloaded | §5 renamed to `sync_transmit` (action); `syncGrantPresent` (opt-in flag) |
| D5.3 High — privilege sync carve-out under-specified | §5 removed carve-out; v1 categorical: privilege denies all external transmission |
| D5.4 High — downgrade can be deceptive | §4 reason-code enum + §10 persistence obligation for audit-equality + advisory suspicious-sequence detection |
| D1.4 Medium — audit integration text reverses itself | §6 cleaned up; only the final additive entity_type enum decision retained |
| D3.2 Medium — tie-break needs precise rule | §5 + §10: `set_at` DESC, `id` ASC tiebreak; tested |
| D3.3 Medium — C2 was schema-labeled but semantic | §4: C2 (downgrade reason) moved to validator-only helper; C3 → C1 (text-required-when-other) and new C2 (text-non-empty-when-set) are pure schema invariants |
| D3.4 Low — Step-4 schema extension feasibility | confirmed; proceeds |
| D4.4 Medium — matter-target-type ambiguity | §2: `target_type` enum dropped `matter`; matter-level lives only on Step-1 row |

---

## 16. References

- `docs/adr/case-box-step-0-boundary.md` — confidentiality posture #4 (load-bearing); ADR-series Step list.
- `docs/adr/case-box-step-3-privilege-marker-model.md` — privilege markers; combined in handling helper via `privilegeReviewState` input.
- `docs/adr/case-box-step-4-audit-log-shape.md` — audit-log shape; extended with 4 new kinds.
- `docs/product/product-target-architecture.md` — cross-cutting invariants #1, #4, #5.
- `docs/contracts/case-box-contract/schemas/case-box-matter.schema.json` — Step-1 matter-level `confidentiality_class` (unchanged).
- `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json` — Step-4 schema; one enum value added.
- `docs/contracts/case-box-contract/src/audit-log.ts` — Step-4 helpers; 4 new kinds added.
- `dev-memo/plan-case-box-step-4.md` — plan structure mirror.
- `dev-memo/superseded/case-box-plan.md` — original `confidentiality_class` concept.
- Codex plan-review thread `019e47c9`.
- `AGENTS.md` — Stop-and-Ask gates.
