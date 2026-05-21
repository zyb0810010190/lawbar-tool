# CASE-BOX-PERSISTENCE-00 — Implementation Plan

**Status**: plan only. NOT implementation. NOT authorization to write database code, install dependencies, modify schemas, or push.
**Date**: 2026-05-20.
**Closes**: Step 0 §"Migration plan" Phase 2 (case-box-persistence). Inherits obligations recorded across Step 2-8 ADRs.

---

## 1. Package location

**Decision: `services/case-box-persistence/`** — sibling of `services/ocr-persistence/`.

Rationale:

- Step 0 §"Decision" §1 ("Adopt the following case-box product boundary as authoritative") explicitly placed `case-box-persistence/` under `services/` alongside `services/ocr-*`. Restating here.
- The OCR persistence package at `services/ocr-persistence/` is the canonical reference for "TypeScript ESM, Node ≥20, node:test runner, in-memory + SQLite split behind a single interface." Case-box mirrors that.
- The contract package (`case-box-contract`) lives at `docs/contracts/case-box-contract/` because contracts are wire-format / vocabulary owners. Persistence is a service; it belongs under `services/`. The split mirrors the OCR side exactly.

Layout (proposed, NOT yet created):

```
services/case-box-persistence/
├── package.json                       (private, type:module, node ≥22)
├── tsconfig.json
├── src/
│   ├── types.ts                       (CaseBoxPersistence interface + record types + CaseBoxPersistenceError)
│   ├── inMemoryRepo.ts                (InMemoryCaseBoxPersistence — Phase A)
│   ├── replaySafe.ts                  (deepEquals, canonical compare helpers; mirrors ocr-persistence/src/replaySafe.ts)
│   ├── cursor.ts                      (cursor encode/decode for read-API pagination; mirrors ocr-persistence/src/cursor.ts)
│   ├── errors.ts                      (typed error class + codes)
│   ├── audit-chain.ts                 (head-hash bookkeeping wrappers around buildCaseBoxAuditEvent + verifyAuditChain)
│   ├── sqlite/                        (Phase B+; gated by ABI baseline decision §7)
│   │   ├── SqliteCaseBoxPersistence.ts
│   │   ├── schema.ts
│   │   ├── factPromotion.ts
│   │   ├── docketEntryMaterialize.ts
│   │   ├── privilegeMarkers.ts
│   │   ├── confidentialityHistory.ts
│   │   ├── auditAppend.ts
│   │   └── … (extraction pattern from LOC-01 applies; each substantive concern in its own file)
│   └── index.ts                       (public surface)
├── tests/
│   ├── conformance/
│   │   └── runCaseBoxPersistenceConformance.mjs     (shared harness; runs against both impls)
│   ├── inMemory.conformance.test.mjs
│   ├── sqlite.conformance.test.mjs   (Phase B+; ABI-gated)
│   ├── invariants.test.mjs            (cross-entity invariants not in conformance)
│   ├── auditChain.test.mjs            (hash chain integrity + tamper detection)
│   └── …
```

The directory does not yet exist. This plan does NOT create it.

---

## 2. Storage targets

**Decision: two implementations behind one interface, conformance-tested in parallel.** Phased landing: in-memory first; SQLite gated on the ABI baseline (§7).

| # | Implementation | Backing | When |
|---|---|---|---|
| 1 | `InMemoryCaseBoxPersistence` | `Map`s + arrays in-process; structuredClone on read | **Phase A** (smallest safe slice). No native deps. Runs everywhere. |
| 2 | `SqliteCaseBoxPersistence` | `better-sqlite3` synchronous driver | **Phase B+** (after ABI baseline §7 is resolved or explicitly accepted) |

A shared conformance test (`tests/conformance/runCaseBoxPersistenceConformance.mjs`) drives BOTH implementations through the same write/read/invariant matrix. Behavioral parity is required — same `CaseBoxPersistenceError` messages, same record shapes, same ordering, same idempotency semantics. Mirrors `services/ocr-persistence/tests/conformance/runOcrPersistenceConformance.mjs`.

**The conformance harness is the contract for the persistence boundary.** New invariants in future case-box ADR Steps land as new conformance cases first, then implementations follow.

---

## 3. Write APIs

The interface is shape-stable across implementations. Each method returns the canonical written record (re-parsed / deep-cloned) so callers cannot mutate stored state.

### 3.1 Matter

- `createMatter(matter: unknown): Promise<CaseBoxMatter>` — calls `validateMatter`; rejects duplicate `id`; persists matter row + emits `MATTER_CREATED` audit event in same transaction.
- `archiveMatter(matterId, reason): Promise<CaseBoxMatter>` — applies `assertValidMatterTransition("active", "archived", "lawyer")`; emits `MATTER_ARCHIVED`.
- `unarchiveMatter(matterId, reason): Promise<CaseBoxMatter>` — symmetric; emits `MATTER_UNARCHIVED`.

### 3.2 Document

- `registerDocument(matterId, document: unknown): Promise<CaseBoxDocument>` — calls `validateDocument`; cross-checks `document.matter_id === matterId`; cross-checks `tenant_id`; emits `DOCUMENT_REGISTERED`.
- `updateDocumentStatus(documentId, from, to, by): Promise<CaseBoxDocument>` — applies `assertValidDocumentTransition`; rejects revisions of `content_hash`; emits the corresponding `DOCUMENT_*` audit kind from Step 4 vocabulary.
- `linkOcrJob(documentId, ocrJobId): Promise<CaseBoxOcrLink>` — inserts a `CaseBoxOcrLink` row with `direction: "read-only"`; calls `assertCaseBoxIsSubordinateToOcr`; emits `OCR_LINK_OBSERVED`.
- `syncOcrLinkSnapshot(documentId, statusSnapshot): Promise<CaseBoxOcrLink>` — replaces the latest snapshot for the document; never writes to ocr-persistence; emits a snapshot update audit.

### 3.3 Fact (Step 2)

- `appendFactCandidate(input: unknown): Promise<CaseBoxFact>` — calls `assertValidNewFact` (refuses non-`candidate` status from machine sources; refuses self-cycle via supersedes); **persistence-side multi-hop supersession-graph cycle detection** runs before insert. Emits `FACT_CANDIDATE_CREATED`.
- `reviewFact(factId, reviewerActorId, notes?): Promise<CaseBoxFact>` — transitions `candidate → reviewed`; emits `FACT_REVIEWED`.
- `acceptFact(factId, reviewerActorId, supersedesFactId?): Promise<CaseBoxFact>` — transitions to `accepted`; if `supersedesFactId` set, re-runs cycle detection; emits `FACT_ACCEPTED`.
- `rejectFact(factId, reviewerActorId, rejectionReason): Promise<CaseBoxFact>` — transitions to `rejected`; emits `FACT_REJECTED` with audit `reason === rejection_reason` (Step 4 §"reason equality").

There is **NO machine-driven accept path**. No `autoAcceptFact`, no `bulkAccept`, no extractor-confidence shortcut.

### 3.4 Privilege marker (Step 3)

- `appendPrivilegeMarker(input: unknown): Promise<CaseBoxPrivilegeMarker>` — calls `assertValidNewPrivilegeMarker`; enforces uniqueness `(tenant_id, matter_id, target_type, target_id, kind)` for `status === "confirmed"`; enforces target-tenant/matter consistency; emits `PRIVILEGE_MARKER_PROPOSED` or `PRIVILEGE_MARKER_CONFIRMED` per source.
- `transitionPrivilegeMarker(markerId, from, to, by, reason?): Promise<CaseBoxPrivilegeMarker>` — applies `assertValidPrivilegeMarkerTransition` + `assertPrivilegeMarkerTimestamps`; rejects `proposed → dismissed` or `confirmed → waived` without a reason (Step 3 §"reason invariants"); for `dismissed` audit `reason === dismissal_reason`; for `waived` audit `reason === waiver_reason`.
- Post-waiver new markers are separate rows; no un-waive path.

### 3.5 Deadline & docket entry (Step 6)

- **No raw `CaseBoxDeadline` insertion API.** Step 6 obligation 10 forbids it. Conformance proves the absence: the public interface MUST NOT expose `createDeadline` or any synonym. `CaseBoxDeadline` rows are materialized only via the Mode B docket-entry confirmation path.
- `appendDocketEntry(input: unknown): Promise<CaseBoxDocketEntry>` — calls `assertValidNewDocketEntry`; calls `assertValidIanaTimezone` when timezone is non-null; emits `DOCKET_ENTRY_PROPOSED`.
- `confirmDocketEntry(entryId, lawyerActorId): Promise<{ docketEntry: CaseBoxDocketEntry; deadline: CaseBoxDeadline }>` — Mode B: preallocate `CaseBoxDeadline.id` ULID, call `assertValidDocketEntryConfirmation` (which throws on `date_only`), update docket entry, INSERT deadline; all atomic; emits `DOCKET_ENTRY_CONFIRMED` + `DEADLINE_MATERIALIZED`. Idempotent re-run (preflight detects already-confirmed): no audit, no duplicate deadline. `confirmed_deadline_id` uniqueness enforced via unique index (SQLite) or set bookkeeping (in-memory).
- `dismissDocketEntry(entryId, lawyerActorId, dismissalReason): Promise<CaseBoxDocketEntry>` — emits `DOCKET_ENTRY_DISMISSED` with audit `reason === dismissalReason`.
- `withdrawDeadline(deadlineId, lawyerActorId, reason): Promise<CaseBoxDeadline>` — transitions `pending → withdrawn` per Step-1 deadline lifecycle. The ONLY allowed mutation on a materialized deadline in v1 is its status lifecycle (`pending → met | missed | withdrawn`, plus reason-required `missed → met`).
- No continuance / deferment / due_at mutation API in v1.

### 3.6 Evidence item (Step 1)

- `appendEvidenceItem(input: unknown): Promise<CaseBoxEvidenceItem>` — calls `validateEvidenceItem`.
- `transitionEvidenceItem(evidenceId, from, to, by, supersedesEvidenceId?): Promise<CaseBoxEvidenceItem>` — applies `assertValidEvidenceTransition`; `accepted → superseded` requires `supersedes_evidence_id`.

### 3.7 Confidentiality classification (Step 5)

- `appendConfidentialityClassification(input: unknown): Promise<CaseBoxConfidentialityClassification>` — loads prior row for the target (latest-wins by `set_at` DESC, id tiebreak); calls `assertValidNewConfidentialityClassification(row, priorRow)`; rejects `target_type === "matter"` (schema-rejected; defense-in-depth here); rejects auto-create of `normal` for new targets (`unclassified` is the absence default). Emits `CLASSIFICATION_SET` / `_UPGRADED` / `_DOWNGRADED` / `_RESET_TO_UNCLASSIFIED` per kind. Audit `reason === change_reason_code` for downgrades / resets (Step 5 obligation 7).
- Append-only. No UPDATE.

### 3.8 Audit event (Step 4) — emitted, not directly written

- **No public `appendAuditEvent` API.** Audit events are emitted internally by every write operation listed above. Builder-only emission via `buildCaseBoxAuditEvent({ kind, ... })`. Raw audit-event construction is forbidden by code review.
- Each write operation that emits an audit event commits the domain row and the audit row in the same transaction (v1 RECOMMENDED). Outbox protocol allowed per Step 6 obligation 7 if and only if it provides durable pending-event log + monotonic seq + ordered retry + idempotency keys + chain-hash recovery + conformance tests.
- Hash chain head tracking: persistence keeps the `headHash` per matter (stored in a control row or computed on demand from `verifyAuditChain`). Export captures the head per Step 4 obligation 6.

### 3.9 Replay-safe variants

For the at-least-once redelivery paths (mainly `appendFactCandidate` for LLM-driven future flows, and `linkOcrJob`/`syncOcrLinkSnapshot` for queue-driven flows), provide explicit `Once` variants that compare canonical payloads and return the existing row on exact replay. Pattern mirrors `appendOcrStatusOnce` / `saveOcrResultOnce` in OCR persistence.

`appendDocketEntryOnce` and `confirmDocketEntryOnce` are NOT in v1 — confirmation is lawyer-initiated, not queue-driven.

---

## 4. Read APIs

Cursor-paginated where the result set can grow; bounded fetches otherwise. All reads return deep-cloned records (no internal references leak).

### 4.1 Matter

- `getMatter(matterId): CaseBoxMatter | null`
- `listMatters({ tenant_id, status?, cursor?, limit? }): { rows, next_cursor }` — paginated by `created_at DESC, id ASC`.
- `getMatterSummary(matterId): CaseBoxMatterSummary` — derived view: counts of documents / facts (by status) / deadlines (by status) / privilege markers / docket entries / confidentiality classifications. Read-model only. (Note: `risk` and `next_action` from the original case-box pre-Phase-0 plan are NOT in the current contract surface — they were not promoted to Step 1+ ADRs and are excluded from v1. If a future ADR adds them, the summary view extends naturally.)

### 4.2 Document

- `getDocument(documentId): CaseBoxDocument | null`
- `listDocuments({ tenant_id, matter_id, doc_type?, status?, cursor?, limit? })` — paginated.
- `getDocumentDetail(documentId): { document, ocrLink, classification, privilegeMarkers, factCandidates }` — bundled detail view.

### 4.3 Fact

- `getFact(factId)`
- `listFactCandidates({ tenant_id, matter_id, document_id?, source_type?, cursor?, limit? })` — facts in `candidate` status.
- `listFactsAccepted({ tenant_id, matter_id, cursor?, limit? })` — chronology view input (ordered by `asserted_date`).
- `getFactSupersessionChain(factId): CaseBoxFact[]` — follows `supersedes_fact_id` backward; persistence ensures no cycles so this terminates.

### 4.4 Review queues

- `listPagesNeedingManualReview` — defined in OCR persistence; case-box-persistence offers a parallel `listDocumentsNeedingReview` (documents in `triaged` but not yet `reviewed`).
- `listFactsAwaitingReview({ tenant_id, matter_id, cursor?, limit? })`.
- `listDocketEntriesPending` — proposed but not yet confirmed / dismissed.

### 4.5 Deadlines + docket entries

- `getDocketEntry(entryId)` / `listDocketEntries` — paginated.
- `getDeadline(deadlineId)` / `listDeadlines({ tenant_id, matter_id, status?, kind?, cursor?, limit? })`.
- `getDeadlineCalendar(matterId, { from?, to? })` — bounded by date range; ordered by `due_at ASC`.

### 4.6 Audit log

- `listAuditEvents({ tenant_id, matter_id, entity_type?, entity_id?, action?, actor_user_id?, cursor?, limit? })` — paginated by `timestamp ASC, id ASC` so chain order is preserved.
- `getAuditChainHead(matterId): { headHash, lastEventId, count }`.
- `verifyAuditChainForMatter(matterId): VerifyResult` — runs the contract's `verifyAuditChain` against persisted events; returns ok/err with index of break.

### 4.7 Classification / privilege resolution views

- `getEffectiveClassification(targetType, targetId): { effectiveLevel, history }` — latest-wins resolver per Step 5.
- `getPrivilegeResolution(targetType, targetId): PrivilegeResolution` — uses `effectivePrivilegeStatus`; returns the typed Step-3 shape with `hasProtectiveAssertion`.
- `evaluateExternalHandling(input: AssertExternalHandlingInput): HandlingDecision` — convenience wrapper around `assertExternalHandlingAllowed` that loads required inputs from persistence. Returns `HandlingDecision` verbatim; never claims "safe".

---

## 5. Invariants enforced at the persistence boundary

Consolidated from Step 2-8 obligations. Every invariant below is conformance-tested.

### 5.1 Tenant / matter consistency (Step 7 obligation 2 + Step 5 obligation 11 + Step 3 obligation 3)

For every cross-entity reference (`document.matter_id`, `fact.case_id`, `deadline.matter_id`, `evidence.matter_id`, `privilege_marker.matter_id`, `classification.target_id`, `ocr_link.document_id`, `audit_event.matter_id`):

- The referenced row's `tenant_id` MUST equal the writing row's `tenant_id`.
- The referenced row's `matter_id` (where applicable) MUST equal the writing row's `matter_id`.
- No cross-tenant FK-by-value resolution. Persistence raises a typed `CaseBoxTenantMismatchError` if violated.

### 5.2 Actor — local-user gate (Step 7 obligation 1)

Persistence MUST refuse any new write carrying `actor_user_id === "local-user"` once ANY of the following is true:

- A sync grant exists for any document or matter.
- `external_ocr_authorized` is true for any matter.
- `llm_extraction_opt_in` is true for any matter AND `llm_extraction_grant` exists for any document.
- A multi-user phase flag is set (future).

Refusal is a typed `CaseBoxLocalUserSentinelNotAllowedError`. Detected via `isLocalOnlyActor()` from the contract.

### 5.3 No machine auto-accept (Step 2 + Step 8)

- `assertValidNewFact` is called before every `appendFactCandidate` insert.
- Persistence MUST refuse any direct write of a non-`candidate` status from a non-`lawyer_authored` source.
- Step 8 reaffirms this for LLM outputs; same gate applies to deadlines and privilege markers when those entities are LLM-extractable in a future WI.

### 5.4 External handling gate (Step 5 obligation 5; Step 8 obligation 1)

Before invoking any external action (external OCR, sync transmit, LLM extraction), persistence MUST call `assertExternalHandlingAllowed` and honor `decision.allowed === true` as a hard precondition. The check happens inside the same transaction as the audit event recording the action.

For LLM extraction (Step 8): persistence MUST NOT enable any extraction call unless ALL Step-8 §5 conditions hold (matter `confidentiality_class === "normal"`, target effective classification `=== "normal"`, `PrivilegeReviewState === "reviewed_no_privilege_applies"`, both opt-ins, real principal, no revocation).

### 5.5 Privilege marker invariants (Step 3 obligations 1-6)

- `assertValidNewPrivilegeMarker` before every insert.
- Uniqueness `(tenant_id, matter_id, target_type, target_id, kind)` for `confirmed` rows.
- Target-row tenant/matter consistency.
- Post-waiver markers are separate rows.
- `assertPrivilegeMarkerTimestamps` after lifecycle updates; reject non-monotonic.
- Step-2 supersession-graph cycle detection NOT weakened.

### 5.6 Deadline materialization mapping (Step 6 obligations 5-11)

- Mode B preallocates `CaseBoxDeadline.id` ULID before docket update.
- Atomic commit of docket-entry update + deadline insert (or atomic rollback).
- Idempotent re-runs detected before any audit emission.
- `confirmed_deadline_id` unique index.
- `assertValidDocketEntryConfirmation` for Mode B (which forbids `date_only`).
- `assertValidIanaTimezone` for any non-null timezone insert/update.
- NO raw `CaseBoxDeadline` insertion API.

### 5.7 Audit chain integrity (Step 4 obligations 1-9)

- Append-only on audit rows (REJECT UPDATE / DELETE).
- Builder-only emission via `buildCaseBoxAuditEvent`.
- Timestamps via `new Date().toISOString()`.
- `prev_event_hash = sha256(canonicalAuditEventHashInput(previousEvent))`; pinned SHA-256 hex lowercase 64 chars.
- `verifyAuditChain` at every audit / privilege-log export; head-anchor capture per export.
- Entity-type vocabulary restricted to `CASE_BOX_AUDIT_ENTITY_TYPES`.
- `additionalProperties: false` enforced.
- Reason equality (D1.5): when an audit event row's `reason` is required and the source entity carries its own reason field, MUST assert audit `reason === entity.<corresponding>_reason`.

### 5.8 Confidentiality append-only + downgrade reason (Step 5 obligations 1, 7, 9, 10)

- No UPDATE on classification rows.
- `change_reason_code` non-null on downgrades / resets; `"other"` requires non-empty `change_reason_text`.
- Audit `reason === change_reason_code` for downgrades / resets.
- No auto-creation of `normal` rows.
- Reject `target_type === "matter"`.

### 5.9 OCR subordination (Step 0 + Step 1 contract)

- `CaseBoxOcrLink.direction === "read-only"` enforced at write boundary via `assertCaseBoxIsSubordinateToOcr`.
- Persistence MUST NOT call any write method on `ocr-persistence`. The dependency direction is one-way; case-box-persistence's package.json depends on `ocr-worker-contract` (vocabulary only) and MAY depend on `ocr-persistence` as a dev/peer dependency only for READ.

---

## 6. Transaction model

### 6.1 Atomicity boundary

- One transaction = one write API call = one domain row + one audit row (or atomic multi-row for Mode B docket confirmation).
- SQLite implementation uses `BEGIN IMMEDIATE` (mirrors `services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts` — including the LOC-01 sibling-module pattern).
- In-memory implementation uses a single-call critical section; structuredClone'd read views are produced after commit.

### 6.2 Replay-safe writers (idempotency keys)

For at-least-once paths (queue-driven, future LLM-driven), persistence offers `*Once` variants. Each `Once` method:

1. Looks up the dedupe key `(tenant_id, matter_id, kind, idempotency_key_derived_from_canonical_payload)`.
2. If a row matches canonically (deepEquals on the canonical projection), return the stored row as a no-op (no audit emission, no duplicate).
3. If no match, execute the strict path which naturally rejects conflicting duplicates.
4. The canonical projection MUST exclude store-assigned fields (`persisted_at`, `id` if persistence-allocated) so equality is content-based.

Pattern follows OCR's `saveOcrResultOnce` and `appendOcrStatusOnce`.

### 6.3 Append-only audit + hash-chain head

- Audit events table has no UPDATE / DELETE triggers; persistence layer rejects both attempts.
- A `audit_chain_heads` control table (SQLite) or `Map<matter_id, headHash>` (in-memory) keeps the current head per matter for O(1) reads. The head is updated in the same transaction as the audit row insert.
- `verifyAuditChainForMatter` re-derives the head from scratch; on mismatch, raises a typed `CaseBoxAuditChainCorruptError`.

### 6.4 Rollback semantics

- SQLite: native transaction rollback on any throw inside `db.transaction(...).immediate()` (proven pattern from OCR persistence).
- In-memory: every write API computes the next state on side-of-the-Map, commits all maps in a single synchronous block at the end. Throws revert nothing automatically — the in-memory impl applies changes only after all validations succeed.

### 6.5 No cross-package transactions

- Case-box-persistence MUST NOT open a transaction that spans OCR persistence. The read of OCR job state is a snapshot operation, not part of any case-box transaction.

---

## 7. Native module / ABI baseline

**This plan does NOT silently ignore the ABI baseline.** The existing `services/ocr-persistence` test suite shows `ERR_DLOPEN_FAILED` against `better-sqlite3` (compiled for NODE_MODULE_VERSION 127; current Node 24 requires 137). Adding a second package with the same dependency would inherit the same failure.

### 7.1 Three options

| Option | What it does | Cost | Risk |
|---|---|---|---|
| **A. ABI-first remediation WI** | Rebuild better-sqlite3 across both packages before any case-box-persistence work. Run `npm rebuild better-sqlite3` or pin a compatible version range; verify both OCR + case-box-persistence sqlite suites can run. | ~1 small WI before case-box-persistence Phase B. | Lowest. |
| **B. In-memory first; SQLite gated** | Implement Phase A (in-memory + conformance harness) without ABI work. SQLite implementation lands only AFTER option A completes. | Lets case-box-persistence design + conformance contract land now without blocking on ABI. | Moderate — defers the eventual SQLite work but keeps Phase A unblocked. |
| **C. Ignore ABI; ship Sqlite tests in known-broken state** | Match OCR's current posture: Sqlite conformance fails with `ERR_DLOPEN_FAILED` until rebuild. | Cheapest; matches existing baseline. | High. New package launches into a broken-test posture. Future contributors lose ability to discriminate refactor regressions from ABI failures. |

### 7.2 Recommendation: **Option B — in-memory first, SQLite gated.**

Rationale:

- Phase A delivers the conformance contract + invariant tests using only TypeScript + node:test. No native module needed.
- The conformance harness becomes the de-facto specification for the persistence boundary. Once SQLite lands (Phase B), it must pass the same suite the in-memory impl already passes.
- Decouples ABI repair from feature work. The ABI remediation WI can land independently — possibly bundled with the next OCR-persistence touch.
- Avoids Option C's "broken on launch" anti-pattern. New tests start green.
- Defers Option A only marginally; the rebuild is a small WI that can be scheduled separately when convenient.

### 7.3 Phase A explicit non-deps

The in-memory implementation MUST NOT:

- Import `better-sqlite3` even transitively.
- Add `better-sqlite3` to `package.json`'s `dependencies` or `devDependencies` (it can be deferred to Phase B's package.json change).
- Require any node-gyp or build-from-source step.

This keeps Phase A installable and testable on any Node ≥22 environment without rebuild discipline.

### 7.4 ABI remediation WI shape (sketch only; not authorized here)

- Run `npm rebuild better-sqlite3` in `services/ocr-persistence/` and verify Sqlite conformance suite goes green for OCR persistence.
- Bump `better-sqlite3` to a version range that explicitly supports Node ≥22 (or accept the current version with the rebuild as a one-time fix).
- If Node version itself is at fault (current local Node 24 vs the 22 listed in OCR persistence engines), document the supported range or repin engines.
- Add a CI step that runs `node -e 'require("better-sqlite3")'` before the test target as an ABI smoke test. Failing fast is preferable to opaque `ERR_DLOPEN_FAILED` in one test file out of dozens.
- That WI authors its own plan; this plan only flags the dependency.

---

## 8. Test strategy

### 8.1 Three layers

1. **Conformance** (`tests/conformance/runCaseBoxPersistenceConformance.mjs`): the shared contract. One file describes the full behavior matrix. Both impls execute it via `tests/inMemory.conformance.test.mjs` (Phase A) and `tests/sqlite.conformance.test.mjs` (Phase B+).
2. **Invariants** (`tests/invariants.test.mjs`): cross-entity invariants not naturally expressed in conformance — e.g. supersession-graph cycle rejection on a synthetic 5-fact chain; `local-user` sentinel refusal under each precondition; audit chain replay against a tampered DB.
3. **Hardening** (Phase B; `tests/sqlite.hardening.test.mjs`): SQLite-specific concerns — WAL mode, busy_timeout, FK pragmas, replay safety under crash injection. Mirrors `services/ocr-persistence/tests/sqlite.hardening.test.mjs`.

### 8.2 Conformance matrix outline

| Section | Cases |
|---|---|
| Matter | create / archive / unarchive / duplicate-id reject / cross-tenant reject |
| Document | register / status transitions / OCR link write-once / `content_hash` immutability |
| Fact | candidate insert (lawyer/llm/import/ocr-excerpt); review; accept; reject; supersedes self-cycle reject; multi-hop cycle reject; reason equality |
| Privilege marker | propose / confirm / dismiss / waive; uniqueness for confirmed; basis preservation; reason invariants; non-monotonic timestamp reject |
| Docket entry + deadline | propose / confirm Mode B atomic; idempotent re-confirm no-op; date_only confirm reject; dismiss with reason equality; deadline status transitions; withdraw |
| Evidence | propose / accept / reject / supersede chain |
| Classification | first set; upgrade; downgrade with reason; reset to unclassified; target_type matter reject; latest-wins ordering |
| Audit chain | head tracking; verify on export; tampered-row detection; export captures head |
| Replay-safe `Once` | exact replay returns same row; conflicting payload throws specific error; canonical equality excludes store-assigned fields |
| External handling gate | classification + privilege + opt-in combinations exhaustively per Step 5 + 8 §5 |
| Local-user gate | refusal under each Step-7 precondition |

### 8.3 No external dependencies in tests

- No network.
- No real LLM call (no LLM at all).
- No external cloud.
- No auth provider.
- No UI.
- No real OCR worker.

### 8.4 ABI baseline handling

- Phase A's `tests/inMemory.conformance.test.mjs` MUST pass cleanly on the current host without rebuild.
- Phase B's `tests/sqlite.conformance.test.mjs` MUST run only after Option A (ABI remediation) lands or be explicitly gated behind an env check that skips with an explanatory message (mirroring how OCR persistence currently surfaces `ERR_DLOPEN_FAILED`). Recommendation: do not ship Phase B until ABI is resolved.

### 8.5 AGENTS.md update

When Phase A lands, AGENTS.md test-commands list gains:

```
npm --prefix services/case-box-persistence test
```

Phase B does not require a new line — same command runs both impls' conformance.

---

## 9. Out of scope (deliberately deferred)

- API / gateway exposure of any case-box-persistence method. (CLIENT-04+ or SYNC-02+ when those WIs ship.)
- UI surfaces. (CLIENT-03+.)
- Electron / Tauri choice. (CLIENT-01 Stop-and-Ask.)
- Sync bridge persistence (grant tables). (SYNC-01.)
- Auth provider. (Step 7 / AUTH gate.)
- Cloud vendor. (SYNC-05+.)
- LLM execution. (Step 8 future implementation gate.)
- Cross-matter analytics. (Multi-firm not v1.)
- Per-document encryption at rest. (Step-0 §"Open questions" — FileVault for v1.)
- Migration tooling. (No v0 → v1 migration; first real case loaded establishes the baseline.)
- `case-box-ingestion` / `case-box-review` packages. (Subsequent WIs after Phase A.)

---

## 10. Risk + sequencing

### 10.1 Smallest safe slice

Phase A1 (in-memory matter + document + audit chain). Concrete sub-scope:

- Package scaffold (`services/case-box-persistence/{package.json, tsconfig.json, src/types.ts, src/index.ts}`).
- `CaseBoxPersistenceError` + error code enum.
- `InMemoryCaseBoxPersistence` implementing only: `createMatter`, `getMatter`, `archiveMatter`, `registerDocument`, `getDocument`, `listDocuments`, plus internal audit emission via `buildCaseBoxAuditEvent` and head-hash tracking.
- Conformance test fixture covering those 6 methods + 1 invariant test (`tenant_id` mismatch reject) + 1 audit-chain test (head changes on every write).
- No SQLite. No facts. No docket entries. No privilege. No classification. No external handling.

Phase A1 is the smallest deliverable that proves the package shape works. Subsequent phases (A2…A9) add entity types one at a time, each with conformance cases first.

### 10.2 Phase ladder

| Phase | Adds | Risk |
|---|---|---|
| A1 | Scaffold + matter + document + audit chain head | Low — pure TS. |
| A2 | Confidentiality classification (Step 5) | Low — append-only. |
| A3 | Privilege marker (Step 3) | Low — single-table. |
| A4 | Fact (Step 2) — including supersession-graph cycle detection | Medium — multi-hop cycle algorithm. |
| A5 | Docket entry + deadline materialization (Step 6) | Medium-high — Mode B atomicity. Most subtle invariant. |
| A6 | Evidence item | Low. |
| A7 | OCR link (read-only mirror) | Low — no FK to ocr-persistence; value-only ref. |
| A8 | Read-side aggregations (matter summary, calendars, queues) | Low. |
| A9 | Replay-safe `*Once` variants | Medium. |
| **GATE** | ABI remediation WI (separate authorization) | — |
| B1+ | SQLite implementation per entity, in same order; reuses conformance | Medium per phase; LOC-01-style sibling-module extraction from the start to avoid the 956-LOC trap. |

Each Phase A* is an authorization gate. The user authorizes A1 first, then A2 only after A1 lands cleanly, etc.

### 10.3 Risks (with mitigation)

| Risk | Mitigation |
|---|---|
| ABI breakage propagates to a second package | Phase A excludes `better-sqlite3` entirely. Phase B gated on remediation WI. |
| Supersession cycle algorithm is wrong → accepts a cycle | Conformance includes explicit 3-, 5-, and 10-hop cycle fixtures; a fuzz-style random graph generator can be added in A4 as a stretch goal. |
| Docket Mode B atomicity broken in in-memory impl | Conformance covers idempotent re-confirm. In-memory uses single-call critical section so partial state is impossible by construction. |
| Audit chain hash drift between contract helper and persistence | Use `canonicalAuditEventHashInput` from `case-box-contract/src/audit-log.ts` verbatim; never re-implement the canonicalization. Conformance: build N events with the contract helper, persist them, re-derive head locally, compare. |
| Persistence error vocabulary drifts from OCR's | `CaseBoxPersistenceError` is a NEW class (parallel to `OcrPersistenceError`), distinct identity. v1 ships with a string `message` field matching the OCR pattern; an explicit `code` discriminator is OPTIONAL for v1 and may be added in a later phase if conformance tests require precise discrimination. Conformance asserts message-substring stability for the load-bearing errors (tenant mismatch, local-user sentinel, duplicate-id, illegal transition, audit chain corruption). |
| Reason-equality enforcement gaps | Per Step 4 obligation 9: every write API that produces an audit with a `reason` field MUST be conformance-tested for equality with the source entity's reason field. |
| `local-user` sentinel false-positive (refuses when it should allow) | Phase A1 ships without any precondition checks (no sync grant exists yet by definition). The gate kicks in only after A6 (when matters can carry `sync_grant_present`) — add the precondition table at that phase, conformance-tested against each Step-7 trigger. |

### 10.4 Stop-and-ask gates inside this plan

This plan does NOT trigger any of the user's selection-rule hard-stops:

- ✅ No persistence/database introduction *implementation* — we plan it; we don't write it.
- ✅ No Electron/Tauri.
- ✅ No API/gateway.
- ✅ No auth provider choice.
- ✅ No cloud/sync.
- ✅ No external document exposure.
- ✅ No public API break.

The plan-output WI is fully docs-only. Subsequent phases (A1 implementation) are SEPARATE authorization turns. Each Phase A* introducing persistence implementation is itself a Stop-and-Ask under selection rule 2 ("introduce persistence/database"), to be authorized one phase at a time.

---

## 11. Acceptance for the plan WI

- File `dev-memo/plan-case-box-persistence-00.md` exists with §§1-10.
- Plan is self-consistent with Step 0-8 ADRs (cross-refs verified by spot-grep).
- Plan does NOT modify any code, schema, package.json, or test.
- Plan does NOT add a runtime dependency.
- Plan explicitly addresses the ABI baseline (§7).
- Plan names the smallest safe slice (§10.1) for the next authorization gate.
- AGENTS.md / `docs/release/go-live-plan.md` are NOT modified by this plan WI (Phase A1 will add the test command line).

## 12. References

- `docs/adr/case-box-step-0-boundary.md` — boundary, dependency direction, opt-in flags.
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` — fact lifecycle, `assertValidNewFact`, supersession.
- `docs/adr/case-box-step-3-privilege-marker-model.md` — privilege marker model + obligations.
- `docs/adr/case-box-step-4-audit-log-shape.md` — hash chain, builder-only emission, append-only.
- `docs/adr/case-box-step-5-confidentiality-classification.md` — `assertExternalHandlingAllowed`, append-only history.
- `docs/adr/case-box-step-6-deadline-docketing-rules.md` — Mode B docket → deadline materialization.
- `docs/adr/case-box-step-7-multi-user-readiness.md` — `local-user` gate.
- `docs/adr/case-box-step-8-llm-extractor-policy.md` — LLM eligibility resolver invocation + revocation honoring.
- `docs/contracts/case-box-contract/src/index.ts` — validators, transitions, invariants, errors.
- `docs/contracts/case-box-contract/src/audit-log.ts` — `buildCaseBoxAuditEvent`, `canonicalAuditEventHashInput`, `verifyAuditChain`.
- `services/ocr-persistence/src/types.ts` — OcrPersistence interface (shape reference).
- `services/ocr-persistence/src/inMemoryRepo.ts` — InMemoryOcrPersistence pattern (shape reference).
- `services/ocr-persistence/src/sqlite/*` — LOC-01 sibling-module pattern (will reuse the same extraction discipline from the start).
- `services/ocr-persistence/tests/conformance/runOcrPersistenceConformance.mjs` — conformance harness pattern.
- `docs/product/product-target-architecture.md` — v1 product shape; local-first invariants.
- `AGENTS.md` — Stop-and-Ask gates; per-package test commands.
- `.claude/rules/loc-guardian.md` — LOC fail/warn discipline (SQLite phase will start with extraction-first, never grow a single file).
