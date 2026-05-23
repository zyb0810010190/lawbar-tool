# Plan: CASE-BOX-PERSISTENCE B9 — SQLite OCR links (read-only mirror by value)

**Status**: READY (revision 3 — Path 1 native --background rev-2 review returned NEEDS-FIX with 1 residual High ("§1.5 still says `6\\.A7\\.*` while §Review questions has the alternation"); rev-3 aligns §1.5 wording with the explicit alternation. All earlier rev-1 fixes remain landed: regex alternation, Option A only, DESC sort, 6-step getOcrLinkSqlite parity, audit-undefined early return, row-immutability hardening assertion.).
**Date**: 2026-05-23.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Umbrella plan**: `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (READY at `1ac26b1`) §2 row B9.
**Predecessors**: ABI gate (`d02fff8`); B1 (`601d74c`); B2 (`6b5d5f6`); B3 (`5400637`); B4 (`bb285ca`); B5 (`fcfc816`); B6 plan + impl (`8fe0b04`, `667bb9c`); B7 plan + impl (`adae300`, `69db974`); B8 plan + impl (`767f1a4`, `bfda127`); CCSUITE-PATH1-RCA-01 (`d3e1cbc`); WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01 (`8d3bb0b`); execution-discipline (`9c0966f`).
**Lane**: NIGHT-RUN-SQLITE-B9-PLAN (planning only; no implementation).
**Risk**: MEDIUM. B9 is a single-table read-only-by-value mirror. Two distinguishing features vs B6/B8: (a) the table is keyed by `document_id` (NOT `id`) — there is one OCR-link row per document, upserted in place; (b) the helper uses an idempotent byte-identical-replay preflight that short-circuits BEFORE any audit emission.

## Review packet (compact)

### Active plan summary

B9 is the NINTH SQLite sub-WI of Phase B. It implements **OCR links** (Phase A7 mirror) on top of B1-B8 infrastructure. Three interface methods convert from `not_implemented` stubs to real impls:

- **`upsertOcrLink(input)`** — upsert by document_id. Reuses `applyUpsertOcrLink` from in-memory via a shadow `OcrLinkState` shim. Two write paths inside the helper:
  - **Create** (no prior row by document_id): INSERT row + audit kind `OCR_LINK_SNAPSHOTTED`.
  - **Refresh** (prior row exists + canonical bytes differ): UPDATE row + audit kind `OCR_LINK_REFRESHED`.
  - **Idempotent replay** (prior row exists + canonical bytes identical): NO writes, NO audit, returns `{link, created: false}`.
- **`getOcrLink(query)`** — pure read by `document_id` (tenant scoped via document target).
- **`listOcrLinks(query)`** — paginated read scoped to matter, with optional `status_snapshot` filter.

Schema **v8** adds `case_box_ocr_links` table + 2 indices. **PK is `document_id`** (not `id`). One row per document — upserts mutate in place.

**Cross-package boundary check** (per lane constraint): B9 stays inside `services/case-box-persistence/**`. The `case_box_ocr_links` table stores a SNAPSHOT BY VALUE (status, ocr_job_id, last_seen_at, direction, actor_user_id). It does NOT reference or query the OCR package's own state. The OCR package (`services/ocr-persistence`, `services/ocr-worker`) is NOT touched by B9.

**LOC strategy**:
- `SqliteCaseBoxPersistence.ts` at 596 LOC; +6-8 LOC for 3 thin call-throughs → ~604 LOC. Stays at warn band, well under 800 fail. B8 D4#1 stays deferred at same band.
- `schema.ts` at 500 LOC (warn boundary post-B8). B9 adds DDL_STATEMENTS_V8 (~35 LOC) → ~535 LOC, modestly over warn. **Plan addresses B8 D4#2** by adding a clear, contained DDL block (no broader refactor — defer DDL extraction to a future cleanup WI).

Plan-only file: `dev-memo/plan-case-box-persistence-B9-ocr-links.md` (THIS FILE).

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-B9-ocr-links.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/**`.
- `docs/contracts/case-box-contract/**`.
- Any OCR package.
- AGENTS.md.
- Umbrella / B1..B8 plans.
- `dev-memo/plan-case-box-persistence-00.md`.

### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. Plan enumerates B9 scope per umbrella §2 row B9 verbatim + expands.
3. Plan defines schema v8 DDL: one new table (PK = document_id) + 2 indices.
4. Plan declares the conformance label filter regex (extends B8 with `6.A7.*`).
5. Plan declares hardening invariants (5+ including idempotent-replay + create-vs-refresh audit-kind selection).
6. Plan declares HARD-STOP categories that DO and DO NOT trigger.
7. Plan declares LOC budget per touched file + LOC-growth-prevention strategy.
8. Plan declares cc-suite audit + verify expectations for the impl WI.
9. Plan declares execution-discipline compliance per `.claude/rules/execution-discipline.md`.
10. Plan addresses each deferred Low explicitly (see §5).
11. Plan declares the cross-package boundary: B9 does NOT depend on the OCR package.
12. cc-suite review-plan returns READY (or only Low-risk clarifications) via Path 1 native `--background`.

### Exact out-of-scope list (B9; deferred to B10+)

- **No B10+ entities** (read-side aggregations, Once writers).
- **`getDeadlineCalendar`** stays B10. `listMatters` / `getMatterSummary` / `getDocumentDetail` / `getFactSupersessionChain` stay B10.
- **`appendFactOnce`** stays B11.
- **No public-API change** (B9 implements 3 EXISTING interface methods).
- **No OCR-package change**. `services/ocr-persistence` + `services/ocr-worker` UNTOUCHED. B9 is "by value" mirror — no cross-package query.
- **No new top-level dep.**
- **No real-data migration.**
- **No API / UI / mini-program / auth / cloud / sync / LLM runtime changes.**
- **No broad refactor of `SqliteCaseBoxPersistence.ts`** beyond `#runImmediateWrite` pattern.
- **No `requireMatterTenant` extraction** (B7 L D2#1 stays deferred).
- **No `schema.ts` DDL extraction refactor** (B8 D4#2 noted; defer to a future cleanup WI; B9 does NOT undertake it).
- **No git push.**
- **No committed rollback.**

### Essential references

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B9.
- `services/case-box-persistence/src/inMemoryOcrLink.ts` — behavioral target: `applyUpsertOcrLink`, `getOcrLinkHelper`, `listOcrLinks`, `OcrLinkState` shape, `deepEqualLink` + `canonicalJson` (idempotent-replay byte-equality).
- `services/case-box-persistence/src/sqlite/{matter,document,audit,classification,privilege,facts,docket,deadline,evidence}RepoQueries.ts` — sibling-file precedent.
- `services/case-box-persistence/src/sqlite/sqliteBackedIdSet.ts` — shared B7+B8 helper. NOTE: B9 does NOT use this because `case_box_ocr_links` is keyed by `document_id` and shadow state lookups are `.get(documentId)`, not `.has(id)` on a Set.
- `docs/contracts/case-box-contract/schemas/case-box-ocr-link.schema.json` — schema: 7 fields (document_id PK, tenant_id, actor_user_id, ocr_job_id, direction, status_snapshot, last_seen_at).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — B9 cases `6.A7.1`..`6.A7.18` incl. variants `1b`, `15b` (NO 5, 9, 10). **17 cases total**. No R5.* cases for OCR links.
- B8 audit `audit-mphtd7pt-ajcyux` deferred Lows D4#1 / D4#2 / D2#1.
- CCSUITE-PATH1-RCA-01 (`d3e1cbc`) — use Path 1 native `--background`.
- `.claude/rules/cc-suite.md`, `echo-sleuth.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

### Review questions for the reviewer

1. **PK is `document_id`, NOT `id`**: the contract's `CaseBoxOcrLink` schema has NO `id` field; the row is uniquely keyed by `document_id`. Plan picks `document_id TEXT PRIMARY KEY` in DDL_V8 (matches the in-memory `linksByDocumentId` Map keying). The SqliteBackedIdSet pattern does NOT apply here because the in-memory helper reads `state.linksByDocumentId.get(document_id)` (a Map .get, not a Set .has).

2. **Three write modes** (per in-memory `applyUpsertOcrLink`):
   - **Idempotent replay**: `prior !== undefined && deepEqualLink(prior, link)` → return `{link, created: false}`. NO INSERT/UPDATE, NO audit event.
   - **Create**: `prior === undefined` → INSERT + `OCR_LINK_SNAPSHOTTED` audit (before_state_hash null).
   - **Refresh**: `prior !== undefined && bytes differ` → UPDATE + `OCR_LINK_REFRESHED` audit (before_state_hash from prior).
   The SQLite path MUST preserve this 3-way branching with byte-identical canonical comparison.

3. **`deepEqualLink` canonical comparison**: in-memory uses `canonicalJson` (sorted keys, recursive). The SQLite shadow loads `prior` by SELECTing `payload_json` and JSON.parse — then the in-memory helper's own `canonicalJson` runs verbatim. No SQL-side canonicalization. Reuse helper as-is.

4. **Matter binding via document target**: the OCR link itself does NOT carry `matter_id`; the in-memory helper resolves it from `repo.documents.get(link.document_id).document.matter_id`. The SQLite shadow `RepoView` shim must wire `repo.documents.get(id)` to a `SELECT payload_json FROM case_box_documents WHERE id = ?`. matter_id is then derived from `document.matter_id`.

5. **`listOcrLinks` is matter-scoped**: query takes `matter_id`; helper iterates `state.linksByMatter.get(matter_id)` (a Set of document_ids), then maps to `linksByDocumentId.get(...)`. SQLite list: `SELECT ... FROM case_box_ocr_links WHERE matter_id = ?` after lifting `matter_id` as a column. Cursor seek by `last_seen_at DESC, document_id ASC`.

6. **`schema.ts` LOC pressure**: schema.ts is 500 LOC post-B8 (warn boundary). B9 adds DDL_STATEMENTS_V8 (~35 LOC) → ~535 LOC, modestly over warn. Plan does NOT undertake DDL extraction (broad-refactor restriction). B8 D4#2 deferred entry note updated to reflect the modest over-warn. A future cleanup WI may split `DDL_BY_VERSION` into per-version files.

7. **Conformance regex**: per rev-1 reviewer H D2#1, the 6.A7 alternative MUST be an EXPLICIT alternation (NOT a numeric range) because the conformance harness contains NO `6.A7.5`, `6.A7.9`, or `6.A7.10`. Correct alternative: `6\.A7\.(?:1b|15b|1|2|3|4|6|7|8|11|12|13|14|15|16|17|18)`. Adds 6.A7.* (17 cases incl. variants `1b`, `15b`; no 5, 9, 10). No R5.* additions.

8. **Audit-chain semantics**: idempotent replay does NOT emit audit. The hardening test for B9 must assert `event_count UNCHANGED` after a byte-identical replay. Create and refresh DO emit audits with the correct `OCR_LINK_SNAPSHOTTED` / `OCR_LINK_REFRESHED` kinds (verified against contract's `audit-log.ts`).

9. **Deferred-Low handling**: see §5.

---

## §1 B9 scope

### §1.1 Schema v8

CURRENT_SCHEMA_VERSION 7 → 8. v1-v7 NOT modified.

`DDL_STATEMENTS_V8` adds:

```sql
CREATE TABLE IF NOT EXISTS case_box_ocr_links (
  document_id              TEXT    PRIMARY KEY,
  tenant_id                TEXT    NOT NULL,
  matter_id                TEXT    NOT NULL,
  ocr_job_id               TEXT    NOT NULL,
  direction                TEXT    NOT NULL,
  status_snapshot          TEXT    NOT NULL,
  last_seen_at             TEXT    NOT NULL COLLATE BINARY,
  payload_json             TEXT    NOT NULL
);

-- Per-matter list seek. Order per behavioral target (inMemoryOcrLink.ts):
-- last_seen_at DESC, document_id ASC (per rev-1 reviewer M D1#2).
CREATE INDEX IF NOT EXISTS idx_case_box_ocr_links_by_matter_seek
  ON case_box_ocr_links (matter_id, last_seen_at DESC, document_id ASC);

-- Filtered list seek per ListOcrLinksQuery (status_snapshot).
CREATE INDEX IF NOT EXISTS idx_case_box_ocr_links_by_matter_filter_seek
  ON case_box_ocr_links (matter_id, status_snapshot, last_seen_at DESC, document_id ASC);
```

Notes:
- **`document_id` is the PRIMARY KEY** (NOT `id`). Schema-contract field name matches.
- **`matter_id` LIFTED** even though the contract's `CaseBoxOcrLink` schema does NOT include it — derived from the linked document during upsert and stored on the row for matter-scoped list queries.
- `actor_user_id` stays in `payload_json` only (not lifted; not a filter key).
- NO FK constraints (consistent with B1-B8).

`actor_user_id` deliberately is NOT a column — the row is the snapshot; `actor_user_id` records who recorded the snapshot, not a query key.

### §1.2 New file: `ocrLinkRepoQueries.ts` (estimated ~200-250 LOC)

Mirrors `{matter,document,audit,classification,privilege,facts,docket,deadline,evidence}RepoQueries.ts` shape. Three exports + one private helper:

- `applyUpsertOcrLinkSqlite(db, input, deps)` — caller-tx-wrapped upsert.
  - Validate input via `validateOcrLink` (contract).
  - Resolve document via `SELECT payload_json FROM case_box_documents WHERE id = ?` (mirrors `repo.documents.get(documentId)` in the shadow). Throw `unknown_document` if missing.
  - Tenant consistency check: `document.tenant_id === link.tenant_id` else `tenant_mismatch`.
  - matter_id derived from `document.matter_id`. Defensive matter-existence guard via `SELECT 1 FROM case_box_matters WHERE id = ?` (matches in-memory line 130-132 audit Dim 1 #2 fix).
  - Load prior row via `SELECT payload_json FROM case_box_ocr_links WHERE document_id = ?`.
  - Branch: idempotent-replay (no writes) / create (INSERT + SNAPSHOTTED) / refresh (UPDATE + REFRESHED).
  - For create/refresh: write audit event + chain-head update.

- `getOcrLinkSqlite(db, query)` — pure read by `document_id`. **Full parity with `getOcrLinkHelper`** per rev-1 reviewer M D2#2:
  1. `SELECT tenant_id FROM case_box_matters WHERE id = ?` → if missing, return `null`.
  2. If matter's tenant_id !== query.tenant_id → throw `tenant_mismatch`.
  3. `SELECT payload_json, matter_id FROM case_box_documents WHERE id = ?` (or equivalent) → if missing, return `null`.
  4. If document.matter_id !== query.matter_id → return `null`.
  5. If document.tenant_id !== query.tenant_id → return `null`.
  6. `SELECT payload_json FROM case_box_ocr_links WHERE document_id = ?` → if missing, return `null`; else return parsed payload.
  Match the in-memory helper's null-vs-throw distinctions exactly (only tenant-mismatch on a known matter throws; everything else returns null).

- `listOcrLinksSqlite(db, query)` — paginated read.
  - Matter+tenant scope via `requireMatterTenant`.
  - Filter: `status_snapshot` (per `ListOcrLinksQuery`).
  - Cursor seek `last_seen_at DESC, document_id ASC`.

- `loadDocumentForResolve(db, documentId)` — private helper mirroring the same shape in other repo-queries files.

Transaction-scope rule: every helper runs INSIDE the caller's `#runImmediateWrite` transaction. None opens its own.

NO `SqliteBackedIdSet` usage — the OCR-link helper does NOT have a Set-of-ids interface (the keying is by-document_id; the in-memory `linksByDocumentId` Map is read via `.get(...)` and the SQLite shadow can do the same via a single `SELECT ... WHERE document_id = ?`).

### §1.3 `SqliteCaseBoxPersistence.ts` method impls

3 stubs → impls via `#runImmediateWrite`:

```ts
async upsertOcrLink(input: unknown): Promise<UpsertOcrLinkResult> {
  const result = this.#runImmediateWrite((db, deps) => applyUpsertOcrLinkSqlite(db, input, deps));
  return structuredClone(result) as UpsertOcrLinkResult;
}
async getOcrLink(query: GetOcrLinkQuery): Promise<CaseBoxOcrLink | null> {
  return getOcrLinkSqlite(this.#db, query);
}
async listOcrLinks(query: ListOcrLinksQuery): Promise<ListOcrLinksPage> {
  return listOcrLinksSqlite(this.#db, query);
}
```

**Net LOC delta on `SqliteCaseBoxPersistence.ts`: estimated +6-8** (3 stubs × ~2 LOC removed; 3 thin calls × ~3 LOC added). Class lands at ~602-604 LOC. **B8 D4#1 stays deferred at same band.**

### §1.4 Audit kinds + idempotent replay

Per `inMemoryOcrLink.ts` line 144:
- Create path: audit kind `OCR_LINK_SNAPSHOTTED` (action: create; before_state_hash null).
- Refresh path: audit kind `OCR_LINK_REFRESHED` (action: update; before_state_hash from prior).
- Idempotent replay: NO audit event emitted.

**Refactor decision** (per rev-1 reviewer M D1#1 contradiction fix — single canonical choice):

B9 plan picks **Option A — extract `prepareUpsertOcrLink` from the existing `applyUpsertOcrLink`**. This matches the pattern established by B6/B7/B8 and avoids shadow-write-through complexity. The refactor is mechanical and stays inside `inMemoryOcrLink.ts`:

1. Extract a NEW `prepareUpsertOcrLink(state, repo, deps, input)` from the existing `applyUpsertOcrLink` body, returning `{link, created, audit?, matterId}` (audit is `undefined` for idempotent-replay; defined for create/refresh).
2. Keep `applyUpsertOcrLink` as a thin wrapper that calls `prepareUpsertOcrLink` then mutates the in-memory `state.linksByDocumentId` + `state.linksByMatter` + `repo.auditByMatter` exactly as before.
3. SQLite caller (`applyUpsertOcrLinkSqlite`) calls `prepareUpsertOcrLink` directly:
   - If `prepared.audit === undefined` (idempotent replay): **EARLY RETURN with NO row writes, NO audit emission** (per rev-1 reviewer M D5#1 — make this explicit).
   - Else (create or refresh): INSERT or UPDATE the row via SQL, then write audit via `WriteDeps.writeAuditEventAndUpdateHead`.

No public API change. Tests must continue to pass post-refactor.

### §1.5 Tests

- **`tests/sqlite.conformance.test.mjs`** — package.json `--test-name-pattern` widened with the EXPLICIT 6.A7 alternation `6\\.A7\\.(?:1b|15b|1|2|3|4|6|7|8|11|12|13|14|15|16|17|18)` (per rev-1 reviewer H D2#1 + rev-2 H D1#1 — NOT `6\\.A7\\.*`; the harness has NO 6.A7.5, 6.A7.9, 6.A7.10). `B9_EXPECTED_CASE_IDS` extends B8's with 17 new 6.A7.* ids. Label `Sqlite-B8` → `Sqlite-B9`. Outside-scope updated (`6.A7.19+` → out; `6.A8+` → B10; `6.A9+` → B11).

- **NEW `tests/hardening-ocr-link.test.mjs` (per phase-axis split pattern)** — 5 new B9 invariant tests:
  1. **Cross-tenant document → upsertOcrLink rejected** (`tenant_mismatch`).
  2. **Unknown document → `unknown_document`**.
  3. **Idempotent-replay**: byte-identical 2nd call emits NO audit (event_count unchanged); returns `{created: false}`. Per rev-1 reviewer L D2#3: ALSO assert the row's `payload_json` is byte-identical pre/post replay (no UPDATE happened) AND `last_seen_at` lifted column unchanged.
  4. **Create-vs-refresh audit-kind selection**: 1st upsert emits `OCR_LINK_SNAPSHOTTED`; 2nd (modified) upsert emits `OCR_LINK_REFRESHED`.
  5. **Audit-chain atomic** event_count == COUNT == MAX(seq) == 3 after createMatter + registerDocument + upsertOcrLink (1 link → 1 audit).

- **NEW `tests/impl-parity-ocr-link.test.mjs`** — 6 new B9 scenarios (B9.1..B9.6):
  1. `upsertOcrLink` create happy path identical.
  2. `upsertOcrLink` refresh (state-changed) identical.
  3. `upsertOcrLink` idempotent-replay identical (both impls return `{created: false}` with no new audit).
  4. `getOcrLink` happy path identical.
  5. `listOcrLinks` byte-identical next_cursor across 2 pages.
  6. Rejection parity (cross-tenant document, unknown document).

- **`tests/impl-parity-stub-frontier.test.mjs`** — B8.0 → B9.0; next stub frontier becomes `appendFactOnce` (B11) OR `getDeadlineCalendar` (B10). Plan picks **`getDeadlineCalendar`** (alphabetic-next of remaining stubs).

- **`tests/invariants.test.mjs`** — 6.2.6b retargets `upsertOcrLink` → `getDeadlineCalendar`.

### §1.6 Acceptance criteria (impl WI; this plan-WI does NOT execute)

1. `npm --prefix services/case-box-persistence test` exits 0.
2. SQLite impl passes shared conformance cases `6.A7.*` (17 cases).
3. The 5 B9 hardening tests pass (especially idempotent-replay + audit-kind selection).
4. The 6 impl-parity scenarios deep-compare across both impls.
5. The `inMemoryOcrLink.ts` refactor (Option A from §1.4) does NOT break any existing in-memory test.
6. All Phase A in-memory tests stay green.
7. B1-B8 SQLite tests stay green.
8. ocr-persistence + ocr-worker + case-box-contract + docs/contracts unchanged green (B9 does NOT touch them).
9. loc-guardian: 0 over fail. `SqliteCaseBoxPersistence.ts` ~604 LOC. `schema.ts` ~535 LOC (over warn — B8 D4#2 progression noted).
10. cc-suite audit (mini) via Path 1 native `--background`: PASS or NEEDS-FIX-fixed-and-verified.

---

## §2 LOC budget per file (post-B9)

Current state (post-B8 commit `bfda127`):

| File | Current LOC | B9 estimated delta | Threshold |
|---|---|---|---|
| `src/sqlite/schema.ts` | 500 (at warn) | +35 (DDL_V8) → **535** (over warn) | source warn 500 |
| `src/sqlite/SqliteCaseBoxPersistence.ts` | 596 | +6-8 (3 thin calls) → **~604** | OVER warn 500, under fail 800 |
| `src/sqlite/matterRepoQueries.ts` | 89 | 0 | |
| `src/sqlite/documentRepoQueries.ts` | 205 | 0 | |
| `src/sqlite/auditRepoQueries.ts` | 162 | 0 | |
| `src/sqlite/classificationRepoQueries.ts` | 361 | 0 | |
| `src/sqlite/privilegeRepoQueries.ts` | 388 | 0 | |
| `src/sqlite/factsRepoQueries.ts` | 378 | 0 | |
| `src/sqlite/docketRepoQueries.ts` | 458 | 0 | |
| `src/sqlite/deadlineRepoQueries.ts` | 233 | 0 | |
| `src/sqlite/evidenceRepoQueries.ts` | 379 | 0 | |
| `src/sqlite/sqliteBackedIdSet.ts` | 43 | 0 | |
| `src/sqlite/ocrLinkRepoQueries.ts` (NEW) | 200-250 est. | new | |
| `src/inMemoryOcrLink.ts` | (existing; ~240) | small refactor (extract `prepareUpsertOcrLink`); net ~+20 LOC | |
| `tests/sqlite.conformance.test.mjs` | 154 | +3 | test warn 700 |
| `tests/hardening-ocr-link.test.mjs` (NEW) | ~100 | new | test warn 700 |
| `tests/impl-parity-ocr-link.test.mjs` (NEW) | ~130 | new | test warn 700 |
| `tests/impl-parity-stub-frontier.test.mjs` | 21 | minor edit | |
| `tests/invariants.test.mjs` | small edit | | |

LOC-growth-prevention posture: `SqliteCaseBoxPersistence.ts` stays at warn band (+6-8 LOC). `schema.ts` modestly crosses warn (+35 LOC for DDL_V8); B8 D4#2 noted with updated count. No per-phase test file over warn.

---

## §3 Hard-stop alignment

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED. No new dep.
- **New runtime dependency** — NOT triggered.
- **Schema migration on PERSISTED REAL DATA** — NOT triggered.
- **Public API break** — NOT triggered (B9 implements 3 EXISTING stubs).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered.
- **Cross-package boundary** — B9 EXPLICITLY DOES NOT cross into the OCR package per lane constraint. The OCR-link mirror is **by value**; no cross-package query.
- **Push / deploy / secrets / production data** — NOT triggered.

Per the no-revert posture: fix-forward; STOP-FOR-ROLLBACK if necessary.

---

## §4 Execution-discipline compliance (per `.claude/rules/execution-discipline.md`)

### §4.1 Think before coding
- WI scope: 3 method impls + 1 new SQL helper file + schema v8 + small in-memory refactor + test extensions.
- Assumptions:
  - `applyUpsertOcrLink` refactored into `prepareUpsertOcrLink` + thin in-memory wrapper.
  - `getOcrLinkHelper` + `listOcrLinks` reused as-is via shadow state (these helpers are pure reads).
  - `getDeadlineCalendar` / `appendFactOnce` stay `not_implemented` (B10 + B11).
- Hard stops cross-checked: no triggers.

### §4.2 Simplicity first
- Smallest slice: 3 methods + 1 sibling file + 1 schema version + 1 narrow in-memory refactor.
- Reuse: contract `validateOcrLink`, `assertCaseBoxIsSubordinateToOcr`, `buildCaseBoxAuditEvent`, `entityStateHash`, `canonicalJson` (helpers from `inMemoryOcrLink.ts`).
- No speculative abstractions.

### §4.3 Surgical changes
- WI authored file list:
  - NEW: `services/case-box-persistence/src/sqlite/ocrLinkRepoQueries.ts`.
  - NEW: `services/case-box-persistence/tests/hardening-ocr-link.test.mjs`.
  - NEW: `services/case-box-persistence/tests/impl-parity-ocr-link.test.mjs`.
  - MODIFIED: `schema.ts` (DDL_V8 + version bump); `SqliteCaseBoxPersistence.ts` (3 stub bodies + imports); `inMemoryOcrLink.ts` (split into `prepareUpsertOcrLink` + thin wrapper); `inMemoryRepo.ts` (any callers of `applyUpsertOcrLink` adjusted to new shape if applicable — likely none if the wrapper preserves signature); `package.json` (filter regex + label + test paths); `tests/sqlite.conformance.test.mjs`; `tests/impl-parity-stub-frontier.test.mjs` (B8.0 → B9.0); `tests/invariants.test.mjs` (6.2.6b retarget); `dev-memo/deferred-audit-findings.md` (B9 entry).

### §4.4 Goal-driven execution
- Acceptance criteria testable (§1.6).
- cc-suite audit via Path 1 native `--background` on impl commit.

### §4.5 Relationship to existing rules
- B9 plan does NOT bypass cc-suite review-plan (this is the review).
- B9 plan does NOT relax loc-guardian thresholds (B8 D4#2 noted as progressing).
- B9 plan respects autonomy hard-stops, rollback policy, night-run policy.
- B9 plan honors CCSUITE-PATH1-RCA-01 + WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01.

---

## §5 Deferred-Low handling

Per lane constraint: account for ALL existing deferred Lows.

| Finding | B9 plan position |
|---|---|
| **B8 D4#1** (SqliteCaseBoxPersistence.ts 596 LOC over warn) | B9 adds +6-8 LOC; class lands at ~604. **Stays deferred** at same band (B7+B8 posture continued). |
| **B8 D4#2** (schema.ts 500 LOC at warn boundary) | B9 ADDS DDL_V8 (~35 LOC) → ~535. **Progresses** over warn by ~7%. **Stays deferred** with updated note. Plan does NOT undertake DDL extraction refactor in B9 (broad-refactor restriction). |
| **B8 D2#1** (conformance regex duplication) | B9 NATURALLY touches the regex (adds 6.A7.* alternative). **Stays deferred**; preflight inventory continues to enforce parity. |
| **B7 D4#2** (SqliteCaseBoxPersistence band) | Same as B8 D4#1; **stays deferred**. |
| **B7 L D2#1** (`requireMatterTenant` duplicated) | NOT touched. **Stays deferred**. |
| **B5 D1#2** (getPrivilegeStatus perf) | NOT touched. **Stays deferred**. |
| **B5 D2#1** (privilege shadow-state shim duplication) | NOT touched. **Stays deferred**. |
| **B5 D4#2** (global id scan pattern, B4 + B5 occurrences) | NOT touched. B9 does NOT use `SqliteBackedIdSet` at all (no Set-of-ids interface; PK is `document_id` accessed via `.get`). **Stays deferred** at 2 occurrences. |

No deferred Low is naturally closed by B9. B8 D4#2 progresses over warn; the plan flags this and defers the DDL-extraction refactor to a future cleanup WI.

---

## §6 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | In-memory `applyUpsertOcrLink` refactor (extract `prepareUpsertOcrLink`) could break in-memory tests if the wrapper's state-mutation behavior diverges. | The refactor is mechanical: split the existing function body at the audit-event-built-but-not-yet-mutated boundary. Wrapper stays in `inMemoryOcrLink.ts`, calls prepare, then performs the existing state mutations. Run the full in-memory + SQLite test matrix AFTER the refactor + BEFORE adding B9 SQLite tests (2-step verification). |
| 2 | Medium | Idempotent-replay semantics: SQLite path must short-circuit BEFORE any INSERT / UPDATE / audit emission on byte-identical replay. A subtle bug here would over-emit audits and break the 6.A7 idempotent-replay conformance case (likely 6.A7.4 or 6.A7.13). | `prepareUpsertOcrLink` already returns `{link, created, audit: undefined}` when `prior !== undefined && deepEqualLink(...)`. The SQLite caller short-circuits when `audit === undefined`. Hardening test #3 enforces. |
| 3 | Medium | `case_box_ocr_links` PK is `document_id`, NOT `id`. Future cross-entity helpers that assume "every case-box table has an `id` PRIMARY KEY" will not work here. | Document this in `ocrLinkRepoQueries.ts` header. The `SqliteBackedIdSet` helper is NOT used for OCR links because the lookup is `WHERE document_id = ?`, not `WHERE id = ?`. No new B9 occurrence of B5 D4#2. |
| 4 | Low | `schema.ts` crosses warn (~535 LOC). B8 D4#2 deferred entry continues to age. | Plan defers DDL extraction to a future cleanup WI. Reviewer may suggest splitting to a per-version DDL file structure (`schemaVersions/v8.ts`, etc.); plan rejects as broad refactor. |
| 5 | Low | Cursor pagination drift (recurring risk). | Shared cursor utility + impl-parity 2-page test. |
| 6 | Low | Schema v8 lifts `matter_id` even though the contract's OcrLink schema does NOT include it. The matter_id is derived from the document at upsert time. | Acceptable; matches the in-memory `linksByMatter` indexing pattern (Map<matterId, Set<documentId>>). Documented in §1.1. |
| 7 | Low | `ocrLinkRepoQueries.ts` may not need `SqliteBackedIdSet` import; verify at impl time. | Confirm via grep at impl time. |

No Critical / High risks.

---

## §7 cc-suite audit / verify expectations

For the impl WI (NOT this plan-WI):
- **cc-suite audit (mini)** via Path 1 native `--background` on the impl commit's scope. Expected: PASS or NEEDS-FIX with C/H/M fixed + verify.
- **cc-suite verify** ONLY if audit produces C/H/M findings the WI fixes.
- **Recording** per `.claude/rules/cc-suite.md` §"Required recording" 11-field block in the impl commit's message.
- Lows: append per-finding rows to `dev-memo/deferred-audit-findings.md` under a new "Phase B9" entry.

cc-suite execution rule per lane authorization + `.claude/rules/cc-suite.md` §"Background-invocation discipline": **NEVER** wrap the runner in Claude Code Bash `run_in_background: true`. Use runner foreground OR runner native `--background` flag.

---

## §8 References

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B9.
- B1-B8 plans + impls.
- CCSUITE-PATH1-RCA-01 (`d3e1cbc`).
- WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01 (`8d3bb0b`).
- `services/case-box-persistence/src/inMemoryOcrLink.ts` (behavioral target).
- `services/case-box-persistence/src/sqlite/{schema,SqliteCaseBoxPersistence,sqliteBackedIdSet,*RepoQueries}.ts`.
- `docs/contracts/case-box-contract/src/case-box-ocr-link*.ts` + schema.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` lines for 6.A7.*.
- B8 audit `audit-mphtd7pt-ajcyux` deferred Lows D4#1 / D4#2 / D2#1.
- `.claude/rules/cc-suite.md`, `echo-sleuth.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

---

## §9 Stop condition

This plan is stale or superseded when:
- B9 impl commits — plan transitions to "superseded by B9 impl commit `<hash>`".
- Umbrella plan revision changes B9 scope.
- `applyUpsertOcrLink` contract semantics change (e.g., idempotent-replay rules change).
