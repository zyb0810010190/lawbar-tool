# Plan: CASE-BOX-PERSISTENCE B3 — SQLite audit observability

**Status**: READY (revision 2 — review-plan v2 returned READY (Low-risk clarifications) at jobId `review-plan-mpgwxf7a-6uuiok`. One Low (§1.7 test count 4 → 5 to match §1.6) applied; the other Lows accepted as documented (final-event tamper relies on head-anchor comparison outside the contract verifier; regex complexity guarded by preflight assertion; load-all viable at v1 lawyer-scale)).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Umbrella plan**: `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (READY at commit `1ac26b1`) §2 row B3.
**B1 plan**: `dev-memo/plan-case-box-persistence-B1-matter.md` (READY at `9cf03d3`).
**B2 plan**: `dev-memo/plan-case-box-persistence-B2-document.md` (READY at `6f0540e`).
**B1 impl**: commit `601d74c`.
**B2 impl**: commit `6b5d5f6`.
**Execution-discipline floor**: `.claude/rules/execution-discipline.md` (commit `9c0966f`).
**Predecessor closure**: ABI gate closed (`d02fff8`); B1 + B2 shipped.
**Risk**: HIGH (persistence + tamper-detection invariants — `.claude/rules/cc-suite.md` §"High-risk WIs").

## Review packet (compact)

### Active plan summary

B3 is the THIRD SQLite sub-WI of Phase B. It wires the READ paths over the audit-chain tables `case_box_audit_events` + `case_box_audit_chain_heads` that B1 already created. The tables are populated by every write in B1 (matter create/archive/unarchive) and B2 (registerDocument).

B3 implements TWO methods on `SqliteCaseBoxPersistence`:

- **`listAuditEvents(query: ListAuditEventsQuery): Promise<ListAuditEventsPage>`** — paginated read of all audit events for a matter, ordered by `sequence ASC`, with seek-pagination via the shared cursor utility.
- **`verifyAuditChainForMatter(matterId: string): Promise<VerifyAuditChainResult>`** — load all audit events for a matter in append order, hand them to the contract's `verifyAuditChain(events, { eventHashFn })`, return the result.

`getAuditChainHead` was ALREADY implemented in B1 (umbrella-divergence per B1 plan §"Umbrella-divergence note") because the chain-head table is required by every write. B3 leaves `getAuditChainHead` untouched.

B3 does NOT add a new SQLite schema version. v2 (B2) already includes everything B3 needs:
- `case_box_audit_events.event_json` (canonical source for verifier).
- `case_box_audit_events.sequence` (seek-pagination + ordering).
- `idx_case_box_audit_events_by_matter` (per-matter sequence index from B1).

The verifier reuses the contract's `verifyAuditChain` VERBATIM. NO re-implementation of canonicalization, hashing, or chain-traversal logic.

Plan is plan-only: no code, no schemas, no package edits, no test file changes.

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-B3-audit-observability.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/**` (no source / test / package edits).
- `docs/contracts/case-box-contract/**`.
- Any OCR package.
- AGENTS.md.
- Umbrella / B1 / B2 plans (no umbrella amendment bundled with B3 plan).
- `dev-memo/plan-case-box-persistence-00.md` (parent).

### Exact acceptance criteria (this plan-WI itself)

1. The plan is committed alone (one file).
2. The plan enumerates B3 scope per umbrella §2 row B3 verbatim + expands into a concrete impl-WI shape.
3. The plan picks SQL for listAuditEvents (single SELECT with WHERE + ORDER BY + LIMIT + cursor-seek) and for verifyAuditChainForMatter (load all events ASC, pass to contract verifier).
4. The plan declares the conformance label filter regex that selects exactly B3 + carried-forward B1/B2 cases.
5. The plan declares the four hardening invariants (changed payload hash detected, broken prior hash detected, wrong tenant/matter chain rejected, event_count == COUNT(*) == MAX(sequence) preserved).
6. The plan declares HARD-STOP categories that DO and DO NOT trigger.
7. The plan declares LOC budget per touched file (with extraction trigger reference).
8. The plan declares cc-suite audit + verify expectations for the impl WI.
9. The plan declares execution-discipline compliance per the new rule.
10. cc-suite review-plan returns READY (or only Low-risk clarifications).

### Exact out-of-scope list (B3; deferred to B4+)

- **No B4+ entities** (confidentiality, privilege, fact, evidence, docket, OCR link, aggregations, Once writers).
- **No new write surfaces** — B3 is read-only on the audit tables; the writes happen as side-effects of B1's matter writes + B2's registerDocument.
- **No schema changes** — B1's v2 schema already provides everything B3 needs.
- **No new top-level dep beyond what B1/B2 already added.**
- **No public-API change** — B3 implements 2 EXISTING interface methods that were stubs.
- **No SQLite-specific public-API additions.**
- **No real-data migration.**
- **No API / UI / mini-program / auth / cloud / sync / LLM / OCR runtime changes.**
- **No CI infrastructure.**
- **No git push.**
- **No committed rollback.**

### Essential references

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B3.
- `dev-memo/plan-case-box-persistence-B1-matter.md` §"Umbrella-divergence note" (audit_chain_heads ships in B1).
- `dev-memo/plan-case-box-persistence-B2-document.md` (precedent for SQLite read pattern with shared cursor).
- `services/case-box-persistence/src/inMemoryAudit.ts` — behavioral target: `listAuditEventsHelper`, `verifyAuditChainForMatterHelper`.
- `services/case-box-persistence/src/inMemoryRepo.ts` lines 327-339 — `listAuditEvents` / `verifyAuditChainForMatter` call sites.
- `services/case-box-persistence/src/cursor.ts` — `encodeCursor` / `decodeCursor` / `computeFiltersHash` / `resolveLimit` (cursor kind `audit_events_by_matter` already exists).
- `services/case-box-persistence/src/auditChain.ts` — `eventHashFn` (sha256 over `canonicalAuditEventHashInput`).
- `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` — current B1+B2 state; converts 2 stubs to impls.
- `services/case-box-persistence/src/sqlite/matterRepoQueries.ts` + `documentRepoQueries.ts` — SQL helper extraction precedent.
- `docs/contracts/case-box-contract/src/audit-log.ts` — `verifyAuditChain` (REUSED VERBATIM).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — B3 cases at 6.1.32 (untampered), 6.1.34 (unknown matter), 6.1.35-37 (listAuditEvents), 6.1.38 (audit ID pattern).
- `.claude/rules/cc-suite.md`, `autonomy.md`, `loc-guardian.md`, `staging-hygiene.md`, `execution-discipline.md`.

### Review questions for the reviewer

1. Is **inlined SQL** for `listAuditEvents` the right call (mirrors B2's listDocuments §3 Option A), or should B3 build maps and call `listAuditEventsHelper`? Plan picks inlined SQL for symmetry + index walk efficiency.

2. Should `verifyAuditChainForMatter` load ALL events for a matter in one SELECT, or page through them? Plan picks **load all** because: (a) `verifyAuditChain` is a pure function over the full sequence, (b) v1 expects small per-matter event counts (lawyer scale, not enterprise SaaS), (c) splitting verification into pages would require carrying intermediate state across SQL pages — adds complexity without payoff at v1.

3. Should B3 introduce a new `auditRepoQueries.ts` sibling, or extend `matterRepoQueries.ts` (since audit events ARE matter-scoped)? Plan picks **new `auditRepoQueries.ts`** for symmetry with the B2 `documentRepoQueries.ts` precedent + smaller blast radius per execution-discipline §3.

4. Is the conformance label filter regex correct? Plan picks `^Sqlite-B3: (?:6\.1\.(?:3[2-8]|29|30|31|13a|26-27|[1-9]|1[0-5]|1[6-9]|2[0-8])|R5\.(?:[1-9]|9b|1[0-4])|R6\.[1-3])(?:\s|$)` — superset of B2 + new B3 cases 6.1.32, 6.1.34..6.1.38, PLUS the previously-omitted getAuditChainHead cases 6.1.29, 6.1.30, 6.1.31 (B1-implemented; carried forward per rev-1 reviewer Dim-1 #1 + Dim-3 #3 to provide regression protection). 6.1.33 does NOT exist in the harness (verified via grep). **R6.4 is intentionally OMITTED** from the B2/B3 carry-forward because it tests `getDocumentDetail` (a B10 read-aggregation method); per B2 plan §"Exact out-of-scope" R6.4 stays B10-scope. The umbrella plan's row B2 description ("R-6 mime_type/byte_size/manual_extracted_text") matches R6.1..R6.3 only — the R6.4 case exercises a different B-phase's method.

5. Should B3 ADD a SQLite-specific tamper-detection test that mutates the underlying `case_box_audit_events.event_json` directly, then asserts `verifyAuditChainForMatter` returns `{ ok: false, errorReason: ... }`? Plan picks **YES** — direct-row mutation is a SQLite-only attack vector and the hardening test must cover it.

6. Does B3 need to handle the `verifyAuditChain` `event_schema_invalid` error path? Plan says **NO** — the SQLite events were written by `prepareCreateMatter` / `prepareMatterTransition` / `prepareRegisterDocument` which ALWAYS produce schema-valid events; the path is only reachable via direct DB corruption. The hardening test exercises it indirectly via the payload-tamper case.

---

## §1 B3 scope (verbatim from umbrella + expanded)

### §1.1 `SqliteCaseBoxPersistence` method implementations

Convert 2 stubs to implementations:

- **`listAuditEvents(query)`** — wraps `listAuditEventsSqlite` (in new `auditRepoQueries.ts`):
  1. SELECT matter (tenant_id) by `query.matter_id`; throw `unknown_matter` if absent; throw `tenant_mismatch` if mismatch.
  2. `limit = resolveLimit(query.limit)` (MANDATED reuse per B2 precedent).
  3. `filters_hash = computeFiltersHash({ tenant_id, matter_id })`.
  4. `cursor = query.cursor !== undefined ? decodeCursor(query.cursor, { kind: "audit_events_by_matter", filters_hash }) : null`.
  5. Build SELECT:
     ```sql
     SELECT event_json FROM case_box_audit_events
     WHERE matter_id = ?
       [AND sequence > ?]  -- cursor seek
     ORDER BY sequence ASC
     LIMIT ?
     ```
     `tenant_id` is NOT in the SELECT WHERE clause because the matter-level tenant check (step 1) already gates access; audit events are matter-scoped and inherit tenant from the matter. (Mirrors `listAuditEventsHelper` which reads `auditByMatter.get(matter_id)` without re-checking tenant per event.)
  6. Fetch `limit + 1` rows. Slice + compute `next_cursor` via `encodeCursor`.
  7. JSON.parse each row's `event_json`; return `{ rows, next_cursor }`.

- **`verifyAuditChainForMatter(matterId)`** — wraps `verifyAuditChainForMatterSqlite` (in new `auditRepoQueries.ts`):
  1. SELECT 1 FROM case_box_matters WHERE id = ?; throw `unknown_matter` if absent.
  2. SELECT event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC.
  3. JSON.parse each row.
  4. Return `verifyAuditChain(events, { eventHashFn })` from the contract.

### §1.2 SQL helper extraction (per execution-discipline §3 surgical changes + B2 precedent)

CREATE: `services/case-box-persistence/src/sqlite/auditRepoQueries.ts` (~80-100 LOC estimated).

Contents:
- `listAuditEventsSqlite(db, query)` — full implementation per §1.1 above.
- `verifyAuditChainForMatterSqlite(db, matterId)` — full implementation per §1.1 above.
- (Internal) `selectMatterTenantForAudit(db, matterId)` — tenant-only SELECT for the gating check.

`SqliteCaseBoxPersistence.ts` gains ~10-15 LOC delta from converting 2 stubs to thin calls into `auditRepoQueries.ts`. The shared `loadSyntheticStoredEvents` helper introduced in B2 STAYS in `SqliteCaseBoxPersistence.ts` — it's used by writes (B1 transition + B2 registerDocument), not by reads.

### §1.3 Tenant / matter scoping

- **List events**: matter-level tenant check at step 1 of `listAuditEvents`. Events themselves are matter-scoped; their `tenant_id` field is informational and matches the matter's.
- **Verify chain**: matter-existence check at step 1 of `verifyAuditChainForMatter`. The `verifyAuditChain` contract function itself checks tenant/matter homogeneity ACROSS events (errors: `tenant_id_mismatch`, `matter_id_mismatch` if any event diverges from the first). The error path is unreachable under normal writes but is the load-bearing tamper-detection invariant — if a future B-phase mistakenly writes a cross-matter event, the verifier catches it.

### §1.4 Ordering and pagination

- **listAuditEvents** order: `sequence ASC` (append order; matches in-memory `auditByMatter.get(matter_id)` which is a chronologically-appended array).
- **Pagination**: seek by `sequence > cursor.last_sort_tuple[0]`. Cursor encoded as `{ v: 1, kind: "audit_events_by_matter", filters_hash, last_sort_tuple: [last_sequence] }` — already canonicalized in `src/cursor.ts`.
- **Default limit**: `resolveLimit(undefined) === DEFAULT_LIMIT (50)`. Max `MAX_LIMIT (200)`.

### §1.5 Tamper detection behavior

Four hardening invariants the impl WI must prove:

1. **Changed payload hash detected**: directly UPDATE `case_box_audit_events.event_json` for a **non-final** row (mutate a field in the JSON), call `verifyAuditChainForMatter`. Result: `{ ok: false, errorReason: "prev_event_hash_mismatch" }` at the NEXT event's index (because mutating event[i]'s canonical bytes changes its hash → event[i+1]'s prev_event_hash no longer matches). The non-final requirement is per rev-1 reviewer Dim-2 #2: mutating the LAST event would change `headHash` without triggering `prev_event_hash_mismatch` (no successor event to compare). A separate optional invariant (1b below) covers final-event mutation via head-anchor comparison.

   **Invariant 1b (final-event mutation, optional)**: directly UPDATE `case_box_audit_events.event_json` for the LAST event. After verify returns `{ ok: true, headHash: X }`, assert `X !== case_box_audit_chain_heads.head_hash` (the head row still carries the PRE-tamper hash because the tamper bypassed the write path). Detects last-event tampering that the in-chain prev-hash check cannot see.
2. **Broken prior hash detected**: directly UPDATE `case_box_audit_events.event_json` for event[N] to change `prev_event_hash` to a wrong value (different but valid-shape hash). Call verify. Result: `{ ok: false, errorReason: "prev_event_hash_mismatch", errorIndex: N }`.
3. **Wrong tenant/matter chain rejected**: directly UPDATE `case_box_audit_events.event_json` for event[N] to change `tenant_id` (or `matter_id`) to a different value. Call verify. Result: `{ ok: false, errorReason: "tenant_id_mismatch" }` (or `matter_id_mismatch`) at index N.
4. **event_count == COUNT(*) == MAX(sequence) preserved**: B1+B2 already test this. B3 hardening re-asserts it after a sequence of writes (createMatter + registerDocument + archiveMatter + a second registerDocument, expecting 4) — proves the invariant holds across mixed write types.

### §1.6 Tests

- **`tests/sqlite.conformance.test.mjs`** — package.json `--test-name-pattern` widened to include 6.1.29, 6.1.30, 6.1.31 (B1 `getAuditChainHead` cases carried forward; previously excluded by B2 regex per rev-1 Dim-1 #1) PLUS 6.1.32, 6.1.34..6.1.38 (B3 new). `B3_EXPECTED_CASE_IDS` extends `B2_EXPECTED_CASE_IDS` with the 8 added ids. The `runConformance` label renames from `Sqlite-B2` to `Sqlite-B3`. Preflight regex assertion includes the new ids and rejects out-of-scope cases (e.g., 6.A2.1, 6.A3.1).

- **`tests/sqlite.hardening.test.mjs`** — 5 new tests:
  - `Sqlite-B3: verifyAuditChainForMatter detects mutated event_json payload (non-final event)` — invariant 1.
  - `Sqlite-B3: verifyAuditChainForMatter detects last-event tampering via head-anchor mismatch` — invariant 1b (per rev-1 reviewer Dim-2 #2).
  - `Sqlite-B3: verifyAuditChainForMatter detects broken prev_event_hash` — invariant 2.
  - `Sqlite-B3: verifyAuditChainForMatter detects wrong tenant_id mid-chain` — invariant 3.
  - `Sqlite-B3: event_count invariant after createMatter + registerDocument + archiveMatter + registerDocument (4 events)` — invariant 4.

- **`tests/impl-parity.test.mjs`** — extends with audit-read scenarios:
  - `listAuditEvents` returns identical rows + next_cursor across InMemory and SQLite for a 4-event matter (createMatter + registerDocument + archiveMatter + unarchiveMatter; 4 audit rows).
  - `listAuditEvents` paginates byte-identical next_cursor across multi-page traversal (small `limit` to force multiple pages).
  - `verifyAuditChainForMatter` returns identical `{ ok: true, verifiedCount, headHash }` across InMemory and SQLite for a clean chain.
  - `verifyAuditChainForMatter` returns identical `unknown_matter` error on both impls for an unknown matter.

- **`tests/invariants.test.mjs`** — 6.2.6b retargeted from `appendFact` (B6 stub) to the next still-stubbed method after B3. Since `listAuditEvents` and `verifyAuditChainForMatter` are now B3-implemented and `getAuditChainHead` is B1-implemented, the next stub frontier is `appendConfidentialityClassification` (B4) or `appendFact` (B6). Plan picks `appendConfidentialityClassification` because it's the chronological next sub-WI per umbrella.

### §1.7 Acceptance criteria (impl WI; this plan-WI does NOT execute)

1. `npm --prefix services/case-box-persistence test` exits 0 with all conformance + R-5 + R-6 + audit-read cases running under "Sqlite-B3" label.
2. SQLite impl passes shared conformance cases 6.1.32, 6.1.34, 6.1.35..6.1.38 + all carried-forward B1/B2 cases.
3. The 5 hardening tests (tamper detection invariants 1, 1b, 2, 3 + event_count invariant 4 per §1.5) all pass.
4. The audit-read impl-parity tests deep-compare listAuditEvents page-by-page across both impls.
5. All Phase A in-memory tests stay green.
6. B1+B2 SQLite tests stay green.
7. ocr-persistence + ocr-worker + case-box-contract + docs/contracts unchanged green.
8. loc-guardian: 0 over fail. `SqliteCaseBoxPersistence.ts` stays under 500 pure LOC (extract to `auditRepoQueries.ts` if needed).
9. cc-suite audit (mini) PASS or NEEDS-FIX-fixed-and-verified.

---

## §2 LOC budget per file (post-B3)

Current state (post-B2 commit `6b5d5f6`):

| File | Current LOC | Threshold |
|---|---|---|
| `src/sqlite/schema.ts` | 228 | source warn 500 |
| `src/sqlite/SqliteCaseBoxPersistence.ts` | 497 | source warn 500, fail 800 |
| `src/sqlite/matterRepoQueries.ts` | 89 | |
| `src/sqlite/documentRepoQueries.ts` | 170 | |
| `src/sqlite/openSqliteCaseBoxPersistence.ts` | 58 | |

Estimated B3 additions:
- `auditRepoQueries.ts` (NEW): ~80-100 LOC (2 methods + 1 internal helper).
- `SqliteCaseBoxPersistence.ts`: 2 stubs (~6 LOC) → 2 thin calls (~6 LOC). NET ZERO change.

**Estimated post-B3 `SqliteCaseBoxPersistence.ts`: ~497 LOC**. Comfortably under 500 trigger. No additional extraction needed.

Test files:
- `sqlite.conformance.test.mjs`: ~5 LOC added (preflight regex + 5 new expected ids).
- `sqlite.hardening.test.mjs`: ~80 LOC added (4 new tests). Total ~280 LOC; well under test warn 700.
- `impl-parity.test.mjs`: ~80 LOC added (4 new scenarios). Total ~390 LOC; well under test warn 700.

**No file approaches fail threshold post-B3.**

---

## §3 Hard-stop alignment

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED (B3 reads SQLite tables). No new dep, no schema change.
- **New runtime dependency** — NOT triggered.
- **Schema introduction on persisted data** — NOT triggered.
- **Public API break** — NOT triggered (B3 implements 2 EXISTING interface methods).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered.
- **Push / deploy / secrets / production data** — NOT triggered.

Per the no-revert posture from the lane: fix-forward inside B3 impl; if unworkable, STOP-FOR-ROLLBACK per `dev-memo/rollback-00.md`.

---

## §4 Execution-discipline compliance (per `.claude/rules/execution-discipline.md`)

### §4.1 §1 think before coding

- WI scope confirmed: 2 method impls + 1 new SQL helper file + test extensions. Out-of-scope list explicit (§"Exact out-of-scope" above).
- Assumptions stated: (a) `verifyAuditChain` from contract is REUSED VERBATIM; (b) per-matter event counts at v1 scale fit in memory for verify (load-all approach); (c) audit-row tampering is the only realistic tamper vector since writes go through the prepare-helpers.
- Hard stops cross-checked: no triggers; lane authorization not in force (no overnight mode for plan-only WIs).
- Ambiguity routed: no whole-product ambiguity; no plan-shape ambiguity (umbrella §2 row B3 + B1 +precedent are unambiguous); cc-suite review-plan loop runs BEFORE coding.

### §4.2 §2 simplicity first

- Smallest slice: 2 methods + 1 sibling file. No new schema, no new dep, no new validator, no new error code.
- Reuse: `verifyAuditChain` (contract), `eventHashFn` (auditChain.ts), `encodeCursor` / `decodeCursor` / `computeFiltersHash` / `resolveLimit` (cursor.ts), `loadSyntheticStoredEvents` (existing in SqliteCaseBoxPersistence.ts; B3 doesn't touch it).
- No speculative abstractions: NO generalized `auditQueryBuilder`, NO pluggable verifier strategy, NO new SQL macros.
- LOC extraction is MECHANICAL: new sibling file matches `matterRepoQueries.ts` / `documentRepoQueries.ts` shape exactly.

### §4.3 §3 surgical changes

- WI authored file list:
  - NEW: `services/case-box-persistence/src/sqlite/auditRepoQueries.ts`.
  - MODIFIED: `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` (2 stub bodies); `services/case-box-persistence/package.json` (filter regex); `services/case-box-persistence/tests/sqlite.conformance.test.mjs` (label + preflight); `services/case-box-persistence/tests/sqlite.hardening.test.mjs` (4 tests added); `services/case-box-persistence/tests/impl-parity.test.mjs` (4 scenarios added); `services/case-box-persistence/tests/invariants.test.mjs` (6.2.6b retarget).
- No drive-by refactors: do NOT reformat existing matterRepoQueries.ts / documentRepoQueries.ts even if a "consistency" itch arises.
- Remove only dead code created by THIS WI (none anticipated).
- Unrelated issues → `dev-memo/deferred-audit-findings.md` per the autonomy.md backlog discipline.

### §4.4 §4 goal-driven execution

- Acceptance criteria are testable (§1.7 above; all expressible as exit-0 test commands or specific assertions).
- New tests fail BEFORE impl (verify suite + hardening tests would throw `not_implemented` against pre-B3 SqliteCaseBoxPersistence) and pass AFTER.
- cc-suite audit on the impl commit's scope (mini); verify if fixes applied.
- Do NOT commit until acceptance passes.

### §4.5 §5 relationship to existing rules

- B3 plan does NOT bypass cc-suite review-plan (this very document is going through it).
- B3 plan does NOT relax loc-guardian thresholds.
- B3 plan respects the autonomy hard-stop list, rollback policy, night-run policy, and execution-discipline floor.

---

## §5 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Load-all approach to `verifyAuditChainForMatter` could become slow if per-matter event counts grow to many thousands. | v1 expects lawyer-scale (single lawyer; per-matter event counts in the tens-to-hundreds range). The contract's `verifyAuditChain` is O(N) and pure; SQLite SELECT ORDER BY sequence ASC is index-walked. If volume grows beyond v1 expectations, a follow-up WI can introduce paginated verification with stateful intermediate hash carrying — not in B3 scope. |
| 2 | Medium | Cursor-pagination drift between InMemory and SQLite (same as B2 risk #1). | Shared `encodeCursor` / `decodeCursor` / `computeFiltersHash` + impl-parity test asserting byte-identical `next_cursor` across multi-page traversal. |
| 3 | Medium | Tamper-detection tests must use direct SQL UPDATE to mutate `event_json`. If the test framework's transaction isolation is wrong, the mutation may not actually persist. | better-sqlite3's `db.exec()` is auto-commit by default; the impl WI verifies via re-SELECT after the UPDATE before calling `verifyAuditChainForMatter`. |
| 4 | Low | The verifier's `event_schema_invalid` code path is unreachable under normal writes; tamper test covers it indirectly via payload mutation. | Tamper test (§1.5 invariant 1) is sufficient; an explicit schema-invalid test is optional and would require synthesizing malformed `event_json` (e.g., truncated JSON). Defer to a follow-up only if a real corruption case emerges. |
| 5 | Low | `listAuditEvents` may diverge from `listAuditEventsHelper` if the in-memory helper changes filters in a future phase. | impl-parity tests guard the contract via deep-equal comparison. If the helper evolves (e.g., adds a `kind` filter), B-future-WI updates both impls together. |
| 6 | Low | `verifyAuditChain` is a CONTRACT function. If its semantics change, BOTH impls update simultaneously via the case-box-contract package; no SQLite-side fork. | Acknowledged; no mitigation needed beyond the existing contract review process. |

No Critical / High risks.

---

## §6 cc-suite audit / verify expectations

For the impl WI (NOT this plan-WI):

- **cc-suite audit (mini)** on the impl commit's scope. Expected: PASS or NEEDS-FIX with C/H/M fixed + verify in same commit.
- **cc-suite verify**: only if audit produces C/H/M findings the WI fixed.
- **Recording**: per `.claude/rules/cc-suite.md` §"Required recording" 11-field block in the impl commit's message body.

---

## §7 References

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (umbrella; READY at `1ac26b1`).
- `dev-memo/plan-case-box-persistence-B1-matter.md` (B1; READY at `9cf03d3`).
- `dev-memo/plan-case-box-persistence-B2-document.md` (B2; READY at `6f0540e`).
- B1 impl `601d74c`; B2 impl `6b5d5f6`; execution-discipline `9c0966f`.
- `services/case-box-persistence/src/inMemoryAudit.ts` (behavioral target).
- `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` (current B1+B2 state).
- `services/case-box-persistence/src/sqlite/matterRepoQueries.ts` + `documentRepoQueries.ts` (sibling-file precedent).
- `services/case-box-persistence/src/cursor.ts` (shared cursor utility).
- `services/case-box-persistence/src/auditChain.ts` (eventHashFn).
- `docs/contracts/case-box-contract/src/audit-log.ts` `verifyAuditChain` (reused verbatim).
- `.claude/rules/cc-suite.md`, `autonomy.md`, `loc-guardian.md`, `staging-hygiene.md`, `execution-discipline.md`.

---

## §8 Stop condition

This plan is stale or superseded when:

- B3 impl commits — plan transitions to "superseded by B3 impl commit `<hash>`"; file stays as historical reference.
- A future revision of the umbrella plan changes B3 scope — this plan amends or retires.
- The contract's `verifyAuditChain` is replaced or removed — this plan retires with the dep.
