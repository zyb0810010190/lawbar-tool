# CASE-BOX Step 3 — Plan: Privilege Marker Model

**Status**: drafting (revised post plan-review thread `019e45d2`).
**Date**: 2026-05-20.
**Authorizes**: planning only. Implementation requires a follow-up authorization gate (granted by the parent user turn for this WI).
**Track**: ADR-series Step 3 (`docs/adr/case-box-step-3-privilege-marker-model.md`, not yet written).
**Out of scope**: persistence, ingestion, review, sync bridge, UI, auth, cloud, LLM execution, OCR worker changes.

---

## 0. Naming conflict + product-doc wording reconciliation

`docs/adr/case-box-step-0-boundary.md` ADR-series Step 3 = `case-box-step-3-privilege-marker-model.md` (this plan). `docs/product/product-target-architecture.md` "Future Work Items" uses MVP-1-phasing numbering ("CASE-BOX Step 3 = case-box-ingestion") — informational only; same convention as Step 2 §0.

**Product-doc wording reconciliation** (raised by plan-review D1.1):

The product document and Step-0 ADR both say "Privilege defaults to unmarked = NOT privileged. Explicit marker required." Read literally, this could be parsed as "unmarked === not-privileged" (a definite legal determination). The user's authorization for this WI explicitly clarifies the stricter reading: "Default privilege state is unmarked / unknown / not reviewed. Unmarked MUST NOT be treated as privileged. Unmarked MUST NOT be treated as safe for disclosure either."

Step 3 adopts the **stricter reading**: `unmarked` is a third legal status (neither privileged nor cleared-as-not-privileged). The product-doc / Step-0 text is loose but not contradictory — the loose phrase "= NOT privileged" should be read as "unmarked is NOT (privileged)" (i.e. has no protective assertion), not "unmarked equals the legal status of not-privileged". The ADR for Step 3 will document this reconciliation explicitly and recommend a future doc-tidy WI to tighten the product-doc wording.

---

## 1. Entity decision — standalone with explicit target reference

**Add one new entity: `CaseBoxPrivilegeMarker`.**

Alternatives considered:

| Option | Verdict |
|---|---|
| Add `privilege_kind` / `privilege_state` fields directly to `CaseBoxDocument` and `CaseBoxFact` | **Rejected.** Couples privilege model to every target entity, requires Step-1/Step-2 schema rewrites, prevents historical markers per target. |
| Standalone `CaseBoxPrivilegeMarker` with `target_type` + `target_id` | **Chosen.** Additive; no Step-1/Step-2 rewrites; allows multiple markers per target. |
| Both (standalone marker + denormalized flag on target) | **Rejected.** Two sources of truth invites drift. |

### Row lifecycle model — single mutable row per marker (plan-review D1.2 fix)

A `CaseBoxPrivilegeMarker` row is **single and mutable**. Its `status` advances through states (`proposed` → `confirmed` → `waived`, or `proposed` → `dismissed`). Lifecycle timestamps (`proposed_at`, `confirmed_at`, `dismissed_at`, `waived_at`) accumulate on the same row. There is NO marker-thread id and there are NOT separate event rows per state change.

**Multiple markers per target** means N independent marker rows can exist for the same `(target_type, target_id)`, each with its own lifecycle:

- Marker A: LLM-proposed, lawyer-dismissed → row in state `dismissed`.
- Marker B: a different LLM call later proposes again → row in state `proposed`.
- Marker C: lawyer authors directly → row in state `confirmed`.

Three rows, three independent lifecycles. Plan-review D1.2 was correct that the original "three rows for proposed→confirmed→waived" framing was wrong; that scenario is **one row** that transitions through three states.

v1 marker target types: `document`, `fact`. Evidence-item / matter / page-range markers are deferred.

---

## 2. States, types, and transitions

### Marker lifecycle (state)

| State | Meaning | Terminal? |
|---|---|---|
| `proposed` | Suggested but not yet legally protective. Machine sources MUST start here. Lawyer sources MAY start here as a draft. | No |
| `confirmed` | Human-confirmed. Legally protective. | No |
| `dismissed` | A proposed marker that the lawyer reviewed and dismissed. Never legally protective. Renamed from `rejected` (plan-review D4.4) to avoid overload with `CaseBoxFact.status = "rejected"`. | **Yes** |
| `waived` | A previously-confirmed marker that the lawyer explicitly released. No longer protective. Waiver is one-way per Step-0 §confidentiality posture #5. | **Yes** |

Allowed edges (all `by: ["lawyer"]`):

| # | From | To | Reason required? | Note |
|---|---|---|---|---|
| 1 | `proposed` | `confirmed` | no | promotion to protective status — load-bearing for no-auto-privilege |
| 2 | `proposed` | `dismissed` | **yes** | the lawyer reviewed and dismissed the proposal (Codex D2.5 — both lifecycle and audit need a reason) |
| 3 | `confirmed` | `waived` | **yes** | privilege voluntarily released; same reason-required pattern as `CaseBoxDeadline missed → met` |

Excluded edges (all throw `IllegalTransitionError`):

- `proposed → waived` (must confirm first to waive — waiver is for actually-protective markers only).
- `confirmed → proposed`, `confirmed → dismissed` (once confirmed, the only exit is `waived`).
- `*` → `proposed`.
- `dismissed → *`, `waived → *` (terminal).
- Any non-`lawyer` actor on any transition.

### Privilege kind

`kind` enum (v1):

- `attorney_client` — attorney-client privilege.
- `work_product` — work-product doctrine.
- `joint_defense` — joint defense privilege.
- `common_interest` — common interest privilege.

`kind` is **required on every marker row regardless of status** (plan-review D2.2 fix). A `dismissed` row preserves the kind that was proposed; a `waived` row preserves the kind that was confirmed. This means the kind is recoverable from the row even after the marker is no longer protective — required for privilege-log export reproducibility.

### Source provenance

`source_type` enum: `lawyer_authored`, `llm_suggested`, `imported`.

| source_type | Initial-status rule | extractor_name |
|---|---|---|
| `lawyer_authored` | MAY start `proposed` (draft) OR `confirmed` (immediate marking) | MUST be null |
| `llm_suggested` | MUST start `proposed` | required (non-null) |
| `imported` | MUST start `proposed` | required (non-null) |

---

## 3. Resolver semantics — structured return, no green-light field

(Plan-review D5.1 Critical fix: original string-status helper could be misread as a disclosure clearance.)

### `effectivePrivilegeStatus(targetType, targetId, markers): PrivilegeResolution`

**Input contract** (plan-review D3.3 fix):

- `targetType`: `"document"` | `"fact"`.
- `targetId`: ULID.
- `markers`: `ReadonlyArray<CaseBoxPrivilegeMarker>` — **all known marker rows for this matter**. The resolver filters by `(target_type, target_id)` internally. Caller is responsible for fetching from persistence; the resolver does no IO. The full single-row-mutable history is acceptable (rows in any state, including terminal). The resolver does NOT assume any pre-filtering.

**Return shape** (plan-review D5.1 fix: structured object, NO string status that could be read as green-light, NO `isPrivileged` / `safeToDisclose` field):

```ts
export interface PrivilegeResolution {
  /**
   * True iff at least one marker for the target is currently in `confirmed`
   * state. The ONLY signal a caller may rely on to assert that privilege
   * applies. Callers MUST NOT infer disclosure safety from `false`.
   */
  readonly hasProtectiveAssertion: boolean;

  /**
   * Every currently-confirmed marker. May be empty. May contain multiple
   * entries when (e.g.) attorney-client AND work-product both apply
   * (plan-review D4.1: collapsing to one loses material legal basis).
   */
  readonly activeConfirmedMarkers: ReadonlyArray<CaseBoxPrivilegeMarker>;

  /**
   * Compact lifecycle witness — true if at least one marker has ever
   * reached each state. Useful for UI surfaces that distinguish "no
   * marker ever proposed" from "lawyer dismissed every proposal".
   */
  readonly historyHas: {
    readonly proposed: boolean;
    readonly confirmed: boolean;
    readonly dismissed: boolean;
    readonly waived: boolean;
  };

  /**
   * Every marker considered (filtered to the (target_type, target_id)
   * pair from the input array). Returned so callers can surface the
   * full audit trail without re-filtering.
   */
  readonly allTargetMarkers: ReadonlyArray<CaseBoxPrivilegeMarker>;
}
```

**Algorithm** (plan-review D1.3 fix: current row state, not "any historical confirmed"):

1. Filter `markers` to those whose `(target_type, target_id)` match the input.
2. `activeConfirmedMarkers` = those filtered markers whose **current** `status === "confirmed"`. (A marker that was confirmed and then waived has `status === "waived"`; it is NOT in `activeConfirmedMarkers`.)
3. `hasProtectiveAssertion = activeConfirmedMarkers.length > 0`.
4. `historyHas.proposed` = any filtered marker has status `proposed` OR has non-null `proposed_at` (every marker has `proposed_at`, so this is true iff any markers exist for the target).
5. `historyHas.confirmed` = any filtered marker has status `confirmed` OR has non-null `confirmed_at`.
6. `historyHas.dismissed` = any filtered marker has status `dismissed`.
7. `historyHas.waived` = any filtered marker has status `waived`.
8. `allTargetMarkers` = the filtered array.

**Critical absences**:

- No field named `isPrivileged`, `isSafeToDisclose`, `disclosureClearance`, `notPrivileged`. Callers cannot accidentally treat the resolver as a disclosure green-light.
- No `unmarked` boolean. The closest signal is `historyHas.proposed === false`, which means "no marker has ever been proposed for this target". Callers MUST NOT read this as "safe to disclose".
- A target with `hasProtectiveAssertion === false` AND `historyHas.dismissed === true` means "every proposal was dismissed". This is NOT a clearance — a lawyer dismissed a *proposal*, which is different from a lawyer reviewing the *target* and declaring it non-privileged. An explicit "lawyer-cleared-as-not-privileged" status is **deferred to a future evolution** (plan-review D2.1: documented as deferred, not silently collapsed).

### Tests for the resolver

Each return-shape field tested independently on hand-built fixture arrays:

| Scenario | Input markers | Expected fields |
|---|---|---|
| Empty | `[]` | `hasProtectiveAssertion=false`, all `historyHas` false, both arrays empty |
| One confirmed | `[A: confirmed]` | `hasProtectiveAssertion=true`, `activeConfirmedMarkers=[A]`, `historyHas.confirmed=true` |
| Two confirmed (different kinds) | `[A: confirmed attorney_client, B: confirmed work_product]` | `hasProtectiveAssertion=true`, `activeConfirmedMarkers=[A, B]` (D4.1) |
| Confirmed then waived (same row) | `[A: waived (was confirmed)]` | `hasProtectiveAssertion=false`, `activeConfirmedMarkers=[]`, `historyHas.confirmed=true`, `historyHas.waived=true` (D1.3) |
| Confirmed (live) + dismissed (separate row) | `[A: confirmed, B: dismissed]` | `hasProtectiveAssertion=true`, `activeConfirmedMarkers=[A]`, `historyHas.confirmed=true`, `historyHas.dismissed=true` |
| Only dismissed | `[A: dismissed]` | `hasProtectiveAssertion=false`, both `historyHas.proposed=true` and `historyHas.dismissed=true` |
| Only proposed | `[A: proposed]` | `hasProtectiveAssertion=false`, `historyHas.proposed=true` |
| Wrong target_type | `[A on document]` looked up for `fact` | empty resolution |
| Wrong target_id | `[A on docX]` looked up for `docY` | empty resolution |

---

## 4. Provenance fields and schema shape

```jsonc
{
  "id": "ULID",                                  // required
  "tenant_id": "string",                         // required
  "actor_user_id": "string",                     // required — creator
  "matter_id": "ULID",                           // required
  "target_type": "document|fact",                // required (v1 set)
  "target_id": "ULID",                           // required — opaque ref

  "kind": "attorney_client|work_product|joint_defense|common_interest",  // required on EVERY status (D2.2)
  "basis_text": "string",                        // required non-empty on EVERY status (D2.2 — waived marker must preserve basis)
  "status": "proposed|confirmed|dismissed|waived", // required

  // --- Source provenance ---
  "source_type": "lawyer_authored|llm_suggested|imported",  // required
  "extractor_name":       "string | null",       // required (nullable); see M5..M7
  "extractor_version":    "string | null",
  "extraction_confidence": "number | null",       // 0..1

  // --- Lifecycle trail ---
  "proposed_at":   "date-time",                  // required NON-NULL on every row (D1.5 fix); for lawyer-direct-confirmed this equals confirmed_at
  "confirmed_actor_user_id": "string | null",    // required (nullable); set on confirmed AND waived rows
  "confirmed_at": "date-time | null",
  "dismissed_actor_user_id": "string | null",
  "dismissed_at": "date-time | null",
  "dismissal_reason": "string | null",           // required non-null when status === dismissed
  "waiver_actor_user_id": "string | null",
  "waived_at": "date-time | null",
  "waiver_reason": "string | null",              // required non-null when status === waived

  // --- Timestamps ---
  "created_at": "date-time"                      // required
}
```

`kind` and `basis_text` move to **top-level required** (not conditional) per plan-review D2.2. Every marker row carries the legal basis from creation through every terminal state — the privilege-log export must be able to reconstruct what was proposed/protected/waived without losing the basis text.

### Schema invariants (`if/then`)

Seven invariants M1–M7. Every `then` clause redeclares constrained properties (post-Step-1-audit pattern).

#### M1: proposed status — confirmation/dismissal/waiver fields null

```jsonc
{
  "if":   { "properties": { "status": { "const": "proposed" } }, "required": ["status"] },
  "then": {
    "properties": {
      "confirmed_actor_user_id": { "type": "null" },
      "confirmed_at":            { "type": "null" },
      "dismissed_actor_user_id": { "type": "null" },
      "dismissed_at":            { "type": "null" },
      "dismissal_reason":        { "type": "null" },
      "waiver_actor_user_id":    { "type": "null" },
      "waived_at":               { "type": "null" },
      "waiver_reason":           { "type": "null" }
    }
  }
}
```

#### M2: confirmed status — confirmation fields required, dismissal/waiver fields null

```jsonc
{
  "if":   { "properties": { "status": { "const": "confirmed" } }, "required": ["status"] },
  "then": {
    "required": ["confirmed_actor_user_id", "confirmed_at"],
    "properties": {
      "confirmed_actor_user_id": { "type": "string", "minLength": 1 },
      "confirmed_at":            { "type": "string", "format": "date-time" },
      "dismissed_actor_user_id": { "type": "null" },
      "dismissed_at":            { "type": "null" },
      "dismissal_reason":        { "type": "null" },
      "waiver_actor_user_id":    { "type": "null" },
      "waived_at":               { "type": "null" },
      "waiver_reason":           { "type": "null" }
    }
  }
}
```

#### M3: dismissed status — dismissal fields required (including dismissal_reason), waiver fields null

```jsonc
{
  "if":   { "properties": { "status": { "const": "dismissed" } }, "required": ["status"] },
  "then": {
    "required": ["dismissed_actor_user_id", "dismissed_at", "dismissal_reason"],
    "properties": {
      "dismissed_actor_user_id": { "type": "string", "minLength": 1 },
      "dismissed_at":            { "type": "string", "format": "date-time" },
      "dismissal_reason":        { "type": "string", "minLength": 1 },
      "confirmed_actor_user_id": { "type": "null" },
      "confirmed_at":            { "type": "null" },
      "waiver_actor_user_id":    { "type": "null" },
      "waived_at":               { "type": "null" },
      "waiver_reason":           { "type": "null" }
    }
  }
}
```

#### M4: waived status — confirmation AND waiver fields all required (you can only waive what was confirmed), dismissal fields null

```jsonc
{
  "if":   { "properties": { "status": { "const": "waived" } }, "required": ["status"] },
  "then": {
    "required": ["confirmed_actor_user_id", "confirmed_at", "waiver_actor_user_id", "waived_at", "waiver_reason"],
    "properties": {
      "confirmed_actor_user_id": { "type": "string", "minLength": 1 },
      "confirmed_at":            { "type": "string", "format": "date-time" },
      "waiver_actor_user_id":    { "type": "string", "minLength": 1 },
      "waived_at":               { "type": "string", "format": "date-time" },
      "waiver_reason":           { "type": "string", "minLength": 1 },
      "dismissed_actor_user_id": { "type": "null" },
      "dismissed_at":            { "type": "null" },
      "dismissal_reason":        { "type": "null" }
    }
  }
}
```

#### M5: lawyer_authored — no extractor metadata

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

#### M6: llm_suggested — extractor_name required

```jsonc
{
  "if":   { "properties": { "source_type": { "const": "llm_suggested" } }, "required": ["source_type"] },
  "then": {
    "required": ["extractor_name"],
    "properties": {
      "extractor_name": { "type": "string", "minLength": 1 }
    }
  }
}
```

#### M7: imported — extractor_name required

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

### Validator-only checks

- **`assertValidNewPrivilegeMarker(marker)`** enforces:
  - `llm_suggested` and `imported` MUST start in `proposed`.
  - `lawyer_authored` MAY start in `proposed` OR `confirmed`.
  - No source MAY start in `dismissed` or `waived`.
  - On creation: dismissal AND waiver fields MUST be null.
  - On initial `proposed`: confirmation fields MUST be null AND `proposed_at` MUST be non-null.
  - On initial `confirmed` (lawyer-authored only): confirmation fields MUST be non-null AND `proposed_at` MAY equal `confirmed_at`.
  - Throws `PrivilegeMarkerCreationError`.
- **Temporal invariants** (`assertPrivilegeMarkerTimestamps`) — plan-review D2.3 fix:
  - `proposed_at <= confirmed_at` (when confirmed_at non-null).
  - `confirmed_at <= waived_at` (when waived_at non-null).
  - `proposed_at <= dismissed_at` (when dismissed_at non-null).
  - All timestamps MUST be in the past (no clock-skew enforcement at contract level; persistence MAY tighten).
  - Throws `PrivilegeMarkerCreationError`.
- **`effectivePrivilegeStatus`** — see §3.
- **Helper predicates**:
  - `isMarkerProtective(marker): boolean` — `marker.status === "confirmed"`.
  - `isMarkerLifecycleTerminal(marker): boolean` — `dismissed` or `waived`.
  - `isMachineSuggestedMarker(marker): boolean` — `source_type ∈ {"llm_suggested", "imported"}`.

---

## 5. Marker uniqueness and post-waiver behavior (plan-review D4.2 + D5.2)

**Concurrent confirmed markers on same target**: ALLOWED in the contract; persistence MUST enforce a uniqueness rule of one confirmed marker per `(tenant_id, matter_id, target_type, target_id, kind)`. Multiple kinds on the same target (e.g. attorney-client AND work-product) are allowed and produce multiple `activeConfirmedMarkers` entries in the resolver. **Recorded as a persistence obligation.**

**Post-waiver new markers**: ALLOWED. A waived marker is a separate row; creating a new marker on the same target after waiver is allowed and starts a new lifecycle. Persistence enforces that the new marker is a NEW row (new id, new `proposed_at`) — never an un-waive of the old one. **Recorded as a persistence obligation; the contract carries no `waiver_actor_user_id != null → cannot un-waive` rule because that's a cross-row constraint.**

**Tenant/matter consistency** (plan-review D4.3): persistence MUST verify the target referenced by `(target_type, target_id)` exists in the same `(tenant_id, matter_id)` as the marker. The contract carries the shape only. **Recorded as a persistence obligation.**

---

## 6. Audit-event mapping (Step-1 schema unchanged)

Existing `CaseBoxAuditEvent.action` enum (Step 1) already covers what's needed:

| Marker write | Audit `action` | Notes |
|---|---|---|
| Create new marker | `create` | `entity_type = "privilege_marker"` |
| `proposed → confirmed` | `update` | |
| `proposed → dismissed` | `update` | Audit-event `reason` SHOULD be set to the same value as `dismissal_reason` (plan-review D2.5 — preserves rejection rationale in the hash chain) |
| `confirmed → waived` | `privilege-waive` | Existing schema already requires `CaseBoxAuditEvent.reason` non-null for `privilege-waive`; this aligns with M4 `waiver_reason` non-null |

**No Step-1 schema change required.** This is the same posture as Step 2's audit-event reuse.

---

## 7. Validators, helpers, state machine, tests

### TypeScript helpers (new)

- **`src/validatePrivilegeMarker.ts`** — `validatePrivilegeMarker(payload): ValidationResult<CaseBoxPrivilegeMarker>`.
- **`src/privilege-invariants.ts`** (new file):
  - `assertValidNewPrivilegeMarker(marker): void` — creation rule from §4.
  - `assertPrivilegeMarkerTimestamps(marker): void` — temporal invariants from §4.
  - `effectivePrivilegeStatus(targetType, targetId, markers): PrivilegeResolution` — resolver from §3.
  - `isMarkerProtective`, `isMarkerLifecycleTerminal`, `isMachineSuggestedMarker`.
  - Error: `PrivilegeMarkerCreationError`.
  - Type: `PrivilegeResolution`.

### State machine (`transitions.ts`)

- `PrivilegeMarkerState`, `PRIVILEGE_MARKER_STATES`, `TERMINAL_PRIVILEGE_MARKER_STATES = ["dismissed", "waived"]`, `isTerminalPrivilegeMarkerState`.
- `ALLOWED_PRIVILEGE_MARKER_EDGES`: 3 edges, all `by: ["lawyer"]`, edges `proposed → dismissed` AND `confirmed → waived` both `reason_required: true`.
- `isAllowedPrivilegeMarkerTransition`, `assertValidPrivilegeMarkerTransition` (with optional `reason` arg, mirroring `assertValidDeadlineTransition`).
- Plan-review D5.3 fix: a dedicated state-machine test asserts edge-table contents EXACTLY match the documented edges to catch drift.

### Public surface (`src/index.ts`)

Validators: `validatePrivilegeMarker`.
Helpers: `assertValidNewPrivilegeMarker`, `assertPrivilegeMarkerTimestamps`, `effectivePrivilegeStatus`, `isMarkerProtective`, `isMarkerLifecycleTerminal`, `isMachineSuggestedMarker`.
Errors: `PrivilegeMarkerCreationError`.
State machine: `PRIVILEGE_MARKER_STATES`, `TERMINAL_PRIVILEGE_MARKER_STATES`, `isTerminalPrivilegeMarkerState`, `ALLOWED_PRIVILEGE_MARKER_EDGES`, `isAllowedPrivilegeMarkerTransition`, `assertValidPrivilegeMarkerTransition`, `type PrivilegeMarkerState`.
Schema: `privilegeMarkerSchema` (deep-frozen).
Types: `type CaseBoxPrivilegeMarker`, `type PrivilegeResolution`.

### Schema loading + gen-types

Same pattern as Step 2. Extend `loadSchemas.ts` and `gen-types.mjs` with one entry each.

### Fixtures

| Path | Purpose |
|---|---|
| `fixtures/valid/privilege-marker-proposed-llm.valid.json` | LLM-suggested, status=proposed, extractor_name set |
| `fixtures/valid/privilege-marker-proposed-lawyer-draft.valid.json` | lawyer-authored draft, status=proposed |
| `fixtures/valid/privilege-marker-confirmed-lawyer-direct.valid.json` | lawyer-authored direct-confirmed (proposed_at === confirmed_at) — plan-review D2.4 |
| `fixtures/valid/privilege-marker-confirmed-on-fact.valid.json` | confirmed marker, target_type=fact |
| `fixtures/valid/privilege-marker-dismissed.valid.json` | dismissed, dismissal_reason set |
| `fixtures/valid/privilege-marker-waived.valid.json` | waived, waiver_reason set |
| `fixtures/invalid/privilege-marker-confirmed-no-basis.json` | basis_text required at top level; missing |
| `fixtures/invalid/privilege-marker-confirmed-no-confirmer.json` | M2 violation |
| `fixtures/invalid/privilege-marker-dismissed-no-reason.json` | M3 violation |
| `fixtures/invalid/privilege-marker-waived-no-reason.json` | M4 violation |
| `fixtures/invalid/privilege-marker-waived-no-confirmer.json` | M4 violation (can't waive what wasn't confirmed) |
| `fixtures/invalid/privilege-marker-llm-without-extractor.json` | M6 violation |
| `fixtures/invalid/privilege-marker-imported-without-extractor.json` | M7 violation |
| `fixtures/invalid/privilege-marker-lawyer-with-extractor.json` | M5 violation |
| `fixtures/invalid/privilege-marker-bad-kind.json` | enum violation on kind |
| `fixtures/invalid/privilege-marker-bad-target-type.json` | enum violation on target_type |
| `fixtures/invalid/privilege-marker-missing-kind.json` | top-level required: kind |
| `fixtures/invalid/privilege-marker-proposed-with-confirmed-at.json` | M1 violation: proposed with non-null confirmed_at |

No semantic-invalid directory needed for Step 3 (temporal-invariant violations are tested via `assertPrivilegeMarkerTimestamps` directly, not via fixtures).

### Tests

- `contract.test.mjs` — extend with every valid + invalid fixture, per-fixture explicit.
- `validators.test.mjs` — `validatePrivilegeMarker` happy + each-error path; `assertValidNewPrivilegeMarker` positive + every-negative permutation; `assertPrivilegeMarkerTimestamps` per-temporal-rule.
- **`effectivePrivilegeStatus`** — full truth table from §3 (9 scenarios), each as a separate test.
- `state-machine.test.mjs` — load-bearing no-auto-privilege; reason-required on both dismissal AND waiver edges; excluded edges; self-transitions; edge-table-content drift test.
- `invariants.test.mjs` — every privilege-marker valid fixture carries `tenant_id` + `actor_user_id`; default-semantics test ("empty markers → `hasProtectiveAssertion === false`").
- `exports.test.mjs` — extend the four lists.

### Mechanical files

| File | Action |
|---|---|
| `schemas/case-box-privilege-marker.schema.json` | NEW |
| `src/loadSchemas.ts` | EXTEND |
| `src/validatePrivilegeMarker.ts` | NEW |
| `src/privilege-invariants.ts` | NEW |
| `src/transitions.ts` | EXTEND |
| `src/index.ts` | EXTEND |
| `src/generated/case-box-privilege-marker.ts` | NEW (generated, committed) |
| `scripts/gen-types.mjs` | EXTEND |
| `fixtures/valid/privilege-marker-*.valid.json` | 6 NEW |
| `fixtures/invalid/privilege-marker-*.json` | 12 NEW |
| `tests/contract.test.mjs` | EXTEND |
| `tests/validators.test.mjs` | EXTEND |
| `tests/state-machine.test.mjs` | EXTEND |
| `tests/invariants.test.mjs` | EXTEND |
| `tests/exports.test.mjs` | EXTEND |
| `README.md` | EXTEND |
| `docs/adr/case-box-step-3-privilege-marker-model.md` | NEW (co-committed) |

NOT touched: Step-1/Step-2 schemas, AGENTS.md, `package.json` (no new deps), OCR packages, persistence / ingestion / review / sync / UI / auth / cloud / LLM files.

---

## 8. Out of scope

- Persistence (`case-box-persistence` is a future WI; this plan records its obligations).
- Privilege log EXPORT (a future `case-box-review` concern).
- Page-range / evidence-item / matter-level markers.
- Auto-detection of privileged content (LLM lives outside).
- Cross-tenant or matter-spanning privilege.
- "Lawyer-cleared-as-not-privileged" status (deferred future evolution, plan-review D2.1).
- Privilege-log retention.

---

## 9. Acceptance criteria

1. `case-box-privilege-marker.schema.json` exists; M1–M7 invariants encoded; `then` clauses redeclare constrained properties (zero strictRequired warnings).
2. `src/generated/case-box-privilege-marker.ts` regenerated and committed.
3. `src/validatePrivilegeMarker.ts` exists; Step-1 validator pattern.
4. `src/privilege-invariants.ts` exports `assertValidNewPrivilegeMarker`, `assertPrivilegeMarkerTimestamps`, `effectivePrivilegeStatus`, `isMarkerProtective`, `isMarkerLifecycleTerminal`, `isMachineSuggestedMarker`, `PrivilegeMarkerCreationError`, `type PrivilegeResolution`.
5. `src/transitions.ts` extended with `PrivilegeMarkerState`, `PRIVILEGE_MARKER_STATES`, `TERMINAL_PRIVILEGE_MARKER_STATES = ["dismissed", "waived"]`, `ALLOWED_PRIVILEGE_MARKER_EDGES` (3 edges; 2 reason-required), `isAllowedPrivilegeMarkerTransition`, `assertValidPrivilegeMarkerTransition`.
6. `src/index.ts` re-exports every new symbol.
7. `src/index.ts` deep-freezes `privilegeMarkerSchema`.
8. `scripts/gen-types.mjs` extended; re-run produces no unexpected diff.
9. case-box-contract suite green (Step-2's 132 tests still green; new tests bring the total higher).
10. OCR contract tests stay 102/102 green.
11. Zero Ajv strictRequired warnings.
12. `tsc` passes clean.
13. **No Step-1 / Step-2 schema modified.** (Process check.)
14. **No OCR-package file modified.** (Process check.)
15. **No persistence / ingestion / review / sync / UI / auth / cloud / LLM file added or modified.** (Process check.)
16. **No new runtime dependency.** (Process check.)
17. **AGENTS.md unchanged.** (Process check.)
18. README extended; ADR co-committed.
19. **Load-bearing no-auto-privilege test** at state-machine level: `assertValidPrivilegeMarkerTransition("proposed", "confirmed", "lawyer")` succeeds AND same by `coordinator`/`ingestion`/`review` throws.
20. **Creation-rule test**: `assertValidNewPrivilegeMarker` rejects `llm_suggested` initial-status `confirmed`.
21. **Default-semantics test**: `effectivePrivilegeStatus("document", "<id>", [])` returns `{ hasProtectiveAssertion: false, activeConfirmedMarkers: [], historyHas: {proposed:false, confirmed:false, dismissed:false, waived:false}, allTargetMarkers: [] }`.
22. **Multiple-confirmed test**: resolver returns ALL active confirmed markers when more than one kind applies (plan-review D4.1).
23. **Waiver-vs-confirmed test**: a row in state `waived` is NOT in `activeConfirmedMarkers` (plan-review D1.3).
24. **Dismissal-reason-required test**: `confirmed → waived` AND `proposed → dismissed` both throw with empty reason and succeed with non-empty.
25. **Edge-table drift test**: `ALLOWED_PRIVILEGE_MARKER_EDGES` content (from/to/reason_required tuples) matches the documented set exactly.
26. **Lawyer-direct-confirmed fixture** exists and validates (`proposed_at === confirmed_at`).
27. **Type test**: `PrivilegeResolution` has NO field named `isPrivileged`, `safeToDisclose`, `disclosureClearance`, or `notPrivileged` (compile-time guard via TS type check).

Criteria #13–#17 are process / git-diff checks.

---

## 10. Audit questions

1. **No-auto-privilege**: every promotion edge throws for non-`lawyer`? `assertValidNewPrivilegeMarker` rejects machine-source initial-`confirmed`?
2. **Default semantics**: `effectivePrivilegeStatus` on empty markers returns the documented all-false shape, NOT any green-light boolean?
3. **Helper return shape**: `PrivilegeResolution` exports NO field that could be misread as a disclosure clearance?
4. **Multiple confirmed markers**: resolver returns the full list, not just one?
5. **Waiver-vs-confirmed precedence**: a row in state `waived` is excluded from `activeConfirmedMarkers`?
6. **Dismissal reason required**: both at state-machine `reason_required: true` AND at schema M3 `dismissal_reason` non-null?
7. **Waiver reason required**: same at state-machine AND M4?
8. **Source-type coherence**: M5/M6/M7 enforce extractor metadata rules?
9. **kind + basis_text at top level**: required on every status, including `dismissed` and `waived`?
10. **Temporal invariants**: `assertPrivilegeMarkerTimestamps` catches `confirmed_at < proposed_at`, `waived_at < confirmed_at`?
11. **Persistence obligations recorded**: marker uniqueness (per-target per-kind one confirmed), tenant/matter consistency, post-waiver new-marker policy all explicit in the ADR?
12. **No Step-1 / Step-2 schema change**: `git diff` empty for those files?
13. **Audit-event enum unchanged**: existing `action` enum NOT extended?
14. **README + ADR present**: both committed?
15. **Schema deep-freeze**: `privilegeMarkerSchema` frozen at public boundary?
16. **Strict-warning hygiene**: every `then` redeclares properties?
17. **`dismissed` not `rejected`**: state name is `dismissed` (avoids overload with `CaseBoxFact.status === "rejected"`)?
18. **Edge-table drift test present**: catches future drift between documented and actual edges?
19. **Lawyer-direct-confirmed path tested**: lawyer-authored marker created in `confirmed` validates AND passes `assertValidNewPrivilegeMarker`?
20. **No `isPrivileged` field**: compile-time guard exists in the type test?

---

## 11. Risks / open items

- **Helper-misuse risk remains real.** `hasProtectiveAssertion === false` is genuinely ambiguous between "no marker" and "all dismissed". Callers MUST treat it as "no protective assertion present" and NEVER as "safe to disclose". Tests + documentation must hammer this.
- **Marker uniqueness lives in persistence.** The contract allows multiple confirmed markers of the same kind on the same target. Until persistence ships, callers MAY accidentally create duplicates. Persistence MUST enforce.
- **Post-waiver new-marker policy lives in persistence.** Documented as allowed; persistence MUST allow new rows and MUST NOT permit un-waive on the old row.
- **Tenant/matter consistency lives in persistence.** Documented as a persistence obligation.
- **No "lawyer-cleared-as-not-privileged" v1.** A future evolution may add a status like `cleared_not_privileged`. Until then, UI/review must treat `hasProtectiveAssertion=false` AND `historyHas.dismissed=true` AS "every proposal was dismissed", which is NOT a clearance.
- **Step-1 evidence-item supersession confusion** still present. Not touched.
- **Audit-event `reason` mapping** for dismissal is recommended (audit "reason" SHOULD echo `dismissal_reason`), but the Step-1 audit-event schema does not currently REQUIRE `reason` for `action: "update"`. Persistence is encouraged to pass through dismissal_reason as audit reason; the contract does not enforce.

---

## 12. Plan-review thread

Codex review of the prior draft: thread `019e45d2`. Findings classified and resolved in this revision as follows:

| Codex finding | Resolution |
|---|---|
| D1.1 Critical — `unmarked` semantics contradict product/Step-0 wording | §0 explicit reconciliation: user authorization adopts stricter reading; ADR documents the rework recommendation for the product doc. |
| D5.1 Critical — helper return type allows disclosure-clearance misuse | §3 redesigns `PrivilegeResolution` as structured object with NO green-light field; acceptance #27 asserts no such field exists. |
| D1.2 High — row lifecycle inconsistent (3 rows vs 1) | §1 row-lifecycle paragraph explicit: single mutable row per marker; multi-row scenarios = N independent markers. |
| D1.3 High — resolver precedence wrong for confirmed-then-waived | §3 algorithm uses CURRENT status, not historical; acceptance #23 covers this. |
| D2.1 High — `rejected` ≠ lawyer-cleared-not-privileged | §3 explicit deferred-evolution note; §0 confirms v1 has no "cleared" status; helper does NOT return any field that could be misread. |
| D2.2 High — M3/M4 don't require kind/basis_text | §4 moves `kind` and `basis_text` to top-level required (every status carries them). |
| D2.5 Medium — audit-event reason for dismissal | §6 recommends audit "reason" SHOULD echo dismissal_reason; §11 records that schema does not REQUIRE it. |
| D3.3 High — resolver input contract underspecified | §3 explicit input contract: full marker array for matter, resolver does its own filtering. |
| D4.1 High — multiple confirmed markers collapsed | §3 `activeConfirmedMarkers` is an array. |
| D4.2 High — marker uniqueness unspecified | §5 documents persistence obligation: one confirmed marker per (target, kind). |
| D4.3 Medium — tenant/matter consistency at target | §5 records persistence obligation. |
| D4.4 Medium — `rejected` overloaded with fact's `rejected` | Renamed to `dismissed` throughout §2, §4 schema, all helpers, fixtures, tests, ADR. |
| D5.2 High — post-waiver new-marker policy undefined | §5 explicit: allowed (new row); persistence enforces. |
| D5.3 High — edge-table drift risk | Acceptance #25 adds explicit edge-table content test. |
| D1.4 Medium — proposed → waived typo in edge table | Fixed in §2 edge table (3 edges, no `proposed → waived`). |
| D1.5 Medium — proposed_at semantics for lawyer-direct-confirmed | §4 explicit: `proposed_at` = creation time; lawyer-direct-confirmed has `proposed_at === confirmed_at`. Acceptance #26 fixture covers this. |
| D2.3 Medium — temporal invariants missing | §4 + §7 add `assertPrivilegeMarkerTimestamps`. |
| D2.4 Medium — missing fixtures | §7 extends to 6 valid + 12 invalid covering confirmed+waived history (via M4 fixture), confirmed+dismissed (via resolver tests, not schema fixtures), multiple confirmed kinds (resolver test), lawyer-direct-confirmed, null `kind`. |
| D3.1 Medium / D3.2 Medium / D3.4 Low — feasibility | Confirmed: the redeclare pattern is feasible, generated types stay broad-nullable (D3.2), and audit-event reuse is fine (D3.4). No plan changes; explicit in §6. |

---

## 13. References

- `docs/adr/case-box-step-0-boundary.md` — boundary, confidentiality posture, ADR-series Step list.
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` — three-layer no-auto-X enforcement pattern this WI mirrors.
- `docs/product/product-target-architecture.md` — cross-cutting invariant #5 (read as "Privilege defaults to unmarked = NOT (privileged); explicit marker required" — see §0 reconciliation).
- `dev-memo/plan-case-box-step-2.md` — Step 2 plan structure.
- `dev-memo/superseded/case-box-plan.md` — historical `privilege_marker` shape.
- `docs/contracts/case-box-contract/src/transitions.ts` — state-machine pattern.
- `docs/contracts/case-box-contract/src/fact-invariants.ts` — `assertValidNewFact` pattern.
- `docs/contracts/case-box-contract/schemas/case-box-fact.schema.json` — `if/then` redeclare-property pattern.
- `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json` — existing `privilege-waive` action.
- Codex plan-review thread: `019e45d2`.
- `AGENTS.md` — coordinator-ownership, Stop-and-Ask gates.
