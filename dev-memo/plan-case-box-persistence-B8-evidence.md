# Plan: CASE-BOX-PERSISTENCE B8 — SQLite evidence items

**Status**: READY (revision 3 — Path 1 native --background rev-2 review returned NEEDS-FIX with 1 residual Medium ("§1.4 still says supersedes_evidence_id required per contract"); rev-3 fixes the §1.4 line to make it unambiguous that `opts.replacement_evidence_id` is the option key and `supersedes_evidence_id` is the lifted row column the helper populates. All earlier rev-1 Mediums + 1 Low remain landed: opt-name fix, impl-parity test #5 row-column assertion, hardening split test-name inventory, NAMED resolveDocumentTarget helper).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Umbrella plan**: `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (READY at `1ac26b1`) §2 row B8.
**Predecessors**: ABI gate (`d02fff8`); B1 (`601d74c`); B2 (`6b5d5f6`); B3 (`5400637`); B4 (`bb285ca`); B5 (`fcfc816`); B6 plan + impl (`8fe0b04`, `667bb9c`); B7 plan + impl (`adae300`, `69db974`); CCSUITE-PATH1-RCA-01 (`d3e1cbc`); WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01 (`8d3bb0b`); execution-discipline (`9c0966f`).
**Lane**: NIGHT-RUN-SQLITE-B8-PLAN (planning only; no implementation).
**Risk**: MEDIUM. Evidence items are a single-table mirror (no multi-row atomicity like B7 Mode B); the load-bearing work is the mandatory `sqlite.hardening.test.mjs` split (B7 D4#1) that must happen BEFORE B8 hardening tests are added.

## Review packet (compact)

### Active plan summary

B8 is the EIGHTH SQLite sub-WI of Phase B. It implements **evidence items** on top of B1-B7 infrastructure. Four interface methods convert from `not_implemented` stubs to real impls:

- **`appendEvidenceItem(input)`** — append a `proposed` evidence row. Reuses `prepareAppendEvidenceItem` from in-memory via a shadow `EvidenceState` shim with `SqliteBackedIdSet` for `evidenceIds` (verified: helper reads `.has` + `.add` only; no `.size`).
- **`transitionEvidenceItem(evidenceId, opts)`** — transition (UPDATE in place + audit emit). Reuses `prepareTransitionEvidenceItem`. Edges: `proposed→accepted`, `proposed→rejected`, `accepted→superseded` (requires `opts.replacement_evidence_id` per `EvidenceTransitionOpts`; the helper writes this value into the now-superseded row's `supersedes_evidence_id` column — the opts/row name mismatch is documented in `inMemoryEvidence.ts` and resolved by the helper).
- **`getEvidenceItem(query)`** — pure read by id (tenant + matter scope).
- **`listEvidenceItems(query)`** — paginated read with optional `status` + `source_document_id` filters.

Schema **v7** adds `case_box_evidence_items` table + 3 indices. Single-table; no Mode B atomicity equivalent (transition is a single-row UPDATE + 1 audit event, same shape as B5/B6 transitions).

R-5 `party_side` is a lifted column (filter-friendly even if not in current `ListEvidenceItemsQuery`; matches B6's `purpose` lifting precedent).

**LOC strategy + MANDATORY hardening split**:
- `sqlite.hardening.test.mjs` is at 882 LOC post-B7, OVER 700 warn. B7 D4#1 mandates a B8 split BEFORE adding more hardening tests. §1.7 below specifies the destination files.
- `SqliteCaseBoxPersistence.ts` at 588 LOC; +8-12 LOC for 4 thin call-throughs via `#runImmediateWrite`. Lands ~600 LOC; stays well under 800 fail. B7 D4#2 stays deferred.

Plan-only file: `dev-memo/plan-case-box-persistence-B8-evidence.md` (THIS FILE).

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-B8-evidence.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/**`.
- `docs/contracts/case-box-contract/**`.
- Any OCR package.
- AGENTS.md.
- Umbrella / B1..B7 plans.
- `dev-memo/plan-case-box-persistence-00.md`.

### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. Plan enumerates B8 scope per umbrella §2 row B8 verbatim + expands.
3. Plan defines schema v7 DDL: one new table + 3 indices.
4. Plan declares the conformance label filter regex (extends B7 with `6.A6.*` + `R5.19..R5.20`).
5. Plan declares hardening invariants (5+).
6. Plan declares HARD-STOP categories that DO and DO NOT trigger.
7. Plan declares LOC budget per touched file + LOC-growth-prevention strategy.
8. Plan declares cc-suite audit + verify expectations for the impl WI.
9. Plan declares execution-discipline compliance per `.claude/rules/execution-discipline.md`.
10. Plan addresses each deferred Low explicitly:
    - **B7 D4#1** (hardening.test.mjs 882 LOC): MANDATORY split BEFORE B8 hardening tests; concrete destination file plan in §1.7.
    - **B7 D4#2** (SqliteCaseBoxPersistence 588 LOC): stays deferred at band (+8-12 LOC delta).
    - **B7 L D2#1** (requireMatterTenant duplication): NOT touched.
    - **B5 D1#2 / D2#1 / D4#2**: NOT touched.
11. cc-suite review-plan returns READY (or only Low-risk clarifications) via Path 1 native `--background`.

### Exact out-of-scope list (B8; deferred to B9+)

- **No B9+ entities** (OCR links, aggregations, Once writers, calendar).
- **`getDeadlineCalendar`** stays B10. Stays `not_implemented`.
- **`appendFactOnce`** stays B11. Stays `not_implemented`.
- **No public-API change** (B8 implements 4 EXISTING interface methods).
- **No new top-level dep.**
- **No real-data migration.**
- **No API / UI / mini-program / auth / cloud / sync / LLM / OCR runtime changes.**
- **No broad refactor of `SqliteCaseBoxPersistence.ts`** beyond the established `#runImmediateWrite` pattern.
- **No `requireMatterTenant` extraction** (B7 L D2#1 stays deferred; reviewer accepted "defer unless naturally touched").
- **No git push.**
- **No committed rollback.**

### Essential references

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B8.
- `services/case-box-persistence/src/inMemoryEvidence.ts` — behavioral target: `prepareAppendEvidenceItem`, `prepareTransitionEvidenceItem`, `applyAppendEvidenceItem`, `listEvidenceItems`.
- `services/case-box-persistence/src/sqlite/{matter,document,audit,classification,privilege,facts,docket,deadline}RepoQueries.ts` — sibling-file precedent.
- `services/case-box-persistence/src/sqlite/sqliteBackedIdSet.ts` — shared targeted-PK Set wrapper (B7).
- `docs/contracts/case-box-contract/src/case-box-evidence-item*.ts` + `transitions.ts` `ALLOWED_EVIDENCE_EDGES`.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — B8 cases `6.A6.1`..`6.A6.22` (incl. variants `5b`, `18b`, `21b`) + `R5.19`, `R5.20`. 25 + 2 = 27 new ids.
- B7 audit `audit-mphm1ece-aki58h` deferred Lows D4#1 (hardening split) + D4#2 (SqliteCaseBoxPersistence LOC).
- CCSUITE-PATH1-RCA-01 (`d3e1cbc`) — use Path 1 native `--background`.
- `.claude/rules/cc-suite.md`, `echo-sleuth.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

### Review questions for the reviewer

1. **Schema v7 fields**: `case_box_evidence_items` lifts `id`, `tenant_id`, `matter_id`, `source_document_id`, `status`, `party_side`, `supersedes_evidence_id`, `lawyer_weight`, `created_at`, `payload_json` (canonical). Are these the right fields for B8's filter shape (`status` + `source_document_id` per `ListEvidenceItemsQuery`) + the R-5 `party_side` round-trip? `lawyer_weight` lifted for future filter expansion (matches B6's `purpose` lifting precedent).

2. **`accepted → superseded` transition semantics**: contract requires `opts.replacement_evidence_id` for this edge (NOT `supersedes_evidence_id` — per rev-1 reviewer M D1#1 fix). The opts/row name mismatch is intentional per `inMemoryEvidence.ts:160` JSDoc: `replacement_evidence_id` is the id of the NEW evidence that replaces THIS row; the helper writes that value into the now-superseded row's `supersedes_evidence_id` lifted column. The B8 transition path passes `opts.replacement_evidence_id` through `prepareTransitionEvidenceItem` unchanged. Schema lifts `supersedes_evidence_id` as the column on the row being superseded.

3. **SqliteBackedIdSet usage**: `prepareAppendEvidenceItem` reads only `.has(id)` + `.add(id)` (verified at `inMemoryEvidence.ts` lines for the duplicate-id guard). No `.size` / iteration. Safe.

4. **`transitionEvidenceItem` shadow state**: needs matter-scoped `EvidenceState` (not global) — matches B5/B6 transition pattern. Matter resolution via targeted PK lookup `SELECT matter_id FROM case_box_evidence_items WHERE id = ?` (rev-1 reviewer M D3#1 precedent from B6).

5. **`source_document_id` validation in append + list**: when `source_document_id` is provided, call shared `validateDocumentTarget` (B4 D2#1 helper). For `listEvidenceItems`, validate the same way as `listFactsSqlite` (B6 plan §1.2 precedent). Matches the 6.A6 cross-tenant/cross-matter rejection conformance cases.

6. **Conformance regex**: `^Sqlite-B8: (?:6\.1\.(?:13a|26-27|[1-9]|1[0-5]|1[6-9]|2[0-8]|29|30|31|3[2-8])|6\.A2\.(?:9a|9b|[1-9]|1[0-9]|2[0-4])|6\.A3\.(?:A2b|20b|21b|[1-9]|1[0-9]|2[0-7])|6\.A4\.(?:10b|10c|27b|27c|[1-9]|1[0-9]|2[0-8])|6\.A5\.(?:4b|18a|18b|19b|19c|[1-9]|1[0-9]|2[0-9]|3[0-2])|6\.A6\.(?:5b|18b|21b|[1-9]|1[0-9]|2[0-2])|R5\.(?:[1-9]|9b|1[0-5]|19|20|2[1-4])|R6\.[1-3])(?:\s|$)`. Adds 6.A6.* (25 cases incl. 3 variants) + R5.19 + R5.20 = 27 new ids.

7. **MANDATORY hardening split (B7 D4#1)**: §1.7 below. Plan picks a phase-axis split (one file per Phase B sub-WI's hardening tests) parallel to the impl-parity split shipped in B7. Mechanical move; no behavioral change. Tests must continue to pass post-split.

8. **Deferred-Low handling**: enumerated below in §5.

---

## §1 B8 scope

### §1.1 Schema v7

CURRENT_SCHEMA_VERSION 6 → 7. v1-v6 NOT modified.

`DDL_STATEMENTS_V7` adds:

```sql
CREATE TABLE IF NOT EXISTS case_box_evidence_items (
  id                       TEXT    PRIMARY KEY,
  tenant_id                TEXT    NOT NULL,
  matter_id                TEXT    NOT NULL,
  source_document_id       TEXT,
  status                   TEXT    NOT NULL,
  party_side               TEXT,
  supersedes_evidence_id   TEXT,
  lawyer_weight            TEXT,
  created_at               TEXT    NOT NULL COLLATE BINARY,
  payload_json             TEXT    NOT NULL
);

-- Per-matter chronological list seek (ORDER BY created_at ASC, id ASC).
CREATE INDEX IF NOT EXISTS idx_case_box_evidence_items_by_matter_seek
  ON case_box_evidence_items (matter_id, created_at ASC, id ASC);

-- Filtered list seek per ListEvidenceItemsQuery (status + source_document_id).
CREATE INDEX IF NOT EXISTS idx_case_box_evidence_items_by_matter_filter_seek
  ON case_box_evidence_items (matter_id, status, source_document_id, created_at ASC, id ASC);

-- Supersession reverse lookup (which evidence supersedes which).
CREATE INDEX IF NOT EXISTS idx_case_box_evidence_items_by_supersedes
  ON case_box_evidence_items (matter_id, supersedes_evidence_id, id);
```

`party_side` lifted as a column even though `ListEvidenceItemsQuery` does NOT expose it at v1 (matches B6's `purpose` lifting precedent — future filter expansion). The R-5 round-trip is verified via the conformance R5.19 / R5.20 path.

NO FK constraints (consistent with B1-B7).

### §1.2 New file: `evidenceRepoQueries.ts` (estimated ~250-300 LOC)

Mirrors `{matter,document,audit,classification,privilege,facts,docket,deadline}RepoQueries.ts` shape. Four exports:

- `applyAppendEvidenceItemSqlite(db, input, deps)` — caller-tx-wrapped append. Shadow `EvidenceState` uses `SqliteBackedIdSet` for `evidenceIds`. Tenant + matter consistency mirror of in-memory wrapper. When `source_document_id` is provided, the helper resolves it via the in-memory `resolveDocumentTarget` (which the shadow state's `getDocument` callback wires to a `SELECT payload_json FROM case_box_documents WHERE id = ?`) — same pattern as B6's `applyAppendFactSqlite` (per rev-1 reviewer L D4#4: NAMED helpers, NOT "equivalent"). The cross-tenant / cross-matter rejection conformance cases (6.A6 cross-tenant/cross-matter source_document_id) flow through this path.
- `applyTransitionEvidenceItemSqlite(db, evidenceId, opts, deps)` — caller-tx-wrapped transition. Matter resolution via targeted PK lookup. Matter-scoped shadow `EvidenceState` loaded via single SELECT. UPDATE in place + audit emit.
- `getEvidenceItemSqlite(db, query)` — pure read; tenant + matter scope.
- `listEvidenceItemsSqlite(db, query)` — paginated read with `status` + `source_document_id` filters. When `source_document_id` is provided, validate via `validateDocumentTarget` (matches B6 listFactsSqlite precedent + 6.A6.* cross-tenant/cross-matter cases).

Transaction-scope rule (per B7 plan §1.4 + cc-suite rule): every helper runs INSIDE the caller's `#runImmediateWrite` transaction. None opens its own.

### §1.3 `SqliteCaseBoxPersistence.ts` method impls

4 stubs → impls via `#runImmediateWrite`:

```ts
async appendEvidenceItem(input: unknown): Promise<CaseBoxEvidenceItem> {
  const row = this.#runImmediateWrite((db, deps) => applyAppendEvidenceItemSqlite(db, input, deps));
  return structuredClone(row) as CaseBoxEvidenceItem;
}
async transitionEvidenceItem(evidenceId: string, opts: EvidenceTransitionOpts): Promise<CaseBoxEvidenceItem> {
  const row = this.#runImmediateWrite((db, deps) => applyTransitionEvidenceItemSqlite(db, evidenceId, opts, deps));
  return structuredClone(row) as CaseBoxEvidenceItem;
}
async getEvidenceItem(query: GetEvidenceItemQuery): Promise<CaseBoxEvidenceItem | null> {
  return getEvidenceItemSqlite(this.#db, query);
}
async listEvidenceItems(query: ListEvidenceItemsQuery): Promise<ListEvidenceItemsPage> {
  return listEvidenceItemsSqlite(this.#db, query);
}
```

**Net LOC delta on `SqliteCaseBoxPersistence.ts`: estimated +8-12** (4 stubs × ~2 LOC removed; 4 thin calls × ~3 LOC added). Class lands at ~596-600 LOC. **B7 D4#2 stays deferred at same band.**

### §1.4 Transitions (verified at survey)

`ALLOWED_EVIDENCE_EDGES`:
- `proposed → accepted` (lawyer).
- `proposed → rejected` (lawyer).
- `accepted → superseded` (lawyer; **`opts.replacement_evidence_id` required** per `EvidenceTransitionOpts`. Per rev-2 reviewer M D1#1: `supersedes_evidence_id` is the LIFTED ROW COLUMN that the helper populates with `opts.replacement_evidence_id`; it is NOT the option key. The contract `ALLOWED_EVIDENCE_EDGES` table notes "supersedes_evidence_id required" but that note refers to the row column in the persisted state — the helper's option key is `replacement_evidence_id`).

Terminal: `rejected`, `superseded`. (Accepted is NOT terminal — can be superseded later.)

Single-row UPDATE on every transition. NO multi-row atomicity (unlike B7 Mode B). No mandatory crash-injection test for B8 (the umbrella's MANDATORY crash test was specific to B7 Mode B; B8 transitions are single-row + single audit event).

### §1.5 R-5 `party_side`

`party_side` is an optional enum field on the evidence row. Schema lifts it as a column for future filter use; current `ListEvidenceItemsQuery` does NOT expose it. Conformance R5.19 (`party_side: "our"`) and R5.20 (`party_side: "opposing"`) verify round-trip via `appendEvidenceItem` → `getEvidenceItem`.

### §1.6 Tests

- **`tests/sqlite.conformance.test.mjs`** — package.json `--test-name-pattern` widened for `6\\.A6\\.*` + `R5\\.(19|20)`. `B8_EXPECTED_CASE_IDS` extends B7's with 25 new 6.A6.* ids (1..22 + variants 5b, 18b, 21b) + R5.19 + R5.20 = **27 new cases**. Label `Sqlite-B7` → `Sqlite-B8`. Outside-scope updated (`6.A6.23+` → B9 if any; `6.A7+` → B9; `6.A8+` → B10).

- **NEW `tests/hardening-evidence.test.mjs` (per §1.7 split)** — 5 new B8 invariant tests:
  1. **Cross-tenant source_document_id rejected** → `tenant_mismatch`.
  2. **Cross-matter source_document_id rejected** → `matter_id_mismatch`.
  3. **Audit-chain atomic** event_count == COUNT == MAX(seq) == 4 after createMatter + registerDocument + appendEvidenceItem + transitionEvidenceItem.
  4. **Row UPDATE-in-place on transition** — single row per evidence id.
  5. **R-5 `party_side` round-trip** via SQL persistence layer (separate from conformance R5.19/R5.20 to lock SQLite-specific persistence path).

- **NEW `tests/impl-parity-evidence.test.mjs`** — 6 new B8 scenarios (B8.1..B8.6):
  1. `appendEvidenceItem` happy path identical.
  2. `appendEvidenceItem` with `party_side: "our"` + `source_document_id` identical.
  3. `transitionEvidenceItem` `proposed → accepted` identical.
  4. `transitionEvidenceItem` `proposed → rejected` identical.
  5. `transitionEvidenceItem` `accepted → superseded` with `opts.replacement_evidence_id` identical; assert persisted row's `supersedes_evidence_id` column equals `opts.replacement_evidence_id` (per rev-1 reviewer M D2#1 fix).
  6. `getEvidenceItem` + `listEvidenceItems` byte-identical (incl. 2-page cursor parity); rejection parity (cross-tenant; unknown evidenceId transition; cross-matter source_document_id).

- **`tests/impl-parity-stub-frontier.test.mjs`** — B7.0 → B8.0 retarget. Next stub frontier becomes `upsertOcrLink` (B9).

- **`tests/invariants.test.mjs`** — 6.2.6b retargets `appendEvidenceItem` (now B8-implemented) → `upsertOcrLink` (B9 next stub).

### §1.7 MANDATORY hardening split (closes B7 D4#1)

Per B7 plan §6 risk #6 + B7 deferred Low D4#1: B8 splits the 882-LOC `sqlite.hardening.test.mjs` BEFORE adding B8 hardening tests. Destination files (phase-axis split, parallel to the B7 impl-parity split):

| Source content (current line range, approximate) | Destination file | Est. LOC |
|---|---|---|
| Imports + shared helpers (lines 1-25) | `tests/hardening-common.mjs` (utility module, NOT a test file) | ~30 |
| Pragma smoke (B1) | `tests/hardening-pragma.test.mjs` | ~50 |
| applySchema smoke (B2) | `tests/hardening-schema.test.mjs` | ~80 |
| Audit-chain invariants (B1/B2 + general) | `tests/hardening-audit.test.mjs` | ~120 |
| B4 classification invariants | `tests/hardening-classification.test.mjs` | ~50 |
| B5 privilege invariants | `tests/hardening-privilege.test.mjs` | ~140 |
| B6 facts invariants | `tests/hardening-facts.test.mjs` | ~200 |
| B7 docket + deadline invariants (incl. crash-injection) | `tests/hardening-docket.test.mjs` | ~250 |
| **B8 evidence invariants (NEW for B8)** | **`tests/hardening-evidence.test.mjs`** | ~120 |

After the split:
- The original `tests/sqlite.hardening.test.mjs` file is **DELETED**.
- The `package.json` `--test` command is updated to include the new files (replacing `sqlite.hardening.test.mjs`).
- Each per-phase file imports shared helpers from `tests/hardening-common.mjs` (likely re-exports `openSqliteCaseBoxPersistence`, `makeClock`, `makeIdGenerator`, `makeMatterInput`, `DEFAULT_MATTER_ID`, etc.).
- No per-phase file exceeds ~250 LOC (well under 700 warn).

This split is MECHANICAL — moves existing tests verbatim with NO behavioral change. Tests must continue to pass post-split BEFORE B8 evidence tests are added.

### §1.8 Acceptance criteria (impl WI; this plan-WI does NOT execute)

1. `npm --prefix services/case-box-persistence test` exits 0.
2. SQLite impl passes shared conformance cases `6.A6.*` + `R5.19` + `R5.20`.
3. The 5 B8 hardening tests pass (in the new `hardening-evidence.test.mjs`).
4. All per-phase hardening files pass post-split BEFORE B8 hardening tests are added (2-step verification).
5. All B8 impl-parity scenarios deep-compare across both impls.
6. All Phase A in-memory tests stay green.
7. B1-B7 SQLite tests stay green.
8. ocr-persistence + ocr-worker + case-box-contract + docs/contracts unchanged green.
9. loc-guardian: 0 over fail. `SqliteCaseBoxPersistence.ts` lands at ~600 LOC (band stable). No per-phase hardening file over warn.
10. cc-suite audit (mini) via Path 1 native `--background`: PASS or NEEDS-FIX-fixed-and-verified.

---

## §2 LOC budget per file (post-B8)

Current state (post-B7 commit `69db974`):

| File | Current LOC | B8 estimated delta | Threshold |
|---|---|---|---|
| `src/sqlite/schema.ts` | 458 | +45 (DDL_V7) | source warn 500 |
| `src/sqlite/SqliteCaseBoxPersistence.ts` | 588 | +8-12 (4 thin calls; OVER warn) | warn 500 / fail 800 |
| `src/sqlite/matterRepoQueries.ts` | 89 | 0 | |
| `src/sqlite/documentRepoQueries.ts` | 205 | 0 | |
| `src/sqlite/auditRepoQueries.ts` | 162 | 0 | |
| `src/sqlite/classificationRepoQueries.ts` | 361 | 0 | |
| `src/sqlite/privilegeRepoQueries.ts` | 388 | 0 | |
| `src/sqlite/factsRepoQueries.ts` | 378 | 0 | |
| `src/sqlite/docketRepoQueries.ts` | 458 | 0 | |
| `src/sqlite/deadlineRepoQueries.ts` | 233 | 0 | |
| `src/sqlite/sqliteBackedIdSet.ts` | 43 | 0 | |
| `src/sqlite/evidenceRepoQueries.ts` (NEW) | 250-300 est. | new | |
| `tests/sqlite.conformance.test.mjs` | 148 | +5 | test warn 700 |
| `tests/sqlite.hardening.test.mjs` | 882 | **DELETED** in mandatory split | n/a |
| `tests/hardening-*.test.mjs` (NEW per-phase files) | 50-250 each | new | test warn 700 (each comfortably under) |
| `tests/hardening-common.mjs` (NEW shared module) | ~30 | new | n/a |
| `tests/impl-parity-evidence.test.mjs` (NEW) | ~150 | new | test warn 700 |
| `tests/impl-parity-stub-frontier.test.mjs` | 21 | minor edit (B7.0 → B8.0) | |
| `tests/invariants.test.mjs` | small edit (6.2.6b retarget) | | |

LOC-growth-prevention posture: `SqliteCaseBoxPersistence.ts` stays at warn band (~600); new SQL helper for evidence; hardening split CLOSES B7 D4#1. Each per-phase hardening file lands well under warn. impl-parity test for evidence is a new per-entity file matching the B6 D4#1 closure pattern.

---

## §3 Hard-stop alignment

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED. No new dep.
- **New runtime dependency** — NOT triggered.
- **Schema migration on PERSISTED REAL DATA** — NOT triggered (`:memory:` + fresh on-disk only).
- **Public API break** — NOT triggered (B8 implements 4 EXISTING stubs).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered.
- **Push / deploy / secrets / production data** — NOT triggered.

Per the no-revert posture: fix-forward; STOP-FOR-ROLLBACK if necessary.

---

## §4 Execution-discipline compliance (per `.claude/rules/execution-discipline.md`)

### §4.1 Think before coding
- WI scope: 4 method impls + 1 new SQL helper file + schema v7 + MANDATORY hardening split + test extensions.
- Assumptions:
  - `prepareAppendEvidenceItem`, `prepareTransitionEvidenceItem` REUSED VERBATIM via shadow state shims.
  - `SqliteBackedIdSet` shared from B7's `sqliteBackedIdSet.ts`.
  - `getDeadlineCalendar` / `appendFactOnce` / `upsertOcrLink` stay `not_implemented` (B9-B11).
  - Hardening test file MUST split BEFORE B8 adds new tests (B7 D4#1 mandatory).
- Hard stops cross-checked: no triggers.

### §4.2 Simplicity first
- Smallest slice: 4 methods + 1 sibling file + 1 schema version + 1 mechanical hardening split.
- Reuse: every `prepare*` helper from in-memory + `validateDocumentTarget` + cursor utility + `#runImmediateWrite` + `#writeAudit` + `SqliteBackedIdSet`.
- No speculative abstractions.

### §4.3 Surgical changes
- WI authored file list:
  - NEW: `services/case-box-persistence/src/sqlite/evidenceRepoQueries.ts`.
  - NEW: `services/case-box-persistence/tests/hardening-common.mjs`.
  - NEW: `services/case-box-persistence/tests/hardening-{pragma,schema,audit,classification,privilege,facts,docket,evidence}.test.mjs` (8 files).
  - NEW: `services/case-box-persistence/tests/impl-parity-evidence.test.mjs`.
  - MODIFIED: `schema.ts` (DDL_V7 + version bump); `SqliteCaseBoxPersistence.ts` (4 stub bodies + imports); `package.json` (filter regex + label + test paths); `tests/sqlite.conformance.test.mjs`; `tests/impl-parity-stub-frontier.test.mjs` (B7.0 → B8.0); `tests/invariants.test.mjs` (6.2.6b retarget); `dev-memo/deferred-audit-findings.md` (B8 entry + B7 D4#1 closure).
  - DELETED: `services/case-box-persistence/tests/sqlite.hardening.test.mjs`.
- No drive-by refactors. No `requireMatterTenant` extraction (deferred).

### §4.4 Goal-driven execution
- Acceptance criteria testable (§1.8).
- 2-step verification: (a) hardening split passes BEFORE B8 tests added; (b) full B8 suite passes after.
- cc-suite audit via Path 1 native `--background` on impl commit.

### §4.5 Relationship to existing rules
- B8 plan does NOT bypass cc-suite review-plan (this is the review).
- B8 plan does NOT relax loc-guardian thresholds.
- B8 plan respects autonomy hard-stops, rollback policy, night-run policy.
- B8 plan honors CCSUITE-PATH1-RCA-01 + WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01.

---

## §5 Deferred-Low handling

Per lane constraint: account for ALL existing deferred Lows.

| Finding | B8 plan position |
|---|---|
| **B7 D4#1** (sqlite.hardening.test.mjs 882 LOC over warn) | NATURALLY touched per B7 plan §6 risk #6 + B7 deferred Low D4#1's MANDATORY-in-B8 flag. B8 executes the split (§1.7). **Closes** when B8 ships. |
| **B7 D4#2** (SqliteCaseBoxPersistence.ts 588 LOC over warn) | B8 adds +8-12 LOC; class lands at ~600. **Stays deferred** at same band. |
| **B7 L D2#1** (`requireMatterTenant` duplicated across modules) | NOT touched by B8 (no natural touch trigger). **Stays deferred**. |
| **B5 D1#2** (`getPrivilegeStatus` perf) | NOT touched. **Stays deferred**. |
| **B5 D2#1** (privilege shadow-state shim duplication) | NOT touched. **Stays deferred**. |
| **B5 D4#2** (global id scan pattern, B4 + B5 occurrences) | NOT touched. B8 picks `SqliteBackedIdSet(db, "case_box_evidence_items")` for `evidenceIds` (same narrow path as B6/B7). **Stays deferred** at 2 occurrences (no new occurrence introduced by B8). |

Only B7 D4#1 is naturally fixed by B8 (the mandatory hardening split). All others stay deferred.

---

## §6 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Hardening split is mechanical but touches many existing tests. A misplaced test or missing import would surface as a failing test or import error. Worst case: B1-B7 hardening invariants no longer execute, masking a regression. | 2-step verification + **explicit test-name inventory** (per rev-1 reviewer M D5#1): (a) BEFORE the split, grep `^test\\(` in `sqlite.hardening.test.mjs` to enumerate the test-name list + count. (b) Execute the mechanical split. (c) AFTER the split, grep `^test\\(` across `tests/hardening-*.test.mjs` and assert the test-name set is IDENTICAL (no dropped tests, no renamed tests) and the count matches. (d) Run the matrix to verify all tests still pass. Only THEN add B8 evidence tests. Each per-phase file imports from `hardening-common.mjs` so the helper surface is single-source. |
| 2 | Medium | `accepted → superseded` transition requires `opts.replacement_evidence_id` (per rev-1 reviewer M D5#2 fix; opt name resolved per §1.4 + Q2). The SQLite impl must NOT bypass via a code path that emits an audit event before the helper validates the option-name mapping. | Reuse `prepareTransitionEvidenceItem` verbatim. No SQL-side validation before the helper runs. impl-parity test #5 (§1.6) asserts the persisted row's `supersedes_evidence_id` column equals `opts.replacement_evidence_id`. |
| 3 | Low | Cursor pagination drift (recurring risk from B2-B7). | Shared `encodeCursor`/`decodeCursor`/`computeFiltersHash` + impl-parity test #6 byte-identical cursor assertion. |
| 4 | Low | Schema v7 has 3 indices; mixed-order index may be wider than needed. | Accept; future perf WI can split if EXPLAIN QUERY PLAN reveals suboptimal walks. |
| 5 | Low | `evidenceRepoQueries.ts` may approach the source 500 warn if many helpers are added. | Estimate is 250-300 LOC; well under warn. Re-evaluate at impl time. |
| 6 | Low | `SqliteCaseBoxPersistence.ts` lands at ~600 LOC post-B8; B7 D4#2 stays deferred. | Continue the `#runImmediateWrite` extraction pattern; flag for re-evaluation at B9/B10 if the class grows materially. |
| 7 | Low | `party_side` is lifted as a column even though v1 `ListEvidenceItemsQuery` does not filter by it. Same posture as B6's `purpose`. | Acceptable; lifting now avoids a schema migration later. Reviewer may flag as speculative — plan accepts the flag and the lifted column. |

No Critical / High risks.

---

## §7 cc-suite audit / verify expectations

For the impl WI (NOT this plan-WI):
- **cc-suite audit (mini)** via Path 1 native `--background` on the impl commit's scope. Expected: PASS or NEEDS-FIX with C/H/M fixed + verify.
- **cc-suite verify** ONLY if audit produces C/H/M findings the WI fixes.
- **Recording** per `.claude/rules/cc-suite.md` §"Required recording" 11-field block in the impl commit's message.
- Lows: append per-finding rows to `dev-memo/deferred-audit-findings.md` under a new "Phase B8" entry.

cc-suite execution rule per lane authorization + `.claude/rules/cc-suite.md` §"Background-invocation discipline": **NEVER** wrap the runner in Claude Code Bash `run_in_background: true`. Use runner foreground OR runner native `--background` flag.

---

## §8 References

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B8.
- B1-B7 plans + impls.
- execution-discipline (`9c0966f`).
- CCSUITE-PATH1-RCA-01 (`d3e1cbc`).
- WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01 (`8d3bb0b`).
- `services/case-box-persistence/src/inMemoryEvidence.ts` (behavioral target).
- `services/case-box-persistence/src/sqlite/{schema,SqliteCaseBoxPersistence,sqliteBackedIdSet,*RepoQueries}.ts`.
- `docs/contracts/case-box-contract/src/case-box-evidence-item*.ts` + `transitions.ts` ALLOWED_EVIDENCE_EDGES.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` lines for 6.A6.* + R5.19/R5.20.
- B7 audit `audit-mphm1ece-aki58h` deferred Lows D4#1 (mandatory hardening split) + D4#2.
- `.claude/rules/cc-suite.md`, `echo-sleuth.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

---

## §9 Stop condition

This plan is stale or superseded when:
- B8 impl commits — plan transitions to "superseded by B8 impl commit `<hash>`".
- Umbrella plan revision changes B8 scope.
- `prepareAppendEvidenceItem` / `prepareTransitionEvidenceItem` contract semantics change.
