# Plan: CASE-BOX-PERSISTENCE B7 — SQLite docket entries + deadline materialization

**Status**: READY (revision 2 — Path 1 native --background rev-2 review returned READY (Low-risk clarifications). 1 High + 4 Mediums fixed in rev-2. One Low applied opportunistically: helper prose now reads "caller-transaction-wrapped" (not "transaction-wrapping") to avoid the literal interpretation that helpers own transactions; single transaction lifecycle source remains `#runImmediateWrite` per §1.4 transaction-scope constraint).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Umbrella plan**: `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (READY at `1ac26b1`) §2 row B7.
**Predecessors**: ABI gate (`d02fff8`); B1 (`601d74c`); B2 (`6b5d5f6`); B3 (`5400637`); B4 (`bb285ca`); B5 (`fcfc816`); B6 plan + impl (`8fe0b04`, `667bb9c`); execution-discipline (`9c0966f`); CCSUITE-PATH1-RCA-01 (`d3e1cbc`).
**Lane**: NIGHT-RUN-SQLITE-B7-PLAN (planning only; no implementation).
**Risk**: HIGH — Mode B confirmDocketEntry is the most subtle multi-row atomicity invariant in Phase B.

## Review packet (compact)

### Active plan summary

B7 is the SEVENTH SQLite sub-WI of Phase B. It implements **docket entries + deadline materialization** on top of B1-B6 infrastructure. The CORE invariant: `confirmDocketEntry` in Mode B atomically:
1. UPDATEs the docket-entry row (status candidate → confirmed; sets `confirmed_deadline_id`).
2. INSERTs a NEW deadline row.
3. INSERTs an audit event for the docket-entry confirmation.
4. INSERTs an audit event for the deadline materialization.
5. UPDATEs `case_box_audit_chain_heads.event_count` to match.

All five mutations succeed OR none do. The MANDATORY crash-injection test (per umbrella §9 risk #2 row B7) injects a `throw` at the **single canonical injection point** — **after the docket-entry UPDATE, BEFORE the deadline INSERT** (between step 4a and step 4b in §1.4). The test asserts BOTH domain rows AND audit rows roll back. This injection point is the strongest invariant test because it exercises rollback ACROSS a row mutation; injection BEFORE step 4a is degenerate (no rollback exercised).

**Transaction-scope constraint** (rev-1 reviewer M D5#1): every B7 SQL helper that mutates state (`applyAppendDocketEntrySqlite`, `applyConfirmDocketEntrySqlite`, `applyDismissDocketEntrySqlite`, `applyTransitionDeadlineSqlite`) MUST run entirely INSIDE the caller's `#runImmediateWrite` transaction. The helper-internal audit-write callback (`writeAuditEventAndUpdateHead`) is provided BY the caller and MUST NOT open its own transaction. No `BEGIN`/`COMMIT` statements appear in any helper body. Single source of transaction lifecycle: `SqliteCaseBoxPersistence#runImmediateWrite`.

B7 ships eight method impls (5 docket + 3 deadline):
- `appendDocketEntry` (Mode A — propose docket entry only).
- `confirmDocketEntry` (Mode B atomic — entry + deadline).
- `dismissDocketEntry`.
- `getDocketEntry`.
- `listDocketEntries`.
- `transitionDeadline` (pending → met / missed / withdrawn; missed → met with reason).
- `getDeadline`.
- `listDeadlines`.

Schema **v6** adds: `case_box_docket_entries` + `case_box_deadlines` tables + 6 indices.

B7 also ships the **mandatory impl-parity.test.mjs split** flagged by B6 deferred Low D4#1: split the single 773-LOC file into 7 per-entity files BEFORE adding B7's docket-entry parity tests. Total LOC scope balances out via the split (no single file grows past warn).

Plan-only file: `dev-memo/plan-case-box-persistence-B7-docket.md` (THIS FILE).

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-B7-docket.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/**`.
- `docs/contracts/case-box-contract/**`.
- Any OCR package.
- AGENTS.md.
- Umbrella / B1..B6 plans.
- `dev-memo/plan-case-box-persistence-00.md`.

### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. Plan enumerates B7 scope per umbrella §2 row B7 verbatim + expands.
3. Plan defines schema v6 DDL: two new tables + 6 indices.
4. Plan declares the conformance label filter regex (extends B6 with 6.A5.* + R5.21..R5.24).
5. Plan declares hardening invariants (7+ including Mode B crash injection).
6. Plan declares HARD-STOP categories that DO and DO NOT trigger.
7. Plan declares LOC budget per touched file + LOC-growth-prevention strategy.
8. Plan declares cc-suite audit + verify expectations for the impl WI.
9. Plan declares execution-discipline compliance per `.claude/rules/execution-discipline.md`.
10. Plan addresses each of B5/B6's deferred Lows + a concrete test-file split plan for `impl-parity.test.mjs`.
11. cc-suite review-plan returns READY (or only Low-risk clarifications).

### Exact out-of-scope list (B7; deferred to B8+)

- **No B8+ entities** (evidence items, OCR links, aggregations, Once writers).
- **`getDeadlineCalendar`** is B10 (read-side aggregations). Stays `not_implemented` after B7.
- **`appendFactOnce`** stays B11.
- **No public-API change** (B7 implements 8 EXISTING interface methods).
- **No new top-level dep.**
- **No real-data migration.**
- **No API / UI / mini-program / auth / cloud / sync / LLM / OCR runtime changes.**
- **No broad refactor of `SqliteCaseBoxPersistence.ts`** beyond the established `#runImmediateWrite` pattern. B5 D4#1 stays deferred.
- **No git push.**
- **No committed rollback.**

### Essential references

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B7 + §9 risk #2 (Mode B atomicity + MANDATORY crash-injection test).
- `services/case-box-persistence/src/inMemoryDocket.ts` — behavioral target: `prepareAppendDocketEntry`, `prepareConfirmDocketEntry` (takes BOTH DocketState + DeadlineState), `prepareDismissDocketEntry`, `applyAppendDocketEntry`, `listDocketEntries`.
- `services/case-box-persistence/src/inMemoryDeadline.ts` — `prepareTransitionDeadline`, `applyTransitionDeadline`, `listDeadlines`, `getDeadlineHelper`.
- `services/case-box-persistence/src/inMemoryRepo.ts` — confirm wraps both states; transition uses DeadlineState only.
- `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` — convert 8 stubs via `#runImmediateWrite`.
- `services/case-box-persistence/src/sqlite/{matter,document,audit,classification,privilege,facts}RepoQueries.ts` — sibling-file precedent.
- `docs/contracts/case-box-contract/src/case-box-docket-entry*.ts` + `case-box-deadline*.ts` + `transitions.ts` ALLOWED_DOCKET_ENTRY_EDGES + ALLOWED_DEADLINE_EDGES.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — B7 cases 6.A5.1..6.A5.32 + variants (4b, 18a, 18b, 19b, 19c) + R5.21..R5.24.
- B6 audit `audit-mph4cun6-aav6q2` deferred Lows D4#1 (impl-parity 773 LOC; B7 MANDATORY split) + D4#2 (SqliteCaseBoxPersistence.ts 572 LOC).
- B5 deferred Lows D1#2, D2#1, D4#2 (carried).
- CCSUITE-PATH1-RCA-01 (`d3e1cbc`) — use Path 1 native `--background` for cc-suite calls.
- `.claude/rules/cc-suite.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

### Review questions for the reviewer

1. **Mode B atomicity test**: the MANDATORY crash-injection test (per umbrella §9 risk #2) needs an injection point. Plan picks **injecting via a `process.env.CASE_BOX_B7_CRASH_AFTER` flag read inside `applyConfirmDocketEntrySqlite`** — set the flag before the call, expect `BEGIN IMMEDIATE` rollback, assert no docket-row mutation + no deadline row + no audit rows. Alternative: pass an injected `afterDocketUpdate` callback through the helper deps. Plan picks the env-var approach for narrower scope (no signature change to deps).
2. **DeadlineState shadow shim shape**: `prepareConfirmDocketEntry` takes BOTH `DocketState` + `DeadlineState`. Shadow shim needs to load matter-scoped facts for both. Plan picks: for confirm, load both states scoped to the matter via two matter-scoped SELECTs.
3. **`docketIds.size` / `deadlineIds.size` usage**: verified via grep — neither helper reads `.size`. SqliteBackedIdSet approach (append path) is safe. Confirm path uses real matter-scoped Sets (already required for `docketById`/`deadlineById` lookups).
4. **`transitionDeadline` shadow state**: needs DeadlineState only. Targeted PK lookup `SELECT matter_id WHERE id = ?` per B6 pattern (rev-2 reviewer M D3#1).
5. **impl-parity.test.mjs split**: split into per-entity files BEFORE adding B7's parity tests. Plan specifies 7 destination files (matter, document, facts, privilege, classification, common, stub-frontier) + new `impl-parity-docket.test.mjs`. Total LOC stays under warn for each. Hardening test file (699 LOC) NOT split in B7 (just under warn; will be re-evaluated at B8).
6. **Conformance regex**: `^Sqlite-B7: (?:6\.1\.(?:13a|26-27|[1-9]|1[0-5]|1[6-9]|2[0-8]|29|30|31|3[2-8])|6\.A2\.(?:9a|9b|[1-9]|1[0-9]|2[0-4])|6\.A3\.(?:A2b|20b|21b|[1-9]|1[0-9]|2[0-7])|6\.A4\.(?:10b|10c|27b|27c|[1-9]|1[0-9]|2[0-8])|6\.A5\.(?:4b|18a|18b|19b|19c|[1-9]|1[0-9]|2[0-9]|3[0-2])|R5\.(?:[1-9]|9b|1[0-5]|2[1-4])|R6\.[1-3])(?:\s|$)`. Adds 6.A5.* (37 cases incl. variants) + R5.21..R5.24 (4 cases) = 41 new ids.
7. **Should B7 naturally touch B5/B6 deferred Lows?**
   - **B5 D1#2 (getPrivilegeStatus perf)**: NOT touched. Stays deferred.
   - **B5 D2#1 (privilege shadow-state dup)**: NOT touched. Stays deferred.
   - **B5 D4#2 (global id scan pattern, B4/B5 occurrences)**: NOT touched. B7 picks SqliteBackedIdSet for `docketIds`/`deadlineIds` append paths (same narrow path as B6); no NEW global-scan occurrence introduced. Stays at 2 (B4 + B5).
   - **B6 D4#1 (impl-parity.test.mjs 773 LOC)**: B7 NATURALLY touches via mandatory split. Status flips to closed.
   - **B6 D4#2 (SqliteCaseBoxPersistence.ts 572 LOC)**: B7 adds 8 thin call-throughs via `#runImmediateWrite`. Estimated +16-20 LOC → ~590 LOC. Stays deferred at same band. Plan does NOT undertake structural refactor (no broad-refactor authorization per lane).

---

## §1 B7 scope

### §1.1 Schema v6

CURRENT_SCHEMA_VERSION 5 → 6. v1-v5 NOT modified.

`DDL_STATEMENTS_V6` adds:

```sql
CREATE TABLE IF NOT EXISTS case_box_docket_entries (
  id                       TEXT    PRIMARY KEY,
  tenant_id                TEXT    NOT NULL,
  matter_id                TEXT    NOT NULL,
  source_document_id       TEXT,
  source_type              TEXT    NOT NULL,
  proposed_kind            TEXT    NOT NULL,
  confirmation_state       TEXT    NOT NULL,
  proposed_at              TEXT    NOT NULL COLLATE BINARY,
  confirmed_deadline_id    TEXT,
  payload_json             TEXT    NOT NULL
);

-- Column-name alignment with the contract schema (rev-1 reviewer M D1#3):
-- the public ListDocketEntriesQuery filters are `confirmation_state` and
-- `source_type` (NOT `status`/`kind`). Lifted columns mirror those names
-- so the indices below match the runtime filter keys exactly.

CREATE TABLE IF NOT EXISTS case_box_deadlines (
  id                       TEXT    PRIMARY KEY,
  tenant_id                TEXT    NOT NULL,
  matter_id                TEXT    NOT NULL,
  source_docket_entry_id   TEXT    NOT NULL,
  kind                     TEXT    NOT NULL,
  status                   TEXT    NOT NULL,
  due_at                   TEXT    NOT NULL COLLATE BINARY,
  created_at               TEXT    NOT NULL COLLATE BINARY,
  payload_json             TEXT    NOT NULL
);

-- Column derivation note (rev-1 reviewer M D3#1):
-- `case_box_deadlines.source_docket_entry_id` is NOT in
-- `CaseBoxDeadline.payload_json` as a top-level field. It is derived
-- from the originating docket entry's id during the Mode B INSERT
-- (i.e., `applyConfirmDocketEntrySqlite` binds `entry.id` to this
-- column). The deadline payload itself carries its own provenance via
-- `payload_json`; the lifted column exists purely to index the
-- reverse-lookup "which deadline materialized from this docket entry?".

CREATE INDEX IF NOT EXISTS idx_case_box_docket_entries_by_matter_seek
  ON case_box_docket_entries (matter_id, proposed_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_case_box_docket_entries_by_matter_filter_seek
  ON case_box_docket_entries (matter_id, confirmation_state, source_type, proposed_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_case_box_docket_entries_by_confirmed_deadline
  ON case_box_docket_entries (matter_id, confirmed_deadline_id);

CREATE INDEX IF NOT EXISTS idx_case_box_deadlines_by_matter_seek
  ON case_box_deadlines (matter_id, due_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_case_box_deadlines_by_matter_filter_seek
  ON case_box_deadlines (matter_id, status, kind, due_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_case_box_deadlines_by_source_docket
  ON case_box_deadlines (matter_id, source_docket_entry_id, id);
```

`payload_json` is canonical. NO FK constraints. Application-layer enforcement.

### §1.2 New files

- `services/case-box-persistence/src/sqlite/docketRepoQueries.ts` (NEW; estimated ~350-400 LOC). Five exports:
  - `applyAppendDocketEntrySqlite(db, input, deps)` — Mode A: caller-transaction-wrapped (see §1.4 transaction-scope constraint) append. Shadow `DocketState` uses `SqliteBackedIdSet` for `docketIds` (verified: `prepareAppendDocketEntry` reads only `.has()` / `.add()`).
  - `applyConfirmDocketEntrySqlite(db, entryId, opts, deps)` — Mode B: caller-transaction-wrapped (see §1.4 transaction-scope constraint) confirm + deadline materialization. Loads matter-scoped DocketState AND DeadlineState via two SELECTs. Calls `prepareConfirmDocketEntry`. Applies entry UPDATE + deadline INSERT + 2 audit events + chain head update inside one `BEGIN IMMEDIATE`. Honors optional `process.env.CASE_BOX_B7_CRASH_AFTER` injection point for the mandatory crash test.
  - `applyDismissDocketEntrySqlite(db, entryId, opts, deps)` — caller-transaction-wrapped (see §1.4 transaction-scope constraint) dismiss (UPDATE in place + audit event).
  - `getDocketEntrySqlite(db, query)` — pure read; tenant + matter scope.
  - `listDocketEntriesSqlite(db, query)` — paginated read with `confirmation_state` + `source_type` filters (matching `ListDocketEntriesQuery` exactly per rev-1 reviewer M D1#3; NOT `status`/`kind`/`source_document_id`). Cursor seek by `proposed_at ASC, id ASC`. Lifted `source_document_id` column exists for future filter expansion but the v1 list API does not expose it.

- `services/case-box-persistence/src/sqlite/deadlineRepoQueries.ts` (NEW; estimated ~250-300 LOC). Three exports:
  - `applyTransitionDeadlineSqlite(db, deadlineId, opts, deps)` — caller-transaction-wrapped (see §1.4 transaction-scope constraint) transition (UPDATE in place + audit event). Matter resolution via targeted PK lookup.
  - `getDeadlineSqlite(db, query)` — pure read; tenant + matter scope.
  - `listDeadlinesSqlite(db, query)` — paginated read with status / kind filters; cursor seek by `due_at ASC, id ASC`.

### §1.3 `SqliteCaseBoxPersistence.ts` method impls

8 stubs → impls via `#runImmediateWrite`:

```ts
async appendDocketEntry(input: unknown): Promise<CaseBoxDocketEntry> {
  const row = this.#runImmediateWrite((db, deps) => applyAppendDocketEntrySqlite(db, input, deps));
  return structuredClone(row) as CaseBoxDocketEntry;
}
async confirmDocketEntry(entryId: string, opts: ConfirmDocketEntryOpts): Promise<ConfirmDocketEntryResult> {
  const result = this.#runImmediateWrite((db, deps) => applyConfirmDocketEntrySqlite(db, entryId, opts, deps));
  return structuredClone(result) as ConfirmDocketEntryResult;
}
async dismissDocketEntry(entryId: string, opts: DismissDocketEntryOpts): Promise<CaseBoxDocketEntry> { ... }
async getDocketEntry(query: GetDocketEntryQuery): Promise<CaseBoxDocketEntry | null> {
  return getDocketEntrySqlite(this.#db, query);
}
async listDocketEntries(query: ListDocketEntriesQuery): Promise<ListDocketEntriesPage> { ... }
async transitionDeadline(deadlineId: string, opts: DeadlineTransitionOpts): Promise<CaseBoxDeadline> { ... }
async getDeadline(query: GetDeadlineQuery): Promise<CaseBoxDeadline | null> { ... }
async listDeadlines(query: ListDeadlinesQuery): Promise<ListDeadlinesPage> { ... }
```

**Net LOC delta on `SqliteCaseBoxPersistence.ts`: estimated +16-20** (8 stubs × ~2 LOC = ~16 LOC removed; 8 thin calls × ~3-4 LOC = ~24-32 LOC added; net +8-16 LOC). Class lands at ~590 LOC. **B6 D4#2 stays deferred at same band.**

### §1.4 Mode B atomicity invariant

`confirmDocketEntry` IS the critical invariant of B7. The single `db.transaction(() => {...}).immediate()` wraps:

1. Load matter-scoped DocketState + DeadlineState from the DB (two SELECTs).
2. Call `prepareConfirmDocketEntry(docketState, deadlineState, entryId, opts, deps)` → produces `{entry, deadline, audits}` OR `{idempotent: true, entry, deadline, audits: []}`.
3. If idempotent (repeat call with same `opts.deadline_id`): return existing `(entry, deadline)` without further writes.
4. Otherwise:
   a. UPDATE the docket-entry row (status = "confirmed", confirmed_deadline_id = `result.deadline.id`).
   b. INSERT the deadline row.
   c. INSERT both audit events (`DOCKET_ENTRY_CONFIRMED` + `DEADLINE_REGISTERED` — exact event kinds verified against contract).
   d. UPDATE `case_box_audit_chain_heads`.
5. Return `{entry, deadline}` (cloned).

Failure between any sub-step rolls back ALL of (a)-(d). The mandatory crash-injection test (§1.6) proves this.

### §1.5 Crash-injection test

Hardening test:
1. seedMatterDoc + appendDocketEntry to create a Mode-A candidate entry.
2. Set `process.env.CASE_BOX_B7_CRASH_AFTER = "after_docket_update"`.
3. Call confirmDocketEntry. The injection point in `applyConfirmDocketEntrySqlite` throws `Error("crash-injection: after_docket_update")` BEFORE the deadline INSERT.
4. Catch the error.
5. Unset the env var.
6. Assert:
   - Docket-entry row status STILL "candidate" (no partial update).
   - Zero rows in `case_box_deadlines` for this matter.
   - Audit chain head event_count UNCHANGED from pre-confirm value.
   - Zero audit events for `entry.confirmed_deadline_id`.

If any of the five assertions fails, the WI is NOT ready to commit.

### §1.6 Tests

- `tests/sqlite.conformance.test.mjs` — package.json `--test-name-pattern` widened for `6\\.A5\\.*` + `R5\\.2[1-4]`. `B7_EXPECTED_CASE_IDS` extends B6's with 37 new 6.A5.* ids (1..32 + variants 4b, 18a, 18b, 19b, 19c) + R5.21..R5.24 = **41 new cases**. Label `Sqlite-B6` → `Sqlite-B7`. Outside-scope updated (`6.A5.33+` → B8; `6.A6+` → B8; `6.A8+` → B10).

- `tests/sqlite.hardening.test.mjs` — 7 new B7 invariant tests:
  1. **Cross-tenant docket-entry source_document_id rejected** → `tenant_mismatch`.
  2. **Cross-matter docket-entry source_document_id rejected** → `matter_id_mismatch`.
  3. **Mode B crash-injection rollback** (§1.5) — MANDATORY per umbrella §9 risk #2.
  4. **Mode B idempotent replay** — calling confirmDocketEntry with the same `deadline_id` twice produces NO new audit events; existing `(entry, deadline)` returned.
  5. **Mode B duplicate deadline_id from a DIFFERENT entry** → rejection (6.A5.18a SQLite).
  6. **Audit-chain atomic event_count == 5** after createMatter + registerDocument + appendDocketEntry + confirmDocketEntry (which emits 2 events: docket confirmed + deadline materialized).
  7. **Deadline UPDATE-in-place on transition** — single row per deadline.

- **`tests/impl-parity-docket.test.mjs` (NEW)** — 7+ new B7 scenarios:
  1. appendDocketEntry happy path identical.
  2. confirmDocketEntry Mode B identical (returns `{entry, deadline}` deep-equal across impls).
  3. confirmDocketEntry idempotent replay identical.
  4. dismissDocketEntry identical.
  5. transitionDeadline pending → met identical.
  6. transitionDeadline missed → met with reason identical (R5.29 path).
  7. getDeadline / listDeadlines parity (cursor seek across 2 pages).
  8. Rejection parity (cross-tenant; unknown deadlineId; cross-matter source doc).

- `tests/invariants.test.mjs` — 6.2.6b retargets `appendDocketEntry` (now B7-implemented) → `appendEvidenceItem` (B8 next stub).

### §1.7 `impl-parity.test.mjs` MANDATORY SPLIT (per B6 D4#1)

Per B6 plan §6 risk #6 + B6 deferred D4#1: B7 splits the 773-LOC `impl-parity.test.mjs` BEFORE adding new parity tests. Destination files:

| Source content (line range) | Destination file | Est. LOC |
|---|---|---|
| Imports + shared helpers (lines 1-39) | `tests/impl-parity-common.mjs` (utility module, NOT a test file) | ~40 |
| Stub-frontier test (B6.0; line 111-119) | `tests/impl-parity-stub-frontier.test.mjs` | ~30 |
| B1.* tests (matter; lines 40-109) | `tests/impl-parity-matter.test.mjs` | ~90 |
| B2.* tests (document) | `tests/impl-parity-document.test.mjs` | ~120 |
| B3.* tests (audit observability, if any) | `tests/impl-parity-audit.test.mjs` (if any tests exist for B3) | ~60 |
| B4.* tests (confidentiality classification) | `tests/impl-parity-classification.test.mjs` | ~100 |
| B5.* tests (privilege markers) | `tests/impl-parity-privilege.test.mjs` | ~110 |
| B6.* tests (facts) | `tests/impl-parity-facts.test.mjs` | ~130 |
| **B7.* tests (docket entries) (NEW for B7)** | **`tests/impl-parity-docket.test.mjs`** | ~150 |

After the split:
- The original `tests/impl-parity.test.mjs` file is **DELETED**.
- The `package.json` `--test` command updated to include the new files (replacing `tests/impl-parity.test.mjs`).
- Each per-entity file imports shared helpers from `tests/impl-parity-common.mjs`.
- No per-entity file exceeds ~150 LOC (well under 700 warn).

This split is MECHANICAL — it moves existing tests verbatim with NO behavioral change. Tests must continue to pass post-split.

Hardening test file (699 LOC) NOT split in B7 — just under warn. Re-evaluate at B8 if B8 adds new hardening tests pushing it over.

### §1.8 Acceptance criteria (impl WI; this plan-WI does NOT execute)

1. `npm --prefix services/case-box-persistence test` exits 0.
2. SQLite impl passes shared conformance cases `6.A5.*` + `R5.21..R5.24`.
3. The 7 hardening tests pass (especially #3 Mode B crash injection).
4. All per-entity impl-parity files pass (including new docket parity).
5. All Phase A in-memory tests stay green.
6. B1-B6 SQLite tests stay green.
7. ocr-persistence + ocr-worker + case-box-contract + docs/contracts unchanged green.
8. loc-guardian: 0 over fail. `SqliteCaseBoxPersistence.ts` lands at ~590 LOC (B6 D4#2 stays at band). Hardening test file may approach 800 LOC; if it crosses 700 warn, defer split to B8.
9. cc-suite audit (mini) via Path 1 native `--background` (per RCA `d3e1cbc`): PASS or NEEDS-FIX-fixed-and-verified.

---

## §2 LOC budget per file (post-B7)

Current state (post-B6 commit `667bb9c`):

| File | Current LOC | B7 estimated delta | Threshold |
|---|---|---|---|
| `src/sqlite/schema.ts` | 393 | +55 (DDL_V6) | source warn 500 |
| `src/sqlite/SqliteCaseBoxPersistence.ts` | 572 | +16-20 (8 thin calls; OVER warn 500) | warn 500 / fail 800 |
| `src/sqlite/matterRepoQueries.ts` | 89 | 0 | |
| `src/sqlite/documentRepoQueries.ts` | 205 | 0 | |
| `src/sqlite/auditRepoQueries.ts` | 162 | 0 | |
| `src/sqlite/classificationRepoQueries.ts` | 361 | 0 | |
| `src/sqlite/privilegeRepoQueries.ts` | 388 | 0 | |
| `src/sqlite/factsRepoQueries.ts` | 415 | 0 | |
| `src/sqlite/docketRepoQueries.ts` (NEW) | 350-400 est. | new | |
| `src/sqlite/deadlineRepoQueries.ts` (NEW) | 250-300 est. | new | |
| `tests/sqlite.conformance.test.mjs` | 138 | +5 | test warn 700 |
| `tests/sqlite.hardening.test.mjs` | 699 | +130 (7 tests; may cross 700 warn) | test warn 700 |
| `tests/impl-parity.test.mjs` | 773 | **DELETED** in mandatory split | n/a |
| `tests/impl-parity-*.test.mjs` (NEW 7-8 files) | 30-150 each | new | test warn 700 (each comfortably under) |

LOC-growth-prevention posture: `SqliteCaseBoxPersistence.ts` stays at warn band (~590); class growth flat per added method via `#runImmediateWrite`. New SQL helpers in two new sibling files (one each for docket + deadline). impl-parity split ELIMINATES B6 D4#1. Hardening test file MAY cross warn; deferred to B8 split if so.

---

## §3 Hard-stop alignment

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED. No new dep.
- **New runtime dependency** — NOT triggered.
- **Schema migration on PERSISTED REAL DATA** — NOT triggered (`:memory:` + fresh on-disk only).
- **Public API break** — NOT triggered (B7 implements 8 EXISTING stubs).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered.
- **Push / deploy / secrets / production data** — NOT triggered.

Per the no-revert posture: fix-forward; STOP-FOR-ROLLBACK if necessary.

---

## §4 Execution-discipline compliance (per `.claude/rules/execution-discipline.md`)

### §4.1 Think before coding
- WI scope: 8 method impls + 2 new SQL helper files + schema v6 + test extensions + mandatory impl-parity split.
- Assumptions:
  - `prepareAppendDocketEntry`, `prepareConfirmDocketEntry`, `prepareDismissDocketEntry`, `prepareTransitionDeadline` REUSED VERBATIM via shadow state shims.
  - `getDeadlineCalendar` stays `not_implemented` (B10).
  - `appendFactOnce` stays `not_implemented` (B11).
  - SqliteBackedIdSet safe for append paths (helper signature verified: no `.size` reads in DocketState/DeadlineState).
- Hard stops cross-checked: no triggers.

### §4.2 Simplicity first
- Smallest slice: 8 methods + 2 sibling files + 1 schema version + 1 mechanical test split.
- Reuse: every prepare* helper from in-memory + `validateDocumentTarget` shared + cursor utility + `#runImmediateWrite` + `#writeAudit`.
- No speculative abstractions: NO new transaction helper, NO recursive CTE, NO schema-driven query macros.

### §4.3 Surgical changes
- WI authored file list:
  - NEW: `services/case-box-persistence/src/sqlite/docketRepoQueries.ts`.
  - NEW: `services/case-box-persistence/src/sqlite/deadlineRepoQueries.ts`.
  - NEW: `services/case-box-persistence/tests/impl-parity-common.mjs` (shared helpers extracted).
  - NEW: `services/case-box-persistence/tests/impl-parity-{matter,document,classification,privilege,facts,docket,stub-frontier}.test.mjs` (7 files).
  - MODIFIED: schema.ts; SqliteCaseBoxPersistence.ts (8 stub bodies + imports); package.json (filter regex + label + test paths); sqlite.conformance.test.mjs; sqlite.hardening.test.mjs; invariants.test.mjs (6.2.6b retarget); dev-memo/deferred-audit-findings.md (B7 entry + B6 D4#1 closure).
  - DELETED: `services/case-box-persistence/tests/impl-parity.test.mjs`.
- No drive-by refactors. No broad changes to `SqliteCaseBoxPersistence.ts` beyond the 8 stub conversions.

### §4.4 Goal-driven execution
- Acceptance criteria testable (§1.8).
- New tests fail BEFORE impl; pass AFTER.
- cc-suite audit on impl commit via Path 1 native `--background`; verify if fixes applied.
- Do NOT commit until acceptance passes.

### §4.5 Relationship to existing rules
- B7 plan does NOT bypass cc-suite review-plan (this is the review).
- B7 plan does NOT relax loc-guardian thresholds.
- B7 plan respects autonomy hard-stops, rollback policy, night-run policy, execution-discipline floor.
- B7 plan honors CCSUITE-PATH1-RCA-01: use native `--background`, NEVER Bash `run_in_background: true`.

---

## §5 Deferred-Low handling

| Finding | B7 plan position |
|---|---|
| **B5 D1#2** (getPrivilegeStatus perf) | NOT touched. **Stays deferred**. |
| **B5 D2#1** (privilege shadow-state dup) | NOT touched. **Stays deferred**. |
| **B5 D4#2** (global id scan pattern, B4+B5 occurrences) | NOT touched. B7 picks SqliteBackedIdSet for `docketIds`/`deadlineIds` append; no NEW global-scan introduced. **Stays deferred** at 2 occurrences. |
| **B6 D4#1** (impl-parity.test.mjs 773 LOC) | NATURALLY touched per B6 plan's MANDATORY mark. B7 executes the split (§1.7). **Closes** when B7 ships. |
| **B6 D4#2** (SqliteCaseBoxPersistence.ts 572 LOC) | B7 adds +16-20 LOC; class lands at ~590. **Stays deferred** at same band. |

Only B6 D4#1 is naturally fixed by B7 (the mandatory test split). All others stay deferred.

---

## §6 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | **High** | Mode B atomicity is the most subtle B7 invariant. A bug between docket UPDATE and deadline INSERT could leave the DB in inconsistent state (partial confirmation). | (a) Single `db.transaction(() => {...}).immediate()` wraps all five mutations. (b) MANDATORY crash-injection test §1.5 proves rollback. (c) Idempotent-replay test catches the OTHER partial-state shape (replay returns same `(entry, deadline)` without new audits). |
| 2 | Medium | Idempotent replay semantics: `prepareConfirmDocketEntry` returns `{idempotent: true, entry, deadline, audits: []}` when called twice with same `deadline_id`. The SQLite path MUST detect this and skip all writes. | `applyConfirmDocketEntrySqlite` checks `result.idempotent` BEFORE any UPDATE/INSERT. Hardening test #4 covers. |
| 3 | Medium | DeadlineState and DocketState are two separate shadow states. Loading them inconsistently (between the two SELECTs, a concurrent writer commits) could miss a duplicate deadline_id. | Both SELECTs happen INSIDE the `BEGIN IMMEDIATE` transaction. SQLite isolation guarantees a consistent snapshot. |
| 4 | Medium | The mandatory crash-injection test requires an injection seam. Plan picks env-var (`CASE_BOX_B7_CRASH_AFTER`); could leak into production binaries. | Inject only when the env var is set AND the value matches an allow-list of known points. Production code path has the check; cost is ~3 ns per call. Acceptable. Alternative considered: deps callback injection — adds signature complexity. |
| 5 | Medium | Schema v6 has 6 indices across 2 tables. SQLite query planner may pick suboptimal index for some filter combinations. | Acceptable for v1 lawyer-scale. Future perf WI can run EXPLAIN QUERY PLAN. NOT a B7 blocker. |
| 6 | Low | Hardening test file (699 LOC) may cross 700 warn after B7 adds 7 new tests. | Plan does NOT split hardening in B7 (just under warn currently). If post-impl LOC exceeds warn, defer split to B8 (record as B7 deferred Low). |
| 7 | Low | impl-parity split is mechanical but touches many files. A misplaced test or missed import would surface as a missing-test or import-error. | Run full test matrix after the split BEFORE adding B7-specific parity tests. Two-step: (1) split passes, (2) B7 parity tests added on top. |
| 8 | Low | DOCKET_ENTRY_CONFIRMED + DEADLINE_REGISTERED audit event kinds must match the contract exactly. | Plan picks the contract's existing kinds; double-check at impl time. |

---

## §7 cc-suite audit / verify expectations

For the impl WI (NOT this plan-WI):
- **cc-suite audit (mini)** via Path 1 native `--background` on the impl commit's scope. Expected: PASS or NEEDS-FIX with C/H/M fixed + verify.
- **cc-suite verify** ONLY if audit produces C/H/M findings the WI fixes.
- **Recording** per `.claude/rules/cc-suite.md` §"Required recording" 11-field block in the impl commit's message.
- Lows: append per-finding rows to `dev-memo/deferred-audit-findings.md` under a new "Phase B7" entry.

cc-suite execution rule per lane authorization: **NEVER** wrap the runner in Claude Code Bash `run_in_background: true`. Use runner foreground OR runner native `--background` flag. Native `--background` returns jobId in <1s + the worker detaches and survives any harness reaper. State writes land at `${CLAUDE_PLUGIN_DATA}/state/.../jobs/<jobId>.{json,log}`.

---

## §8 References

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B7 + §9 risk #2 (umbrella).
- B1-B6 plans + impls.
- execution-discipline (`9c0966f`).
- `services/case-box-persistence/src/inMemoryDocket.ts` (behavioral target).
- `services/case-box-persistence/src/inMemoryDeadline.ts` (behavioral target).
- `services/case-box-persistence/src/sqlite/{schema,SqliteCaseBoxPersistence,*RepoQueries}.ts`.
- `docs/contracts/case-box-contract/src/case-box-docket-entry*.ts` + `case-box-deadline*.ts` + `transitions.ts`.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` lines for 6.A5.* + R5.21..R5.24.
- B6 audit `audit-mph4cun6-aav6q2` deferred D4#1 (mandatory split).
- CCSUITE-PATH1-RCA-01 (`d3e1cbc`).
- `.claude/rules/cc-suite.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

---

## §9 Stop condition

This plan is stale or superseded when:
- B7 impl commits — plan transitions to "superseded by B7 impl commit `<hash>`".
- Umbrella plan revision changes B7 scope.
- `prepareAppendDocketEntry` / `prepareConfirmDocketEntry` / `prepareTransitionDeadline` contract semantics change.
