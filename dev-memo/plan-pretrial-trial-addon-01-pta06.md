# WI-PTA-06 — Scope docket: CrossExaminationOpinion contract schema + conditional invariant

**Status:** REVIEWED — **READY** (cc-suite `review-plan` `review-plan-ms4aii7r-dimxl0`, after NEEDS-FIX
`review-plan-ms4adsar-1rn379`; see §"Review record"). **Authorized for implementation of exactly this docket's
scope** — no scope beyond the target files + test matrix below. **Type:** SOURCE/contract, high-risk (governed
contract/schema expansion → cc-suite broker required per `.claude/rules/cc-suite.md` §"High-risk WIs"). **Branch:**
`feature/pretrial-trial-addon-06` @ `b022d0c` (clean synchronized `main`).
**Parent:** `dev-memo/plan-pretrial-trial-addon-01.md` (APPROVED umbrella) §"WI-PTA-06". **Predecessors:**
`plan-pretrial-trial-addon-01-pta04.md` (ClaimTrack, merged), `plan-pretrial-trial-addon-01-pta05.md`
(EvidencePreparation, merged). **Frozen source of truth:** `dev-memo/plan/pretrial-trial-addon-01-frozen.md` §3
"Cross-examination opinion model"; §14 test items #8/#9/#10/#11; §15 acceptance #10/#11.

## Authoritative frozen-spec references
- **§3 "Cross-examination opinion model"** (frozen lines 192-281): the two directions, the required-field list,
  the `direction` enum, the four status dimensions (authenticity/legality/relevance/probative_force) with the
  shared status enum + matching `_reason` fields, the `preparation_status` enum, the conditional-requirement rule
  for `our_response_short_version`, the `(claim_track_id, evidence_id, direction)` uniqueness constraint, and the
  "do NOT add `rebuttal_evidence_ids`" exclusion (rebuttal is a LegalOpinionCard concern, PTA-07).
- **§14 test items:** **#8** status enums reject invalid; **#9** direction supports `our_objection_to_their_evidence`;
  **#10** direction supports `their_anticipated_objection_to_our_evidence`; **#11** `our_response_short_version`
  required when `direction=their_anticipated_objection_to_our_evidence`. (**#12** DB uniqueness → **PTA-09**, NOT here.)
- **§15 acceptance:** **#10** enter/view cross-exam opinions for authenticity/legality/relevance/probative-force;
  **#11** cross-exam supports both our objections and our anticipated response to objections against our evidence.
- **Umbrella §WI-PTA-06** (parent line 117-118) + **§"CrossExaminationOpinion" additive diff** (parent line 79-80):
  the promoted, cc-suite-reviewed breakdown — schema + validator + **conditional invariant in
  `src/cross-exam-invariants.ts`**; `_reason`/`overall_opinion`/`courtroom_short_version` marked `?`;
  `our_response_short_version: string|null`; no `rebuttal_evidence_ids`; DB UNIQUE deferred.

## Model purpose and observable behavior
`CrossExaminationOpinion` is the additive model that records a lawyer's structured cross-examination position on
one existing evidence item within one claim track, in one of two directions: (1) **our objection** to opposing
evidence, or (2) **their anticipated objection** to our evidence **plus our prepared response**. It captures the
four courtroom dimensions — authenticity, legality, relevance, probative-force — each as a structured status +
free-text reason, plus an overall opinion, a courtroom-ready short version, and (direction-2 only) our short
response, under a preparation lifecycle.

**This WI is contract-only.** Observable behavior: the schema accepts valid opinions and rejects malformed ones
(bad enums, missing required keys, wrong primitives); `validateCrossExaminationOpinion` returns a typed
`ValidationResult<CaseBoxCrossExaminationOpinion>`; a **separate pure invariant helper** enforces the cross-field
rule that JSON Schema is kept flat for (mirroring `fact-invariants.ts`); the generated type, loader registration,
and package-root exports are present; `gen:types` is idempotent; the full contract suite stays green. **No
persistence, DB uniqueness, IPC, renderer, referential validation, or audit emission.**

## Exact field definitions, requiredness, enums, formats, relationships
Draft-2020-12 object schema, `$id`
`https://litigation-platform.local/case-box-contract/case-box-cross-examination-opinion.schema.json`, `title`
`CaseBoxCrossExaminationOpinion`, `$defs/ulid` = `^[0-9a-z]{26}$`, **open** (no `additionalProperties:false`, sibling
convention). **All declared keys required** (the established meaning of the umbrella `?` marker: required key,
`type:string`, empty allowed — matching ClaimTrack/EvidencePreparation). **21 required fields.**

Standard fields (6): `id` (ULID), `tenant_id` (string minLength 1), `actor_user_id` (string minLength 1),
`matter_id` (ULID), `created_at` (date-time), `updated_at` (date-time). CrossExaminationOpinion is a mutable
lifecycle entity → carries `updated_at` (umbrella standard-fields rule).

Entity fields (15):
- `claim_track_id`: ULID. By-value ref; referential existence is a later handler preflight, NOT a schema constraint.
- `evidence_id`: ULID. References an EXISTING `CaseBoxEvidenceItem.id`. By-value ref; existence + membership deferred.
- `direction`: `enum` = `our_objection_to_their_evidence | their_anticipated_objection_to_our_evidence`
  (frozen §3; test #9/#10). Frozen explicitly forbids an ambiguous `authored_by_side` field — direction is the
  only side-expression.
- `authenticity_status`, `legality_status`, `relevance_status`, `probative_force_status`: each `enum` =
  `admitted | denied | conditional | reserved | not_applicable` (frozen §3; test #8).
- `authenticity_reason`, `legality_reason`, `relevance_reason`, `probative_force_reason`: each `type:string`, empty
  allowed (required key). No conditional coupling to their paired status (frozen imposes none — see Open
  interpretation #2).
- `overall_opinion`: `type:string`, empty allowed.
- `courtroom_short_version`: `type:string`, empty allowed.
- `our_response_short_version`: `type: [string, null]` (nullable, required key). **Subject to the conditional
  invariant** (below) — the schema itself stays flat (no `if`/`then`), matching ClaimTrack's "no allOf/if" posture.
- `preparation_status`: `enum` = `draft | review_needed | ready_for_trial` (frozen §3; shared with
  LegalOpinionCard, PTA-07).

**No `sort_order`** — neither frozen §3 nor the umbrella §diff lists one for this model (unlike ClaimTrack /
EvidencePreparation). Do NOT invent it. **No `rebuttal_evidence_ids`** (frozen §3 explicit exclusion).

**Relationships:** `matter_id`, `claim_track_id`, `evidence_id` are ULID references validated for SHAPE only. No
cross-entity existence, no `(claim_track_id, evidence_id, direction)` uniqueness (DB), no party check — all deferred.

## Conditional invariant (the architectural difference from PTA-04/05)
The cross-field rule is **strict iff** (honoring the umbrella §diff "required iff" wording AND the field
semantics): **`our_response_short_version` MUST be a non-empty string when
`direction=their_anticipated_objection_to_our_evidence`, and MUST be null/empty otherwise.** Rationale:
`our_response_short_version` is *our prepared response to an anticipated objection against OUR evidence*; under
`direction=our_objection_to_their_evidence` (we are objecting to opposing evidence) there is no such objection to
respond to, so a response is not merely optional — it is not applicable. The rule is enforced by a **separate pure
TS helper** `src/cross-exam-invariants.ts`, NOT by the JSON schema. This mirrors the established
`src/fact-invariants.ts` precedent (cross-field logic the flat schema deliberately does not carry;
`validate<X>` = schema-only, `assert<X>Invariants` = throws on violation).

- New file `src/cross-exam-invariants.ts` exports:
  - a typed error class `CrossExaminationInvariantError` (mirroring `FactPromotionInvariantError`);
  - a pure function `assertCrossExaminationOpinionInvariants(opinion)` that throws `CrossExaminationInvariantError`
    in **both** violation directions:
    - `direction === "their_anticipated_objection_to_our_evidence"` AND `our_response_short_version` is null or an
      empty/whitespace-only string → throw (our prepared response is mandatory for direction-2; frozen §3 lines
      228-232);
    - `direction === "our_objection_to_their_evidence"` AND `our_response_short_version` is a non-empty
      (non-whitespace) string → throw (a prepared response is not applicable when we are objecting to their
      evidence; enforces the "iff").
- `validateCrossExaminationOpinion(payload)` stays schema-only (returns `ValidationResult`), exactly like
  `validateClaimTrack`/`validateFact`. The invariant is a **separate** exported assert (like `assertValidNewFact`),
  so callers compose "shape-valid AND invariant-holds". Test #11 exercises **all four** cases: direction-2
  null/empty → throws; direction-2 non-empty → ok; direction-1 null/empty → ok; direction-1 non-empty → throws
  (the strict-iff guard).

## Exact anticipated files and generated artifacts
Mirrors the WI-PTA-05 footprint plus the invariants file.
- **NEW** `docs/contracts/case-box-contract/schemas/case-box-cross-examination-opinion.schema.json`.
- **NEW** `docs/contracts/case-box-contract/src/validateCrossExaminationOpinion.ts` (mirror
  `validateClaimTrack.ts` ~21 lines; schema-only).
- **NEW** `docs/contracts/case-box-contract/src/cross-exam-invariants.ts` (mirror `fact-invariants.ts`; error class
  + pure `assertCrossExaminationOpinionInvariants`).
- **NEW (generated)** `docs/contracts/case-box-contract/src/generated/case-box-cross-examination-opinion.ts`
  (from `gen:types`; `AUTO-GENERATED` banner; interface `CaseBoxCrossExaminationOpinion`).
- **EDIT** `docs/contracts/case-box-contract/scripts/gen-types.mjs` — append one entry
  `{ schema: "case-box-cross-examination-opinion.schema.json", name: "CaseBoxCrossExaminationOpinion", out: "case-box-cross-examination-opinion.ts" }`.
- **EDIT** `docs/contracts/case-box-contract/src/loadSchemas.ts` — import + export `crossExaminationOpinionSchema`.
- **EDIT** `docs/contracts/case-box-contract/src/index.ts` — export `validateCrossExaminationOpinion`; export type
  `CaseBoxCrossExaminationOpinion`; export `assertCrossExaminationOpinionInvariants` +
  `CrossExaminationInvariantError` from `./cross-exam-invariants.js`; import `rawCrossExaminationOpinionSchema` +
  `export const crossExaminationOpinionSchema = deepFreeze(structuredClone(rawCrossExaminationOpinionSchema))`.
- **EDIT** `docs/contracts/case-box-contract/tests/contract.test.mjs` — CrossExaminationOpinion block (valid/invalid
  single fixtures + table-driven required-field omission derived from `schema.required`, malformed-ULID for the 4
  ULID fields, wrong-primitive for every field drift-guarded, enum-reject for direction/4 statuses/preparation_status,
  null-on-non-nullable, `our_response_short_version` null-accept + non-string reject, schema-shape guard [21 required,
  open, no allOf/if, enum contents]).
- **EDIT** `docs/contracts/case-box-contract/tests/validators.test.mjs` — import `validateCrossExaminationOpinion` +
  `assertCrossExaminationOpinionInvariants`; happy path + error path; **strict-iff conditional-invariant** tests
  (direction-2 null/empty → throws `CrossExaminationInvariantError`; direction-2 non-empty → ok; direction-1
  null/empty → ok; **direction-1 non-empty → throws** [strict-iff guard]).
- **EDIT** `docs/contracts/case-box-contract/tests/exports.test.mjs` — add `validateCrossExaminationOpinion` +
  `assertCrossExaminationOpinionInvariants` to `expectedFns`; `crossExaminationOpinionSchema` to `expectedObjects`.
- **NEW** fixtures `docs/contracts/case-box-contract/fixtures/{valid,invalid}/cross-examination-opinion-*.json`
  (synthetic; no real client data). Valid: direction-1 canonical (our objection; `our_response_short_version:null`);
  direction-2 canonical (anticipated objection; non-empty response); all-status-values coverage; empty-reasons/opinion;
  unexpected-property (open). Invalid: bad direction, bad each-status, bad preparation_status, missing claim_track_id,
  missing evidence_id, malformed evidence_id, wrong-type our_response_short_version. (The conditional-invariant
  violation is exercised via the TS assert in validators.test.mjs, not a schema fixture, since the flat schema does
  not carry the rule.)

## Impact analysis (per surface)
- **Schema/contract:** one new open schema + validator + **invariant helper** + generated type + exports + fixtures.
  Additive; no existing schema touched.
- **Persistence:** NONE this WI. `(claim_track_id, evidence_id, direction)` DB UNIQUE + `case_box_cross_examination_opinions`
  table are **WI-PTA-09** (persistence v14).
- **Audit:** NONE this WI. `cross_examination_opinion` `entity_type` + `CROSS_EXAM_OPINION_*` `event_kind`s were
  landed by **WI-PTA-03** (audit vocabulary); this WI does not touch `case-box-audit-event.schema.json`.
- **IPC / renderer / migration:** NONE. Read/write channels PTA-11/12; UI PTA-13/14/15/16; migration PTA-09.
- **Package publication (checked-in desktop tarball):** see §"Package-publication analysis" — a follow-up
  **WI-PTA-06b** is expected.

## Explicit exclusions / deferred work
- **No DB uniqueness** on `(claim_track_id, evidence_id, direction)` (test #12) — WI-PTA-09.
- **No `rebuttal_evidence_ids`** on this model (frozen §3 explicit) — rebuttal linkage is a LegalOpinionCard
  concern (PTA-07: `stage=cross_examination`, `opposing_evidence_ids`/`supporting_evidence_ids`).
- **No referential existence checks** (claim_track_id / evidence_id) — later handler preflight.
- **No `authored_by_side` field** (frozen §3 explicit — direction is the only side-expression).
- **No persistence, migration, IPC, preload, renderer, i18n, audit emission.**
- **No new evidence IDs; no change to `CaseBoxEvidenceItem`/Matter/ClaimTrack/EvidencePreparation.**
- **No LegalOpinionCard** (WI-PTA-07) — do not pull PTA-07+ models forward.
- **No Matter embedding** of CrossExaminationOpinion.
- **No desktop tarball / manifest / lockfile mutation** in THIS WI (that is WI-PTA-06b).

## Test matrix (mapped to frozen items)
| Frozen | Assertion | Coverage in this WI |
|---|---|---|
| Test #8 | status enums reject invalid | bad-status invalid fixtures (one per dimension) + table-driven enum-reject over the 4 status fields |
| Test #9 | direction `our_objection_to_their_evidence` | direction-1 valid fixture accepts |
| Test #10 | direction `their_anticipated_objection_to_our_evidence` | direction-2 valid fixture accepts |
| Test #11 | `our_response_short_version` required iff direction-2 (**strict iff**) | **invariant all cases** in validators.test.mjs: direction-2 null/empty → `assertCrossExaminationOpinionInvariants` throws; direction-2 non-empty → ok; direction-1 null/empty → ok; direction-1 non-empty → throws (strict-iff guard) |
| Acceptance #10 (contract **precondition**, not UI closure) | model supports all four dimensions for enter/view | all 8 dimension keys present + validated (4 status enums + 4 reason strings). UI enter/view is PTA-14; this WI proves only the contract precondition |
| Acceptance #11 (contract **precondition**, not UI closure) | model supports both objection directions | both direction enum values validate; both valid fixtures present. UI display is PTA-14/16 |
| (shape) | required-key + wrong-primitive + enum drift guards | table-driven over `schema.required` / `schema.properties` / actual enums |
| Deferred #12 | `(claim_track_id, evidence_id, direction)` UNIQUE | **NOT here** — WI-PTA-09 (recorded as deferred) |

## Generation-idempotence requirements
`npm run gen:types` twice yields byte-identical `src/generated/case-box-cross-examination-opinion.ts` (before/after
SHA-256 match), banner + open-interface `[k:string]: unknown` tail matching siblings. Contract suite total increases
from the current 512 by the CrossExaminationOpinion tests; report the actual final number (do not assert a guess).

## Compatibility and rollback
- **Additive, isolated:** one new schema + validator + invariant helper + generated type + fixtures + narrow export
  edits. No existing schema/generated/persistence/desktop code changes. Existing contract consumers unaffected.
- **Rollback:** a single revertable contract commit (`git revert`). No migration, no artifact, no cross-package coupling.

## Stop conditions
STOP before committing if: any existing schema (evidence-item, matter, party, audit-event, claim-track,
evidence-preparation) is modified; any persistence/IPC/renderer/migration file is touched; DB uniqueness or
referential validation is implemented; the conditional invariant is put in the JSON schema instead of the TS helper
(scope/architecture drift) without reviewer authorization; the write set exceeds the contract files listed above;
`gen:types` is non-idempotent; or the desktop tarball/manifest/lockfile changes (that is WI-PTA-06b).

## Package-publication analysis (separate; PTA-06b expected)
The desktop app consumes the CHECKED-IN tarball `dist-tarballs/case-box-contract-0.1.0.tgz` (+ manifest + lock
integrity), gated by `check-internal-tarballs`. **Landing CrossExaminationOpinion source will STALE that tarball**
(new schema + validator + invariants + generated `.js`/`.d.ts` + fixtures + index/loadSchemas export drift), turning
the desktop gate red — exactly as PTA-04/05 did. **Recommendation:** do NOT fold artifact publication into this
source WI; after WI-PTA-06 merges, open a separate, independently-reviewed **WI-PTA-06b** (mirroring 04b/05b:
sanctioned `pack:internal → refresh:internal-tarballs → check:internal-tarballs`; persistence byte-identity STOP +
`packedAt` normalization; contract-only 3-file write set; direct-tarball payload proof; idempotence).

## Open interpretations (flagged for review)
1. **Strict-iff vs lenient conditional — RESOLVED to strict-iff** (review-plan `review-plan-ms4adsar-1rn379`
   Medium). The umbrella §diff wording is "required iff", and the field semantics agree (`our_response_short_version`
   is *our response to an anticipated objection against OUR evidence*, which is not applicable under
   `direction=our_objection_to_their_evidence`). The invariant therefore enforces BOTH directions: direction-2
   requires a non-empty response; direction-1 forbids a non-empty response. This removes the earlier internal
   inconsistency (docket text vs helper vs this section now all agree on strict-iff). No umbrella supersession is
   needed — strict-iff matches the umbrella "iff".
2. **`_reason` ↔ status coupling.** Frozen imposes no rule that a `_reason` be non-empty when its status is
   `denied`/`conditional`/etc. Proposed: `_reason` fields are plain required-key empty-allowed strings, NO conditional
   coupling. Reviewer to confirm.
3. **Empty-string vs whitespace for the invariant.** Proposed: the invariant treats null, `""`, and
   whitespace-only as "absent" for direction-2 (a whitespace response is not a prepared response). Reviewer to confirm
   (vs treating any non-null string as present).
4. **`additionalProperties`.** Adopt the sibling open-schema convention (no `additionalProperties:false`); confirm
   against evidence-item/claim-track/evidence-preparation at implementation.

## Sequencing note (non-blocking)
Dependency is WI-PTA-04 (ClaimTrack, satisfied — merged) for the `claim_track_id` ref and WI-PTA-05
(EvidencePreparation, merged) as the immediate predecessor pattern. WI-PTA-06 does not depend on PTA-05's
persistence (none exists yet). The audit vocabulary this model will eventually emit (`CROSS_EXAM_OPINION_*`) was
landed by PTA-03; this contract WI does not touch it.

## Review record (cc-suite review-plan)
- Job `review-plan-ms4adsar-1rn379` (Path 1 runner `codex-runner.mjs` @ `0.2.18`, gpt-5.5/high/read-only) —
  **verdict: NEEDS-FIX**, all findings applied:
  - **Medium** — the conditional semantics were internally inconsistent (docket text "required iff / MUST be
    null/empty otherwise" vs a helper that no-op'd direction-1 vs Open #1 proposing lenient). → **fixed**: resolved
    to **strict iff** (honoring the umbrella "iff" + field semantics — see §"Conditional invariant" and Open
    interpretation #1). The helper now throws in BOTH directions; test #11 covers all four cases including the
    direction-1-non-empty guard; validators.test.mjs plan updated.
  - **Low** — §15 acceptance mapping ("all 8 dimension keys present" = enter/view) was a category error for a
    contract-only WI. → **fixed**: the test-matrix rows for acceptance #10/#11 are re-labelled "contract
    **precondition**, not UI closure" (UI enter/view is PTA-14/16).
  - Confirmed by the reviewer: 21-required field set correct (17 frozen §3 model fields + 4 standard); no
    `sort_order`/`authored_by_side`/`rebuttal_evidence_ids`; flat-schema + separate-TS-invariant architecture is
    right; deferrals correct (DB UNIQUE → PTA-09, referential → handler, no IPC/renderer/audit/tarball).
- Re-review after fixes: job `review-plan-ms4aii7r-dimxl0` (Path 1 runner `codex-runner.mjs` @ `0.2.18`,
  gpt-5.5/high/read-only) — **verdict: READY**; both prior findings confirmed resolved; all 10 original review
  dimensions hold; one non-blocking wording nit ("all three cases" → "all four cases") fixed. This docket is
  authorized for implementation of exactly its scope.
