# ADR: Case-Box Step 3 — Privilege Marker Model

## Status

**Accepted** — 2026-05-20. Implements ADR-series Step 3 per `docs/adr/case-box-step-0-boundary.md`. Co-committed with the `CaseBoxPrivilegeMarker` schema, validator, state machine, helpers, fixtures, and tests.

Planning record: `dev-memo/plan-case-box-step-3.md` (revised after Codex plan-review thread `019e45d2`).

This ADR is **additive** to `docs/contracts/case-box-contract/`. No Step-1 or Step-2 schema is modified, no OCR package is touched, no persistence / ingestion / review / sync / UI / auth / cloud / LLM code is added.

## Context

`case-box-plan` (now `dev-memo/superseded/case-box-plan.md`) sketched a `privilege_marker` entity with a free-form `applies_to` JSON blob and an `attorney_client | work_product | joint_defense | common_interest | none` kind enum. Step 0 (`docs/adr/case-box-step-0-boundary.md`) recorded the legal-default invariant: "Privilege markers default to absent = unmarked (NOT privileged). Lawyer must explicitly mark privileged documents." The product target architecture echoes the same line.

The user's authorization for this WI tightened that wording: "Default privilege state is unmarked / unknown / not reviewed. Unmarked MUST NOT be treated as privileged. Unmarked MUST NOT be treated as safe for disclosure either." This is a stricter reading of the same invariant: `unmarked` is a third legal status (neither privileged nor cleared-for-disclosure), not a synonym for "not privileged".

Plan-review thread `019e45d2` surfaced one Critical + six High findings in the original draft, principally:

- The original "unmarked = not privileged" prose silently aligned with a permissive helper return shape that callers could misread as a disclosure clearance.
- Supersession-style direction confusion (resolved by adopting single-mutable-row).
- Schema invariant matrix omissions (kind/basis_text not required for terminal statuses; M3/M4 incomplete).
- Multiple-confirmed-marker collapse (attorney-client AND work-product would be invisibly merged).
- `rejected` overloaded with `CaseBoxFact.status = "rejected"`.

This ADR ships the revised design.

## Decision

Adopt `CaseBoxPrivilegeMarker` as the ninth case-box entity with the following design.

### 1. Standalone entity, single mutable row per marker

`CaseBoxPrivilegeMarker` is a standalone entity with explicit `(target_type, target_id)` reference. Targets v1: `document`, `fact`. The contract carries the shape; persistence enforces target resolution and tenant/matter consistency.

**Row lifecycle is single mutable**. A marker row's `status` advances through states; lifecycle timestamps accumulate on the same row. **There are NOT separate event rows per state change.** Multiple markers per target are independent rows (e.g. one LLM proposal dismissed + a separate lawyer-authored confirmed marker = two rows on the same target with independent lifecycles).

### 2. Lifecycle states and edges

Four states: `proposed`, `confirmed`, `dismissed`, `waived`.

Terminal: `dismissed`, `waived`. Accepted is *not* terminal in the fact lifecycle; for markers, `confirmed` is also not terminal (it can transition to `waived`). `accepted` is the legally-protective state.

Allowed edges (all `by: ["lawyer"]`):

```
proposed  → confirmed   (promotion — load-bearing for no-auto-privilege)
proposed  → dismissed   (reason required)
confirmed → waived      (reason required)
```

The name `dismissed` replaces the original draft's `rejected` to avoid overload with `CaseBoxFact.status = "rejected"`. Dismissal of a privilege proposal and rejection of a fact candidate are different operations on different entities; distinct names prevent reader confusion (plan-review D4.4).

Excluded edges (all throw `IllegalTransitionError`):

- `proposed → waived` (you can only waive what you confirmed).
- `confirmed → proposed`, `confirmed → dismissed`.
- `*` → `proposed`.
- `dismissed → *`, `waived → *` (terminal).
- Any non-`lawyer` actor.

Both reason-required edges (`proposed → dismissed` and `confirmed → waived`) enforce non-empty reason strings at the state-machine layer AND at the schema layer (M3 `dismissal_reason`, M4 `waiver_reason`).

### 3. Three-layer no-auto-privilege enforcement

Mirrors Step 2's no-auto-accept posture for facts:

1. **State machine** — every promotion edge is `by: ["lawyer"]`. Coordinator / ingestion / review actors cannot promote.
2. **Schema** — M2 requires `confirmed_actor_user_id` (non-null string) when `status === "confirmed"`. A confirmed-without-confirmer row fails schema validation.
3. **Creation helper** — `assertValidNewPrivilegeMarker`:
   - `llm_suggested` and `imported` MUST start `proposed`.
   - `lawyer_authored` MAY start `proposed` (draft) or `confirmed` (immediate marking; `proposed_at === confirmed_at`).
   - No source may start `dismissed` or `waived` (terminal states are reached via transitions only).
   - Dismissal and waiver fields MUST be null on a new row.
   - Persistence MUST call this before insert. **Recorded as a persistence obligation.**

### 4. Resolver — `effectivePrivilegeStatus`

The privilege resolver is the only public API surface that translates marker rows into a legal-status assessment. Its return shape is deliberately designed so callers cannot accidentally treat it as a disclosure clearance:

```ts
interface PrivilegeResolution {
  readonly hasProtectiveAssertion: boolean;                     // ONLY the true value asserts privilege; false is NEVER a green light
  readonly activeConfirmedMarkers: ReadonlyArray<CaseBoxPrivilegeMarker>; // may contain multiple kinds (attorney_client + work_product)
  readonly historyHas: {
    readonly proposed: boolean;
    readonly confirmed: boolean;
    readonly dismissed: boolean;
    readonly waived: boolean;
  };
  readonly allTargetMarkers: ReadonlyArray<CaseBoxPrivilegeMarker>;
}
```

**Critical absences** (compile-time-guarded by test):

- No field named `isPrivileged`, `safeToDisclose`, `disclosureClearance`, or `notPrivileged`.
- No string "status" field that could be read as "unmarked = safe".

**Algorithm**:

1. Filter input markers by `(target_type, target_id)`.
2. `activeConfirmedMarkers` = filtered markers whose **current** `status === "confirmed"`. (A row in state `waived` is NOT in this list, even if its history shows confirmation.)
3. `hasProtectiveAssertion = activeConfirmedMarkers.length > 0`.
4. `historyHas.*` lifecycle witnesses computed across the filtered set.

**Multiple confirmed markers**: returned in full (plan-review D4.1). Attorney-client and work-product can both apply to the same target, and they have different legal rules; collapsing them to one marker would lose material legal basis.

**Marker uniqueness** (`(tenant_id, matter_id, target_type, target_id, kind)` at most one in state `confirmed`): enforced by persistence. The contract allows the shape; persistence rejects duplicate confirmed markers of the same kind on the same target. **Recorded as a persistence obligation.**

### 5. Schema invariants

Seven `if/then` invariants (M1..M7). Each `then` clause redeclares its constrained properties to silence Ajv `strictRequired` warnings (matches post-Step-1-audit pattern). Summary:

| # | Trigger | Constraint |
|---|---|---|
| M1 | `status === "proposed"` | All confirmation/dismissal/waiver fields MUST be null |
| M2 | `status === "confirmed"` | `confirmed_actor_user_id` + `confirmed_at` required; dismissal/waiver fields null |
| M3 | `status === "dismissed"` | `dismissed_actor_user_id` + `dismissed_at` + `dismissal_reason` required; confirmation/waiver fields null |
| M4 | `status === "waived"` | `confirmed_actor_user_id` + `confirmed_at` + `waiver_actor_user_id` + `waived_at` + `waiver_reason` ALL required (you can only waive what was confirmed); dismissal fields null |
| M5 | `source_type === "lawyer_authored"` | Extractor metadata MUST be null |
| M6 | `source_type === "llm_suggested"` | `extractor_name` required (non-null) |
| M7 | `source_type === "imported"` | `extractor_name` required (non-null) |

**`kind` and `basis_text` are required at the top level** (every row regardless of status). A `dismissed` or `waived` row preserves what was originally proposed/protected — required for privilege-log reproducibility.

### 6. Temporal invariants (validator-only)

`assertPrivilegeMarkerTimestamps` enforces lifecycle ordering:

- `proposed_at <= confirmed_at` (when confirmed_at non-null).
- `confirmed_at <= waived_at` (when waived_at non-null).
- `proposed_at <= dismissed_at` (when dismissed_at non-null).

Clock-skew enforcement is left to persistence.

### 7. Audit-event mapping

Existing `CaseBoxAuditEvent` enum (Step 1) covers what's needed; **no Step-1 schema change required**:

| Marker write | Audit `action` |
|---|---|
| Create | `create` |
| `proposed → confirmed` | `update` |
| `proposed → dismissed` | `update` (audit `reason` SHOULD echo `dismissal_reason`) |
| `confirmed → waived` | `privilege-waive` (existing schema already requires `reason` non-null for this action) |

### 8. Post-waiver new-marker policy

A waived marker is terminal. **A new marker on the same target after waiver is ALLOWED** as a new row (new id, new `proposed_at`, fresh lifecycle). Persistence enforces that the new marker is a separate row and does NOT un-waive the old one. **Recorded as a persistence obligation.**

## Reconciliation with product / Step-0 wording

`docs/product/product-definition.md Part I` cross-cutting invariant #5 reads "Privilege defaults to unmarked = NOT privileged. Explicit marker required." Step-0 confidentiality posture #4 reads "Privilege markers default to absent = unmarked (NOT privileged). Lawyer must explicitly mark privileged documents."

Read literally, those phrases could be parsed two ways:

- **Loose reading**: `unmarked === "not privileged"` (a definite legal determination).
- **Strict reading**: `unmarked` means "not (privileged)" — there is no protective assertion, but the legal status is undetermined; the lawyer has not reviewed and cleared the target for disclosure.

This ADR adopts the **strict reading**. The strict reading is what the user's WI authorization explicitly requires; it is what `PrivilegeResolution` encodes; it is the safer legal posture. The loose reading is not contradicted (an unmarked target has no protective assertion), but the loose reading is incomplete (it does not imply disclosure safety).

**Recommendation**: a future low-priority doc-tidy WI tightens the product / Step-0 wording to "Privilege defaults to unmarked = no protective assertion present; `unmarked` is NOT disclosure-cleared and NOT privileged; explicit marker required for either legal posture." Not blocking this ADR.

## Consequences

### Positive

- Three-layer enforcement (state machine + schema + creation helper) prevents auto-privilege without any single-layer bypass.
- Resolver return shape is incapable of being read as a disclosure clearance: no `isPrivileged` / `safeToDisclose` / `disclosureClearance` / `notPrivileged` field exists; compile-time-guarded by test.
- Multi-kind privilege (attorney-client AND work-product on the same target) is preserved through the resolver.
- Edge-table drift guard test catches future inconsistency between documented and actual edges.
- Reusing existing `CaseBoxAuditEvent.action` enum avoids Step-1 schema change.
- Rename `rejected → dismissed` removes overload with fact's `rejected` state.

### Negative

- Marker uniqueness, target tenant/matter consistency, post-waiver behavior, and creation-rule enforcement all depend on persistence calling `assertValidNewPrivilegeMarker`. Until `case-box-persistence` lands, the contract carries the rules but no storage layer enforces them.
- v1 has no "lawyer-cleared-as-not-privileged" status. UI/review workflows that need to distinguish "lawyer dismissed every proposal" from "lawyer reviewed and cleared the target" cannot fully represent the latter in v1. A future evolution may add a status like `cleared_not_privileged`.
- Privilege log export is a future `case-box-review` concern; this contract ships the data shape only.
- Page-range and evidence-item / matter-level markers are deferred.

### Neutral

- OCR pipeline unchanged.
- AGENTS.md unchanged.
- No new runtime dependency.
- Step-1 and Step-2 schemas unchanged.

## Cross-references

- `docs/adr/case-box-step-0-boundary.md` — boundary and confidentiality posture.
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` — three-layer no-auto-X enforcement pattern this ADR mirrors.
- `docs/product/product-definition.md Part I` — cross-cutting invariant #5 (see §"Reconciliation with product / Step-0 wording" above).
- `dev-memo/plan-case-box-step-3.md` — implementation plan; this ADR is the authoritative version of §3–§8 of the plan.
- `dev-memo/superseded/case-box-plan.md` — historical privilege-marker shape.
- `docs/contracts/case-box-contract/schemas/case-box-privilege-marker.schema.json` — schema.
- `docs/contracts/case-box-contract/src/privilege-invariants.ts` — `assertValidNewPrivilegeMarker`, `assertPrivilegeMarkerTimestamps`, `effectivePrivilegeStatus`.
- `docs/contracts/case-box-contract/src/transitions.ts` — `PrivilegeMarkerState`, `ALLOWED_PRIVILEGE_MARKER_EDGES`, `assertValidPrivilegeMarkerTransition`.
- `docs/contracts/case-box-contract/tests/*.test.mjs` — full coverage including resolver truth table, edge-table drift, type-guard for absent fields.

## Not in scope

- Persistence (`case-box-persistence` is a future WI; this ADR records obligations).
- Privilege log EXPORT (a future `case-box-review` concern).
- Page-range / evidence-item / matter-level markers.
- Auto-detection of privileged content (LLM lives outside the contract).
- Cross-tenant or matter-spanning privilege.
- "Lawyer-cleared-as-not-privileged" status (deferred future evolution).
- Privilege-log retention policy.
- Renaming `CaseBoxEvidenceItem.supersedes_evidence_id` (out of scope; Step-1 schema change).

## Persistence obligations recorded

The following are NOT in this ADR's implementation but MUST be honored by `case-box-persistence` when it lands:

1. Call `assertValidNewPrivilegeMarker` before every insert.
2. Enforce uniqueness `(tenant_id, matter_id, target_type, target_id, kind)` for `status === "confirmed"`: at most one confirmed marker per kind per target.
3. Enforce target tenant/matter consistency: marker's `(tenant_id, matter_id)` MUST equal the target row's `(tenant_id, matter_id)`.
4. Allow post-waiver new markers as separate rows (do NOT un-waive existing rows).
5. Emit audit events per §7 mapping; for `proposed → dismissed`, audit `reason` SHOULD echo `dismissal_reason`.
6. Apply `assertPrivilegeMarkerTimestamps` after any lifecycle update; reject rows with non-monotonic timestamps.
7. Preserve the Step-2 obligation to detect supersession-graph cycles on fact writes (not weakened by this ADR).

## Open questions deliberately deferred

1. "Lawyer-cleared-as-not-privileged" status — future evolution.
2. Page-range markers — future evolution.
3. Marker on evidence-item or matter — future evolution.
4. Privilege-log export format — `case-box-review` concern.
5. Privilege-log retention policy — operational concern.
