# CASE-BOX-PERSISTENCE Phase A1 — bounded review-plan package

**Status**: plan only. NOT implementation. Revised 2026-05-20 after `/cc-suite:review-plan` returned NEEDS REVISION (job `review-plan-mpewd0z1-0t1kj7`).
**Date**: 2026-05-20.
**Parent plan**: `dev-memo/plan-case-box-persistence-00.md` (commit `4f39e02`) — A1 is the smallest safe slice defined in §10.1 of that plan.

This file is the bounded review target for `/cc-suite:review-plan`. It is NOT a duplicate of the parent plan — it narrows scope to exactly what Phase A1 ships and pins acceptance criteria + invariants to be verified.

## Review history

- 2026-05-20 round 5 — `/cc-suite:review-plan`. **Verdict: READY TO BUILD.** Recording per `.claude/rules/cc-suite.md` §"Required recording":
  - **Kind**: `review-plan`
  - **Target scope**: `dev-memo/plan-case-box-persistence-A1.md`
  - **Resolved runner path** (attempt 1): `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/codex-runner.mjs`
  - **Path 1 outcome**: `failed`, `spawnSync codex ETIMEDOUT` (30-minute internal timeout); no partial output captured; job `review-plan-mpex4pe8-gr8c50` registered but its `.cc-suite/<jobId>/` dir was not created. `/cc-suite:status` and `/cc-suite:result` NOT retrievable for this job.
  - **Resolved fallback** (attempt 2): Path 2 (`mcp__plugin_codex-toolkit_codex__codex` direct MCP) per the cc-suite rule §"Failure handling". Same prompt template, same persona + provenance, same parameters.
  - **Model / effort / sandbox / approval-policy**: `gpt-5.5` / `high` / `read-only` / `on-failure`
  - **Codex threadId** (Path 2): `019e48a6-2980-7fb2-a64a-c4c321ff0eab` — use `/cc-suite:continue 019e48a6-2980-7fb2-a64a-c4c321ff0eab` to iterate on findings if needed.
  - **Output / result location**: inline below + this commit message.
  - **/cc-suite:status retrievable?**: No (Path 2 fallback used; no job registered).
  - **Findings**: 0 Critical, 0 High, 3 Mediums (allowlist ordering, audit-event `(action, entity_type)` vs `kind` confusion, `makeIdGenerator` 24-vs-26-char example typo), 2 Lows (timestamp `RangeError` wording, README tamper-scope language). All Mediums applied as direct edits before this commit. Lows applied as well for cleanliness.
  - **Strongest aspects** (per reviewer): parent-plan staleness now explicitly reconciled; public surface bounded to the 10 needed methods; cursor/error-code/timestamp/sequence/lockfile all tightly specified.

- 2026-05-20 round 4 — `/cc-suite:review-plan` via Path 1 runner, job `review-plan-mpewyzzp-9tp90y`. Verdict: **NEEDS REVISION** (residual). Round-3 issues all RESOLVED or PARTIALLY ADDRESSED. Residual findings + fixes in this round 4:
  - **H-r4.1**: A1 ↔ parent reconciliation incomplete (parent §10.1 says 6 methods; A1 says 10; parent §10.3 R10 says message-substring; A1 says code). Fixed: the parent-staleness override NOTE in §1.1 now enumerates ALL FOUR parent stale points (audit kind, audit ordering, surface count, error-code policy).
  - **H-r4.2**: `__testTamperEvent` seam risks public exposure. Fixed: §6.3.4 + §6.2.7 — the tamper helper is a **module-private exported function from `tests/internals.mjs`** (NOT on the `InMemoryCaseBoxPersistence` class; never reachable through the package's `src/index.ts` re-exports). §6.2.7 (new) asserts that `Object.getOwnPropertyNames(InMemoryCaseBoxPersistence.prototype)` is EXACTLY the 10 documented public methods + `constructor` — no extra mutator slips through.
  - **M-r4.1**: Cursor failures had no code mapping. Fixed: cursor decode/filter-hash failures throw `CaseBoxPersistenceError({ code: "invalid_argument" })`.
  - **M-r4.2**: Timestamp normalization wording mismatch. Fixed: §6.3.9 rewritten to test that the injected `now(): Date` MUST return an actual `Date`; persistence rejects `now()` returning `null`, a string, or `new Date("garbage")` (NaN) with `code: "invalid_argument"`. Valid Date inputs always produce ISO-string timestamps.
  - **M-r4.3**: `package-lock.json` path qualification. Fixed: §2 row now reads `services/case-box-persistence/package-lock.json`.
  - **M-r4.4**: Audit cursor tuple unpinned. Fixed: §1.1 method 8 + cursor module spec — cursor kind `"audit_events_by_matter"`, filter hash over `{ tenant_id, matter_id }`, tuple `[sequence]`.
  - **M-r4.5**: `makeIdGenerator(prefix)` underspecified. Fixed: §6.4 — `makeIdGenerator(prefix)` returns a counter-backed function producing strings of EXACTLY 26 lowercase chars matching `^[0-9a-z]{26}$`. Default implementation zero-pads a base32-encoded counter prefixed by the given prefix.
  - **Other stale review-history text** (Round 2 says "6 → 9", round 2 mentioned `randomUUID()`): left as historical record per round-4 M1 — these are HISTORICAL entries documenting what changed at each round, NOT current state claims. The current-state claim is the §1.1 specification, which the round-4 NOTE now makes unambiguous.

- 2026-05-20 round 2 — `/cc-suite:review-plan` via Path 1 runner, job `review-plan-mpewm5fj-4jmkhd`. Verdict: **NEEDS REVISION** (still). Round-1 issues 1, 3, 4, 5, 6 confirmed RESOLVED; issues 2 and 7 PARTIALLY ADDRESSED. New findings:
  - **C-r2.1**: default audit-event ID `randomUUID()` is NOT a 26-char lowercase ULID → schema rejection. Fixed: A1 ships a local ULID generator (`src/ulid.ts`); UUID is explicitly rejected.
  - **H-r2.1**: surface count inconsistent (9 vs 10). Fixed: surface is **10 methods**, including `listAuditEvents` numbered as method 8 below.
  - **H-r2.2**: "empty matter audit chain" cases are impossible because `createMatter` always emits `MATTER_REGISTERED`. Fixed: conformance now asserts "matter with only the seed event → count=1, headHash=hash(seed), prev_event_hash of seed=null".
  - **H-r2.3**: ordering by `timestamp ASC, id ASC` is not a safe append-order proxy. Fixed: A1 ships a per-matter monotonic `sequence` integer on each stored audit event; `listAuditEvents` orders by `sequence ASC`. Sequence is internal to persistence (NOT a contract field); contract still hashes only its own canonical fields.
  - **H-r2.4**: Ajv `useDefaults` is not enabled, so opt-in flags cannot be defaulted. Fixed: callers MUST pass `external_ocr_authorized: false`, `sync_grant_present: false`, `llm_extraction_opt_in: false` explicitly; fixture builder `makeMatterInput` defaults them.
  - **M-r2.1**: R10 contradicted the code-based policy. Fixed: R10 rewritten.
  - **M-r2.2**: `verifyAuditChainForMatter` return shape didn't match contract types. Fixed: surface uses contract's `ChainVerifyOk` (`ok: true, verifiedCount, headHash`) and `ChainVerifyErr` (`ok: false, errorIndex, errorReason, detail`) verbatim.
  - **M-r2.3**: acceptance required `npm install` but expected files omitted `package-lock.json`. Fixed: lockfile added to §2.
  - **M-r2.4**: `getAuditChainHead` and `verifyAuditChainForMatter` had no unknown-matter behavior pinned. Fixed: both reject with `code: "unknown_matter"`.
  - **M-r2.5**: `invalid_initial_state` conflated schema + lifecycle failures. Fixed: split into `invalid_payload` (schema/validator failure) vs `invalid_initial_state` (post-schema lifecycle violation like `status !== "active"` at creation).
  - **M-r2.6**: empty `reason` semantics for archive/unarchive unpinned. Fixed: reason MUST be non-empty; empty string rejects with `code: "invalid_argument"` (new code added).
  - **M-r2.7**: acceptance §8.15 required creating a commit; autonomy policy requires explicit per-WI authorization to commit. Fixed: acceptance now says "ready-for-commit"; the commit itself is the user's authorization gate.
  - **M-r2.8**: parent plan §3.1 still uses stale `MATTER_CREATED`. Fixed by NOTE: A1 overrides parent §3.1's `MATTER_CREATED` with `MATTER_REGISTERED`. A future docs-cleanup WI may correct the parent plan; A1 does not modify it.

- 2026-05-20 round 1 — `/cc-suite:review-plan` via Path 1 runner (`codex-runner.mjs` 0.2.10), job `review-plan-mpewd0z1-0t1kj7`, model `gpt-5.5`, effort `high`, sandbox `read-only`. Verdict: **NEEDS REVISION**. 2 Critical + 7 High findings. Revisions applied (this version):
  - **C1**: Renamed audit kind `MATTER_CREATED` → `MATTER_REGISTERED` to match `CASE_BOX_AUDIT_EVENT_KINDS` in `case-box-contract/src/audit-log.ts:67`.
  - **C2 + H6 + H7**: Expanded A1's public surface from 6 methods to 9 — added `listAuditEvents(matterId, query)`, `getAuditChainHead(matterId)`, `verifyAuditChainForMatter(matterId)` so the audit-chain conformance is buildable from the public surface.
  - **H1**: `createMatter` now rejects inputs where ANY of `external_ocr_authorized` / `sync_grant_present` / `llm_extraction_opt_in` is true. A1 has no audit'd write API to set those flags, so allowing them at creation time would bypass the Step-7 local-user gate by an opt-in-at-birth side door.
  - **H2**: `archiveMatter` now takes `{ actor_user_id, reason }` (not just `reason`). Same for `unarchiveMatter` (added). Audit events require a real actor.
  - **H3**: Initial-state invariants pinned — matter MUST start `status === "active"` and `archived_at === undefined`; document MUST start `status === "registered"`.
  - **H4 + H5**: R5 pinned to "copy locally". A1 ships `src/cursor.ts` as a local copy of `services/ocr-persistence/src/cursor.ts` (with header comment crediting the source). Cursor `kind === "documents_by_matter"`, filter hash over `{ tenant_id, matter_id }`, tuple `[received_at, id]`. NO dependency on `ocr-persistence`.
  - **Mediums**: `archiveMatter` explicitly calls `assertValidMatterTransition(current.status, "archived", "lawyer")`; audit event IDs sourced via injected `generateId()` (default `randomUUID()`); state-hash input is canonical JSON of the post-state record (sans `persisted_at`); `Object.keys` → `Object.getOwnPropertyNames`; `code` field on `CaseBoxPersistenceError` IS asserted in conformance (no half-pinning); conformance gains `document.matter_id !== matterId` + `unknown matter` + `tenant/matter pair mismatch` cases; fixture builders are listed in §6.4; OCR persistence baseline checks removed from A1 acceptance.

---

## 1. Scope

**The smallest possible vertical slice that proves the case-box-persistence package shape works.** No native dependency. No SQLite. No business logic beyond matter + document + audit-chain bookkeeping.

### 1.1 Functional scope

- A new package `services/case-box-persistence/`.
- A single TypeScript class `InMemoryCaseBoxPersistence` implementing the `CaseBoxPersistence` interface for a **10-method subset** (was 6 in the round-0 draft; expanded for audit observability per round-1 C2; numbered consistently per round-2 H-r2.1):
  1. `createMatter(matter: unknown): Promise<CaseBoxMatter>` — REJECTS inputs where any of `external_ocr_authorized` / `sync_grant_present` / `llm_extraction_opt_in` is true; REJECTS inputs where `status !== "active"`; REJECTS inputs where `archived_at` is set.
  2. `getMatter(matterId: string): Promise<CaseBoxMatter | null>`
  3. `archiveMatter(matterId: string, opts: { actor_user_id: string; reason: string }): Promise<CaseBoxMatter>` — explicitly calls `assertValidMatterTransition(current.status, "archived", "lawyer")`; self-transition maps to a typed `illegal_transition` error.
  4. `unarchiveMatter(matterId: string, opts: { actor_user_id: string; reason: string }): Promise<CaseBoxMatter>` — symmetric; calls `assertValidMatterTransition("archived", "active", "lawyer")`.
  5. `registerDocument(matterId: string, document: unknown): Promise<CaseBoxDocument>` — REJECTS where `document.matter_id !== matterId`; REJECTS where `document.tenant_id !== matter.tenant_id`; REJECTS where `document.status !== "registered"`.
  6. `getDocument(documentId: string): Promise<CaseBoxDocument | null>`
  7. `listDocuments(query: { tenant_id: string; matter_id: string; cursor?: string; limit?: number }): Promise<{ rows: CaseBoxDocument[]; next_cursor: string | null }>` — REJECTS unknown `matter_id`; REJECTS `(tenant_id, matter_id)` pair mismatch.
  8. **`listAuditEvents(query: { tenant_id: string; matter_id: string; cursor?: string; limit?: number }): Promise<{ rows: CaseBoxAuditEvent[]; next_cursor: string | null }>`** — ordered by **per-matter monotonic `sequence ASC`** (internal persistence field, NOT a contract field); chain order is preserved. Cursor kind `"audit_events_by_matter"`, filter hash over `{ tenant_id, matter_id }`, tuple `[sequence]`. Cursor decode failures throw `code: "invalid_argument"`. Rejects unknown matter with `code: "unknown_matter"`; rejects tenant/matter pair mismatch with `code: "tenant_mismatch"`.
  9. **`getAuditChainHead(matterId: string): Promise<{ headHash: AuditEventHash | null; lastEventId: string | null; count: number }>`** — read-only; surfaces the chain head for conformance + future export self-anchor. **Rejects unknown matter with `code: "unknown_matter"`.** A matter that exists but has no events would return `count: 0`, headHash null — but in practice every matter has at least the seed `MATTER_REGISTERED` event emitted by `createMatter`, so `count >= 1` for any retrievable matter.
  10. **`verifyAuditChainForMatter(matterId: string): Promise<ChainVerifyOk | ChainVerifyErr>`** — replays the chain via `verifyAuditChain` from the contract; returns the contract's typed result **verbatim** (`ChainVerifyOk` = `{ ok: true, verifiedCount, headHash }`; `ChainVerifyErr` = `{ ok: false, errorIndex, errorReason, detail }`). Persistence does NOT reshape the contract result. **Rejects unknown matter with `code: "unknown_matter"` (a typed error, NOT a `ChainVerifyErr`).**
- Internal audit emission for the writes above (`MATTER_REGISTERED`, `MATTER_ARCHIVED`, `MATTER_UNARCHIVED`, `DOCUMENT_REGISTERED` — exact `CaseBoxAuditEventKind` strings sourced from `case-box-contract/src/audit-log.ts` `CASE_BOX_AUDIT_EVENT_KINDS`).

> **NOTE on parent plan staleness — IMPORTANT, READ BEFORE IMPLEMENTING**: parent plan `dev-memo/plan-case-box-persistence-00.md` carries stale details on FOUR points. **A1 IS AUTHORITATIVE** when the two plans disagree. The parent will be corrected in a future docs-cleanup WI; A1 does not modify it.
>
> 1. Parent §3.1 references the WRONG audit kind name `MATTER_CREATED`. A1 ships `MATTER_REGISTERED` (matches contract `CASE_BOX_AUDIT_EVENT_KINDS`).
> 2. Parent §4.6 says audit-events reads are paginated by `timestamp ASC, id ASC`. That is **unsafe** as an append-order proxy (timestamps can collide; ID generation order is not guaranteed monotonic). A1 ships a per-matter monotonic `sequence` integer on each stored audit event and orders `listAuditEvents` by `sequence ASC`.
> 3. Parent §10.1 ("Smallest safe slice") describes A1 as **6 methods**. A1 ships **10 methods** — the 6 parent-named methods PLUS `unarchiveMatter`, `listAuditEvents`, `getAuditChainHead`, `verifyAuditChainForMatter`. The expansion is mandatory for audit-chain conformance per round-1 review finding C2.
> 4. Parent §10.3 risk R10 says `CaseBoxPersistenceError.code` is optional and conformance asserts on message substrings. A1 makes `code` REQUIRED and conformance asserts on `code`, NOT message substring.
>
> Implementers MUST treat A1 as authoritative.

- Per-matter audit-chain head-hash tracking using `buildCaseBoxAuditEvent`, `canonicalAuditEventHashInput`, and `verifyAuditChain` from the contract package, verbatim. The persistence package does NOT re-implement canonicalization.
- **Per-matter monotonic sequence**: persistence assigns each audit event in a matter a monotonic integer `sequence` (1, 2, 3, …) at INSERT time, used ONLY for ordering reads. `sequence` is an internal persistence column / field, NOT a contract field, and is NOT included in `canonicalAuditEventHashInput`. `listAuditEvents` orders by `sequence ASC`. This is the safe append-order proxy that `timestamp ASC, id ASC` is NOT (timestamps can collide; ID generation order is not guaranteed monotonic).
- **Audit event IDs come from an injected `generateId(): string` factory.** Default is a **local ULID generator** at `src/ulid.ts` that produces a schema-valid 26-char lowercase string matching `^[0-9a-z]{26}$` (the audit-event schema's `ulid` pattern). The local helper uses `crypto.randomBytes(16)` + Crockford base32 encoding. `crypto.randomUUID()` is EXPLICITLY REJECTED as the default because it produces a UUID, not a ULID; the schema validation would fail on every audit event.
- **State-hash inputs** (`before_state_hash`, `after_state_hash`): SHA-256 of a canonical JSON serialization of the entity record AFTER excluding store-assigned fields (none in A1's records, but the discipline is established). The canonicalizer uses sorted-keys + UTF-8 + no whitespace; a tiny helper `canonicalEntityHashInput(record)` lives at `src/auditChain.ts` next to the existing audit-event canonicalizer.
- A typed `CaseBoxPersistenceError` class (parallel to `OcrPersistenceError`) with a REQUIRED `code` field. Codes asserted in conformance:
  - `"duplicate_id"` — matter or document id already exists.
  - `"unknown_matter"` — referenced matter not found.
  - `"unknown_document"` — referenced document not found.
  - `"tenant_mismatch"` — `tenant_id` mismatch between caller and target row, OR `(tenant_id, matter_id)` pair mismatch.
  - `"matter_id_mismatch"` — `document.matter_id !== matterId` argument.
  - `"illegal_transition"` — state-machine transition rejected by `assertValidMatterTransition` (or equivalent for documents).
  - `"local_only_external_flag_rejected"` — `createMatter` input has any of three opt-in flags set true.
  - `"invalid_payload"` — `validateMatter` / `validateDocument` schema rejection (Ajv summary).
  - `"invalid_initial_state"` — schema-valid but lifecycle-invalid initial state (e.g. matter created with `status === "archived"`, document created with `status !== "registered"`, matter with `archived_at` set).
  - `"invalid_argument"` — programmer-facing argument violation (e.g. empty `reason` on `archiveMatter` / `unarchiveMatter`).
- Conformance asserts on `code`, NOT on message substring. Messages remain informational and free-form.
- A shared conformance harness file (`tests/conformance/runCaseBoxPersistenceConformance.mjs`) covering ALL 10 methods. The harness is the contract for the persistence boundary; SQLite (Phase B+) will eventually pass the same suite.

### 1.2 Non-functional scope

- Package mirrors `services/ocr-persistence/` conventions exactly: `type: "module"`, Node ≥22, `tsc -p tsconfig.json` build, `node:test` runner, JSON contract dependency via `file:`.
- LOC-01 sibling-module extraction discipline applied **from the start** — no growing files toward the 800 fail threshold. If any single source file exceeds 350 raw LOC during A1, split before commit.

---

## 2. Files expected to be added

All under `services/case-box-persistence/`. No file outside this directory is created or modified except the project-wide test-command index (`AGENTS.md`).

| Path | Purpose |
|---|---|
| `package.json` | Manifest. `name: "case-box-persistence"`, `private: true`, `type: "module"`, `engines.node: ">=22.0.0"`. Dependencies: `case-box-contract` via `file:../../docs/contracts/case-box-contract`. **No `better-sqlite3`**. No `@types/better-sqlite3`. devDependencies: `@types/node@^22`, `typescript@^5.6.0`. |
| `tsconfig.json` | Mirrors `services/ocr-persistence/tsconfig.json` (strict, `noUncheckedIndexedAccess`, `NodeNext`, target ES2022, declaration emit). |
| `README.md` | One-paragraph description; "Phase A1" pointer; links to ADR Steps 0-8 + parent plan. |
| `src/types.ts` | `CaseBoxPersistence` interface (10 A1 methods); record types; `ListDocumentsQuery`, `ListDocumentsPage`, `ListAuditEventsQuery`, `ListAuditEventsPage`, `AuditChainHead`; type alias `VerifyAuditChainResult = ChainVerifyOk \| ChainVerifyErr`; internal wrapper `interface StoredAuditEvent { readonly sequence: number; readonly event: CaseBoxAuditEvent; }` (NOT exported publicly — only used inside persistence; `listAuditEvents` strips the wrapper and returns bare `CaseBoxAuditEvent[]`); re-exports `ChainVerifyOk` / `ChainVerifyErr` from `case-box-contract` for caller convenience; error class import re-export. Future-phase methods are NOT declared on the interface to avoid leaky stubs. |
| `src/errors.ts` | `CaseBoxPersistenceError extends Error` with REQUIRED `code` field. Codes (full list): `"duplicate_id"`, `"unknown_matter"`, `"unknown_document"`, `"tenant_mismatch"`, `"matter_id_mismatch"`, `"illegal_transition"`, `"local_only_external_flag_rejected"`, `"invalid_payload"`, `"invalid_initial_state"`, `"invalid_argument"`. Codes ARE asserted in conformance. |
| `src/ulid.ts` | Local schema-valid-ID helper producing 26-char lowercase strings matching the audit-event schema's `^[0-9a-z]{26}$` pattern. Uses `crypto.randomBytes(16)` + Crockford base32 encoding. Exposes `generateUlid()`. **Default `generateId` for audit events.** **Note on semantics**: the name preserves the schema field name (`ulid`), but the helper does NOT provide ULID timestamp-prefix or lexicographic ordering semantics — the schema's `ulid` pattern is structural-only (it pins the alphabet + length). Append-order is provided by per-matter `sequence`, NOT by the ID. `crypto.randomUUID()` is NOT acceptable because it produces a UUID (36 chars with hyphens), failing the schema pattern. |
| `src/cursor.ts` | **Local copy** of `services/ocr-persistence/src/cursor.ts` with a header comment crediting the source and noting "do not re-import; future shared extraction may move this to a contract-level helper". Exposes `resolveLimit`, `computeFiltersHash`, `encodeCursor`, `decodeCursor`. Adds A1-specific cursor kinds: `"documents_by_matter"` and `"audit_events_by_matter"`. |
| `src/inMemoryRepo.ts` | `InMemoryCaseBoxPersistence implements CaseBoxPersistence`. Uses `Map<id, RecordWithJSON>` for matters + documents + per-matter audit event arrays + per-matter head hash. Deep-clones on read; structuredClone on input to defend against caller mutation. Audit chain head updated atomically with each event insert. **In-memory rollback discipline**: each write builds the next-state snapshot in local variables, runs ALL validators (including audit-event builder) BEFORE mutating any Map. If any step throws, no Map is touched — the write is naturally atomic. |
| `src/auditChain.ts` | Thin wrapper: `appendAuditEventForMatter(state, matterId, eventInput, { generateId, now })` that calls `buildCaseBoxAuditEvent(...)` from the contract, hashes via `canonicalAuditEventHashInput` + node:crypto sha256, returns the new event + updated head WITHOUT mutating state — the caller (`InMemoryCaseBoxPersistence`) mutates only after all writes succeed. **No re-implementation of canonicalization.** |
| `src/index.ts` | Public exports: `InMemoryCaseBoxPersistence`, `CaseBoxPersistence` (interface), `CaseBoxPersistenceError`, `ListDocumentsQuery`, `ListDocumentsPage`, `ListAuditEventsQuery`, `ListAuditEventsPage`, `AuditChainHead`, `VerifyAuditChainResult`. |
| `tests/conformance/runCaseBoxPersistenceConformance.mjs` | Shared conformance harness; takes a `make()` factory + `now()` clock injector. Cases listed in §6. |
| `tests/inMemory.conformance.test.mjs` | Wires the conformance harness against `InMemoryCaseBoxPersistence`. |
| `tests/invariants.test.mjs` | Cross-entity invariants not in the conformance matrix (per §6). |
| `tests/auditChain.test.mjs` | Hash chain integrity + per-matter head tracking + replay-tamper detection on a synthetic chain. |

Also modified:

| Path | Change |
|---|---|
| `AGENTS.md` | Add `npm --prefix services/case-box-persistence test` to the test-commands list (single-line addition; mirrors the `case-box-contract` entry added in CASE-BOX Step 1). |

| `services/case-box-persistence/package-lock.json` | npm-generated lockfile. Committed alongside `package.json` to mirror `services/ocr-persistence/package-lock.json` convention. |

**Total expected file count**: 15 new + 1 modified = 16 files (added `src/cursor.ts` per round-1 R5, `src/ulid.ts` per round-2 C-r2.1, `package-lock.json` per round-2 M-r2.3). Excluding generated build output (`dist/`) and `node_modules/` (gitignored).

---

## 3. Files expected to remain untouched

The following list is exhaustive for the directories Phase A1 could plausibly affect. Any change to any path below is a scope violation and must be reverted before commit.

- `docs/contracts/case-box-contract/**` — contract package is the dependency; A1 imports from it but does NOT modify it.
- `docs/contracts/**` (the OCR contract sibling) — untouched.
- `services/ocr-worker/**`, `services/ocr-persistence/**`, `services/ocr-ingestion/**`, `services/ocr-review/**`, `services/ocr-worker-bakeoff/**` — all untouched.
- `docs/adr/**` — no new ADR; no edits.
- `docs/release/**` — no new sign-off; no edits.
- `docs/ui/**`, `docs/product/**` — untouched.
- `.claude/**` — no rule/skill/command changes.
- `.gitignore` — no entries needed; `node_modules/`, `dist/`, `coverage/` already covered at repo root.
- `dev-memo/superseded/**` — untouched.
- The 3 pre-existing untracked drafts (`adr-11-series-plan.md`, `real-ocr-worker-brainstorm.md`, `step-10l-plan.md`) — untouched.

---

## 4. Invariants from CASE-BOX Steps 0-8 to be enforced by Phase A1

A1 ships only the 10-method subset listed in §1.1. Of the consolidated invariants in `plan-case-box-persistence-00.md` §5, the following are **load-bearing for A1** and MUST be conformance-tested in this phase:

### From Step 0 (boundary)

- **OCR subordination at the package boundary**: `case-box-persistence` package.json depends on `case-box-contract` only. Does NOT depend on `ocr-persistence`. No transitive native dependency. (Verified by `package.json` inspection in conformance.)
- **One-way dependency direction**: A1 does NOT call any `ocr-persistence` method, does NOT write `CaseBoxOcrLink` (deferred to A7), does NOT touch `ocr-worker-contract` runtime APIs.

### From Step 1 (contract vocabulary)

- **`validateMatter` / `validateDocument` invoked on every write**: A1 calls the Step-1 validators directly inside `createMatter` / `registerDocument`. Invalid shapes throw `CaseBoxPersistenceError`. (Conformance: feed an invalid matter; assert rejection.)
- **Deep-clone on input + output**: caller mutations on the input payload after the call MUST NOT affect stored state; caller mutations on the returned record MUST NOT affect stored state. (Conformance: mutation-after-write test for both input and return value.)

### From Step 4 (audit log)

- **Builder-only audit emission**: every state-changing call MUST emit one audit event via `buildCaseBoxAuditEvent`. NO raw audit-event construction inside persistence. (Conformance: count emitted events per call.)
- **Append-only**: audit events are never updated or deleted by the persistence layer. (Conformance: no UPDATE/DELETE method exists in A1's public surface; static check.)
- **Per-matter hash chain**: `prev_event_hash` of each new event equals the SHA-256 of the previous event's canonical input. The first event in a matter has `prev_event_hash === null`. The matter's head hash is updated atomically with the event insert. (Conformance: write 3 events; verify chain manually via `canonicalAuditEventHashInput` + sha256; assert head matches.)
- **Tamper detection at re-derivation time**: replaying the chain through `verifyAuditChain` returns ok on an untampered chain; mutating any stored event's content makes `verifyAuditChain` return an error pointing at the broken index. (Conformance: tamper test.)
- **Timestamp normalization**: every audit event's `timestamp` is the ISO string of the persistence's injected `now()` clock, never a different format. (Conformance: deterministic-clock test.)

### From Step 5 (confidentiality) — DEFERRED to A2

Phase A1 does NOT implement classification. The conformance harness does NOT include classification cases. `assertExternalHandlingAllowed` is not called from A1.

### From Step 6 (deadline / docket) — DEFERRED to A5

Phase A1 does NOT implement deadline or docket-entry writes. No `CaseBoxDeadline` API. No materialization. **The absence of a raw `CaseBoxDeadline` insertion API in A1's public surface is itself a load-bearing invariant** — Step 6 obligation 10 forbids exposing one ever; A1 must not seed one for later removal. (Conformance: static check on public exports.)

### From Step 7 (multi-user readiness) — partial in A1

- **`tenant_id` consistency across matter and document**: a `registerDocument` call whose `document.tenant_id !== matter.tenant_id` MUST be rejected with `CaseBoxPersistenceError({ code: "tenant_mismatch" })`. (Conformance: explicit cross-tenant reject test.)
- **`matter_id` consistency**: a `registerDocument(matterId, document)` call whose `document.matter_id !== matterId` MUST be rejected with `CaseBoxPersistenceError({ code: "matter_id_mismatch" })`. `listDocuments` MUST reject unknown matter and `(tenant_id, matter_id)` pair mismatch with `code: "unknown_matter"` and `code: "tenant_mismatch"` respectively.
- **`actor_user_id = "local-user"` is allowed in A1** for the lawyer-side actor in `archiveMatter` / `unarchiveMatter` / `registerDocument` writes, AND for `matter.actor_user_id` at create time. The Step-7 refusal gate is dormant in A1 because no write API can set `sync_grant_present` / `external_ocr_authorized` / `llm_extraction_opt_in` to true.
- **CLOSING THE LOCAL-USER-AT-BIRTH SIDE DOOR** (review H1): `createMatter` MUST REJECT matter inputs where ANY of those three opt-in flags is true. A1 has no audit'd write API to flip them later, so allowing them at creation time would be the only way to set them — and that would bypass the Step-7 gate by a side door. Code: `local_only_external_flag_rejected`. The matter must be created with all three flags false; if a future phase needs to set them, that phase ships the audit'd `authorizeExternalOcr` / `addSyncGrant` / `enableLlmExtraction` write APIs as the only path.

### From Step 8 (LLM extractor policy) — DEFERRED to a much later phase

A1 does NOT touch any LLM concern. No `llm_extraction_opt_in` write; matter creation will populate the field from the validated input as `false` (the schema default) and never mutate it. The Step-8 enforcement gate is not yet relevant.

---

## 5. Out of scope (explicit)

Phase A1 will NOT:

- Implement any SQLite code. No `services/case-box-persistence/src/sqlite/` directory.
- Add `better-sqlite3`, `@types/better-sqlite3`, or any other native dependency to `package.json`.
- Touch `services/ocr-persistence/` or any OCR sibling package.
- Implement fact write APIs (`appendFactCandidate`, `reviewFact`, `acceptFact`, `rejectFact`) — Phase A4.
- Implement privilege marker write APIs — Phase A3.
- Implement docket entry / deadline materialization — Phase A5.
- Implement classification write APIs — Phase A2.
- Implement evidence item write APIs — Phase A6.
- Implement OCR link write APIs — Phase A7.
- Implement read-side aggregations beyond `getMatter`, `getDocument`, `listDocuments` — Phase A8.
- Implement replay-safe `*Once` variants — Phase A9.
- Modify any ADR.
- Add a new ADR.
- Modify the cc-suite rule, autonomy rule, or any skill.
- Modify the loc-guardian config (it already covers the new package via the project-wide rule).
- Push to any remote.
- Author any sign-off doc.
- Add CI configuration.

The cc-suite review-plan reviewer SHOULD verify scope discipline by spot-checking that the diff (when implementation lands) touches ONLY paths listed in §2.

---

## 6. Tests planned

The harness mirrors `services/ocr-persistence/tests/conformance/runOcrPersistenceConformance.mjs` in style: a single `runConformance(make, options)` function called by per-implementation test files.

### 6.1 Conformance matrix (`tests/conformance/runCaseBoxPersistenceConformance.mjs`)

| § | Case | Asserts |
|---|---|---|
| 6.1.1 | createMatter — happy path | returns the matter; `getMatter(id)` round-trips; one `MATTER_REGISTERED` audit event emitted |
| 6.1.2 | createMatter — schema-invalid submission | `validateMatter` rejection → `CaseBoxPersistenceError({ code: "invalid_payload" })`; no audit event emitted |
| 6.1.3 | createMatter — duplicate `id` | second call with same id rejects with `code: "duplicate_id"`; no second audit event |
| 6.1.4 | createMatter — caller-mutates-input after call | post-call mutation does not affect stored record |
| 6.1.5 | createMatter — caller-mutates-return after call | post-call mutation does not affect stored record |
| 6.1.6 | createMatter — opt-in flag `external_ocr_authorized=true` at birth | rejects with `code: "local_only_external_flag_rejected"`; no audit event |
| 6.1.7 | createMatter — opt-in flag `sync_grant_present=true` at birth | same |
| 6.1.8 | createMatter — opt-in flag `llm_extraction_opt_in=true` at birth | same |
| 6.1.9 | createMatter — initial `status !== "active"` | rejects with `code: "invalid_initial_state"` |
| 6.1.10 | createMatter — `archived_at` set at birth | rejects with `code: "invalid_initial_state"` |
| 6.1.11 | archiveMatter — happy path | calls `assertValidMatterTransition("active", "archived", "lawyer")`; matter status transitions to `archived`; `archived_at` set from injected clock; emits `MATTER_ARCHIVED` event with audit `reason === opts.reason` and `actor_user_id === opts.actor_user_id` |
| 6.1.12 | archiveMatter — unknown id | rejects with `code: "unknown_matter"` |
| 6.1.13 | archiveMatter — already archived | rejects with `code: "illegal_transition"` (self-transition rejected by `assertValidMatterTransition`) |
| 6.1.13a | archiveMatter — empty reason | rejects with `code: "invalid_argument"`; no audit event |
| 6.1.14 | unarchiveMatter — happy path | calls `assertValidMatterTransition("archived", "active", "lawyer")`; emits `MATTER_UNARCHIVED` with actor + reason |
| 6.1.15 | unarchiveMatter — already active | rejects with `code: "illegal_transition"` |
| 6.1.15a | unarchiveMatter — empty reason | rejects with `code: "invalid_argument"`; no audit event |
| 6.1.16 | registerDocument — happy path | returns document; `getDocument(id)` round-trips; emits `DOCUMENT_REGISTERED` |
| 6.1.17 | registerDocument — tenant_id mismatch with matter | rejects with `code: "tenant_mismatch"`; no audit event |
| 6.1.18 | registerDocument — matter_id mismatch (document.matter_id !== arg) | rejects with `code: "matter_id_mismatch"`; no audit event |
| 6.1.19 | registerDocument — unknown matter_id | rejects with `code: "unknown_matter"` |
| 6.1.20 | registerDocument — duplicate document.id | rejects with `code: "duplicate_id"` |
| 6.1.21 | registerDocument — schema-invalid submission | `validateDocument` rejection → `code: "invalid_payload"` |
| 6.1.22 | registerDocument — initial `status !== "registered"` | rejects with `code: "invalid_initial_state"` |
| 6.1.23 | listDocuments — empty matter returns empty rows, null cursor | |
| 6.1.24 | listDocuments — unknown matter | rejects with `code: "unknown_matter"` |
| 6.1.25 | listDocuments — `(tenant_id, matter_id)` pair mismatch | rejects with `code: "tenant_mismatch"` |
| 6.1.26 | listDocuments — single page (n < limit) | returns all rows, null cursor |
| 6.1.27 | listDocuments — multi-page seek | first page returns limit rows + cursor; second page returns remainder + null cursor; no duplicates; correct ordering by `received_at DESC, id ASC` |
| 6.1.28 | listDocuments — wrong tenant cursor | rejects (filter-hash mismatch in cursor decode) |
| 6.1.29 | getAuditChainHead — matter with seed event only | returns `{ headHash: <hash of MATTER_REGISTERED>, lastEventId: <event id>, count: 1 }` |
| 6.1.30 | getAuditChainHead — after N writes | returns head matching the Nth event's hash; count === N |
| 6.1.31 | getAuditChainHead — unknown matter | rejects with `code: "unknown_matter"` |
| 6.1.32 | verifyAuditChainForMatter — untampered chain | returns `ChainVerifyOk` with `verifiedCount === count`, `headHash === current head` |
| 6.1.33 | verifyAuditChainForMatter — tampered chain (via `__testTamperEvent` seam) | returns `ChainVerifyErr` with `errorIndex`, `errorReason ∈ ChainVerifyErrorReason`, `detail` |
| 6.1.34 | verifyAuditChainForMatter — unknown matter | rejects with `code: "unknown_matter"` (typed error, NOT `ChainVerifyErr`) |
| 6.1.35 | listAuditEvents — happy path | returns events ordered by **`sequence ASC`** (per-matter monotonic); cursor-paginates correctly |
| 6.1.36 | listAuditEvents — unknown matter | rejects with `code: "unknown_matter"` |
| 6.1.37 | listAuditEvents — tenant/matter pair mismatch | rejects with `code: "tenant_mismatch"` |
| 6.1.38 | audit event ID format | `generateUlid()` output matches `^[0-9a-z]{26}$`; never a UUID. Reproducibility across runs is NOT required for A1 — chain hashes depend on event content not on ID-generation determinism; chain order is preserved by per-matter `sequence`. |

### 6.2 Invariants matrix (`tests/invariants.test.mjs`)

| § | Case | Asserts |
|---|---|---|
| 6.2.1 | Package depends on case-box-contract only | `package.json` `dependencies` keys === `["case-box-contract"]`; no `better-sqlite3`; no `ocr-persistence` |
| 6.2.2 | No `CaseBoxDeadline` write API exists | `Object.getOwnPropertyNames(InMemoryCaseBoxPersistence.prototype)` (NOT `Object.keys` — class methods are non-enumerable) excludes any function whose name suggests deadline creation (`createDeadline`, `insertDeadline`, `appendDeadline`, `writeDeadline`); same check on `src/index.ts` exports |
| 6.2.3 | No public `appendAuditEvent` API | same property-name check excludes obvious names (`appendAuditEvent`, `writeAuditEvent`, `recordAudit`) |
| 6.2.4 | Every emitted audit event's `(action, entity_type)` pair matches a `CASE_BOX_AUDIT_EVENT_KINDS` entry | Note: `buildCaseBoxAuditEvent` consumes a `kind` discriminator but emits a contract `CaseBoxAuditEvent` carrying `action` + `entity_type` (NOT `kind`). The schema does not include `kind`. Smoke test: walk every A1 write API; for each emitted event, find a `CASE_BOX_AUDIT_EVENT_KINDS` entry whose `action` and `entity_type` both match. If none match, the implementation is using a non-builder path or an unknown kind. |
| 6.2.5 | Deep-clone defensive copies | mutation-after-write covered in conformance §6.1.4/5; this file repeats once for documents and once for audit events returned from `listAuditEvents` |
| 6.2.6 | All `CaseBoxPersistenceError` instances carry a non-empty `code` from the documented set | walk a synthetic failure for each code; assert exact code string |
| 6.2.7 | `InMemoryCaseBoxPersistence` exposes EXACTLY the 10 documented public methods | `Object.getOwnPropertyNames(InMemoryCaseBoxPersistence.prototype).sort()` deep-equals the alphabetically-sorted array `["archiveMatter", "constructor", "createMatter", "getAuditChainHead", "getDocument", "getMatter", "listAuditEvents", "listDocuments", "registerDocument", "unarchiveMatter", "verifyAuditChainForMatter"]` (`a` < `c` so `archiveMatter` precedes `constructor` in standard lexicographic sort). No `__testTamperEvent`, no `appendAuditEvent`, no future-phase stub. The tamper helper for §6.3.4 lives in a SEPARATE test-only module (`tests/internals.mjs`) and is NOT a method on the class. |

### 6.3 Audit chain matrix (`tests/auditChain.test.mjs`)

Tests at this level exercise `auditChain.ts` directly (synthetic events) AND the persistence APIs (`getAuditChainHead`, `verifyAuditChainForMatter`, `listAuditEvents`) for end-to-end coverage.

| § | Case | Asserts |
|---|---|---|
| 6.3.1 | First event in a matter has `prev_event_hash === null` | via `listAuditEvents` |
| 6.3.2 | Subsequent events chain to prior head | hand-compute via `canonicalAuditEventHashInput` + sha256; compare to `getAuditChainHead(matterId).headHash` |
| 6.3.3 | Head hash updates on every write | call N writes; query head after each via `getAuditChainHead`; assert monotone non-equality |
| 6.3.4 | Tamper detection on a mutated stored event (mid-chain local detection only) | use a test-only helper exported from `tests/internals.mjs` (NOT from `src/index.ts`; NOT a method on `InMemoryCaseBoxPersistence`): `tamperStoredEvent(persistenceInstance, matterId, sequence, mutator)` reaches into the persistence instance's internal Map via a module-symbol guard and mutates one event. `verifyAuditChainForMatter` then returns `ChainVerifyErr` with `errorIndex`, `errorReason ∈ ChainVerifyErrorReason`, `detail`. **Scope note**: this proves mid-chain tampering is detected by local chain replay. Whole-chain rewrite detection requires the external head-anchor manifest per Step 4 obligation 6 — explicitly deferred from A1. **The tamper helper is never importable from the package's published surface; conformance §6.2.7 prevents it from leaking onto the class.** |
| 6.3.5 | Deterministic clock produces deterministic hashes | inject `now()` returning a fixed series; inject `generateId()` returning a fixed series; assert hash sequence is reproducible across runs |
| 6.3.6 | Cross-matter chains do not interfere | two matters' chains are independent; head of A unchanged by writes to B |
| 6.3.7 | `listAuditEvents` order is chain order | events come back in the same order they were written; `prev_event_hash` of event N matches hash of event N-1 |
| 6.3.8 | `verifyAuditChainForMatter` on matter with seed event only | returns `ChainVerifyOk` with `verifiedCount === 1`, `headHash === sha256(canonicalAuditEventHashInput(seedEvent))`. (Empty-chain case is unreachable through the public surface since `createMatter` always emits `MATTER_REGISTERED`; this case is moved to a `verifyAuditChain` unit test against a synthetic empty array, not against persistence.) |
| 6.3.9 | Timestamp normalization | injected `now()` MUST return a real `Date`. Persistence calls `now().toISOString()` to stamp the event. Test inputs: (a) `now` returning `null` rejects with `code: "invalid_argument"`; (b) `now` returning `new Date("garbage")` — `.toISOString()` throws `RangeError: Invalid time value` — rejects with `code: "invalid_argument"` (the RangeError is caught and re-thrown as the typed persistence error); (c) `now` returning a valid Date produces a stable ISO-8601 string. No untyped-string clocks are ever accepted. |

### 6.4 Fixture builders

Concrete builders live alongside the harness so tests don't reinvent valid input shapes. Located at `tests/conformance/fixtures.mjs`:

- `makeMatterInput({ id?, tenant_id?, actor_user_id?, ...overrides }): unknown` — returns a valid `CaseBoxMatter` input with all opt-in flags false, status active, archived_at unset.
- `makeDocumentInput({ id?, matter_id, tenant_id, ...overrides }): unknown` — returns a valid `CaseBoxDocument` input with status `registered`.
- `makeClock(start: string, stepMs: number = 1000): () => Date` — deterministic clock for hash reproducibility.
- `makeIdGenerator(prefix: string): () => string` — deterministic ID generator. Returns 26-char lowercase strings matching `^[0-9a-z]{26}$`. Default implementation: takes the caller's `prefix` (must be at most 17 chars, lowercase + digits only), right-pads the prefix with `'0'` chars to exactly 18 chars, then appends a zero-padded 8-char base32-encoded counter (`'00000000'`, `'00000001'`, …). The full output is always **exactly 26 chars** and schema-valid. **Example**: prefix `"matter"` (6 chars) → padded to `"matter000000000000"` (18 chars) → first call returns `"matter00000000000000000000"` (18 chars + 8 counter chars = 26 chars), second call returns `"matter00000000000000000001"`, etc. Tests assert `output.length === 26 && /^[0-9a-z]{26}$/.test(output)` on EVERY generated id.

### 6.5 No native / network / cloud / auth / UI

All tests run under `node:test` with zero external dependencies. No network calls. No file I/O outside of the test's own temp directory (the in-memory implementation does not use the filesystem at all in A1).

### 6.6 ABI baseline handling

Phase A1 does NOT depend on `better-sqlite3`. The existing OCR-persistence ABI mismatch (`NODE_MODULE_VERSION 127 vs 137`) is NOT inherited by A1 and NOT verified by A1's acceptance — A1 simply does not touch OCR packages. `npm --prefix services/case-box-persistence test` MUST exit 0 on any Node ≥22 environment that can run the rest of the repo.

---

## 7. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Audit-chain hash drift between contract helper and persistence (re-implementing canonicalization differently) | Medium | High — silent provenance corruption | A1 imports `buildCaseBoxAuditEvent` + `canonicalAuditEventHashInput` from the contract verbatim. No local canonicalization. Conformance §6.3.2 hand-computes hashes the same way to detect drift. |
| R2 | `tenant_id` mismatch error message drifts from what future API/UI layers expect | (resolved) | (resolved) | **RESOLVED round-2**: conformance asserts on `code: "tenant_mismatch"` (machine-stable discriminator), NOT on message substring. Messages remain free-form. |
| R3 | Public surface accidentally includes a future API (e.g. an `appendDeadline` stub) | Low | High — Step-6 obligation 10 violation | Conformance §6.2.2 explicitly checks Object.keys. Static check. |
| R4 | LOC discipline drift — `inMemoryRepo.ts` grows past 350 raw LOC during A1 | Low-Medium | Medium | Apply LOC-01 sibling-module extraction from the start: if `inMemoryRepo.ts` exceeds 350 raw LOC, split per-entity (matter ops → `src/inMemoryMatter.ts`, document ops → `src/inMemoryDocument.ts`) before commit. |
| R5 | Cursor format incompatibility with future Sqlite list handler | Low | Medium | **RESOLVED (post-review)**: A1 copies the cursor module locally into `case-box-persistence/src/cursor.ts` (with header comment crediting `services/ocr-persistence/src/cursor.ts`). NO dependency on `ocr-persistence`. A future shared-helper extraction MAY move the cursor to a contract-level package; A1 does not pre-commit to that move. |
| R6 | `validateMatter` / `validateDocument` semantics drift between contract and persistence | Low | High | Persistence calls contract validator unmodified; never adds its own JSON-schema. Conformance §6.1.2 and §6.1.13 exercise the validator path explicitly. |
| R7 | Deep-clone performance pathology on large matters | Very low (A1 is in-memory; small data) | Low | `structuredClone` is fast enough for in-memory; OCR persistence uses the same pattern. Not optimized in A1. |
| R8 | Conformance harness fragility — flake on time-dependent assertions | Low | Low | Inject `now()` clock at construction; tests use the deterministic clock and assert exact ISO strings. |
| R9 | A1 ships a public API surface that locks the wrong shape for A2-A9 | Medium | High — re-design churn | The interface declared in `src/types.ts` MUST be a strict subset of the eventual full interface; do NOT add methods speculatively, do NOT include "TODO" methods. Each subsequent phase adds methods incrementally. |
| R10 | `OcrPersistenceError`-style error class lacks a discriminator code, making conformance tests fragile to message-text changes | (resolved) | (resolved) | **RESOLVED round-2**: `CaseBoxPersistenceError` ships with a REQUIRED `code` field; conformance asserts on `code`, NOT message substring. The 10 documented codes are listed in §1.1. Messages remain free-form and informational. |
| R11 | (RESOLVED round-2): `listAuditEvents` IS now in A1's public surface as method 8. The risk no longer exists. |  |  |  |

---

## 8. Acceptance criteria (exact)

Phase A1 commit is acceptable iff ALL of the following hold:

| # | Acceptance | How verified |
|---|---|---|
| 8.1 | `npm --prefix services/case-box-persistence install` exits 0 | manual run before commit; recorded in commit message |
| 8.2 | `npm --prefix services/case-box-persistence run build` exits 0 with no warnings | `tsc -p tsconfig.json` clean |
| 8.3 | `npm --prefix services/case-box-persistence test` exits 0 with 100% of conformance + invariants + audit-chain tests passing | test runner output recorded |
| 8.4 | `npm --prefix services/case-box-persistence test` does NOT load `better-sqlite3` | grep test output for `NODE_MODULE_VERSION` / `ERR_DLOPEN_FAILED` — neither must appear |
| 8.5 | OCR contract package tests still pass | `npm --prefix docs/contracts test` — ABI-free; should already be green |
| 8.6 | Case-box-contract package tests still pass | `npm --prefix docs/contracts/case-box-contract test` — should already be green |
| 8.7 | (REMOVED) — A1 does not touch OCR persistence, so its ABI baseline is not part of A1 acceptance |
| 8.8 | loc-guardian: `VERDICT: 0 over limit` | re-scan from repo root after A1 lands |
| 8.9 | No file outside §2 added paths is created or modified | `git diff --cached --name-only` reviewed before commit; conformance to §3 untouched-list verified |
| 8.10 | AGENTS.md test-commands list includes the new package | grep AGENTS.md for `case-box-persistence test` |
| 8.11 | Public exports limited to §2's `src/index.ts` list — no leaky internals, no future-phase stubs | conformance §6.2.2 + §6.2.3 enforce |
| 8.12 | No path under `.claude/**` modified (rules / skills / commands unchanged) | `git diff --cached --name-only` filter |
| 8.13 | No path under `docs/adr/**`, `docs/release/**`, `docs/product/**`, `docs/ui/**`, `docs/contracts/**` modified | same |
| 8.14 | Audit chain conformance §6.3 passes: head hash deterministic, tamper detected, cross-matter independence preserved | test run |
| 8.15 | **Ready for commit** — explicit-stage path list prepared (per `.claude/rules/staging-hygiene.md`); commit message drafted with A1 scope + ABI-free posture noted; the commit itself is NOT performed by A1 — it requires explicit per-WI user authorization per the autonomy policy. | dry-run via `git add --dry-run` against the expected file list from §2; do not execute `git commit` until authorized. |

---

## 9. Out-of-scope clarifications for the reviewer

The reviewer (`/cc-suite:review-plan`) is asked NOT to flag the following as gaps — they are intentionally deferred per the parent plan:

- No SQLite — Phase B+, ABI-gated (parent plan §7).
- No facts / docket entries / privilege markers / classifications / evidence items / OCR links / replay-safe `*Once` — Phases A2-A9.
- No `actor_user_id === "local-user"` refusal — gate activates only when matter-level opt-in flags can be set true via a write API (not in A1).
- No external-handling gate calls — no external action is reachable in A1.
- No coordinator integration — case-box-persistence and OCR persistence remain independent in A1; OCR link comes in A7.
- No multi-process / multi-connection concurrency model — in-memory single-process by definition; SQLite phase will revisit.
- No retention / backup / export — out of v1.

The reviewer IS asked to surface findings on:

- Hash-chain correctness (§6.3, §4 invariants).
- Tenant consistency enforcement (§4, §6.1.10, §6.2.5).
- Defensive copy / mutation isolation (§6.1.4/5).
- LOC discipline (R4 in §7).
- Public surface discipline (§2 + §6.2.2/§6.2.3).
- Acceptance criteria coverage by tests (cross-check §6 against §8).
- Cursor-format reuse decision (R5 in §7) — reviewer should pick: depend on `ocr-persistence` for the cursor module, or copy-paste into the new package.

---

## 10. References

- `dev-memo/plan-case-box-persistence-00.md` (commit `4f39e02`) — parent plan; A1 is §10.1 / §10.2 row 1.
- `docs/adr/case-box-step-0-boundary.md` — boundary; one-way deps.
- `docs/adr/case-box-step-4-audit-log-shape.md` — audit chain; canonical-hash-input contract.
- `docs/adr/case-box-step-7-multi-user-readiness.md` — local-user sentinel; gate deferred for A1.
- `docs/contracts/case-box-contract/src/index.ts` — public surface to be imported.
- `docs/contracts/case-box-contract/src/audit-log.ts` — `buildCaseBoxAuditEvent`, `canonicalAuditEventHashInput`, `verifyAuditChain`, `CASE_BOX_AUDIT_EVENT_KINDS`.
- `services/ocr-persistence/src/types.ts` — shape reference for the interface.
- `services/ocr-persistence/src/inMemoryRepo.ts` — implementation pattern reference.
- `services/ocr-persistence/src/cursor.ts` — cursor module (decision in R5).
- `services/ocr-persistence/tests/conformance/runOcrPersistenceConformance.mjs` — harness pattern.
- `.claude/rules/cc-suite.md` — this WI's review-plan invocation policy.
- `.claude/rules/autonomy.md`, `.claude/rules/loc-guardian.md`, `.claude/rules/staging-hygiene.md` — guardrails.
