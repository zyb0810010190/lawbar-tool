# CASE-BOX-PERSISTENCE Phase A2 — Confidentiality Classification (bounded plan)

**Status**: plan only. NOT implementation. Awaits `/cc-suite:review-plan` per `.claude/rules/cc-suite.md` (HIGH-RISK: persistence package writes; broker required).
**Date**: 2026-05-21.
**Parent plan**: `dev-memo/plan-case-box-persistence-00.md` (commit `4f39e02`) — A2 is the second row of §10.2 ("Confidentiality classification (Step 5) — append-only").
**Built on**: A1 implementation (commit `5de5530`) which shipped matter + document + audit-chain head + listAuditEvents.

This file is the bounded review target for `/cc-suite:review-plan`. It narrows scope to exactly what Phase A2 ships, pins acceptance criteria, and enumerates invariants from `docs/adr/case-box-step-5-confidentiality-classification.md`.

## Review history

- 2026-05-21 round 2 — Path 2 direct MCP (Path 1 still impractical for this scope at high effort). Thread `019e4a11-dda3-7612-af21-49856e8b3f44`. Verdict: **READY TO BUILD**. 0 Critical, 0 High, 4 Mediums + 1 Low — all clarifications applied:
  - **C-r2 audit-actor bindings**: pinned `tenant_id = row.tenant_id`, `actor_user_id = row.actor_user_id`, `matter_id = row.matter_id` verbatim from the row; `id` from `#generateId()`.
  - **C-r2 set_at ownership**: persistence preserves the caller's `set_at`; audit `timestamp` is independent (sourced from `#nowIso()`).
  - **C-r2 §6.A2.17 ordering test**: rewrote to insert rows in different order than their `set_at` values so the test actually exercises chronological ordering rather than insertion order.
  - **C-r2 test-count consistency**: acceptance §8.1 now matches the matrix (24 conformance + ~5 other = ~81 total).
  - **L deferring external handling**: confirmed correctly deferred; ADR Step 5 obligation 5 cannot fire in A2.

- 2026-05-21 round 1 — `/cc-suite:review-plan` via Path 1 runner attempt: **FAILED** (`spawnSync codex ETIMEDOUT`), runner job `review-plan-mpfb4bti-jca7a2`. Path 2 (direct MCP) fallback per `.claude/rules/cc-suite.md` §"Failure handling": threadId `019e4a0b-1d22-78a0-92ee-f0e900c1c1ea`, model `gpt-5.5`, effort `high`, sandbox `read-only`, approval `on-failure`. `/cc-suite:status` retrievable for the failed Path-1 job (state.json records the failure); the Path-2 review output is NOT retrievable via `/cc-suite:status` (only via the recorded threadId for `/cc-suite:continue`). Verdict: **NEEDS REVISION**. 1 High + 6 Mediums + Lows. Revisions applied (this version):
  - **H1.1 (audit kind selection)**: `otherwise → CLASSIFICATION_UPGRADED` was too broad. Fixed: added same-level (`prior === next`) rejection with `invalid_argument`; pinned `unclassified → X` as UPGRADED (lattice entry); preserved priority order (SET > RESET > DOWNGRADE > REJECT-same-level > UPGRADED).
  - **M1.2 (target_type="matter" pre-schema guard)**: persistence now performs a raw-object guard BEFORE schema validation so the code is `invalid_argument` (not the schema's generic `invalid_payload`).
  - **M1.3 (audit reason "absent or null")**: pinned to ABSENT entirely; schema does NOT allow `reason: null`.
  - **M2.1 (target-filter conformance gaps)**: added cases 6.A2.22 (filtered by target_type + target_id), 6.A2.23 (filter by target_type alone), 6.A2.24 (target_id without target_type → invalid_argument).
  - **M2.2 (audit field bindings)**: pinned `entity_id = row.id`, `before_state_hash = null` (all CLASSIFICATION_* are action=create), `after_state_hash = entityStateHash(row)`, `timestamp` from single `#nowIso()` capture, `reason` set per kind.
  - **L2.3 (test-count inconsistency)**: normalized to 24 conformance cases.
  - **M3.1 (LOC discipline)**: A2 introduces `src/inMemoryClassification.ts` as a sibling module BEFORE coding; the main `inMemoryRepo.ts` gains only short delegates. No after-the-fact extraction; pre-emptive split.
  - **L3.2 (uniqueness index)**: pinned `classificationIds: Set<string>` for O(1) duplicate-id detection alongside the per-matter array.
  - **M4.1 (chain-order terminology)**: list ordering renamed to "classification chronological order"; audit-chain append order remains the `listAuditEvents` story only.
  - **L4.2 (structured-combination escape)**: removed; A2 commits to exact-string `audit.reason === row.change_reason_code` equality with no escape.
  - **L4.3 (seek predicate)**: pinned `set_at > lastSetAt || (set_at === lastSetAt && id > lastId)`.
  - **L5.1 (read-API authorization-signal clarity)**: §1.2 now explicitly states A2 read APIs are NOT authorization signals; only `assertExternalHandlingAllowed` (deferred to A3+) is.
  - **M5.2 (Path 2 acceptance)**: §8.11 updated to allow Path 2 fallback when Path 1 fails, recording the threadId and marking status retrievability NO.

---

## 1. Scope

The smallest possible incremental slice that adds confidentiality classification storage on top of the A1 in-memory persistence.

### 1.1 Functional scope — 3 new public methods (10 → 13)

1. **`appendConfidentialityClassification(input: unknown): Promise<CaseBoxConfidentialityClassification>`**
   - Calls `validateConfidentialityClassification` from the contract.
   - **PRE-schema raw-object guard**: rejects `target_type === "matter"` with `code: "invalid_argument"` BEFORE schema validation runs, so callers get a meaningful code rather than the generic `invalid_payload` the schema would emit. Matter-level confidentiality lives on the matter row, NOT on this entity per Step 5 obligation 10.
   - REJECTS `target_type === "fact"` with `code: "invalid_argument"` for now — A4 will add facts; until then, fact classifications cannot be tenant/matter-checked. (Persistence obligation: target row must exist; without facts, only documents are valid targets in A2.)
   - For `target_type === "document"`: resolves the document by `target_id`. Rejects unknown document with `code: "unknown_document"`. Rejects `(tenant_id, matter_id)` pair mismatch against the document's owning matter with `code: "tenant_mismatch"` or `code: "matter_id_mismatch"`.
   - Loads the prior row (latest by `set_at DESC, id ASC`) for the same `(target_type, target_id)`. Passes it to `assertValidNewConfidentialityClassification(row, priorRow)`. Maps `ConfidentialityCreationError` → `CaseBoxPersistenceError({code: "invalid_payload"})`.
   - Audit kind chosen by transition (priority-ordered; first match wins):
     - `priorLevel === null` → `CLASSIFICATION_SET` (any `next` value including `unclassified`, except the schema requires `prior_level === null` for the first row anyway).
     - `isResetToUnclassified(prior, next)` (= `prior !== null && prior !== "unclassified" && next === "unclassified"`) → `CLASSIFICATION_RESET_TO_UNCLASSIFIED` (audit `reason === row.change_reason_code` — exact string equality, NOT a structured combination).
     - `isDowngrade(prior, next)` → `CLASSIFICATION_DOWNGRADED` (audit `reason === row.change_reason_code` — exact string equality).
     - `prior === next` (same-level redundant write) → REJECTED with `code: "invalid_argument"`. No audit. Same-level writes are degenerate; A2 declines them rather than emit a no-op chain event.
     - all remaining cases → `CLASSIFICATION_UPGRADED`. Covers: `unclassified → X` (X in lattice; entering the lattice from outside = becoming MORE restrictive operationally), and ordinal upgrades inside the lattice. Audit event omits `reason` entirely (the field is optional in the schema; non-reason events MUST NOT carry `reason: null` because the schema allows absent only).
   - Audit event field bindings (per Step 4):
     - `id` from `this.#generateId()` (A1's injected ULID generator)
     - `tenant_id = row.tenant_id` (verbatim from the validated classification row)
     - `actor_user_id = row.actor_user_id` (verbatim from the validated classification row — A2 does NOT carry a separate actor argument; the row's actor IS the audit actor)
     - `matter_id = row.matter_id` (verbatim)
     - `entity_id = row.id`
     - `before_state_hash = null` (all CLASSIFICATION_* kinds have `action: "create"` per `CASE_BOX_AUDIT_EVENT_KINDS`)
     - `after_state_hash = entityStateHash(row)` via the existing A1 helper
     - `timestamp` from a single `this.#nowIso()` capture (audit-event timestamp ONLY; the row's own `set_at` is the caller-supplied value validated by the schema and is NOT overwritten)
     - `prev_event_hash` from `priorHeadOf(storedAuditEvents)` per A1's chain rules
     - `reason` present iff kind is DOWNGRADED or RESET_TO_UNCLASSIFIED; value is the row's `change_reason_code` string verbatim
   - **`set_at` ownership**: persistence preserves the caller's `set_at` value on the stored row. The audit event's `timestamp` is independent and sourced from persistence's `#nowIso()`. They are SEPARATE values and may differ.
   - Commits one row + one audit event atomically (same WeakMap-mutation step pattern as A1).
   - Rejects duplicate `id` with `code: "duplicate_id"` via a per-instance `classificationIds: Set<string>` index (fast O(1) check; no full scan).

2. **`getEffectiveClassification(query: { tenant_id: string; matter_id: string; target_type: "document"; target_id: string }): Promise<{ effectiveLevel: ConfidentialityLevel; history: ReadonlyArray<CaseBoxConfidentialityClassification> }>`**
   - Resolves the document via tenant/matter consistency check (same as `appendConfidentialityClassification`).
   - History ordered by `set_at DESC, id ASC` (latest-wins per Step 5 obligation 4). Sibling helper `effectiveConfidentialityLevel` from the contract is used as the source of truth for resolution.
   - Returns `{ effectiveLevel: "unclassified", history: [] }` when no rows exist for the target (Step 5 obligation 9: `unclassified` is the absence-of-row default).

3. **`listConfidentialityClassifications(query: { tenant_id: string; matter_id: string; target_type?: "document"; target_id?: string; cursor?: string; limit?: number }): Promise<{ rows: ReadonlyArray<CaseBoxConfidentialityClassification>; next_cursor: string | null }>`**
   - Paginated by **classification chronological order** (`set_at ASC, id ASC`). This is distinct from audit-chain append order — chain order is exposed via `listAuditEvents`, not here.
   - Page-after seek predicate: `set_at > lastSetAt || (set_at === lastSetAt && id > lastId)` per the cursor's `last_sort_tuple` `[set_at:string, id:string]`.
   - New cursor kind `"classifications_by_matter"`, filter hash over `{ tenant_id, matter_id, target_type, target_id }` (undefined values dropped per existing cursor helper).
   - Filter rules: `target_id` without `target_type` is REJECTED with `code: "invalid_argument"` (an `id` without a typed namespace is ambiguous). `target_type` alone is fine (lists all classifications for that type within the matter).
   - Rejects unknown matter / tenant mismatch with the existing A1 codes (`unknown_matter`, `tenant_mismatch`).

### 1.2 Non-functional scope

- No new dependency (still only `case-box-contract`).
- LOC discipline: `services/case-box-persistence/src/inMemoryRepo.ts` is already 506 raw LOC after A1. A2 introduces a NEW sibling module `src/inMemoryClassification.ts` for the classification-specific logic BEFORE coding (not as an after-the-fact extraction). The main `inMemoryRepo.ts` gains only short delegate methods (≤10 LOC each); the heavy lifting lives in `inMemoryClassification.ts`. This keeps both files under the 500 warn threshold throughout A2.
- A1 audit-chain shape preserved verbatim — A2 only adds new audit-event KINDS (CLASSIFICATION_*) per the existing builder + chain rules.
- A2 read APIs are NOT authorization signals for external OCR / sync / LLM. A2 surfaces classification HISTORY only; the `assertExternalHandlingAllowed` gate from Step 5 obligation 5 lives in a future phase (A3+) and is the ONLY API that callers may treat as authorization.

---

## 2. Files expected to be added or modified

| Path | Action | Substance |
|---|---|---|
| `services/case-box-persistence/src/types.ts` | modified | Add `AppendConfidentialityClassificationInput`, `GetEffectiveClassificationQuery`, `EffectiveClassificationResult`, `ListConfidentialityClassificationsQuery`, `ListConfidentialityClassificationsPage`; extend `CaseBoxPersistence` interface with the 3 new methods; re-export `ConfidentialityLevel`, `ConfidentialityChangeReasonCode` types from contract. |
| `services/case-box-persistence/src/inMemoryRepo.ts` | modified | Add internal state slots: `classificationsByMatter: Map<matterId, CaseBoxConfidentialityClassification[]>` AND `classificationIds: Set<string>` (fast duplicate-id check; no full scan). Three thin delegate methods (≤10 LOC each) that route to `src/inMemoryClassification.ts`. |
| `services/case-box-persistence/src/inMemoryClassification.ts` | **NEW** | Module-private helper for classification storage and lookup. Exports `appendClassification(state, input, deps)`, `getEffectiveClassification(state, query)`, `listClassifications(state, query)` plus helpers `findLatestForTarget(state, target_type, target_id)`, `selectAuditKind(prior, next)`. Imports the contract's `assertValidNewConfidentialityClassification`, `isDowngrade`, `isResetToUnclassified` verbatim. |
| `services/case-box-persistence/src/cursor.ts` | modified | Add `"classifications_by_matter"` to `CaseBoxCursorKind` union + decode validator. Tuple shape `[set_at:string, id:string]`. |
| `services/case-box-persistence/src/auditChain.ts` | unchanged | The hash + chain helpers are kind-agnostic; no changes needed. |
| `services/case-box-persistence/src/errors.ts` | unchanged | All A2 errors reuse existing codes; no new codes added. |
| `services/case-box-persistence/src/index.ts` | modified | Re-export the 3 new public types and confidentiality-level constants. |
| `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` | modified | Add ~15 conformance cases per §6 below (alongside the existing 38 A1 cases). |
| `services/case-box-persistence/tests/conformance/fixtures.mjs` | modified | Add `makeClassificationInput()` builder; deterministic. |
| `services/case-box-persistence/tests/invariants.test.mjs` | modified | Update §6.2.7 prototype allowlist to include the 3 new methods (14 total with constructor). Add a §6.2.X case asserting `target_type === "matter"` is rejected. |
| `services/case-box-persistence/tests/auditChain.test.mjs` | modified | Add a chain test that walks a CLASSIFICATION_SET → CLASSIFICATION_UPGRADED → CLASSIFICATION_DOWNGRADED sequence and asserts hash integrity + reason equality for downgrade. |
| `services/case-box-persistence/package-lock.json` | possibly modified | Only if `npm install` is re-run; expected no-op since no dependency change. |

**Total expected**: 1 new source file + 4 modified source files + 4 modified test files = ~9 file diffs (now `src/inMemoryClassification.ts` is new per the round-1 review's Dim 3 #1 — extract before coding).

---

## 3. Files expected to remain untouched

- `docs/contracts/case-box-contract/**` — A2 imports from the contract; does NOT modify it.
- `docs/contracts/**` — OCR contract sibling untouched.
- All other `services/**` packages untouched.
- All ADRs / release docs untouched.
- `.claude/**` untouched (no rule/skill changes; A2 runs under the existing broker policy).
- The 3 user-deferred dev-memo drafts untouched.

---

## 4. Invariants from Steps 0-7 enforced (or carried forward)

### Carried forward from A1 (unchanged)

- `tenant_id` cross-entity consistency.
- Atomic write discipline (validate all, build event + hash, then mutate in one synchronous step).
- Audit emission goes through `buildCaseBoxAuditEvent`; no raw construction.
- Audit-chain hash via `canonicalAuditEventHashInput` + SHA-256.
- Per-matter monotonic `sequence` for ordering chain reads.
- `local-user` sentinel valid (no opt-in flag write API in A2; the gate stays dormant).
- The contract's state-machine guards are the single source of truth (here: classification transitions via `assertValidConfidentialityTransition` / `assertValidNewConfidentialityClassification`).

### New for A2 (from Step 5 ADR §"Persistence obligations recorded")

1. **Append-only**: never UPDATE classification rows. Each new row is a new entry in the per-target history. (A2 implements via array push; no method updates an existing row.)
2. **Builder-only audit emission**: every classification write emits via `buildCaseBoxAuditEvent`. No raw audit-event construction. (Carried from A1.)
3. **Creation rule**: `assertValidNewConfidentialityClassification(row, priorRow)` is called before every insert; persistence MUST load the prior row first via `effectiveConfidentialityLevel`-equivalent query.
4. **Latest-wins ordering**: `effectiveConfidentialityLevel` orders by `set_at DESC`, ties broken by `id ASC`. A2's `getEffectiveClassification` queries match.
5. **External-handling gate** (deferred to A3+): `assertExternalHandlingAllowed` requires `PrivilegeReviewState` which depends on Step 3 (privilege markers). A2 does NOT ship `evaluateExternalHandling`; explicitly deferred.
6. **`PrivilegeReviewState` computation** (deferred to A3+): same reason.
7. **Reason audit equality** (D5.4 / Step 5 obligation 7): for `CLASSIFICATION_DOWNGRADED` and `CLASSIFICATION_RESET_TO_UNCLASSIFIED`, the audit event's `reason` field MUST EXACTLY EQUAL the row's `change_reason_code` string. A2 declines the ADR's "or structured combination" escape — exact string equality only. The `change_reason_text` field on the row is the free-form supplement (required only when `change_reason_code === "other"` per the schema's `if/then`) and is NOT included in the audit event's `reason`. Conformance asserts the exact-string equality.
8. **Suspicious-sequence detection** (advisory): NOT IMPLEMENTED in A2 — Step 5 marks it advisory; deferred.
9. **`unclassified` is the absence-of-row default**: persistence MUST NOT auto-create a `normal` row for new documents/facts. (`createMatter` and `registerDocument` from A1 are unchanged; they do NOT emit a classification.)
10. **No `target_type === "matter"` rows**: persistence rejects inserts with `target_type === "matter"`. Schema already rejects; A2 also rejects at the validator boundary with `code: "invalid_argument"` (defense in depth).
11. **Tenant/matter consistency**: persistence verifies `target_id` resolves within the same `(tenant_id, matter_id)` as the classification row. A2 checks: for `target_type === "document"`, fetch the document and assert `document.matter_id === classification.matter_id && document.tenant_id === classification.tenant_id`. Codes: `unknown_document`, `matter_id_mismatch`, `tenant_mismatch`.

### Phase deferral notes (deliberate)

- **`evaluateExternalHandling` wrapper**: NOT in A2. Requires `PrivilegeReviewState` (Step 3 / Phase A3). Adding it in A2 would force a half-implemented gate. A3 or later ships it.
- **Fact-target classification**: NOT in A2. Facts don't exist as a persistence entity until Phase A4. Until then, persistence accepts `target_type === "document"` only.

---

## 5. Out of scope

Phase A2 will NOT:

- Implement any SQLite code, `better-sqlite3` dep, or native module.
- Implement `evaluateExternalHandling`, `PrivilegeReviewState` computation, or any external-handling decision API. (Deferred to A3+.)
- Implement fact entities or fact-target classifications. (Deferred to A4.)
- Implement privilege markers (A3), docket entries (A5), evidence items (A6), OCR links (A7), or replay-safe `*Once` variants (A9).
- Add an API, UI, sync bridge, auth provider, cloud client, or LLM extractor.
- Modify any ADR or release doc.
- Modify the cc-suite rule, autonomy rule, or any skill.
- Modify the parent plan or the A1 plan.
- Push to any remote.

---

## 6. Tests planned

All under `services/case-box-persistence/tests/`; the conformance harness gets 24 new cases (was "~15" in an earlier draft — count normalized to 24 to match the listed table), invariants test gets ~3 new cases, auditChain test gets ~2 new cases.

### 6.1 Conformance matrix additions

| § | Case | Asserts |
|---|---|---|
| 6.A2.1 | `appendConfidentialityClassification` happy path SET (first classification) | returns the row; `getEffectiveClassification` returns `effectiveLevel = row.level`, `history.length === 1`; emits one `CLASSIFICATION_SET` event |
| 6.A2.2 | `appendConfidentialityClassification` rejects `target_type === "matter"` | `code: "invalid_argument"`; no audit event |
| 6.A2.3 | `appendConfidentialityClassification` rejects `target_type === "fact"` (A2 scope) | `code: "invalid_argument"` |
| 6.A2.4 | `appendConfidentialityClassification` rejects unknown document target | `code: "unknown_document"` |
| 6.A2.5 | `appendConfidentialityClassification` rejects tenant mismatch with document | `code: "tenant_mismatch"` |
| 6.A2.6 | `appendConfidentialityClassification` rejects matter_id mismatch with document | `code: "matter_id_mismatch"` |
| 6.A2.7 | `appendConfidentialityClassification` rejects duplicate `id` | `code: "duplicate_id"` |
| 6.A2.8 | `appendConfidentialityClassification` rejects schema-invalid row | `code: "invalid_payload"` |
| 6.A2.9 | `appendConfidentialityClassification` UPGRADED — normal → confidential (no reason required) | emits `CLASSIFICATION_UPGRADED`; audit event's `reason` field is ABSENT entirely (NOT `null`; schema allows absent only) |
| 6.A2.9a | `appendConfidentialityClassification` rejects same-level (normal → normal) | `code: "invalid_argument"`; no audit event |
| 6.A2.9b | `appendConfidentialityClassification` `unclassified → normal` (lattice entry) | emits `CLASSIFICATION_UPGRADED`; audit `reason` absent |
| 6.A2.10 | `appendConfidentialityClassification` DOWNGRADED — confidential → normal — requires change_reason_code | success path emits `CLASSIFICATION_DOWNGRADED` with audit `reason === change_reason_code`; missing reason rejects with `code: "invalid_payload"` (from `ConfidentialityCreationError`) |
| 6.A2.11 | `appendConfidentialityClassification` RESET_TO_UNCLASSIFIED requires reason | success emits `CLASSIFICATION_RESET_TO_UNCLASSIFIED` with audit `reason === change_reason_code`; missing reason rejects |
| 6.A2.12 | `appendConfidentialityClassification` rejects `prior_level` mismatch with stored prior row | `code: "invalid_payload"` |
| 6.A2.13 | `getEffectiveClassification` empty history → `unclassified` | returns `{effectiveLevel: "unclassified", history: []}` |
| 6.A2.14 | `getEffectiveClassification` latest-wins ordering | after SET(normal), UPGRADED(confidential), DOWNGRADED(normal): `effectiveLevel === "normal"`, `history.length === 3`, ordered set_at DESC |
| 6.A2.15 | `getEffectiveClassification` rejects unknown document | `code: "unknown_document"` |
| 6.A2.16 | `listConfidentialityClassifications` empty matter | empty rows, null cursor |
| 6.A2.17 | `listConfidentialityClassifications` ordered by `set_at ASC, id ASC` (independent of insertion order) | fixture inserts rows in DIFFERENT order than their `set_at` values; assertion is that returned rows are sorted by `set_at` ASC (then `id` ASC), NOT by insertion order |
| 6.A2.18 | `listConfidentialityClassifications` cursor-paginates correctly | multi-page; no duplicates; null cursor at end |
| 6.A2.19 | `listConfidentialityClassifications` unknown matter | `code: "unknown_matter"` |
| 6.A2.20 | `listConfidentialityClassifications` tenant mismatch | `code: "tenant_mismatch"` |
| 6.A2.21 | `listConfidentialityClassifications` wrong-filter cursor | `code: "invalid_argument"` |
| 6.A2.22 | `listConfidentialityClassifications` filtered by `target_type + target_id` | returns only classifications for that target; correct ordering preserved |
| 6.A2.23 | `listConfidentialityClassifications` filtered by `target_type` alone | returns all classifications for that target_type within the matter |
| 6.A2.24 | `listConfidentialityClassifications` `target_id` without `target_type` | `code: "invalid_argument"` (ambiguous; `id` requires typed namespace) |

### 6.2 Invariants test additions

- **§6.2.7 prototype allowlist** (modified): now expects 14 entries (11 + 3 new): `appendConfidentialityClassification`, `getEffectiveClassification`, `listConfidentialityClassifications` added. (Final list, sorted: `appendConfidentialityClassification, archiveMatter, constructor, createMatter, getAuditChainHead, getDocument, getEffectiveClassification, getMatter, listAuditEvents, listConfidentialityClassifications, listDocuments, registerDocument, unarchiveMatter, verifyAuditChainForMatter`.)
- **§6.2.A2.1**: `target_type === "matter"` rejection is exercised through the public method (defense-in-depth alongside the schema's reject).
- **§6.2.A2.2**: classification reads return DEEP-CLONED rows (caller mutation test).

### 6.3 Audit chain test additions

- **§6.3.A2.1**: SET → UPGRADED → DOWNGRADED chain remains hash-valid; `verifyAuditChainForMatter` returns `ok: true, verifiedCount: 4` (1 MATTER_REGISTERED + 1 DOCUMENT_REGISTERED + 1 SET + 1 ... actually 5 counting the upgrade; recompute: MATTER_REGISTERED + DOCUMENT_REGISTERED + CLASSIFICATION_SET + CLASSIFICATION_UPGRADED + CLASSIFICATION_DOWNGRADED = 5).
- **§6.3.A2.2**: audit event's `reason` field equals the classification row's `change_reason_code` for both DOWNGRADED and RESET_TO_UNCLASSIFIED.

---

## 7. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Audit kind selection logic (which of 4 kinds to emit) diverges from the contract's `isDowngrade` / `isResetToUnclassified` predicates | Medium | High — wrong audit kind permanently corrupts the chain semantics | A2 imports `isDowngrade`, `isResetToUnclassified` from the contract verbatim; never re-implements them. Conformance §6.A2.9–§6.A2.11 exercise each kind explicitly. |
| R2 | Tenant/matter consistency check for documents leaks into a deadlock or wrong-rejection | Low | Medium | A2's check is read-only (look up the document via `state.documents.get`; assert fields). Single synchronous step. |
| R3 | `prior_level` mismatch produces the wrong error code | Low | Low | Contract throws `ConfidentialityCreationError`; persistence maps to `invalid_payload`. Conformance §6.A2.12 pins. |
| R4 | LOC discipline — `inMemoryRepo.ts` grows past 500 warn or 800 fail | Medium | Medium | A2 adds 3 methods (~80 raw LOC each) atop A1's ~500. Monitor; if total approaches 700, extract classification ops to `src/inMemoryClassification.ts`. |
| R5 | New cursor kind drifts from cursor module's expected tuple shape | Low | Medium | A2 adds the `"classifications_by_matter"` kind to `cursor.ts` per-kind validator with explicit shape `[set_at:string, id:string]`. Conformance §6.A2.21 exercises malformed cursor rejection. |
| R6 | `getEffectiveClassification` for a never-classified document returns wrong shape | Low | Low | Returns `{effectiveLevel: "unclassified", history: []}` deterministically. Conformance §6.A2.13 pins. |
| R7 | Audit `reason` equality drift — persistence stores `change_reason_text` on the row, but audit `reason` MUST equal `change_reason_code` only | Medium | Medium | A2 commits to `audit.reason = row.change_reason_code`. Conformance §6.A2.10 and §6.3.A2.2 assert string equality. Step 5 obligation 7 allows a richer structured combination; A2 picks the simple version because the contract's `assertReasonForAuditEventKind` for DOWNGRADED/RESET requires a non-empty string, and the schema's enum-bound `change_reason_code` is the smallest valid value. |
| R8 | A2 implements `evaluateExternalHandling` prematurely | Low | High (drift between A2 + A3) | Explicit non-goal §5. Conformance does NOT include external-handling cases. A3 ships it. |
| R9 | A2 accepts `target_type === "fact"` and then can't enforce tenant/matter consistency | Low | High — silent confidentiality leak | A2 rejects `target_type === "fact"` with `code: "invalid_argument"` until A4 ships facts. Conformance §6.A2.3 pins. |
| R10 | Reason-required audit kinds fail when persistence forgets to pass `reason` | Low | Medium | The contract's `buildCaseBoxAuditEvent` returns `ok: false` when `reasonRequired` kinds have empty reason. Persistence maps the failure to `invalid_payload`. Conformance §6.A2.10/§6.A2.11 missing-reason cases exercise this. |

---

## 8. Acceptance criteria

Phase A2 commit acceptable iff ALL of the following hold:

| # | Acceptance | How verified |
|---|---|---|
| 8.1 | `npm --prefix services/case-box-persistence test` exits 0 with ALL conformance + invariants + audit-chain tests passing (52 from A1 + 24 new conformance + ~5 new invariants/audit-chain from A2 ≈ 81 total; exact count to be confirmed at commit time) | test output captured in commit |
| 8.2 | `tsc --noEmit` is clean | implicit via test step |
| 8.3 | `npm --prefix docs/contracts/case-box-contract test` still 322/322 | spot check |
| 8.4 | `npm --prefix docs/contracts test` (OCR) still 102/102 | spot check |
| 8.5 | loc-guardian: 0 over limit; warnings remain pre-existing | re-scan from repo root |
| 8.6 | No file outside §2 modified | `git diff --cached --name-only` review |
| 8.7 | Public surface count = 14 (11 from A1 + 3 new from A2); §6.2.7 prototype allowlist matches | invariants test |
| 8.8 | No new `CaseBoxPersistenceError` code added; all A2 paths reuse the 10 A1 codes | conformance |
| 8.9 | Audit chain remains valid across A1 + A2 events; `verifyAuditChainForMatter` returns `ok: true` for chains spanning both | auditChain test §6.3.A2.1 |
| 8.10 | Audit `reason` equality (Step 5 obligation 7) verified for DOWNGRADED + RESET_TO_UNCLASSIFIED kinds | auditChain test §6.3.A2.2 |
| 8.11 | cc-suite audit + verify via Path 1 runner where the runner is available; Path 2 (direct MCP) fallback acceptable per `.claude/rules/cc-suite.md` §"Failure handling" when Path 1 fails (e.g. `spawnSync codex ETIMEDOUT`). Recording per §"Required recording" (8 fields) for each invocation — including Path 2's `threadId` capture and `/cc-suite:status retrievable? NO` when Path 2 was used. | the eventual commit message lists the 8 fields per invocation |
| 8.12 | Ready-for-commit per the staging-hygiene rule (explicit-stage path list); commit itself requires user authorization per autonomy policy | dry-run via `git add --dry-run` |

---

## 9. Out-of-scope clarifications for the reviewer

Do NOT flag:

- Absence of `evaluateExternalHandling` / `PrivilegeReviewState` — Step 5 explicitly defers these to a later phase (A3+).
- Absence of fact-target classifications — A4 dependency.
- No new SQLite implementation — Phase B gated on ABI remediation.
- No external-handling gate test cases — Step 5 obligation 5 cannot fire in A2 because no method calls it.
- A2 keeps `services/case-box-persistence/src/cursor.ts` as a local copy of the OCR cursor module rather than extracting a shared helper — that extraction is a separate WI.

Reviewer SHOULD flag:

- Audit kind selection logic that deviates from the contract's `isDowngrade` / `isResetToUnclassified` predicates.
- Any path that mutates classification rows (must be append-only).
- Any path that auto-creates a `normal` classification for new documents/facts.
- Reason-equality drift between audit event and row for DOWNGRADED / RESET kinds.
- LOC discipline drift if `inMemoryRepo.ts` approaches 500 warn.

---

## 10. cc-suite invocation plan (per `.claude/rules/cc-suite.md`)

| Stage | Kind | Path |
|---|---|---|
| Plan review (this file) | `review-plan` | Path 1 runner; default high-effort, gpt-5.5 |
| Implementation audit | `audit` (mini per `.codex-toolkit.md`) | Path 1 runner |
| Post-fix verify | `verify` | Path 1 runner; explicit audit artifact reference |

Recording fields per §"Required recording" captured in the eventual implementation commit (NOT in this plan commit).

---

## 11. References

- `dev-memo/plan-case-box-persistence-00.md` (commit `4f39e02`) — parent plan; A2 is §10.2 row 2.
- `dev-memo/plan-case-box-persistence-A1.md` (commit `3a9e06c`) — A1 plan.
- `docs/adr/case-box-step-5-confidentiality-classification.md` — Step 5 ADR; §"Decision", §"Persistence obligations recorded".
- `docs/contracts/case-box-contract/src/confidentiality-invariants.ts` — `assertValidNewConfidentialityClassification`, `effectiveConfidentialityLevel`, `assertValidConfidentialityTransition`, `isDowngrade`, `isResetToUnclassified`, `ConfidentialityCreationError`.
- `docs/contracts/case-box-contract/src/audit-log.ts` — `CASE_BOX_AUDIT_EVENT_KINDS` (CLASSIFICATION_SET/UPGRADED/DOWNGRADED/RESET_TO_UNCLASSIFIED entries at lines 110-113).
- `docs/contracts/case-box-contract/schemas/case-box-confidentiality-classification.schema.json` — schema; `if/then` enforces `change_reason_code === "other"` requires `change_reason_text`.
- `services/case-box-persistence/src/inMemoryRepo.ts` — A1 implementation; A2 extends.
- `services/case-box-persistence/src/cursor.ts` — A1 cursor module; A2 adds new kind.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — A1 harness; A2 extends.
- `.claude/rules/cc-suite.md` — broker policy; A2 is high-risk per §"High-risk WIs — broker is REQUIRED".
- `.claude/rules/autonomy.md`, `.claude/rules/staging-hygiene.md`, `.claude/rules/loc-guardian.md` — orthogonal guardrails.
- `dev-memo/cc-suite-runner-tracking-investigation.md` (CCSUITE-01) — confirms Path 1 broker tracking works; recording per §"Required recording" item 8 will read YES for A2 runs.
