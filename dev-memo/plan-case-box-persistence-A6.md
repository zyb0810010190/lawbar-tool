# CASE-BOX-PERSISTENCE Phase A6 — Evidence Items (bounded plan)

**Status**: round-2 plan after r1 review. Round-1 verdict NEEDS REVISION (1 High + 5 Mediums + Lows); revisions applied.

## Review history

- 2026-05-21 round 1 — Path 1 full packet, first try. Job `review-plan-mpflp84y-ri9d4v`. Verdict **NEEDS REVISION**. Revisions applied (this version):
  - **H Dim 3 #1 (LOC estimate not calibrated)**. Reviewer counted raw 939 lines vs the plan's 795. Clarification: the 795 figure is the **loc-guardian counter** authoritative metric (`.claude/rules/loc-guardian.md` is the gate, not a raw `wc -l`); the counter strips comments + blank lines per its language-aware rules. The fixed plan now explicitly cites "795 pure LOC per loc-guardian counter" + adds a hard-gate condition: re-run `/loc-guardian:scan` AFTER extraction; if `inMemoryRepo.ts > 720`, abort A6's delegate additions and extract more from §1.4 first.
  - **M Dim 1 #2 + M Dim 4 #1 (supersedes_evidence_id field naming is semantically backward-readable)**. The schema field's English name suggests "id I supersede" but the placement on the SUPERSEDED row makes the intent "id that supersedes me (i.e. my replacement)". **FIX**: persistence renames the option to `replacement_evidence_id` and maps it to the schema field — the persistence-side surface is now unambiguous. Added explicit doc comment on the type + test name `accepted → superseded with replacement_evidence_id` to pin direction.
  - **M Dim 2 #1 (null vs absent supersedes_evidence_id at append)**. Schema allows omitting the field for non-superseded rows. **FIX**: append guard now reads "must be null OR absent at append; only `superseded` rows may carry a non-null string per the schema's if/then". Added conformance §6.A6.5b for omitted-field happy path at append.
  - **M Dim 2 #2 (cross-tenant same-matter supersession not separately pinned)**. **FIX**: added §6.A6.16b — referenced evidence exists in same matter but different tenant (constructed via tampered fixture or two-tenant setup); rejected with `tenant_mismatch`.
  - **M Dim 3 #2 (stale fallback extraction list)**. `listFacts` / `listPrivilegeMarkers` / `listConfidentialityClassifications` are ALREADY thin delegates in A5's post-extraction state. **FIX**: replaced §1.4 with actually-still-inline candidates: `appendEvidenceItem`'s commit boilerplate, `confirmDocketEntry`'s commit step, the various `getX` methods' tenant-resolution prefix.
  - **M Dim 5 #1 (hard LOC gate)**. **FIX**: §1.3 now contains an explicit hard-gate: STOP and extract more if inMemoryRepo.ts >720 post-extraction; do NOT proceed with A6 delegates.
  - **L Dim 4 #2 (cycle deferral defensible)**: no change needed; documented.

**Status**: ready for round-2 `/cc-suite:review-plan`.
**Date**: 2026-05-21.
**Parent plan**: `dev-memo/plan-case-box-persistence-00.md` §10.2 row A6 ("Evidence item — Low risk.").
**Built on**: A5 (commit `b84b494`).

A6 is governed by a **mandatory LOC pre-extraction step** because `inMemoryRepo.ts` is currently at **795 pure LOC** — only 5 below the 800 fail threshold. Any A6 delegate addition without prior extraction would cross fail.

---

## Review packet (compact)

### Active plan summary

Phase A6 implements `CaseBoxEvidenceItem` storage. 4 new methods: `appendEvidenceItem` (proposed-only), `transitionEvidenceItem` (proposed → accepted/rejected; accepted → superseded with `opts.replacement_evidence_id`), `getEvidenceItem` (scoped read), `listEvidenceItems` (paginated). Public surface 28 → 32. **Mandatory LOC pre-extraction** first: extract `listDocuments` body to `src/inMemoryDocument.ts` and the three audit-read methods (`listAuditEvents`, `getAuditChainHead`, `verifyAuditChainForMatter`) to a new `src/inMemoryAudit.ts` sibling BEFORE adding A6 delegates. Projected post-extraction `inMemoryRepo.ts`: **~710 pure LOC** (saves ~85). Post-A6 (with 4 thin delegates ≤15 LOC each): **~770 pure LOC**, ~30 LOC under fail. Step-1 evidence shape carries a documented schema asymmetry — `supersedes_evidence_id` lives on the SUPERSEDED row (the field reads "id I supersede" but the schema places it there); persistence renames the option to `replacement_evidence_id` for caller clarity; the schema field name stays as-is.

### Exact target files

**Pre-extraction (Step 0 of implementation):**
- `services/case-box-persistence/src/inMemoryDocument.ts` — modified: add `listDocuments(state, query)` helper.
- `services/case-box-persistence/src/inMemoryAudit.ts` — NEW sibling. Holds `listAuditEvents`, `getAuditChainHead`, `verifyAuditChainForMatter` helpers.
- `services/case-box-persistence/src/inMemoryRepo.ts` — modified: existing `listDocuments` / `listAuditEvents` / `getAuditChainHead` / `verifyAuditChainForMatter` reduced to thin delegates.

**A6 additions:**
- `services/case-box-persistence/src/inMemoryEvidence.ts` — NEW sibling. Evidence-item storage + lifecycle. Exports `createEvidenceState`, `prepareAppendEvidenceItem`, `prepareTransitionEvidenceItem`, `listEvidenceItems`.
- `services/case-box-persistence/src/inMemoryRepo.ts` — modified: add 4 thin delegates + 1 state slot.
- `services/case-box-persistence/src/cursor.ts` — add cursor kind `evidence_items_by_matter` (tuple `[created_at:string, id:string]`).
- `services/case-box-persistence/src/types.ts` — add 4 interface methods + 4 query/opts types; re-export `CaseBoxEvidenceItem`.
- `services/case-box-persistence/src/index.ts` — re-exports.
- `services/case-box-persistence/tests/conformance/fixtures.mjs` — add `makeEvidenceItemInput`.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — add ~22 conformance cases.
- `services/case-box-persistence/tests/invariants.test.mjs` — §6.2.7 allowlist bumps to 32.

### Exact acceptance criteria

1. `npm --prefix services/case-box-persistence test` exits 0 (176 from A1-A5 + ~22 A6 ≈ 198 total).
2. `npm --prefix docs/contracts/case-box-contract test` still 322/322.
3. `npm --prefix docs/contracts test` (OCR) still 102/102.
4. loc-guardian: 0 over fail (800). `inMemoryRepo.ts` ≤ 800 (target: ≤ 720, preferably ≤ 650 per the user's spec).
5. Public surface = 32; §6.2.7 allowlist matches.
6. No new `CaseBoxPersistenceError` code; A6 reuses the 10 documented codes.
7. Audit chain valid spanning A1-A6.
8. cc-suite audit + verify via Path 1; retrievable.
9. Pre-extraction does NOT change behavior — all A1-A5 conformance cases pass unchanged after the move.
10. Schema asymmetry preserved: `supersedes_evidence_id` lives on the superseded row; A6 does NOT add a contract-side helper to alias or rename.

### Exact out-of-scope list

- No SQLite / native module / API / UI / sync / cloud / auth / LLM / OCR / external network / schema change / contract edit / dependency change / ADR-or-release edit / .claude/** edit / push.
- No contract-side helper to rename or alias `supersedes_evidence_id` (Step 2 ADR explicitly notes this asymmetry is "out of Step-2 scope" — A6 inherits that posture).
- No bidirectional supersession-chain validation (Step 1 evidence ADR does not specify cycle prohibition; A6 only checks the referenced id exists in same tenant + matter).
- No broadening of A2/A3 to accept evidence-target classifications/privilege (still future "fact/evidence-target broadening WI").
- A2 F4.3 backlog row stays open (still NOT closed by A6 — its target is fact-target broadening, NOT evidence).

### Essential ADR references

- `dev-memo/plan-case-box-persistence-00.md` — parent plan §10.2 row A6 ("Low risk").
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` §3 (line ~47) — documents the Step-1 evidence-item schema asymmetry ("`supersedes_evidence_id` is required on a row whose own status is `superseded` — a shape that is semantically confused... renaming is a future Step-1 schema-rewrite decision and out of Step-2 scope").
- `docs/contracts/case-box-contract/src/transitions.ts` — `ALLOWED_EVIDENCE_EDGES` at :216 (3 edges); `assertValidEvidenceTransition` at :402.
- `docs/contracts/case-box-contract/src/audit-log.ts` — `EVIDENCE_PROPOSED/ACCEPTED/REJECTED/SUPERSEDED` at :85-88 (PROPOSED is create, rest are update; no reason_required on any).
- `docs/contracts/case-box-contract/schemas/case-box-evidence-item.schema.json` — entity shape; `if/then` requires `supersedes_evidence_id` when status === "superseded".

### Review questions (targeted)

1. **LOC pre-extraction**: is the projected post-extraction `inMemoryRepo.ts` LOC (estimated ~710 pure) realistic? Does the audit-read extraction risk behavior drift in `listAuditEvents` / `getAuditChainHead` / `verifyAuditChainForMatter`?
2. **Schema asymmetry handling**: `transitionEvidenceItem` for `accepted → superseded` requires the caller to provide `opts.replacement_evidence_id` (persistence-side option name). The resulting persisted row's contract field `supersedes_evidence_id` carries that value. Is the schema asymmetry (field on the superseded row, not the new row) carrying any subtle audit-event implications?
3. **Audit-kind selection**: does PROPOSED on create + ACCEPTED/REJECTED/SUPERSEDED on update align with the contract table? Is there any tension with the supersession field semantics like FACT_REPLACEMENT_ACCEPTED's `before_state_hash: null` discipline?
4. **Cycle prohibition**: Step 1 does NOT specify evidence supersession cycle detection (unlike Step 2's fact obligation). A6 deliberately skips cycle walk. Is that the right cut?
5. **Public surface**: 4 methods (matches A4 pattern). Should A6 also add a separate `appendEvidenceSuperseded(input, supersedesId)` analogous to facts' FACT_REPLACEMENT_ACCEPTED, OR is the single `transitionEvidenceItem` cleaner since evidence supersession is an UPDATE (not create) per the audit table?

---

## 1. Scope

### 1.1 LOC pre-extraction (Step 0 of implementation, BEFORE A6 delegates)

`inMemoryRepo.ts` is currently 795 pure LOC. Without extraction, A6's 4 delegates (~60 LOC) would push it to ~855, over fail.

**Pre-extraction plan**:

| Target | What moves | Estimated savings |
|---|---|---|
| `inMemoryDocument.ts` | `listDocuments` body (~50 LOC) → delegate (~10 LOC) | -40 |
| `inMemoryAudit.ts` (NEW) | `listAuditEvents` body (~45 LOC) + `getAuditChainHead` (~15 LOC) + `verifyAuditChainForMatter` (~10 LOC) → 3 thin delegates (~25 LOC total) | -45 |
| **Total** | | **~-85** |

Projected post-extraction `inMemoryRepo.ts`: **795 - 85 = 710 pure LOC**. With A6's 4 delegates (~60 LOC): **~770 pure LOC**. Under 800 fail by 30 LOC.

If the user's `<650` preference is to be hit, additional extraction needed. A6 plan keeps the floor at <800 (mandatory); <720 (target); <650 (stretch only if achievable without scope creep).

Pre-extraction commit discipline:
- Extraction is mechanical — moves existing code verbatim into prepare-style helpers (parallel to A5's matter/document extraction pattern).
- A1-A5 conformance MUST pass unchanged after extraction, before any A6 code is added.
- If pre-extraction surfaces a behavior change in any test, STOP and revert (the extraction is invalid; investigate before continuing).

### 1.2 Functional scope — 4 new public methods (28 → 32)

1. **`appendEvidenceItem(input: unknown): Promise<CaseBoxEvidenceItem>`**
   - Pre-schema raw guard: `status !== "proposed"` → `invalid_argument`.
   - `validateEvidenceItem(input)` — failure → `invalid_payload`.
   - Defense-in-depth: `supersedes_evidence_id` MUST be **null OR absent** at append (round-1 fix M2.1). A non-null string `supersedes_evidence_id` on a proposed-status row rejects with `invalid_payload` (the schema's `if/then` only fires for superseded; persistence pre-rejects the inconsistent shape at append to keep semantics clean). Conformance §6.A6.5 (non-null reject) + §6.A6.5b (omitted-field happy path) pin both branches.
   - Tenant/matter consistency at the matter level: matter exists, `matter.tenant_id === row.tenant_id`.
   - When `source_document_id` non-null: shared `resolveDocumentTarget`.
   - Duplicate-id check via `evidenceIds: Set<string>` index.
   - Audit kind: `EVIDENCE_PROPOSED` (action: create; reason absent).
   - Single-write atomic commit.

2. **`transitionEvidenceItem(evidenceId: string, opts: EvidenceTransitionOpts): Promise<CaseBoxEvidenceItem>`**
   - `EvidenceTransitionOpts = { to: "accepted" | "rejected" | "superseded"; actor_user_id: string; at: string; replacement_evidence_id?: string }`. The persistence option is named `replacement_evidence_id` for clarity (round-1 fix M1.2 + M4.1). It maps to the contract's `supersedes_evidence_id` field on the patched (now-superseded) row — semantically "the id of the evidence that REPLACES this one". JSDoc/type comments + conformance test names pin the direction.
   - Pre-validate `opts` shape.
   - Resolve evidence via `evidenceIndex: Map<evidenceId, matterId>`. Unknown → `invalid_argument`.
   - When `to === "superseded"`: `opts.replacement_evidence_id` MUST be a non-empty string. Resolve the referenced (replacement) evidence; reject with `invalid_argument` if not found, with `matter_id_mismatch` if cross-matter, with `tenant_mismatch` if same-matter cross-tenant (defensive). NO additional state restriction on the referenced row (Step 1 does not specify; cycle detection deferred).
   - `assertValidEvidenceTransition(prior.status, opts.to, "lawyer")` — `IllegalTransitionError` → `illegal_transition`.
   - Patch row: status; when `to === "superseded"`, also set `supersedes_evidence_id`.
   - `validateEvidenceItem(next)` re-check BEFORE mutation (catches malformed timestamps if any).
   - Audit kind selection:
     - `to === "accepted"` → `EVIDENCE_ACCEPTED` (action: update; reason absent).
     - `to === "rejected"` → `EVIDENCE_REJECTED` (action: update; reason absent).
     - `to === "superseded"` → `EVIDENCE_SUPERSEDED` (action: update; reason absent).
   - Audit field bindings: `entity_id = next.id`; `before_state_hash = entityStateHash(prior)`; `after_state_hash = entityStateHash(next)`; `timestamp = #nowIso()`; `actor_user_id = opts.actor_user_id`.

3. **`getEvidenceItem(query: GetEvidenceItemQuery): Promise<CaseBoxEvidenceItem | null>`**
   - `query = { tenant_id, matter_id, evidence_id }` — scoped per A4 F5.1 lesson.

4. **`listEvidenceItems(query: ListEvidenceItemsQuery): Promise<ListEvidenceItemsPage>`**
   - `query = { tenant_id, matter_id, status?, source_document_id?, cursor?, limit? }`.
   - Pagination: chronological order by `created_at ASC, id ASC`. Cursor kind `evidence_items_by_matter`; tuple `[string, string]`.
   - When `source_document_id` filter is set, use `resolveDocumentTarget` (matches A4 pattern — rejects cross-matter / cross-tenant).
   - Rejects `unknown_matter` / `tenant_mismatch` per A1.

### 1.3 LOC budget plan

Current `inMemoryRepo.ts` pure LOC: **795** (per the loc-guardian counter — `.claude/rules/loc-guardian.md` §"Gate semantics" uses the counter's pure-LOC metric, NOT raw `wc -l`. Raw line count is ~939 because the file includes ~144 lines of comments + blanks; the gate counts only executable code).

After Step 0 pre-extraction: **~710**.

After A6 delegates (4 methods × ~15 LOC): **~770**.

**Hard gate (round-1 M5.1 fix)**: re-run `/loc-guardian:scan` AFTER the pre-extraction step BEFORE adding any A6 delegate. If the resulting `inMemoryRepo.ts` is still >720 pure LOC, STOP and extract more from §1.4 candidates first. Do NOT add A6 delegates over a thin margin. The 720 ceiling leaves room for the 4 × ~15 LOC delegates to land under the 800 fail with ≥30 LOC of safety.

Target: under 800 fail ✓ (mandatory). Preferred: under 720 (achievable post-extraction). Stretch: under 650 (would require additional extraction beyond A6's scope — see §1.4 for candidates and the conditions under which they fire).

### 1.4 Further extraction candidates (if hard gate at §1.3 fires)

Round-1 fix M3.2: the originally-listed candidates (`listFacts`, `listPrivilegeMarkers`, `listConfidentialityClassifications`) are ALREADY thin delegates in A5's post-extraction state. The actual still-inline candidates as of A5 close:

- `getEffectiveClassification` (~25 LOC inline tenant/matter pre-check) → move to `inMemoryClassification.ts`.
- `getPrivilegeStatus` (~30 LOC inline tenant/matter/document pre-check + scope guard) → move to `inMemoryPrivilege.ts`.
- The `confirmDocketEntry` delegate's commit step (~30 LOC of WeakMap mutation) → move into `inMemoryDocket.ts` as a `commitConfirm(state, prepared)` helper that the delegate calls.
- Each `getX` method's matter resolution + tenant-mismatch guard pattern (~5 LOC × 4 sites = ~20 LOC) → small shared helper `resolveMatterScope` in a new util module.

Combined potential savings: ~75-100 LOC. Triggered ONLY IF §1.3's hard gate fires (i.e. post-extraction inMemoryRepo.ts >720). Otherwise NOT touched in A6.

Defer the stretch <650 target to a separate "consolidation" refactor WI if not naturally hit here.

### 1.5 Internal state additions

- `state.evidence: EvidenceState = { evidenceByMatter: Map<matterId, CaseBoxEvidenceItem[]>; evidenceIds: Set<string>; evidenceIndex: Map<evidenceId, matterId>; evidenceById: Map<evidenceId, CaseBoxEvidenceItem> }` — same pattern as A4's `FactState`.

---

## 2. Files expected to be added or modified

| Path | Action | Substance |
|---|---|---|
| `services/case-box-persistence/src/inMemoryDocument.ts` | modified | Add `listDocuments(state, query)` helper. |
| `services/case-box-persistence/src/inMemoryAudit.ts` | **NEW** | Holds `listAuditEvents`, `getAuditChainHead`, `verifyAuditChainForMatter` helpers. |
| `services/case-box-persistence/src/inMemoryEvidence.ts` | **NEW** | Evidence-item storage + lifecycle. Exports `createEvidenceState`, `prepareAppendEvidenceItem`, `prepareTransitionEvidenceItem`, `listEvidenceItems`. |
| `services/case-box-persistence/src/inMemoryRepo.ts` | modified | Replace listDocuments + 3 audit-read methods with thin delegates; add 4 evidence delegates + 1 state slot. |
| `services/case-box-persistence/src/cursor.ts` | modified | Add `evidence_items_by_matter` kind. |
| `services/case-box-persistence/src/types.ts` | modified | New interface methods + types; re-export `CaseBoxEvidenceItem`. |
| `services/case-box-persistence/src/index.ts` | modified | Re-exports. |
| `services/case-box-persistence/tests/conformance/fixtures.mjs` | modified | Add `makeEvidenceItemInput`. |
| `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` | modified | Add ~22 conformance cases. |
| `services/case-box-persistence/tests/invariants.test.mjs` | modified | §6.2.7 allowlist bumps to 32. |

**Total**: 2 new source files + 5 modified source files + 3 modified test files = 10 file diffs.

---

## 3. Files expected to remain untouched

- `docs/contracts/case-box-contract/**`.
- All other `services/**` packages.
- All ADRs / release docs.
- `.claude/**`.
- Three pre-existing user-deferred dev-memo drafts.
- `dev-memo/deferred-audit-findings.md` — A6 has no expected backlog closures or new deferrals (relabel optional only if A6's audit surfaces a Low that genuinely targets A6+).

---

## 4. Invariants from Step 1 evidence + carry-forward A1-A5

- `tenant_id` cross-entity consistency.
- Atomic write discipline.
- Audit emission via `buildCaseBoxAuditEvent` only.
- Per-matter monotonic `sequence`.
- `local-user` sentinel valid.
- Contract guards as single source of truth: `validateEvidenceItem`, `assertValidEvidenceTransition`.

### New for A6

1. **All evidence items created in `status === "proposed"`** — persistence narrows the contract surface (no contract-side `assertValidNewEvidenceItem` exists). Direct create in accepted/rejected/superseded rejected with `invalid_argument`. Defense-in-depth note: schema's `if/then` only fires for status === superseded; the persistence pre-guard catches the other terminal-direct paths.
2. **Schema asymmetry inherited** — `supersedes_evidence_id` field lives on the SUPERSEDED row (the field name reads "id I supersede" but is placed on the superseded row). A6 honors as-is. Conformance pins the asymmetry (test asserts the patched superseded row carries the field).
3. **Cross-matter / cross-tenant supersession reference REJECTED** — even without explicit Step-1 obligation, A6 enforces this for parity with A4's supersession check.
4. **No cycle detection** — Step 1 does not specify; A6 explicitly defers (NOT in scope).

---

## 5. Out of scope

- All standard exclusions.
- Manual convenience APIs.
- `getDeadline` / `listDeadlines` still deferred (A8).
- A2/A3 broadening to evidence-target classifications/privilege (future broadening WI).
- Contract-side rename or alias of `supersedes_evidence_id`.

---

## 6. Tests planned

22 new conformance + 1 invariants + 1 audit-chain.

### 6.1 Conformance matrix additions

| § | Case | Asserts |
|---|---|---|
| 6.A6.1 | `appendEvidenceItem` proposed happy path | row stored; EVIDENCE_PROPOSED audit |
| 6.A6.2 | rejects status=accepted | `invalid_argument` |
| 6.A6.3 | rejects status=rejected | `invalid_argument` |
| 6.A6.4 | rejects status=superseded | `invalid_argument` |
| 6.A6.5 | rejects non-null supersedes_evidence_id at append | `invalid_payload` |
| 6.A6.5b | accepts proposed append with supersedes_evidence_id ABSENT (omitted from input) | row stored; field not present in returned row |
| 6.A6.6 | rejects unknown matter | `unknown_matter` |
| 6.A6.7 | rejects matter-level tenant mismatch | `tenant_mismatch` |
| 6.A6.8 | rejects unknown source_document_id | `unknown_document` |
| 6.A6.9 | rejects cross-matter source_document_id | `matter_id_mismatch` |
| 6.A6.10 | rejects duplicate id | `duplicate_id` |
| 6.A6.11 | `transitionEvidenceItem` proposed → accepted | EVIDENCE_ACCEPTED audit |
| 6.A6.12 | `transitionEvidenceItem` proposed → rejected | EVIDENCE_REJECTED audit |
| 6.A6.13 | `transitionEvidenceItem` accepted → superseded with valid supersedes_evidence_id | EVIDENCE_SUPERSEDED audit; patched row carries supersedes_evidence_id |
| 6.A6.14 | accepted → superseded without supersedes_evidence_id | `invalid_argument` |
| 6.A6.15 | accepted → superseded with unknown supersedes_evidence_id | `invalid_argument` |
| 6.A6.16 | accepted → superseded with cross-matter replacement_evidence_id | `matter_id_mismatch` |
| 6.A6.16b | accepted → superseded with same-matter cross-tenant replacement_evidence_id (defensive) | `tenant_mismatch` |
| 6.A6.17 | rejects illegal proposed → superseded | `illegal_transition` |
| 6.A6.18 | rejects re-transitioning a rejected entry | `illegal_transition` |
| 6.A6.19 | `getEvidenceItem` scoped (mirrors A4 lesson) | unknown null; cross-matter null; cross-tenant throws tenant_mismatch |
| 6.A6.20 | `listEvidenceItems` cursor + status filter + chronological ASC | multi-page |
| 6.A6.21 | `listEvidenceItems` source_document_id filter rejects cross-matter | `matter_id_mismatch` |
| 6.A6.22 | `listEvidenceItems` rejects unknown_matter | `unknown_matter` |

### 6.2 Invariants test additions

- **§6.2.7 prototype allowlist** (modified): expects 32 entries (28 + 4 A6).

### 6.3 Audit chain test additions

- **§6.3.A6.1**: PROPOSED → ACCEPTED → SUPERSEDED chain valid; spans A1-A6.

---

## 7. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Pre-extraction regresses A1-A5 conformance behavior | Low | High | Mechanical move; full A1-A5 conformance run BEFORE adding A6. STOP and revert if any A1-A5 case fails. |
| R2 | LOC budget overrun even after extraction | Low | Medium | Re-run `/loc-guardian:scan` after extraction and after A6. If `inMemoryRepo.ts` > 800, defer A6's `listEvidenceItems` body deeper into the sibling (its delegate becomes ~6 LOC); or extract more from §1.4. |
| R3 | Schema asymmetry handling: persistence sets `supersedes_evidence_id` on the row being transitioned to superseded, but the field name's English reading is "id I supersede" — implementer reads it backwards | Medium | Medium | Persistence-side option is renamed to `opts.replacement_evidence_id` (round-1 fix M1.2 + M4.1). It maps to the persisted row's contract field `supersedes_evidence_id`. Conformance §6.A6.13 explicitly asserts the patched row carries the field; §6.A6.15 + 16 exercise referenced-id validation. |
| R4 | Audit chain breaks because of evidence supersession's atypical schema field placement | Low | Medium | Persistence treats EVIDENCE_SUPERSEDED as a normal update — `before_state_hash = prior`, `after_state_hash = next`. No before_hash null discipline like facts' REPLACEMENT_ACCEPTED (which was action: create). Conformance §6.3.A6.1 verifies. |
| R5 | Cross-matter / cross-tenant supersession reference allowed | Low | High — tenant/matter isolation breach | Persistence resolves `opts.replacement_evidence_id` via `evidenceIndex` and rejects with `matter_id_mismatch` if cross-matter or `tenant_mismatch` if same-matter cross-tenant (defensive). Conformance §6.A6.16 + §6.A6.16b pin. |
| R6 | Cycle creation via supersession (A→B, B→A) | Low | Medium — Step 1 doesn't specify; out-of-scope deferral | A6 deferred; documented. Future WI may add cycle walk if needed. |
| R7 | New audit-read sibling module misses one of the three methods, leaving a partial extraction | Low | Medium | All three (listAuditEvents, getAuditChainHead, verifyAuditChainForMatter) extracted together; A6 conformance + invariants assert the audit-chain behavior is unchanged. |

---

## 8. Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| 8.1 | All package tests pass (≈198 total) | `npm --prefix services/case-box-persistence test` |
| 8.2 | Sibling contracts pass | spot test runs |
| 8.3 | loc-guardian: 0 over fail; inMemoryRepo.ts ≤ 800 (target ≤ 720) | `/loc-guardian:scan` after extraction, after A6 |
| 8.4 | Public surface = 32 | invariants §6.2.7 |
| 8.5 | No new error codes | conformance |
| 8.6 | Audit chain valid spanning A1-A6 | §6.3.A6.1 |
| 8.7 | Pre-extraction preserves A1-A5 behavior | A1-A5 cases pass UNCHANGED before A6 added |
| 8.8 | Schema asymmetry preserved | §6.A6.13 |
| 8.9 | cc-suite review-plan + audit + verify via Path 1 retrievable | 11 fields recorded per invocation |
| 8.10 | Explicit-stage commit; no `git add .`; no push | scoped diff |

---

## 9. Out-of-scope clarifications for the reviewer

Do NOT flag:
- Missing cycle prohibition on evidence supersession (Step 1 doesn't specify; deferred).
- Missing contract-side rename of `supersedes_evidence_id` (Step 2 ADR explicitly defers).
- `supersedes_evidence_id` on the superseded row (not the new row) — that's Step 1's documented shape.
- LOC budget not hitting <650 stretch — <720 is the realistic target; <650 requires additional extraction beyond A6 scope.

Reviewer SHOULD flag:
- Any path where pre-extraction changes A1-A5 behavior.
- Any audit-kind selection inconsistent with the contract table.
- Any cross-matter / cross-tenant supersession reference accepted.
- Any path where `transitionEvidenceItem` allows accepted → superseded without supersedes_evidence_id.
- LOC drift past 800.

---

## 10. cc-suite invocation plan

| Stage | Kind | Path |
|---|---|---|
| Plan review (this file) | `review-plan` | Path 1 full packet → compact on TIMEOUT → Path 2 |
| Pre-extraction + A6 implementation audit | `audit` | Path 1 |
| Post-fix verify | `verify` | Path 1 with explicit audit artifact |

Recording per `.claude/rules/cc-suite.md` §"Required recording" (11 fields per CCSUITE-02).

---

## 11. References

- `dev-memo/plan-case-box-persistence-00.md` §10.2 row A6.
- `dev-memo/plan-case-box-persistence-A1.md` … `A5.md`.
- `dev-memo/deferred-audit-findings.md` — backlog (A6 closes none).
- `docs/contracts/case-box-contract/src/transitions.ts` — `ALLOWED_EVIDENCE_EDGES` :216, `assertValidEvidenceTransition` :402.
- `docs/contracts/case-box-contract/src/audit-log.ts` — `EVIDENCE_*` :85-88.
- `docs/contracts/case-box-contract/schemas/case-box-evidence-item.schema.json`.
- `services/case-box-persistence/src/*` — A1-A5 implementation; A6 extends + extracts.
- `.claude/rules/cc-suite.md` — broker policy.
