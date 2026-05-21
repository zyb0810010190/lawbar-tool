# CASE-BOX-PERSISTENCE Phase A7 — OCR Links (bounded plan)

**Status**: round-2 plan after r1 review. Round-1 verdict NEEDS REVISION (1 High + 6 Mediums + Lows); revisions applied.

## Review history

- 2026-05-21 round 1 — Path 1 full packet, first try. Job `review-plan-mpfn58u9-cheg6r`. Verdict **NEEDS REVISION**. Revisions applied (this version):
  - **H Dim 4 #1 (identical-snapshot upsert semantics undefined)**. **FIX**: A byte-identical second upsert is a NO-OP — returns `{ created: false, link: prior }` and emits NO audit event. Only a CHANGED snapshot emits OCR_LINK_REFRESHED. Test §6.A7.1b pins. Detect identity by JSON-equality of the inbound link vs the stored row (excluding fields that are identical by definition like `document_id`).
  - **M Dim 1 #4 (getOcrLink scope/error inconsistency)**. **FIX**: scoped error model pinned: unknown matter → `null`; unknown document → `null`; cross-matter scope (matter exists but document.matter_id !== query.matter_id) → `null`; same-matter cross-tenant (matter.tenant_id !== query.tenant_id) → throws `tenant_mismatch`. Matches A4/A6's `getFact` / `getEvidenceItem` pattern.
  - **M Dim 2 #1 (missing tests)**. **FIX**: added §6.A7.1b (identical replay no-op), §6.A7.15b (cursor wrong-kind), §6.A7.15c (limit bounds).
  - **M Dim 2 #3 (list algorithm not specified)**. **FIX**: §1.2 method 3 now pins: resolve matter scope → look up `linksByMatter.get(matter_id)` Set → hydrate via `linksByDocumentId.get(document_id)` → filter status_snapshot → sort → paginate. Does NOT scan all links.
  - **M Dim 3 #1 (LOC margin optimistic)**. **FIX**: §1.3 already had hard gate; tightened — if post-extraction `inMemoryRepo.ts > 660`, extract more before adding A7 delegates. New target: <660 post-extraction (was <670). Margin of ~40 LOC vs the 700 hard target.
  - **M Dim 3 #2 (commit helper signatures non-uniform)**. **FIX**: §2 file table now lists each commit helper's exact signature per entity. classification helper takes `state.classification + state.auditByMatter + prepared`; privilege takes `state.privilege + state.auditByMatter + prepared`; etc. No abstract `prepared` type across entities.
  - **M Dim 4 #2 (cross-matter upsert rejection N/A)**. **FIX**: removed §6.A7.5 from matrix. Upsert doesn't take matter_id; cross-matter rejection happens only at `getOcrLink` and `listOcrLinks` paths.
  - **M Dim 5 #1 (combined extraction + A7 noisy diff)**. **NOT FIXED in plan structure** — user spec mandates single A7 commit ("commit only A7 files; commit message: feat: case-box-persistence Phase A7 — OCR links"). Risk accepted; reviewer can audit the extraction-vs-A7 portions separately by sub-section. Doc-only mitigation: §1.1 explicitly labels the 7 extractions as MECHANICAL and conditions A7 delegate addition on a CLEAN A1-A6 conformance run AFTER extraction.

**Status**: ready for round-2 `/cc-suite:review-plan`.
**Date**: 2026-05-21.
**Parent plan**: `dev-memo/plan-case-box-persistence-00.md` §10.2 row A7 ("OCR link (read-only mirror) — Low — no FK to ocr-persistence; value-only ref.").
**Built on**: A6 (commit `fc52749`).

A7 carries a **mandatory LOC pre-extraction step** because `inMemoryRepo.ts` is currently at **797 pure LOC**, only 3 below the 800 fail threshold. The user's spec requires post-A7 inMemoryRepo.ts to be **below 700 pure LOC**, not merely below 800 — substantially more aggressive than A6's "stay under 800" gate.

---

## Review packet (compact)

### Active plan summary

Phase A7 implements `CaseBoxOcrLink` storage: a read-only mirror of OCR job status per document. 3 new methods: `upsertOcrLink(input)` (creates or refreshes the snapshot for a document_id), `getOcrLink(query)` (scoped read), `listOcrLinks(query)` (paginated per matter). Public surface 32 → 35. OCR is a subordinate data feed (Step 0 ADR §4 line 120): `ocr_job_id` is opaque, no FK to ocr-persistence, no writes to ocr-persistence ever. `direction === "read-only"` is contract-enforced via `assertCaseBoxIsSubordinateToOcr` helper.

**Mandatory pre-extraction**: 7 extractions to bring inMemoryRepo.ts from 797 to under 670 pure LOC. 2 read-side method bodies (`getEffectiveClassification`, `getPrivilegeStatus`) move to their entity siblings as full helpers. 5 append-side delegate commit steps (classification, privilege, fact, docket, evidence) collapse via per-sibling `commitAppendX(state, prepared)` helpers that perform the WeakMap mutation atomically. After extraction + A7 (3 thin delegates): projected ~660 pure LOC.

### Exact target files

**Pre-extraction (Step 0):**
- `services/case-box-persistence/src/inMemoryClassification.ts` — add `getEffectiveClassificationHelper(state: ClassificationState, matters: Map<string, CaseBoxMatter>, documents: Map<string, {document: CaseBoxDocument; matter_id: string}>, query: GetEffectiveClassificationQuery): EffectiveClassificationResult` + `commitAppendClassification(state: ClassificationState, auditByMatter: Map<string, StoredAuditEvent[]>, prepared: PrepareAppendClassificationResult): void`.
- `services/case-box-persistence/src/inMemoryPrivilege.ts` — add `getPrivilegeStatusHelper(state: PrivilegeState, matters, documents, query: GetPrivilegeStatusQuery): PrivilegeResolution` + `commitAppendPrivilegeMarker(state: PrivilegeState, auditByMatter, prepared: PrepareAppendPrivilegeMarkerResult): void`.
- `services/case-box-persistence/src/inMemoryFact.ts` — add `commitAppendFact(state: FactState, auditByMatter, prepared: PrepareAppendFactResult): void`.
- `services/case-box-persistence/src/inMemoryDocket.ts` — add `commitAppendDocketEntry(state: DocketState, auditByMatter, prepared: PrepareAppendDocketEntryResult): void`.
- `services/case-box-persistence/src/inMemoryEvidence.ts` — add `commitAppendEvidenceItem(state: EvidenceState, auditByMatter, prepared: PrepareAppendEvidenceItemResult): void`.
- `services/case-box-persistence/src/inMemoryRepo.ts` — replace bodies with thin delegate calls.

**A7 additions:**
- `services/case-box-persistence/src/inMemoryOcrLink.ts` — NEW sibling. Holds OCR-link storage + `prepareUpsertOcrLink`, `getOcrLinkHelper`, `listOcrLinks`.
- `services/case-box-persistence/src/inMemoryRepo.ts` — add 3 thin delegates + 1 state slot.
- `services/case-box-persistence/src/cursor.ts` — add cursor kind `ocr_links_by_matter`.
- `services/case-box-persistence/src/types.ts` — add 3 interface methods + types.
- `services/case-box-persistence/src/index.ts` — re-exports.
- `services/case-box-persistence/tests/conformance/fixtures.mjs` — add `makeOcrLinkInput`.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — add ~18 conformance cases.
- `services/case-box-persistence/tests/invariants.test.mjs` — §6.2.7 allowlist bumps to 35.

### Exact acceptance criteria

1. `npm --prefix services/case-box-persistence test` exits 0 (201 from A1-A6 + ~18 A7 ≈ 219 total).
2. `npm --prefix docs/contracts/case-box-contract test` still 322/322.
3. `npm --prefix docs/contracts test` (OCR) still 102/102.
4. loc-guardian: 0 over fail. **`inMemoryRepo.ts` < 700 pure LOC** (not just < 800).
5. Public surface = 35; §6.2.7 allowlist matches.
6. No new `CaseBoxPersistenceError` code; A7 reuses the 10 documented codes.
7. Audit chain valid spanning A1-A7.
8. cc-suite audit + verify via Path 1; retrievable.
9. Pre-extraction preserves A1-A6 behavior — full 201-case run UNCHANGED before A7 added.
10. OCR-link subordination invariant preserved: `direction === "read-only"` enforced via contract helper at upsert.

### Exact out-of-scope list

- No SQLite / native module / API / UI / sync / cloud / auth / LLM / OCR-package import / external network / schema change / contract edit / dependency change / ADR-or-release edit / .claude/** edit / push.
- No FK from case-box-persistence to ocr-persistence (Step 0 ADR §4 line 119-120 — `ocr_job_id` is opaque value).
- No fetching from ocr-persistence (the snapshot is supplied BY the caller, who polls separately).
- No write-back to ocr-persistence (subordination invariant).
- No "delete OCR link" API (snapshots are append/refresh only; if a document is deleted, the link goes with it, but case-box doesn't delete documents in this WI).

### Essential ADR references

- `dev-memo/plan-case-box-persistence-00.md` — §10.2 row A7 ("Low risk").
- `docs/adr/case-box-step-0-boundary.md` — §4 (OCR subordination, by-value references, no FK).
- `docs/contracts/case-box-contract/src/validateOcrLink.ts` — `validateOcrLink` + `assertCaseBoxIsSubordinateToOcr`.
- `docs/contracts/case-box-contract/src/audit-log.ts` — `OCR_LINK_SNAPSHOTTED` (:78 create) + `OCR_LINK_REFRESHED` (:79 update).
- `docs/contracts/case-box-contract/schemas/case-box-ocr-link.schema.json` — entity shape; required fields; `direction: "read-only"` const.

### Review questions (targeted)

1. **Pre-extraction risk**: 7 mechanical extractions before A7. Is the ordering (run A1-A6 conformance after extraction, BEFORE adding A7) sound? Any extraction that could change behavior?
2. **Upsert semantics**: row key is `document_id` (no separate `id`). `upsertOcrLink` creates on first call, refreshes on subsequent. Is the audit-kind selection coherent (SNAPSHOTTED on create, REFRESHED on update)? Should refresh's `before_state_hash` be the prior link's hash?
3. **Subordination invariant**: `assertCaseBoxIsSubordinateToOcr` runs at upsert. Is that the right boundary? Should the helper also fire on read paths?
4. **Document scope**: every OCR link belongs to a document. Tenant/matter consistency goes through the document, not the matter directly. Use shared `resolveDocumentTarget`?
5. **listOcrLinks ordering**: by `last_seen_at DESC, document_id ASC`, or `document_id ASC`? Pick one and pin.

---

## 1. Scope

### 1.1 LOC pre-extraction (Step 0, MANDATORY)

`inMemoryRepo.ts` is **797 pure LOC** entering A7. The user's target is **<700 post-A7**. Working backwards: A7 adds 3 delegates × ~10 LOC = ~30 LOC. Need post-extraction inMemoryRepo.ts ≤ 660 (tightened from 670 per round-1 M Dim 3 #1; safety margin ~40 LOC).

**Extraction plan**:

| Target | Method | Reduction |
|---|---|---|
| `inMemoryClassification.ts` | `getEffectiveClassification` body (~35 LOC inline tenant/matter/doc resolve + delegate) → helper | -28 LOC |
| `inMemoryPrivilege.ts` | `getPrivilegeStatus` body (~35 LOC) → helper | -28 LOC |
| `inMemoryClassification.ts` | `appendConfidentialityClassification` commit step (~20 LOC of state mutation) → `commitAppendClassification` helper | -15 LOC |
| `inMemoryPrivilege.ts` | `appendPrivilegeMarker` commit step → `commitAppendPrivilegeMarker` | -15 LOC |
| `inMemoryFact.ts` | `appendFact` commit step → `commitAppendFact` | -20 LOC |
| `inMemoryDocket.ts` | `appendDocketEntry` commit step → `commitAppendDocketEntry` | -20 LOC |
| `inMemoryEvidence.ts` | `appendEvidenceItem` commit step → `commitAppendEvidenceItem` | -20 LOC |
| **Total** | | **~-146 LOC** |

Projected: 797 - 146 = **~651 pure LOC** after extraction. Add A7's 3 delegates (~30 LOC): **~681 final**. Under 700 ✓ with ~19 LOC of safety margin.

**Hard gate (round-1 M Dim 3 #1 fix — tightened from 670 to 660)**: re-run `/loc-guardian:scan` after extraction; if `inMemoryRepo.ts > 660`, extract more before adding A7 delegates. Tighter ceiling leaves ~40 LOC of margin against the 700 hard target.

Extraction discipline:
- Each extraction is MECHANICAL: the moved code preserves exact behavior (order of validation, error codes, audit field bindings, return shapes).
- A1-A6 conformance MUST pass UNCHANGED after extraction, BEFORE A7 code is added.
- The append-commit helpers take the state slot + the appropriate per-entity Map/Set indexes + the prepared `{row, audit, matterId}` result and apply: `arr.push`, `ids.add`, `index.set`, `byMatter.set`, `audit append`. Each helper is ~15-20 LOC and replaces ~30-40 LOC of inline boilerplate.

### 1.2 Functional scope — 3 new public methods (32 → 35)

1. **`upsertOcrLink(input: unknown): Promise<{ link: CaseBoxOcrLink; created: boolean }>`**
   - `validateOcrLink(input)` — failure → `invalid_payload`.
   - `assertCaseBoxIsSubordinateToOcr(input)` — failure → `invalid_payload`. (Defensive — schema's `const: "read-only"` should have already caught this.)
   - Tenant consistency via the document target (use shared `resolveDocumentTarget` with `tenant_id = link.tenant_id`, `target_id = link.document_id`, and `matter_id` resolved from the document itself — the link doesn't carry matter_id, so we pass the document's `matter_id` to keep the helper's contract). Practically: load the document by `link.document_id`; reject unknown_document; if `document.tenant_id !== link.tenant_id`, reject `tenant_mismatch`. The link binds to the document's matter implicitly.
   - **Upsert semantics with idempotency (round-1 H Dim 4 #1 fix)**: row key is `document_id`. Look up `ocrLinksByDocumentId.get(link.document_id)`:
     - If present AND byte-identical to the inbound link (deep-equal): **NO-OP**. Emit NO audit event. Return `{ link: prior, created: false }`.
     - If present AND different fields: **REFRESH**. Replace row with the inbound snapshot verbatim. Emit `OCR_LINK_REFRESHED` (action: update; `before_state_hash = entityStateHash(prior)`; `after_state_hash = entityStateHash(next)`). Return `{ link: next, created: false }`.
     - Otherwise: **CREATE**. Insert row. Emit `OCR_LINK_SNAPSHOTTED` (action: create; `before_state_hash = null`). Return `{ link, created: true }`.
   - Audit event field bindings: `entity_id = link.document_id` (the row's key); `matter_id` = the document's matter_id (looked up via the document target — link itself doesn't carry matter_id); `tenant_id = link.tenant_id`; `actor_user_id = link.actor_user_id`; `timestamp = #nowIso()`.
   - Atomic single-step commit.

2. **`getOcrLink(query: GetOcrLinkQuery): Promise<CaseBoxOcrLink | null>`**
   - `query = { tenant_id, matter_id, document_id }` — scoped per the A4 F5.1 lesson.
   - **Scoped error model (round-1 M Dim 1 #4 fix)**: matches A4 `getFact` / A6 `getEvidenceItem` pattern.
     - Unknown matter → `null` (do not leak existence).
     - Same-matter cross-tenant (matter exists but matter.tenant_id !== query.tenant_id) → throws `tenant_mismatch`.
     - Unknown document → `null`.
     - Cross-matter document (document exists but document.matter_id !== query.matter_id) → `null`.
     - No link snapshot exists for the (document, matter) → `null`.
     - Otherwise: return cloned snapshot.

3. **`listOcrLinks(query: ListOcrLinksQuery): Promise<ListOcrLinksPage>`**
   - `query = { tenant_id, matter_id, status_snapshot?, cursor?, limit? }`.
   - **List algorithm (round-1 M Dim 2 #3 fix)**: resolve matter (rejects unknown_matter / tenant_mismatch); look up `linksByMatter.get(matter_id)` Set of document_ids; for each document_id in that Set, hydrate via `linksByDocumentId.get(document_id)`; apply optional `status_snapshot` filter; sort by `last_seen_at DESC, document_id ASC`; paginate. Does NOT scan all links across all matters.
   - Cursor kind `ocr_links_by_matter`; tuple `[last_seen_at:string, document_id:string]`.
   - Seek predicate: `last_seen_at < tLast || (last_seen_at === tLast && document_id > tDocId)` (descending primary, ascending tiebreak).

### 1.3 LOC budget plan

| Stage | inMemoryRepo.ts |
|---|---|
| Current (post-A6) | 797 |
| After Step 0 pre-extraction (-146) | ~651 |
| After A7 delegates (+30) | ~681 |
| Target ceiling | <700 |
| Fail ceiling | 800 |

**Hard gate after Step 0**: if `inMemoryRepo.ts > 660`, STOP and extract more before adding A7 delegates (consistent with §1.1 tightened ceiling).

### 1.4 Internal state additions

- `state.ocrLink: OcrLinkState = { linksByDocumentId: Map<documentId, CaseBoxOcrLink>; linksByMatter: Map<matterId, Set<documentId>> }`.
- Two indexes because:
  - `linksByDocumentId`: O(1) upsert lookup (row key).
  - `linksByMatter`: O(matter-link-count) listing without scanning all documents in the database.

---

## 2. Files expected to be added or modified

| Path | Action | Substance |
|---|---|---|
| `services/case-box-persistence/src/inMemoryOcrLink.ts` | **NEW** | Upsert + read helpers. Exports `createOcrLinkState`, `prepareUpsertOcrLink`, `getOcrLinkHelper`, `listOcrLinks`. |
| `services/case-box-persistence/src/inMemoryClassification.ts` | modified | Add `getEffectiveClassificationHelper` + `commitAppendClassification` helpers; mechanical move from inMemoryRepo. |
| `services/case-box-persistence/src/inMemoryPrivilege.ts` | modified | Add `getPrivilegeStatusHelper` + `commitAppendPrivilegeMarker` helpers. |
| `services/case-box-persistence/src/inMemoryFact.ts` | modified | Add `commitAppendFact` helper. |
| `services/case-box-persistence/src/inMemoryDocket.ts` | modified | Add `commitAppendDocketEntry` helper. |
| `services/case-box-persistence/src/inMemoryEvidence.ts` | modified | Add `commitAppendEvidenceItem` helper. |
| `services/case-box-persistence/src/inMemoryRepo.ts` | modified | Replace 7 method bodies with thin delegate calls; add 3 A7 delegates + 1 state slot. |
| `services/case-box-persistence/src/cursor.ts` | modified | Add `ocr_links_by_matter` kind. |
| `services/case-box-persistence/src/types.ts` | modified | New interface methods + types; re-export `CaseBoxOcrLink`. |
| `services/case-box-persistence/src/index.ts` | modified | Re-exports. |
| `services/case-box-persistence/tests/conformance/fixtures.mjs` | modified | Add `makeOcrLinkInput`. |
| `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` | modified | Add ~18 conformance cases. |
| `services/case-box-persistence/tests/invariants.test.mjs` | modified | §6.2.7 allowlist bumps to 35. |

---

## 3. Files expected to remain untouched

- `docs/contracts/case-box-contract/**`.
- All other `services/**` packages.
- All ADRs / release docs.
- `.claude/**`.
- Three pre-existing user-deferred dev-memo drafts.
- `dev-memo/deferred-audit-findings.md` — A7 has no expected backlog closures. The A6 F5.1 row stays open.

---

## 4. Invariants from Step 0 OCR boundary + carry-forward

Carried from A1-A6:
- `tenant_id` cross-entity consistency.
- Atomic write discipline.
- Audit emission via `buildCaseBoxAuditEvent` only.
- Per-matter monotonic `sequence`.
- `local-user` sentinel valid.

New for A7 (from Step 0 ADR §4):
1. **OCR is a subordinate data feed** — case-box never writes to ocr-persistence. A7 only stores read-only snapshots supplied by the caller.
2. **References by value only** — `ocr_job_id` is an opaque string; persistence does NOT call into `services/ocr-persistence` or otherwise resolve it.
3. **No FK** — schema-level (case-box has no FK to ocr_jobs table); code-level (case-box-persistence has no import of ocr-persistence; verified by the existing §6.2.1 invariants test).
4. **`direction === "read-only"`** — contract-enforced via schema's `const` AND via `assertCaseBoxIsSubordinateToOcr`. A7 calls the helper defensively at upsert.
5. **Snapshot semantics** — each upsert replaces the entire prior row (no field-level merge). The `last_seen_at` field records when this snapshot was captured.

---

## 5. Out of scope

- All standard exclusions plus: no OCR-package import; no fetch-from-OCR API; no write-back-to-OCR API; no field-level merge (whole-row replace); no delete API.

---

## 6. Tests planned

~18 new conformance + 1 invariants + 1 audit-chain.

### 6.1 Conformance matrix additions

| § | Case | Asserts |
|---|---|---|
| 6.A7.1 | `upsertOcrLink` first snapshot (create) | `{ created: true }`; OCR_LINK_SNAPSHOTTED audit |
| 6.A7.1b | `upsertOcrLink` byte-identical second call (no-op, round-1 H Dim 4 #1 fix) | `{ created: false, link: prior }`; NO new audit event |
| 6.A7.2 | `upsertOcrLink` second call same document_id with changed fields (refresh) | `{ created: false }`; OCR_LINK_REFRESHED audit |
| 6.A7.3 | rejects direction !== "read-only" | `invalid_payload` |
| 6.A7.4 | rejects unknown document_id | `unknown_document` |
| 6.A7.6 | rejects cross-tenant document_id | `tenant_mismatch` |
| 6.A7.7 | rejects schema-invalid link | `invalid_payload` |
| 6.A7.8 | rejects status_snapshot not in enum | `invalid_payload` |
| 6.A7.9 | refresh preserves document_id; replaces other fields | row.last_seen_at updated; row.status_snapshot updated |
| 6.A7.10 | refresh emits OCR_LINK_REFRESHED with `before_state_hash = prior`, `after_state_hash = next` | audit chain valid |
| 6.A7.11 | `getOcrLink` returns null when none exists | null |
| 6.A7.12 | `getOcrLink` returns the row when scoped correctly | row |
| 6.A7.13 | `getOcrLink` cross-matter scope returns null | null |
| 6.A7.14 | `getOcrLink` cross-tenant scope throws tenant_mismatch | tenant_mismatch |
| 6.A7.15 | `listOcrLinks` orders by last_seen_at DESC, document_id ASC | multi-page |
| 6.A7.15b | `listOcrLinks` rejects wrong-kind cursor | `invalid_argument` |
| 6.A7.15c | `listOcrLinks` limit bounds (default + explicit) | page-size respects limit |
| 6.A7.16 | `listOcrLinks` filter by status_snapshot | only matching rows |
| 6.A7.17 | `listOcrLinks` rejects unknown matter | unknown_matter |
| 6.A7.18 | `listOcrLinks` rejects tenant mismatch | tenant_mismatch |

### 6.2 Invariants test additions

- **§6.2.7 prototype allowlist** (modified): expects 35 entries.

### 6.3 Audit chain test additions

- **§6.3.A7.1**: SNAPSHOTTED → REFRESHED chain valid; before/after hashes consistent.

---

## 7. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Pre-extraction regresses A1-A6 behavior | Low | High | Run A1-A6 conformance after extraction, BEFORE A7. STOP and revert if any fails. |
| R2 | LOC overshoots 700 post-A7 | Medium | Medium | Hard gate at §1.3 — STOP and extract more if >670 post-extraction. |
| R3 | Upsert wrongly emits OCR_LINK_SNAPSHOTTED on refresh | Low | High — audit chain corruption | Selector is `linksByDocumentId.has(id)` BEFORE the upsert. Conformance §6.A7.2 + §6.A7.10 pin. |
| R4 | Refresh `before_state_hash` is null instead of prior hash | Low | High | Helper assigns `before_state_hash = isCreate ? null : entityStateHash(prior)`. §6.A7.10 pins. |
| R5 | Cross-tenant document leak | Low | High — tenant isolation breach | `resolveDocumentTarget` runs at upsert + getOcrLink + listOcrLinks's filter path. §6.A7.6 + 14 + 18 pin. |
| R6 | Subordination invariant bypassed | Low | High — write-back to ocr-persistence | `assertCaseBoxIsSubordinateToOcr` runs at upsert defensively. §6.A7.3 pins. |
| R7 | listOcrLinks ordering is per-document-id rather than last_seen_at | Low | Low | Fixed ordering: `last_seen_at DESC, document_id ASC`. Conformance §6.A7.15 explicitly checks ordering. |

---

## 8. Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| 8.1 | All package tests pass (≈219 total) | `npm --prefix services/case-box-persistence test` |
| 8.2 | Sibling contracts pass | spot test runs |
| 8.3 | loc-guardian: 0 over fail; **inMemoryRepo.ts < 700 pure LOC** | `/loc-guardian:scan` |
| 8.4 | Public surface = 35 | invariants §6.2.7 |
| 8.5 | No new error codes | conformance |
| 8.6 | Audit chain valid spanning A1-A7 | §6.3.A7.1 |
| 8.7 | Pre-extraction preserves A1-A6 behavior | A1-A6 cases pass UNCHANGED before A7 added |
| 8.8 | Subordination invariant preserved | §6.A7.3 |
| 8.9 | cc-suite review-plan + audit + verify via Path 1 retrievable | 11 fields recorded |
| 8.10 | Explicit-stage commit; no `git add .`; no push | scoped diff |

---

## 9. Out-of-scope clarifications for the reviewer

Do NOT flag:
- Missing FK to ocr_jobs (Step 0 ADR explicitly forbids).
- Missing fetch-from-OCR API (caller polls; A7 stores).
- Single state index by document_id (the schema has no separate `id`).
- The `linksByMatter` index being a Set<documentId> rather than a Map<id, row> (rows live in `linksByDocumentId`).

Reviewer SHOULD flag:
- Any extraction that subtly changes A1-A6 behavior.
- Any audit-kind misselect on upsert (SNAPSHOTTED vs REFRESHED).
- Any path that writes to or reads from ocr-persistence.
- LOC drift past 700.

---

## 10. cc-suite invocation plan

| Stage | Kind | Path |
|---|---|---|
| Plan review (this file) | `review-plan` | Path 1 full packet → compact on TIMEOUT → Path 2 |
| Pre-extraction + A7 audit | `audit` | Path 1 |
| Post-fix verify | `verify` | Path 1 with explicit audit artifact |

Per `.claude/rules/cc-suite.md` §"Required recording" (11 fields per CCSUITE-02).

---

## 11. References

- `dev-memo/plan-case-box-persistence-00.md` §10.2 row A7.
- `dev-memo/plan-case-box-persistence-A1.md` … `A6.md`.
- `dev-memo/deferred-audit-findings.md` — backlog.
- `docs/adr/case-box-step-0-boundary.md` §4 (OCR subordination invariants).
- `docs/contracts/case-box-contract/src/validateOcrLink.ts`.
- `docs/contracts/case-box-contract/src/audit-log.ts` :78-79.
- `docs/contracts/case-box-contract/schemas/case-box-ocr-link.schema.json`.
- `services/case-box-persistence/src/*` — A1-A6 implementation; A7 extracts + extends.
- `.claude/rules/cc-suite.md` — broker policy.
