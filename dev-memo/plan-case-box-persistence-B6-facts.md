# Plan: CASE-BOX-PERSISTENCE B6 — SQLite facts persistence

**Status**: READY (revision 3 — Path-2 rev-3 review returned READY (Low-risk clarifications). 3 rev-2 Mediums closed in rev-3. One rev-3 Low applied opportunistically (hard-stop wording on schema migration semantics clarified — `:memory:` test DBs and fresh on-disk DBs are not "real persisted data"). Two acknowledged Lows: matter-scoped cycle walk O(N) at large matters (already governed by 500-facts threshold trigger) and SqliteBackedIdSet helper-signature dependency (already governed by explicit fallback path).).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Umbrella plan**: `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (READY at commit `1ac26b1`) §2 row B6.
**Predecessors**: ABI gate (`d02fff8`); B1 (`601d74c`); B2 (`6b5d5f6`); B3 (`5400637`); B4 (`bb285ca`); B5 (`fcfc816`); execution-discipline floor (`9c0966f`).
**Lane**: NIGHT-RUN-SQLITE-B6-PLAN (planning only; no implementation).
**Risk**: HIGH (persistence + multi-row supersession invariants + cycle-detection algorithm).

## Review packet (compact)

### Active plan summary

B6 is the SIXTH SQLite sub-WI of Phase B. It implements **facts** persistence on top of B1-B5 infrastructure. Four methods convert from `not_implemented` stubs to real implementations:

- **`appendFact(input)`** — append. Reuses EXPORTED `prepareAppendFact` from `inMemoryFact.ts` via a shadow `FactState` shim. Status must be `"candidate"`.
- **`transitionFact(factId, opts)`** — transition (UPDATE in place + audit emit). Reuses `prepareTransitionFact`. Includes accepted-fact supersession (new-row relationship per Step 2 ADR §3) + supersession-graph cycle detection (helper walks `factById` chain).
- **`getFact(query)`** — pure read by id (scoped to tenant + matter).
- **`listFacts(query)`** — paginated read.

`appendFactOnce` is OUT of B6 scope (Phase B11 per umbrella). `getFactSupersessionChain` is OUT of B6 scope (Phase B10 read-aggregations).

B6 adds schema **v5**: `case_box_facts` table + 3 indices supporting per-matter list seek + supersession-chain walks.

**LOC-growth prevention** (per lane constraint): B5's `#runImmediateWrite` + `#writeAudit` private helpers in `SqliteCaseBoxPersistence.ts` already absorb the transaction + audit-chain boilerplate. B6's 4 method bodies will be 3-line calls into the new `factsRepoQueries.ts` sibling file. `SqliteCaseBoxPersistence.ts` is currently at 563 LOC (over warn 500); B6 estimated to add **net ZERO** to the class (4 stubs → 4 thin calls), keeping the file at ~563. Plan does NOT undertake broad refactor; the in-flight extraction debt (B5 D4#1) stays deferred.

Plan is plan-only: no code, no schemas, no package edits.

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-B6-facts.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/**`.
- `docs/contracts/case-box-contract/**`.
- Any OCR package.
- AGENTS.md.
- Umbrella / B1..B5 plans.
- `dev-memo/plan-case-box-persistence-00.md`.

### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. Plan enumerates B6 scope per umbrella §2 row B6 verbatim + expands into a concrete impl-WI shape.
3. Plan defines schema v5 DDL: one new table + 3 indices.
4. Plan declares the conformance label filter regex (extends B5 with `6.A4.1`..`6.A4.28` incl. variants + R5.15).
5. Plan declares hardening invariants (5+ including cycle detection).
6. Plan declares HARD-STOP categories that DO and DO NOT trigger.
7. Plan declares LOC budget per touched file + **LOC-growth-prevention strategy** for `SqliteCaseBoxPersistence.ts`.
8. Plan declares cc-suite audit + verify expectations for the impl WI.
9. Plan declares execution-discipline compliance per `.claude/rules/execution-discipline.md`.
10. Plan addresses each of B5's 4 deferred Lows (D1#2 perf; D2#1 shadow-state dup; D4#1 LOC; D4#2 global id scans) — naturally fix if B6 touches the area, else preserve deferred status.
11. cc-suite review-plan returns READY (or only Low-risk clarifications).

### Exact out-of-scope list (B6; deferred to B7+)

- **No B7+ entities** (docket entries, deadlines, evidence items, OCR links, aggregations, Once writers).
- **`appendFactOnce`** is B11 (replay-safe Once variants). Stays `not_implemented` after B6.
- **`getFactSupersessionChain`** is B10 (read-side aggregations). Stays `not_implemented` after B6.

### §"Umbrella-divergence note" (per rev-1 reviewer M D1#1 + M D4#1)

Umbrella plan §2 row B6 acceptance text reads: `Conformance 6.A4.* + R5.15..R5.18 pass.` This is INTERNALLY CONTRADICTORY with umbrella row B11 which assigns `appendFactOnce` (+ `upsertOcrLink`) to B11. R5.16, R5.17, R5.18 all test `appendFactOnce` — they CANNOT pass under B6 because the method is `not_implemented` until B11.

**B6 plan's resolution**:
- B6 owns conformance `6.A4.*` (32 cases) + **R5.15 only** (the appendFact / getFact / listFacts case).
- R5.16, R5.17, R5.18 stay OUT until B11. The B6 conformance regex EXCLUDES them.
- A follow-up docs-only WI amends umbrella row B6 acceptance from `R5.15..R5.18` to `R5.15` and confirms R5.16..R5.18 ownership in row B11. NOT bundled with B6 impl.

The B6 impl WI passes `R5.15` and shows `R5.16..R5.18` continue to skip under the B6 filter; the umbrella amendment is the canonical reconciliation.
- **No new write surfaces beyond the 4 fact methods.**
- **No public-API change** (B6 implements 4 EXISTING interface methods).
- **No new top-level dep.**
- **No real-data migration.**
- **No API / UI / mini-program / auth / cloud / sync / LLM / OCR runtime changes.**
- **No broad refactor** of `SqliteCaseBoxPersistence.ts` beyond B5's `#runImmediateWrite` pattern. B5 deferred Lows that require structural refactor stay deferred unless B6 naturally touches them.
- **No git push.**
- **No committed rollback.**

### Essential references

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B6 (umbrella spec: "Facts (Phase A4 SQLite mirror) including supersession-graph cycle detection + R-5 fact (`purpose` enum + `as_of_date`).").
- `services/case-box-persistence/src/inMemoryFact.ts` — behavioral target: `prepareAppendFact`, `prepareTransitionFact`, `listFacts`, `applyAppendFact`, `factCanonicalProjection` (B11 future), `_tamperFactSupersedesForTest` (tamper seam for 6.A4.22 cycle test).
- `services/case-box-persistence/src/resolveTarget.ts` — `resolveDocumentTarget` (reused for source_document_id resolution).
- `services/case-box-persistence/src/inMemoryRepo.ts` lines 422..489 — fact method call sites.
- `services/case-box-persistence/src/cursor.ts` — `kind: "facts_by_matter"` already declared.
- `services/case-box-persistence/src/sqlite/schema.ts` — extend `DDL_BY_VERSION` with v5.
- `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` — convert 4 stubs via `#runImmediateWrite`.
- `services/case-box-persistence/src/sqlite/{matter,document,audit,classification,privilege}RepoQueries.ts` — sibling-file precedent.
- `services/case-box-persistence/src/sqlite/documentRepoQueries.ts` — `validateDocumentTarget` shared helper (potentially reused for source_document_id).
- `docs/contracts/case-box-contract/src/case-box-fact*.ts` — `assertValidNewFact`, `assertValidFactTransition`, `assertFactPromotionInvariants`, `validateFact`.
- `docs/adr/case-box-step-2-fact-supersession-model.md` (if exists; Step 2 ADR §3 = supersession invariants).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — B6 cases `6.A4.1`..`6.A4.28` (incl. `10b`, `10c`, `27b`, `27c`) + R5.15 (32 + 1 = 33 cases).
- B5 audit `audit-mpgzx0ka-r4jne5` deferred Lows D1#2, D2#1, D4#1, D4#2.
- `.claude/rules/cc-suite.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

### Review questions for the reviewer

1. **Cycle detection approach**: load all matter facts into shadow state (mirror in-memory; cycle walk bounded by total fact count) vs SQL recursive CTE (`WITH RECURSIVE chain AS ...`)? Plan picks **shadow-state approach** for behavioral parity with B5 + reuse of `prepareTransitionFact`. SQL recursive CTE deferred to a future perf WI if v1 scales beyond expected.

2. Should schema v5 lift `source_document_id`, `purpose`, `as_of_date`, `supersedes_fact_id` as columns? Plan picks **YES** for all four — supersession-graph walks need `supersedes_fact_id` indexed; per-matter list filters use `purpose`; `as_of_date` is a query-friendly date string; `source_document_id` enables document → facts lookups.

3. Should `case_box_facts.source_document_id` be FK to `case_box_documents.id`? Plan picks **NO FK** per the consistent posture (B1-B5). Application-layer enforcement via `resolveDocumentTarget` (which validates same-matter + same-tenant) inside the transaction.

4. Should the **6.A4.22 tamper test** translate to SQLite? The in-memory test uses `_tamperFactSupersedesForTest` to inject a 2-cycle via the internal state. SQLite equivalent: direct UPDATE on `case_box_facts.payload_json` + lifted `supersedes_fact_id` column to inject a cycle, then call `transitionFact`. Plan picks **YES** — the SQLite equivalent is the row-mutation analog of B3's tamper detection (B3 plan §1.5).

5. **Index design for cycle detection**: the shadow-state walk loads all matter facts; the SQL SELECT is `SELECT id, supersedes_fact_id FROM case_box_facts WHERE matter_id = ?`. The matter_id index suffices. No separate supersession-chain index needed (the shadow walk does the traversal in JS once the rows are loaded).

6. Is the conformance label filter regex correct? Plan picks `^Sqlite-B6: (?:6\.1\.(?:13a|26-27|[1-9]|1[0-5]|1[6-9]|2[0-8]|29|30|31|3[2-8])|6\.A2\.(?:9a|9b|[1-9]|1[0-9]|2[0-4])|6\.A3\.(?:A2b|20b|21b|[1-9]|1[0-9]|2[0-7])|6\.A4\.(?:10b|10c|27b|27c|[1-9]|1[0-9]|2[0-8])|R5\.(?:[1-9]|9b|1[0-4])|R5\.15|R6\.[1-3])(?:\s|$)` — extends B5 with `6.A4.*` (32 cases) + `R5.15` (1 case). 33 new cases total. R5.16..R5.18 stay OUT (use appendFactOnce, B11).

7. Should B6 naturally touch B5 deferred Lows? Analysis below:
   - **D1#2 (getPrivilegeStatus perf)**: NOT touched by B6 (privilege code unchanged). Stays deferred.
   - **D2#1 (privilege shadow-state shim duplication)**: NOT touched by B6 (privilege code unchanged). Stays deferred.
   - **D4#1 (SqliteCaseBoxPersistence.ts LOC 563)**: B6 adds 4 method bodies (net zero with the `#runImmediateWrite` pattern). Class size stays roughly 563. Stays deferred at the same LOC.
   - **D4#2 (global id scan scaling pattern)**: B6's shadow state for facts COULD repeat the pattern (`SELECT id FROM case_box_facts` globally). Plan picks **scoped, NOT global**: `factIds`, `factIndex`, `factById` are MATTER-scoped (facts can't cross matters per Step 2 ADR + 6.A4.22 + 6.A4.25). The in-memory helper uses GLOBAL `factIds` BUT only for duplicate-id check; matter-scoped loading suffices for B6 if the shim mirrors only what each prepare-helper actually reads. Plan picks **GLOBAL factIds** (same shape as B4/B5 for consistency with `FactState.factIds` invariant) but matter-scoped `factsByMatter`/`factIndex`/`factById`. Notes: this RE-INTRODUCES the global-id-scan pattern flagged by D4#2 — accepted as Phase-B debt; deferred fix recorded.

---

## §1 B6 scope (verbatim from umbrella + expanded)

### §1.1 Schema v5

CURRENT_SCHEMA_VERSION 4 → 5. v1-v4 NOT modified.

`DDL_STATEMENTS_V5` adds:

```sql
CREATE TABLE IF NOT EXISTS case_box_facts (
  id                       TEXT    PRIMARY KEY,
  tenant_id                TEXT    NOT NULL,
  matter_id                TEXT    NOT NULL,
  source_document_id       TEXT,
  source_type              TEXT    NOT NULL,
  status                   TEXT    NOT NULL,
  purpose                  TEXT,
  as_of_date               TEXT,
  supersedes_fact_id       TEXT,
  created_at               TEXT    NOT NULL COLLATE BINARY,
  payload_json             TEXT    NOT NULL
);

-- Per-matter chronological list seek (ORDER BY created_at ASC, id ASC).
CREATE INDEX IF NOT EXISTS idx_case_box_facts_by_matter_seek
  ON case_box_facts (matter_id, created_at ASC, id ASC);

-- Filtered list seek. Filter keys per `ListFactsQuery`:
-- status / source_type / source_document_id (rev-1 reviewer M D2#2:
-- previously the plan omitted source_type; corrected). `purpose` is
-- NOT a list filter at v1; lifted as a column for future expansion
-- but the seek index does not need to lead with it.
CREATE INDEX IF NOT EXISTS idx_case_box_facts_by_matter_filter_seek
  ON case_box_facts (matter_id, status, source_type, source_document_id, created_at ASC, id ASC);

-- Supersession-chain walk + supersedes_fact_id reverse lookups.
CREATE INDEX IF NOT EXISTS idx_case_box_facts_by_supersedes
  ON case_box_facts (matter_id, supersedes_fact_id, id);
```

R-5 fact fields (`purpose`, `as_of_date`) lifted as columns. Step-2 supersession field (`supersedes_fact_id`) lifted. `source_document_id` lifted for document→facts reverse lookup. `payload_json` is canonical.

**No FK constraints** (consistent with B1-B5).

### §1.2 New file: `factsRepoQueries.ts` (~250-300 LOC estimated)

Mirrors `{matter,document,audit,classification,privilege}RepoQueries.ts` shape. Exports:

- `applyAppendFactSqlite(db, input, deps)` — transaction-wrapping append. Shadow state shim builds `FactState` with:
  - `factIds: Set<string>` — narrower path per rev-1 reviewer M D4#2. **B6 plan picks targeted existence check, NOT global scan.** Implementation strategy:
    - Define a `SqliteBackedIdSet` class implementing `.has(id)` (SQL `SELECT 1 FROM case_box_facts WHERE id = ?`) and `.add(id)` (in-memory tracking of THIS transaction's newly-added ids only, to support `prepareAppendFact`'s in-process state mutation). Read-only methods like `.size` throw or return 0 (the helper does NOT read size).
    - Inspect `inMemoryFact.ts` `prepareAppendFact` at impl time to confirm the helper only calls `.has(id)` + `.add(id)`. If it reads `.size` / iterates, fall back to GLOBAL scan + re-flag D4#2.
    - Effect: per-append cost drops from `O(N) SELECT id FROM case_box_facts` to a single indexed PK lookup. The pattern flagged by D4#2 is no longer reintroduced; backlog entry for D4#2 stays at the existing 2 occurrences (B4 classifications + B5 privileges), not 3.
  - Matter-scoped `factsByMatter: Map<matterId, CaseBoxFact[]>` for the matter being appended.
  - Matter-scoped `factIndex: Map<factId, matterId>` for the same matter.
  - Matter-scoped `factById: Map<factId, CaseBoxFact>` for the same matter.
  Calls `prepareAppendFact` from in-memory.

- `applyTransitionFactSqlite(db, factId, opts, deps)` — transaction-wrapping transition.
  - Look up the fact's matter_id via **targeted** `SELECT matter_id FROM case_box_facts WHERE id = ?` (per rev-2 reviewer M D3#1; previously the plan said "global `SELECT id, matter_id FROM case_box_facts`" which was an O(N) scan). Single indexed PK lookup.
  - Load ALL facts for the resolved matter into `factsByMatter` + `factById` so the cycle walk can traverse `supersedes_fact_id`. Matter-scoped `SELECT * FROM case_box_facts WHERE matter_id = ?`.
  - Populate `factIndex` for those matter facts only (1 entry per fact in the matter; NOT global).
  - For `factIds` Set: same `SqliteBackedIdSet` strategy as append (PK lookup). Or, since transition only mutates an existing fact and does not check for duplicate-new-id, the Set may not be read at all by `prepareTransitionFact` — confirm at impl time and pick the minimal shim.
  - Calls `prepareTransitionFact` (which does the cycle walk).
  - On success: UPDATE the fact row in place (status + supersedes_fact_id + payload_json).

- `getFactSqlite(db, query)` — pure read. SELECT by id; verify tenant + matter scope at the persistence layer.

- `listFactsSqlite(db, query)` — paginated read with optional filters: `status`, `source_type`, `source_document_id` (per `ListFactsQuery` type in `services/case-box-persistence/src/types.ts`; rev-1 reviewer M D2#2 caught the missing `source_type` filter). NOTE: `purpose` is NOT a `ListFactsQuery` filter at the type level — it's lifted as a column for future filter expansion but the v1 list API exposes only `status` / `source_type` / `source_document_id`. ORDER BY created_at ASC, id ASC. Shared cursor utility.

### §1.3 `SqliteCaseBoxPersistence.ts` method impls

4 stubs → impls via `#runImmediateWrite`:

```ts
async appendFact(input: unknown): Promise<CaseBoxFact> {
  const row = this.#runImmediateWrite((db, deps) => applyAppendFactSqlite(db, input, deps));
  return structuredClone(row) as CaseBoxFact;
}
async transitionFact(factId: string, opts: FactTransitionOpts): Promise<CaseBoxFact> {
  const row = this.#runImmediateWrite((db, deps) => applyTransitionFactSqlite(db, factId, opts, deps));
  return structuredClone(row) as CaseBoxFact;
}
async getFact(query: GetFactQuery): Promise<CaseBoxFact | null> {
  return getFactSqlite(this.#db, query);
}
async listFacts(query: ListFactsQuery): Promise<ListFactsPage> {
  return listFactsSqlite(this.#db, query);
}
```

**Net LOC delta on `SqliteCaseBoxPersistence.ts`: ~0** (4 stubs × ~2 LOC = ~8 LOC removed; 4 thin calls × ~3 LOC = ~12 LOC added; net +4 LOC). Class stays ~567 LOC. B5 D4#1 deferred Low stays deferred at the same LOC.

### §1.4 Supersession-graph cycle detection

`prepareTransitionFact` (in-memory) walks `state.factById.get(opts.supersedes_fact_id)` following `.supersedes_fact_id` pointers, bounded by total fact count.

For SQLite: the shadow state's `factById` is populated from `SELECT id, payload_json FROM case_box_facts WHERE matter_id = ?` (matter-scoped; facts can't cross matters per 6.A4.25). The walk traverses in-memory. Cost: O(matter fact count) per transition; v1 lawyer-scale acceptable.

**Cycle injection test (6.A4.22 SQLite equivalent)**: per §"Review questions" #4. Plan picks YES — add a hardening test that directly UPDATEs `case_box_facts.supersedes_fact_id` (column) + `payload_json` to inject a 2-cycle, then verifies `transitionFact` returns `invalid_argument` with the cycle-detection error. Mirrors B3's payload-tamper hardening pattern.

### §1.5 R-5 fact fields

`purpose` (enum: `chronology` / `claim_element` / `defense_element` / etc.) + `as_of_date` (ISO date-like free-text). Both lifted to columns; carried in `payload_json` canonically.

R5.15 conformance test: `appendFact` + `getFact` + `listFacts` preserve `purpose` + `as_of_date`. SQLite impl must round-trip both fields verbatim.

R5.16..R5.18 use `appendFactOnce` (B11 scope) — NOT in B6.

### §1.6 Tests

- **`tests/sqlite.conformance.test.mjs`** — package.json `--test-name-pattern` widened for `6.A4.*` + `R5.15`. `B6_EXPECTED_CASE_IDS` extends `B5_EXPECTED_CASE_IDS` with 33 new ids. Label `Sqlite-B5` → `Sqlite-B6`. Outside-scope updated (`6.A5+` is B7+; `6.A9+` is B11; `R5.16+` is B11).

- **`tests/sqlite.hardening.test.mjs`** — 5+ new B6 invariant tests:
  1. **Cross-tenant source_document_id rejected** → `tenant_mismatch`.
  2. **Cross-matter source_document_id rejected** → `matter_id_mismatch`.
  3. **Supersession cycle detected via direct row mutation** → `invalid_argument` with cycle error (SQLite equivalent of 6.A4.22).
  4. **Audit-chain atomic** event_count == COUNT == MAX(seq) == N after a 5-event sequence (matter + doc + fact + transition + acceptedFactSupersession).
  5. **Row UPDATE-in-place on transition** — single row per fact (not append-only).
  6. **R-5 fact field round-trip**: `purpose` + `as_of_date` preserved across append → SELECT → getFact (separate from the conformance R5.15 to lock SQLite-specific persistence path).

- **`tests/impl-parity.test.mjs`** — 6+ new B6 scenarios:
  1. `appendFact` happy path identical.
  2. `appendFact` with `purpose` + `as_of_date` identical (R-5 parity).
  3. `transitionFact` candidate → accepted identical.
  4. `transitionFact` candidate → rejected identical.
  5. `transitionFact` accepted-fact supersession (Step 2 ADR §3) identical.
  6. `getFact` + `listFacts` identical (incl. filter + multi-page cursor parity).
  7. Rejection parity (cross-tenant; cross-matter source doc; unknown fact transition; cycle).

- **`tests/invariants.test.mjs`** — 6.2.6b retargets `appendFact` (now B6-implemented) → next stub frontier. Options: `appendDocketEntry` (B7) or `appendEvidenceItem` (B8). Plan picks `appendDocketEntry` (chronological next).

### §1.7 Acceptance criteria (impl WI; this plan-WI does NOT execute)

1. `npm --prefix services/case-box-persistence test` exits 0 with B6 conformance + R5.15 + B6 hardening + parity running under `Sqlite-B6` label.
2. SQLite impl passes shared conformance cases `6.A4.1`..`6.A4.28` (incl. variants) + `R5.15`.
3. The 6 hardening tests pass.
4. impl-parity tests deep-compare across both impls.
5. All Phase A in-memory tests stay green.
6. B1-B5 SQLite tests stay green.
7. ocr-persistence + ocr-worker + case-box-contract + docs/contracts unchanged green.
8. loc-guardian: 0 over fail. `SqliteCaseBoxPersistence.ts` stays roughly 563-567 LOC (B5 D4#1 stays deferred at this LOC level).
9. cc-suite audit (mini) PASS or NEEDS-FIX-fixed-and-verified.

---

## §2 LOC budget per file (post-B6)

Current state (post-B5 commit `fcfc816`):

| File | Current LOC | B6 estimated delta | Threshold |
|---|---|---|---|
| `src/sqlite/schema.ts` | 340 | +40 (DDL_V5) | source warn 500 |
| `src/sqlite/SqliteCaseBoxPersistence.ts` | 563 | +4 (4 thin calls; OVER warn 500) | warn 500 / fail 800 |
| `src/sqlite/matterRepoQueries.ts` | 89 | 0 | |
| `src/sqlite/documentRepoQueries.ts` | 205 | 0 | |
| `src/sqlite/auditRepoQueries.ts` | 162 | 0 | |
| `src/sqlite/classificationRepoQueries.ts` | 361 | 0 | |
| `src/sqlite/privilegeRepoQueries.ts` | 388 | 0 | |
| `src/sqlite/factsRepoQueries.ts` (NEW) | 250-300 est. | new | |
| `tests/sqlite.conformance.test.mjs` | 122 | +5 | test warn 700 |
| `tests/sqlite.hardening.test.mjs` | 556 | +100 (6 tests) | test warn 700 |
| `tests/impl-parity.test.mjs` | 649 | +150 (7 scenarios) | test warn 700 |

**LOC-growth-prevention** posture (per lane constraint): `SqliteCaseBoxPersistence.ts` stays roughly the same (+4 LOC). New SQL helpers extracted to `factsRepoQueries.ts`. Tests grow under their warn thresholds.

`impl-parity.test.mjs` post-B6 estimated ~800 LOC — APPROACHES the 700 warn threshold. If hit, split impl-parity tests into per-entity files (e.g., `impl-parity-facts.test.mjs`). NOT a B6 hard requirement; flag for the next sub-WI.

---

## §3 Hard-stop alignment

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED. No new dep.
- **New runtime dependency** — NOT triggered.
- **Schema introduction on persisted data** — NOT triggered. (B6 DOES add schema v5 to the SQLite migration ladder; the hard-stop refers to "schema migration on REAL persisted data" per `.claude/rules/autonomy.md` §"Hard-stop list" — `:memory:` test DBs and fresh on-disk DBs are not real production data. Per rev-3 reviewer D5#1 clarification.)
- **Public API break** — NOT triggered (B6 implements 4 EXISTING stubs).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered.
- **Push / deploy / secrets / production data** — NOT triggered.

Per the no-revert posture: fix-forward; STOP-FOR-ROLLBACK if necessary.

---

## §4 Execution-discipline compliance (per `.claude/rules/execution-discipline.md` commit `9c0966f`)

### §4.1 Think before coding
- WI scope: 4 method impls + 1 new SQL helper file + schema v5 + test extensions. Out-of-scope list explicit.
- Assumptions:
  - `prepareAppendFact` and `prepareTransitionFact` REUSED VERBATIM via shadow `FactState` shim.
  - Cycle detection walks in-memory after loading all matter facts (matter-scoped per Step 2 ADR; cross-matter supersession rejected by helper at 6.A4.25).
  - `appendFactOnce` stays `not_implemented` (B11); `getFactSupersessionChain` stays `not_implemented` (B10).
- Hard stops cross-checked: no triggers.
- Ambiguity routed: this plan IS the ambiguity-resolution channel; cc-suite review-plan loop runs before any impl.

### §4.2 Simplicity first
- Smallest slice: 4 methods + 1 sibling file + 1 schema version.
- Reuse: `prepareAppendFact` + `prepareTransitionFact` + `validateFact` + `assertValidFactTransition` + `assertFactPromotionInvariants` + `assertValidNewFact` (contract) + `resolveDocumentTarget` + `listFacts` (in-memory list helper, called directly from shadow state for behavioral parity), `eventHashFn`, shared cursor utility, `#runImmediateWrite`, `#writeAudit`, `validateDocumentTarget`.
- No speculative abstractions: NO recursive CTE for cycle detection (deferred), NO new SQL macros, NO custom supersession-chain query optimizer.
- LOC extraction is MECHANICAL: new sibling matches existing pattern.

### §4.3 Surgical changes
- WI authored file list:
  - NEW: `services/case-box-persistence/src/sqlite/factsRepoQueries.ts`.
  - MODIFIED: `services/case-box-persistence/src/sqlite/schema.ts` (DDL_V5 + CURRENT_SCHEMA_VERSION bump); `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` (4 stub bodies + imports); `services/case-box-persistence/package.json` (filter regex + label); `services/case-box-persistence/tests/sqlite.conformance.test.mjs`; `services/case-box-persistence/tests/sqlite.hardening.test.mjs`; `services/case-box-persistence/tests/impl-parity.test.mjs`; `services/case-box-persistence/tests/invariants.test.mjs` (6.2.6b retarget); `dev-memo/deferred-audit-findings.md` (B6 entry if Lows deferred; B5 entries unchanged since B6 doesn't naturally touch).
- No drive-by refactors. No broad changes to `SqliteCaseBoxPersistence.ts` beyond the 4 stub conversions.

### §4.4 Goal-driven execution
- Acceptance criteria testable (§1.7).
- New tests fail BEFORE impl (`not_implemented` stubs); pass AFTER.
- cc-suite audit on impl commit; verify if fixes applied.
- Do NOT commit until acceptance passes.

### §4.5 Relationship to existing rules
- B6 plan does NOT bypass cc-suite review-plan (this is the review).
- B6 plan does NOT relax loc-guardian thresholds.
- B6 plan respects autonomy hard-stops, rollback policy, night-run policy, execution-discipline floor.

---

## §5 B5 deferred-Low handling

Per lane constraint: account for B5 deferred Lows.

| Finding | B6 plan position |
|---|---|
| **B5 D1#2** (getPrivilegeStatus loads all matter markers — perf) | NOT touched by B6. Privilege code unchanged. **Stays deferred**. |
| **B5 D2#1** (privilege shadow-state shim duplication) | NOT touched by B6. Privilege code unchanged. **Stays deferred**. |
| **B5 D4#1** (`SqliteCaseBoxPersistence.ts` LOC 563 over warn) | B6 adds ~4 LOC to the class (4 thin calls via `#runImmediateWrite`). Class stays at ~567 LOC. **Stays deferred** at roughly the same LOC. |
| **B5 D4#2** (global id scan pattern) | B6 plan rev-2 picks the **narrow alternative** path per rev-1 reviewer recommendation: `SqliteBackedIdSet` class for `factIds` (targeted PK existence check via SQL, not global scan). Pattern is NOT re-introduced; D4#2 backlog stays at the existing 2 occurrences (B4 + B5). If at impl time the `prepareAppendFact` helper reads `.size` / iterates `factIds` (signature check), fall back to global scan + re-flag D4#2 with 3rd occurrence. **Stays deferred** for B4/B5 occurrences. |

No B5 deferred Low is naturally fixed by B6. All 4 stay deferred. B6 impl will append a new "Phase B6" entry to `dev-memo/deferred-audit-findings.md` for any new B6 Lows discovered during audit.

---

## §6 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Cycle-detection algorithm in `prepareTransitionFact` is bounded by total matter fact count. If a matter has thousands of facts, the per-transition cost is O(N). | v1 lawyer-scale: matters typically have tens-to-hundreds of facts. Acceptable. **Threshold trigger (per rev-1 reviewer M D5#1)**: if any production matter exceeds **500 facts**, open a dedicated perf WI to introduce SQL recursive CTE traversal or topological-order check on the indexed `supersedes_fact_id` field. Future-WI definition: `WI-fact-cycle-perf-01`. |
| 2 | Medium | Tamper test for 6.A4.22 mutates `case_box_facts.payload_json` + lifted `supersedes_fact_id` column. If the SQLite UPDATE doesn't sync both, the cycle walk reads the unmutated payload and misses the cycle. | Hardening test re-SELECTs both fields after UPDATE to confirm the mutation persisted before calling `transitionFact`. Mirrors B3 tamper-test discipline. |
| 3 | Medium | Cursor pagination drift (recurring risk from B2/B3/B5). | Shared `encodeCursor`/`decodeCursor`/`computeFiltersHash` + impl-parity test asserting byte-identical `next_cursor` across multi-page traversal. |
| 4 | Low | Schema v5 DDL has 3 indices; SQLite query planner picks the right one for each query shape. Mixed filter index `(matter_id, status, source_type, source_document_id, created_at ASC, id ASC)` may be too wide if v1 actually uses only `status` filter (corrected per rev-2 reviewer M D2#1: previously listed `purpose` instead of `source_type`). | Plan picks the wide-filter index for now; future WI can split if EXPLAIN QUERY PLAN reveals suboptimal walks. Not a B6 blocker. |
| 5 | Low | B6 plan adds 1 to the "matter-scoped facts loaded for cycle detection" cost. If v1 grows to ~10K facts per matter, the SELECT for cycle walk gets slow. | Same v1 assumption as risk #1. Future WI can switch to SQL recursive CTE for the walk. |
| 6 | Low | `impl-parity.test.mjs` post-B6 estimated 800 LOC — approaching 700 warn. | **MANDATORY** in next sub-WI (B7) if the file crosses the 700-LOC warn threshold (per rev-1 reviewer M D5#3): split into per-entity test files (e.g., `impl-parity-facts.test.mjs`, `impl-parity-matter.test.mjs`). NOT a B6 scope item; B6 must record this as a B7 mandatory pre-impl extraction in the B6 impl commit if the threshold is crossed. |
| 7 | Low | B6 plan rev-2 picks the `SqliteBackedIdSet` targeted-PK-existence approach for `factIds` (per rev-1 reviewer M D4#2). The shadow-state shim DOES NOT re-introduce the global scan IF the `prepareAppendFact` helper signature only calls `.has(id)` + `.add(id)` (no `.size` / iteration). The impl WI MUST verify this against `inMemoryFact.ts` `prepareAppendFact` before committing the SqliteBackedIdSet approach. **Fallback path** (per rev-2 reviewer M D4#1 reconciliation): if the helper signature mismatch forces fallback to global scan, B6 impl explicitly RE-FLAGS D4#2 with a third occurrence in `dev-memo/deferred-audit-findings.md`. Otherwise D4#2 stays at 2 occurrences (B4 + B5). |

No Critical / High risks.

---

## §7 cc-suite audit / verify expectations

For the impl WI (NOT this plan-WI):
- **cc-suite audit (mini)** on the impl commit's scope. Expected: PASS or NEEDS-FIX with C/H/M fixed + verify in same commit.
- **cc-suite verify**: only if audit produces C/H/M findings the WI fixed.
- **Recording**: per `.claude/rules/cc-suite.md` §"Required recording" 11-field block in the impl commit's message body.
- Lows: append per-finding rows to `dev-memo/deferred-audit-findings.md` under a new "Phase B6" entry.

---

## §8 References

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (umbrella; READY at `1ac26b1`).
- B1-B5 plans + impls (`9cf03d3`/`601d74c`, `6f0540e`/`6b5d5f6`, `afe607b`/`5400637`, `878977b`/`bb285ca`, `fcfc816`).
- execution-discipline (`9c0966f`).
- `services/case-box-persistence/src/inMemoryFact.ts` (behavioral target).
- `services/case-box-persistence/src/resolveTarget.ts` (`resolveDocumentTarget`).
- `services/case-box-persistence/src/cursor.ts` (`kind: "facts_by_matter"`).
- `services/case-box-persistence/src/sqlite/{schema,SqliteCaseBoxPersistence,matterRepoQueries,documentRepoQueries,auditRepoQueries,classificationRepoQueries,privilegeRepoQueries}.ts`.
- `docs/contracts/case-box-contract/src/case-box-fact*.ts` (Step-2 contract).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` lines for 6.A4.* + R5.15.
- B5 audit job `audit-mpgzx0ka-r4jne5` deferred Lows.
- `.claude/rules/cc-suite.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

---

## §9 Stop condition

This plan is stale or superseded when:
- B6 impl commits — plan transitions to "superseded by B6 impl commit `<hash>`".
- Umbrella plan revision changes B6 scope.
- `prepareAppendFact` / `prepareTransitionFact` contract semantics change.
