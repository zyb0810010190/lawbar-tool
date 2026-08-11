# ADR: Case-Box Step 5 — Confidentiality Classification Model

## Status

**Accepted** — 2026-05-20. Implements ADR-series Step 5 per `docs/adr/case-box-step-0-boundary.md` (originally `case-box-step-5-confidentiality-no-cloud-default.md` in the Step-0 list; this ADR uses the user-authorized filename which more accurately describes scope). Co-committed with the new entity, helpers, and the tiny additive Step-4 schema change.

Planning record: `dev-memo/plan-case-box-step-5.md` (revised after Codex plan-review thread `019e47c9`).

This ADR is **mostly additive** to `docs/contracts/case-box-contract/`. The single exception is one tiny additive change to `schemas/case-box-audit-event.schema.json` (Step-4 schema): the `entity_type` enum gains `"confidentiality_classification"`. No Step-1/Step-2/Step-3 schema is modified. No OCR package, persistence, ingestion, review, sync, UI, auth, cloud, or LLM code is added.

## Context

Step 0 §5 confidentiality posture is load-bearing: "documents never leave local storage unless `confidentiality_class = normal` AND user explicitly authorized external worker for that doc." Until Step 5, the only confidentiality signal was the matter-row `confidentiality_class` field from Step 1 (`normal | heightened | sealed`). That's matter-wide; it cannot express "this specific document is restricted within an otherwise-normal matter".

Step 5 adds **per-target classification** as a separate entity, distinct from privilege markers (Step 3). Privilege and confidentiality are independent legal dimensions; the §5 handling-decision helper considers both but does not merge them.

Codex plan-review thread `019e47c9` surfaced four Critical findings on the original Step-5 draft:

1. **Privilege-clearance gap**: helper treated absence-of-confirmed-marker as sufficient for external handling, but Step 3 says unmarked is undetermined — not cleared.
2. **Heightened-matter bypass via first classification**: original draft allowed a new doc to be classified `normal` (no reason) in a heightened matter and pass external handling, defeating Step-0's confidentiality posture.
3. **Single `explicitOptInPresent` boolean** conflated three distinct opt-ins (external OCR / sync / LLM).
4. **Helper unsafe against caller misuse**: green-light field semantics were too easy to misread.

Plus seven High findings. The plan was revised; this ADR ships the revision.

## Decision

### 1. New entity — `CaseBoxConfidentialityClassification`

Per-target (v1 targets: `document`, `fact`). Append-only history; latest row by `set_at` (id ASC tiebreak) = current effective level. Matter-level classification stays on the Step-1 matter row; the new entity's `target_type` enum deliberately omits `"matter"` to avoid two sources of truth (plan-review D4.4).

### 2. Classification vocabulary

| Level | Position | Meaning |
|---|---|---|
| `unclassified` | **Outside ordinal lattice** | Legal default; operationally most restrictive (no external handling). |
| `normal` | Ordinal 1 (least restrictive in lattice) | Ordinary work product. |
| `confidential` | Ordinal 2 | Client-sensitive. v1 HARD DENIES all external actions (Step 8 LLM ADR may relax). |
| `highly_confidential` | Ordinal 3 | Strongly sensitive (trade secret, regulated PII). |
| `restricted` | Ordinal 4 (most restrictive) | Air-gapped; no external handling can be authorized. |

`privileged` is NOT in the enum. Privilege is a separate dimension via Step 3.

Transitions:

- **First classification** (`null → any`): no reason required.
- **Reset to unclassified** (`<any non-null> → unclassified`): operationally discouraged; reason required.
- **Within lattice**:
  - Upgrade (lower ordinal → higher): no reason required.
  - Downgrade (higher ordinal → lower): reason required.

`unclassified` is outside the lattice. `isDowngrade(null, anything) === false`; `isDowngrade("unclassified", anything) === false`; `isDowngrade(anything, "unclassified") === false`. These cases are handled by `isFirstClassification` and `isResetToUnclassified` predicates.

### 3. Schema invariants

Single `if/then` (C1): when `change_reason_code === "other"`, `change_reason_text` is required AND non-empty (string with `minLength: 1`).

Downgrade-without-reason and reset-without-reason are SEMANTIC invariants enforced by validator-only helper `assertValidConfidentialityTransition` (JSON Schema cannot express cross-field ordinal comparison).

Cross-row consistency (`row.prior_level` matches previous row's `level`) is enforced by `assertValidNewConfidentialityClassification(row, priorRow)` — persistence MUST load history and pass `priorRow`.

### 4. The handling-decision helper — `assertExternalHandlingAllowed`

Load-bearing. Takes structured input:

```ts
{
  matter: { confidentiality_class: "normal" | "heightened" | "sealed" };
  classifications: ReadonlyArray<CaseBoxConfidentialityClassification>;
  privilegeReviewState: "not_reviewed" | "reviewed_no_privilege_applies" | "privileged_protected" | "privileged_with_waiver";
  targetType: "document" | "fact";
  targetId: string;
  externalAction: "external_ocr" | "sync_transmit" | "llm_extraction";
  externalOcrAuthorized: boolean;
  syncGrantPresent: boolean;
  llmExtractionOptIn: boolean;
}
```

Returns `HandlingDecision`:

```ts
{
  allowed: boolean;
  denialReasons: ReadonlyArray<HandlingDenialReason>;
  evidence: HandlingEvidence;
}
```

**Critical absences** (compile-time-guarded by test): NO `safeToProcess`, `canTransmit`, `approvedForExternal`, `isPrivileged`, `safeToDisclose` field. Callers MUST check `allowed === true` explicitly.

Algorithm:

1. If `externalAction` unknown → return `{ allowed: false, denialReasons: ["external_action_not_recognized"] }` (early).
2. Accumulate denial reasons (in order):
   - effective level `unclassified` → `unclassified_default_denies_external` (LOAD-BEARING SAFETY: always present when unclassified)
   - `restricted` → `classification_restricted`
   - `highly_confidential` → `classification_highly_confidential`
   - `confidential` → `classification_confidential_disallows_action` (v1 hard deny for ALL actions)
   - matter `sealed` → `matter_sealed`
   - matter `heightened` → `matter_heightened` (v1: no per-item override path; plan-review D1.3 / D5.2 honored Step-0)
   - privilege `not_reviewed` → `privilege_not_reviewed` (load-bearing per plan-review D2.1 / D5.1 / D1.1: absence of confirmed marker is NOT clearance)
   - privilege `privileged_protected` or `privileged_with_waiver` → `privilege_protected` (v1 denies even with_waiver; per-action waiver mechanism is post-MVP)
   - action-specific opt-in (externalOcrAuthorized / syncGrantPresent / llmExtractionOptIn) false → `missing_action_specific_opt_in`
3. `allowed = denialReasons.length === 0`.

### 5. Privilege-review-state: caller-computed

`PrivilegeReviewState` is the caller's responsibility. The contract trusts the input. Persistence MUST treat `not_reviewed` as the default for any target the lawyer has not explicitly cleared. **Recorded as a persistence obligation.**

Step 3 has no "lawyer-cleared-as-not-privileged" state; the caller maps from privilege-marker history + lawyer-review record into `PrivilegeReviewState`. Future evolution may add Step-3 state to formalize this.

### 6. Heightened/sealed matters: categorical deny in v1

Plan-review D1.3 / D5.2 + Step-0 §5 alignment: a heightened or sealed matter categorically denies external handling for ALL items, regardless of per-item classification. There is NO "per-item normal classification overrides matter heightened" path in v1.

If a lawyer needs heightened-matter external handling, the workflow is to declassify the matter (update Step-1 matter-row `confidentiality_class`). Per-item override under reasoned audit is a future evolution.

### 7. Audit-log integration (Step-4 extension)

`CASE_BOX_AUDIT_EVENT_KINDS` (Step 4) extended with four new kinds, all `action: "create"` (append-only insertions), `entity_type: "confidentiality_classification"`:

- `CLASSIFICATION_SET` (first row for a target)
- `CLASSIFICATION_UPGRADED` (lattice upgrade, less-restrictive ordinal → more-restrictive)
- `CLASSIFICATION_DOWNGRADED` (lattice downgrade; reasonRequired: true)
- `CLASSIFICATION_RESET_TO_UNCLASSIFIED` (any non-null → unclassified; reasonRequired: true)

Plan-review D4.2 dropped the original `CLASSIFICATION_OVERRIDDEN` kind (undefined semantics).

`OVERRIDDEN` semantics fold into `SET`/`UPGRADED`/`DOWNGRADED` based on transition type. Persistence selects the kind at write time.

### 8. Tiny additive Step-4 schema change

`case-box-audit-event.schema.json` `entity_type` enum gains `"confidentiality_classification"`. Same shape as Step-4's own additive change. The Step-4 drift-guard test (`schema entity_type.enum equals CASE_BOX_AUDIT_ENTITY_TYPES`) catches divergence between schema and TS constant.

Plan-review accepts this as "tiny additive" — no other schema field is touched.

## Persistence obligations recorded

For `case-box-persistence` (future WI):

1. **Append-only**: never UPDATE classification rows.
2. **Builder-only audit emission**: emit via `buildCaseBoxAuditEvent({ kind: CLASSIFICATION_SET | UPGRADED | DOWNGRADED | RESET_TO_UNCLASSIFIED, ... })`.
3. **Creation rule**: call `assertValidNewConfidentialityClassification(row, priorRow | null)` before every insert; persistence MUST load the prior row first.
4. **Latest-wins**: `effectiveConfidentialityLevel` orders by `set_at` DESC, tie-breaks by `id` ASC. Persistence queries MUST match.
5. **External handling gate**: before invoking external OCR / sync transmit / LLM extraction, call `assertExternalHandlingAllowed` AND check `decision.allowed === true`; non-true MUST abort.
6. **`PrivilegeReviewState` computation**: persistence (or the calling layer) MUST compute `PrivilegeReviewState` from privilege-marker history + lawyer-review records. Default for any unreviewed target is `not_reviewed`. Until Step 3 ships a "lawyer-cleared" state, "all proposals dismissed" is NOT equivalent to "lawyer cleared".
7. **Reason audit equality** (plan-review D5.4): when classification change is a downgrade or reset, persistence MUST assert the audit event's `reason` field equals the row's `change_reason_code` (or a structured combination of `change_reason_code` + `change_reason_text`).
8. **Suspicious-sequence detection** (advisory): persistence MAY log a warning when a downgrade follows an upgrade within a short window. Not a hard contract obligation.
9. **`unclassified` is the absence-of-row default**: persistence MUST NOT auto-create a `normal` row for new documents/facts.
10. **No `target_type === "matter"` rows**: persistence MUST reject inserts with this target_type (schema also rejects; defense in depth).
11. **Tenant/matter consistency**: persistence MUST verify `target_id` resolves within the same `(tenant_id, matter_id)` as the classification row. Contract carries shape; persistence enforces.

## Consequences

### Positive

- `unclassified` default is load-bearing safety: a lawyer who forgets to classify a document CANNOT accidentally enable external handling.
- Privilege-review state is explicit input; the helper does NOT silently treat absence-of-confirmed-marker as clearance.
- Three action-specific opt-ins prevent accidental cross-action authorization.
- Heightened/sealed matter categorical deny aligns with Step-0 confidentiality posture.
- `HandlingDecision` return shape is incapable of being read as a disclosure clearance; no green-light field exists.
- Append-only classification history preserves change provenance.
- Reason-code enum + optional free text supports structured legal-trail reporting.

### Negative

- Per-item override of heightened/sealed matter is post-MVP. Lawyers who need this must declassify the matter.
- v1 `confidential` hard deny for LLM is conservative; Step 8 LLM-extractor ADR may relax with explicit per-case opt-in + audit.
- v1 `privileged_with_waiver` is reserved for future; helper denies in v1. The waiver-per-action mechanism is post-MVP.
- Per-page-range classification deferred (v1 = whole-document).
- `PrivilegeReviewState` depends on caller-correct computation; persistence MUST treat `not_reviewed` as default and verify.
- Cross-row consistency depends on persistence loading history; persistence MUST honor this.

### Neutral

- OCR pipeline unchanged.
- AGENTS.md unchanged.
- No new runtime dependency.
- Step-1/2/3 schemas unchanged.

## Cross-references

- `docs/adr/case-box-step-0-boundary.md` — boundary; confidentiality posture #4 (load-bearing); ADR-series Step list.
- `docs/adr/case-box-step-3-privilege-marker-model.md` — privilege markers; combined with classification via `PrivilegeReviewState` input.
- `docs/adr/case-box-step-4-audit-log-shape.md` — audit-log shape; extended here with 4 new kinds + 1 new entity_type enum value.
- `docs/product/project-requirements-brief.md Appendix A` — cross-cutting invariants #1, #4, #5.
- `docs/contracts/case-box-contract/schemas/case-box-confidentiality-classification.schema.json` — schema.
- `docs/contracts/case-box-contract/src/confidentiality-invariants.ts` — all helpers.
- `docs/contracts/case-box-contract/tests/*.test.mjs` — full coverage including load-bearing default-denies-external, multi-denial accumulation, action-specific opt-in routing, sealed/heightened categorical denials, downgrade-reason-required, no-green-light-field type test.
- `dev-memo/plan-case-box-step-5.md` — implementation plan (revised post plan-review).
- Codex plan-review thread `019e47c9`.

## Not in scope

- Persistence implementation.
- External OCR / sync / LLM execution.
- Per-page-range classification.
- "Lawyer-cleared-as-not-privileged" Step-3 evolution.
- Per-action privilege waiver mechanism.
- Heightened-matter per-item declassification override.
- LLM extraction at `confidential` level (post-MVP).
- Bulk reclassification.
- Sync destination trust classes (cloud vs local-companion).
- Reason-code expansion.
- Cross-tenant classification.

## Open questions deliberately deferred

1. "Lawyer-cleared-as-not-privileged" Step-3 state — future evolution.
2. Per-action privilege waiver — post-MVP.
3. Heightened-matter per-item override — post-MVP.
4. Confidential-level LLM with per-case opt-in — Step 8 ADR.
5. Sync destination trust classes — post-MVP.
6. Per-page-range classification — future evolution.
7. Reason-code enum expansion — future evolution.
