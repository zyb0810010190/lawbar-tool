# PLAN — WI-PTA-VS1: ClaimTrack persistence (migration v13 + create/get/list + audit)

**Type:** HIGH-RISK persistence WI (SQLite / better-sqlite3 / append-only audit chain).
**Status:** DRAFT — non-authorizing until cc-suite `review-plan` READY.
**Branch base:** `feature/pta-claimtrack-vertical-slice` (VS-0 complete: contract audit kind `9638278`,
persistence party-identity `d87fb96`). Local commits only; no push.
**Parent:** `dev-memo/plan-pta-claimtrack-vertical-slice-00.md` §3 VS-1. **Depends on:** VS-0 (every
matter party now has a unique ULID — assigned at create or via the audited `MATTER_PARTY_IDS_ASSIGNED`
backfill). Grounding: the planner pass over the real persistence code (`schema.ts`, `factsRepoQueries.ts`,
`evidenceRepoQueries.ts`, `inMemoryEvidence.ts`, `SqliteCaseBoxPersistence.ts`).

**Review record:** cc-suite `review-plan` job `review-plan-msdbojwy-ym5oop` → NEEDS-FIX (M1 `unknown_party`
undeclared + `errors.ts` out of scope; M2 reconcile the O3 boundary in-plan; L create-timestamp semantics) —
all applied (§1 adds `errors.ts`; §2 gives the three-layer O3 boundary + `updated_at===created_at`; §3
acceptance updated). The reviewer confirmed all four review-question resolutions (v13 shape/index/order;
add the light O3 check; unpaginated list; audit path feasible with sharp parity tests). Re-review pending.

## 1. Scope

The first table of the ClaimTrack vertical slice: persist `CaseBoxClaimTrack` (contract shipped in
PTA-04) so a lawyer's claim/counterclaim tracks are stored, audited, and listable. **Create/get/list
only** — no update/withdraw/resolve/delete (those are a later slice), so only the `CLAIM_TRACK_CREATED`
audit kind is emitted (the `_UPDATED`/`_WITHDRAWN`/`_RESOLVED`/`_DELETED` kinds exist from PTA-03 but
VS-1 exposes no path for them).

### Target files (persistence package + tests only)
- `src/sqlite/schema.ts` — `CURRENT_SCHEMA_VERSION` 12 → **13**; add `DDL_STATEMENTS_V13` = the
  `case_box_claim_tracks` table ONLY; register in `DDL_BY_VERSION`. Table (mirror `case_box_facts` /
  `case_box_evidence_items`): `id TEXT PRIMARY KEY`, `tenant_id TEXT NOT NULL`, `matter_id TEXT NOT NULL`,
  `track_type TEXT NOT NULL`, `status TEXT NOT NULL`, `sort_order INTEGER NOT NULL`,
  `created_at TEXT NOT NULL COLLATE BINARY`, `payload_json TEXT NOT NULL`. Lifted columns are filter/seek
  keys only; `payload_json` is canonical (read = `JSON.parse(payload_json)`, never re-derived). **No FK**
  (invariant). No value CHECKs (mirror facts/evidence; validation is `validateClaimTrack`).
- `src/sqlite/claimTrackRepoQueries.ts` — **NEW**: `applyCreateClaimTrackSqlite` / `getClaimTrackSqlite` /
  `listClaimTracksSqlite` + `insertClaimTrackRow`. Mirror `factsRepoQueries.ts`: `requireMatterTenant`
  preflight + row-level `tenant_id = ?` predicate on read/list; `SqliteBackedIdSet` duplicate-id guard;
  atomic `writeAuditEventAndUpdateHead` for `CLAIM_TRACK_CREATED`.
- `src/errors.ts` — add the **new additive** `CaseBoxPersistenceErrorCode` value `unknown_party` for the
  O3 existence check (review-plan M1). Additive only (renames/removes/merges nothing), mirroring VS-0's
  `audit_chain_desync` addition. `tests/invariants.test.mjs` §6.2.x documented-codes set gains it.
- `src/inMemoryClaimTrack.ts` — **NEW**: `ClaimTrackState` + `prepareCreateClaimTrack` (shared with the
  SQLite path) + `applyCreateClaimTrack` + `listClaimTracks`, mirroring `inMemoryEvidence.ts`. The
  in-memory sort comparator MUST be byte-identical to the SQLite `ORDER BY` (parity is tested).
- `src/inMemoryRepo.ts` — add `claimTrack` to `InternalState` + 3 delegates.
- `src/sqlite/SqliteCaseBoxPersistence.ts` — 3 methods (`createClaimTrack` via `#runImmediateWrite`;
  `getClaimTrack`/`listClaimTracks` read-through).
- `src/types.ts` + `src/index.ts` — `CaseBoxClaimTrack` re-export + `GetClaimTrackQuery` /
  `ListClaimTracksQuery` / the 3 methods on `CaseBoxPersistence`.
- Tests: `tests/hardening-schema.test.mjs` (v13 block + bump the hard-coded `12`/`1..12` assertions);
  `tests/data-migration-compat.test.mjs` (add `case_box_claim_tracks` to `NEWER_TABLES`);
  `tests/impl-parity-claim-track.test.mjs` (**NEW**); `tests/hardening-claim-track.test.mjs` (**NEW**);
  `tests/conformance/fixtures.mjs` (`makeClaimTrackInput` + `DEFAULT_CLAIM_TRACK_ID`);
  `tests/invariants.test.mjs` (public-method allowlist +3); `package.json` (register new test files).

### Out of scope (must NOT touch)
Contract schemas (ClaimTrack shipped); the other PTA tables + the v14 junction; update/withdraw/resolve/
delete + their audit kinds; the guarded hard-delete; read-aggregation / trial bundle (PTA-10); IPC/renderer
(VS-2/VS-3); any `ensureMatterPartyIds`/party-assignment change (VS-0 owns it); no new dependency; no FK;
no fixture mutation without a matching schema+semantic test; no push.

## 2. Resolved design decisions (the planner's open questions)

- **O4 — list order + seek index (parity-critical). RESOLVED:** `ORDER BY sort_order ASC, created_at ASC,
  id ASC` (lawyer-controlled order first, then a fully-deterministic tiebreak). SQLite index
  `(matter_id, sort_order, created_at, id)` matches the ORDER BY exactly; the in-memory comparator uses the
  same 3-key order. Drop the redundant bare `(matter_id)` index (the composite leads on `matter_id`).
- **O5 — pagination. RESOLVED: unpaginated `listClaimTracks(matter)`** — a matter has inherently few tracks
  (one main claim + a bounded number of counterclaims; contract imposes no max but the domain does), so a
  full deterministic-ordered list is correct and simpler than cursor paging. Consequence: **`cursor.ts` is
  NOT touched** (no new cursor kind). If a future slice needs paging it adds the cursor kind then.
- **O7 — create-time guards. RESOLVED:** `createClaimTrack` requires `status === "active"` at create
  (mirror the evidence proposed-only guard `inMemoryEvidence.ts`); `withdrawn`/`resolved` are reachable
  only via the deferred update slice. The contract's required-but-empty-string fields
  (`claim_summary`/`response_summary`/`legal_basis`/`calculation_summary`) are required keys that accept
  `""` (schema wins over any "optional" phrasing).
- **O8 — actor + ids. RESOLVED:** `actor_user_id` is client-supplied on the ClaimTrack input (v1 sentinel
  `"local-user"`); the `CLAIM_TRACK_CREATED` event's `actor_user_id` = `row.actor_user_id` (mirror evidence).
- **L — create timestamps. RESOLVED (review-plan Low):** `createClaimTrack` requires
  `updated_at === created_at` at create (a freshly-created row has never been updated); caller divergence is
  rejected `invalid_argument`. Only `created_at` is lifted (seek key); `updated_at` stays canonical in
  `payload_json`. A later update slice advances `updated_at` and its parity is established there.
- **O3 — party-ref validation boundary (three layers, RESOLVED — review-plan M2).** Reconciles the parent
  plan §86 ("referential check deferred to VS-2's handler") with source-of-truth integrity by splitting the
  responsibility precisely across three layers, none weakening another:
  1. **Contract schema** validates only the ULID *shape* of `claimant_party_id`/`respondent_party_id`
     (`case-box-claim-track.schema.json` explicitly states party *existence* is not schema validation).
  2. **VS-1 persistence** validates *existence* against the loaded matter's `parties[]` — the matter row is
     already read for `requireMatterTenant`, so this is cheap. A referenced id absent from the matter's
     parties → **reject `unknown_party`** (new additive code, §1). VS-0 guarantees every real party has a
     ULID, so a missing ref is a genuine error, not a legacy gap. This closes the referential hole at the
     source of truth rather than letting a direct persistence caller store an impossible row.
  3. **VS-2 handler** keeps the *richer* handler-side validation (preflight matter+tenant fail-closed,
     authority-field strip, and re-assertion of the party refs) — it repeats and enriches, never replaces,
     the persistence check.

## 3. Acceptance criteria
1. `CURRENT_SCHEMA_VERSION === 13`; fresh DB records `schema_version` 1..13; idempotent at 13; refuses a
   v14 DB before any mutation (DB byte-identical). `case_box_claim_tracks` has the declared columns +
   the `(matter_id, sort_order, created_at, id)` index + **zero** FKs (`PRAGMA foreign_key_list` empty).
2. A v12 (and v1) store upgrades additively to 13, existing rows preserved (`data-migration-compat` green;
   `NEWER_TABLES` includes `case_box_claim_tracks`).
3. `createClaimTrack` / `getClaimTrack` / `listClaimTracks` are **deep-equal identical** across the
   in-memory and SQLite impls (list ordering included), with error-code parity on rejection paths.
4. A `createClaimTrack` emits exactly one `CLAIM_TRACK_CREATED` event and preserves
   `event_count == COUNT(*) == MAX(sequence)` for the matter (red-before/green-after audit-invariant test).
5. Tenant scoping: `requireMatterTenant` preflight + row-level `tenant_id` predicate on get/list; a foreign
   tenant → `tenant_mismatch`; unknown matter → the fact/evidence-precedent code.
6. `status !== "active"` at create → rejected; `updated_at !== created_at` at create → `invalid_argument`;
   duplicate id → `duplicate_id`; schema-invalid → `invalid_payload`; a `claimant_party_id`/
   `respondent_party_id` absent from the loaded matter's parties → **`unknown_party`** (O3 layer 2). The
   new `unknown_party` code is enumerated in the `invariants.test.mjs` documented-codes set.
7. Gates green: `npm --prefix services/case-box-persistence test` (abi-smoke pretest) +
   `npm --prefix docs/contracts/case-box-contract test` (unchanged). cc-suite `audit` no open C/H/M;
   `verify` closes; `/loc-guardian:scan` clean before + after (new per-entity files keep additions out of
   the already-large `SqliteCaseBoxPersistence.ts`).
8. One revertable local commit; no push. `CURRENT_SCHEMA_VERSION` is the only version bump; no other table.

## 4. Governance / sequencing
- HIGH-RISK persistence → cc-suite `review-plan` READY before code; `audit` + `verify` on the diff; broker
  required. Built via the implementer subagent from this docket; I verify scope + gates + drive audit/verify.
- Critical invariants preserved (`AGENTS.md`): no FK; persistence = source of truth; append-only + atomic
  audit; in-memory ↔ SQLite parity; stable `OcrQueueError`/audit codes; no fixture mutation without
  schema+semantic test; no read-layer re-sort masking a persistence bug.
- Migrations are forward-only: this v13 is the first real v13 (VS-0 added no DDL); later slices add
  v14/v15/v16 for the other models.
- Push remains a hard-stop.

## 5. Review packet (compact)
- **Active plan summary:** Persist `CaseBoxClaimTrack` via a v13 `case_box_claim_tracks` table (claim-tracks
  only) + create/get/list on the shared `CaseBoxPersistence` interface with in-memory↔SQLite parity + an
  atomic `CLAIM_TRACK_CREATED` audit write. Depends on VS-0 (party ULIDs pre-exist). No update/delete, no
  other table, no IPC/UI.
- **Exact target files:** §1.
- **Acceptance criteria:** §3.
- **Out of scope:** §1 out-of-scope list.
- **Essential references:** `dev-memo/plan-pta-claimtrack-vertical-slice-00.md` §3 VS-1;
  `docs/contracts/case-box-contract/schemas/case-box-claim-track.schema.json` (16 required fields incl.
  `track_type`/`our_role`/`status`/`sort_order`/`claimant_party_id`/`respondent_party_id`);
  `services/case-box-persistence/src/sqlite/{schema.ts,factsRepoQueries.ts,evidenceRepoQueries.ts}`;
  `AGENTS.md` §"Critical invariants".
- **Review questions:**
  1. Is v13 = `case_box_claim_tracks`-only sound (forward-only, VS-0 added no DDL), and the table shape +
     the `(matter_id, sort_order, created_at, id)` index / matching ORDER BY correct for deterministic
     parity?
  2. The O3 party-ref boundary (§2, now the three-layer split): confirm VS-1 persistence adds the
     `unknown_party` existence check against the loaded matter (declared additive code in `errors.ts`), with
     schema validating shape and VS-2 richening the handler check.
  3. Is unpaginated `listClaimTracks(matter)` acceptable (bounded track count), or must it be cursor-paged
     for consistency with the other list surfaces?
  4. Any audit-integrity or parity risk in the create path (single `CLAIM_TRACK_CREATED`, event_count
     invariant, row-level tenant predicate) versus the fact/evidence precedent?

## 6. Stop condition
Superseded when review-plan returns READY and implementation opens; revised if review-plan flags the schema
shape, the O3 boundary, or the pagination choice. Completes the persistence layer of the ClaimTrack slice;
VS-2 (IPC) follows.
