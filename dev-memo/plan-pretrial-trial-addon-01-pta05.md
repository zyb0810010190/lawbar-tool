# WI-PTA-05 — Scope docket: EvidencePreparation contract schema

**Status:** REVIEWED — **READY** (cc-suite `review-plan` `review-plan-mrozkleu-0c45ew`, after NEEDS-FIX
`review-plan-mrozfjd4-ofmvac`; see §"Review record"). **Authorized for implementation of exactly this docket's
scope** — no scope beyond the target files + test matrix below. **Type:** SOURCE/contract, high-risk (governed
contract/schema expansion → cc-suite broker required per `.claude/rules/cc-suite.md` §"High-risk WIs"). **Branch:**
`feature/pretrial-trial-addon-05` @ `0391791` (clean synchronized `main`).
**Parent:** `dev-memo/plan-pretrial-trial-addon-01.md` (APPROVED umbrella) §"WI-PTA-05". **Predecessor:**
`dev-memo/plan-pretrial-trial-addon-01-pta04.md` (ClaimTrack contract, merged `bbf2a36` → published `3c2f828`).
**Frozen source of truth:** `dev-memo/plan/pretrial-trial-addon-01-frozen.md` §2 "Evidence preparation metadata"
(fields), §14 test items #5/#7, §15 acceptance #7/#8/#9.

## Authoritative frozen-spec references
- **§2 "Evidence preparation metadata"** (frozen lines 118-188): the field set, the `submitted_by_side` enum, the
  `facts_to_prove` array-of-short-strings rule, the `review_status` enum, the `(claim_track_id, evidence_id)`
  uniqueness constraint, and the "use existing evidence IDs; do not create new evidence IDs; do not replace the
  existing evidence model" rule.
- **§14 test items:** **#5** "Evidence preparation records link to existing evidence IDs"; **#7** "`facts_to_prove`
  is an array of short strings." (**#6** "`EvidencePreparation` is unique on `(claim_track_id, evidence_id)`" is a
  **DB** constraint → deferred to WI-PTA-08 persistence, NOT this contract WI.)
- **§15 acceptance:** **#7** "Evidence can be linked to a claim track without replacing the existing evidence
  record"; **#8** "Lawyers can enter or view evidence purpose and facts to prove"; **#9** "`facts_to_prove` is
  structured as an array of short strings."
- **Umbrella §WI-PTA-05** (parent line 114-115) + **§"EvidencePreparation" additive diff** (parent line 76-77) +
  **decision #2** (`submitted_by_side` read-time projection) — the promoted, cc-suite-reviewed breakdown that
  governs requiredness and nullability.

## Model purpose and observable behavior
`EvidencePreparation` is the additive metadata layer that links an EXISTING evidence record to a claim track for
pre-trial preparation, WITHOUT replacing the evidence model or minting new evidence IDs. It records, per
`(claim_track_id, evidence_id)` pairing: who submitted the evidence, its purpose, the facts it is meant to prove,
how it should be used at trial, a minimal page reference, and a review lifecycle. One evidence item may carry
preparation records on multiple claim tracks (main claim + counterclaim) — expressed as distinct rows sharing the
`evidence_id`.

**This WI is contract-only.** Observable behavior: the new schema accepts valid EvidencePreparation objects and
rejects malformed ones (bad enums, missing required keys, wrong primitives, over-length `facts_to_prove` items);
`validateEvidencePreparation` returns a typed `ValidationResult<CaseBoxEvidencePreparation>`; the generated type,
loader registration, and package-root exports are present; `gen:types` is idempotent; the full contract suite stays
green. **No persistence, DB uniqueness, IPC, renderer, referential validation, or audit emission.**

## Exact field definitions, requiredness, enums, formats, relationships
Draft-2020-12 object schema, `$id` `https://litigation-platform.local/case-box-contract/case-box-evidence-preparation.schema.json`,
`title` `CaseBoxEvidencePreparation`, mirroring the ClaimTrack precedent (`$defs/ulid` = `^[0-9a-z]{26}$`;
narrative strings are **required keys, `type:string`, empty allowed** — the established meaning of the umbrella
`?` marker, matching ClaimTrack's `claim_summary`/etc.). All keys present (`required`), following the ClaimTrack
"every key required; nullability only where semantics demand" pattern.

Standard fields: `id` (ULID), `tenant_id` (string, minLength 1), `actor_user_id` (string, minLength 1),
`matter_id` (ULID), `created_at` (date-time), `updated_at` (date-time).

Entity fields:
- `claim_track_id`: ULID. The claim track this preparation attaches to. Coarse by-value ref; referential existence
  is a later handler preflight, **not** a schema constraint.
- `evidence_id`: ULID. References an EXISTING `CaseBoxEvidenceItem.id` (frozen §2 "use existing evidence IDs").
  By-value ref; no schema-level cross-entity check (handler preflight later, WI-PTA-11/12).
- `submitted_by_side`: `enum` = `our_side | opposing_side | third_party | court_obtained | unknown | null`
  (nullable — decision #2). Authoritative when explicitly set; when `null`, a read-time projection from
  `CaseBoxEvidenceItem.party_side` is applied downstream (persistence/handler) and **never written back into the
  payload**. This WI stores the value verbatim including `null`; it does NOT implement the projection.
- `evidence_purpose`: `type:string`, empty allowed (required key).
- `facts_to_prove`: `type:array`, `items` = `{ type:string, minLength:1, maxLength:500 }`. Empty array allowed
  (a record may start with no facts); item-level `maxLength:500` enforces "short strings" (frozen §2 / test #7),
  stated explicitly in the schema `description`. See §"Open interpretations" #2.
- `trial_use_summary`: `type:string`, empty allowed (required key).
- `key_page`: `type: [integer, null]`, integer branch `minimum: 1` (nullable; §diff `key_page: int|null`).
  1-based page reference matching the existing `source_page_number` precedent (`case-box-fact.schema.json`,
  `case-box-docket-entry.schema.json` both `minimum:1`); `null` is the "unknown" value, so `0`/negative are
  invalid states, not compatibility. Minimal page reference — no DocumentPage FK / anchor / bounding-box
  (frozen §2 line 188).
- `key_page_note`: `type: [string, null]` (nullable; §diff `key_page_note: string|null`).
- `review_status`: `enum` = `draft | in_review | confirmed` (frozen §2).
- `sort_order`: `type:integer`, `minimum:0` (lawyer-controlled display order; mirrors ClaimTrack).

`additionalProperties`: follow the ClaimTrack/sibling precedent (open schema — no `additionalProperties:false`),
so the generated interface tails `[k: string]: unknown` like the other open entities. Confirm against the sibling
schemas at implementation time.

**Relationships (all coarse, schema-level only):** `matter_id`, `claim_track_id`, `evidence_id` are ULID
references validated for SHAPE only. No cross-entity existence, no `(claim_track_id, evidence_id)` uniqueness (DB),
no party-in-matter check — all deferred.

## Exact anticipated files and generated artifacts
Mirrors the WI-PTA-04 footprint exactly.
- **NEW** `docs/contracts/case-box-contract/schemas/case-box-evidence-preparation.schema.json`.
- **NEW** `docs/contracts/case-box-contract/src/validateEvidencePreparation.ts` (mirror `validateClaimTrack.ts`,
  ~21 lines: `getValidator()` compiles the schema → `ValidationResult<CaseBoxEvidencePreparation>`).
- **NEW (generated)** `docs/contracts/case-box-contract/src/generated/case-box-evidence-preparation.ts` (from
  `gen:types`; `AUTO-GENERATED` banner; interface `CaseBoxEvidencePreparation`).
- **EDIT** `docs/contracts/case-box-contract/scripts/gen-types.mjs` — append one entry
  `{ schema: "case-box-evidence-preparation.schema.json", name: "CaseBoxEvidencePreparation", out: "case-box-evidence-preparation.ts" }`.
- **EDIT** `docs/contracts/case-box-contract/src/loadSchemas.ts` — import + export `evidencePreparationSchema`.
- **EDIT** `docs/contracts/case-box-contract/src/index.ts` — `export { validateEvidencePreparation }`;
  `export type { CaseBoxEvidencePreparation }`; import `rawEvidencePreparationSchema` +
  `export const evidencePreparationSchema = deepFreeze(structuredClone(rawEvidencePreparationSchema))`.
- **EDIT** `docs/contracts/case-box-contract/tests/contract.test.mjs` — EvidencePreparation block (valid/invalid
  single fixtures + table-driven required-field omission derived from `schema.required`, malformed-ULID for the 3
  ULID fields, wrong-primitive for every field with a drift guard, enum-reject, `facts_to_prove` item over-length
  (501 chars) + non-string-item + null-item rejects. For the required **nullable** fields
  (`submitted_by_side`/`key_page`/`key_page_note`): **null-accept AND omission-reject** — since they are required
  keys, `null` is a valid value but ABSENCE must reject (omission covered by the schema-derived required-field
  table). `submitted_by_side` enum-reject; `key_page` `null`-accept plus `0`/negative reject (below `minimum:1`);
  negative `sort_order` reject).
- **EDIT** `docs/contracts/case-box-contract/tests/validators.test.mjs` — import + happy path + error path.
- **EDIT** `docs/contracts/case-box-contract/tests/exports.test.mjs` — add `validateEvidencePreparation` to
  `expectedFns` + `evidencePreparationSchema` to `expectedObjects`.
- **NEW** fixtures `docs/contracts/case-box-contract/fixtures/{valid,invalid}/evidence-preparation-*.json`
  (synthetic; no real client data). Valid: canonical, `submitted_by_side:null`, empty `facts_to_prove`,
  multi-track-same-evidence pair (two records sharing `evidence_id`, different `claim_track_id`), all-optional-empty.
  Invalid: bad `submitted_by_side`, bad `review_status`, missing `claim_track_id`, missing `evidence_id`,
  malformed `evidence_id`, `facts_to_prove` item at **501 chars** (over `maxLength:500`), non-string
  `facts_to_prove` item, non-integer `sort_order`, wrong-type `key_page`, `key_page: 0` and `key_page: -1`
  (below `minimum:1`), and an **omitted** required nullable field (e.g. `key_page_note` absent → reject).

## Impact analysis (per surface)
- **Schema/contract:** one new open schema + validator + generated type + exports + fixtures. Additive; no existing
  schema touched.
- **Persistence:** NONE this WI. `(claim_track_id, evidence_id)` DB UNIQUE + the `submitted_by_side` read-time
  projection + `case_box_evidence_preparations` table are **WI-PTA-08** (persistence v13).
- **Audit:** NONE this WI. `evidence_preparation` `entity_type` + `EVIDENCE_PREPARATION_*` `event_kind`s were
  landed by **WI-PTA-03** (audit vocabulary); this WI does not touch `case-box-audit-event.schema.json`.
- **IPC / renderer / migration:** NONE. Read/write channels WI-PTA-11/12; UI WI-PTA-13/14; migration WI-PTA-08.
- **Package publication (checked-in desktop tarball):** see §"Package-publication analysis" — a follow-up
  **WI-PTA-05b** is expected.

## Explicit exclusions / deferred work
- **No DB uniqueness** on `(claim_track_id, evidence_id)` (test #6) — WI-PTA-08.
- **No `submitted_by_side` read-time projection** logic — WI-PTA-08 (persistence) / WI-PTA-11 (handler). This WI
  stores `null` verbatim.
- **No referential existence checks** (claim_track_id / evidence_id / party) — later handler preflight.
- **No persistence, migration, IPC, preload, renderer, i18n, audit emission.**
- **No new evidence IDs; no change to `CaseBoxEvidenceItem`** (frozen §2 "do not replace the existing evidence
  model").
- **No CrossExaminationOpinion / LegalOpinionCard** (WI-PTA-06 / WI-PTA-07) — do not pull PTA-06+ models forward
  merely because they are structurally related.
- **No Matter embedding** of EvidencePreparation.
- **No desktop tarball / manifest / lockfile mutation** in THIS WI (that is WI-PTA-05b).

## Test matrix (mapped to frozen items)
| Frozen | Assertion | Coverage in this WI |
|---|---|---|
| Test #5 | prep links to existing evidence IDs | **contract-level `evidence_id` reference SHAPE only** — required ULID ref; valid fixture uses a ULID, malformed-`evidence_id` rejects. Proof that the referenced evidence ID *exists* is a handler/persistence preflight (WI-PTA-11/08), explicitly NOT this WI |
| Test #7 / Acceptance #9 | `facts_to_prove` array of short strings | `type:array` `items{string,minLength:1,maxLength:500}`; `501`-char over-bound + non-string-item invalid fixtures reject; empty-array valid fixture accepts |
| Acceptance #7 | evidence linked without replacing evidence record | schema references `evidence_id` by value; no `CaseBoxEvidenceItem` edit (verified: evidence-item schema untouched) |
| Acceptance #8 | enter/view purpose + facts | `evidence_purpose` + `facts_to_prove` present as keys |
| decision #2 | `submitted_by_side` nullable + enum | null-accept valid fixture; bad-value invalid fixture; enum exactly the 5 values + null |
| (shape) | required-key + wrong-primitive drift guards | table-driven over `schema.required` (asserts count) + wrong-primitive over every `properties` key (drift-guarded) |
| Deferred #6 | `(claim_track_id, evidence_id)` UNIQUE | **NOT here** — WI-PTA-08 (recorded as deferred) |

## Generation-idempotence requirements
`npm run gen:types` twice yields byte-identical `src/generated/case-box-evidence-preparation.ts` (before/after
SHA-256 match), and the generated file's `AUTO-GENERATED` banner + open-interface `[k:string]: unknown` tail match
the sibling generated entities. Contract suite total increases from the current 485 by the EvidencePreparation
tests; report the actual final number (do not assert a guessed count).

## Compatibility and rollback
- **Additive, isolated:** one new schema + validator + generated type + fixtures + narrow export edits. No existing
  schema, generated type, persistence, or desktop code changes. Existing contract consumers are unaffected.
- **Rollback:** a single revertable contract commit (`git revert`). No migration, no artifact, no cross-package
  coupling.

## Stop conditions
STOP before committing if: any existing schema (evidence-item, matter, party, audit-event, claim-track) is
modified; any persistence/IPC/renderer/migration file is touched; DB uniqueness or referential validation is
implemented; the `submitted_by_side` projection is implemented; the write set exceeds the contract files listed
above; `gen:types` is non-idempotent; or the desktop tarball/manifest/lockfile changes (that is WI-PTA-05b).

## Package-publication analysis (separate; PTA-05b expected)
The desktop app (`apps/lawbar-desktop`) consumes the CHECKED-IN tarball
`dist-tarballs/case-box-contract-0.1.0.tgz` (+ `manifest.json` + `package-lock.json` integrity), gated by
`check-internal-tarballs` (DESKTOP-DEPS-00), which asserts *committed tarball == fresh pack of current contract
source*. **Landing EvidencePreparation source in the contract package will STALE that tarball** (new schema +
validator `.js`/`.d.ts` + generated `.js`/`.d.ts` + fixtures + `index`/`loadSchemas` export drift), turning the
desktop gate red — exactly as WI-PTA-04 did before WI-PTA-04b republished it.

**Recommendation:** do NOT fold binary artifact publication into this source-model WI. After WI-PTA-05 merges,
open a separate, independently-reviewed **WI-PTA-05b** (mirroring WI-PTA-04b: sanctioned
`pack:internal → refresh:internal-tarballs → check:internal-tarballs`; persistence tarball byte-identity STOP;
contract-only manifest + lockfile-integrity write set; direct-tarball payload proof; idempotence). Alternatively,
if the desktop CI gate does not run on contract-only branches, PTA-05b may be batched with a later persistence WI
— to be decided at PTA-05b scoping, not here.

## Open interpretations (flagged for review)
1. **Frozen "Required fields" vs umbrella `?`/nullable.** Frozen §2 lists `submitted_by_side`, `evidence_purpose`,
   `trial_use_summary`, `key_page`, `key_page_note` under "Required evidence-preparation fields", while the umbrella
   §diff marks them `?`/`| null`. Resolution adopted (matching the ClaimTrack precedent): **all keys are present
   (`required`)**; narrative strings (`evidence_purpose`, `trial_use_summary`) are `type:string` empty-allowed;
   `submitted_by_side`/`key_page`/`key_page_note` are nullable. Reviewer to confirm this reconciliation.
2. **`facts_to_prove` item `maxLength`.** Frozen says "short strings" without a number. **Resolved (review-plan
   `review-plan-mrozfjd4-ofmvac` Low): `maxLength: 500`, `minLength: 1`**, stated explicitly in the schema
   `description`, with a `501`-char over-bound invalid fixture. A future tightening is a non-breaking follow-up.
3. **`key_page` minimum.** Frozen is silent, but the existing page-number schemas (`case-box-fact.schema.json`
   `source_page_number`, `case-box-docket-entry.schema.json`) both use `minimum: 1`. **Resolved (review-plan
   `review-plan-mrozfjd4-ofmvac` Medium): `type:["integer","null"]` with integer branch `minimum: 1`** — `null`
   already carries "unknown", so `0`/negative are invalid states, not compatibility. Tests: `null`-accept,
   `0`/negative-reject.
4. **`additionalProperties`.** Adopt the sibling open-schema convention (no `additionalProperties:false`); confirm
   against evidence-item/matter/claim-track at implementation.

## Sequencing note (non-blocking)
The umbrella orders WI-PTA-02 (characterization) → WI-PTA-03 → WI-PTA-04 → WI-PTA-05. In practice PTA-01, PTA-03,
PTA-03b, PTA-04, PTA-04b are delivered; **no `plan-pretrial-trial-addon-01-pta02.md` docket is present** in the
corpus. WI-PTA-05 is a pure additive contract schema and does **not** depend on PTA-02 characterization; its only
dependency is WI-PTA-04 (ClaimTrack, satisfied — merged `bbf2a36`, published `3c2f828`). Flagged so the reviewer
can confirm PTA-02's status is intentional and not a missed prerequisite.

## Review record (cc-suite review-plan)
- Job `review-plan-mrozfjd4-ofmvac` (Path 1 runner `codex-runner.mjs` @ `0.2.18`, gpt-5.5/high/read-only) —
  **verdict: NEEDS-FIX**, all findings applied:
  - **High** — the `contract.test.mjs` bullet said "null/absent-accept for the nullable fields", contradicting
    "all keys required". For required-but-nullable fields, `null` must ACCEPT and ABSENCE must REJECT → **fixed**:
    the test bullet + fixtures now state "null-accept AND omission-reject" (omission covered by the
    schema-derived required-field table).
  - **Medium** — Test #5 wording overclaimed referential proof → **fixed**: the test-matrix row now reads
    "contract-level `evidence_id` reference SHAPE only"; existence is reserved for the later handler/persistence
    preflight.
  - **Medium** — `key_page` should be `minimum: 1` (matching `source_page_number` in `case-box-fact` /
    `case-box-docket-entry`), since `null` already carries "unknown" → **fixed**: field def + Open interpretation
    #3 now specify `type:["integer","null"]` integer branch `minimum:1`, with `null`-accept + `0`/negative-reject
    tests.
  - **Low** — make the `facts_to_prove` `maxLength` explicit → **fixed**: `maxLength:500` in the schema
    `description` + a `501`-char over-bound invalid fixture (Open interpretation #2).
  - Category error acknowledged by the reviewer: "absence of implementation at HEAD is not a defect" for this
    pre-implementation plan.
- Re-review after fixes: job `review-plan-mrozkleu-0c45ew` (Path 1 runner `codex-runner.mjs` @ `0.2.18`,
  gpt-5.5/high/read-only) — **verdict: READY**; all four prior findings confirmed resolved; original 10 review
  dimensions still hold; one non-blocking editorial nit (a leftover `maxLength<BOUND>` in the test matrix) fixed to
  `maxLength:500`. This docket is authorized for implementation of exactly its scope.
