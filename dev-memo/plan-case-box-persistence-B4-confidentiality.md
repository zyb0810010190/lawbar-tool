# Plan: CASE-BOX-PERSISTENCE B4 — SQLite confidentiality classification

**Status**: READY (revision 2 — review-plan v2 returned READY (Low-risk clarifications) at jobId `review-plan-mpgy7u9p-uo4ip0`. One Low (acceptance text "2 indices" → "3 indices" after the split) applied; other Lows accepted (shadow-state shim as coupling point — acknowledged; row-tamper cross-check between classification rows and audit payload — future-work, not B4 scope)).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Umbrella plan**: `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (READY at commit `1ac26b1`) §2 row B4.
**Predecessors**: ABI gate (`d02fff8`); B1 matter (`601d74c`); B2 document (`6b5d5f6`); B3 audit observability (`5400637`); execution-discipline floor (`9c0966f`).
**Risk**: HIGH (persistence + tenant/matter consistency + audit-chain invariants — `.claude/rules/cc-suite.md` §"High-risk WIs").

## Review packet (compact)

### Active plan summary

B4 is the FOURTH SQLite sub-WI of Phase B. It implements **confidentiality classification** persistence on top of the existing matter / document / audit-chain infrastructure (B1+B2+B3). Three methods convert from `not_implemented` stubs to real implementations:

- **`appendConfidentialityClassification(input)`** — append-only write. Reuses the EXPORTED `prepareAppendClassification` from `inMemoryClassification.ts` (validation + creation rule + transition-kind selection + audit-event build). Writes one classification row + one audit event in one `BEGIN IMMEDIATE` transaction. Updates `case_box_audit_chain_heads`.
- **`getEffectiveClassification(query)`** — pure read. Loads all classification rows for `(target_type, target_id)` under the matter, sorts latest-first via the contract's `compareClassificationLatestFirst` semantics, returns `{ effectiveLevel, history }`. Empty history → `"unclassified"` (deny-by-default).
- **`listConfidentialityClassifications(query)`** — paginated read of all classification rows for a matter. Ordered by `set_at ASC, id ASC` (matches in-memory list helper). Optional `target_type` + `target_id` filters. Seek pagination via shared cursor utility.

B4 adds schema **version 3**: `case_box_confidentiality_classifications` table + 3 indices (per-target latest-lookup; per-matter chronological list seek; filtered-target list seek). Step-5 contract helpers (`isDowngrade`, `isResetToUnclassified`, `assertValidNewConfidentialityClassification`, `validateConfidentialityClassification`) are reused VERBATIM through the existing `prepareAppendClassification` helper — NO Step-5 logic re-implementation in SQLite.

Plan is plan-only: no code, no schemas, no package edits.

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-B4-confidentiality.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/**` (no source / test / package edits).
- `docs/contracts/case-box-contract/**`.
- Any OCR package.
- AGENTS.md.
- Umbrella / B1 / B2 / B3 plans.
- `dev-memo/plan-case-box-persistence-00.md`.

### Exact acceptance criteria (this plan-WI itself)

1. The plan is committed alone (one file).
2. Plan enumerates B4 scope per umbrella §2 row B4 verbatim + expands into a concrete impl-WI shape.
3. Plan defines schema v3 DDL: one new table + **3 indices** (per-target latest-lookup + per-matter chronological list seek + filtered-target list seek).
4. Plan declares the conformance label filter regex (extends B3 with `6.A2.1`..`6.A2.24`).
5. Plan declares the 5 hardening invariants (cross-tenant target rejected; append-only history preserved; downgrade/reset reason requirements; deny-by-default effective; audit-chain atomic update).
6. Plan declares HARD-STOP categories that DO and DO NOT trigger.
7. Plan declares LOC budget (with extraction trigger reference).
8. Plan declares cc-suite audit + verify expectations.
9. Plan declares execution-discipline compliance per `.claude/rules/execution-discipline.md`.
10. cc-suite review-plan returns READY (or only Low-risk clarifications).

### Exact out-of-scope list (B4; deferred to B5+)

- **No B5+ entities** (privilege markers, facts, evidence, docket entries, deadlines, OCR links, aggregations, Once writers).
- **`target_type: "fact"` is REJECTED** at the persistence boundary (same as in-memory A2 behavior) until B6 (facts) ships. The contract permits `fact` target_type by schema; the persistence layer pre-empts at the helper for forward consistency. SQLite mirrors this rejection.
- **`target_type: "matter"` is REJECTED** unconditionally (matter-level confidentiality lives on the matter row itself, NOT as a classification entity).
- **No public-API change** — B4 implements 3 EXISTING interface methods.
- **No SQLite-specific public-API additions.**
- **No new top-level dep beyond what B1 already added.**
- **No real-data migration.**
- **No API / UI / mini-program / auth / cloud / sync / LLM / OCR runtime changes.**
- **No CI infrastructure.**
- **No git push.**
- **No committed rollback.**

### Essential references

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B4.
- `services/case-box-persistence/src/inMemoryClassification.ts` — behavioral target: `prepareAppendClassification`, `applyAppendClassification`, `getEffectiveClassificationHelper`, `listConfidentialityClassificationsHelper`, `findLatestForTarget`, `computeEffectiveLevel`, `selectAuditKind`.
- `services/case-box-persistence/src/resolveTarget.ts` — `resolveDocumentTarget` (tenant + matter consistency check; reused).
- `services/case-box-persistence/src/inMemoryRepo.ts` lines 346..360 — call sites.
- `services/case-box-persistence/src/cursor.ts` — `kind: "classifications_by_matter"` already exists.
- `services/case-box-persistence/src/sqlite/schema.ts` — extend `DDL_BY_VERSION` with version 3.
- `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` — convert 3 stubs to impls.
- `services/case-box-persistence/src/sqlite/matterRepoQueries.ts` + `documentRepoQueries.ts` + `auditRepoQueries.ts` — SQL helper sibling-file precedent.
- `docs/contracts/case-box-contract/src/confidentiality-classification.ts` (or equivalent) — `assertValidNewConfidentialityClassification`, `isDowngrade`, `isResetToUnclassified` (reused VERBATIM via existing in-memory helper).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — B4 cases at `6.A2.1`..`6.A2.24` (26 cases).
- `.claude/rules/cc-suite.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

### Review questions for the reviewer

1. Is the **shared-helper reuse** approach (call `prepareAppendClassification` from `inMemoryClassification.ts` directly) the right call vs reimplementing classification validation in SQLite? Plan picks **shared helper reuse** for symmetry with B1's `prepareCreateMatter` / B2's `prepareRegisterDocument` precedent — validation/transition/audit-event-build logic lives in ONE place.

2. Should `case_box_confidentiality_classifications.target_id` be a FK to `case_box_documents.id`? Plan picks **NO FK** per the consistent no-FK posture from B1/B2/B3 + SQLite ALTER flexibility. `resolveDocumentTarget` enforces target existence + tenant + matter consistency at the application layer inside the transaction.

3. Should the schema lift `target_type`, `target_id`, `level`, `prior_level`, `set_at`, `change_reason_code` to columns? Plan picks **YES** — all 6 are query/filter fields (used by `findLatestForTarget`, list filters, and the per-target latest-lookup index). `payload_json` carries the full row as canonical source.

4. Is the conformance label filter regex correct? Plan picks `^Sqlite-B4: (?:6\.1\.(?:13a|26-27|[1-9]|1[0-5]|1[6-9]|2[0-8]|29|30|31|3[2-8])|6\.A2\.(?:9a|9b|[1-9]|1[0-9]|2[0-4])|R5\.(?:[1-9]|9b|1[0-4])|R6\.[1-3])(?:\s|$)` — superset of B3 + A2 conformance cases `6.A2.1`..`6.A2.24` (including `9a` and `9b` variants).

5. Should B4 ship `case_box_confidentiality_classifications.fact_target_marker` placeholder column for forward B6 facts? Plan picks **NO** — fact target_type is rejected at B4; the column would be dead until B6 + adds drift risk. Schema v6 can ALTER ADD COLUMN when facts ship.

6. Should the per-target latest-lookup use a covering index `(matter_id, target_type, target_id, set_at DESC, id ASC)`? Plan picks **YES** — the in-memory `findLatestForTarget` is the hot path for every `appendConfidentialityClassification` (prior-row lookup) AND `getEffectiveClassification`. Index match the sort comparator exactly.

7. Should B4 add explicit hardening tests for the 5 invariants beyond what the shared conformance harness already covers? Plan picks **YES** — invariants documented in §5 below; tests written in `sqlite.hardening.test.mjs` alongside B1/B2/B3 hardening tests.

---

## §1 B4 scope (verbatim from umbrella + expanded)

### §1.1 Schema v3

Adds schema **version 3**. CURRENT_SCHEMA_VERSION bumps from 2 to 3. B1's v1 and B2's v2 DDL are NOT modified.

`DDL_STATEMENTS_V3` adds:

```sql
CREATE TABLE IF NOT EXISTS case_box_confidentiality_classifications (
  id                       TEXT    PRIMARY KEY,
  tenant_id                TEXT    NOT NULL,
  matter_id                TEXT    NOT NULL,
  target_type              TEXT    NOT NULL CHECK (target_type IN ('document','fact')),
  target_id                TEXT    NOT NULL,
  level                    TEXT    NOT NULL,
  prior_level              TEXT,
  set_at                   TEXT    NOT NULL COLLATE BINARY,
  actor_user_id            TEXT    NOT NULL,
  change_reason_code       TEXT,
  payload_json             TEXT    NOT NULL
);
-- Note: column name `actor_user_id` matches the in-memory
-- `CaseBoxConfidentialityClassification.actor_user_id` field — no
-- projection rename (per rev-1 reviewer Medium D1#1).

-- Per-target latest-lookup index. Mixed-order DESC/ASC matches the
-- centralized comparator (set_at DESC, id ASC tiebreak). Walked by
-- findLatestForTarget on every append (prior-row resolution) AND by
-- getEffectiveClassification.
CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_target
  ON case_box_confidentiality_classifications
    (matter_id, target_type, target_id, set_at DESC, id ASC);

-- Per-matter chronological list seek index (unfiltered matter-wide).
-- listConfidentialityClassifications without target_type/target_id
-- filters walks this index directly; ORDER BY set_at ASC, id ASC.
-- Per rev-1 reviewer Medium D3#2 + D5#2: target_type/target_id
-- placed AFTER the sort keys would force a separate sort on
-- matter-wide listing; this index uses (matter_id, set_at, id) so
-- chronological order is supported without extra sorting.
CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_matter_seek
  ON case_box_confidentiality_classifications
    (matter_id, set_at ASC, id ASC);

-- Filtered-target list seek index. listConfidentialityClassifications
-- WITH target_type (+optional target_id) filter walks this index.
-- Same ordering tail (set_at ASC, id ASC) but with the filter keys
-- in front so SQLite can use the index range-scan + ORDER BY.
CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_matter_target_seek
  ON case_box_confidentiality_classifications
    (matter_id, target_type, target_id, set_at ASC, id ASC);
```

**No FOREIGN KEY** to `case_box_matters` or `case_box_documents`. Application-layer enforcement via `resolveDocumentTarget` inside the transaction.

R-5 / R-6 / Step-5 fields stay in `payload_json`; columns lifted for index efficiency (per §"Review questions" #3).

### §1.2 `SqliteCaseBoxPersistence` method implementations

Convert 3 stubs to implementations:

- **`appendConfidentialityClassification(input)`** — wraps `prepareAppendClassification` inside one `db.transaction().immediate()`:
  1. Matter-existence check (SELECT 1 FROM case_box_matters WHERE id = ?). Throw `unknown_matter` if absent.
  2. Construct SQLite-backed callbacks:
     - `getDocument(documentId)` → SELECT payload_json FROM case_box_documents (returns `{ document } | null`).
     - `storedAuditEventsForMatter()` → reuse `loadSyntheticStoredEvents(db, matterId)` from B1/B2.
  3. `findLatestForTarget` callback is implicit — `prepareAppendClassification` calls it via the state argument. **For SQLite, we must adapt**: provide a SQLite-backed `ClassificationState`-shaped object OR refactor the prepare helper to accept a callback. **Plan picks: provide a minimal in-memory shadow state for the prepare call's prior-row lookup** — load existing classifications for `(matter_id, target_type, target_id)` from SQLite (single SELECT walking the per-target index), populate a tiny ClassificationState (one Map entry, one Set), pass to `prepareAppendClassification`. This keeps the prepare helper untouched.
  4. Call `prepareAppendClassification(shadowState, input, deps)`.
  5. `eventHash = eventHashFn(prepared.audit.event)`.
  6. INSERT INTO case_box_confidentiality_classifications.
  7. INSERT INTO case_box_audit_events.
  8. UPSERT case_box_audit_chain_heads.
  9. Return `structuredClone(prepared.row)`.

- **`getEffectiveClassification(query)`** — pure read:
  1. **Target-type validation** (per rev-1 reviewer High D2#2): if `query.target_type !== "document"`, throw `CaseBoxPersistenceError("invalid_argument", ...)`. The contract type already constrains it to `"document"` literal-only at the TS level; the runtime check defends against caller bypass + mirrors `appendConfidentialityClassification`'s pre-B6 `fact`/`matter` rejection (lift point: B6 when facts ship).
  2. Matter-existence check + tenant check.
  3. Document-target resolution via `resolveDocumentTarget` callback (verifies target exists + tenant + matter consistency).
  4. SELECT all rows for `(matter_id, target_type, target_id)` walking `idx_case_box_classifications_by_target` (DESC order); JSON.parse `payload_json` for each.
  5. Return `{ effectiveLevel: history[0]?.level ?? "unclassified", history }`.

- **`listConfidentialityClassifications(query)`** — paginated read:
  1. Matter-existence + tenant check.
  2. `resolveLimit(query.limit)`.
  3. Filter validation: `target_id` without `target_type` → `invalid_argument` (matches in-memory).
  4. `computeFiltersHash` + `decodeCursor` (kind `classifications_by_matter`).
  5. SELECT with WHERE + ORDER BY set_at ASC, id ASC + seek pagination. Mirrors B2's listDocuments / B3's listAuditEvents pattern.
  6. Slice + `next_cursor`.
  7. JSON.parse each row's `payload_json`.

### §1.3 SQL helper extraction

CREATE: `services/case-box-persistence/src/sqlite/classificationRepoQueries.ts` (~110-140 LOC estimated).

Contents:
- `insertClassificationRow(db, row)`.
- `selectClassificationsByTarget(db, matterId, targetType, targetId)` — full history for getEffective.
- `listConfidentialityClassificationsSqlite(db, query)` — full list impl.
- `buildSqliteShadowClassificationState(db, matterId, targetType, targetId)` — populates a FAITHFUL minimal `ClassificationState`-shape object for `prepareAppendClassification`. Per rev-1 reviewer High D2#1 + D4#2 + D5#1:
  - `classificationIds: Set<string>` = **GLOBAL** — populated from `SELECT id FROM case_box_confidentiality_classifications` across the ENTIRE table (not matter-scoped). This matches the in-memory `ClassificationState.classificationIds` invariant exactly; a duplicate id from another matter must still throw `CaseBoxPersistenceError("duplicate_id", ...)` via the helper's path, not as a raw SQLite PK conflict.
  - `classificationsByMatter: Map<string, CaseBoxConfidentialityClassification[]>` = ONE entry keyed by `matterId`, containing only rows matching `(target_type, target_id)` from the input (the helper's `findLatestForTarget` is called inside `prepareAppendClassification` and only inspects rows for the input's specific target). Other matters' rows + other targets' rows are NOT loaded — they're irrelevant to the prior-row lookup.
- Internal helper: `selectMatterTenantForClassification(db, matterId)`.

`SqliteCaseBoxPersistence.ts` gains ~15-20 LOC from converting 3 stubs to thin calls. The `loadSyntheticStoredEvents` helper (already in `SqliteCaseBoxPersistence.ts` from B2) is reused for the audit-chain prior-head lookup.

### §1.4 Tenant / matter / target scoping

- **Append**: matter existence at step 1; document target resolution at step 3 via `resolveDocumentTarget` (which throws `unknown_document` / `tenant_mismatch` / `matter_id_mismatch`).
- **getEffective**: matter existence + tenant check first; then document target resolution.
- **list**: matter existence + tenant check; no target resolution because list operates on the matter's full history.
- **target_type='matter'**: rejected pre-schema at step 0 of `prepareAppendClassification` (matches in-memory).
- **target_type='fact'**: rejected pre-schema (matches in-memory; B6 will widen when facts ship). The shared `prepareAppendClassification` helper's existing rejection message references "Phase A4" historically (per rev-1 reviewer Low D4#1) — that wording is inherited; B6's plan must update the helper's message to "Phase B6" when the lift happens. NOT in B4 scope to change.

### §1.5 Append-only classification history

- Rows are append-only — NO UPDATE on `case_box_confidentiality_classifications`. Every classification change inserts a new row with the prior level in `prior_level`. The "latest" view is computed via the comparator (set_at DESC, id ASC).
- `assertValidNewConfidentialityClassification` from the contract enforces the prior-row / transition rules:
  - First classification: `prior_level === null`.
  - Subsequent: `prior_level === <stored latest>.level`.
  - Same-level (prior === next) rejected upstream.
  - Downgrade / reset-to-unclassified: `change_reason_code` REQUIRED.

### §1.6 Audit event emission

Each successful append emits ONE audit event. Kind is selected by `selectAuditKind`:
- `prior_level === null` → `CLASSIFICATION_SET`.
- `isResetToUnclassified(prior, next)` → `CLASSIFICATION_RESET_TO_UNCLASSIFIED`.
- `isDowngrade(prior, next)` → `CLASSIFICATION_DOWNGRADED`.
- else → `CLASSIFICATION_UPGRADED`.

Audit-chain update mirrors B1/B2: INSERT case_box_audit_events + UPSERT case_box_audit_chain_heads, atomic with the classification row INSERT.

### §1.7 Effective classification computation

`getEffectiveClassification` walks the per-target index (DESC) → first row IS the latest (the index ordering matches the comparator). For empty history: `{ effectiveLevel: "unclassified", history: [] }` — deny-by-default.

### §1.8 Tests

- **`tests/sqlite.conformance.test.mjs`** — `--test-name-pattern` widened to include `6.A2.1`..`6.A2.24` (26 cases including `9a` and `9b` variants). `B4_EXPECTED_CASE_IDS` extends `B3_EXPECTED_CASE_IDS` with 26 new ids. Label `Sqlite-B3` → `Sqlite-B4`. Preflight regex assertion includes the new ids and rejects out-of-scope cases (e.g., `6.A3.1` for B5+).

- **`tests/sqlite.hardening.test.mjs`** — 5 new B4 invariant tests:
  1. **Cross-tenant target rejected**: `appendConfidentialityClassification` with `tenant_id` differing from the target document's tenant → `tenant_mismatch` (via `resolveDocumentTarget`).
  2. **Append-only history preserved**: after 5 sequential classifications on the same target, all 5 rows visible in `getEffectiveClassification.history`; row count via SELECT equals 5; no UPDATE on classification table (verify via `sqlite_master` indexes or by triggering an explicit "would-be-update" path through duplicate-id rejection).
  3. **Downgrade requires reason**: `appendConfidentialityClassification` for a downgrade transition WITHOUT `change_reason_code` → `invalid_payload` (via `assertValidNewConfidentialityClassification`).
  4. **Deny-by-default effective classification**: `getEffectiveClassification` on a target with NO history rows → `{ effectiveLevel: "unclassified", history: [] }`.
  5. **Audit-chain atomic**: after `createMatter + appendConfidentialityClassification`, the invariant `event_count == COUNT(*) == MAX(sequence) == 2` holds in `case_box_audit_chain_heads` / `case_box_audit_events`.

- **`tests/impl-parity.test.mjs`** — extends with 5+ classification scenarios:
  - SET happy path returns identical row (uses `makeAuditPair` shared id-prefix from B3 because classification rows embed audit-event ids via the chain).
  - UPGRADED transition (normal → confidential) deep-equal.
  - DOWNGRADED with reason deep-equal.
  - RESET_TO_UNCLASSIFIED with reason deep-equal.
  - `getEffectiveClassification` with multi-row history → identical `{ effectiveLevel, history }` across impls.
  - `listConfidentialityClassifications` pagination byte-identical `next_cursor` across 2 pages.
  - Rejection parity: cross-tenant, unknown target, duplicate id, same-level — same error codes on both impls.
  - **Same-`set_at` tiebreak parity** (per rev-1 reviewer Low D5#3): two classification rows for the same target sharing identical `set_at` ISO timestamp; assert both impls return the same row as latest after `id ASC` tiebreak (the smaller id wins).

- **`tests/invariants.test.mjs`** — 6.2.6b retargeted from `appendConfidentialityClassification` (now B4-implemented) to `appendPrivilegeMarker` (B5 — next stub frontier).

### §1.9 Acceptance criteria (impl WI; this plan-WI does NOT execute)

1. `npm --prefix services/case-box-persistence test` exits 0 with all conformance + R-5 + R-6 + audit-read + classification cases running under `Sqlite-B4`.
2. SQLite impl passes shared conformance cases `6.A2.1`..`6.A2.24` + all carried-forward B1/B2/B3 cases.
3. The 5 hardening tests pass.
4. impl-parity tests deep-compare classification scenarios across both impls.
5. All Phase A in-memory tests stay green.
6. B1+B2+B3 SQLite tests stay green.
7. ocr-persistence + ocr-worker + case-box-contract + docs/contracts unchanged green.
8. loc-guardian: 0 over fail. `SqliteCaseBoxPersistence.ts` stays under 500 pure LOC.
9. cc-suite audit (mini) PASS or NEEDS-FIX-fixed-and-verified.

---

## §2 LOC budget per file (post-B4)

Current state (post-B3 commit `5400637`):

| File | Current LOC | Threshold |
|---|---|---|
| `src/sqlite/schema.ts` | 228 | source warn 500 |
| `src/sqlite/SqliteCaseBoxPersistence.ts` | 494 | source warn 500, fail 800 |
| `src/sqlite/matterRepoQueries.ts` | 89 | |
| `src/sqlite/documentRepoQueries.ts` | 170 | |
| `src/sqlite/auditRepoQueries.ts` | 162 | |
| `src/sqlite/openSqliteCaseBoxPersistence.ts` | 58 | |

Estimated B4 additions:
- `classificationRepoQueries.ts` (NEW): ~110-140 LOC (3 methods + 2 internal helpers).
- `SqliteCaseBoxPersistence.ts`: 3 stubs (~9 LOC) → 3 thin calls (~9 LOC). NET ZERO change.
- `schema.ts`: +30-40 LOC for DDL_STATEMENTS_V3 + map entry.

**Estimated post-B4 `SqliteCaseBoxPersistence.ts`: ~494 LOC**. Comfortably under 500 trigger. No additional extraction.

Test files:
- `sqlite.conformance.test.mjs`: ~30 LOC added (preflight regex + 26 new expected ids).
- `sqlite.hardening.test.mjs`: ~100 LOC added (5 new tests).
- `impl-parity.test.mjs`: ~120 LOC added (5+ new scenarios).

**No file approaches fail threshold post-B4.**

---

## §3 Hard-stop alignment

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED (B4 reads+writes SQLite).
- **New runtime dependency** — NOT triggered.
- **Schema introduction on persisted data** — NOT triggered (no real DB exists).
- **Public API break** — NOT triggered (B4 implements 3 EXISTING interface methods).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered.
- **Push / deploy / secrets / production data** — NOT triggered.

Per the no-revert posture: fix-forward inside B4 impl; if unworkable, STOP-FOR-ROLLBACK per `dev-memo/rollback-00.md`.

---

## §4 Execution-discipline compliance (per `.claude/rules/execution-discipline.md` commit `9c0966f`)

### §4.1 Think before coding

- WI scope: 3 method impls + 1 new SQL helper file + schema v3 + test extensions. Out-of-scope list explicit.
- Assumptions: (a) `prepareAppendClassification` is REUSED VERBATIM via a shadow-state shim; (b) `findLatestForTarget` lives in the in-memory helper — the SQLite path reuses it by populating a minimal shadow state; (c) `target_type='fact'` rejection mirrors in-memory pre-B6 behavior.
- Hard stops cross-checked: no triggers; lane authorization N/A (plan-only).
- Ambiguity routed: no whole-product ambiguity; cc-suite review-plan loop runs BEFORE coding.

### §4.2 Simplicity first

- Smallest slice: 3 methods + 1 sibling file + 1 schema version.
- Reuse: `prepareAppendClassification` (in-memory helper), `assertValidNewConfidentialityClassification` (contract), `selectAuditKind` (in-memory helper), `compareClassificationLatestFirst` (implicit via mixed-order DESC/ASC index), `eventHashFn` (auditChain.ts), shared cursor utility (cursor.ts), `loadSyntheticStoredEvents` (existing B1/B2 helper).
- No speculative abstractions: NO generalized `targetResolver` interface, NO pluggable transition-kind strategy, NO new SQL macros.
- LOC extraction is MECHANICAL: new sibling matches `matterRepoQueries.ts` / `documentRepoQueries.ts` / `auditRepoQueries.ts` shape.

### §4.3 Surgical changes

- WI authored file list:
  - NEW: `services/case-box-persistence/src/sqlite/classificationRepoQueries.ts`.
  - MODIFIED: `services/case-box-persistence/src/sqlite/schema.ts` (add DDL_STATEMENTS_V3 + bump CURRENT_SCHEMA_VERSION); `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` (3 stub bodies); `services/case-box-persistence/package.json` (filter regex); `services/case-box-persistence/tests/sqlite.conformance.test.mjs` (label + preflight); `services/case-box-persistence/tests/sqlite.hardening.test.mjs` (5 tests added); `services/case-box-persistence/tests/impl-parity.test.mjs` (5+ scenarios added); `services/case-box-persistence/tests/invariants.test.mjs` (6.2.6b retarget to appendPrivilegeMarker).
- No drive-by refactors: do NOT reformat existing sibling query files even if a "consistency" itch arises.
- Remove only dead code created by THIS WI (none anticipated).
- Unrelated issues → backlog.

### §4.4 Goal-driven execution

- Acceptance criteria testable (§1.9 — exit-0 test commands or specific assertions).
- New tests fail BEFORE impl (5 hardening + 5+ parity tests fail against pre-B4 SqliteCaseBoxPersistence with `not_implemented`).
- cc-suite audit on impl commit; verify if fixes applied.
- Do NOT commit until acceptance passes.

### §4.5 Relationship to existing rules

- B4 plan does NOT bypass cc-suite review-plan (this document is going through it).
- B4 plan does NOT relax loc-guardian thresholds.
- B4 plan respects autonomy hard-stops, rollback policy, night-run policy, execution-discipline floor.

---

## §5 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Shadow-state shim for `prepareAppendClassification` could diverge from in-memory if the helper's contract evolves (e.g., a new field added to `ClassificationState`). | Shim builds a minimal but FAITHFUL state from SQLite query results — populates BOTH `classificationsByMatter` (for `findLatestForTarget`) AND `classificationIds` (for duplicate-id check). If `ClassificationState` evolves, B4 shim updates in tandem (single change point). impl-parity tests catch drift. |
| 2 | Medium | Cursor-pagination drift between in-memory and SQLite for list (Medium per B2/B3 precedent). | Shared `encodeCursor`/`decodeCursor`/`computeFiltersHash` + impl-parity test asserting byte-identical `next_cursor` across multi-page traversal. |
| 3 | Medium | Per-target latest-lookup index efficiency depends on SQLite query planner picking it correctly. | Mixed-order DESC/ASC index matches the comparator + the SELECT's ORDER BY. Add an `EXPLAIN QUERY PLAN` smoke check in the hardening test (assert index name in the plan) IF needed; otherwise rely on B2/B3 precedent that mixed-order indices work as expected. |
| 4 | Low | `target_type='fact'` rejection is a forward-compatibility pre-empt for B6. If B6 wires facts before B4 ships in production, this rejection will need to be lifted. | Out-of-scope for B4. B6 plan must explicitly update the rejection. The shared `prepareAppendClassification` helper carries the rejection in ONE place; no SQLite-side fork. |
| 5 | Low | SQLite-specific tamper of `case_box_confidentiality_classifications.payload_json` could let an attacker rewrite `prior_level` without triggering the chain verifier (the chain protects audit events, not classification rows). | Out-of-scope for B4 (covered indirectly: each classification append emits an audit event whose payload is hashed; an attacker mutating the classification row alone would create a mismatch between the audit-event's `after_state_hash` and the row's actual state, but verifying THAT requires a B-future-WI cross-check). Recorded as a known gap. |
| 6 | Low | The shared-helper reuse means B4's SQLite path makes ONE extra SQL call for the prior-row lookup (per append). The total cost per append is ~3 SELECTs + ~3 INSERTs/UPSERTs. Acceptable for v1 lawyer-scale. | No mitigation needed at v1. |
| 7 | Low | `set_at` is a TEXT (ISO timestamp) column with COLLATE BINARY. If two classification appends collide on the millisecond timestamp, the comparator falls back to `id ASC` tiebreak. The test clock advances 1s per call → no collision. Real-world: ULID-shape ids are random; collision unlikely. | impl-parity tests use deterministic clock; production code accepts the corner case as benign. |

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
- B1 plan `9cf03d3` + impl `601d74c`.
- B2 plan `6f0540e` + impl `6b5d5f6`.
- B3 plan `afe607b` + impl `5400637`.
- execution-discipline `9c0966f`.
- `services/case-box-persistence/src/inMemoryClassification.ts` (behavioral target; `prepareAppendClassification`, `applyAppendClassification`, helpers).
- `services/case-box-persistence/src/resolveTarget.ts` (`resolveDocumentTarget`).
- `services/case-box-persistence/src/cursor.ts` (`kind: "classifications_by_matter"`).
- `services/case-box-persistence/src/sqlite/{schema.ts, SqliteCaseBoxPersistence.ts, matterRepoQueries.ts, documentRepoQueries.ts, auditRepoQueries.ts}`.
- `docs/contracts/case-box-contract/src/confidentiality-classification.ts` (contract helpers; reused VERBATIM).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` lines 400..768 (B4 cases 6.A2.1..6.A2.24).
- `.claude/rules/cc-suite.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

---

## §8 Stop condition

This plan is stale or superseded when:

- B4 impl commits — plan transitions to "superseded by B4 impl commit `<hash>`"; file stays as historical reference.
- A future revision of the umbrella plan changes B4 scope.
- The contract's classification helpers (`assertValidNewConfidentialityClassification`, etc.) are replaced or removed — this plan retires with the dep.
