# PLAN — WI-PTA-VS0: matter party-identity foundation (audit-kind + create-assignment + audited backfill)

**Type:** high-risk CONTRACT + PERSISTENCE WI (additive audit-event kind + persistence behavior).
**Status:** DRAFT — non-authorizing until cc-suite `review-plan` READY. **Branch base:** `feature/pta-claimtrack-vertical-slice` (off `main` `b0e2948`, ungated — local commits only; no push).
**Authority:** governed high-risk contract work, NOT a per-instance stop-and-ask (precedent: PTA-03 audit-vocabulary expansion; A3 `LINK_CREATED` audit-event-kind change — both driven via ADR/review-plan/audit/verify). The only remaining hard-stop is remote movement (push/PR/merge), which this WI does not perform. Design consult: cc-suite Codex thread `019fae2a`; governance-authority confirmation thread `019fae35`.

**Review record:** cc-suite `review-plan` job `review-plan-ms660xel-uk1nn5` → NEEDS-FIX (High party-id uniqueness; Medium actor attribution; Medium direct state-hash-continuity assertions; Low public-method allowlist) → all applied → re-review job `review-plan-ms665syb-iahsse` → **READY (Low-risk clarifications)** (add ADR path to Phase A; tighten Q1) — both applied before this commit.

## 1. Why this WI exists (the VS-1 blocker)

ClaimTrack references parties by ULID (`claimant_party_id` / `respondent_party_id`), but parties live only inside `case_box_matters.payload_json` as `matter.parties[]` with `Party.id` **optional** (PTA-03 forward-compat). Two blockers must be resolved before any ClaimTrack persistence (see `plan-pta-claimtrack-vertical-slice-00.md` §7.6):
- **O1** — assigning an id to an id-less party rewrites the matter (an audited entity), but there is **no matter "party ids assigned" audit-event kind**. Leaving it unaudited breaks the every-mutation-audited invariant.
- **O2** — an id-less party has no ULID to be referenced by; assignment must precede the reference.

**Rejected shortcut (load-bearing):** a migration-time payload rewrite is UNSAFE — it would leave `case_box_matters.payload_json` no longer matching the last matter event's `after_state_hash`. It might pass the structural chain check (`event_count == COUNT == MAX(sequence)`) and `prev_event_hash` linkage, yet silently break **state-hash continuity** — undetectable drift a court-facing audit log must never permit. A migration may transform audited state ONLY by appending an audit event per affected matter.

## 2. Decision

1. **New matters** — the persistence create path assigns a server-side ULID to any id-less party **before** the matter is stored and hashed. The final (id-ful) state is audited by the existing `MATTER_REGISTERED`. **No new audit kind on this path.**
2. **Legacy id-less matters** — an explicit, audited backfill (`ensureMatterPartyIds`) rewrites the matter payload to add ULIDs and emits **one new `MATTER_PARTY_IDS_ASSIGNED`** audit event (specific, not a generic `MATTER_UPDATED`; reusing `MATTER_ARCHIVED`/flag kinds would be semantically false). Atomic + idempotent.
3. **No migration, no schema-version bump.** Party ids are payload (`Party.id` already optional); the audit kind is contract vocabulary; `case_box_audit_events.event_kind` is TEXT validated at the contract layer. `CURRENT_SCHEMA_VERSION` stays 12; no new table/column/DDL.
4. **VS-1 is unblocked**: `createClaimTrack` will REQUIRE the referenced party ids to already exist (no backfill smuggled into VS-1).
5. **Party ids are UNIQUE within a matter** (review-plan High). Create and backfill MUST reject a matter whose caller-supplied `parties[]` carries duplicate ids, and MUST generate ULIDs that do not collide with any existing or freshly-generated id in the same matter — otherwise a ClaimTrack ULID reference is ambiguous.
6. **Backfill actor is EXPLICIT** (review-plan Medium). `ensureMatterPartyIds(matterId, { actorUserId })` takes the acting user from the caller (the VS-2 IPC handler); it does NOT reuse the matter's original `actor_user_id` (that would misattribute a later mutation).

## 3. Scope — target files

### Phase A — contract (additive audit-event kind)
- `docs/adr/ADR-casebox-matter-party-identity.md` — **NEW** ADR recording the decision (§2 + the rejected-migration state-hash-continuity rationale), per the A3 audit-event-kind precedent.
- `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json` — add `MATTER_PARTY_IDS_ASSIGNED` to the `event_kind` enum (entity_type `matter`, action `update` — already a valid matter action via `MATTER_ARCHIVED`/`MATTER_UNARCHIVED`; the action vocabulary is NOT touched).
- `docs/contracts/case-box-contract/src/audit-log.ts` — add the kind to `CASE_BOX_AUDIT_EVENT_KINDS` + the kind→{action, entity_type, reasonRequired} map + `buildCaseBoxAuditEvent` handling (before_state_hash = prior matter state, after_state_hash = post-assignment matter state; reasonRequired false).
- generated types (`src/generated/*` via `npm run gen:types`) — regenerated, not hand-edited (banner-marked generated file).
- `docs/contracts/case-box-contract/fixtures/*` — a valid `MATTER_PARTY_IDS_ASSIGNED` fixture + an invalid one (wrong action/entity_type).
- `docs/contracts/case-box-contract/tests/*` — extend the audit-event validation + the kind-exhaustiveness sweep.

### Phase B — renderer exhaustive consumers (so the desktop gate stays green)
- `apps/lawbar-desktop/renderer/i18n/labels.ts` (`eventKindLabel`) + `catalog.ts` — zh-CN facade for the new kind; `renderer-i18n`/`renderer-i18n-guard` exhaustiveness tests updated.

### Phase C — persistence (behavior; no DDL)
- `services/case-box-persistence/src/inMemoryMatter.ts` + `src/sqlite/matterRepoQueries.ts` — create path assigns ULIDs to id-less parties before store/hash (mirror the existing server-id generation via `deps.generateId`, `ulid.ts`); **reject a create whose caller-supplied party ids are non-unique; generate collision-free ids** (decision §2.5).
- `ensureMatterPartyIds(matterId, { actorUserId })` on the shared `CaseBoxPersistence` interface — explicit audited backfill (actor from the caller, §2.6): load matter → if any party id-less, assign collision-free ULIDs (reject if existing ids already duplicate) + rewrite payload via the scoped matter update (adopt the `changes === 1` discipline; `matterRepoQueries.ts` `updateMatterRow` currently lacks it — harden in-WI) + emit `MATTER_PARTY_IDS_ASSIGNED` atomically; idempotent (all-ids-present → no write, no event). In-memory ↔ SQLite parity.
- `services/case-box-persistence/src/types.ts` + `index.ts` — `ensureMatterPartyIds` signature (with `{ actorUserId }`).
- `services/case-box-persistence/tests/*` — hardening (create assigns ids + rejects duplicate caller ids + collision-free; backfill idempotent + audited + actor-attributed; **red-before/green-after** audit-invariant `event_count==COUNT==MAX(sequence)` AND **direct state-hash continuity** — the new event's `before_state_hash` equals the prior matter event's `after_state_hash`, and `after_state_hash` equals the rewritten stored matter payload, §4.3); impl-parity (incl. error-code parity); existing id-less-party fixtures still valid; **update the exact public-method allowlist in `tests/invariants.test.mjs` (~line 138) + shared conformance coverage** for the new `ensureMatterPartyIds` method (review-plan Low).

### Out of scope / must NOT touch
- Rename/remove/merge of any existing audit code or event/error shape (would be a hard-stop). No new table/column/DDL/schema bump. No ClaimTrack persistence (VS-1). No IPC/renderer product surface beyond the i18n label facade. No new runtime dependency. No fixture mutation without matching schema+semantic test. No push/PR/merge.

## 4. Acceptance criteria
1. `MATTER_PARTY_IDS_ASSIGNED` validates via the contract; the kind-exhaustiveness sweep + renderer i18n-guard are green; existing audit fixtures still valid; generated types regenerated from schema (not hand-edited).
2. Creating a matter whose input parties are id-less → the stored matter has a ULID `id` on every party; the `MATTER_REGISTERED` event hashes the id-ful state. No `MATTER_PARTY_IDS_ASSIGNED` emitted on the create path.
3. `ensureMatterPartyIds(matterId, { actorUserId })` on a legacy id-less matter assigns collision-free ULIDs, emits exactly one `MATTER_PARTY_IDS_ASSIGNED` attributed to `actorUserId`, preserves `event_count == COUNT(*) == MAX(sequence)`, AND — asserted DIRECTLY (review-plan Medium; load-bearing for §1's rationale) — the new event's `before_state_hash` equals the prior matter event's `after_state_hash` and its `after_state_hash` equals the hash of the rewritten stored matter payload. Idempotent (re-run with all ids present writes nothing, emits no event). In-memory ↔ SQLite deep-equal parity, incl. error-code parity.
4. **Uniqueness** (review-plan High): create and backfill reject a matter with duplicate caller-supplied party ids and never generate a colliding id; a ClaimTrack can reference any party by an unambiguous ULID.
5. `CURRENT_SCHEMA_VERSION` unchanged (12); `PRAGMA` table set unchanged; `data-migration-compat` unaffected; the `CaseBoxPersistence` public-method allowlist test (`invariants.test.mjs`) updated for `ensureMatterPartyIds`.
6. Gates green: `npm --prefix docs/contracts/case-box-contract test`, `npm --prefix services/case-box-persistence test` (abi-smoke pretest), `npm --prefix apps/lawbar-desktop test` (i18n labels). cc-suite `audit` no open C/H/M; `verify` closes; `/loc-guardian:scan` clean before + after.
7. One or two revertable local commits (Phase A contract → Phase C persistence), gate-green each. No push.

## 5. Governance / sequencing
- HIGH-RISK contract WI → cc-suite `review-plan` READY required before code; `audit` + `verify` on the diff. An ADR (`docs/adr/ADR-casebox-matter-party-identity.md`) recording the decision (§2 + the rejected-migration rationale) is produced as part of Phase A (contract/architecture decision on the audit vocabulary), per the A3 audit-event-kind precedent.
- Commit boundary: Phase A (contract + generated types + fixtures + tests + ADR) and Phase C (persistence) may be separate commits so each is independently gate-green; Phase B rides with whichever consumer commit keeps the desktop gate green. Explicit-path staging; do not bundle govern/mark-reviewed with a dependent commit.
- Invariants preserved (`AGENTS.md`): append-only atomic audit chain; in-memory↔SQLite parity; no FK; no code rename/remove; stable existing event/error shapes; no fixture mutation without schema+semantic test.
- Remote movement (push/PR/merge, gate-branch merge) remains the user's hard-stop — not performed here.

## 6. Review packet (compact)
- **Active plan summary:** Add the `MATTER_PARTY_IDS_ASSIGNED` audit-event kind + assign party ULIDs at matter-create + an audited `ensureMatterPartyIds` backfill for legacy matters, so ClaimTrack (VS-1) can reference parties by ULID without an unaudited mutation. Additive, no migration, no schema bump.
- **Exact target files:** §3 (Phase A contract, Phase B renderer i18n, Phase C persistence + tests).
- **Acceptance criteria:** §4.
- **Out of scope:** ClaimTrack persistence; any rename/remove/merge of existing codes; new table/column/DDL; new dependency; push.
- **Essential references:** `plan-pta-claimtrack-vertical-slice-00.md` §7.6; `docs/contracts/case-box-contract/src/audit-log.ts` (kinds + build); `case-box-audit-event.schema.json` (enum, actions); `services/case-box-persistence/src/sqlite/matterRepoQueries.ts` (matter write + audit) + `inMemoryMatter.ts`; `AGENTS.md` §"Critical invariants".
- **Review questions:**
  1. Is `MATTER_PARTY_IDS_ASSIGNED = {action:"update", entity_type:"matter", reasonRequired:false}` the right vocabulary? (`update`-on-`matter` is already valid via `MATTER_ARCHIVED`/`MATTER_UNARCHIVED`; the action vocabulary is not touched.)
  2. Is create-time server assignment of party ULIDs (before `MATTER_REGISTERED` hashing) sound, or does it surprise a client that sent id-less parties (behavior change on `createMatter` output)?
  3. Is the audited-backfill design (rewrite payload + one `MATTER_PARTY_IDS_ASSIGNED` event, `changes===1`, idempotent) sufficient to preserve state-hash continuity + the append-only invariant?
  4. Is the no-migration / no-schema-bump conclusion correct (party id = payload, audit kind = TEXT event_kind validated at contract layer)?

## 7. Stop condition
Superseded when review-plan returns READY and Phase A opens; revised if review-plan flags the vocabulary or the create-time-assignment behavior. Unblocks VS-1.
