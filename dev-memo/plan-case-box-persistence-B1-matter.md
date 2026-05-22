# Plan: CASE-BOX-PERSISTENCE B1 — SQLite matter persistence + package scaffold

**Status**: READY (revision 2 — review-plan v2 returned READY (Low-risk clarifications) at jobId `review-plan-mpgsp55n-jvi8z9`. Three Lows acknowledged but not blocking: B5 enforcement as non-optional gate, helper-extraction trigger discipline, future umbrella amendment for B3 wording).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Umbrella plan**: `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (READY at commit `1ac26b1`) §2 row B1.
**Predecessor closure**: ABI gate CLOSED at commit `d02fff8` (WI-ABI-01-impl); umbrella plan READY at `1ac26b1`.
**Risk**: HIGH (native module + persistence — `.claude/rules/cc-suite.md` §"High-risk WIs").

## Review packet (compact)

### Active plan summary

B1 is the FIRST SQLite sub-WI of Phase B. It does two things together:

1. **Package scaffold + ABI smoke**: add `better-sqlite3` (dependencies) and `@types/better-sqlite3` (devDependencies); add `engines.node: ">=22.0.0 <26.0.0"`; ship a local `services/case-box-persistence/scripts/abi-smoke.mjs` + `pretest` script mirroring `services/ocr-persistence/scripts/abi-smoke.mjs`; update `invariants.test.mjs` 6.2.1 to permit `better-sqlite3` in dependencies.

2. **Matter entity SQLite implementation**: create `src/sqlite/` directory; ship `src/sqlite/SqliteCaseBoxPersistence.ts` skeleton that implements the FULL `CaseBoxPersistence` interface (43 methods) — every method NOT in B1 scope throws `CaseBoxPersistenceError("not_implemented", "<methodName> awaits sub-WI BN")`; ship `src/sqlite/schema.ts` with `DDL_BY_VERSION` map + `schema_version` table + `applySchema()` helper (mirrors `ocr-persistence/src/sqlite/schema.ts`); ship `src/sqlite/openSqliteCaseBoxPersistence.ts` factory; implement `createMatter`, `getMatter`, `archiveMatter`, `unarchiveMatter`; ship `tests/sqlite.conformance.test.mjs` runner using label-substring filter via `node:test --test-name-pattern`; ship `tests/sqlite.hardening.test.mjs` stub (WAL mode + busy_timeout pragma checks); ship `tests/impl-parity.test.mjs` with matter-only scenarios.

Plan is plan-only: no schema diffs land here; no `package.json` change here; no script created here. Implementation is a SEPARATE turn after this plan reaches READY.

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-B1-matter.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/package.json`.
- `services/case-box-persistence/scripts/**` (does not exist yet).
- `services/case-box-persistence/src/sqlite/**` (does not exist yet).
- `services/case-box-persistence/tests/sqlite.*.mjs` (do not exist yet).
- `services/case-box-persistence/tests/invariants.test.mjs` (B1 amends 6.2.1; not in THIS plan).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` (UNCHANGED in B1; the runner uses label-substring filter externally).
- Any contract package or OCR package file.
- AGENTS.md (NO test-command additions in B1; the B1 impl WI adds the SQLite-runner npm test entry).

### Exact acceptance criteria (this plan-WI itself)

1. The plan is committed alone (one file).
2. The plan reproduces the umbrella plan §2 row B1 verbatim and expands it into a concrete impl-WI shape.
3. The plan picks ONE schema v1 DDL (matter + audit_event + audit_chain_heads) and rejects alternatives with reasoning.
4. The plan names the label-substring filter pattern that selects exactly B1's conformance cases (6.1.1..6.1.15 + R5.1..R5.6).
5. The plan declares HARD-STOP categories that DO and DO NOT trigger.
6. The plan declares LOC budget per touched file.
7. The plan declares cc-suite audit + verify expectations for the impl WI.
8. cc-suite review-plan returns READY (or only Low-risk clarifications).

### Exact out-of-scope list (B1; deferred to B2+)

- **No document entity SQLite impl** (B2).
- **No audit-event SQLite append-write path** for entities OTHER than matter (B2+ extend the audit chain).
- **No listAuditEvents / getAuditChainHead / verifyAuditChainForMatter SQLite impls** (B3 — but B1 creates the underlying `case_box_audit_events` + `case_box_audit_chain_heads` tables so B3 wires the read paths without DDL changes).
- **No confidentiality / privilege / fact / docket / deadline / evidence / ocr-link / aggregations / Once impls** (B4..B11).
- **No real-data migration** (no persisted DB exists).
- **No API / UI / mini-program / auth / cloud / sync / LLM / OCR runtime changes.**
- **No new top-level dep beyond `better-sqlite3` + `@types/better-sqlite3`.**
- **No public-API change.** Every public method on `SqliteCaseBoxPersistence` already exists on `InMemoryCaseBoxPersistence`. The `not_implemented` throw is a runtime guard, not an interface mutation.
- **No SQLite-specific public-API additions.**
- **No CI infrastructure.**
- **No git push.**
- **No committed rollback (this lane / future lanes disallow auto-revert by default per `dev-memo/rollback-00.md`).**

### Essential references

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B1, §3 schema management, §4 transaction model, §5 LOC discipline, §6 test strategy.
- `dev-memo/plan-case-box-persistence-00.md` §6 (transaction model: BEGIN IMMEDIATE + audit-chain-head bookkeeping) + §10.2 (phase sequencing).
- `services/ocr-persistence/src/sqlite/schema.ts` — canonical `DDL_BY_VERSION` + `schema_version` + `applySchema` reference.
- `services/ocr-persistence/src/sqlite/openSqliteOcrPersistence.ts` — canonical factory + WAL + busy_timeout reference.
- `services/ocr-persistence/scripts/abi-smoke.mjs` — canonical local smoke reference (copied / adapted in B1).
- `services/case-box-persistence/src/inMemoryMatter.ts` — behavioral target (R-5 successor invariant wired here; mirror in SQLite).
- `services/case-box-persistence/src/inMemoryRepo.ts` — `createMatter` / `archiveMatter` / `unarchiveMatter` call sites + audit event emission.
- `services/case-box-persistence/src/auditChain.ts` — head-hash bookkeeping helper (Map-based in-memory; SQLite mirrors via table).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — shared harness; B1 conformance targets labeled `6.1.1`..`6.1.15` + `R5.1`..`R5.6`.
- `services/case-box-persistence/tests/invariants.test.mjs` 6.2.1 — declares current dep policy; B1 amends.
- `docs/contracts/case-box-contract/src/audit-log.ts` — `canonicalAuditEventHashInput` (reused verbatim).
- `docs/contracts/case-box-contract/src/matter-type-invariants.ts` — `assertValidMatterSuccessor` (already wired in `inMemoryMatter.ts`; reused in SQLite).
- `.claude/rules/cc-suite.md` §"High-risk WIs" + §"Required recording" + §"Retry policy" + §"Audit remediation policy".
- `.claude/rules/autonomy.md` §"Hard-stop list" + §"Overnight lane policy".
- `.claude/rules/loc-guardian.md`.

### Review questions for the reviewer

1. Is the schema v1 DDL minimum (matter + audit_event + audit_chain_heads tables) right for B1, or should B1 ship a more aggressive v1 that includes empty placeholder tables for B2+ entities (`case_box_documents`, etc.) so B2-B11 only run ALTER-free CREATE TABLE IF NOT EXISTS migrations? Plan picks the minimal v1.
2. Is `case_box_audit_events` JSON-blob storage (full event as TEXT) vs columns-per-field the right call for v1, mirroring OCR persistence's submission_json approach? Plan picks JSON-blob.
3. Is the `--test-name-pattern` regex `^Sqlite-B1: (6\.1\.([1-9]$|1[0-5]$|13a$)|R5\.[1-6]$)` precise enough for B1's scope?
4. Should B1 include the `engines.node` upper bound `<26.0.0` (mirroring ocr-persistence), or hold the bound looser until Phase B closes? Plan picks the symmetric upper bound.
5. Is the `not_implemented` throw shape (`CaseBoxPersistenceError("not_implemented", "<methodName> awaits sub-WI BN")`) acceptable, or should it use a different error code? Plan picks `not_implemented` as a new persistence-error code (extends the existing documented set in `invariants.test.mjs` 6.2.6).
6. Should the SQLite hardening stub at B1 also cover FK pragma posture? Case-box uses NO FK constraints (per parent §3 "Dependency direction is one-way; OCR knows nothing about case-box") — plan picks `PRAGMA foreign_keys = ON` is set BUT no FOREIGN KEY constraints are declared, so the pragma is irrelevant in practice; B1 hardening stub verifies it is ON.

---

## §1 B1 scope (verbatim from umbrella + expanded)

### §1.1 Package scaffold

- `services/case-box-persistence/package.json`:
  - Add `"better-sqlite3": "^12.9.0"` to `dependencies` (matches OCR persistence version).
  - Add `"@types/better-sqlite3": "^7.6.13"` to `devDependencies`.
  - Add `"engines": { "node": ">=22.0.0 <26.0.0" }` (matches ocr-persistence pin per umbrella §1.1).
  - Add `"pretest": "node scripts/abi-smoke.mjs"` to scripts.
  - Add `"prebuild": "npm --prefix ../../docs/contracts/case-box-contract run build"` (case-box-contract MUST build before case-box-persistence's `tsc` runs because case-box-persistence imports types from the contract package's `dist/`).
  - Extend `"test"` script with the SQLite conformance + hardening + impl-parity runners.

- `services/case-box-persistence/scripts/abi-smoke.mjs` (NEW; ~15 LOC):
  - Copy of `services/ocr-persistence/scripts/abi-smoke.mjs` with adjusted log prefix `[case-box-abi-smoke]`.
  - `new Database(':memory:')` → `SELECT 1` → close → exit 0. On throw: exit 1.

- `services/case-box-persistence/tests/invariants.test.mjs` 6.2.1:
  - Current assertion: `assert.deepEqual(deps, ["case-box-contract"], ...)`.
  - B1 amends: `assert.deepEqual(deps.sort(), ["better-sqlite3", "case-box-contract"], ...)`. The banned list (`@types/better-sqlite3`, `ocr-persistence`) stays.
  - Inline comment cites this WI as the authorization.

### §1.2 SQLite scaffold

- `services/case-box-persistence/src/sqlite/` (NEW directory).

- `src/sqlite/schema.ts` (NEW; ~150 LOC):
  - `CURRENT_SCHEMA_VERSION = 1`.
  - `DDL_STATEMENTS_V1: ReadonlyArray<string>` — the v1 DDL:
    - `schema_version` table (mirrors OCR: `version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL`).
    - `case_box_matters` table — columns lifted from the matter row (`id TEXT PRIMARY KEY`, `tenant_id TEXT NOT NULL`, `actor_user_id TEXT NOT NULL`, `status TEXT NOT NULL`, `archived_at TEXT`, `created_at TEXT NOT NULL COLLATE BINARY`) + a `payload_json TEXT NOT NULL` column carrying the full matter row (canonical source per OCR pattern; columns lifted only for indexing/filtering). Plus `successor_matter_id TEXT` for R-5(h).
    - Indices:
      - `idx_case_box_matters_by_tenant ON (tenant_id, status, created_at, id)` — supports future `listMatters` (B10) and future `getMatterSummary` lookups.
    - `case_box_audit_events` table — columns lifted from audit-event row + `event_json TEXT NOT NULL` carrying the full event. Used by every Phase B sub-WI from B1 onward.
    - Indices:
      - `idx_case_box_audit_events_by_matter ON (matter_id, sequence)` — supports `listAuditEvents` (B3) seek pagination.
    - `case_box_audit_chain_heads` table — one row per matter_id; columns: `matter_id TEXT PRIMARY KEY`, `head_hash TEXT`, `last_event_id TEXT`, `event_count INTEGER NOT NULL`, `updated_at TEXT NOT NULL`. Updated in the same transaction as the audit event insert.
  - `applySchema(db: Database): void` — idempotent migration runner. Reads `MAX(version)` from `schema_version`; refuses (throws `CaseBoxPersistenceError`) if disk version > `CURRENT_SCHEMA_VERSION` BEFORE any mutation. Applies each missing migration in a single `BEGIN/COMMIT`. Each migration statement uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` to be defensive against operator-applied DDL.

- `src/sqlite/openSqliteCaseBoxPersistence.ts` (NEW; ~50 LOC):
  - `openSqliteCaseBoxPersistence(opts: { path: string; now?: () => Date; generateId?: () => string }): { repo: SqliteCaseBoxPersistence; close: () => void }`.
  - Opens the DB, sets `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = <some-value>` (mirror OCR; plan defers exact value to impl as a tiny readability choice), `PRAGMA foreign_keys = ON` (defensive; no FK constraints declared), calls `applySchema(db)`, returns the repo wrapper.

- `src/sqlite/SqliteCaseBoxPersistence.ts` (NEW; ~400 LOC including not_implemented stubs):
  - Class implementing the full `CaseBoxPersistence` interface (43 prototype methods).
  - Methods in B1 scope (`createMatter`, `getMatter`, `archiveMatter`, `unarchiveMatter`) are implemented; all others throw `CaseBoxPersistenceError("not_implemented", "<methodName> awaits sub-WI B{N}")`.
  - Per-entity logic delegated to sibling files when LOC budget demands (per umbrella §5 LOC-01-style; B1 estimate is ~400 LOC for the scaffold + matter methods + 39 `not_implemented` stubs; below 800 fail threshold).

- `src/index.ts` — extend exports:
  - `export { openSqliteCaseBoxPersistence } from "./sqlite/openSqliteCaseBoxPersistence.js"`.
  - `export { SqliteCaseBoxPersistence } from "./sqlite/SqliteCaseBoxPersistence.js"` (type export only is sufficient; class export is fine).

### §1.3 Tests

- `tests/sqlite.conformance.test.mjs` (NEW; ~40 LOC):
  - Thin runner: imports `runConformance` from the shared harness; invokes `runConformance("Sqlite-B1", sqliteFactory)`.
  - `sqliteFactory()` returns a fresh `{ p: SqliteCaseBoxPersistence; cleanup: () => void }` with an in-memory DB (`:memory:`).
  - `node:test --test-name-pattern` regex (CANONICAL per umbrella §2): `^Sqlite-B1: (?:6\.1\.(?:13a|[1-9]|1[0-5])|R5\.[1-6])(?:\s|$)` — exactly B1's conformance cases. (Per rev-1 reviewer Dim-3 #1, the inner `$` anchors must NOT close the line since test names continue with descriptions; the trailing `(?:\s|$)` lookahead allows the regex to match `Sqlite-B1: 6.1.1 createMatter happy path` etc.)
  - **Preflight assertion** (per Dim-3 #1 mitigation): the runner first lists which test names match the regex against a known fixture set; fails loudly if the count differs from the expected ~20 cases.
  - All other harness cases skip (they would throw `not_implemented` on first method call; the regex prevents execution).

- `tests/sqlite.hardening.test.mjs` (NEW; ~50 LOC):
  - Asserts `PRAGMA journal_mode` returns `wal`.
  - Asserts `PRAGMA busy_timeout` is non-zero.
  - Asserts `PRAGMA foreign_keys` returns 1 (ON).
  - Asserts `applySchema` is idempotent (apply twice; second apply is a no-op).
  - Asserts `applySchema` refuses a future-version (v2) DB before any mutation (write a `schema_version` row with `version = 2`, then expect `applySchema` to throw).

- `tests/impl-parity.test.mjs` (NEW; ~80 LOC):
  - Matter-only scenarios. Build identical inputs, run against BOTH `InMemoryCaseBoxPersistence` AND `SqliteCaseBoxPersistence`, deep-compare returned matter rows + emitted audit events.
  - Cases: createMatter happy path (incl. all R-5(j) fields); createMatter with successor_matter_id (R5.2..R5.6); archiveMatter → getMatter round-trip; unarchiveMatter → getMatter round-trip.
  - Audit comparison: `getAuditChainHead` would normally compare too, but `getAuditChainHead` is in B3 — for B1 parity, the impl-parity test reads the underlying `audit_chain_heads` table directly (acceptable B1-scoped white-box).

### §1.4 Acceptance criteria (impl WI; this plan-WI does NOT execute)

1. `npm --prefix services/case-box-persistence test` exits 0 with the NEW test files running.
2. `npm --prefix services/case-box-persistence test` includes the `pretest` smoke run (`[case-box-abi-smoke] OK`).
3. Conformance pattern matches exactly B1's scope (~20 cases: 6.1.1..6.1.15 + R5.1..R5.6).
4. impl-parity tests deep-compare matter + audit-chain-head behavior across both impls.
5. All Phase A in-memory tests stay green (29x + R5/R6 + 4 boundary tests = 299/0 prior; B1 must preserve this exactly).
6. `npm --prefix services/ocr-persistence test` stays green (no cross-package coupling).
7. `npm --prefix docs/contracts/case-box-contract test` stays green.
8. loc-guardian: 0 over fail (see §5 budget below).
9. No Ajv strictRequired warnings.
10. cc-suite audit (mini) PASS or NEEDS-FIX-fixed-and-verified.

---

## §2 Schema v1 (decision matrix)

| Option | What v1 ships | Pros | Cons |
|---|---|---|---|
| **α — Minimal v1** (recommended) | Only matter + audit_event + audit_chain_heads tables. B2-B11 add their tables via `DDL_STATEMENTS_V2..V11`. | Smallest blast radius for B1; each subsequent sub-WI's schema diff is isolated to its own DDL_V_N file. | Increments `CURRENT_SCHEMA_VERSION` per sub-WI (B2 = v2, B3 = v3, ...); the version table accumulates rows quickly. |
| β — Full v1 placeholders | All future tables (`case_box_documents`, `case_box_facts`, etc.) ship as empty placeholders in v1; B2-B11 only ALTER. | One DDL version for all of Phase B. | Larger v1 blast radius; placeholder columns may differ from final shapes; B2-B11 would need ALTER TABLE for column adds. SQLite ALTER is limited; this courts pain. |
| γ — Per-sub-WI fresh DB | Each B sub-WI uses its own DB file (no shared schema). | Trivial schema migration. | Defeats the conformance harness's "one persistence instance, all entities" assumption. Reject. |

**Pick α**. Mirrors OCR persistence's incremental pattern (`CURRENT_SCHEMA_VERSION = 3` after three migration ships).

**Divergence note vs umbrella plan** (per rev-1 reviewer Dim-1 #2): the umbrella plan §2 row B3 says "`audit_chain_heads` table introduced". B1 introduces the table at v1 because matter writes emit audit events from day one and the head must be tracked in the SAME transaction as the event insert. B3 wires the READ APIs (`listAuditEvents`, `getAuditChainHead`, `verifyAuditChainForMatter`), not the table introduction. A follow-up docs-only WI amends the umbrella plan B3 row wording to "audit read APIs wired" — out of THIS plan's scope.

---

## §3 Schema v1 DDL (concrete)

This is the v1 the impl WI ships. The plan does NOT commit this DDL; the impl WI does.

```sql
-- Version table (mirrors OCR persistence).
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- Matter rows. Payload-JSON is the canonical source; columns lifted only
-- for indexing.
CREATE TABLE IF NOT EXISTS case_box_matters (
  id                     TEXT    PRIMARY KEY,
  tenant_id              TEXT    NOT NULL,
  actor_user_id          TEXT    NOT NULL,
  status                 TEXT    NOT NULL CHECK (status IN ('active','archived')),
  archived_at            TEXT,
  created_at             TEXT    NOT NULL COLLATE BINARY,
  successor_matter_id    TEXT,
  payload_json           TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_box_matters_by_tenant
  ON case_box_matters (tenant_id, status, created_at, id);

-- Audit events. Per-event hash chain head lives in case_box_audit_chain_heads.
CREATE TABLE IF NOT EXISTS case_box_audit_events (
  event_id          TEXT    PRIMARY KEY,
  tenant_id         TEXT    NOT NULL,
  matter_id         TEXT    NOT NULL,
  sequence          INTEGER NOT NULL,
  action            TEXT    NOT NULL,
  entity_type       TEXT    NOT NULL,
  entity_id         TEXT,
  actor_user_id     TEXT    NOT NULL,
  timestamp         TEXT    NOT NULL COLLATE BINARY,
  before_state_hash TEXT,
  after_state_hash  TEXT,
  prev_event_hash   TEXT,
  event_hash        TEXT    NOT NULL,
  reason            TEXT,
  event_json        TEXT    NOT NULL,
  UNIQUE (matter_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_case_box_audit_events_by_matter
  ON case_box_audit_events (matter_id, sequence);

-- Per-matter audit chain head. Updated in the SAME transaction as the
-- event insert; this is the load-bearing replay-safety invariant.
CREATE TABLE IF NOT EXISTS case_box_audit_chain_heads (
  matter_id     TEXT    PRIMARY KEY,
  head_hash     TEXT,
  last_event_id TEXT,
  event_count   INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT    NOT NULL COLLATE BINARY
);

-- The `schema_version` row is NOT a DDL statement. `applySchema()` records
-- version application via a prepared statement bound to the current ISO
-- timestamp:
--   db.prepare("INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)")
--     .run(version, new Date().toISOString());
-- (Mirrors OCR persistence's `applySchema` pattern; the version row is
-- written as part of the migration loop, not as DDL_STATEMENTS_V1.)
```

The matter `payload_json` carries the full row including R-5(j) free-text fields + `successor_matter_id`; columns lifted to dedicated columns are only for filter/index efficiency. On `getMatter`, the row's `payload_json` is parsed and returned VERBATIM — never reconstructed from columns. This mirrors OCR persistence's canonical-source rule.

No FOREIGN KEY constraints between tables. `case-box-audit-events.matter_id` is NOT a FK to `case_box_matters.id` (per parent §4 "No FK from case-box to OCR" and the design generalization "audit events outlive matters they reference").

---

## §4 Transaction model

Per umbrella §4 + parent §6:

- Every write operation uses `db.transaction(fn).immediate()` (synchronous `BEGIN IMMEDIATE`).
- `createMatter`:
  1. Parse + validate payload via `validateMatter` (contract validator).
  2. Apply local-only-external-flag rejection (per `inMemoryMatter.ts` §"prepareCreateMatter").
  3. Call `assertValidMatterSuccessor` (contract helper) if `successor_matter_id` is set. Successor lookup uses `getMatterById` via a SELECT inside the transaction.
  4. Pre-insert duplicate-id check (SELECT against `case_box_matters.id`).
  5. INSERT INTO `case_box_matters`.
  6. INSERT INTO `case_box_audit_events` (kind `MATTER_REGISTERED`, sequence = 1, prev_event_hash = NULL, event_hash via `canonicalAuditEventHashInput` + sha256).
  7. INSERT (OR REPLACE) INTO `case_box_audit_chain_heads`.
- `archiveMatter` / `unarchiveMatter`:
  1. SELECT current matter row.
  2. `assertValidMatterTransition` (contract).
  3. UPDATE `case_box_matters` (status + archived_at + payload_json refresh).
  4. SELECT current `case_box_audit_chain_heads` row for `prev_event_hash`.
  5. INSERT `case_box_audit_events` (kind `MATTER_ARCHIVED` or `MATTER_UNARCHIVED`).
  6. UPDATE `case_box_audit_chain_heads` (head_hash + last_event_id + event_count + updated_at).

`canonicalAuditEventHashInput` from `docs/contracts/case-box-contract/src/audit-log.ts` is reused VERBATIM. The plan does NOT re-derive the canonicalization.

---

## §5 LOC budget per file

| File | Estimated LOC | Threshold | Status |
|---|---|---|---|
| `src/sqlite/schema.ts` | ~150 | source warn 500 / fail 800 | fine |
| `src/sqlite/openSqliteCaseBoxPersistence.ts` | ~50 | same | fine |
| `src/sqlite/SqliteCaseBoxPersistence.ts` | ~400 (scaffold + matter + 39 stubs) | same | fine |
| `src/index.ts` | +2 lines | n/a | fine |
| `tests/sqlite.conformance.test.mjs` | ~40 | test warn 700 / fail 1200 | fine |
| `tests/sqlite.hardening.test.mjs` | ~50 | same | fine |
| `tests/impl-parity.test.mjs` | ~80 | same | fine |
| `scripts/abi-smoke.mjs` | ~15 | n/a (script, exempt) | fine |
| `package.json` | ~5-line delta | n/a | fine |
| `tests/invariants.test.mjs` | +1-2 lines | same | fine |

No file approaches a fail threshold. LOC-01-style per-entity-repo extraction NOT needed at B1 because matter is one of 11 entities and stubs are tiny (one-line throw each).

---

## §6 Idempotency / Once behavior

B1 does NOT include Once writers (those are B11). B1's `createMatter` throws `duplicate_id` on second call with the same id — same behavior as in-memory. The `audit_chain_heads.event_count` field is incremented in the same transaction as the audit-event insert; it serves as the load-bearing source of truth for "has the chain been written N times for this matter".

---

## §7 Migration assumptions

- **No persisted DB exists.** `:memory:` for tests; `apps/lawbar-desktop/` (post-v1) would open a real file path. B1 implementation does NOT ship a real-data migration story.
- **applySchema is idempotent.** Calling it twice in a process lifetime is a no-op; reading a DB at v=1 with a build that supports v=1 is a no-op; reading a DB at v=0 (no `schema_version` table or row) triggers initial migration; reading a DB at v=N+1 throws BEFORE any mutation.
- **`PRAGMA foreign_keys = ON` is set per-connection** (matches OCR persistence's note in `schema.ts`). The pragma is irrelevant in practice (no FK constraints) but set defensively.

---

## §8 Crash / replay risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Single-statement insert + audit-chain-head update split across two transactions → partial state on crash. | All writes are in ONE `db.transaction().immediate()` per parent §6. SQLite guarantees atomic commit/rollback per transaction. |
| 2 | `audit_chain_heads.head_hash` UPDATE happens AFTER `case_box_audit_events` INSERT inside the same tx; if a hardware crash interrupts mid-tx, SQLite rolls back the entire transaction — head reverts to pre-tx state along with the event row. | No mitigation needed; SQLite WAL replay covers this. Hardening test (B5+) injects a process crash mid-transaction and verifies both tables revert. |
| 3 | Successor matter lookup inside `createMatter` SELECT could race with a concurrent insert. | `BEGIN IMMEDIATE` takes a reserved lock at transaction start; the SELECT happens after the lock is held. No race possible against a SECOND writer. |
| 4 | The `audit_chain_heads` table starts empty; first `MATTER_REGISTERED` event's INSERT-OR-REPLACE creates the head row with `event_count = 1`. If the INSERT order is wrong (head row created BEFORE event row), the head briefly references a non-existent event. | Order: INSERT audit event first; THEN UPSERT head. Same transaction → no external observer sees the inconsistent intermediate state. |

No Critical risks.

---

## §9 Tests to prove parity with in-memory

§1.3 enumerates the three new test files. Parity matrix:

| Scenario | In-memory test (existing) | SQLite test (B1) | Comparison method |
|---|---|---|---|
| `6.1.1..6.1.15` (matter lifecycle) | runs via inMemory.conformance.test.mjs | runs via sqlite.conformance.test.mjs with `--test-name-pattern ^Sqlite-B1` | Same assertions; harness is implementation-agnostic. |
| `R5.1..R5.6` (matter successor + R-5(j) fields) | runs via inMemory.conformance.test.mjs | runs via sqlite.conformance.test.mjs (same pattern) | Same assertions. |
| createMatter + R5(j) free-text round-trip | in-memory R5.1 covers it | impl-parity test deep-compares the matter row returned by both impls | Deep-equal on returned matter. |
| createMatter with successor (R5.2) | in-memory R5.2 covers it | impl-parity test deep-compares both returned successor + original | Deep-equal on both rows. |
| Audit-chain head after MATTER_REGISTERED | implicit (no public API to read head at B1; B3 wires it) | impl-parity test reads `case_box_audit_chain_heads` table directly (white-box) AND compares with `auditByMatter` Map's head computed in-memory | head_hash + event_count + last_event_id all equal. **Invariant (per Dim-2 #3 + Dim-4 #1)**: `case_box_audit_chain_heads.event_count == (SELECT COUNT(*) FROM case_box_audit_events WHERE matter_id = ?) == (SELECT MAX(sequence) FROM case_box_audit_events WHERE matter_id = ?)`. B1 hardening test asserts this triple equality for every matter after every committed write. |
| Archive + unarchive round-trip | 6.1.11..6.1.15 | conformance pattern + impl-parity deep-compare | Same. |

---

## §10 Hard-stop alignment

- **SQLite / better-sqlite3 / native-module work** (`.claude/rules/autonomy.md` hard-stop) — TRIGGERED at B1 impl. B1 plan does NOT execute; B1 impl is a SEPARATE explicit user authorization.
- **New runtime dependency** — TRIGGERED at B1 impl (adds `better-sqlite3` to case-box-persistence dependencies). Same authorization gate.
- **Schema introduction on persisted data** — NOT triggered (no real DB exists; `:memory:` only for tests).
- **Public API break** — NOT triggered (`SqliteCaseBoxPersistence` implements existing interface; `not_implemented` is a runtime throw, not a signature mutation).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered.
- **Push / deploy / secrets / production data** — NOT triggered (absolute global hard stops; never).

---

## §11 cc-suite audit / verify expectations

For the impl WI (NOT this plan-WI):

- **cc-suite review-plan**: this plan-WI runs review-plan; B1 impl assumes the plan is READY and does NOT re-review.
- **cc-suite audit (mini)** on the impl commit's scope:
  - Files: `services/case-box-persistence/package.json` + `scripts/abi-smoke.mjs` + `src/sqlite/*.ts` (NEW) + `src/index.ts` + `tests/sqlite.conformance.test.mjs` (NEW) + `tests/sqlite.hardening.test.mjs` (NEW) + `tests/impl-parity.test.mjs` (NEW) + `tests/invariants.test.mjs` (modified 6.2.1).
  - Expected: PASS or NEEDS-FIX with Lows fixed in same commit.
- **cc-suite verify**: only if audit produces Critical/High/Medium findings that the WI fixed.
- **Recording**: per `.claude/rules/cc-suite.md` §"Required recording" 11-field block in the impl commit's message body.

---

## §12 Out-of-scope for B2+ (canonical, restated)

- B2: document entity SQLite + R5.7..R5.14 (document purpose/work-order/lifecycle/supersession) + R6.1..R6.4 (doc-asset).
- B3: audit observability (`listAuditEvents`, `getAuditChainHead`, `verifyAuditChainForMatter`).
- B4: confidentiality classification.
- B5: privilege markers + initial SQLite hardening (split-allowed).
- B6: facts + R5.15..R5.18.
- B7: docket entry + deadline materialization + mandatory crash-injection test.
- B8: evidence item + R5.19..R5.20.
- B9: OCR link.
- B10: read-side aggregations.
- B11: replay-safe `*Once` variants + final full-harness no-filter run.

Phase B complete at B11. B1 commits exactly one bounded code change; the next B sub-WI requires SEPARATE explicit user authorization.

---

## §13 Risks (this plan-WI's risk register)

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Low | The `not_implemented` throw shape (`CaseBoxPersistenceError("not_implemented", "...")`) extends the existing documented error code set. `invariants.test.mjs` 6.2.6 asserts errors are one of the documented set. | B1 impl WI updates 6.2.6 to include `"not_implemented"` in the known set, with a comment that the code is a B-series scaffolding error meant to be retired by B11. **Per rev-1 Dim-3 #3**: 6.2.6 currently exercises in-memory only; B1 impl WI adds a parallel SQLite case (e.g., `await sqliteRepo.registerDocument(...) → catch.code === "not_implemented"`) so the code is asserted to be emitted, not just documented. |
| 2 | Low | The `payload_json` column duplicates fields that exist as lifted columns. Updates to `case_box_matters` must keep both in sync. | `inMemoryMatter.ts`'s pattern is `structuredClone(matter)` → store; SQLite does `UPDATE ... SET payload_json = ?, status = ?, archived_at = ?`. The impl WI's helper composes the SET clause from the next-state row to keep columns + JSON byte-identical. Tests verify round-trip. |
| 3 | Medium | The conformance harness's `${label}` placement does NOT match the original rev-1 regex `^Sqlite-B1: (6\.1\.([1-9]$|1[0-5]$|13a)|R5\.[1-6]$)` because the `$` anchors close mid-name. (Rev-1 Dim-3 #1.) | Rev-2 regex is `^Sqlite-B1: (?:6\.1\.(?:13a|[1-9]|1[0-5])|R5\.[1-6])(?:\s|$)` — anchored at start, with trailing whitespace-or-end. Preflight assertion in the conformance runner counts matched names. |
| 4 | Medium | §3 DDL block originally contained `INSERT ... VALUES (1, <now>)` pseudo-token (not executable SQL). (Rev-1 Dim-3 #2.) | DDL block updated to clarify the schema_version row is written by `applySchema()` via a prepared statement at migration time, NOT inside `DDL_STATEMENTS_V1`. |
| 5 | Low | `applySchema` future-version refusal test (B1 hardening) requires a specific failure-shape; mirroring OCR persistence's tests is sufficient. | impl WI references `services/ocr-persistence/tests/sqlite.hardening.test.mjs` for the canonical assertion shape. |
| 6 | Low | `SqliteCaseBoxPersistence.ts` estimated ~400 LOC for scaffold + matter + 39 `not_implemented` stubs is tight if audit-event/transaction helpers live inline. (Rev-1 Dim-5 #2.) | LOC budget §5 already lists this; B1 impl WI extracts transaction + audit helpers to sibling files (e.g., `src/sqlite/transactions.ts`, `src/sqlite/auditChain.ts`) as soon as the class approaches 500 pure LOC. |
| 7 | Low | B1 hardening stub vs B5 deeper hardening boundary. (Rev-1 Dim-4 #2.) | B1 hardening = pragma + schema-version smoke ONLY (`PRAGMA journal_mode`, `PRAGMA busy_timeout`, `PRAGMA foreign_keys`, `applySchema` idempotency + future-version refusal). B5 (or split B-hardening) covers crash-injection + WAL replay + multi-transaction failure modes. Stated explicitly in §1.3 hardening test. |

No Critical / High risks. Two Mediums (both addressed in-plan as of rev-2 edits).

---

## §14 cc-suite review (this plan-WI)

HIGH-RISK per the parent + umbrella plans. cc-suite review-plan via Path 1 broker; CCSUITE-02 retry policy if attempt 1 times out (per umbrella plan's prior Path-2 fallback).

After cc-suite returns READY (or only Low-risk clarifications), the plan is committed. B1 implementation is a SEPARATE follow-up turn requiring explicit user authorization (native module hard-stop).

---

## §15 References

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (umbrella plan; READY at `1ac26b1`).
- `dev-memo/plan-case-box-persistence-00.md` §6, §10.
- `dev-memo/plan-abi-00-better-sqlite3.md` + commit `d02fff8` (predecessor; ABI gate closed).
- `services/ocr-persistence/src/sqlite/schema.ts`, `openSqliteOcrPersistence.ts` (canonical reference).
- `services/case-box-persistence/src/inMemoryMatter.ts`, `inMemoryRepo.ts`, `auditChain.ts` (behavioral target).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` (shared harness; 6.1.1..6.1.15 + R5.1..R5.6 labels).
- `services/case-box-persistence/tests/invariants.test.mjs` 6.2.1 + 6.2.6 (deps allowlist + error-code allowlist).
- `docs/contracts/case-box-contract/src/{audit-log.ts,matter-type-invariants.ts}`.
- `.claude/rules/cc-suite.md`, `autonomy.md`, `loc-guardian.md`, `staging-hygiene.md`.

---

## §16 Stop condition

This plan is stale or superseded when:

- B1 impl commits — plan transitions from `READY` to "superseded by B1 impl commit `<hash>`"; file stays as historical reference.
- A future revision of the umbrella plan changes B1 scope — this plan amends or retires.
- Phase B is abandoned (driver swap or similar) — this plan retires with the dep.
