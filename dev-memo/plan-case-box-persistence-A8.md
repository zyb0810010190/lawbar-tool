# CASE-BOX-PERSISTENCE Phase A8 — Read-Side Aggregations (bounded plan)

**Status**: round-2 plan after r1 review. Round-1 verdict NEEDS REVISION (1 High + 5 Med + Lows); revisions applied.

## Review history

- 2026-05-21 round 1 — Path 1 full packet, first try. Job `review-plan-mpfo6tgm-wsjxzk`. Verdict **NEEDS REVISION**. Revisions applied:
  - **H Dim 5 #1 (`listDocumentsNeedingReview` not satisfiable)**: current `ListDocumentsQuery` has no status / doc_type filter. FIX: extended `ListDocumentsQuery` with optional `status?` and `doc_type?` filters; `listDocumentsHelper` applies them. `listDocumentsNeedingReview` is now achievable as `listDocuments({status: "triaged"})` — parent §4.4 surface closed.
  - **H Dim 2 #1 (incomplete scope-guard tests)**: added conformance §6.A8.12b (listDeadlines unknown matter), §6.A8.12c (listDeadlines cross-tenant), §6.A8.19b (getDeadlineCalendar cross-tenant), §6.A8.24b (chain cross-matter returns empty array).
  - **M Dim 1 #1 (getDocumentDetail helper-call ordering)**: pinned implementation order — resolve `{tenant_id, matter_id, document_id}` to a scoped document FIRST; return `null` if missing/cross-matter; only THEN invoke classification/privilege helpers (which by that point are guaranteed not to throw).
  - **M Dim 5 #2 (parent §4.3 `asserted_date` ordering not achievable)**: documented gap — contract `CaseBoxFact` has no `asserted_date` field. Parent §4.3's `listFactsAccepted` ordered by `asserted_date` is aspirational; A8 declines to ship it and documents the contract-extension gap for a future WI. `listFacts({status:"accepted"})` ordered by `created_at ASC` (existing behavior) is the closest approximation.
  - **M Dim 2 #2 (no audit-count-stable test)**: added §6.A8.A1 — seed audited writes, snapshot audit chain head, call all 7 A8 methods, assert head unchanged.
  - **M Dim 2 #3 (50-candidate cap not tested)**: added §6.A8.11b — populate >50 candidates for one document; assert `getDocumentDetail.fact_candidates.length === 50` with deterministic ordering; assert `listFacts` can page the full set.
  - **L Dim 1 #2 (chain direction wording)**: rewritten — "current fact → fact it supersedes (one step back) → ... → original root with `supersedes_fact_id === null`".
  - **L Dim 1 #3 (audit events omitted from MatterSummary)**: explicit note added in §1.1 method 2.
  - **L Dim 4 #1 (unbounded calendar)**: explicitly accepted unbounded mode (when neither from nor to supplied); added §6.A8.20 unbounded conformance.
  - **L Dim 4 #2 (50-cap as explicit constant)**: pinned `FACT_CANDIDATE_PREVIEW_CAP = 50` in §1.1 method 3.

**Status**: ready for round-2 review.
**Date**: 2026-05-21.
**Parent plan**: `dev-memo/plan-case-box-persistence-00.md` §10.2 row A8 ("Read-side aggregations (matter summary, calendars, queues) — Low risk").
**Built on**: A7 (commit `c31dbaa`).

A8 is purely read-side. No new write paths, no schema changes, no contract edits. All methods are pure functions over already-stored state.

---

## Review packet (compact)

### Active plan summary

Phase A8 adds 7 read-side aggregation methods to the in-memory persistence: `listMatters` (paginated matter list), `getMatterSummary` (entity counts per matter), `getDocumentDetail` (bundled document + OCR link + classification + privilege markers + fact candidates), `getDeadline` (scoped read; was deferred from A5), `listDeadlines` (paginated; deferred from A5), `getDeadlineCalendar` (date-bounded view), `getFactSupersessionChain` (walks `supersedes_fact_id` backward to the chain root). Public surface 35 → 42. No new entity types, no new audit events, no new error codes. All A1-A7 invariants preserved. Pre-A8 `inMemoryRepo.ts` is 582 pure LOC; projected post-A8 ~652 LOC (well under 700 user-target). Aggregation logic lives in a new sibling `src/inMemoryAggregations.ts`; repo gets 7 thin delegates.

### Exact target files

- `services/case-box-persistence/src/inMemoryAggregations.ts` — NEW sibling. Holds all 7 aggregation helpers: `listMattersHelper`, `getMatterSummaryHelper`, `getDocumentDetailHelper`, `getDeadlineHelper`, `listDeadlinesHelper`, `getDeadlineCalendarHelper`, `getFactSupersessionChainHelper`.
- `services/case-box-persistence/src/inMemoryRepo.ts` — modified: add 7 thin delegate methods (no state slot — aggregations are pure functions over existing state).
- `services/case-box-persistence/src/cursor.ts` — add cursor kinds `matters_by_tenant` (for listMatters) and `deadlines_by_matter` (deferred from A5).
- `services/case-box-persistence/src/types.ts` — add 7 interface methods + types (`ListMattersQuery`, `ListMattersPage`, `MatterSummary`, `DocumentDetail`, `GetDeadlineQuery`, `ListDeadlinesQuery`, `ListDeadlinesPage`, `DeadlineCalendarQuery`).
- `services/case-box-persistence/src/index.ts` — re-exports.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — add ~24 conformance cases.
- `services/case-box-persistence/tests/invariants.test.mjs` — §6.2.7 allowlist bumps to 42.

### Exact acceptance criteria

1. `npm --prefix services/case-box-persistence test` exits 0 (218 from A1-A7 + ~24 A8 ≈ 242 total).
2. `npm --prefix docs/contracts/case-box-contract test` still 322/322.
3. `npm --prefix docs/contracts test` (OCR) still 102/102.
4. loc-guardian: 0 over fail. `inMemoryRepo.ts` < 700 pure LOC (projected ~652).
5. Public surface = 42; §6.2.7 allowlist matches.
6. No new `CaseBoxPersistenceError` code; A8 reuses the 10 documented codes.
7. No new contract dependency; no schema change.
8. No new audit events emitted (read-only).
9. cc-suite audit + verify via Path 1; retrievable.
10. All A8 methods are TENANT/MATTER SCOPED (per the A4 F5.1 lesson — never leak across tenant/matter boundaries).

### Exact out-of-scope list

- No SQLite / native module / API / UI / sync / cloud / auth / LLM / OCR-package import / external network / schema change / contract edit / dependency change / ADR-or-release edit / .claude/** edit / push.
- No new write-surface — A8 is read-only.
- No `listFactCandidates` / `listFactsAccepted` / `listFactsAwaitingReview` / `listDocumentsNeedingReview` / `listDocketEntriesPending` as DEDICATED methods. These are achievable via existing `listFacts({status:"candidate"})`, `listDocketEntries({confirmation_state:"proposed"})`, etc. with status filters; the parent plan §4.4 lists them but they are derivative of existing list methods. A8 declines to add them to keep the surface tight. Note in plan that the parent's §4.4 list is satisfied by status-filtered calls to existing methods.
- No `risk` / `next_action` (parent plan §4.1 note — not in Step 1+ contract surface).

### Essential ADR references

- `dev-memo/plan-case-box-persistence-00.md` §4 read-side aggregations + §10.2 row A8.
- Step ADRs already inform A1-A7; A8 introduces no new contract surface.

### Review questions (targeted)

1. **MatterSummary shape**: which counts go into the summary? Per parent plan: documents, facts (by status), deadlines (by status), privilege markers, docket entries, confidentiality classifications. Plus OCR links + evidence items (added by A5-A7 since the parent plan was written). Is the shape coherent?
2. **DocumentDetail bundle**: pulls 5 sub-views (document + OCR link + classification + privilege markers + fact candidates). Risk: each sub-view has its own scope error model. Should the bundle method take a scoped query (`{tenant_id, matter_id, document_id}`) and reject scope mismatches?
3. **FactSupersessionChain walk**: Step 2 ADR says supersession is via NEW row's `supersedes_fact_id` (the new accepted fact carries the pointer; the old accepted fact has its pointer null until it itself is superseded). Walking BACKWARD from a fact follows `.supersedes_fact_id` repeatedly until null. Persistence already cycle-checks at write time, so this walk terminates. Pin direction.
4. **getDeadlineCalendar boundaries**: `from?` and `to?` are inclusive or exclusive? Time-zone handling? Same `due_at` ordering as `listDeadlines`?
5. **Public surface size**: A1-A7 surface = 35; adding 7 → 42. Is that reasonable for "Low" complexity? Should any of the 7 fold into existing methods via parameter expansion?

---

## 1. Scope

### 1.1 Functional scope — 7 new public methods (35 → 42)

1. **`listMatters(query: ListMattersQuery): Promise<ListMattersPage>`**
   - `query = { tenant_id, status?, cursor?, limit? }`.
   - Pagination: `created_at DESC, id ASC` per parent plan §4.1.
   - Filter rules: status (active / archived) optional.
   - Cursor kind `matters_by_tenant`; tuple `[created_at:string, id:string]`.
   - Seek predicate descending primary, ascending tiebreak.
   - No matter-scope check (this IS the matter list); tenant filter only.

2. **`getMatterSummary(query: GetMatterSummaryQuery): Promise<MatterSummary | null>`**
   - `query = { tenant_id, matter_id }` — scoped per the A4 F5.1 lesson.
   - Unknown matter → null; cross-tenant matter → throws `tenant_mismatch`.
   - Returns: `{ matter: CaseBoxMatter, counts: { documents, facts_by_status, deadlines_by_status, privilege_markers, docket_entries_by_state, confidentiality_classifications, evidence_items_by_status, ocr_links } }`.
   - **Audit events are intentionally EXCLUDED from MatterSummary counts** (round-1 L Dim 1 #3 fix). Audit observability lives in `listAuditEvents` / `getAuditChainHead`. Mixing it into the summary would tempt readers to treat audit counts as a derived business metric.
   - Counts computed from existing state slots. No mutation.
   - Counts include sub-status breakdowns: `facts_by_status: { candidate, reviewed, accepted, rejected }`; `deadlines_by_status: { pending, met, missed, withdrawn }`; `docket_entries_by_state: { proposed, confirmed, dismissed }`; `evidence_items_by_status: { proposed, accepted, rejected, superseded }`.

3. **`getDocumentDetail(query: GetDocumentDetailQuery): Promise<DocumentDetail | null>`**
   - `query = { tenant_id, matter_id, document_id }` — scoped.
   - **Implementation order (round-1 M Dim 1 #1 fix)**: resolve the scoped document FIRST (matter exists check → cross-tenant matter throws → document exists check → document.matter_id === query.matter_id check). If any check fails (other than cross-tenant matter), return `null` immediately. Helpers below are invoked ONLY after scope is proven, so they cannot throw `unknown_document` / `matter_id_mismatch`.
   - Unknown matter / unknown document / cross-matter document → null.
   - Cross-tenant matter throws `tenant_mismatch`.
   - Returns: `{ document: CaseBoxDocument, ocr_link: CaseBoxOcrLink | null, effective_classification: { effectiveLevel: ConfidentialityLevel, history: [...] }, privilege_status: PrivilegeResolution, fact_candidates: CaseBoxFact[] }`.
   - `effective_classification` reuses `getEffectiveClassificationHelper` (already extracted in A7).
   - `privilege_status` reuses `getPrivilegeStatusHelper`.
   - `fact_candidates` filters from `state.fact.factsByMatter` where `source_document_id === document_id AND status === "candidate"`. Bounded by `FACT_CANDIDATE_PREVIEW_CAP = 50` (pinned constant). The bundle is preview-only; full retrieval routes through `listFacts({status:"candidate", source_document_id})`. Conformance §6.A8.11b pins the cap with a >50 fixture.

4. **`getDeadline(query: GetDeadlineQuery): Promise<CaseBoxDeadline | null>`**
   - `query = { tenant_id, matter_id, deadline_id }` — scoped.
   - Deferred from A5 per plan; now implemented.
   - Unknown returns null; cross-tenant matter throws.

5. **`listDeadlines(query: ListDeadlinesQuery): Promise<ListDeadlinesPage>`**
   - `query = { tenant_id, matter_id, status?, kind?, cursor?, limit? }`.
   - Pagination: `due_at ASC, id ASC` (chronological — earliest-first for lawyer review queues).
   - Cursor kind `deadlines_by_matter`; tuple `[due_at:string, id:string]`.

6. **`getDeadlineCalendar(query: DeadlineCalendarQuery): Promise<CaseBoxDeadline[]>`**
   - `query = { tenant_id, matter_id, from?: string, to?: string }`.
   - `from` is INCLUSIVE start (deadlines with `due_at >= from`); `to` is INCLUSIVE end (`due_at <= to`). When undefined, that bound is open.
   - Returns ALL matching deadlines in the range, ordered `due_at ASC, id ASC`. No pagination — calendar view assumes the date range is bounded enough to fit.
   - Bounded result: caller-supplied range. If neither `from` nor `to` is supplied, returns all deadlines in matter (same as listDeadlines without filters but without cursor).
   - **Scope errors** (round-2 Dim 1 fix): unknown matter → `unknown_matter`; cross-tenant matter → `tenant_mismatch`. Matches `listDeadlines` scoped-list convention.

7. **`getFactSupersessionChain(query: GetFactSupersessionChainQuery): Promise<CaseBoxFact[]>`**
   - `query = { tenant_id, matter_id, fact_id }` — scoped.
   - Direction (round-1 L Dim 1 #2 fix, clearer wording): walks BACKWARD from the queried fact. At each step, `current.supersedes_fact_id` (set on a NEW accepted fact when it replaces a prior accepted fact per Step 2 ADR §3) points one step OLDER. Walk continues until `supersedes_fact_id === null` — the chain ROOT (the original accepted fact for that conceptual claim).
   - Returns the chain ordered: `[queried fact, fact it supersedes, older predecessor, ..., root]`.
   - Cross-matter / cross-tenant facts excluded via `getFact` scoped check; returns empty array if root fact not in scope.
   - Persistence's A4 cycle-detection guarantees walk terminates; defensive cap at total fact count.

### 1.2 Internal state additions

NONE. A8 is read-only over existing state.

### 1.3 LOC budget

Pre-A8: `inMemoryRepo.ts` 582 pure LOC. A8 adds 7 thin delegates (~10 LOC each = ~70 LOC). Projected: ~652. Under 700 user-target by ~48 LOC margin.

If LOC exceeds budget, the heavier helpers (matter summary, document detail) can extract further into the aggregation sibling.

---

## 2. Files expected to be added or modified

| Path | Action | Substance |
|---|---|---|
| `services/case-box-persistence/src/inMemoryAggregations.ts` | **NEW** | All 7 aggregation helpers; pure read-only over the repo's state. |
| `services/case-box-persistence/src/inMemoryRepo.ts` | modified | Add 7 thin delegates (no state slot — read-only). |
| `services/case-box-persistence/src/cursor.ts` | modified | Add cursor kinds `matters_by_tenant` + `deadlines_by_matter`. |
| `services/case-box-persistence/src/types.ts` | modified | New interface methods + types. |
| `services/case-box-persistence/src/index.ts` | modified | Re-exports. |
| `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` | modified | Add ~24 conformance cases. |
| `services/case-box-persistence/tests/invariants.test.mjs` | modified | §6.2.7 allowlist bumps to 42. |

---

## 3. Files expected to remain untouched

- `docs/contracts/case-box-contract/**`.
- All other `services/**` packages.
- All ADRs / release docs.
- `.claude/**`.
- Three pre-existing user-deferred dev-memo drafts.
- `dev-memo/deferred-audit-findings.md` — no expected closures or new deferrals (A8 is read-only; minimal risk surface).

---

## 4. Invariants carried forward

- `tenant_id` cross-entity consistency.
- Tenant/matter scope on every read method (A4 F5.1 lesson).
- Deep-clone returned rows (never expose internal references).
- No write paths; no audit events; no schema mutations.
- OCR subordination: `getDocumentDetail` reads `getOcrLink` snapshot only; never writes back.
- Local-user / classification / privilege gates unchanged.

---

## 5. Out of scope

- All standard exclusions plus:
- No dedicated `listFactCandidates` / `listFactsAccepted` / `listFactsAwaitingReview` / `listDocketEntriesPending` methods (achievable via existing list methods with status filters — `listFacts({status:"candidate"})`, `listDocketEntries({confirmation_state:"proposed"})`, etc.; tracked as a future cosmetic-API WI if desired).
- **`listDocumentsNeedingReview`**: NOT a dedicated method, but A8 EXTENDS `ListDocumentsQuery` with optional `status?` and `doc_type?` filters (round-1 H Dim 5 #1 fix). Callers do `listDocuments({status: "triaged"})` for "needing review" semantics. The schema's status enum includes `registered/ocr_pending/ocr_complete/ocr_failed/triaged/tagged/reviewed`; "needing review" maps to `triaged` per parent §4.4.
- **`listFactsAccepted` ordered by `asserted_date`**: NOT achievable in A8. Parent §4.3 referenced `asserted_date` ordering, but `CaseBoxFact` schema has no such field (it has `accepted_at`). A future contract-extension WI may add `asserted_date`; until then, `listFacts({status:"accepted"})` ordered by `created_at ASC` (existing behavior) is the closest available approximation.
- No `risk` / `next_action` fields (parent plan §4.1 — not in current contract surface).
- No date-time math beyond simple string comparisons (`due_at` is ISO-8601; `<`/`>=` work for chronological ordering).
- No timezone resolver for calendar (Step 6 ADR forbids date_only confirmation; A8 only handles already-confirmed deadlines with datetime kind).

---

## 6. Tests planned

~32 new conformance cases (24 original + 8 round-2 additions) + 1 invariants update.

### 6.1 Conformance matrix additions

| § | Case | Asserts |
|---|---|---|
| 6.A8.1 | `listMatters` empty tenant returns empty | rows=[], next_cursor=null |
| 6.A8.2 | `listMatters` ordered created_at DESC + cursor pagination | multi-page; ordering |
| 6.A8.3 | `listMatters` filter by status=archived | only archived rows |
| 6.A8.4 | `getMatterSummary` unknown matter returns null | null |
| 6.A8.5 | `getMatterSummary` cross-tenant throws | tenant_mismatch |
| 6.A8.6 | `getMatterSummary` empty matter returns zero counts | all zeros |
| 6.A8.7 | `getMatterSummary` populated matter counts correct | seed N entities, verify counts match |
| 6.A8.8 | `getDocumentDetail` unknown document returns null | null |
| 6.A8.9 | `getDocumentDetail` cross-matter document returns null | null |
| 6.A8.10 | `getDocumentDetail` cross-tenant throws | tenant_mismatch |
| 6.A8.11 | `getDocumentDetail` populated includes ocr_link / classification / privilege / fact_candidates | shape verification |
| 6.A8.11b | `getDocumentDetail` fact_candidates cap (>50 fixture) | length === 50; deterministic ordering; full set retrievable via listFacts |
| 6.A8.12 | `getDeadline` unknown returns null | null |
| 6.A8.12b | `listDeadlines` unknown matter | unknown_matter |
| 6.A8.12c | `listDeadlines` cross-tenant | tenant_mismatch |
| 6.A8.13 | `getDeadline` cross-tenant throws | tenant_mismatch |
| 6.A8.14 | `getDeadline` returns deadline | row |
| 6.A8.15 | `listDeadlines` empty returns empty | rows=[] |
| 6.A8.16 | `listDeadlines` ordered due_at ASC + cursor pagination | multi-page |
| 6.A8.17 | `listDeadlines` filter by status | only matching |
| 6.A8.18 | `listDeadlines` filter by kind | only matching |
| 6.A8.19 | `getDeadlineCalendar` from + to bounds (inclusive) | only in-range |
| 6.A8.19b | `getDeadlineCalendar` cross-tenant | tenant_mismatch |
| 6.A8.20 | `getDeadlineCalendar` no bounds returns all | all matter deadlines |
| 6.A8.21 | `getFactSupersessionChain` single fact returns [fact] | length 1 |
| 6.A8.22 | `getFactSupersessionChain` 3-fact chain ordered current → root | length 3, descending |
| 6.A8.23 | `getFactSupersessionChain` unknown fact returns [] | empty |
| 6.A8.24 | `getFactSupersessionChain` cross-tenant returns [] | empty (no leak) |
| 6.A8.24b | `getFactSupersessionChain` cross-matter fact returns [] | empty (no leak) |
| 6.A8.A1 | Audit-count stable after invoking all 7 A8 reads | head/count unchanged before vs after |
| 6.A8.A2 | `listDocuments` with new `status` filter | only matching documents (round-1 H Dim 5 #1 fix; verifies listDocumentsNeedingReview equivalent) |
| 6.A8.A2b | `listDocuments` with `doc_type` filter | only matching documents (round-2 Dim 2 fix — verifies both new filters) |

### 6.2 Invariants test additions

- **§6.2.7 prototype allowlist** (modified): expects 42 entries.

---

## 7. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Aggregation method leaks across tenant/matter | Low | High | Every method scoped per A4 F5.1; conformance tests pin |
| R2 | getMatterSummary counts drift from actual state | Medium | Medium | Counts computed at read-time (no caching); §6.A8.7 seeds known data and asserts exact counts |
| R3 | getFactSupersessionChain infinite loop on corrupt state | Low | Medium | A4 cycle-detection prevents corrupt chains; defensive: cap walk at total fact count |
| R4 | getDeadlineCalendar from/to semantics confused | Low | Low | Plan pins inclusive bounds; conformance §6.A8.19 verifies |
| R5 | LOC overshoot 700 | Low | Medium | 7 delegates × ~10 LOC; projected 652. Hard gate after implementation |

---

## 8. Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| 8.1 | All package tests pass (≈242 total) | `npm --prefix services/case-box-persistence test` |
| 8.2 | Sibling contracts pass | spot test runs |
| 8.3 | loc-guardian: 0 over fail; inMemoryRepo.ts < 700 | `/loc-guardian:scan` |
| 8.4 | Public surface = 42 | invariants §6.2.7 |
| 8.5 | No new error codes | conformance |
| 8.6 | No new audit events (all reads) | conformance pins audit count unchanged after read calls |
| 8.7 | Tenant/matter scope on every read | individual A8 conformance cases |
| 8.8 | Supersession chain walk terminates | §6.A8.22 |
| 8.9 | cc-suite review-plan + audit + verify via Path 1 retrievable | 11 fields recorded |
| 8.10 | Explicit-stage commit; no `git add .`; no push | scoped diff |

---

## 9. Out-of-scope clarifications for the reviewer

Do NOT flag:
- Missing dedicated `listFactCandidates` etc. — achievable via `listFacts({status})` per the §5 deliberate cut.
- Missing risk / next_action fields — parent plan §4.1 notes their absence from contract surface.
- No timezone handling in getDeadlineCalendar — Step 6 forbids date_only confirmation; A8 reads already-resolved `due_at` strings.

Reviewer SHOULD flag:
- Any aggregation that mutates state.
- Any aggregation that emits an audit event.
- Any scope leak across tenant/matter.
- LOC drift past 700.
- getMatterSummary counts that miss an entity type (e.g. forgetting OCR links).

---

## 10. cc-suite invocation plan

| Stage | Kind | Path |
|---|---|---|
| Plan review | `review-plan` | Path 1 full packet → compact on TIMEOUT → Path 2 |
| Implementation audit | `audit` | Path 1 |
| Post-fix verify | `verify` | Path 1 with explicit audit artifact |

---

## 11. References

- `dev-memo/plan-case-box-persistence-00.md` §4 + §10.2.
- `dev-memo/plan-case-box-persistence-A1.md` … `A7.md`.
- `dev-memo/deferred-audit-findings.md` — backlog (no A8 closures).
- `services/case-box-persistence/src/*` — A1-A7 implementation; A8 reads.
- `.claude/rules/cc-suite.md` — broker policy.
