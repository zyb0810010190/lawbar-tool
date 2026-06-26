# BATCH-CASEBOX-EVIDENCE-A3-LINK-CREATE-T1-00 (WI-A3-LINK-CREATE-T1 — audited createLink operation)

**Status**: plan for the A0.7-gated `createLink` persistence OPERATION (custody mode 9b). The governed
`dev-memo/run/queue.md` WI-A3-LINK-CREATE-T1 block is the execution authority. **Date**: 2026-06-26.
**Type**: IMPL (case-box-persistence; A0.7-gated; HIGH-RISK — persistence + tamper-evident audit chain).
**Predecessors (all merged to main)**: V11 `case_box_links` + V12 markers; resolver/export marker-awareness;
the `link` entity_type + `LINK_UNLINKED`/`LINK_RELINKED` kinds (#136); the audited `unlinkLink`/`relinkLink`
operations (#137); the link-create design ADR `docs/adr/ADR-evidence-a3-link-create-operation.md` (#138); the
`LINK_CREATED` audit kind (#139).

## Review packet (compact)

1. **Active plan summary.** Implement the headless audited `createLink` operation: insert a durable
   `case_box_links` row (provisional `status='needs_review'`, NULL markers) and emit EXACTLY ONE `LINK_CREATED`
   chain event in the SAME `BEGIN IMMEDIATE`. Concrete-class method on `SqliteCaseBoxPersistence` (SQLite-only;
   not the shared interface; InMemory untouched). Extends `linkRepoQueries.ts` (the unlink/relink file). A0.7-gated,
   custody 9b. Per the merged ADR D1-D10.

2. **Exact target files.**
   - EDIT `services/case-box-persistence/src/sqlite/linkRepoQueries.ts` — add `CreateLinkInput`,
     `prepareCreateLink`, `insertLinkRow`, `applyCreateLinkSqlite`; reuse `linkStateForHash`/`entityStateHash`/
     `priorHeadOf`/`eventHashFn`/`buildCaseBoxAuditEvent`.
   - EDIT `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` — add `createLink(input)` via
     `#runImmediateWrite`.
   - EDIT `services/case-box-persistence/src/index.ts` — export `CreateLinkInput`.
   - EDIT `services/case-box-persistence/tests/hardening-link-status-resolver.test.mjs` — the already-wired file
     (the WI-A3-UNLINK-T1 lesson: no new test file; `package.json` is forbidden and the runner is a curated list).
   - EDIT this plan dev-memo + governance files.

3. **Exact acceptance criteria.**
   - `createLink({tenant_id, matter_id, source_type, source_id, anchor_id, actor_user_id})` inserts ONE row
     (generated ULID id; `status='needs_review'`; `unlinked_at=NULL`, `unlink_reason=NULL`; `created_at=stamp`;
     deterministic `payload_json`) and appends EXACTLY ONE `LINK_CREATED` event (`action: create`,
     `entity_type: link`, `entity_id`=new id, `before_state_hash: null`, `after_state_hash`=
     `entityStateHash(linkStateForHash(newRow))`, `timestamp`=`created_at` — single stamp, no reason) atomically
     (`event_count == COUNT == MAX(sequence)`).
   - **Rejections (no row, no event)**: unknown matter (`unknown_matter`); tenant mismatch (`tenant_mismatch`);
     bad `source_type` / empty `source_id` / empty `actor_user_id` (`invalid_argument`); missing anchor in
     tenant+matter (`invalid_argument`); missing evidence for `source_type='evidence'` (`invalid_argument`).
   - **Duplicate handling**: a generated-id collision → `duplicate_id` (deterministic rejection; ULID makes it
     rare). No logical-duplicate (source+anchor) uniqueness (the V11 schema has none).
   - After `createLink` + `resolveLinkStatuses` a structurally valid link resolves `valid` and exports a clean
     citation; the created link can subsequently be `unlinkLink`/`relinkLink`'d through the live operations.
   - Existing unlink/relink + resolver/export tests stay green; no schema bump; `npm --prefix
     services/case-box-persistence test` green; contract test green if a consumer is touched; contract-integrity
     PASS; A0.7-gated `check-gates.sh` GATES OK (human custody 9b).

4. **Exact out-of-scope.** No schema/`CURRENT_SCHEMA_VERSION` change; no audit-contract change (`LINK_CREATED`
   shipped #139); no resolver/export/UI/IPC/export-rendering change; no link DELETE; no InMemory/shared-interface
   change; no dependency; no canonicalization/verifier change.

5. **Essential references.** `docs/adr/ADR-evidence-a3-link-create-operation.md` (D1-D10 — the create design);
   `services/case-box-persistence/src/sqlite/linkRepoQueries.ts` (the unlink/relink pattern); `auditChain.ts`.

6. **Review questions.**
   1. **EVIDENCE-EXISTENCE (ADR-EXTENSION — needs confirmation).** The user's T1 authorization requires "missing
      evidence is rejected" + "tenant/matter/evidence/anchor boundaries enforced." ADR D4 required only
      `source_type` enum + non-empty `source_id` (NOT source existence). This plan ADDS: for `source_type='evidence'`,
      the `case_box_evidence_items` row (`source_id`) MUST exist in the same tenant+matter → else `invalid_argument`.
      For the other source_types (`note`/`question`/`calcTerm`/`claimElement`) there is NO backing table, so only a
      non-empty `source_id` is validated (a recorded known gap). Is implementing this evidence-existence check now
      (extending ADR D4) acceptable, or must the ADR be amended first (STOP)? Confirm the non-evidence handling.
   2. Is the concrete-class `createLink` surface (reusing `#runImmediateWrite`, NOT on the shared interface) correct
      (same posture as unlink/relink)?
   3. Is `before_state_hash: null` + `after_state_hash` over `linkStateForHash(newRow)` (excluding the
      resolver-derived `status`) the correct create-event hash shape?
   4. Is provisional `status='needs_review'` + a deterministic `payload_json` (canonical link identity) correct,
      with the resolver computing the authoritative status afterward?

## Design detail

### Surface
```
createLink(input: CreateLinkInput): Promise<CaseBoxLinkRow>
// CreateLinkInput: { tenant_id, matter_id, source_type, source_id, anchor_id, actor_user_id }
```
Via `#runImmediateWrite((db, deps) => applyCreateLinkSqlite(db, input, deps))`.

### prepareCreateLink / applyCreateLinkSqlite (linkRepoQueries.ts)
1. Boundary-validate (before any write): `input` is an object; `actor_user_id`, `tenant_id`, `matter_id`,
   `source_id`, `anchor_id` non-empty strings; `source_type` ∈ the 5-enum → else `invalid_argument`.
2. `requireMatterTenant(db, matter_id, tenant_id)` → `unknown_matter` / `tenant_mismatch`.
3. Anchor existence: `SELECT 1 FROM case_box_anchors WHERE id=? AND tenant_id=? AND matter_id=?` → else
   `invalid_argument` (missing anchor).
4. Evidence existence (D4-EXT): if `source_type==='evidence'`, `SELECT 1 FROM case_box_evidence_items WHERE id=?
   AND tenant_id=? AND matter_id=?` → else `invalid_argument` (missing evidence). Other source_types: non-empty
   `source_id` already checked in step 1 (no table).
5. `const stamp = deps.nowIso()`; `id = deps.generateId()`; build `newRow = { id, tenant_id, matter_id,
   source_type, source_id, anchor_id, status: "needs_review", created_at: stamp, payload_json:
   JSON.stringify({id,tenant_id,matter_id,source_type,source_id,anchor_id,created_at:stamp}), unlinked_at: null,
   unlink_reason: null }`.
6. Build `LINK_CREATED` event (action create, entity_type link, entity_id=id, before_state_hash null,
   after_state_hash=`entityStateHash(linkStateForHash(newRow))`, prev_event_hash=`priorHeadOf(stored)`,
   timestamp=stamp, no reason). Builder reject → `invalid_payload`.
7. `insertLinkRow(db, newRow)` (a single INSERT of all columns; duplicate id → `duplicate_id`), then
   `deps.writeAuditEventAndUpdateHead(audit, eventHashFn(audit.event))`.

### What this does NOT change
`schema.ts` (CURRENT_SCHEMA_VERSION 12), `docs/contracts/**`, `errors.ts` (codes exist),
`linkStatusResolverQueries.ts`/`exportCitationQueries.ts`/`anchorDeleteGuardQueries.ts` (behavior),
`inMemoryRepo.ts`, the shared interface, the conformance harness, `apps/**`/`native/**`, dependencies.

## A0.7 custody (mode 9b)
Court-facing evidence link creation → A0.7-gated. `Requires-A07: yes`. The human mints the local marker + runs
A0.7-gated `check-gates.sh` with the HMAC key; the agent never receives/persists the key; the impl commit is
blocked until the human reports gated PASS.

## Stop conditions
STOP if review-plan rejects the evidence-existence extension (requires an ADR amendment first), or if impl needs
schema/contract/UI/IPC/InMemory/shared-interface/dependency scope. STOP before the human A0.7 gate (report the
exact command). STOP before commit on any Critical/High/Medium. After a clean impl commit, STOP and report;
no push/PR/merge/follow-on without separate authorization.

## References
- `docs/adr/ADR-evidence-a3-link-create-operation.md`, `docs/adr/audit-event-kind-preservation.md`.
- `services/case-box-persistence/src/sqlite/{linkRepoQueries,deadlineRepoQueries,schema}.ts`,
  `services/case-box-persistence/src/auditChain.ts`, `docs/contracts/case-box-contract/src/audit-log.ts`.
