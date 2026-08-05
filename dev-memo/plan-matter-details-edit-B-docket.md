# PLAN — Matter-details edit, Phase B: persistence `updateMatterDetails`

**Type:** SOURCE/persistence WI (HIGH-RISK — audit-chain security boundary; mutates an audited entity). **Status:**
DRAFT. **Branch:** `feature/pta-claimtrack-vertical-slice` (local; no push). **Parent (READY):**
`dev-memo/plan-matter-details-edit-00.md`. **Depends on:** Phase A (`a1b55f0` — `MATTER_DETAILS_UPDATED` kind +
`changed_fields` + hasher). Mirrors the `prepareEnsureMatterPartyIds` / `prepareMatterTransition` precedent exactly.

## 1. Scope
Add the persistence write path for editing the 6 free-text descriptive matter fields, appending one audited
`MATTER_DETAILS_UPDATED` event per edit. In-memory + SQLite parity. No IPC/UI (Phases C/D). No contract change
(Phase A landed the vocabulary).

### Target files
- `services/case-box-persistence/src/types.ts` — add to the `CaseBoxPersistence` port:
  `updateMatterDetails(matterId: string, opts: UpdateMatterDetailsOpts): Promise<CaseBoxMatter>` where
  `UpdateMatterDetailsOpts = { patch: MatterDetailsPatch; actor_user_id: string; reason: string }` and
  `MatterDetailsPatch` is a partial of the 6 editable fields only.
- `services/case-box-persistence/src/inMemoryMatter.ts` — `prepareMatterDetailsUpdate(...)` (the pure core):
  1. **Load + guards:** matter must exist (`unknown_matter`); reject if archived (`status !== "active"` →
     `matter_archived` or the existing archived-guard error).
  2. **Strict PATCH validation (D5):** the patch may contain ONLY the 6 editable keys (name, retainer_scope,
     case_type_text, case_progress_text, court_contact_text, contention_summary_text). Any unknown OR frozen key
     present (incl. jurisdiction/parties/confidentiality/matter_type/status/id/tenant/actor/flags/successor) →
     `invalid_payload`. `undefined`/absent = no change; `null`/`""` = explicit clear allowed ONLY where the domain
     permits (`name` is required → cannot clear to empty → `invalid_payload`; the 5 optional descriptors may clear
     to `""`). Canonicalize/normalize (trim) BEFORE change detection.
  3. **No-op rejection:** if, after canonicalization, NO editable field actually changes → reject
     (`no_editable_change` or reuse `invalid_payload` — pick one, record it) — no audit spam.
  4. **`changed_fields` (SORTED):** compute the set of fields that changed, as a canonical **ascending-sorted**
     unique array over the editable allowlist (the Phase-A contract REQUIRES sorted order — the hash is
     order-sensitive; a `canonicalChangedFields` helper or inline `.sort()` — test it).
  5. **D4a fail-closed continuity:** find the LATEST PRIOR `entity_type="matter" AND entity_id=matterId` event
     (ordered by sequence DESC / entity-local canonical order); require it exists (a matter always has
     MATTER_REGISTERED — absence ⇒ corruption ⇒ throw `audit_chain_desync`); require its `after_state_hash` is
     present + well-formed; require `entityStateHash(currentStoredPayload) === thatPriorAfterStateHash` else throw
     `audit_chain_desync`. Source the new event's `before_state_hash` from that prior after_state_hash.
  6. **Append ONE event:** `MATTER_DETAILS_UPDATED` with `action:update, entity_type:matter`, `reason` (required,
     non-empty else `invalid_payload`/`reason_required`), `changed_fields`, `before_state_hash`,
     `after_state_hash = entityStateHash(rewrittenPayload)`, `prev_event_hash` chained off the matter audit head,
     `audit_schema_version:2`, `event_kind:"MATTER_DETAILS_UPDATED"`.
  7. Return the rewritten matter.
- `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` (+ `sqlite/matterRepoQueries.ts` if a
  helper is needed) — `#applyMatterDetailsUpdate` inside `db.transaction(...).immediate()`: `updateMatterRow`
  (tenant-scoped, `changes===1`) + `insertAuditEvent` + `upsertAuditChainHead`, mirroring `#applyMatterTransition`
  / the party-ids apply. The read→hash→append→update is ONE transaction (D4a concurrency).
- `services/case-box-persistence/src/errors.ts` — add any new error code(s) needed (e.g. `matter_archived`,
  `no_editable_change`) additively (do NOT rename/remove existing codes — security-boundary rule). Reuse
  `invalid_payload` / `unknown_matter` / `audit_chain_desync` where they fit.
- Tests: NEW `tests/hardening-matter-details.test.mjs` (strict-patch: unknown/frozen reject; clear semantics; no-op
  reject; sorted changed_fields; D4a continuity fail-closed incl. desync throw; archived reject; reason required;
  atomicity — a failed continuity check appends NO event + rewrites NO row) + NEW
  `tests/impl-parity-matter-details.test.mjs` (in-memory ↔ SQLite produce identical events/hashes/changed_fields
  for the same edit). Register both in the conformance harness / package test list.

## 2. Acceptance criteria
1. `updateMatterDetails` on BOTH impls edits only the 6 fields, appends exactly one `MATTER_DETAILS_UPDATED` event
   in the SAME transaction as the payload update; the audit-chain invariant `event_count == COUNT(*) ==
   MAX(sequence)` holds after.
2. `changed_fields` is ascending-sorted, unique, allowlist-only, matches exactly the fields that changed after
   canonicalization; the event's hash covers it (Phase-A hasher).
3. D4a: continuity verified against the LATEST PRIOR matter event; any desync (mismatch / missing / malformed prior
   hash) throws `audit_chain_desync` and writes NOTHING (atomic).
4. Strict PATCH: unknown/frozen key → `invalid_payload`; clearing `name` → rejected; clearing an optional descriptor
   allowed; no-op edit rejected; empty reason rejected; archived matter rejected.
5. In-memory ↔ SQLite parity: identical event shape/hashes for the same edit.
6. `npm --prefix services/case-box-persistence test` green (incl. the conformance harness); `npm --prefix
   docs/contracts/case-box-contract test` unchanged-green. No contract/desktop change. loc-guardian clean; one
   revertable local commit; no push.

## 3. Governance + discipline
HIGH-RISK persistence/audit-chain. Design review-plan'd (parent READY). Phase B = test-first → `/cc-suite:audit` →
`/cc-suite:verify`. **Fully-green-before-commit mandatory** (contract + persistence suites, audit+verify,
exact-path staging) so the batch audit finds nothing. Additive error codes only; no code renamed/removed. No push.

## 4. Stop condition
Superseded when Phase B is committed + verified. Phase C (IPC `casebox:matter:updateDetails`) opens next. Hard-stop
if the D4a continuity or the atomic-append cannot be made fail-closed — that is a correctness/security failure, not
shippable.
