# WI-PTA-04 — Scope docket: ClaimTrack contract schema

**Status:** UNTRACKED pre-implementation scope docket. **NOT authorized for implementation** — requires its own
cc-suite `review-plan` approval. **Type:** SOURCE/contract, high-risk (vocabulary-owner schema addition) → broker
review required. **Branch:** `feature/pretrial-trial-addon-04` @ `6856148` (clean `main`).
**Parent:** `dev-memo/plan-pretrial-trial-addon-01.md` (READY umbrella; WI-PTA-04 entry + ClaimTrack schema diff).
**Frozen source of truth:** `dev-memo/plan/pretrial-trial-addon-01-frozen.md`.

## Authoritative frozen-spec references
- **§1 Claim-track model** — the ClaimTrack concept, fields, `track_type`/`our_role`/`status` enums, scenarios A–D,
  counterclaim cardinality (no schema max), standard audit fields.
- **§9 Plaintiff / defendant behavior** — the `our_role = asserting|responding` semantics the model must support for
  both client-side roles without hardcoded plaintiff/defendant workflows.
- **§14 test items #1–#4** — `our_role=asserting`; `our_role=responding`; a matter can have both a main claim and a
  counterclaim; the schema does not enforce a maximum of one counterclaim.
- **§15 acceptance #4–#6** — a matter can have a main claim + optional counterclaim; future-compatible with multiple
  counterclaims; each claim track knows whether our side is asserting or responding.

## Problem statement + observable behavior
The product needs a **claim track** — the reasoning spine that later evidence-preparation, cross-examination, and
legal-opinion-card work attach to. A claim track represents the main claim OR a counterclaim, records who is
claimant/respondent, and whether *our* side is asserting or responding — the `our_role` abstraction that supports all
four scenarios (plaintiff/defendant × asserting/responding) **without** separate hardcoded workflows.
**Observable behavior (this WI only):** a `case-box-contract` validator (`validateClaimTrack`) that **accepts** a
well-formed ClaimTrack (any of the four `track_type × our_role` combinations) and **rejects** bad enums / missing
required fields; a matter may carry multiple ClaimTracks (one `main_claim` + one or more `counterclaim`) — the schema
imposes **no** maximum-counterclaim constraint.

## In scope (contract-only)
- New schema `docs/contracts/case-box-contract/schemas/case-box-claim-track.schema.json`.
- Validator `docs/contracts/case-box-contract/src/validateClaimTrack.ts` (Ajv, mirrors the existing `validate*.ts`).
- `docs/contracts/case-box-contract/scripts/gen-types.mjs` — **append the ClaimTrack schema/type entry** to its
  hardcoded schema list (the generator does NOT auto-discover new schemas; without this, `gen:types` won't produce
  the ClaimTrack type). (review-plan High #2.)
- Regenerated type `docs/contracts/case-box-contract/src/generated/case-box-claim-track.ts` (via `npm run gen:types`;
  AUTO-GENERATED banner; never hand-edited).
- `docs/contracts/case-box-contract/src/index.ts` — export `validateClaimTrack`, `claimTrackSchema`, the generated
  type; `src/loadSchemas.ts` — import the schema (JSON import attributes).
- Fixtures `docs/contracts/case-box-contract/fixtures/{valid,invalid}/claim-track*` — **standalone ClaimTrack entity
  fixtures** (NOT a collection/array schema and NOT a `matter.claim_tracks` addition — the matter schema is out of
  scope): 4 valid covering scenarios A–D, plus a `main_claim` + a `counterclaim` (and a 2nd `counterclaim`) sharing
  one `matter_id` to exercise "main + counterclaim" and "multiple counterclaims", plus invalid (bad enum, missing
  required). (review-plan Low.)
- Tests: `tests/contract.test.mjs` (explicit per-fixture valid/invalid tests + the stray-fixture sweep);
  `tests/validators.test.mjs` (`validateClaimTrack` happy path + error path); **`tests/exports.test.mjs`** — add
  `validateClaimTrack` to `expectedFns` and `claimTrackSchema` to `expectedObjects` (the public-surface + frozen-schema
  guard). (review-plan Medium.)

### ClaimTrack schema shape (from §1 + umbrella standard-fields rule)
Standard (repo convention, all 11 entities): `id: ULID`, `tenant_id`, `actor_user_id`, `matter_id: ULID`,
`created_at: RFC3339`; mutable entity → `updated_at: RFC3339`.
§1 fields: `track_type: main_claim|counterclaim`, `claimant_party_id: ULID`, `respondent_party_id: ULID`,
`our_role: asserting|responding`, `title`, `claim_summary`, `response_summary`, `legal_basis`,
`calculation_summary`, `status: active|withdrawn|resolved`, `sort_order: int (≥0)`.
**All §1 fields are REQUIRED** (frozen §1 lists them under "Required claim-track fields"; the umbrella diff's `?`
markers were an interpretation, superseded here by the authoritative frozen source). The four summary/basis fields
are `type: "string"` with **empty string allowed** (no `minLength`) so a track can leave the non-applicable summary
empty (an `asserting` track's `response_summary`, a `responding` track's `claim_summary`) while the key stays
present — no `null`, no cross-field invariant. **Required set:** id, tenant_id, actor_user_id, matter_id, track_type,
claimant_party_id, respondent_party_id, our_role, title, claim_summary, response_summary, legal_basis,
calculation_summary, status, sort_order, created_at, updated_at. `title` = non-empty (`minLength: 1`). **No**
cross-field invariant — all four `track_type × our_role` combinations are valid (scenarios A–D). **No** schema-level
maximum-counterclaim constraint (test #4).

## Explicit exclusions / deferred work
- **Persistence** (a v13 `case_box_claim_tracks` table, repo queries, audit-event emission, parity) → **WI-PTA-08**.
- **IPC** (channels/handlers/preload/renderer-api) → **WI-PTA-11/12**.
- **Referential validation** that `claimant_party_id`/`respondent_party_id` ∈ the matter's `parties[]` → **WI-PTA-12**
  (a handler preflight; NOT a schema constraint — the schema only types them as ULID).
- **Audit-event emission** for ClaimTrack lifecycle → WI-PTA-08 (the `claim_track` entity_type + `CLAIM_TRACK_*`
  event kinds are **already in the contract**, delivered by WI-PTA-03 — this WI adds NO audit vocabulary).
- **Renderer / UI / i18n** (labels for `track_type`/`our_role`/`status`) → WI-PTA-13+/17.
- **The other three models** (EvidencePreparation, CrossExaminationOpinion, LegalOpinionCard) → WI-PTA-05/06/07.
- **ClaimTrack guarded delete / block-if-referenced** (decision #5) → persistence WI-PTA-10.

## Impact analysis
- **Data-contract:** one **additive** new entity schema + validator + generated type. No existing schema touched.
- **Persistence:** none (deferred; no migration in this WI). **IPC:** none. **Renderer:** none. **Migration:** none.
- **Compatibility:** purely additive — existing contract consumers unaffected; the `claim_track` audit `entity_type`
  and `CLAIM_TRACK_*` kinds already exist (WI-PTA-03, merged), so `validateAuditEvent`/`verifyAuditChain` already
  accept ClaimTrack audit events; the new schema does not alter any of that.
- **Rollback:** a single contract commit, revertable with `git revert`; no data, no migration, no runtime state.

## Test matrix → frozen acceptance
| test | asserts | frozen acceptance |
|---|---|---|
| valid: main_claim + our_role=asserting (scenario A) | validator accepts | #6, #4 |
| valid: counterclaim + our_role=responding (scenario B) | accepts | #6 |
| valid: main_claim + our_role=responding (scenario C) | accepts | #6 |
| valid: counterclaim + our_role=asserting (scenario D) | accepts | #6 |
| valid: two ClaimTracks (main_claim + counterclaim, same matter) | both accept | #4 |
| valid: multiple counterclaim ClaimTracks | all accept (no max) | #5, §14 #4 |
| invalid: bad `track_type` / `our_role` / `status` enum | rejected | (enum guard) |
| invalid: missing a required field (e.g. `title`, `claimant_party_id`) | rejected | (required guard) |
| `validateClaimTrack` happy path / error path | ok=true / ok=false with summary | acceptance shape |

(Maps §14 #1 `our_role=asserting`, #2 `our_role=responding`, #3 main+counterclaim, #4 no-max.)

## Verification commands
`npm --prefix docs/contracts/case-box-contract test` (builds + gen:types via prebuild; runs the conformance +
validator suites incl. the new ClaimTrack fixtures/tests).

## Stop conditions
STOP + report if implementing WI-PTA-04 would: touch persistence / IPC / renderer / any existing schema; add or
change audit vocabulary (already delivered); add referential-party validation logic (deferred to PTA-12); introduce a
cross-field invariant not in §1; pull forward EvidencePreparation/CrossExam/LegalOpinionCard (PTA-05/06/07) or any
persistence/UI behavior; or hand-edit a generated file.

## Dependencies
- **WI-PTA-03 (merged, `f835673`):** optional `Party.id` in both party definitions (so `claimant_party_id`/
  `respondent_party_id` reference a real party ULID) + the `claim_track` audit vocabulary. **Satisfied.**
- **WI-PTA-03b (merged, `5fb4b9e`):** desktop consumes the 71-kind union — context only; not a build dependency for
  this contract-only WI.

## Characterization-tests note
No characterization pass is needed: WI-PTA-04 is a **new additive schema** with no existing behavior to pin (the
existing matter/evidence open flow was already characterized in WI-PTA-02, `5cf85c2`). New behavior is proven by the
fixtures + validator tests above.

## No forward-pull confirmation
This docket covers **only** ClaimTrack (the frozen §1 model). It pulls in **no** WI-PTA-05+ behavior — no
EvidencePreparation/CrossExamination/LegalOpinionCard schema, no persistence, no IPC, no UI, no trial-mode logic.

## Review record (cc-suite review-plan)
- Job `review-plan-mrm2td6a-z51iab` (Path 1, gpt-5.5/high/read-only) — **verdict: READY after fixes** (no duplicated
  PTA-03 work; Party.id + ClaimTrack audit vocabulary correctly treated as already-delivered; deferrals correct).
  Findings + dispositions (all applied):
  - **High** — frozen §1 field mismatch (the four summary/basis fields were marked optional, but §1 lists them under
    "Required claim-track fields") → **fixed**: made required (`type: string`, empty allowed; no cross-field
    invariant), reconciling to the authoritative frozen source over the umbrella diff's `?`.
  - **High** — the generated type cannot be produced because `scripts/gen-types.mjs` has a hardcoded schema list →
    **fixed**: added `gen-types.mjs` (append the ClaimTrack entry) to in-scope files.
  - **Medium** — missing public-export guard → **fixed**: added `tests/exports.test.mjs` (`validateClaimTrack` in
    `expectedFns`, `claimTrackSchema` in `expectedObjects`).
  - **Low** — multi-claim-track fixture must not become a collection/`matter.claim_tracks` addition → **fixed**:
    scoped as standalone ClaimTrack fixtures sharing one `matter_id`.
- This docket remains a **pre-implementation plan**; nothing is implemented. Implementation requires the reviewed
  scope + separate authorization.
