# ADR — Case-box matter party identity (audited assignment, no unaudited migration)

**Status:** Accepted (WI-PTA-VS0, Phase A). **Date:** 2026-08-03.
**Context source:** `dev-memo/plan-pta-vs0-party-identity-00.md` (review-plan READY: `review-plan-ms665syb-iahsse`).
Design consult: cc-suite Codex thread `019fae2a`; governance-authority thread `019fae35`.

## Context

ClaimTrack (and later PTA models) reference a matter's parties by ULID
(`claimant_party_id` / `respondent_party_id`). But parties live only inside
`case_box_matters.payload_json` as `matter.parties[]`, and `Party.id` was made
**optional** in PTA-03 for forward-compatibility. So a party may have no ULID for a
ClaimTrack to reference, and assigning one **rewrites the matter** — an audited
entity. Two problems block ClaimTrack persistence:

- **Audit-vocabulary gap.** The matter audit kinds are `MATTER_REGISTERED` /
  `MATTER_ARCHIVED` / `MATTER_UNARCHIVED` / the OCR-sync-LLM-export flag kinds — none
  means "party ids assigned," and there is no generic `MATTER_UPDATED`. Leaving the
  mutation unaudited breaks the every-mutation-audited invariant.
- **Circular identity.** An id-less party has no ULID to be referenced by; assignment
  must precede the reference.

## Decision

1. **Assign at create.** The persistence create path assigns a server-side ULID to any
   id-less party **before** the matter is stored and hashed, so the final id-ful state
   is what `MATTER_REGISTERED` records. No new audit kind on this path.
2. **Audited backfill for legacy matters.** An explicit `ensureMatterPartyIds(matterId,
   { actorUserId })` rewrites a legacy matter's payload to add ULIDs and emits **one new
   additive audit-event kind `MATTER_PARTY_IDS_ASSIGNED`** (`{action:"update",
   entity_type:"matter", reasonRequired:false}`) atomically. Idempotent: all-ids-present
   → no write, no event. The acting user is the caller's, not the matter's original
   `actor_user_id`.
3. **Party ids are unique within a matter.** Create and backfill reject duplicate
   caller-supplied ids and never generate a colliding id, so a ClaimTrack reference is
   unambiguous.
4. **No migration, no schema-version bump.** Party id is payload (`Party.id` already
   optional); the audit kind is contract vocabulary (`event_kind` is a validated TEXT
   value, not DDL). `CURRENT_SCHEMA_VERSION` stays 12.

The audit kind is **specific**, not a generic `MATTER_UPDATED` — reusing
`MATTER_ARCHIVED` or a flag kind would be semantically false. It is additive (renames /
removes / merges nothing; not the `OcrQueueError` boundary), so it is a governed
high-risk contract change (ADR + cc-suite review-plan/audit/verify), matching the PTA-03
audit-vocabulary and A3 `LINK_CREATED` precedents — not a per-instance stop-and-ask.

## Rejected alternative — migration-time payload rewrite (load-bearing)

Backfilling party ids inside a schema migration was rejected as **unsafe**. It would
leave `case_box_matters.payload_json` no longer matching the last matter event's
`after_state_hash`. It might still pass the structural chain check
(`event_count == COUNT(*) == MAX(sequence)`) and `prev_event_hash` linkage — those check
audit rows — but it silently breaks **state-hash continuity** between the audited entity
and its last event. That is exactly the undetectable drift a court-facing audit log must
never permit. **A migration may transform audited entity state ONLY by appending an audit
event per affected matter.** Hence the audited-backfill design above rather than a
silent migration rewrite.

Also rejected: folding the party mutation into `CLAIM_TRACK_CREATED` (would leave the
matter mutation unaudited as its own event); changing ClaimTrack to reference parties by
index/snapshot (a ClaimTrack contract change + denormalization drift); making `Party.id`
required now (a broader matter-schema break than one additive audit kind).

## Consequences

- Phase A (this WI): the additive `MATTER_PARTY_IDS_ASSIGNED` kind lands in the contract
  (schema enum + `CASE_BOX_AUDIT_EVENT_KINDS` map + regenerated type + tests). The
  canonicalizer/verifier auto-participate (no build-logic change); the schema-enum ↔ map
  sync test enforces both stay aligned.
- Phase C (persistence): implements create-time assignment + `ensureMatterPartyIds`
  with direct state-hash-continuity assertions (new event's `before_state_hash` ==
  prior matter event's `after_state_hash`; `after_state_hash` == hash of the rewritten
  stored payload), idempotency, uniqueness, and in-memory↔SQLite parity.
- Downstream desktop consumers gain the new kind's i18n label when the contract tarball
  is republished (a separate step, per the PTA-*b publish precedent); until then the
  desktop gate runs against the prior tarball and is unaffected.
- VS-1 (ClaimTrack persistence) requires referenced party ids to pre-exist; it assigns
  or backfills none itself.

## References
- `dev-memo/plan-pta-vs0-party-identity-00.md` (VS-0 docket), `dev-memo/plan-pta-claimtrack-vertical-slice-00.md` §7.6.
- `docs/contracts/case-box-contract/src/audit-log.ts` (`CASE_BOX_AUDIT_EVENT_KINDS`, `buildCaseBoxAuditEvent`, `verifyAuditChain`).
- `AGENTS.md` §"Critical invariants" (append-only atomic audit chain; persistence = source of truth).
- Precedent: PTA-03 audit-vocabulary expansion; `docs/adr/audit-event-kind-preservation.md` (v2 kind hashing); A3 `LINK_CREATED`.
