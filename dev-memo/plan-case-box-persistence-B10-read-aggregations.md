# Plan: CASE-BOX-PERSISTENCE B10 — SQLite read-side aggregations

**Status**: READY (revision 3 — Path 1 native --background rev-2 review returned READY (Low-risk clarifications). 2 Lows applied opportunistically: §1.2 getDocumentDetail document-lookup made explicitly scoped `WHERE id = ? AND matter_id = ?` (per rev-2 reviewer L D2#1); §6 risk #4 stale "derive from archived_at" wording cleaned to match §1.2 rule (per rev-2 reviewer L D3#1). All earlier rev-1 fixes remain landed: listMatters DESC, getMatterSummary cross-tenant THROW, status filter via CaseBoxMatter.status, getDocumentDetail delegates to helpers, deferred-Low accounting accurate, MatterSummary parity fixture density.).
**Date**: 2026-05-23.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Umbrella plan**: `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (READY at `1ac26b1`) §2 row B10.
**Predecessors**: ABI gate (`d02fff8`); B1 (`601d74c`); B2 (`6b5d5f6`); B3 (`5400637`); B4 (`bb285ca`); B5 (`fcfc816`); B6 (`8fe0b04` / `667bb9c`); B7 (`adae300` / `69db974`); B8 (`767f1a4` / `bfda127`); B9 (`1357481` / `6289d89`); CCSUITE-PATH1-RCA-01 (`d3e1cbc`); WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01 (`8d3bb0b`); execution-discipline (`9c0966f`).
**Lane**: NIGHT-RUN-SQLITE-B10-PLAN (planning only; no implementation).
**Risk**: MEDIUM. B10 is a read-only WI with NO schema changes and NO new write paths. Risk concentrates in cross-table aggregation correctness — `MatterSummary` reads 8 entity tables, `DocumentDetail` reads 5; mismatched matter-scoping or tenant filtering would produce subtle parity drift vs the in-memory helpers.

## Review packet (compact)

### Active plan summary

B10 is the TENTH SQLite sub-WI of Phase B. It implements **read-side aggregations** on top of B1-B9 infrastructure. The umbrella's §2 row B10 lists 8 methods, but **3 are already shipped**:

| Method | Status | Shipped in |
|---|---|---|
| `listMatters` | NOT yet implemented | **B10 (this plan)** |
| `getMatterSummary` | NOT yet implemented | **B10 (this plan)** |
| `getDocumentDetail` | NOT yet implemented | **B10 (this plan)** |
| `getDeadlineCalendar` | NOT yet implemented | **B10 (this plan)** |
| `getFactSupersessionChain` | NOT yet implemented | **B10 (this plan)** |
| `listDeadlines` | SHIPPED | B7 (`69db974`) |
| `listDocketEntries` | SHIPPED | B7 (`69db974`) |
| `listOcrLinks` | SHIPPED | B9 (`6289d89`) |

B10 therefore implements **5 NEW method bodies** in `SqliteCaseBoxPersistence.ts` (converting 5 `not_implemented` stubs). The umbrella's enumeration is the "Phase A8 surface" — the 3 listX methods are carried-forward implementations from earlier WIs.

**NO schema changes**. CURRENT_SCHEMA_VERSION stays at 8. All 5 methods are read-only aggregations over existing tables (case_box_matters, case_box_documents, case_box_facts, case_box_deadlines, case_box_privilege_markers, case_box_docket_entries, case_box_confidentiality_classifications, case_box_evidence_items, case_box_ocr_links). `schema.ts` stays at 547 LOC (B9 D4#2 deferred Low does NOT progress).

**NO new write paths**. B10 adds zero `#runImmediateWrite` callers; all 5 methods are pure SELECTs. `SqliteCaseBoxPersistence.ts` adds ~12 LOC for 5 thin call-throughs.

Plan-only file: `dev-memo/plan-case-box-persistence-B10-read-aggregations.md` (THIS FILE).

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-B10-read-aggregations.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/**`.
- `docs/contracts/case-box-contract/**`.
- Any OCR package.
- AGENTS.md.
- Umbrella / B1..B9 plans.
- `dev-memo/plan-case-box-persistence-00.md`.

### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. Plan enumerates B10 scope per umbrella §2 row B10 verbatim + clarifies that 3 methods are ALREADY shipped.
3. Plan declares NO schema changes (CURRENT_SCHEMA_VERSION stays at 8).
4. Plan declares the conformance label filter regex (extends B9 with `6.A8.*` + `R6.4`).
5. Plan declares hardening invariants (3+ — cross-table count consistency, matter+tenant scoping, DocumentDetail aggregation correctness).
6. Plan declares HARD-STOP categories that DO and DO NOT trigger.
7. Plan declares LOC budget per touched file + LOC-growth-prevention strategy.
8. Plan declares cc-suite audit + verify expectations for the impl WI.
9. Plan declares execution-discipline compliance per `.claude/rules/execution-discipline.md`.
10. Plan addresses each deferred Low explicitly (see §5).
11. cc-suite review-plan returns READY (or only Low-risk clarifications) via Path 1 native `--background`.

### Exact out-of-scope list (B10; deferred to B11)

- **No B11 entities** (replay-safe `*Once` variants).
- **`appendFactOnce`** stays `not_implemented` (B11). `upsertOcrLink` is already shipped at B9 with idempotent-replay semantics; the umbrella's row B11 mention of "`upsertOcrLink`" refers to the prior planning where Once-shape was unclear — at impl time upsertOcrLink turned out to live in B9 as a native upsert. B11 owns the remaining Once writer (`appendFactOnce` only).
- **No schema changes**. CURRENT_SCHEMA_VERSION stays 8.
- **No new write paths**.
- **No public-API change** (B10 implements 5 EXISTING interface methods).
- **No new top-level dep.**
- **No real-data migration.**
- **No API / UI / mini-program / auth / cloud / sync / LLM / OCR runtime changes.**
- **No broad refactor of `SqliteCaseBoxPersistence.ts`** beyond 5 thin call-throughs.
- **No `requireMatterTenant` extraction** (B7 L D2#1 stays deferred — the read-aggregation helpers ARE candidates for natural touch, BUT plan defers cleanup; see §5).
- **No DDL extraction** (B9 D4#2 stays deferred — no schema work in B10).
- **No git push.**
- **No committed rollback.**

### Essential references

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B10.
- `services/case-box-persistence/src/inMemoryAggregations.ts` — behavioral target: `listMattersHelper`, `getMatterSummaryHelper`, `getDocumentDetailHelper`, `getDeadlineCalendarHelper`, `getFactSupersessionChainHelper`.
- `services/case-box-persistence/src/types.ts` — query/result types: `ListMattersQuery`/`Page`, `GetMatterSummaryQuery`/`MatterSummary`, `GetDocumentDetailQuery`/`DocumentDetail`, `DeadlineCalendarQuery`, `GetFactSupersessionChainQuery`.
- `services/case-box-persistence/src/sqlite/{matter,document,audit,classification,privilege,facts,docket,deadline,evidence,ocrLink}RepoQueries.ts` — existing read helpers (some reusable; see §1.2).
- `services/case-box-persistence/src/sqlite/sqliteBackedIdSet.ts` — NOT used in B10 (no write paths).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — B10 cases `6.A8.1`..`6.A8.24` (incl. variants `11b`, `12b`, `12c`, `19b`, `19c`, `24b`). **31 cases** + R6.4 (getDocumentDetail asset-field preservation).
- B9 audit `audit-mphx2ods-qf6qsv` deferred Lows (D2#1 read-helper duplication; D4#1 SqliteCaseBoxPersistence LOC; D4#2 schema.ts LOC).
- CCSUITE-PATH1-RCA-01 (`d3e1cbc`) — Path 1 native `--background`.
- `.claude/rules/cc-suite.md`, `echo-sleuth.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

### Review questions for the reviewer

1. **B10 method count clarification**: umbrella §2 row B10 lists 8 methods; 3 (`listDeadlines`/`listDocketEntries`/`listOcrLinks`) are already shipped (B7+B9). B10 implements only 5 new method bodies. Is this clarification adequate? Plan does NOT propose to amend the umbrella (defer to a docs-only umbrella cleanup WI).

2. **`MatterSummary` aggregation strategy**: the result type has 8 count buckets across 8 tables (documents, facts_by_status, deadlines_by_status, privilege_markers, docket_entries_by_state, confidentiality_classifications, evidence_items_by_status, ocr_links). Plan picks: **8 separate `SELECT COUNT(*)` / `SELECT status, COUNT(*) GROUP BY status` queries** inside `getMatterSummarySqlite`, executed sequentially. Single-tenant single-matter scope; v1 lawyer-scale (per matter: low hundreds of rows) → ≤8 indexed counts per call is acceptable. Alternative (UNION ALL + CASE) rejected as premature optimization.

3. **`DocumentDetail` aggregation**: returns `{document, ocr_link, effective_classification, privilege_status, fact_candidates}`. Plan picks: **reuse existing SQLite helpers** — `getOcrLinkSqlite` (B9), `getEffectiveClassificationSqlite` (B4), `getPrivilegeStatusSqlite` (B5), plus a new query for fact_candidates (facts with `source_document_id == query.document_id`). Each helper applies its own tenant/matter scoping; the parent helper aggregates the results into `DocumentDetail`.

4. **`getDeadlineCalendar` query shape**: `DeadlineCalendarQuery` has `tenant_id`, `matter_id`, optional `from`, optional `to`. Returns sorted ASC by `due_at` (per `getDeadlineCalendarHelper`). Plan picks: `SELECT payload_json FROM case_box_deadlines WHERE matter_id = ? [AND due_at >= ?] [AND due_at <= ?] ORDER BY due_at ASC, id ASC`. Uses the existing `idx_case_box_deadlines_by_matter_seek` index.

5. **`getFactSupersessionChain` walk**: the in-memory helper walks from `fact_id` backward via `supersedes_fact_id` until null. Plan picks: **matter-scoped SELECT all facts → in-memory walk via fact-by-id Map**, mirroring B6's transition shadow state. Single SELECT bounded by matter fact count (per B6 plan's 500-fact threshold). NO recursive CTE for v1.

6. **No schema changes** (B10 reads existing tables) — `schema.ts` does NOT progress beyond B9's 547 LOC. B9 D4#2 stays deferred at the same LOC.

7. **Conformance regex**: `^Sqlite-B10: (?:6\.1\.(...)|6\.A2\.(...)|6\.A3\.(...)|6\.A4\.(...)|6\.A5\.(...)|6\.A6\.(...)|6\.A7\.(...)|6\.A8\.(?:11b|12b|12c|19b|19c|24b|[1-9]|1[0-9]|2[0-4])|R5\.(...)|R6\.[1-4])(?:\s|$)`. Adds 6.A8.* (31 cases incl. 6 variants) + R6.4 (carried-forward; previously OUT). Total +32 new ids.

8. **Outside-scope smoke** (after B10): `6.A8.25+` → out; `6.A9.*` → B11; R6 stops at 4 (no R6.5+).

9. **Deferred-Low handling**: see §5. NOTABLE: the read-aggregation helpers may NATURALLY touch the `requireMatterTenant` duplication (B7 L D2#1) since 5 new helpers each need matter+tenant validation. Plan picks: **continue the per-file inlined pattern** (do NOT extract `requireMatterTenant` in B10; keep the deferred Low alive for a future cleanup WI when natural-touch surface is broader).

---

## §1 B10 scope

### §1.1 NO schema changes

CURRENT_SCHEMA_VERSION stays at **8**. B10 does NOT add any DDL. All 5 method impls read existing tables.

`schema.ts` stays at 547 LOC. B9 D4#2 deferred Low does NOT progress (no DDL_V9).

### §1.2 New file: `aggregationsRepoQueries.ts` (estimated ~400-500 LOC)

Mirrors `{matter,document,audit,classification,privilege,facts,docket,deadline,evidence,ocrLink}RepoQueries.ts` shape. Five exports:

- `listMattersSqlite(db, query)` — paginated read.
  - Tenant scoped: `WHERE tenant_id = ?`.
  - Optional `status` filter: MUST match `CaseBoxMatter.status` semantics per
    `listMattersHelper` (in-memory line `if (query.status !== undefined &&
    matter.status !== query.status) continue;`). Per rev-1 reviewer M D3#3:
    use the row's `status` field — either via a lifted `status` column if
    the existing `case_box_matters` table has one, OR via
    `JSON_EXTRACT(payload_json, '$.status') = ?` if not. Do NOT derive from
    `archived_at` (the contract field is `status`, not `archived_at`).
    Verify at impl time which approach the existing table supports.
  - Cursor seek: `ORDER BY created_at DESC, id ASC` (matches in-memory
    `listMattersHelper` lines ~95-99; per rev-1 reviewer M D1#1).
    DESC inversion in cursor predicate: `(created_at < ? OR (created_at
    = ? AND id > ?))`.
  - Returns `ListMattersPage`.

- `getMatterSummarySqlite(db, query)` — single-matter aggregation (1 matter
  lookup + 8 aggregation buckets per rev-1 reviewer L D1#3 wording fix).
  - Matter + tenant scope via `case_box_matters`. **Parity behavior** per
    `getMatterSummaryHelper` (in-memory line ~118; per rev-1 reviewer M D1#2):
    - Unknown matter → return null.
    - Matter EXISTS but tenant mismatch → THROW `CaseBoxPersistenceError("tenant_mismatch", ...)`. Do NOT silently return null on tenant mismatch.
  - 8 sub-counts via dedicated SELECTs (after matter+tenant validation):
    1. `SELECT payload_json FROM case_box_matters WHERE id = ?` → if missing
       return null; if `tenant_id != query.tenant_id` THROW tenant_mismatch
       (NOT null).
    2. `SELECT COUNT(*) FROM case_box_documents WHERE matter_id = ?` → documents.
    3. `SELECT status, COUNT(*) FROM case_box_facts WHERE matter_id = ? GROUP BY status` → facts_by_status (4 buckets).
    4. `SELECT status, COUNT(*) FROM case_box_deadlines WHERE matter_id = ? GROUP BY status` → deadlines_by_status (4 buckets).
    5. `SELECT COUNT(*) FROM case_box_privilege_markers WHERE matter_id = ?` → privilege_markers.
    6. `SELECT confirmation_state, COUNT(*) FROM case_box_docket_entries WHERE matter_id = ? GROUP BY confirmation_state` → docket_entries_by_state (3 buckets).
    7. `SELECT COUNT(*) FROM case_box_confidentiality_classifications WHERE matter_id = ?` → confidentiality_classifications.
    8. `SELECT status, COUNT(*) FROM case_box_evidence_items WHERE matter_id = ? GROUP BY status` → evidence_items_by_status (4 buckets).
    9. `SELECT COUNT(*) FROM case_box_ocr_links WHERE matter_id = ?` → ocr_links.
  - Returns `MatterSummary` with fully-populated bucket counts (missing statuses default to 0).
  - All counts use existing per-matter indices; cost: 9 indexed counts per call. v1 lawyer-scale acceptable.

- `getDocumentDetailSqlite(db, query)` — document + 4 derived fields.
  - Matter + tenant scope.
  - Document exists check via scoped lookup `SELECT payload_json FROM case_box_documents WHERE id = ? AND matter_id = ?` — returns null on missing OR cross-matter (per rev-2 reviewer L D2#1). Tenant scope already enforced by the matter+tenant check above.
  - Compose result via **delegate-to-existing-helper** approach (per rev-1
    reviewer M D5#2 — preserves matter/tenant/document checks the
    sub-helpers already enforce; NO ad-hoc lookups):
    - `document`: parsed payload_json from `case_box_documents`.
    - `ocr_link`: **call `getOcrLinkSqlite(db, {tenant_id, matter_id, document_id})`** (B9). NOT ad-hoc SELECT.
    - `effective_classification`: **call `getEffectiveClassificationSqlite(db, {tenant_id, matter_id, target_type: "document", target_id: document_id})`** (B4).
    - `privilege_status`: **call `getPrivilegeStatusSqlite(db, {tenant_id, matter_id, target_type: "document", target_id: document_id})`** (B5).
    - `fact_candidates`: NEW query — `SELECT payload_json FROM case_box_facts WHERE matter_id = ? AND source_document_id = ? AND status = 'candidate' ORDER BY created_at ASC, id ASC`.

- `getDeadlineCalendarSqlite(db, query)` — date-range filter.
  - Matter + tenant scope.
  - `SELECT payload_json FROM case_box_deadlines WHERE matter_id = ? [AND due_at >= ?] [AND due_at <= ?] ORDER BY due_at ASC, id ASC`.
  - Returns `ReadonlyArray<CaseBoxDeadline>` (NOT paginated).

- `getFactSupersessionChainSqlite(db, query)` — walk supersession chain.
  - Matter + tenant scope.
  - Single matter-scoped SELECT to load all facts into a Map<id, fact>.
  - Walk from `query.fact_id` backward via `supersedes_fact_id` until null OR cycle (bounded by total fact count, per B6 pattern).
  - Returns `ReadonlyArray<CaseBoxFact>` in walk order.

Transaction-scope rule: all 5 are pure reads; NONE use `#runImmediateWrite`. They are NOT inside any caller transaction; better-sqlite3's `prepare().all()` / `get()` opens implicit read transactions per call.

### §1.3 `SqliteCaseBoxPersistence.ts` method impls

5 stubs → thin call-throughs:

```ts
async listMatters(query: ListMattersQuery): Promise<ListMattersPage> {
  return listMattersSqlite(this.#db, query);
}
async getMatterSummary(query: GetMatterSummaryQuery): Promise<MatterSummary | null> {
  return getMatterSummarySqlite(this.#db, query);
}
async getDocumentDetail(query: GetDocumentDetailQuery): Promise<DocumentDetail | null> {
  return getDocumentDetailSqlite(this.#db, query);
}
async getDeadlineCalendar(query: DeadlineCalendarQuery): Promise<ReadonlyArray<CaseBoxDeadline>> {
  return getDeadlineCalendarSqlite(this.#db, query);
}
async getFactSupersessionChain(query: GetFactSupersessionChainQuery): Promise<ReadonlyArray<CaseBoxFact>> {
  return getFactSupersessionChainSqlite(this.#db, query);
}
```

**Net LOC delta on `SqliteCaseBoxPersistence.ts`: estimated +12-15** (5 stubs × ~2 LOC removed; 5 thin call-throughs × ~3 LOC added). Class lands at ~614-617 LOC. **B9 D4#1 stays deferred at same band.**

### §1.4 Tests

- **`tests/sqlite.conformance.test.mjs`** — package.json `--test-name-pattern` widened with `6\\.A8\\.(?:11b|12b|12c|19b|19c|24b|[1-9]|1[0-9]|2[0-4])` + `R6\\.4`. `B10_EXPECTED_CASE_IDS` extends B9's with 31 new 6.A8.* ids + R6.4. Label `Sqlite-B9` → `Sqlite-B10`. Outside-scope updated (`6.A8.25+` → out; `6.A9.*` → B11; R6.5+ → out).

- **NEW `tests/hardening-aggregations.test.mjs`** — 4 new B10 invariant tests:
  1. **Cross-tenant matter on `getMatterSummary` → THROW `tenant_mismatch`** (per rev-1 reviewer M D1#2 + M D2#2 — matches in-memory `getMatterSummaryHelper`; do NOT return null on tenant mismatch of an existing matter). Unknown matter → null (separate case).
  2. **MatterSummary count consistency**: build a matter with **NONZERO counts in EVERY bucket** (documents + facts across all 4 status values + deadlines across all 4 + privilege markers + docket entries across all 3 confirmation_state values + classifications + evidence items across all 4 status values + ocr links) PLUS **decoy rows under a second matter / second tenant** that should NOT count. Assert each bucket matches the actual scoped row count. Per rev-1 reviewer M D5#1 — dense fixture catches matter/tenant scope-leak parity drift.
  3. **`getDocumentDetail` cross-matter document → null** (parity with in-memory).
  4. **`getFactSupersessionChain` 3-step walk** (3 facts A → B → C where B supersedes A, C supersedes B): chain returned in walk order.

- **NEW `tests/impl-parity-aggregations.test.mjs`** — 6 new B10 scenarios:
  1. `listMatters` happy path identical (2 matters; cursor + filter).
  2. `getMatterSummary` deep-equal across both impls (fully populated counts).
  3. `getDocumentDetail` deep-equal (with ocr_link + classification + privilege + fact_candidates populated).
  4. `getDeadlineCalendar` deep-equal with from/to range.
  5. `getFactSupersessionChain` deep-equal walk order.
  6. Rejection / null parity (unknown matter; cross-tenant matter).

- **`tests/impl-parity-stub-frontier.test.mjs`** — B9.0 → B10.0; next stub becomes `appendFactOnce` (B11).

- **`tests/invariants.test.mjs`** — 6.2.6b retargets `getDeadlineCalendar` → `appendFactOnce` (B11 next stub).

### §1.5 Acceptance criteria (impl WI; this plan-WI does NOT execute)

1. `npm --prefix services/case-box-persistence test` exits 0.
2. SQLite impl passes shared conformance cases `6.A8.*` (31) + R6.4.
3. The 4 B10 hardening tests pass.
4. The 6 impl-parity scenarios deep-compare across both impls.
5. All Phase A in-memory tests stay green.
6. B1-B9 SQLite tests stay green.
7. ocr-persistence + ocr-worker + case-box-contract + docs/contracts unchanged green.
8. loc-guardian: 0 over fail. `SqliteCaseBoxPersistence.ts` lands at ~614-617 LOC (B9 D4#1 same band).
9. cc-suite audit (mini) via Path 1 native `--background`: PASS or NEEDS-FIX-fixed-and-verified.

---

## §2 LOC budget per file (post-B10)

Current state (post-B9 commit `6289d89`):

| File | Current LOC | B10 estimated delta | Threshold |
|---|---|---|---|
| `src/sqlite/schema.ts` | 547 | 0 (no DDL changes) | over warn 500 (no progression) |
| `src/sqlite/SqliteCaseBoxPersistence.ts` | 602 | +12-15 (5 thin calls) → **~614-617** | OVER warn 500, under fail 800 |
| `src/sqlite/aggregationsRepoQueries.ts` (NEW) | 400-500 est. | new | source warn 500 |
| `src/sqlite/matterRepoQueries.ts` | 89 | 0 | |
| `src/sqlite/documentRepoQueries.ts` | 205 | 0 | |
| `src/sqlite/auditRepoQueries.ts` | 162 | 0 | |
| `src/sqlite/classificationRepoQueries.ts` | 361 | 0 | |
| `src/sqlite/privilegeRepoQueries.ts` | 388 | 0 | |
| `src/sqlite/factsRepoQueries.ts` | 378 | 0 | |
| `src/sqlite/docketRepoQueries.ts` | 458 | 0 | |
| `src/sqlite/deadlineRepoQueries.ts` | 233 | 0 | |
| `src/sqlite/evidenceRepoQueries.ts` | 379 | 0 | |
| `src/sqlite/ocrLinkRepoQueries.ts` | 338 | 0 | |
| `tests/sqlite.conformance.test.mjs` | 160 | +5 | test warn 700 |
| `tests/hardening-aggregations.test.mjs` (NEW) | ~150 | new | test warn 700 |
| `tests/impl-parity-aggregations.test.mjs` (NEW) | ~180 | new | test warn 700 |
| `tests/impl-parity-stub-frontier.test.mjs` | 21 | small edit | |
| `tests/invariants.test.mjs` | small edit | | |

LOC-growth-prevention posture: `SqliteCaseBoxPersistence.ts` stays in band (+12-15 LOC). `schema.ts` does NOT change (no DDL). New helper module under warn.

---

## §3 Hard-stop alignment

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED. No new dep.
- **New runtime dependency** — NOT triggered.
- **Schema migration on PERSISTED REAL DATA** — NOT triggered (no schema changes at all).
- **Public API break** — NOT triggered (B10 implements 5 EXISTING stubs).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered.
- **Cross-package boundary** — B10 stays inside `services/case-box-persistence/**`. No OCR-package dependency.
- **Push / deploy / secrets / production data** — NOT triggered.

---

## §4 Execution-discipline compliance (per `.claude/rules/execution-discipline.md`)

### §4.1 Think before coding
- WI scope: 5 method impls + 1 new SQL helper file. No schema changes. No write paths.
- Assumptions:
  - `listMattersHelper`, `getMatterSummaryHelper`, `getDocumentDetailHelper`, `getDeadlineCalendarHelper`, `getFactSupersessionChainHelper` — REUSED VERBATIM where reasonable; the SQLite paths replicate the helpers' query shapes via SELECT + JSON.parse(payload_json).
  - `getDocumentDetailSqlite` REUSES existing B4/B5/B9 helpers (getEffectiveClassificationSqlite, getPrivilegeStatusSqlite, getOcrLinkSqlite) for parity.
  - `getFactSupersessionChainSqlite` REUSES the matter-scoped fact-load pattern from B6's transition shadow state.
- Hard stops cross-checked: no triggers.

### §4.2 Simplicity first
- Smallest slice: 5 read-only methods + 1 sibling file.
- Reuse: every existing in-memory helper as a parity reference; existing SQLite helpers for sub-queries (DocumentDetail composes B4/B5/B9 results).
- No speculative abstractions.

### §4.3 Surgical changes
- WI authored file list:
  - NEW: `services/case-box-persistence/src/sqlite/aggregationsRepoQueries.ts`.
  - NEW: `services/case-box-persistence/tests/hardening-aggregations.test.mjs`.
  - NEW: `services/case-box-persistence/tests/impl-parity-aggregations.test.mjs`.
  - MODIFIED: `SqliteCaseBoxPersistence.ts` (5 stub bodies + imports); `package.json` (filter regex + label + test paths); `tests/sqlite.conformance.test.mjs`; `tests/impl-parity-stub-frontier.test.mjs` (B9.0 → B10.0); `tests/invariants.test.mjs` (6.2.6b retarget); `dev-memo/deferred-audit-findings.md` (B10 entry).
- NO drive-by refactors. `requireMatterTenant` stays duplicated (B7 L D2#1 deferred — see §5).

### §4.4 Goal-driven execution
- Acceptance criteria testable (§1.5).
- cc-suite audit via Path 1 native `--background` on impl commit.

### §4.5 Relationship to existing rules
- B10 plan does NOT bypass cc-suite review-plan (this is the review).
- B10 plan does NOT relax loc-guardian thresholds (B9 D4#1 stays at band).
- B10 plan respects autonomy hard-stops, rollback policy, night-run policy.
- B10 plan honors CCSUITE-PATH1-RCA-01 + WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01.

---

## §5 Deferred-Low handling

Per lane constraint: account for ALL existing deferred Lows.

| Finding | B10 plan position |
|---|---|
| **B9 D2#1** (read-helper duplication across sibling RepoQueries files) | B10 NATURALLY touches this surface — 5 new helpers each need matter+tenant validation. Plan picks: **continue inlining** (do NOT extract `requireMatterTenant`) — B10's new file replicates the existing pattern for consistency. **Stays deferred** with one new occurrence added to the backlog. Future extraction WI when total surface justifies a cross-file helper. |
| **B9 D4#1** (`SqliteCaseBoxPersistence.ts` 602 LOC over warn) | B10 adds +12-15 LOC; class lands at ~614-617. **Stays deferred** at same band (#runImmediateWrite extraction pattern not applicable to read-only methods, but per-call LOC growth is still small). |
| **B9 D4#2** (`schema.ts` 547 LOC over warn) | NOT touched (no DDL changes). **Stays deferred** at same LOC. |
| **B8 D2#1** (conformance regex duplication between package.json + sqlite.conformance.test.mjs) | B10 NATURALLY touches (extends with 6.A8.*). **Stays deferred**; preflight inventory continues to enforce parity. |
| **B7 L D2#1** (`requireMatterTenant` duplicated) | **NATURALLY touched** (per rev-1 reviewer L D4#1 accounting fix) — B10 adds 5 new helpers each requiring matter+tenant validation. Plan picks: continue inlining (do NOT extract in B10; matches the B9 D2#1 deferral rationale). **Stays deferred** with 5 new in-file occurrences added. |
| **B5 D1#2** (getPrivilegeStatus perf) | NOT touched. **Stays deferred**. |
| **B5 D2#1** (privilege shadow-state shim duplication) | NOT touched (no write paths in B10). **Stays deferred**. |
| **B5 D4#2** (global id scan pattern) | NOT touched (no Set lookups). **Stays deferred**. |

No deferred Low is naturally closed by B10. B9 D2#1 + B8 D2#1 + B7 L D2#1 get one additional occurrence each (read-helper + regex + matter+tenant). B9 D4#1 progresses by ~12-15 LOC.

---

## §6 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | `MatterSummary` aggregates 8 entity tables into one result. Mismatched matter+tenant scoping (e.g., one query forgets the matter filter) would produce subtle parity drift only visible at high count values. | Each sub-count query is matter-scoped via `WHERE matter_id = ?`. Tenant scope enforced ONCE up-front via matter+tenant lookup; entity tables don't carry tenant_id but are reachable only from matter (consistent with B1-B9 invariant). Impl-parity test #2 enforces deep-equal across all 8 buckets. |
| 2 | Medium | `getDocumentDetail` composes 4 sub-helper results (ocr_link, classification, privilege, fact_candidates). One sub-helper failing or returning different shape than in-memory would cascade. | Reuse existing SQLite helpers exactly (no re-implementation). Impl-parity test #3 deep-compares the entire result. |
| 3 | Medium | `getFactSupersessionChain` walks via `supersedes_fact_id` in-memory after a matter-scoped SELECT. If the matter has thousands of facts, the SELECT cost grows linearly. | v1 lawyer-scale: matters typically <500 facts (per B6 plan's threshold). Future perf WI can introduce recursive CTE. |
| 4 | Low | `listMatters` filter (status) requires the SQLite path to read `CaseBoxMatter.status` directly — via lifted column if the existing table has one, ELSE via `JSON_EXTRACT(payload_json, '$.status')`. Per §1.2 rule + rev-2 reviewer L D3#1: do NOT derive from `archived_at`. Wrong assumption breaks 6.A8 list-with-filter cases. | Verify table shape at impl time; pick the lifted-column path if it exists; otherwise JSON_EXTRACT. |
| 5 | Low | `getDeadlineCalendar` `from` / `to` are optional; query must handle 4 combinations (none / from / to / both). | Standard SQL parameterization handles this cleanly. |
| 6 | Low | `requireMatterTenant` accumulates duplication (5 new occurrences in this file). | Deferred per §5. |

No Critical / High risks.

---

## §7 cc-suite audit / verify expectations

For the impl WI (NOT this plan-WI):
- **cc-suite audit (mini)** via Path 1 native `--background` on the impl commit's scope. Expected: PASS or NEEDS-FIX with C/H/M fixed + verify.
- **cc-suite verify** ONLY if audit produces C/H/M findings the WI fixes.
- **Recording** per `.claude/rules/cc-suite.md` §"Required recording" 11-field block in the impl commit's message.
- Lows: append per-finding rows to `dev-memo/deferred-audit-findings.md` under a new "Phase B10" entry.

cc-suite execution rule per lane authorization + `.claude/rules/cc-suite.md` §"Background-invocation discipline": **NEVER** wrap the runner in Claude Code Bash `run_in_background: true`. Use runner foreground OR runner native `--background` flag.

---

## §8 References

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B10.
- B1-B9 plans + impls.
- CCSUITE-PATH1-RCA-01 (`d3e1cbc`).
- WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01 (`8d3bb0b`).
- `services/case-box-persistence/src/inMemoryAggregations.ts` (behavioral target).
- `services/case-box-persistence/src/sqlite/*` (existing sibling helpers).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` lines for 6.A8.* + R6.4.
- B9 audit `audit-mphx2ods-qf6qsv` deferred Lows D2#1 / D4#1 / D4#2.
- `.claude/rules/cc-suite.md`, `echo-sleuth.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

---

## §9 Stop condition

This plan is stale or superseded when:
- B10 impl commits — plan transitions to "superseded by B10 impl commit `<hash>`".
- Umbrella plan revision changes B10 scope.
- An in-memory aggregation helper contract changes.
