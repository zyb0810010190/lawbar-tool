# Plan: CASE-BOX-PERSISTENCE B2 — SQLite document persistence

**Status**: READY (revision 2 — review-plan v2 returned READY (Low-risk clarifications) at jobId `review-plan-mpgv6bj8-rn6tbp`. Two Lows applied opportunistically: no-FK rationale reframed as SQLite-flexibility-not-OCR-boundary; conformance "unchanged file" wording corrected to "harness unchanged; wrapper updated").
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Umbrella plan**: `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (READY at commit `1ac26b1`) §2 row B2.
**B1 plan**: `dev-memo/plan-case-box-persistence-B1-matter.md` (READY at commit `9cf03d3`).
**B1 impl**: commit `601d74c`.
**Predecessor closure**: ABI gate closed (`d02fff8`); B1 (matter) closed (`601d74c`).
**Risk**: HIGH (native module + persistence — `.claude/rules/cc-suite.md` §"High-risk WIs").

## Review packet (compact)

### Active plan summary

B2 is the SECOND SQLite sub-WI of Phase B. It implements the **document** entity end-to-end on the SQLite side: `registerDocument`, `getDocument`, `listDocuments`. It adds the `case_box_documents` SQLite table at schema v2 plus indices for the existing listDocuments seek-pagination order (`received_at DESC, id ASC`). It absorbs R-5 document obligations (purpose / work_order_status / lifecycle free-text / supersedes_document_id) and R-6 doc-asset obligations (mime_type / byte_size / manual_extracted_text) through the canonical `payload_json` column — no new schema columns are required for those fields beyond keying `supersedes_document_id` and `doc_type` for filter indices.

B2 reuses the EXPORTED `prepareRegisterDocument` and `listDocumentsHelper` from `services/case-box-persistence/src/inMemoryDocument.ts` — same shared-helper pattern that B1's `prepareCreateMatter` / `prepareMatterTransition` used. The conformance harness's `listDocumentsHelper` accepts `(matters, documents, query)` Maps; the SQLite implementation builds an equivalent pair of Maps from SELECT results (acceptable for v1 / small-volume lawyer corpus) OR inlines the filter+sort+cursor logic in a single SELECT. **Plan picks the inlined-SQL approach** for B2 — see §3.5.

`SqliteCaseBoxPersistence.registerDocument` / `getDocument` / `listDocuments` move from `not_implemented` stubs to real implementations. All other non-B1 / non-B2 methods continue to throw `not_implemented` with B<N> hints.

B2 does NOT implement `appendDocumentOnce` — that's a B11 method (replay-safe `*Once` variants) and the in-memory implementation does not have it either. (Per `inMemoryRepo.ts` the only `*Once` writer is `appendFactOnce` from A9.) So idempotency in B2 is "second registerDocument with same id → `duplicate_id`", matching the in-memory contract.

Plan is plan-only: no code, no schemas, no `package.json` change here.

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-B2-document.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/**` (no source / test / package edits).
- `docs/contracts/case-box-contract/**`.
- Any OCR package.
- AGENTS.md.
- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (the B1-divergence umbrella amendment stays a separate docs-only WI; see §"Umbrella amendment posture" below).
- `dev-memo/plan-case-box-persistence-00.md`.

### Exact acceptance criteria (this plan-WI itself)

1. The plan is committed alone (one file).
2. The plan enumerates B2 scope per umbrella §2 row B2 verbatim + expands into a concrete impl-WI shape.
3. The plan defines schema v2 DDL: one new table `case_box_documents` + indices supporting listDocuments pagination + filter, no FK constraints across the case-box / OCR boundary.
4. The plan declares the conformance label filter regex that selects exactly B2 + carried-forward B1 cases.
5. The plan picks the listDocuments implementation strategy (inlined SQL vs build-maps-and-call-helper) with reasoning.
6. The plan declares HARD-STOP categories that DO and DO NOT trigger.
7. The plan declares LOC budget per touched file (especially `SqliteCaseBoxPersistence.ts` growth and any new sibling extraction).
8. The plan declares cc-suite audit + verify expectations for the impl WI.
9. cc-suite review-plan returns READY (or only Low-risk clarifications).

### Exact out-of-scope list (B2; deferred to B3+)

- **No facts / evidence / deadlines / docket entries / privilege / classification / OCR-link SQLite impls** (B3-B9).
- **No `listAuditEvents` / `verifyAuditChainForMatter` SQLite impls** (B3 still). `getAuditChainHead` already implemented in B1.
- **No read-side aggregation expansions** (`getMatterSummary`, `getDocumentDetail` — these are B10). NOTE: `getDocumentDetail` is the read-aggregation method; raw `getDocument(documentId)` is a B2 method (single-row read by primary key) and IS in scope.
- **No `appendFactOnce` / replay-safe `*Once` variants** (B11).
- **No API / UI / mini-program / auth / cloud / sync / LLM / OCR runtime changes.**
- **No new top-level dep beyond what B1 already added.**
- **No public-API change.**
- **No SQLite-specific public-API additions.**
- **No CI infrastructure.**
- **No git push.**
- **No committed rollback.**
- **No umbrella plan amendment bundled with B2 impl.** The B1-divergence on `audit_chain_heads` table location + the new B2-divergence (if any) belong in a SEPARATE docs-only follow-up WI. See §"Umbrella amendment posture".

### Essential references

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B2 (R5.7-R5.14 + R6.1-R6.4 doc-asset).
- `dev-memo/plan-case-box-persistence-B1-matter.md` (READY at `9cf03d3`) — pattern precedent; same schema-version + factory + shared-helper approach.
- `services/case-box-persistence/src/inMemoryDocument.ts` — behavioral target: `prepareRegisterDocument`, `listDocumentsHelper`.
- `services/case-box-persistence/src/inMemoryRepo.ts` lines 278-320 — `registerDocument` / `getDocument` / `listDocuments` call sites.
- `services/case-box-persistence/src/cursor.ts` — `encodeCursor` / `decodeCursor` (`kind: "documents_by_matter"`) + `computeFiltersHash`.
- `services/case-box-persistence/src/sqlite/schema.ts` — extend `DDL_BY_VERSION` with version 2.
- `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` — convert 3 stubs (`registerDocument`, `getDocument`, `listDocuments`) into implementations.
- `services/case-box-persistence/src/sqlite/matterRepoQueries.ts` — extend with document SQL helpers OR introduce a sibling `documentRepoQueries.ts` (decision at §6 LOC).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` (UNCHANGED in B2; same shared harness).
- `docs/contracts/case-box-contract/schemas/case-box-document.schema.json` — document schema (read-only reference; R-5/R-6 fields).
- `docs/contracts/case-box-contract/src/case-box-document-supersession-invariants.ts` — `assertValidDocumentSupersession` (already wired in `inMemoryDocument.ts`).
- `services/case-box-persistence/tests/invariants.test.mjs` — 6.2.1 already permits `better-sqlite3` post-B1; 6.2.6 already includes `not_implemented`.
- `.claude/rules/cc-suite.md` + `.claude/rules/autonomy.md` + `.claude/rules/loc-guardian.md`.

### Review questions for the reviewer

1. Is **inlined SQL** for `listDocuments` (single SELECT with WHERE + ORDER BY + LIMIT + cursor-seek) the right call vs `build-maps-and-call-listDocumentsHelper`? Plan picks inlined SQL because (a) the helper takes `Map<string, ...>` of all documents which forces a `SELECT *` into the application layer — defeats the index benefits, and (b) the cursor semantics (`encodeCursor` / `decodeCursor` with `filters_hash`) MUST match in-memory exactly, so the cursor utility is reused but the row-iteration is in SQL.

2. Is schema v2 DDL minimum (one new table `case_box_documents` + 2 indices) correct, or should B2 also pre-create the `case_box_facts` placeholder for B6? Plan picks minimal v2.

3. Should `mime_type`, `byte_size`, `manual_extracted_text` be lifted to columns or stay JSON-only? Plan picks **JSON-only** — these are read-only canonical-source fields used by R6.4 `getDocumentDetail` (B10). Lifting them creates duplication risk without query benefit at B2.

4. Should `case_box_documents` carry a foreign key to `case_box_matters(id)`? Plan picks **NO FK** — parent §4 invariant "Dependency direction is one-way; case-box references OCR by value only" applies SYMMETRICALLY here (no FK across case-box internal tables either, matching the OCR-persistence precedent). The matter-existence check happens at the application layer inside the transaction.

5. Is the conformance label filter regex correct? Plan picks `^Sqlite-B2: (?:6\.1\.(?:13a|[1-9]|1[0-5]|1[6-9]|2[0-7])|R5\.[1-9]|R5\.9b|R5\.1[0-4]|R6\.[1-4])(?:\s|$)`. (B2's filter is a SUPERSET of B1's: matter cases + matter R5 + document conformance + document R5 + R6.)

6. Should B2 stash the B1 umbrella-divergence amendment now (modify B3 row wording in the umbrella) or keep it separate? Plan keeps it separate (see §"Umbrella amendment posture").

7. The shared `listDocumentsHelper` takes `Map<string, { document, matter_id }>`. The SQLite impl does NOT use that helper directly. The shared validation/transition logic IS reused (`prepareRegisterDocument`). Is that asymmetric reuse acceptable, or should we extract a `listDocumentsCore(rows, query)` helper that operates on an iterable instead of a Map? Plan accepts asymmetry for B2 + notes follow-up extraction risk in §"Risks".

---

## §1 B2 scope (verbatim from umbrella + expanded)

### §1.1 Schema

Add schema **version 2**. CURRENT_SCHEMA_VERSION bumps from 1 to 2. The B1 v1 DDL is NOT modified.

`DDL_STATEMENTS_V2` adds:

```sql
CREATE TABLE IF NOT EXISTS case_box_documents (
  id                       TEXT    PRIMARY KEY,
  tenant_id                TEXT    NOT NULL,
  matter_id                TEXT    NOT NULL,
  actor_user_id            TEXT    NOT NULL,
  status                   TEXT    NOT NULL,
  received_at              TEXT    NOT NULL COLLATE BINARY,
  doc_type                 TEXT    NOT NULL,
  supersedes_document_id   TEXT,
  payload_json             TEXT    NOT NULL
);

-- Supports listDocuments seek pagination. The query is
--   ORDER BY received_at DESC, id ASC
-- so the index uses MIXED ordering to let SQLite walk it directly
-- without an extra sort step (per rev-1 reviewer Dim-3 #1).
CREATE INDEX IF NOT EXISTS idx_case_box_documents_by_matter
  ON case_box_documents (tenant_id, matter_id, received_at DESC, id ASC);

-- Supports R-5(d) supersession invariant lookup (getDocumentById by id).
-- Already covered by PRIMARY KEY; explicit index documented for clarity.
-- (Index NOT created; PRIMARY KEY suffices.)

-- Supports filter narrowing in listDocuments by status + doc_type.
-- Same MIXED-ordering tail as the seek index (received_at DESC, id ASC).
CREATE INDEX IF NOT EXISTS idx_case_box_documents_by_matter_filter
  ON case_box_documents (tenant_id, matter_id, status, doc_type, received_at DESC, id ASC);
```

**No FOREIGN KEY** to `case_box_matters(id)`. Parent §"Dependency direction is one-way" applies (per B1 plan §3). Matter-existence check is application-layer inside the transaction.

**R-5 + R-6 fields stay in `payload_json`** — purpose, work_order_status, lifecycle free-text fields, mime_type, byte_size, manual_extracted_text. No columns lifted for these. On read, the canonical payload is JSON.parse'd and returned verbatim — same canonical-source rule as B1's matter.

### §1.2 `SqliteCaseBoxPersistence` method implementations

Convert 3 stubs to implementations:

- **`registerDocument(matterId: string, input: unknown): Promise<CaseBoxDocument>`** — wraps `prepareRegisterDocument` inside one `db.transaction(...).immediate()`:
  1. SELECT matter (tenant_id + payload_json) by `matterId`; throw `unknown_matter` if absent (matches `inMemoryRepo.registerDocument` line 282).
  2. JSON.parse the matter row to provide to `prepareRegisterDocument` (only `tenant_id` is read by the helper).
  3. Build DB-backed callbacks for `prepareRegisterDocument`:
     - `hasExistingDocumentId(id)` → `SELECT 1 FROM case_box_documents WHERE id = ?`.
     - `getDocumentById(id)` → `SELECT id, tenant_id, matter_id FROM case_box_documents WHERE id = ?`.
     - `storedAuditEventsForMatter()` → SELECT last event from `case_box_audit_events` (same approach B1 used in `#applyMatterTransition`; see B1 SqliteCaseBoxPersistence.ts).
  4. Call `prepareRegisterDocument(matterId, matterRow, input, hasExistingDocumentId, deps)`.
  5. Compute `eventHash = eventHashFn(prepared.audit.event)`.
  6. INSERT into `case_box_documents`.
  7. INSERT into `case_box_audit_events`.
  8. UPSERT `case_box_audit_chain_heads`.
  9. Return `structuredClone(prepared.document)`.

- **`getDocument(documentId: string): Promise<CaseBoxDocument | null>`** — single SELECT on `case_box_documents WHERE id = ?`; if absent return `null`; else `JSON.parse(payload_json)` and return verbatim. No tenant filter (matches in-memory `inMemoryRepo.getDocument(documentId)`).

- **`listDocuments(query: ListDocumentsQuery): Promise<ListDocumentsPage>`** — inlined SQL:
  1. SELECT matter (tenant_id) by `query.matter_id`; throw `unknown_matter` if absent; throw `tenant_mismatch` if `matter.tenant_id !== query.tenant_id` (matches `listDocumentsHelper`).
  2. Compute `filters_hash` via the SHARED `computeFiltersHash(filters)` from `src/cursor.ts` (NO duplication of canonicalization).
  3. If `query.cursor` is set, `decodeCursor(query.cursor, { kind: "documents_by_matter", filters_hash })`; otherwise `cursor = null`. Use the SHARED `decodeCursor` from `src/cursor.ts`. NO duplication.
  4. Build the SELECT:
     ```sql
     SELECT payload_json FROM case_box_documents
     WHERE tenant_id = ? AND matter_id = ?
       [AND status = ?] [AND doc_type = ?]
       [AND (received_at < ? OR (received_at = ? AND id > ?))]  -- cursor seek
     ORDER BY received_at DESC, id ASC
     LIMIT ?
     ```
     `limit` value source decided below (step 5).
  5. `limit = resolveLimit(query.limit)` — MANDATED reuse of `resolveLimit` from `services/case-box-persistence/src/cursor.ts` (per rev-1 reviewer Dim-2 #1). `resolveLimit` enforces type / integer / positive / max-limit semantics; do NOT inline `query.limit ?? DEFAULT_LIMIT`. Fetch up to `limit + 1` rows to detect `hasMore` (symmetric with in-memory).
  6. Slice + compute `next_cursor` via `encodeCursor`.
  7. JSON.parse each row's payload_json; return `{ rows, next_cursor }`.

### §1.3 Audit chain behavior

`registerDocument` emits `DOCUMENT_REGISTERED` (kind from `case-box-contract`). Same chain-update pattern as B1's `createMatter`:

- INSERT case_box_audit_events with `sequence = head?.event_count + 1`.
- UPSERT case_box_audit_chain_heads with `head_hash = eventHashFn(event)`, `last_event_id`, `event_count = sequence`, `updated_at = event.timestamp`.

Invariant restated: `event_count == COUNT(*) == MAX(sequence)` for the same matter_id. B2 hardening test extends to assert this after `createMatter + registerDocument` sequence.

`prev_event_hash` is read via the same `storedAuditEventsForMatter` synthetic-array trick from B1 (single last-event row padded with placeholders for length). The pattern is repeated; see §8 risk #2 for follow-up extraction.

### §1.4 Transaction model

Every write is `db.transaction(...).immediate()`. `registerDocument` reads (matter SELECT, dup-id check, supersession SELECT) AND writes (3 tables) inside the same tx. `BEGIN IMMEDIATE` takes the writer lock at tx start.

### §1.5 Tests

- **`tests/sqlite.conformance.test.mjs`** — the conformance HARNESS at `tests/conformance/runCaseBoxPersistenceConformance.mjs` is unchanged; the SQLite conformance WRAPPER (`tests/sqlite.conformance.test.mjs`) is updated: preflight expected-case-ids list extends to B2's set, and the `runConformance` label is changed from `"Sqlite-B1"` to `"Sqlite-B2"` (per rev-2 reviewer Dim-5 #1). The `--test-name-pattern` regex in `package.json` test script is UPDATED to widen B1's pattern to also accept B2's case ids: `^(Sqlite-B[12] conformance preflight|Sqlite-B[12]: (...))(?:\s|$)`. Actual filter:

  ```
  ^(Sqlite-B[12] conformance preflight|Sqlite-B[12]: (?:6\.1\.(?:13a|[1-9]|1[0-5]|1[6-9]|2[0-7])|R5\.[1-9]|R5\.9b|R5\.1[0-4]|R6\.[1-4]))(?:\s|$)
  ```

  The `sqlite.conformance.test.mjs` file runs `runConformance("Sqlite-B2", factory)` IN ADDITION TO `runConformance("Sqlite-B1", factory)` (or the existing call is changed to `Sqlite-B2`; the SAME class implements both, so dual-label runs are NOT required — only one label is needed). **Plan picks renaming the existing call from `Sqlite-B1` to `Sqlite-B2`** and widening the regex; the conformance harness label is a runtime tag, not a hierarchy.

  Preflight regex assertion in `sqlite.conformance.test.mjs` is extended to include B2's expected case ids (6.1.16..6.1.27 + R5.7..R5.14 + R6.1..R6.4).

- **`tests/sqlite.hardening.test.mjs`** — extends the audit-chain-head invariant test to include a 3-event sequence: createMatter + registerDocument + archiveMatter, asserting `event_count == COUNT(*) == MAX(sequence) == 3`.

- **`tests/impl-parity.test.mjs`** — extends with document scenarios:
  - registerDocument happy path returns identical document row.
  - registerDocument with all R-5 fields (purpose, work_order_status, lifecycle text) deep-equal.
  - registerDocument with R-6 fields (mime_type, byte_size, manual_extracted_text) deep-equal.
  - registerDocument with supersedes_document_id (R-5(d)) deep-equal.
  - listDocuments empty matter / single doc / multi-page (cursor round-trip).
  - listDocuments with status + doc_type filter.
  - listDocuments with invalid `limit` values (`-1`, `0`, `999999`, non-integer) — assert SQLite and InMemory produce the SAME error or clamp to the SAME value (per `resolveLimit` semantics; rev-1 reviewer Dim-5 #1).
  - getDocument returns identical row (including R-5/R-6 fields).
  - registerDocument rejects (tenant_mismatch / matter_id_mismatch / unknown_matter / duplicate_id) — error code parity.

- **`tests/invariants.test.mjs`** — NO change (6.2.1 already permits better-sqlite3; 6.2.6 already includes `not_implemented`; 6.2.7 prototype allowlist unchanged because no new methods on `SqliteCaseBoxPersistence`).

### §1.6 Acceptance criteria (impl WI; this plan-WI does NOT execute)

1. `npm --prefix services/case-box-persistence test` exits 0 with all conformance + R-5 + R-6 cases for matter AND document running under "Sqlite-B2" label.
2. SQLite impl passes shared conformance cases 6.1.16..6.1.27 + R5.7..R5.14 + R6.1..R6.4.
3. All Phase A in-memory tests stay green (matters, documents, R-5, R-6, audit chain).
4. B1's SQLite tests stay green.
5. ocr-persistence + ocr-worker + case-box-contract + docs/contracts unchanged green.
6. loc-guardian: 0 over fail. `SqliteCaseBoxPersistence.ts` stays under 500 pure LOC (sibling extraction if needed).
7. cc-suite audit (mini) PASS or NEEDS-FIX-fixed-and-verified.

---

## §2 Schema v2 decision matrix

| Option | What v2 ships | Pros | Cons |
|---|---|---|---|
| **α — Minimal v2** (recommended) | One new table (`case_box_documents`) + 2 indices. R-5/R-6 fields in payload_json. | Smallest blast radius; matches B1's α posture. | Increments CURRENT_SCHEMA_VERSION to 2; B6 (facts) bumps to v3, etc. |
| β — Lift R-5/R-6 fields to columns | Add `purpose`, `work_order_status`, `mime_type`, `byte_size`, `manual_extracted_text` columns to `case_box_documents`. | Could enable future column-level queries. | Duplication risk; no v1 query needs these as columns; SQLite ALTER ADD COLUMN limited for future migrations. |
| γ — Pre-create B3-B11 placeholder tables in v2 | Add empty placeholders for facts/evidence/etc. | One schema version covers all of Phase B. | Wide v2 blast radius; future shape changes need ALTER (limited). |

**Pick α**. Mirrors B1's α posture exactly.

---

## §3 listDocuments implementation strategy

Three options:

| Option | What | Pros | Cons |
|---|---|---|---|
| **A — Inlined SQL** (recommended) | One SELECT with WHERE + ORDER BY + LIMIT + cursor-seek; reuse `encodeCursor` / `decodeCursor` / `computeFiltersHash` from `src/cursor.ts`. | Uses the index; small constant memory per query; cursor semantics identical to in-memory because the encoder is shared. | Filter+sort logic lives in two places (in-memory `listDocumentsHelper` + SQLite SELECT); future filter additions need updates in both. |
| B — Build maps from SELECT, call `listDocumentsHelper` | `SELECT * FROM case_box_documents WHERE tenant_id = ? AND matter_id = ?`, build Map, call shared helper. | Maximum logic reuse; one source for filter/sort/cursor. | O(N) read per call; defeats the index; not viable for `tenant_id`-wide queries (none today, but breaks the future fast-path); arguably violates "lift to columns for index" rationale of B2. |
| C — Extract `listDocumentsCore(iterable, query)` from `listDocumentsHelper` | Refactor in-memory helper to operate on an iterable; SQLite passes a SELECT cursor. | One logic source AND uses the index. | Refactor scope creep beyond B2; reviewer-flagged risk to keep B2 bounded. |

**Pick A**. Reasoning: (a) the cursor utility is shared (encodeCursor / decodeCursor / computeFiltersHash live in `src/cursor.ts`, NOT in `inMemoryDocument.ts`), so the load-bearing cursor invariant is single-sourced. (b) The filter set (status, doc_type) and sort key (`received_at DESC, id ASC`) are stable v1 — drift risk is small. (c) Impl-parity tests deep-compare BOTH impls on identical inputs, catching drift if it appears. Option C remains a follow-up if B6+ filters explode the surface.

---

## §4 R-5 / R-6 field handling

### §4.1 R-5 document fields (purpose / work_order_status / lifecycle / supersession)

All these fields are **carried in `payload_json`**, not lifted to columns. Read path: `JSON.parse(payload_json)` returns the verbatim row.

- `purpose` — enum; carried in payload.
- `work_order_status` — conditional-required (only when `purpose === "work_order"`); carried in payload.
- Lifecycle free-text fields (`lifecycle_letter_date_text`, `lifecycle_service_status_text`, `lifecycle_client_authorization_text`, `lifecycle_preliminary_evidence_text`, `lifecycle_review_date_text`, `lifecycle_final_version_marker_text`) — carried in payload as optional strings.
- `supersedes_document_id` — LIFTED to a column (for the R-5(d) supersession-invariant lookup). The supersession invariant `assertValidDocumentSupersession` is called by `prepareRegisterDocument` via `getDocumentById` callback; the SQLite callback SELECTs by id from `case_box_documents`. Lifting the column makes future B2-extension queries cheaper but is not strictly required for v1 (PRIMARY KEY suffices). Plan lifts it for query convenience + symmetry with `successor_matter_id` lifted column on `case_box_matters`.

### §4.2 R-6 doc-asset fields (mime_type / byte_size / manual_extracted_text)

All three carried in `payload_json`. NO columns lifted. Rationale:
- `mime_type` (string), `byte_size` (number), `manual_extracted_text` (long string, up to 200000 chars) are read-only canonical fields.
- B10 `getDocumentDetail` already returns the full document row by JSON-parse, so the read path doesn't gain from column lifting.
- `manual_extracted_text` at 200KB is comfortably handled by SQLite TEXT columns; no perf concern.
- B2 conformance R6.1..R6.4 cases assert the fields survive round-trip — JSON-parse handles this naturally.

### §4.3 Document-asset fields on existing in-memory tests

R6.1..R6.4 are already in the conformance harness (added in the R-6 chain pre-B1). The SQLite impl just needs to round-trip them. No new fixture work needed.

---

## §5 No-foreign-key posture

`case_box_documents.matter_id` is NOT a FK to `case_box_matters.id`. Rationale:

Internal case-box tables avoid FK constraints because (a) FKs hurt SQLite's ALTER flexibility (limited ALTER TABLE support; FK changes require table rebuild), (b) the application layer already enforces matter-existence + tenant-match + supersession invariants inside the transaction via the shared `prepareRegisterDocument` helper, and (c) audit events outlive matters they reference. This is a deliberate SQLite migration / flexibility choice — NOT a direct extension of the parent plan's "case-box references OCR by value only" rule (that rule governs the cross-package boundary; the no-FK choice inside case-box is its own decision, per rev-2 reviewer Dim-4 #1).
- `case_box_documents.supersedes_document_id` is NOT a FK to `case_box_documents.id` either — same rationale (FKs hurt SQLite ALTER flexibility + the application-layer invariant already enforces correctness). The `assertValidDocumentSupersession` helper (already wired in `inMemoryDocument.ts`) REJECTS cross-matter and cross-tenant supersession; the SQLite impl's `getDocumentById` callback returns enough fields (`id`, `tenant_id`, `matter_id`) for the helper to enforce the same invariant. The absence of a FK is purely a migration / boundary-discipline choice; it does NOT relax the contract invariant.

`PRAGMA foreign_keys = ON` is set defensively (from B1's openSqliteCaseBoxPersistence) but is a no-op because no FK constraints are declared.

---

## §6 LOC budget per file (post-B2)

Current state (post-B1 commit `601d74c`):

| File | Current LOC | Threshold |
|---|---|---|
| `src/sqlite/schema.ts` | 184 | source warn 500 |
| `src/sqlite/SqliteCaseBoxPersistence.ts` | 439 | source warn 500, fail 800 |
| `src/sqlite/matterRepoQueries.ts` | 89 | source warn 500 |
| `src/sqlite/openSqliteCaseBoxPersistence.ts` | 58 | source warn 500 |

Estimated B2 additions to `SqliteCaseBoxPersistence.ts`: ~80-100 LOC (3 method impls: registerDocument ~50 LOC, getDocument ~10 LOC, listDocuments ~40 LOC, minus 3 stubs already there ~6 LOC).

**Estimated post-B2 `SqliteCaseBoxPersistence.ts`: ~525 LOC** — over the 500-LOC extraction trigger. Plan picks **extracting document SQL helpers + listDocuments SELECT-builder to a NEW sibling file `documentRepoQueries.ts`** (mirrors `matterRepoQueries.ts`), keeping the class file at the same 439 LOC base + a small ~15-LOC delta for method bodies that just call the new helpers. Estimated post-extraction: main class ~455 LOC; new `documentRepoQueries.ts` ~80-100 LOC.

Schema.ts grows by ~30 LOC (new DDL_STATEMENTS_V2 array + map entry). Estimated ~215 LOC. Under fail.

Test files:
- `sqlite.conformance.test.mjs`: preflight regex updated; ~5 LOC added; under fail.
- `sqlite.hardening.test.mjs`: one new event-count invariant test for the 3-event sequence; ~25 LOC added; under fail.
- `impl-parity.test.mjs`: ~7 new document scenarios; ~120 LOC added; total ~240 LOC; well under test warn 700.

**No file approaches fail threshold post-B2.** All changes are bounded.

---

## §7 Hard-stop alignment

This plan is plan-only; the trigger list belongs to each B-series sub-WI. The B2 sub-WI triggers:

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED (already implemented; no new dep). Native-module hard-stop applies for ANY change touching better-sqlite3 surface, but B2 doesn't add a new dep — it only uses what B1 already authorized. Reviewer to confirm this is acceptable for autonomous fix-forward within B2.
- **New runtime dependency** — NOT triggered (no new dep).
- **Schema introduction on persisted data** — NOT triggered (no real DB exists; v2 migration is applied at next test run via applySchema).
- **Public API break** — NOT triggered (B2 implements 3 EXISTING interface methods that were stubs).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered.
- **Push / deploy / secrets / production data** — NOT triggered.

Per the no-revert posture from the lane: if B2 impl fix-forward becomes unworkable, stop with STOP-FOR-ROLLBACK report rather than auto-revert.

---

## §8 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Cursor-pagination drift between in-memory and SQLite. The `encodeCursor` / `decodeCursor` / `computeFiltersHash` utilities are shared (per §3 option A), but the WHERE-clause that consumes the cursor's `last_sort_tuple` lives in SQL. A subtle off-by-one (`<` vs `<=`) or wrong tiebreaker direction (id ASC vs DESC) could yield divergent results. | impl-parity test runs identical scenarios against both impls + asserts `next_cursor` byte-identical AND row-set deep-equal across a 3-page traversal. Catches `<` vs `<=` immediately. |
| 2 | Medium | `storedAuditEventsForMatter` synthetic-array padding (the trick B1 introduced for `prepareMatterTransition`) is repeated in B2 for `prepareRegisterDocument`. This is the second occurrence; a third (B3+) will be drift-prone. | Plan accepts repetition at B2; flags follow-up to extract `getSyntheticStoredEvents(db, matterId): StoredAuditEvent[]` into a helper (likely in `documentRepoQueries.ts` or a new `auditChainQueries.ts`) at B3. |
| 3 | Medium | `case_box_documents.received_at` is the sort key. The in-memory sort uses `a.received_at < b.received_at ? +1 : ...` (DESC). The SQL `ORDER BY received_at DESC, id ASC` must match. If `received_at` is missing or null on some documents (it's required by the schema), SQLite NULL ordering differs from JS undefined ordering. | Schema validator (`validateDocument`) makes `received_at` required + non-null. SQLite NOT NULL constraint on the lifted column. Impl-parity test exercises the boundary case (two docs with identical received_at; id tiebreak applies). |
| 4 | Low | `payload_json` for documents with `manual_extracted_text` near 200KB stresses SQLite's TEXT page handling. | SQLite handles 200KB TEXT comfortably. Hardening test exercises a 200000-char field. |
| 5 | Low | B2 widens the `--test-name-pattern` regex; if the regex itself has a syntax error, ALL conformance tests skip silently. | Preflight test in sqlite.conformance.test.mjs asserts the regex matches the expected B2 case-id set; it also asserts cases OUTSIDE B2's scope are rejected. A regex bug fails preflight loudly. |
| 6 | Low | Lifted column `supersedes_document_id` could fall out of sync with payload_json. | Same canonical-source pattern as B1's `successor_matter_id` lifted column: column is bound from `document.supersedes_document_id` at INSERT time; payload_json is the canonical read. Round-trip parity test asserts both columns match the payload. |

No Critical / High risks.

---

## §9 cc-suite audit / verify expectations

For the impl WI (NOT this plan-WI):

- **cc-suite audit (mini)** on the impl commit's scope:
  - Files: `services/case-box-persistence/src/sqlite/schema.ts` (v2 DDL added) + `src/sqlite/SqliteCaseBoxPersistence.ts` (3 stubs → impls) + `src/sqlite/documentRepoQueries.ts` (NEW) + `tests/sqlite.conformance.test.mjs` (preflight extended) + `tests/sqlite.hardening.test.mjs` (extended) + `tests/impl-parity.test.mjs` (extended) + `package.json` (test-name-pattern widened).
  - Expected: PASS or NEEDS-FIX with C/H/M fixed + verify in same commit.

- **cc-suite verify**: only if audit produces C/H/M findings the WI fixed.

- **Recording**: per `.claude/rules/cc-suite.md` §"Required recording" 11-field block in the impl commit's message body.

---

## §10 Umbrella amendment posture

B1 impl (`601d74c`) flagged an umbrella divergence: the umbrella plan §2 row B3 wording said "audit_chain_heads table introduced" but B1 actually introduces it. B2 inherits the same table layout (no new audit-chain table needed in v2) so no NEW umbrella divergence arises in B2.

**Plan keeps any umbrella amendment SEPARATE from B2 impl.** The amendment lives in a future docs-only WI (e.g. `dev-memo/plan-umbrella-b3-wording-amendment.md` — short) that:
- Amends `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B3 to say "audit read APIs wired" instead of "audit_chain_heads table introduced".
- Is committed alone via explicit staging.
- Does NOT block B2 impl (B2 impl proceeds with the existing wording; the umbrella plan is consulted as guidance, not a contract).

Rationale: bundling docs-only umbrella edits with code-changing impl WIs violates the per-`.claude/rules/staging-hygiene.md` "one WI scope per commit" preference and would confuse the cc-suite audit trail (audit scope would jump between SQL impl and umbrella plan text).

---

## §11 References

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (umbrella; READY at `1ac26b1`).
- `dev-memo/plan-case-box-persistence-B1-matter.md` (B1 plan; READY at `9cf03d3`).
- B1 impl commit `601d74c`.
- `services/case-box-persistence/src/inMemoryDocument.ts` (behavioral target).
- `services/case-box-persistence/src/inMemoryRepo.ts` lines 278-320 (registerDocument / getDocument / listDocuments).
- `services/case-box-persistence/src/cursor.ts` (encodeCursor / decodeCursor / computeFiltersHash / resolveLimit).
- `services/case-box-persistence/src/sqlite/schema.ts` (extend DDL_BY_VERSION at v2).
- `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` (convert 3 stubs to impls).
- `services/case-box-persistence/src/sqlite/matterRepoQueries.ts` (precedent for documentRepoQueries.ts).
- `docs/contracts/case-box-contract/schemas/case-box-document.schema.json`.
- `docs/contracts/case-box-contract/src/case-box-document-supersession-invariants.ts`.
- `.claude/rules/cc-suite.md`, `autonomy.md`, `loc-guardian.md`, `staging-hygiene.md`.

---

## §12 Stop condition

This plan is stale or superseded when:

- B2 impl commits — plan transitions to "superseded by B2 impl commit `<hash>`"; file stays as historical reference.
- A future revision of the umbrella plan changes B2 scope — this plan amends or retires.
- Phase B is abandoned (driver swap) — this plan retires with the dep.
