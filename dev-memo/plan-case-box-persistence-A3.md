# CASE-BOX-PERSISTENCE Phase A3 — Privilege Markers (bounded plan)

**Status**: round-2 plan after r1 review. NOT implementation. Round-1 verdict NEEDS REVISION (1 High + 2 Med + 2 Low); revisions applied.

## Review history

- 2026-05-21 round 1 — `/cc-suite:review-plan` via Path 1 runner attempt 1 (full packet): **SUCCEEDED** (no retry needed; CCSUITE-02 retry policy did not fire). Job `review-plan-mpfg6g50-noms5w`. Model gpt-5.5, effort high, sandbox read-only. Verdict **NEEDS REVISION**. Revisions applied (this version):
  - **H1.1 (direct-confirmed-create audit-kind clash)**: `PRIVILEGE_MARKER_CONFIRMED` is `action: "update"` per the contract table, but the round-1 plan emitted it for direct `status === "confirmed"` creates. FIX: A3 narrows the persistence surface — `appendPrivilegeMarker` accepts only `status === "proposed"`. Direct confirmed creation is REJECTED with `invalid_argument` even though the contract's `assertValidNewPrivilegeMarker` would allow lawyer-authored direct-confirmed. Callers must always do `append(proposed)` then `transition(proposed → confirmed)` — two atomic writes, two audit events, semantically clean.
  - **M2.1 (inline transition vs contract helper)**: `prepareTransitionPrivilegeMarker` now calls `assertValidPrivilegeMarkerTransition(from, to, "lawyer", reason)` from `docs/contracts/case-box-contract/src/transitions.ts:455`. `IllegalTransitionError` → `illegal_transition` code, mirroring A1's matter-transition pattern.
  - **M2.2 (post-waiver transition path test gap)**: added conformance §6.A3.20b — waived prior marker, new proposed marker same (target, kind), transition new marker to confirmed → SUCCEEDS.
  - **L2.3 (test-count drift)**: normalized to **27 conformance cases** plus invariants/audit-chain additions throughout the document.
  - **L3.1 (PrivilegeState shape implicit)**: pinned `PrivilegeState = { markersByMatter: Map<string, CaseBoxPrivilegeMarker[]>; privilegeIds: Set<string>; markerIndex: Map<string, string> /* markerId → matterId */ }`.
  - **L4.1 (unknown markerId code)**: added conformance §6.A3.A2b — `transitionPrivilegeMarker` with unknown markerId → `invalid_argument`.
  - **L5.1 (hasProtectiveAssertion misuse)**: added invariants test §6.2.A3.2 — `hasProtectiveAssertion === false` is NOT a `PrivilegeReviewState`, NOT external-handling clearance. Asserts the resolver output shape only.

Awaits round-2 `/cc-suite:review-plan`.
**Date**: 2026-05-21.
**Parent plan**: `dev-memo/plan-case-box-persistence-00.md` — A3 is the third row of §10.2 ("Privilege markers — Step 3").
**Built on**: A2 implementation (commit `f7f4bf5`) which shipped confidentiality classification. A3 extends the in-memory repository with privilege-marker storage + the contract's `effectivePrivilegeStatus` resolver.

This plan opens with the compact review packet per `.claude/rules/cc-suite.md` §"Review packet". The full body sits below.

---

## Review packet (compact)

### Active plan summary

Add privilege-marker storage to the in-memory case-box persistence built in A1 + A2. Phase A3 ships 4 new public methods: `appendPrivilegeMarker`, `transitionPrivilegeMarker`, `getPrivilegeStatus`, `listPrivilegeMarkers`. `appendPrivilegeMarker` accepts ONLY `status === "proposed"` (persistence narrows the contract surface so the audit table's update-only `PRIVILEGE_MARKER_CONFIRMED` action stays coherent — lawyer-authored confirmed creation goes through append(proposed) + transition(proposed → confirmed) as two atomic writes). Prior-row, lifecycle, and uniqueness obligations come from Step 3 ADR; the contract owns invariants via `assertValidNewPrivilegeMarker`, `assertPrivilegeMarkerTimestamps`, `assertValidPrivilegeMarkerTransition`, and `effectivePrivilegeStatus`. Public surface grows 14 → 18. No SQLite, no external handling execution, no fact-target support (deferred to A4).

### Exact target files

- `services/case-box-persistence/src/inMemoryPrivilege.ts` — NEW sibling module (parallel to A2's `inMemoryClassification.ts`)
- `services/case-box-persistence/src/inMemoryRepo.ts` — add 4 thin delegate methods + new state slot
- `services/case-box-persistence/src/cursor.ts` — add cursor kind `privilege_markers_by_matter` with tuple `[proposed_at:string, id:string]`
- `services/case-box-persistence/src/types.ts` — add 4 interface methods + 4 query/result types; re-export `PrivilegeResolution` from contract
- `services/case-box-persistence/src/index.ts` — re-export new types
- `services/case-box-persistence/tests/conformance/fixtures.mjs` — add `makePrivilegeMarkerInput`
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — add 27 conformance cases
- `services/case-box-persistence/tests/invariants.test.mjs` — bump §6.2.7 prototype allowlist to 18 entries

### Exact acceptance criteria

1. `npm --prefix services/case-box-persistence test` exits 0 (78 from A1+A2 + 27 new conformance from A3 + invariants/audit-chain additions ≈ 107 total).
2. `npm --prefix docs/contracts/case-box-contract test` still 322/322.
3. `npm --prefix docs/contracts test` (OCR) still 102/102.
4. loc-guardian: 0 files over fail (800); `inMemoryRepo.ts` stays under 800 with `inMemoryPrivilege.ts` extracted.
5. Public surface count = 18 (A1's 11 + A2's 3 + A3's 4); prototype allowlist matches.
6. No new `CaseBoxPersistenceError` code; A3 reuses A1+A2's 10 codes.
7. Audit chain remains valid spanning A1+A2+A3 events; `verifyAuditChainForMatter` passes.
8. cc-suite audit + verify via Path 1; retrievable via `/cc-suite:status`.
9. Confirmed-marker uniqueness `(tenant_id, matter_id, target_type, target_id, kind)` enforced.
10. `appendPrivilegeMarker` calls `assertValidNewPrivilegeMarker` + `assertPrivilegeMarkerTimestamps` before any mutation.

### Exact out-of-scope list

- No SQLite / `better-sqlite3` / native module.
- No `PrivilegeReviewState` computation / wrapper (Step 5 obligation 6 — A3 only ships the underlying markers; PrivilegeReviewState resolver waits for the lawyer-review record entity that does not yet exist).
- No `evaluateExternalHandling` / `assertExternalHandlingAllowed` invocation from persistence (Step 5 obligation 5 — also deferred).
- No `target_type === "fact"` (Phase A4 dependency).
- No API, UI, sync, cloud, auth, LLM-execution, OCR-package change, external network call, schema change, contract package edit, dependency change, ADR/release doc edit, .claude/** rule/skill edit, push, or parent-plan edit.

### Essential ADR references

- `docs/adr/case-box-step-3-privilege-marker-model.md` — Step 3 ADR; specifically §"Persistence obligations recorded" (uniqueness, tenant/matter consistency, post-waiver behavior, creation rule, audit emissions, timestamp invariants, supersession-graph carryover) and the no-disclosure-clearance signal contract.
- `docs/adr/case-box-step-5-confidentiality-classification.md` §"Persistence obligations recorded" item 6 — Step 5 explicitly defers `PrivilegeReviewState` computation to "Step 3 + lawyer-review record". A3 implements the marker storage half; the wrapper that translates markers → `PrivilegeReviewState` for `assertExternalHandlingAllowed` waits.

### Review questions (targeted)

1. Does the audit-kind selection logic (PROPOSED on create / CONFIRMED on proposed→confirmed transition / DISMISSED on proposed→dismissed / WAIVED on confirmed→waived) cover all legal transitions per Step 3 ADR §"Marker lifecycle (3 states + 2 transitions, deliberately tight)"?
2. Is the confirmed-marker uniqueness check at the right boundary (before mutation, scoped to `(tenant_id, matter_id, target_type, target_id, kind)`)? Does it correctly allow a NEW marker for the same kind after the prior confirmed marker has been waived?
3. Is `effectivePrivilegeStatus` from the contract surfaced verbatim — no persistence-side disclosure-safety inference? Specifically: A3 must NOT add `isPrivileged`, `safeToDisclose`, `notPrivileged`, or `disclosureClearance` fields anywhere.
4. Does the new cursor kind `privilege_markers_by_matter` follow the A2 pattern (per-kind tuple shape validation, filters_hash, ASC ordering by `proposed_at, id`)?
5. Is the LOC discipline sound — `inMemoryPrivilege.ts` extracted BEFORE coding (parallel to A2's pattern), with `inMemoryRepo.ts` gaining only thin delegates?

---

## 1. Scope

The smallest possible incremental slice that adds privilege-marker storage on top of the A2 persistence.

### 1.1 Functional scope — 4 new public methods (14 → 18)

1. **`appendPrivilegeMarker(input: unknown): Promise<CaseBoxPrivilegeMarker>`**
   - **Persistence narrows the contract surface**: A3 accepts ONLY `status === "proposed"`. Direct `status === "confirmed"` creation is REJECTED with `invalid_argument` even though the contract's `assertValidNewPrivilegeMarker` would allow it for `lawyer_authored`. This keeps the audit-table mapping coherent (the only audit kind with `action: "create"` for privilege markers is `PRIVILEGE_MARKER_PROPOSED`). Callers needing a confirmed marker do `append(proposed)` then `transition(proposed → confirmed)` — two atomic writes, two audit events.
   - Pre-schema raw guard for `target_type === "fact"` → `invalid_argument` ("not yet supported; A4 dependency").
   - Pre-schema raw guard for `target_type === "matter"` → `invalid_argument` (schema enum would also reject; matches A2 defense-in-depth pattern).
   - Pre-schema raw guard for `status !== "proposed"` → `invalid_argument` (this is the narrowing step described above).
   - `validateCaseBoxPrivilegeMarker` (or the equivalent generated validator) — failure → `invalid_payload`.
   - `assertValidNewPrivilegeMarker(row)` — `PrivilegeMarkerCreationError` → `invalid_payload`. With the status pre-check above, this call effectively validates the `proposed` creation rule (no dismissal/waiver/confirmation fields populated; `proposed_at` non-null).
   - `assertPrivilegeMarkerTimestamps(row)` — same mapping. Trivially passes for a fresh proposed row (only `proposed_at` set) but kept for defense-in-depth and forward compatibility with optional ingest paths.
   - Tenant/matter consistency via the document target (same pattern as A2): `unknown_document`, `tenant_mismatch`, `matter_id_mismatch`.
   - Confirmed-marker uniqueness on append: with the status restricted to `proposed`, this check is a no-op at append time. The uniqueness invariant is enforced at the transition path (proposed → confirmed) where it actually matters.
   - Duplicate-id check via `privilegeIds: Set<string>` index.
   - Audit kind: always `PRIVILEGE_MARKER_PROPOSED` (action: `create`; reason absent).
   - Audit event field bindings: `entity_id = row.id`; `before_state_hash = null` (action: create); `after_state_hash = entityStateHash(row)`; `timestamp = #nowIso()`; `actor_user_id = row.actor_user_id`; `tenant_id = row.tenant_id`; `matter_id = row.matter_id`; `reason` absent.
   - Atomic commit: validate everything → build event + hash → mutate state in one synchronous block.

2. **`transitionPrivilegeMarker(markerId: string, opts: PrivilegeTransitionOpts): Promise<CaseBoxPrivilegeMarker>`**
   - Loads the existing marker by `markerId` via `markerIndex.get(markerId)`. Unknown → `invalid_argument` (A3 deliberately reuses the existing 10-code set rather than introducing `unknown_marker`).
   - `PrivilegeTransitionOpts = { to: "confirmed" | "dismissed" | "waived"; actor_user_id: string; at: string; reason?: string }`.
   - **Pre-validates `opts.reason` for reason-required transitions** BEFORE calling the contract helper. If `opts.to` is `"dismissed"` or `"waived"` AND `opts.reason` is missing/empty → throw `CaseBoxPersistenceError({code: "invalid_argument"})`. This keeps "missing required input" semantically distinct from "this edge is illegal," matching A2's argument-validation pattern.
   - Then calls the contract's `assertValidPrivilegeMarkerTransition(marker.status, opts.to, "lawyer", opts.reason)` from `docs/contracts/case-box-contract/src/transitions.ts:455` as the single source of truth for legality. `IllegalTransitionError` → `CaseBoxPersistenceError({code: "illegal_transition"})`, mirroring A1's matter-transition mapping pattern. (With the pre-check above, the contract helper's reason check is reached only for legitimately reason-required edges where the reason IS supplied — defense-in-depth.)
   - The contract helper enforces:
     - `proposed → confirmed` legal, no reason required.
     - `proposed → dismissed` legal, reason required.
     - `confirmed → waived` legal, reason required.
     - All other source→target combinations and self-transitions rejected.
   - On confirm, sets `confirmed_actor_user_id = opts.actor_user_id`, `confirmed_at = opts.at`.
   - On dismiss, sets `dismissed_actor_user_id`, `dismissed_at`, `dismissal_reason`.
   - On waive, sets `waiver_actor_user_id`, `waived_at`, `waiver_reason`.
   - After patch: `assertPrivilegeMarkerTimestamps(next)` → on rejection map to `invalid_payload`.
   - Confirmed-marker uniqueness checked for `proposed → confirmed` transitions (the only path that creates a new confirmed marker in A3): reject if another marker with `status === "confirmed"` already exists for the same `(tenant, matter, target_type, target_id, kind)`. Code: `invalid_argument`.
   - Audit event:
     - `proposed → confirmed` → `PRIVILEGE_MARKER_CONFIRMED` (action: update; reason absent)
     - `proposed → dismissed` → `PRIVILEGE_MARKER_DISMISSED` (action: update; reason = `dismissal_reason`)
     - `confirmed → waived` → `PRIVILEGE_MARKER_WAIVED` (action: privilege-waive; reason = `waiver_reason`)
   - Audit field bindings: `entity_id = marker.id`; `before_state_hash = entityStateHash(prior)`; `after_state_hash = entityStateHash(next)`; `timestamp = #nowIso()`; other fields verbatim from the marker.
   - Returns the patched marker (deep-cloned).

3. **`getPrivilegeStatus(query: GetPrivilegeStatusQuery): Promise<PrivilegeResolution>`**
   - `query = { tenant_id, matter_id, target_type: "document", target_id }`.
   - Resolves target document; rejects unknown / tenant-mismatch / matter-mismatch using A1/A2 codes.
   - Calls `effectivePrivilegeStatus(target_type, target_id, allMarkersForMatter)` from the contract verbatim. Returns the resolver's output WITHOUT TRANSFORMATION — A3 must not add disclosure-safety inference fields.
   - Markers are deep-cloned before being passed to the resolver and (because the resolver returns a subset of those markers) the returned `activeConfirmedMarkers` / `allTargetMarkers` arrays are safe to expose without further cloning.

4. **`listPrivilegeMarkers(query: ListPrivilegeMarkersQuery): Promise<ListPrivilegeMarkersPage>`**
   - `query = { tenant_id, matter_id, target_type?, target_id?, status?, kind?, cursor?, limit? }`.
   - Filter rules: `target_id` without `target_type` → `invalid_argument` (same rule as A2 listClassifications).
   - Pagination: chronological order by `proposed_at ASC, id ASC`.
   - Cursor kind: `privilege_markers_by_matter`; tuple `[proposed_at:string, id:string]`; filters_hash over the full filter object minus undefined values.
   - Seek predicate: `proposed_at > lastProposedAt || (proposed_at === lastProposedAt && id > lastId)`.
   - Rejects `unknown_matter` / `tenant_mismatch` per A1.

### 1.2 Non-functional scope

- No new dependency (still only `case-box-contract`).
- LOC discipline: new sibling `src/inMemoryPrivilege.ts` BEFORE coding (parallel to A2's `inMemoryClassification.ts`). `inMemoryRepo.ts` gains thin delegates only; aim to keep it under the 800 LOC fail threshold (A2 left it at 504).
- A1 + A2 audit-chain shape preserved — A3 only adds new KINDS to the existing builder pathway.
- A3 read APIs are NOT authorization signals for OCR/sync/LLM (same posture as A2). `effectivePrivilegeStatus` is a status read, NOT a green-light for external handling.

---

## 2. Files expected to be added or modified

| Path | Action | Substance |
|---|---|---|
| `services/case-box-persistence/src/inMemoryPrivilege.ts` | **NEW** | Module-private storage + helpers. Pinned state shape: `PrivilegeState = { markersByMatter: Map<string, CaseBoxPrivilegeMarker[]>; privilegeIds: Set<string>; markerIndex: Map<string, string> /* markerId → matterId */ }`. Exports `createPrivilegeState`, `prepareAppendPrivilegeMarker`, `prepareTransitionPrivilegeMarker`, `getEffectivePrivilege`, `listPrivilegeMarkers` plus centralized comparator `compareMarkersChronological` (parallel to A2's `compareClassificationLatestFirst`). |
| `services/case-box-persistence/src/inMemoryRepo.ts` | modified | Add `privilege: PrivilegeState` slot. Add 4 thin delegate methods (≤15 LOC each). Pre-validate `markerId` / `matter_id` before generators run. |
| `services/case-box-persistence/src/cursor.ts` | modified | Add `"privilege_markers_by_matter"` to `CaseBoxCursorKind` union; add per-kind tuple validation `[string, string]`. |
| `services/case-box-persistence/src/types.ts` | modified | New interface methods + types: `PrivilegeTransitionOpts`, `GetPrivilegeStatusQuery`, `ListPrivilegeMarkersQuery`, `ListPrivilegeMarkersPage`. Re-export `PrivilegeResolution`, `CaseBoxPrivilegeMarker` from contract. |
| `services/case-box-persistence/src/index.ts` | modified | Re-export new public types. |
| `services/case-box-persistence/tests/conformance/fixtures.mjs` | modified | Add `makePrivilegeMarkerInput(overrides?)` with sensible defaults (lawyer_authored, proposed, attorney_client kind, document target). |
| `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` | modified | Add 27 conformance cases per §6 below. |
| `services/case-box-persistence/tests/invariants.test.mjs` | modified | §6.2.7 allowlist bumps to 18 entries. |

**Total expected**: 1 new source file + 4 modified source files + 3 modified test files = 8 file diffs. No package.json change (no new dependency).

---

## 3. Files expected to remain untouched

- `docs/contracts/case-box-contract/**` — A3 only imports; does NOT modify.
- All other `services/**` packages untouched.
- All ADRs / release docs untouched.
- `.claude/**` untouched.
- Three pre-existing user-deferred dev-memo drafts untouched.

---

## 4. Invariants from Steps 0-7 enforced (or carried forward)

### Carried forward from A1 + A2

- `tenant_id` cross-entity consistency.
- Atomic write discipline (validate, build event + hash, mutate).
- Audit emission via `buildCaseBoxAuditEvent` only.
- Per-matter monotonic `sequence` for chain order.
- `local-user` sentinel valid (A3 adds no opt-in flag write API).
- Contract state-machine guards as single source of truth (here: `assertValidNewPrivilegeMarker`, `assertPrivilegeMarkerTimestamps`, `assertValidPrivilegeMarkerTransition` from `docs/contracts/case-box-contract/src/transitions.ts:455`). The transition helper enforces both legality AND non-empty reason for the reason-required edges (`proposed → dismissed`, `confirmed → waived`).

### New for A3 (from Step 3 ADR §"Persistence obligations recorded")

1. **Creation rule via contract**: every insert calls `assertValidNewPrivilegeMarker` before mutation. (A3 implements this in `prepareAppendPrivilegeMarker`.)
2. **Confirmed-marker uniqueness** `(tenant_id, matter_id, target_type, target_id, kind)` for `status === "confirmed"`: at most one. Enforced both at append (when status starts as `confirmed`) and at transition (when transitioning `proposed → confirmed`). Lookups: linear scan of per-matter array filtered by the 4-tuple. (A1+A2's matter scale is small enough that a Set/Map index for the unique key is unnecessary in A3; LOC budget over feature.)
3. **Target tenant/matter consistency**: enforced for document targets via the existing A2 pattern.
4. **Post-waiver behavior**: A new marker for the same `(target, kind)` AFTER a confirmed marker has been waived IS allowed. The prior waived marker remains in history. The new marker is a separate row.
5. **Audit emissions per §7 mapping**: implemented exactly per `CASE_BOX_AUDIT_EVENT_KINDS` table. Dismissed/waived require non-empty reason; the audit event's `reason` field carries `dismissal_reason` / `waiver_reason` verbatim (exact-string equality, same posture as A2's `change_reason_code`).
6. **`assertPrivilegeMarkerTimestamps` applied after any lifecycle update**: after every transition, persistence calls the contract helper on the proposed-next-state row before mutation.
7. **Supersession-graph cycle detection** (carryover from Step 2 obligation): A3 does NOT yet implement; facts ship in A4. Privilege markers themselves do not form a supersession graph. **Marked deferred-by-design.**

### Phase deferral notes (deliberate)

- **`PrivilegeReviewState` computation wrapper**: NOT in A3. Step 5 obligation 6 requires a lawyer-review record entity to distinguish "all proposals dismissed" from "lawyer cleared". That entity does not yet exist. A3 ships the raw markers; downstream phases ship the wrapper.
- **`evaluateExternalHandling`**: NOT in A3. Requires `PrivilegeReviewState`. Same dependency chain.
- **Fact-target markers**: NOT in A3. Phase A4 dependency.

---

## 5. Out of scope

Same exclusions as A1 + A2 plus:

- No `target_type === "fact"`.
- No `PrivilegeReviewState` computation.
- No `evaluateExternalHandling`.
- No new `CaseBoxPersistenceError` code (`unknown_marker` is tempting but A3 uses `invalid_argument` for unknown marker IDs to keep the documented code set at 10).
- No supersession-graph code (Step 2 / A4).
- No commit until cc-suite audit + verify both pass.

---

## 6. Tests planned

27 new conformance cases + 2 invariants additions + 2 audit-chain additions.

### 6.1 Conformance matrix additions

| § | Case | Asserts |
|---|---|---|
| 6.A3.1 | `appendPrivilegeMarker` proposed happy path | row stored; one PRIVILEGE_MARKER_PROPOSED audit event; reason absent |
| 6.A3.2 | `appendPrivilegeMarker` rejects direct `status === "confirmed"` (A3 narrows surface) | `invalid_argument` ("A3 accepts only status === proposed; use transition") |
| 6.A3.3 | `appendPrivilegeMarker` rejects new "dismissed" row | `invalid_argument` (status pre-check rejects before contract creation rule fires) |
| 6.A3.4 | `appendPrivilegeMarker` rejects new "waived" row | `invalid_argument` (same as 6.A3.3) |
| 6.A3.5 | `appendPrivilegeMarker` accepts machine-source proposed creation | row stored; PRIVILEGE_MARKER_PROPOSED event (machine sources legal at proposed) |
| 6.A3.6 | `appendPrivilegeMarker` rejects non-null dismissal/waiver fields on new row | `invalid_payload` |
| 6.A3.7 | `appendPrivilegeMarker` rejects null proposed_at | `invalid_payload` |
| 6.A3.8 | `appendPrivilegeMarker` rejects `target_type === "matter"` | `invalid_argument` |
| 6.A3.9 | `appendPrivilegeMarker` rejects `target_type === "fact"` (A4 dependency) | `invalid_argument` |
| 6.A3.10 | `appendPrivilegeMarker` rejects unknown document | `unknown_document` |
| 6.A3.11 | `appendPrivilegeMarker` rejects tenant mismatch | `tenant_mismatch` |
| 6.A3.12 | `appendPrivilegeMarker` rejects matter_id mismatch | `matter_id_mismatch` |
| 6.A3.13 | `appendPrivilegeMarker` rejects duplicate id | `duplicate_id` |
| 6.A3.14 | `appendPrivilegeMarker` allows two proposed markers for same (target, kind) | both succeed (uniqueness is on confirmed only) |
| 6.A3.A2b | `transitionPrivilegeMarker` rejects unknown markerId | `invalid_argument` |
| 6.A3.15 | `transitionPrivilegeMarker` proposed → confirmed happy path | PRIVILEGE_MARKER_CONFIRMED event; reason absent; row's confirmed_actor + confirmed_at populated |
| 6.A3.16 | `transitionPrivilegeMarker` proposed → confirmed rejects duplicate confirmed for same (target, kind) | `invalid_argument` |
| 6.A3.17 | `transitionPrivilegeMarker` proposed → dismissed requires reason | missing reason: `invalid_argument`; with reason: PRIVILEGE_MARKER_DISMISSED audit; `reason === dismissal_reason` |
| 6.A3.18 | `transitionPrivilegeMarker` confirmed → waived requires reason | missing reason: `invalid_argument`; with reason: PRIVILEGE_MARKER_WAIVED audit; `reason === waiver_reason` |
| 6.A3.19 | `transitionPrivilegeMarker` illegal transition (e.g. dismissed → confirmed) | `illegal_transition` |
| 6.A3.20 | post-waiver: waived → new proposed for same (target, kind) | append second proposed marker SUCCEEDS (uniqueness scoped to `confirmed` only) |
| 6.A3.20b | post-waiver transition path: waived → new proposed → transition to confirmed | proposed→confirmed transition of the NEW marker SUCCEEDS (legitimate re-classification after waiver) |
| 6.A3.21 | `transitionPrivilegeMarker` enforces timestamp ordering (e.g. confirmed_at < proposed_at) | `invalid_payload` |
| 6.A3.22 | `getPrivilegeStatus` empty markers → `hasProtectiveAssertion: false` + empty history | resolver shape verbatim |
| 6.A3.23 | `getPrivilegeStatus` confirmed exists → `hasProtectiveAssertion: true` + activeConfirmedMarkers contains the row | resolver shape verbatim |
| 6.A3.24 | `getPrivilegeStatus` rejects unknown document | `unknown_document` |
| 6.A3.25 | `listPrivilegeMarkers` cursor pagination, filter by `kind`, ordered by proposed_at ASC | multi-page; no duplicates; null cursor at end |
| 6.A3.26 | `listPrivilegeMarkers` rejects `target_id` without `target_type` | `invalid_argument` |
| 6.A3.27 | `listPrivilegeMarkers` rejects unknown matter | `unknown_matter` |

### 6.2 Invariants test additions

- **§6.2.7 prototype allowlist** (modified): now expects 18 entries (A1's 11 + A2's 3 + A3's 4): `appendPrivilegeMarker`, `transitionPrivilegeMarker`, `getPrivilegeStatus`, `listPrivilegeMarkers` added.
- **§6.2.A3.1**: `PrivilegeResolution` exposed by `getPrivilegeStatus` does NOT contain `isPrivileged`, `safeToDisclose`, `notPrivileged`, or `disclosureClearance` keys (defends Step 3 anti-disclosure-clearance contract).
- **§6.2.A3.2**: `hasProtectiveAssertion === false` is NOT a `PrivilegeReviewState` and is NOT external-handling clearance. Test asserts the resolver's shape (the `hasProtectiveAssertion` + `activeConfirmedMarkers` + `historyHas` + `allTargetMarkers` keys), and explicitly notes via doc/comment that A3 ships NO API that consumes the resolver as an authorization signal. The wrapper translating markers → `PrivilegeReviewState` waits for the lawyer-review record entity (Step 5 obligation 6).

### 6.3 Audit chain test additions

- **§6.3.A3.1**: PROPOSED → CONFIRMED → WAIVED chain remains hash-valid; `verifyAuditChainForMatter` returns `ok: true` for chains spanning A1+A2+A3 events.
- **§6.3.A3.2**: audit event's `reason` field equals row's `dismissal_reason` for DISMISSED and row's `waiver_reason` for WAIVED.

---

## 7. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Confirmed-marker uniqueness check bypassed by transition path (proposed → confirmed) | Medium | High — two simultaneous confirmed markers for same (target, kind) corrupts privilege semantics | A3 re-runs the uniqueness check at transition, scoped to `confirmed` status excluding the marker being transitioned. Conformance §6.A3.16 pins. |
| R2 | Audit kind selection diverges from `CASE_BOX_AUDIT_EVENT_KINDS` action vs status mapping | Low | Medium | Hard-coded per-transition kind in `prepareTransitionPrivilegeMarker`. Conformance §6.A3.15-18 exercise each. |
| R3 | `getPrivilegeStatus` accidentally leaks markers from another tenant or matter | Low | Critical — tenant isolation breach | A3 filters at the persistence boundary (tenant + matter checks) BEFORE invoking `effectivePrivilegeStatus`. The resolver's `markers` array contains only that matter's markers. Conformance §6.A3.24 (unknown document) + invariants pin. |
| R4 | A3 leaks a disclosure-safety inference (e.g. `safeToDisclose` derived field) | Low | High — would defeat Step 3's no-disclosure-clearance contract | Invariants test §6.2.A3.1 asserts no such keys exist on the resolver output. |
| R5 | Timestamps not validated at transition; clock skew or lifecycle inversion allowed | Medium | Medium | `assertPrivilegeMarkerTimestamps(next)` runs BEFORE mutation in `prepareTransitionPrivilegeMarker`. Conformance §6.A3.21 pins. |
| R6 | LOC discipline — combined inMemoryRepo + inMemoryPrivilege approaches 800 | Medium | Medium | Sibling module split pre-emptive. Monitor; if `inMemoryPrivilege.ts` exceeds 350, extract transition logic separately. |
| R7 | Cursor tuple shape conflicts with classification cursor (both use `[string, string]`) | Low | Low | Cursor kind is distinct; filters_hash mismatch rejects cross-kind cursor reuse. Same defense pattern as A2. |
| R8 | Post-waiver behavior: persistence accidentally blocks new confirmed marker after waiver | Medium | High — blocks legitimate re-classification | Uniqueness check excludes markers with `status === "waived"` (and `dismissed`). Only `confirmed` markers participate in the uniqueness scope. Conformance §6.A3.20 pins. |
| R9 | `transitionPrivilegeMarker` mutates the wrong marker (collision on markerId across matters) | Low | High | Persistence-side `privilege.markerIndex: Map<markerId, matterId>` resolves marker → matter; transitions confirmed against the resolved matter. |

---

## 8. Acceptance criteria

Phase A3 commit acceptable iff ALL of the following hold:

| # | Acceptance | How verified |
|---|---|---|
| 8.1 | `npm --prefix services/case-box-persistence test` exits 0 with all conformance + invariants + audit-chain tests passing (78 from A1+A2 + 27 new conformance + ~4 invariants/audit-chain additions ≈ 109 total; exact count confirmed at commit time) | test output captured in commit |
| 8.2 | `tsc --noEmit` clean | implicit via `npm test` |
| 8.3 | `npm --prefix docs/contracts/case-box-contract test` still 322/322 | spot check |
| 8.4 | `npm --prefix docs/contracts test` (OCR) still 102/102 | spot check |
| 8.5 | loc-guardian: 0 over fail | re-scan from repo root |
| 8.6 | No file outside §2 modified | `git diff --cached --name-only` |
| 8.7 | Public surface count = 18; §6.2.7 prototype allowlist matches | invariants test |
| 8.8 | No new `CaseBoxPersistenceError` code; all A3 paths reuse the 10 codes | conformance |
| 8.9 | Audit chain valid across A1+A2+A3 events; `verifyAuditChainForMatter` returns `ok: true` | auditChain test §6.3.A3.1 |
| 8.10 | `audit.reason` equality verified for DISMISSED + WAIVED kinds | auditChain test §6.3.A3.2 |
| 8.11 | cc-suite review-plan completed (Path 1 or Path 2 fallback per CCSUITE-02 retry policy); audit + verify via Path 1 (broker discipline preserved) | recorded per `.claude/rules/cc-suite.md` §"Required recording" (11 fields per invocation; retry attempts logged when applicable) |
| 8.12 | Ready-for-commit per the staging-hygiene rule (explicit-stage path list); commit requires user authorization per autonomy policy | dry-run via `git add --dry-run` |

---

## 9. Out-of-scope clarifications for the reviewer

Do NOT flag:

- Absence of `PrivilegeReviewState` computation / wrapper — Step 5 obligation 6 + the lawyer-review record entity gap explicitly defer this.
- Absence of `evaluateExternalHandling` — same dependency chain.
- Absence of `unknown_marker` error code — A3 deliberately uses `invalid_argument` to preserve the 10-code set.
- Absence of fact-target markers — A4 dependency.
- No new SQLite implementation — Phase B gated.
- A3 keeps `src/cursor.ts` as a local copy rather than extracting a shared helper — that extraction is a separate WI.
- A3 does NOT use a `Set<string>` index for the confirmed-uniqueness check (only for `privilegeIds` duplicate-id detection). Linear scan over per-matter markers is acceptable at this scale.

Reviewer SHOULD flag:

- Audit kind selection that deviates from the `CASE_BOX_AUDIT_EVENT_KINDS` action vs status mapping.
- Any path that infers disclosure safety from `effectivePrivilegeStatus` output (e.g. derived `safeToDisclose` field).
- Any path that allows two simultaneous confirmed markers for the same `(tenant, matter, target_type, target_id, kind)`.
- Any path that blocks a new confirmed marker after the prior one has been waived.
- Reason-equality drift between audit event and row for DISMISSED / WAIVED kinds.
- LOC discipline drift if `inMemoryRepo.ts` approaches 800 fail.
- Any cross-tenant or cross-matter leak in `getPrivilegeStatus` / `listPrivilegeMarkers`.

---

## 10. cc-suite invocation plan (per `.claude/rules/cc-suite.md` + CCSUITE-02 retry policy)

| Stage | Kind | Path attempts |
|---|---|---|
| Plan review (this file) | `review-plan` | Attempt 1: Path 1 full packet. Attempt 2 (on TIMEOUT): Path 1 compact packet. Attempt 3 (on second TIMEOUT): Path 2 direct MCP compact packet. |
| Implementation audit | `audit` (mini) | Path 1. Fall to Path 2 on failure per §"Failure handling" (audit/verify skip retry). |
| Post-fix verify | `verify` | Path 1 with explicit audit artifact reference. |

Recording fields per §"Required recording" (now 11 per CCSUITE-02) captured in the eventual implementation commit.

---

## 11. References

- `dev-memo/plan-case-box-persistence-00.md` — parent plan.
- `dev-memo/plan-case-box-persistence-A1.md`, `dev-memo/plan-case-box-persistence-A2.md` — preceding reviewed plans.
- `docs/adr/case-box-step-3-privilege-marker-model.md` — Step 3 ADR; §"Persistence obligations recorded".
- `docs/adr/case-box-step-4-audit-log-shape.md` — audit chain.
- `docs/adr/case-box-step-5-confidentiality-classification.md` — Step 5; obligation 6 defers PrivilegeReviewState.
- `docs/contracts/case-box-contract/src/privilege-invariants.ts` — `assertValidNewPrivilegeMarker`, `assertPrivilegeMarkerTimestamps`, `effectivePrivilegeStatus`, `PrivilegeMarkerCreationError`, `PrivilegeResolution`.
- `docs/contracts/case-box-contract/src/audit-log.ts` — `CASE_BOX_AUDIT_EVENT_KINDS` (PRIVILEGE_MARKER_PROPOSED/CONFIRMED/DISMISSED/WAIVED at lines 94-97).
- `docs/contracts/case-box-contract/schemas/case-box-privilege-marker.schema.json` — schema; enums for kind / status / source_type / target_type; lifecycle field if/then rules.
- `services/case-box-persistence/src/inMemoryRepo.ts`, `src/inMemoryClassification.ts`, `src/cursor.ts` — A1+A2 implementation; A3 extends.
- `.claude/rules/cc-suite.md` — broker policy + CCSUITE-02 retry policy + 11-field recording.
- `dev-memo/cc-suite-reliability-log.md` (CCSUITE-02) — append failure entries here if the retry policy fires.
