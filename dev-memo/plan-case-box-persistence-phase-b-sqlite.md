# Plan: CASE-BOX-PERSISTENCE Phase B — SQLite implementation

**Status**: READY (revision 3 — Path-2 inline second-pass returned READY (Low-risk clarifications) per CCSUITE-02 retry policy. Three Low cleanups applied opportunistically: normalized B1..B9 → B1..B11 throughout; re-anchored §9 Risk #6 to B2; clarified `--test-name-pattern` is CANONICAL with hand-curated list only as inline-justified fallback. Path-1 attempts 2 + 3 both TIMEOUT'd; Path 2 succeeded after 1 pass + 1 verification pass.).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction (lane NIGHT-RUN-ABI-TO-SQLITE-PLAN, allowed WI #2).
**Branch**: main.
**Parent plan**: `dev-memo/plan-case-box-persistence-00.md` §2 (storage targets), §6 (transaction model), §7 (ABI baseline; NOW RESOLVED via WI-ABI-01-impl commit `d02fff8`), §10 (sequencing).
**Predecessor closure**: ABI gate CLOSED at commit `d02fff8` (this lane's WI #1). Phase A in-memory series A1-A9 COMPLETE at commit `1af6ca7` (A9) + subsequent additive WIs (R-5 matter-type, R-6 doc-asset). All current Phase A conformance: 299/0 tests green.
**Risk**: HIGH (native module + persistence + multi-package downstream per `.claude/rules/cc-suite.md` §"High-risk WIs").

## Review packet (compact)

### Active plan summary

Phase B is the SQLite-backed implementation of `CaseBoxPersistence`, sitting behind the same interface the in-memory `InMemoryCaseBoxPersistence` already satisfies (Phase A1-A9, all R-5 + R-6 absorption). The implementation lives at `services/case-box-persistence/src/sqlite/` and mirrors `services/ocr-persistence/src/sqlite/` proven patterns: `better-sqlite3` synchronous driver, `BEGIN IMMEDIATE` transactions, `applySchema()` versioned-migration helper, WAL journal mode, busy_timeout, partial-unique indexes for queue-style writes, LOC-01-style sibling-module extraction. The shared `runCaseBoxPersistenceConformance.mjs` harness (already exists; 3793+ LOC under the §"Hand-written test" shared-harness exemption per `.claude/rules/loc-guardian.md`) is reused verbatim — Phase B's SQLite impl must pass every conformance case the in-memory impl already passes.

Phase B is SEQUENCED. Each sub-WI ships **one entity at a time** (per parent plan §10 ordering), mirroring Phase A's sub-WI cadence. Each sub-WI commits independently with its own cc-suite review-plan + audit + verify pass. NO single big-bang SQLite WI. The plan below is the **umbrella plan**; each sub-WI (B1, B2, ..., B9) opens with its own per-WI plan after this umbrella reaches READY.

This plan is PLAN-ONLY: no code, no schemas, no migrations, no `better-sqlite3` import — those land in B1 onward.

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/**` (no source, no test edits).
- `services/case-box-persistence/package.json` (no `better-sqlite3` dep added in THIS plan; B1 sub-WI adds it).
- Any contract package.
- Any OCR package.
- AGENTS.md (no test-command additions in THIS plan; B-series sub-WIs add `sqlite.conformance.test.mjs` per their per-WI plans).
- `dev-memo/plan-case-box-persistence-00.md` (parent plan; not amended here; the addendum lives in a future docs WI when Phase B closes).
- Any `*.sqlite` / `*.db` file (none in the repo).

### Exact acceptance criteria (this plan-WI itself)

1. The plan is committed alone (one file). No code, no schemas, no `package.json` mutation, no `node_modules/` change.
2. The plan reuses the parent's §6 transaction model + §7 ABI gate (now resolved) + §8 test strategy without re-deciding them. Anything contradicting the parent plan triggers a `RECONCILIATION-NEEDED` flag here.
3. The plan enumerates B1..B11 sub-WI scope by exact entity name, mirroring the A1-A9 cadence.
4. The plan picks ONE schema-management approach (versioned `applySchema()` mirroring `ocr-persistence/src/sqlite/schema.ts`) and rejects alternatives with reasoning.
5. The plan declares the LOC-01-style sibling-module extraction posture from day one (no single-file >800 pure LOC).
6. The plan names the conformance test the SQLite impl must pass per sub-WI (`runCaseBoxPersistenceConformance.mjs` invoked from a new `sqlite.conformance.test.mjs` runner; the in-memory runner stays).
7. The plan declares HARD-STOP categories that DO and DO NOT trigger.
8. cc-suite review-plan returns READY (or only Low-risk clarifications). CCSUITE-02 retry policy applies if attempt 1 times out.

### Exact out-of-scope list (for THIS plan-WI AND every B-series sub-WI inheritor)

- **No new top-level dependency beyond what Phase B requires.** Phase B requires adding `better-sqlite3` (and `@types/better-sqlite3`) to `services/case-box-persistence/package.json` — this is a NEW runtime dep on the case-box side (it already exists on the OCR side). The B1 sub-WI authorizes the dep addition under the same lane authority that authorized the ABI WI. NO sibling packages (no `node-pre-gyp`, no `node-gyp-build`, no `better-sqlite3-multiple-ciphers`).
- **No driver swap.** `better-sqlite3` only. No `sql.js`, no `node:sqlite`, no Postgres, no SQLite wasm.
- **No contract changes.** `case-box-contract` is the wire-format / vocabulary owner; Phase B is purely a persistence implementation behind the existing interface. If Phase B uncovers a need to extend the contract (e.g., a new error code, a new state-machine transition), that triggers a separate cc-suite review-plan + a contract WI, NOT a hand-edit inside a B sub-WI.
- **No UI / API / mini-program / auth / cloud / LLM / OCR runtime.**
- **No CI workflow** (`.github/workflows/**` does not exist; this plan does NOT introduce it).
- **No migration tooling beyond `applySchema()`.** No CLI migration runner, no data-migration scripts (no production DB exists).
- **No production-data operations.** Phase B writes ONLY test-shaped data via the conformance harness.
- **No SQLite-specific public-API additions.** Every public method on `SqliteCaseBoxPersistence` must already exist on the in-memory implementation. If a SQLite-only method is genuinely needed (e.g., a `vacuum()` helper), it's a separate `dev-memo/plan-case-box-sqlite-utility-*.md` WI.
- **No bypass of explicit-staging discipline.**
- **No git push.**
- **No committed rollback** (NIGHT-RUN-ABI-TO-SQLITE-PLAN lane authorization sets "Rollback of committed work allowed?" = NO).

### Essential references

- `dev-memo/plan-case-box-persistence-00.md` §1 (package location), §2 (storage targets table — Phase B = `SqliteCaseBoxPersistence` with `better-sqlite3` synchronous), §6 (transaction model: BEGIN IMMEDIATE + audit-chain head bookkeeping), §7 (ABI baseline, now resolved), §8 (test strategy: conformance + invariants + hardening), §10.2 (phase sequencing table including B1+).
- `services/ocr-persistence/src/sqlite/**` — the canonical reference for synchronous-`better-sqlite3` patterns: `applySchema()`, transaction wrappers, partial-unique indexes, `WAL` + `busy_timeout` pragmas, `BEGIN IMMEDIATE`.
- `services/case-box-persistence/src/inMemory*.ts` — the implementation Phase B must mirror behaviorally (every test that passes against in-memory must pass against SQLite).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — the shared harness Phase B will execute against `SqliteCaseBoxPersistence`.
- `docs/contracts/case-box-contract/**` — wire format and validators (consumed read-only).
- `dev-memo/plan-abi-00-better-sqlite3.md` — predecessor; ABI gate closure at commit `d02fff8`.
- `.claude/rules/cc-suite.md` §"High-risk WIs" + §"Required recording" + §"Retry policy".
- `.claude/rules/autonomy.md` §"Hard-stop list" + §"Overnight lane policy".
- `.claude/rules/loc-guardian.md` (B-series sub-WIs follow LOC-01-style extraction from day one).
- `dev-memo/night-run-00.md` (lane policy; NIGHT-RUN-ABI-TO-SQLITE-PLAN authorization governs).

### Review questions for the reviewer

1. Does the B1..B11 sub-WI breakdown correctly mirror A1..A9 (with B9-B11 expanding the former A7-A8-A9 trio into three distinct sub-WIs per rev-2 Path-2 reviewer finding), OR should Phase B group some entities into combined sub-WIs to reduce ceremony (e.g., B-confidentiality-privilege as one)?
2. Is the schema-versioning approach (`applySchema()` mirroring `ocr-persistence/src/sqlite/schema.ts`) right for case-box, given case-box has more entities (matter / document / fact / evidence / docket-entry / deadline / privilege-marker / confidentiality-classification / audit-event / ocr-link / R-5 additions / R-6 additions)?
3. Should Phase B add `better-sqlite3` as a `dependencies` entry (production-shaped) or `devDependencies` (test-only)? OCR persistence has it under `dependencies`. Plan picks `dependencies` for symmetry, but reviewer may prefer `devDependencies` until the desktop app actually consumes case-box-persistence.
4. Does the audit-chain integrity carry through the in-memory → SQLite transition without changes? Specifically: the `canonicalAuditEventHashInput` helper from the contract is reused; the head-hash storage moves from `Map<matter_id, headHash>` (in-memory) to an `audit_chain_heads` table (SQLite). Verify this is mechanical, not semantic.
5. Should Phase B introduce a `sqlite.hardening.test.mjs` (mirroring OCR-persistence) as a sub-WI of its own, or fold it into the per-entity sub-WIs?
6. Is the per-sub-WI commit cadence acceptable (B1..B11 = up to 11 commits, post rev-2 split), or should Phase B combine multiple entities per commit to reduce review overhead?

---

## §1 Scope

### In scope

1. The B1..B11 SQLite implementation per the parent plan §10.2 sequencing table.
2. `services/case-box-persistence/src/sqlite/` directory creation in B1.
3. `services/case-box-persistence/package.json` dep addition (B1).
4. `tests/sqlite.conformance.test.mjs` runner (B1) invoking the existing shared harness.
5. `tests/sqlite.hardening.test.mjs` (B5 or B-hardening) for SQLite-specific concerns (WAL mode, busy_timeout, FK pragmas, replay safety under crash injection).
6. Per-sub-WI cc-suite review-plan + audit + verify.

### Out of scope

(Restated above in §"Exact out-of-scope list".)

---

## §2 Sub-WI sequencing (B1..B11)

Mirrors Phase A's cadence. Each sub-WI authorizes ONE bounded code change. Each sub-WI commits independently.

**Incremental conformance strategy** (per reviewer Dim-1 #1 + Dim-2 #4 + Dim-3 #3): the shared harness creates a full `Persistence` instance and runs ALL cases by default — partial SQLite impls cannot honestly run it green. **Resolution**: from B1 onward, `SqliteCaseBoxPersistence` implements the full `CaseBoxPersistence` interface. Methods not yet implemented in the current sub-WI throw `CaseBoxPersistenceError("not_implemented", "<method> awaits sub-WI BN")`.

**Filter mechanism — DECIDED**: label-substring filtering on the shared harness's `${label}: <N>...` test naming convention. The harness already labels every `test(...)` invocation as `` `${label}: 6.1.1...` `` etc. B1 ships a thin `tests/sqlite.conformance.test.mjs` runner that wraps `runConformance("Sqlite-B1", sqliteFactory)` and uses node:test's `--test-name-pattern` (CANONICAL mechanism) to select only the sections this sub-WI implements. A hand-curated filter list is the EXPLICIT FALLBACK only when a sub-WI cannot be expressed as a single regex; that fallback requires inline justification in the sub-WI's plan. Subsequent sub-WIs widen the filter pattern (`Sqlite-B2` allows B1's labels + B2's, etc.). No tag-array refactor of the harness is needed.

Per attempt-1 Path-2 reviewer (jobId: Path-2 inline review 2026-05-22) Dim-1 #2 + Dim-3 #1 — this decision is final at the umbrella plan level. B1 does NOT re-decide; it implements label-substring filtering verbatim.

| Sub-WI | Scope | Acceptance (impl + tests) |
|---|---|---|
| **B1** | Package setup: add `better-sqlite3` to `services/case-box-persistence/package.json` `dependencies`; add `@types/better-sqlite3` to `devDependencies`; add local `services/case-box-persistence/scripts/abi-smoke.mjs` + `pretest` script + `engines.node: ">=22.0.0 <26.0.0"` (mirrors ocr-persistence per Dim-5 #3); update `invariants.test.mjs` 6.2.1 to permit `better-sqlite3` in dependencies. Create `src/sqlite/` directory; ship `src/sqlite/SqliteCaseBoxPersistence.ts` scaffold (full interface; unimplemented methods throw `not_implemented`) + `src/sqlite/schema.ts` using `DDL_BY_VERSION` map + `schema_version` table (mirrors `ocr-persistence/src/sqlite/schema.ts`) + `tests/sqlite.conformance.test.mjs` runner with conformance subset filter. **Matter entity only** (CREATE / GET / ARCHIVE / UNARCHIVE). | Conformance 6.1.1..6.1.15 + **R5.1..R5.6 (matter successor + matter free-text fields)** pass against SQLite. Hardening test stub (WAL mode + busy_timeout pragma check). |
| **B2** | Document entity + listDocuments pagination (mirrors A1 + A8 doc listing) + R-5 document fields (purpose, work_order_status, supersedes_document_id, lifecycle free-text, R-6 mime_type/byte_size/manual_extracted_text). | Conformance 6.1.16..6.1.27 + **R5.7..R5.14 (document purpose / work-order / lifecycle / supersession)** + **R6.1..R6.4 (doc-asset)** + listDocuments tests pass. |
| **B3** | Audit observability (`listAuditEvents`, `getAuditChainHead`, `verifyAuditChainForMatter`). Audit-chain `audit_chain_heads` table introduced; head-hash storage moves from in-memory `Map` to SQLite. | Conformance 6.1.29..6.1.38 pass; hash chain integrity preserved. |
| **B4** | Confidentiality classification (Phase A2 SQLite mirror). | Conformance 6.A2.1..6.A2.20+ pass; per-target append-only history; latest-by-set_at + id tiebreak; tenant + matter consistency invariants. |
| **B5** | Privilege markers (Phase A3 SQLite mirror) + initial SQLite hardening tests (WAL replay, busy_timeout interaction, FK pragma). **Hardening MAY split into a separate B-hardening sub-WI** if crash-injection grows beyond simple pragma checks (per reviewer Dim-3 #4). | Conformance 6.A3.* pass; hardening tests cover basic SQLite pragma + WAL replay. |
| **B6** | Facts (Phase A4 SQLite mirror) including supersession-graph cycle detection + R-5 fact (`purpose` enum + `as_of_date`). | Conformance 6.A4.* + R5.15..R5.18 pass. |
| **B7** | Docket entry + deadline materialization (Phase A5 SQLite mirror). Mode B atomic transaction (most subtle invariant). **MANDATORY**: per reviewer Dim-5 #2, B7 ships a failure-injection test — inject `throw` after docket-entry update but BEFORE deadline INSERT, assert BOTH domain rows AND audit rows roll back. | Conformance 6.A5.* + R5.21..R5.24 (new deadline kinds) pass + crash-injection test passes. |
| **B8** | Evidence item (Phase A6 SQLite mirror) + R-5 `party_side`. | Conformance 6.A6.* + R5.19..R5.20 pass. |
| **B9** | OCR link (Phase A7 SQLite mirror, read-only mirror by value). | Conformance 6.A7.* passes. |
| **B10** | Read-side aggregations (Phase A8 SQLite mirror): `listMatters`, `getMatterSummary`, `getDocumentDetail`, `getDeadlineCalendar`, `listDeadlines`, `listDocketEntries`, `getFactSupersessionChain`, `listOcrLinks`. | Conformance 6.A8.* passes. |
| **B11** | Replay-safe `*Once` variants (Phase A9 SQLite mirror): `appendFactOnce`, `upsertOcrLink` (R-5 absorbs R5.16-R5.18 fact canonical-projection equivalence). R-6 doc-asset preservation already in B2; B11 verifies it still passes under full impl. **Final**: full conformance harness (no filter) runs against `SqliteCaseBoxPersistence`; all 299+ tests + R-5 + R-6 cases pass. | Conformance 6.A9.* + R6.1..R6.4 pass under full impl + full-harness no-filter run passes. **Phase B complete.** |

Each sub-WI carries its own per-WI plan (e.g. `dev-memo/plan-case-box-persistence-B1-matter.md`). Each runs cc-suite review-plan → audit → verify. Each commits explicitly per `.claude/rules/staging-hygiene.md`.

**No big-bang.** A sub-WI's failure does NOT block other sub-WIs from re-opening with revised scope; the parent plan's §10 risk table applies.

---

## §3 Schema-management approach

**Versioned `applySchema()` mirror of `services/ocr-persistence/src/sqlite/schema.ts`** (per parent plan §2 + §6).

Rationale:
- Proven pattern; same author / same testing approach across two packages.
- Idempotent: applySchema on empty DB applies v1..vN; on a partial-version DB applies only the missing increments; on a vN DB is a no-op; refuses to load a future-version (vN+1) DB before any mutation.
- Versions are integers (1, 2, 3, ...); each version's DDL lives in a `DDL_BY_VERSION` map keyed by integer version (matches `services/ocr-persistence/src/sqlite/schema.ts`'s structure), recorded via a `schema_version` table that applySchema reads/updates atomically. The first version (Phase B1) creates the matter + audit_event + audit_chain_heads tables.

Rejected:
- **Per-entity ALTER TABLE migration**: SQLite's ALTER TABLE is limited (no DROP COLUMN, no RENAME COLUMN without recreate); proper migrations require CREATE TABLE...INSERT SELECT... rename — too risky for a v1 plan.
- **No schema versioning** (let the application create tables on first use): not robust; runtime ordering surprises.
- **External migration tool** (e.g., `knex`, `drizzle-kit`): new top-level dep; out of scope.

**No FK constraints between case-box and OCR.** Per `case-box-step-0-boundary.md` §1 ("Dependency direction is one-way"), `CaseBoxPersistence` references OCR by value (`ocr_job_id`) only. No SQL FOREIGN KEY targets an `ocr_jobs` table.

---

## §4 Transaction model + audit chain

**Per parent plan §6** (unchanged):

- Synchronous `better-sqlite3` driver only.
- `BEGIN IMMEDIATE` for every write transaction (prevents writer starvation under contention).
- `db.transaction(fn).immediate()` wrapper provides automatic rollback on any throw inside `fn`.
- `audit_chain_heads` control table holds per-matter `head_hash`; updated in the SAME transaction as the audit row insert.
- `canonicalAuditEventHashInput` from `case-box-contract/src/audit-log.ts` reused VERBATIM — never re-implemented. Conformance: build N events with the contract helper, persist them, re-derive head locally, compare.
- Mode B docket-entry-confirm + deadline-materialize is the most subtle invariant: preallocate `CaseBoxDeadline.id` ULID, call `assertValidDocketEntryConfirmation` (which throws on `date_only`), update docket entry, INSERT deadline; all atomic. `confirmed_deadline_id` uniqueness enforced via partial-unique index in SQLite (analogous to OCR persistence's queue-active-row partial unique).

**No FOREIGN KEY constraints across the case-box ↔ OCR boundary.** OCR references are by value only.

---

## §5 LOC discipline (LOC-01-style from day one)

Per parent plan §10.2 row "B1+ SQLite implementation per entity, in same order; reuses conformance; Medium per phase; **LOC-01-style sibling-module extraction from the start to avoid the 956-LOC trap**" — every SQLite source file starts under 500 pure LOC and stays under 800 pure LOC throughout the sub-WI's life. Per `loc-guardian.md` thresholds.

Concrete extractions (from B1 onward):

- `src/sqlite/SqliteCaseBoxPersistence.ts` — repo class + public methods. Stays below 800 pure LOC by delegating to:
- `src/sqlite/schema.ts` — `applySchema()` + version table.
- `src/sqlite/transactions.ts` — `withImmediateTransaction(db, fn)` wrapper.
- `src/sqlite/{matterRepo,documentRepo,factRepo,evidenceRepo,docketRepo,deadlineRepo,privilegeRepo,classificationRepo,auditRepo,ocrLinkRepo}.ts` — per-entity repos (each <500 pure LOC).
- `src/sqlite/auditChain.ts` — head-hash bookkeeping wrappers (canonical hash input + chain verification).
- `src/sqlite/replaySafe.ts` — canonical-projection helpers for `appendFactOnce` etc. (mirrors `case-box-persistence/src/inMemoryFact.ts` `factCanonicalProjection`).

`tests/sqlite.conformance.test.mjs` is a thin runner (≤50 LOC) that invokes the shared `runCaseBoxPersistenceConformance.mjs` with a `SqliteCaseBoxPersistence` factory.

---

## §6 Test strategy

Per parent plan §8 (unchanged):

1. **Conformance** (`tests/conformance/runCaseBoxPersistenceConformance.mjs`): shared harness; both impls execute the same suite. SQLite impl MUST pass every case the in-memory impl passes.
2. **Invariants** (`tests/invariants.test.mjs`): cross-entity invariants not in conformance (already exists; covers R-5 INV-4/INV-5; Phase B doesn't change it).
3. **Hardening** (`tests/sqlite.hardening.test.mjs`; introduced B5): WAL mode, busy_timeout, FK pragmas (case-box uses NONE), replay safety under crash injection. Mirrors `services/ocr-persistence/tests/sqlite.hardening.test.mjs`.

Each sub-WI's verification gate:
- Shared harness `npm --prefix services/case-box-persistence test` exits 0 against both impls.
- For B-series: `node tests/sqlite.conformance.test.mjs` (invoked via npm test) green; in-memory tests stay green; invariants tests stay green.

`npm --prefix services/ocr-persistence test` stays green (ABI gate closed; no cross-package coupling).
`npm --prefix docs/contracts/case-box-contract test` stays green (no contract changes).

---

## §7 Hard-stop alignment

This plan is plan-only; the trigger list belongs to each B-series sub-WI. The B sub-WIs trigger:

- **SQLite / better-sqlite3 / native-module work** (`.claude/rules/autonomy.md` hard-stop) — TRIGGERED at B1 (first sub-WI). The lane authorization NIGHT-RUN-ABI-TO-SQLITE-PLAN allows Phase B PLAN ONLY; B sub-WIs require SEPARATE explicit user authorization (per the lane's allowed-WIs list which authorizes the PLAN, not the implementation).
- **New runtime dependency** — TRIGGERED at B1 (adds `better-sqlite3` to case-box-persistence package.json). Same authorization gate.
- **Schema introduction on persisted data** — TRIGGERED at B1+ but no real data exists; the schema is created on first run and applies to ephemeral or test-shaped data. No migration risk.
- **Public API break** — NOT triggered (Phase B preserves the existing interface exactly).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered (Phase B is local-only synchronous SQLite; no network).
- **Push / deploy / secrets / production data** — NOT triggered (absolute global hard stops; NEVER triggered by Phase B).

**Per the lane authorization**: this plan-WI commit closes the lane (per its "Stop/report conditions" → "after Phase B plan commit, stop"). B1 implementation is NOT in this lane's authorized scope; it requires a SEPARATE explicit user authorization (a new lane authorization or interactive turn) to open.

---

## §8 cc-suite review (this plan-WI)

HIGH-RISK per §6 + §7 (native module + persistence + multi-package downstream). cc-suite review-plan via Path 1 broker. CCSUITE-02 retry policy applies if attempt 1 times out.

After cc-suite returns READY (or only Low-risk clarifications), the plan is committed. Each B sub-WI carries its own per-WI plan + its own cc-suite review-plan cycle.

---

## §9 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | High | Cross-impl divergence: SQLite impl passes the shared harness but exhibits subtly different behavior in edge cases (e.g., null vs undefined returns, error-message format drift, JSON-vs-column storage of optional fields, cursor ordering, wrapped-driver-error masking). | (a) Shared harness already pins many of these per the existing in-memory tests. (b) `invariants.test.mjs` 6.2.6 enforces error-code stability across impls. (c) **New per reviewer Dim-5 #1**: each B sub-WI adds explicit impl-parity tests — identical scenarios run against both in-memory AND SQLite, deep-comparing public outputs + error codes for the high-risk read paths (list-*, get-*Detail, get-*Summary) AND the `*Once` writers (canonical projection equivalence). Impl-parity tests live in `tests/impl-parity.test.mjs` (NEW in B1; extended per sub-WI). |
| 2 | Medium | Mode B atomicity (B7) is the trickiest invariant; SQLite must guarantee that confirmDocketEntry produces both the updated docket-entry row AND the new deadline row OR neither. | (a) `BEGIN IMMEDIATE` + single-`db.transaction().immediate()` wrapper; conformance harness's idempotent-replay tests catch happy-path partial-state leaks. (b) **§2 row B7 ships a mandatory crash-injection test (per attempt-1 reviewer Dim-5 #2)**: inject `throw` after docket-entry update but BEFORE deadline INSERT; assert BOTH domain rows AND audit rows roll back. This proof is required for B7 to commit. |
| 3 | Medium | Audit-chain hash divergence between in-memory `Map`-based head and SQLite `audit_chain_heads` table. | `canonicalAuditEventHashInput` is reused verbatim from the contract. Conformance harness builds N events, persists, re-derives the head locally, compares — same logic for both impls. |
| 4 | Medium | LOC drift in SQLite repo files (the 956-LOC trap from ocr-persistence's first SQLite pass). | LOC-01-style extraction from day one (per §5). Pre-commit loc-guardian scan per sub-WI. |
| 5 | Low | `better-sqlite3` dep addition on `services/case-box-persistence/package.json` invites the question of whether case-box should share or duplicate ABI-pinning configuration with `services/ocr-persistence/package.json`. | Per reviewer Dim-5 #3, B1 ships a LOCAL `services/case-box-persistence/scripts/abi-smoke.mjs` (copy of ocr-persistence's smoke; minimal coupling) + the same `engines.node >=22.0.0 <26.0.0` pin + `pretest` script. NOT a shared symlink to ocr-persistence (avoids cross-package test coupling). |
| 6 | Low | The R-6 `manual_extracted_text` field (maxLength 200000) may stress SQLite if a single document carries ~200KB of text plus the rest of the document row. | SQLite handles 200KB strings comfortably. The conformance harness's `R6.2 registerDocument preserves manual_extracted_text` test exercises a small string; **B2 (the document sub-WI)** adds an additional "max-length boundary" test if helpful. (Re-anchored from B9 to B2 per rev-3 split; B9 is now OCR-link-only.) |
| 7 | Low | `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` is at ~3793 LOC under the shared-harness exemption. Phase B adds at most 50 LOC of `sqlite.conformance.test.mjs` runner; the shared harness grows only when conformance cases themselves expand (not anticipated by Phase B alone). | LOC scan per sub-WI; the shared-harness exemption remains in effect per `.claude/rules/loc-guardian.md`. |
| 8 | Low | Phase B introduces a `dependencies` entry on `services/case-box-persistence/package.json`, vs the current `dependencies: ["case-box-contract"]` only. The `invariants.test.mjs` 6.2.1 ("package.json declares case-box-contract only (no better-sqlite3, no ocr-persistence)") test MUST be updated. | B1 sub-WI updates 6.2.1 to permit `better-sqlite3` (and `@types/better-sqlite3` in `devDependencies`) as the only additions. |

No Critical risks.

---

## §10 References

- `dev-memo/plan-case-box-persistence-00.md` §1, §2, §6, §7, §8, §10.
- `dev-memo/plan-abi-00-better-sqlite3.md` (predecessor; ABI gate closure at commit `d02fff8`).
- `dev-memo/plan-case-box-persistence-A{1..9}.md` (Phase A precedent; each sub-WI's commit cadence + audit / verify pattern).
- `services/ocr-persistence/src/sqlite/**` (canonical SQLite implementation patterns).
- `services/case-box-persistence/src/inMemory*.ts` (behavioral target for Phase B).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` (shared harness).
- `services/case-box-persistence/tests/invariants.test.mjs` 6.2.1 (declares the current dep policy; B1 amends).
- `.claude/rules/cc-suite.md` §"High-risk WIs" + §"Required recording" + §"Retry policy".
- `.claude/rules/autonomy.md` §"Hard-stop list" + §"Overnight lane policy".
- `.claude/rules/loc-guardian.md`.
- `dev-memo/night-run-00.md` (lane policy; NIGHT-RUN-ABI-TO-SQLITE-PLAN authorization governs this WI).
- `dev-memo/rollback-00.md` (committed-rollback policy; this lane disallows auto-revert).

---

## §11 Stop condition

This plan is stale or superseded when:

- The first B sub-WI (B1) commits — at that point, the umbrella plan freezes and each subsequent B sub-WI references it as the source of sequencing decisions.
- A future B sub-WI plan revises the sub-WI scope (e.g., combines B4+B5 into one) — that revision lands as a separate plan amendment with its own cc-suite review-plan.
- A future driver-swap WI replaces `better-sqlite3` — this plan is retired with the dep.
- Phase B closes (B9 commits green) — this plan transitions to "superseded by Phase B commits" recorded inline; file stays as historical reference.
