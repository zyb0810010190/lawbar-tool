# CASE-BOX-PERSISTENCE Phase A4 — Facts (bounded plan)

**Status**: round-2 plan after r1 review. Round-1 verdict NEEDS REVISION (1 Critical + 4 Mediums + Lows); revisions applied.

## Review history

- 2026-05-21 round 1 — `/cc-suite:review-plan` via Path 1 runner attempt 1 (full packet): **SUCCEEDED** (CCSUITE-02 retry policy did not fire). Job `review-plan-mpfhkq8e-phdb4u`. Verdict **NEEDS REVISION**. Revisions applied (this version):
  - **C1.1 (FACT_REPLACEMENT_ACCEPTED audit-chain corruption)** — Critical. The audit chain verifier at `audit-log.ts:365` rejects any `action === "create"` event with non-null `before_state_hash`. FACT_REPLACEMENT_ACCEPTED is `action: "create"` per the contract table. My initial plan bound `before_state_hash = entityStateHash(prior)` for all transitionFact events, which would have corrupted the chain on every replacement. **FIX**: special-case the audit field binding — FACT_REPLACEMENT_ACCEPTED gets `before_state_hash: null`; all other transition kinds get `entityStateHash(prior)`. Added §6.3.A4.2-extended audit-chain conformance pinning the full-chain verification (not just `action` field) for a chain that includes a replacement event.
  - **M1.2 (replacement create-action semantic reconciliation)** — added explicit doc: "FACT_REPLACEMENT_ACCEPTED `action: "create"` means a new SoT-replacement entry, not a new database row. The underlying row IS updated from reviewed to accepted; the audit semantics treat that update as the birth of a new SoT entry."
  - **M2.1 (source-document tenant/matter mismatch under-tested)** — added conformance §6.A4.10b for cross-matter source_document_id and §6.A4.10c for cross-tenant.
  - **M2.2 (resolveDocumentTarget signature ambiguity)** — pinned the helper signature: `resolveDocumentTarget({ getDocument }, { tenant_id, matter_id, target_id })`. Sibling modules pass an injected `getDocument` callback (preserves current A2/A3 dependency-injection pattern; does NOT import private InternalState into sibling modules).
  - **L2.3 (cross-matter listFacts filter ambiguity)** — pinned: a `source_document_id` filter where the document exists in a DIFFERENT matter rejects with `matter_id_mismatch`; cross-tenant document rejects with `tenant_mismatch`. Empty-page result is reserved for the legitimate "exists, in scope, no matches" case. Added §6.A4.27b.
  - **M3.1 (cycle walk complexity)** — added `factById: Map<factId, CaseBoxFact>` to `FactState`. Cycle walk is now genuinely O(chain length) — visited-set bounded by total fact count for defense against pre-existing corruption.
  - **L3.2 (LOC estimate omits wiring)** — re-noted in §1.3; will re-run `/loc-guardian:scan` before claiming acceptance.
  - **L4.1 (rejected-field-setting shorthand)** — spelled out: candidate → rejected sets `reviewer_actor_user_id = opts.reviewer_actor_user_id`, `reviewed_at = opts.at`, `rejected_at = opts.at`, `rejection_reason = opts.rejection_reason` (single-stamp).
  - **L4.2 (assertValidFactTransition arity)** — `assertValidFactTransition` takes 3 args (no reason). Fixed plan to drop the fourth arg. Persistence enforces rejection reason via pre-validation (same pattern as A3); the contract's transition helper does not check reasons for facts.
  - **M5.1 (A3 F2.1 closure evidence)** — added §1.2-closure subsection enumerating the exact interfaces removed from `inMemoryClassification.ts` and `inMemoryPrivilege.ts`: `ListClassificationsQuery`, `ListClassificationsPage`, `ListPrivilegeMarkersQuery`, `ListPrivilegeMarkersPage` (the locally-redeclared public-facing shapes). Internal `*Deps` and `Prepare*Result` types stay local. Closure happens only after the diff shows these removals.
  - **L5.2 (A2 F4.3 target mismatch)** — F4.3's recorded target was "A4 (add the pinning test alongside fact-target additions)" but A4 is NOT broadening classification to accept fact targets. **Retarget**: A2 F4.3 → future "A5-fact-targets" WI (not this WI). A4's backlog-update step explicitly modifies F4.3's Target field, not its status.

**Status**: ready for round-2 `/cc-suite:review-plan`.
**Date**: 2026-05-21.
**Parent plan**: `dev-memo/plan-case-box-persistence-00.md` — A4 is the fourth row of §10.2 ("Facts — Step 2").
**Built on**: A3 implementation (commit `b2ef9f1`).

Compact review packet at top per CCSUITE-02; full body below.

---

## Review packet (compact)

### Active plan summary

Phase A4 adds fact storage + lifecycle + supersession-chain integrity to the in-memory case-box persistence built in A1+A2+A3. A4 ships 4 new public methods: `appendFact`, `transitionFact`, `getFact`, `listFacts`. Public surface grows 18 → 22. Persistence narrows the surface analogous to A3 — `appendFact` accepts ONLY `status === "candidate"` (any other status rejected at the persistence boundary). The contract's `assertValidNewFact` enforces this at the validator layer; persistence pre-validates so the error surfaces as `invalid_argument` rather than the contract's generic exception. Supersession-graph cycle detection (broader than `assertFactPromotionInvariants`'s self-cycle catch) is implemented as a persistence walk on every `reviewed → accepted` transition where `supersedes_fact_id` is set. A4 also closes three deferred-audit-backlog rows by extracting a shared `resolveDocumentTarget` helper used by A2's classification + A3's privilege paths.

### Exact target files

- `services/case-box-persistence/src/inMemoryFact.ts` — NEW sibling module (parallel to A2's `inMemoryClassification.ts` and A3's `inMemoryPrivilege.ts`).
- `services/case-box-persistence/src/inMemoryRepo.ts` — add 4 thin delegate methods + new state slot.
- `services/case-box-persistence/src/cursor.ts` — add cursor kind `facts_by_matter`; tuple `[created_at:string, id:string]`.
- `services/case-box-persistence/src/types.ts` — add 4 interface methods + types; re-export `CaseBoxFact`.
- `services/case-box-persistence/src/index.ts` — re-exports.
- `services/case-box-persistence/src/resolveTarget.ts` — NEW shared helper (closes A2 F2.2 + A3 F2.2 from `dev-memo/deferred-audit-findings.md`).
- `services/case-box-persistence/src/inMemoryClassification.ts` — refactor to use `resolveDocumentTarget`.
- `services/case-box-persistence/src/inMemoryPrivilege.ts` — refactor to use `resolveDocumentTarget`.
- `services/case-box-persistence/tests/conformance/fixtures.mjs` — add `makeFactInput`.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — add ~28 conformance cases.
- `services/case-box-persistence/tests/invariants.test.mjs` — §6.2.7 prototype allowlist bumps to 22.
- `dev-memo/deferred-audit-findings.md` — close A2 F2.2, A3 F2.1, A3 F2.2 with citations.

### Exact acceptance criteria

1. `npm --prefix services/case-box-persistence test` exits 0 with all conformance + invariants + audit-chain tests passing (108 from A1+A2+A3 + ~28 new conformance + invariants/audit-chain additions ≈ 140 total).
2. `npm --prefix docs/contracts/case-box-contract test` still 322/322.
3. `npm --prefix docs/contracts test` (OCR) still 102/102.
4. loc-guardian: 0 files over fail (800).
5. Public surface = 22 (A1's 11 + A2's 3 + A3's 4 + A4's 4); §6.2.7 prototype allowlist matches.
6. No new `CaseBoxPersistenceError` code; A4 reuses the documented 10 codes.
7. Audit chain remains valid spanning A1+A2+A3+A4 events.
8. cc-suite audit + verify via Path 1; retrievable via `/cc-suite:status`.
9. Supersession-graph cycle detection prevents A→B→C→A (and longer) cycles; conformance pins.
10. `assertValidNewFact` called before every mutation; no candidate-bypass paths.
11. A2 F2.2, A3 F2.1, A3 F2.2 closed in `dev-memo/deferred-audit-findings.md` with resolution-commit references.

### Exact out-of-scope list

- No SQLite / `better-sqlite3` / native module.
- No broadening of A2's `appendConfidentialityClassification` or A3's `appendPrivilegeMarker` to accept `target_type === "fact"`. Both continue to reject fact-target with `invalid_argument`. A future bounded WI ("A5-fact-targets" or similar) handles that broadening.
- No `PrivilegeReviewState` wrapper or `evaluateExternalHandling` (still Step 5 obligation 6 dependency).
- No fact-derived deadline materialization (Step 6 / future phase).
- No API, UI, sync, cloud, auth, LLM-execution, OCR-package change, external network call, schema change, contract package edit, dependency change, ADR/release doc edit, .claude/** rule/skill edit, push, or parent-plan edit.

### Essential ADR references

- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` — §3 supersession (new row carries `supersedes_fact_id`; both rows accepted; broader cycle detection is persistence's job); §"Persistence obligations recorded" (assertValidNewFact, no auto-accept, candidate→reviewed→accepted path, broader-cycle detection as a hard requirement).
- `docs/adr/case-box-step-4-audit-log-shape.md` — audit chain shape (carried forward from A1).
- `docs/contracts/case-box-contract/src/fact-invariants.ts` — `assertValidNewFact`, `assertFactPromotionInvariants`, `FactCreationInvariantError`, `FactPromotionInvariantError`.
- `docs/contracts/case-box-contract/src/transitions.ts` lines 247-252 — fact edges; `assertValidFactTransition` at :441.
- `docs/contracts/case-box-contract/src/audit-log.ts` lines 89-93 — `FACT_PROPOSED/REVIEWED/ACCEPTED/REJECTED/REPLACEMENT_ACCEPTED`.

### Review questions (targeted)

1. Does the supersession-cycle walk correctly detect A→B→C→A and longer chains in O(chain length)? Does it run BEFORE mutation in `transitionFact` when `opts.supersedes_fact_id` is provided?
2. Is the audit kind selection coherent? Specifically: `FACT_REPLACEMENT_ACCEPTED` (action: create) is emitted when `reviewed → accepted` runs WITH `supersedes_fact_id`; `FACT_ACCEPTED` (action: update) is emitted when same transition runs WITHOUT supersession. Both routes go through the SAME transition method — the kind selector is the supersedes_fact_id presence.
3. Does `appendFact` correctly forbid `status !== "candidate"` at the persistence boundary (matching A3's status-narrowing pattern), with the contract's `assertValidNewFact` as defense-in-depth?
4. Does the shared `resolveDocumentTarget` helper preserve A2 + A3's existing error-code semantics (`unknown_document`, `tenant_mismatch`, `matter_id_mismatch`) exactly?
5. Are deferred-backlog closures (A2 F2.2 + A3 F2.1 + A3 F2.2) correctly cited in `dev-memo/deferred-audit-findings.md` with this commit's hash?

---

## 1. Scope

### 1.1 Functional scope — 4 new public methods (18 → 22)

1. **`appendFact(input: unknown): Promise<CaseBoxFact>`**
   - Pre-schema raw guard: `status !== "candidate"` → `invalid_argument` ("appendFact accepts only status === \"candidate\"; use transitionFact for promotion").
   - `validateFact(input)` — failure → `invalid_payload`.
   - `assertValidNewFact(row)` — `FactCreationInvariantError` → `invalid_payload`. Enforces candidate-only + null promotion fields.
   - Tenant/matter consistency via the matter (not via a document target — facts live under matter directly):
     - matter exists, matter.tenant_id === row.tenant_id, matter.id === row.matter_id.
   - When `source_document_id` non-null, use the shared `resolveDocumentTarget` helper to verify the document exists in the same matter. When null, skip the document check.
   - When `source_type === "ocr_excerpt"`, `source_document_id` MUST be non-null (schema enforces; persistence also pre-validates).
   - Duplicate-id check via `factIds: Set<string>` index.
   - `assertFactPromotionInvariants(row)` — at append, `supersedes_fact_id` is always null per `assertValidNewFact` so this is a no-op safety net.
   - Audit kind: always `FACT_PROPOSED` (action: create; reason absent).
   - Audit field bindings: same pattern as A3 — `entity_id = row.id`, `before_state_hash = null`, `after_state_hash = entityStateHash(row)`, `timestamp = #nowIso()`, `reason` absent.
   - Atomic commit.

2. **`transitionFact(factId: string, opts: FactTransitionOpts): Promise<CaseBoxFact>`**
   - `FactTransitionOpts = { to: "reviewed" | "accepted" | "rejected"; reviewer_actor_user_id: string; at: string; rejection_reason?: string; supersedes_fact_id?: string }`.
   - Pre-validates `opts` shape (non-empty strings, etc.) — bad shape → `invalid_argument`.
   - Resolves the fact by `factId` via `factIndex: Map<factId, matterId>`. Unknown → `invalid_argument`.
   - For `to === "rejected"`, pre-validates `opts.rejection_reason` non-empty → `invalid_argument` if missing.
   - For `to === "accepted"`, optionally accepts `opts.supersedes_fact_id`. If supplied:
     - The referenced fact MUST exist, MUST be in the same matter, MUST be in `status === "accepted"`. Bad references → `invalid_argument` (citing exact reason).
     - **Supersession-graph cycle walk**: starting from `opts.supersedes_fact_id`, walk via `.supersedes_fact_id` pointers; if the walk encounters `factId` (the row being transitioned), reject as `invalid_argument` ("would create supersession cycle: ..."). Bounded by total fact count to detect cycles in pre-existing graph.
     - `assertFactPromotionInvariants` validates self-cycle as a final safety net.
   - Calls `assertValidFactTransition(prior.status, opts.to, "lawyer")` (3 args; the contract helper does NOT take a reason arg for facts — reason enforcement is persistence's pre-check). `IllegalTransitionError` → `illegal_transition`.
   - Patches the row according to the target state:
     - `to === "reviewed"`: set `reviewer_actor_user_id`, `reviewed_at`.
     - `to === "rejected"` from candidate: set reviewer fields + `rejected_at` + `rejection_reason`. Schema's if/then requires `reviewed_at` even on the shortcut path; persistence sets it to `opts.at` (same timestamp).
     - `to === "rejected"` from reviewed: set `rejected_at` + `rejection_reason`; reviewer fields already populated.
     - `to === "accepted"`: set `accepted_at`; reviewer fields already populated; optionally set `supersedes_fact_id`.
   - Re-validates patched `next` via `validateFact(next)` BEFORE mutation (same pattern as A3 audit Dim 1 #1 fix) — malformed timestamps caught here as `invalid_argument`.
   - `assertFactPromotionInvariants(next)` defense-in-depth.
   - Audit kind selection:
     - `to === "reviewed"` → `FACT_REVIEWED` (action: update; reason absent).
     - `to === "rejected"` → `FACT_REJECTED` (action: update; reason = `opts.rejection_reason`).
     - `to === "accepted"` && `opts.supersedes_fact_id === undefined` → `FACT_ACCEPTED` (action: update; reason absent).
     - `to === "accepted"` && `opts.supersedes_fact_id !== undefined` → `FACT_REPLACEMENT_ACCEPTED` (**action: create**; reason absent — the supersession relationship lives in the row, not the audit reason).
   - **Audit field bindings** — depends on the kind's action:
     - For update-action kinds (FACT_REVIEWED, FACT_ACCEPTED, FACT_REJECTED): `before_state_hash = entityStateHash(prior)`, `after_state_hash = entityStateHash(next)`.
     - For create-action FACT_REPLACEMENT_ACCEPTED: `before_state_hash = null` (per audit-chain verifier's `before_state_hash_not_null_on_create` rule at `audit-log.ts:365`), `after_state_hash = entityStateHash(next)`. **Semantic reconciliation**: `action: "create"` here means "a new SoT-replacement entry is born" — the underlying row IS updated from reviewed to accepted, but the audit log treats that update as the birth of a new SoT entry. The chain hash carries the relationship to the prior row via `next.supersedes_fact_id` (a field on the new row), NOT via `before_state_hash`. This mirrors how Step 4's `entity_id` is the lifecycle handle while supersession is a row-level pointer.
     - Common across all kinds: `entity_id = next.id`; `timestamp = #nowIso()`; `actor_user_id = opts.reviewer_actor_user_id`; `tenant_id = next.tenant_id`; `matter_id = next.matter_id`.
   - **Field patching** (explicit per round-1 review L4.1):
     - `to === "reviewed"`: `reviewer_actor_user_id = opts.reviewer_actor_user_id`, `reviewed_at = opts.at`.
     - `to === "rejected"` from candidate: `reviewer_actor_user_id = opts.reviewer_actor_user_id`, `reviewed_at = opts.at`, `rejected_at = opts.at`, `rejection_reason = opts.rejection_reason`.
     - `to === "rejected"` from reviewed: `rejected_at = opts.at`, `rejection_reason = opts.rejection_reason` (reviewer fields already set).
     - `to === "accepted"`: `accepted_at = opts.at`; optionally `supersedes_fact_id = opts.supersedes_fact_id`.

3. **`getFact(factId: string): Promise<CaseBoxFact | null>`**
   - Resolves via `factIndex`. Returns null when unknown (mirrors `getDocument` / `getMatter` from A1).
   - Deep-clones the returned row.

4. **`listFacts(query: ListFactsQuery): Promise<ListFactsPage>`**
   - `query = { tenant_id, matter_id, status?, source_type?, source_document_id?, cursor?, limit? }`.
   - Pagination: chronological order by `created_at ASC, id ASC`. New cursor kind `facts_by_matter`; tuple `[created_at:string, id:string]`.
   - Filter validation: when `source_document_id` is provided, call the shared `resolveDocumentTarget` helper with the query's `tenant_id` + `matter_id` + the `source_document_id` as `target_id`. Errors propagate as `unknown_document` / `matter_id_mismatch` / `tenant_mismatch` (NOT silently empty page). Other filters pass through directly.
   - Rejects `unknown_matter` / `tenant_mismatch` per A1.

### 1.2 Non-functional scope — closes deferred backlog rows

The following deferred items from `dev-memo/deferred-audit-findings.md` are addressed by A4 (mark `closed` with this commit's hash):

- **A2 F2.2** (Low) — extract `resolveDocumentTarget` helper consumed by both classification and privilege.
- **A3 F2.1** (Low) — type-duplication. **Closure evidence requirement** (per round-1 review M5.1): the diff MUST show the following locally-redeclared interfaces removed from sibling modules: `ListClassificationsQuery`, `ListClassificationsPage` from `inMemoryClassification.ts`; `ListPrivilegeMarkersQuery`, `ListPrivilegeMarkersPage` from `inMemoryPrivilege.ts`. Each `inMemory*` module imports the corresponding public type from `types.ts` instead. Internal helper types (`*Deps`, `Prepare*Result`) stay local because they are implementation details, not duplicates of public types. F2.1 row is only marked `closed` if the diff matches this enumeration.
- **A3 F2.2** (Low) — tenant/matter/document consistency check duplicated across classification + privilege. Resolved by the shared `resolveDocumentTarget`.
- **A2 F4.3** (Low) — retargeted, NOT closed. F4.3's recorded target was "A4 (add the pinning test alongside fact-target additions)" but A4 is NOT broadening classification to accept fact targets (out-of-scope per §5). A4's backlog-update step rewrites F4.3's `Target` field from "A4" to "future A5-fact-targets WI"; the row stays `status: open`.

### 1.3 Non-functional scope — LOC discipline

- New sibling `src/inMemoryFact.ts` for fact-specific logic.
- New shared `src/resolveTarget.ts` for the document-target helper (small file, ~50 LOC).
- `inMemoryRepo.ts` gains 4 thin delegates (~15 LOC each = ~60 LOC). Currently 622 pure LOC → projected ~680 (still under 800 fail).
- `inMemoryClassification.ts` and `inMemoryPrivilege.ts` each shrink slightly when their inlined document-resolution gets replaced with calls to `resolveDocumentTarget`.
- Maintain `inMemoryRepo.ts` < 800 pure LOC. If projected over, extract more delegates into the sibling modules.

---

## 2. Files expected to be added or modified

| Path | Action | Substance |
|---|---|---|
| `services/case-box-persistence/src/inMemoryFact.ts` | **NEW** | Fact storage + lifecycle. Pinned state shape: `FactState = { factsByMatter: Map<matterId, CaseBoxFact[]>; factIds: Set<string>; factIndex: Map<factId, matterId>; factById: Map<factId, CaseBoxFact> }`. The `factById` index gives O(1) row lookup so the supersession cycle walk is genuinely O(chain length), per round-1 review M3.1 fix. Exports `createFactState`, `prepareAppendFact`, `prepareTransitionFact`, `listFacts`. Imports `validateFact`, `assertValidNewFact`, `assertFactPromotionInvariants`, `assertValidFactTransition`, `FactCreationInvariantError`, `FactPromotionInvariantError`, `IllegalTransitionError` from contract. Centralized comparator `compareFactsChronological` (created_at ASC, id ASC). |
| `services/case-box-persistence/src/resolveTarget.ts` | **NEW** | Small shared helper. **Signature**: `resolveDocumentTarget(deps: { getDocument: (id: string) => { document: CaseBoxDocument } \| null }, query: { tenant_id: string; matter_id: string; target_id: string })`. Returns `{ document }` or throws `unknown_document` / `tenant_mismatch` / `matter_id_mismatch`. Pure function; no side effects; takes dependency injection (no private InternalState import in sibling modules), preserving the current A2/A3 callback pattern. |
| `services/case-box-persistence/src/inMemoryRepo.ts` | modified | Add `fact: FactState` slot. Add 4 thin delegate methods. |
| `services/case-box-persistence/src/inMemoryClassification.ts` | modified | Replace inlined document-target check with `resolveDocumentTarget` call. Behavior unchanged. |
| `services/case-box-persistence/src/inMemoryPrivilege.ts` | modified | Same refactor as classification. |
| `services/case-box-persistence/src/cursor.ts` | modified | Add `"facts_by_matter"` to `CaseBoxCursorKind` union; per-kind tuple `[string, string]`. |
| `services/case-box-persistence/src/types.ts` | modified | New interface methods + types (`FactTransitionOpts`, `ListFactsQuery`, `ListFactsPage`); re-export `CaseBoxFact`. |
| `services/case-box-persistence/src/index.ts` | modified | Re-exports for the 4 new public types. |
| `services/case-box-persistence/tests/conformance/fixtures.mjs` | modified | Add `makeFactInput(overrides?)`. |
| `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` | modified | Add ~28 conformance cases per §6 below. |
| `services/case-box-persistence/tests/invariants.test.mjs` | modified | §6.2.7 prototype allowlist bumps to 22. |
| `dev-memo/deferred-audit-findings.md` | modified | Close A2 F2.2, A3 F2.1, A3 F2.2 rows with `status: closed` and resolution-commit reference. |

**Total**: 2 new source files + 6 modified source files + 3 modified test files + 1 modified docs file = 12 file diffs.

---

## 3. Files expected to remain untouched

- `docs/contracts/case-box-contract/**` — A4 imports only.
- All other `services/**` packages.
- All ADRs / release docs.
- `.claude/**`.
- Three pre-existing user-deferred dev-memo drafts.

---

## 4. Invariants from Steps 0-7 enforced (or carried forward)

### Carried forward from A1 + A2 + A3

- `tenant_id` cross-entity consistency.
- Atomic write discipline.
- Audit emission via `buildCaseBoxAuditEvent` only.
- Per-matter monotonic `sequence`.
- `local-user` sentinel valid.
- Contract guards as single source of truth: `assertValidNewFact`, `assertFactPromotionInvariants`, `assertValidFactTransition` (transitions.ts:441).

### New for A4 (from Step 2 ADR §"Persistence obligations recorded")

1. **Creation rule**: `assertValidNewFact` runs before every insert; catches non-candidate status + non-null promotion fields. Persistence pre-validates `status === "candidate"` so the error is `invalid_argument` (not invalid_payload).
2. **No auto-accept**: machine-extracted facts (source_type ∈ `{llm_extraction, ocr_excerpt, imported}`) cannot reach `accepted` status without a lawyer transition. The contract's transition table bans the candidate → accepted edge entirely; persistence enforces by calling `assertValidFactTransition`.
3. **Reviewed → accepted promotion is load-bearing**: the only way to reach accepted is through reviewed first.
4. **Supersession is a new-row relationship**, not a state. The new row carries `supersedes_fact_id`; both rows stay accepted.
5. **Self-cycle prevention**: `assertFactPromotionInvariants` (contract layer).
6. **Broader supersession-graph cycle detection** (ADR §3 hard persistence requirement): A4 implements via a walk from `opts.supersedes_fact_id` following `.supersedes_fact_id` pointers; if the walk reaches the current fact's id OR exceeds the total fact count (defensive against pre-existing data corruption), reject with `invalid_argument`.
7. **Audit emissions**: per `CASE_BOX_AUDIT_EVENT_KINDS` table. `FACT_REJECTED` requires reason; `FACT_REPLACEMENT_ACCEPTED` emits when supersession is set on the accepted transition.
8. **Source-document tenant/matter consistency**: when `source_document_id` is non-null, the document must exist in the same matter (verified via `resolveDocumentTarget`).
9. **Step-2 obligation 6 carried**: lawyer can `appendFact` directly; `source_type === "lawyer_authored"` paths bypass extractor-field requirements (schema enforces; persistence accepts).

---

## 5. Out of scope

- No SQLite, native module, API, UI, sync, cloud, auth, LLM execution, OCR change, network call, schema change, contract edit, push, release-doc edit, .claude/** change.
- No broadening of classification / privilege to accept `target_type === "fact"`.
- No fact-derived deadline materialization (Step 6 / future).
- No backlog rows beyond A2 F2.2 + A3 F2.1 + A3 F2.2 closed by this WI. The remaining open Lows stay open per their existing target labels.

---

## 6. Tests planned

28 new conformance cases + 2 invariants additions + 2 audit-chain additions.

### 6.1 Conformance matrix additions

| § | Case | Asserts |
|---|---|---|
| 6.A4.1 | `appendFact` candidate happy path | row stored; FACT_PROPOSED audit; reason absent |
| 6.A4.2 | `appendFact` rejects status="reviewed" | `invalid_argument` |
| 6.A4.3 | `appendFact` rejects status="accepted" | `invalid_argument` |
| 6.A4.4 | `appendFact` rejects status="rejected" | `invalid_argument` |
| 6.A4.5 | `appendFact` rejects non-null reviewer fields on new row | `invalid_payload` (from `assertValidNewFact`) |
| 6.A4.6 | `appendFact` rejects non-null supersedes_fact_id on new row | `invalid_payload` |
| 6.A4.7 | `appendFact` rejects unknown matter | `unknown_matter` |
| 6.A4.8 | `appendFact` rejects tenant mismatch (matter level) | `tenant_mismatch` |
| 6.A4.9 | `appendFact` rejects matter_id mismatch (matter level) | `matter_id_mismatch` |
| 6.A4.10 | `appendFact` rejects unknown source_document_id | `unknown_document` |
| 6.A4.10b | `appendFact` rejects source_document_id from different matter (same tenant) | `matter_id_mismatch` |
| 6.A4.10c | `appendFact` rejects source_document_id from different tenant | `tenant_mismatch` |
| 6.A4.11 | `appendFact` accepts null source_document_id for lawyer_authored | row stored |
| 6.A4.12 | `appendFact` rejects ocr_excerpt without source_document_id | `invalid_payload` (schema) |
| 6.A4.13 | `appendFact` rejects duplicate id | `duplicate_id` |
| 6.A4.14 | `transitionFact` unknown factId | `invalid_argument` |
| 6.A4.15 | `transitionFact` candidate → reviewed happy path | row.status="reviewed"; reviewer fields set; FACT_REVIEWED audit |
| 6.A4.16 | `transitionFact` candidate → rejected shortcut (reason required) | missing reason → `invalid_argument`; with reason → FACT_REJECTED audit; reason equals rejection_reason |
| 6.A4.17 | `transitionFact` reviewed → accepted (no supersession) | row.status="accepted"; FACT_ACCEPTED audit (action: update) |
| 6.A4.18 | `transitionFact` reviewed → accepted WITH supersedes_fact_id | row carries supersedes; FACT_REPLACEMENT_ACCEPTED audit (action: create) |
| 6.A4.19 | `transitionFact` reviewed → rejected requires reason | missing → `invalid_argument`; with reason → FACT_REJECTED audit |
| 6.A4.20 | `transitionFact` illegal candidate → accepted | `illegal_transition` (contract bans the edge) |
| 6.A4.21 | `transitionFact` self-supersession | `invalid_argument` (caught by persistence cycle walk; contract assertion as defense-in-depth) |
| 6.A4.22 | `transitionFact` two-fact cycle (B supersedes A; A supersedes B) | `invalid_argument` |
| 6.A4.23 | `transitionFact` three-fact cycle (A→B→C→A) | `invalid_argument` |
| 6.A4.24 | `transitionFact` supersedes pointer references non-accepted fact | `invalid_argument` ("supersedes_fact_id must reference an accepted fact") |
| 6.A4.25 | `transitionFact` supersedes pointer references fact in different matter | `invalid_argument` |
| 6.A4.26 | `transitionFact` malformed opts.at | `invalid_argument` (schema revalidate before mutation, mirrors A3 audit fix) |
| 6.A4.27 | `listFacts` filter by status returns only matching rows; chronological ASC; cursor-paginates | multi-page; no duplicates; null cursor at end |
| 6.A4.27b | `listFacts` filter by source_document_id from different matter → matter_id_mismatch | (round-1 review L2.3 fix; do NOT silently return empty page) |
| 6.A4.27c | `listFacts` filter by source_document_id from different tenant → tenant_mismatch | (round-2 review L2.3 partial fix — explicit cross-tenant pinning) |
| 6.A4.28 | `getFact` unknown returns null | null returned |

### 6.2 Invariants test additions

- **§6.2.7 prototype allowlist** (modified): expects 22 entries — adds `appendFact`, `transitionFact`, `getFact`, `listFacts`.
- **§6.2.A4.1**: cross-WI deep-clone check on `getFact` returns.

### 6.3 Audit chain test additions

- **§6.3.A4.1**: PROPOSED → REVIEWED → ACCEPTED chain hash-valid; spans A1+A2+A3+A4.
- **§6.3.A4.2**: REPLACEMENT_ACCEPTED audit kind hashed correctly when supersession set.

---

## 7. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Supersession-graph cycle walk has off-by-one or unbounded loop | Medium | High — persistence accepts a cycle, corrupting the chain | Walk bounded by total fact count in matter; explicit visited-set; conformance §6.A4.21-23 exercises self / 2-cycle / 3-cycle |
| R2 | Audit kind selection mistakes FACT_ACCEPTED vs FACT_REPLACEMENT_ACCEPTED | Medium | High — wrong kind permanently corrupts audit semantics | Selector is `supersedes_fact_id presence`. Conformance §6.A4.17 + §6.A4.18 explicitly compare audit `action` field |
| R3 | A2/A3 refactor to use `resolveDocumentTarget` regresses existing error codes | Low | High — A2/A3 conformance breaks | Run full test suite after refactor; helper signature preserves the same throws (unknown_document, tenant_mismatch, matter_id_mismatch); A2/A3 conformance cases unchanged |
| R4 | LOC discipline — inMemoryRepo.ts crosses 800 fail | Low | Medium | Current 622 + 4 delegates (~60 LOC) = ~680. Monitor; if over, extract delegates |
| R5 | Reviewer fields drift between candidate→rejected shortcut and reviewed→rejected | Medium | Medium | Both paths set `reviewer_actor_user_id`, `reviewed_at`, `rejected_at`, `rejection_reason` via the same patch routine; conformance §6.A4.16 + §6.A4.19 pin |
| R6 | Closing backlog rows in deferred-audit-findings.md before audit verifies the refactor is clean | Low | Medium | Order: refactor + tests pass → audit + verify pass → THEN close backlog rows in the same commit (atomic). If audit reopens an issue, leave the row open |
| R7 | `assertValidFactTransition` reason check fires for missing rejection_reason BEFORE persistence pre-check | Low | Low | Pre-validate reason in persistence before calling the contract helper (same pattern as A3 round-2 fix). Missing reason → `invalid_argument`, illegal edge → `illegal_transition` |
| R8 | `supersedes_fact_id` accepted without checking referenced fact's status | Low | High — A "supersedes a candidate" would corrupt SoT | Persistence validates `referenced.status === "accepted"` before allowing supersession set. §6.A4.24 pins |
| R9 | Cross-matter supersession allowed | Low | High — tenant/matter isolation breach | Persistence rejects when `referenced.matter_id !== current.matter_id`. §6.A4.25 pins |
| R10 | Deep-clone leak on read paths | Low | Medium | `getFact` clones; `listFacts` clones each row in the page; conformance §6.2.A4.1 |

---

## 8. Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| 8.1 | All package tests pass (≈140 total) | `npm --prefix services/case-box-persistence test` |
| 8.2 | Sibling contracts pass (322 + 102) | spot test runs |
| 8.3 | loc-guardian 0 over fail | `/loc-guardian:scan` |
| 8.4 | Public surface = 22 | invariants §6.2.7 |
| 8.5 | No new error codes | conformance |
| 8.6 | Audit chain valid spanning A1-A4 | §6.3.A4.1 |
| 8.7 | Supersession cycle detection works for self / 2-cycle / 3-cycle | §6.A4.21-23 |
| 8.8 | cc-suite review-plan succeeded via Path 1 (CCSUITE-02 retry policy may fire) | 11 fields recorded |
| 8.9 | cc-suite audit + verify via Path 1; verdict `ALL CLOSED` or `ALL CLOSED + DEFERRED-PER-A4 Lows` | recorded |
| 8.10 | Backlog rows A2 F2.2, A3 F2.1, A3 F2.2 marked `closed` with commit hash | `dev-memo/deferred-audit-findings.md` |
| 8.11 | Explicit-stage commit; no `git add .`; no push | scoped diff |

---

## 9. Out-of-scope clarifications for the reviewer

Do NOT flag:
- Absence of fact-target broadening in classification / privilege (out of scope; future WI).
- Absence of `PrivilegeReviewState` wrapper (Step 5 obligation 6 dependency unresolved).
- Absence of deadline materialization (Step 6 / future phase).
- A4 introducing one new shared helper (`resolveTarget.ts`) — the file is small and exists to close two backlog rows; not over-engineering.
- A4 closing A3 F2.1 by using public types from `types.ts` in the local modules' function signatures (no new shared types module).

Reviewer SHOULD flag:
- Any cycle-walk path that misses self / 2-cycle / 3-cycle / N-cycle.
- Any path where `appendFact` lets through a non-candidate status.
- Any path where `transitionFact` reaches accepted from candidate directly (must go through reviewed).
- Any audit kind selection inconsistent with `supersedes_fact_id` presence.
- LOC drift past 800 in any single hand-written source file.
- Backlog rows closed without conformance evidence in the same commit.

---

## 10. cc-suite invocation plan (per `.claude/rules/cc-suite.md` + CCSUITE-02)

| Stage | Kind | Path attempts |
|---|---|---|
| Plan review (this file) | `review-plan` | Path 1 full packet → Path 1 compact (on TIMEOUT) → Path 2 (on second TIMEOUT) |
| Implementation audit | `audit` | Path 1 → Path 2 fallback per §"Failure handling" |
| Post-fix verify | `verify` | Path 1 with explicit audit artifact reference |

Per `.claude/rules/cc-suite.md` §"Audit remediation policy", every deferred Low landing from A4's audit MUST also be recorded in `dev-memo/deferred-audit-findings.md` as a new row under a new "Phase A4 — facts" section.

---

## 11. References

- `dev-memo/plan-case-box-persistence-00.md` — parent plan.
- `dev-memo/plan-case-box-persistence-A1.md`, `dev-memo/plan-case-box-persistence-A2.md`, `dev-memo/plan-case-box-persistence-A3.md` — preceding reviewed plans.
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` — Step 2 ADR.
- `docs/contracts/case-box-contract/src/fact-invariants.ts`, `transitions.ts`, `audit-log.ts`.
- `docs/contracts/case-box-contract/schemas/case-box-fact.schema.json`.
- `services/case-box-persistence/src/inMemoryRepo.ts`, `inMemoryClassification.ts`, `inMemoryPrivilege.ts` — A1-A3 implementation; A4 extends + refactors.
- `dev-memo/deferred-audit-findings.md` — backlog; A4 closes 3 rows.
- `.claude/rules/cc-suite.md` — broker policy + retry + remediation.
