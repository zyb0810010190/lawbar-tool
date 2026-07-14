# WI-PTA-03 — Implementation scope: existing-contract additive touch (audit vocabulary + party identity)

**Parent:** `dev-memo/plan-pretrial-trial-addon-01.md` (READY umbrella; decisions #1, #3, #11). **Frozen spec:**
`dev-memo/plan/pretrial-trial-addon-01-frozen.md` §1/§11/§12. **Type:** SOURCE/contract, **HIGH-RISK** (governed
audit vocabulary + contract-schema expansion) → cc-suite `review-plan` required before implementation. **Branch:**
`feature/pretrial-trial-addon-01` @ `6bd8c4c`. **No** persistence / IPC / UI / feature-model work in this WI.

## Review packet (compact)

**1. Summary.** Additively extend the *existing* contracts so the four future preparation models can be audited
and can reference parties by id — WITHOUT adding any of those models yet. Three schema edits + their generated
types + the two exhaustive consumers + fixtures + guard-test updates. Strictly additive: every existing fixture
still validates; the additive `delete-hard` action is distinct from `delete-soft`.

**2. Exact target files.**
- `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json` — `action` += `delete-hard`;
  `entity_type` += `claim_track, evidence_preparation, cross_examination_opinion, legal_opinion_card`;
  `event_kind` += the **18** kinds below.
- `docs/contracts/case-box-contract/schemas/case-box-party.schema.json` — optional `id: ULID` (NOT in `required`).
- `docs/contracts/case-box-contract/schemas/case-box-matter.schema.json` — optional `id: ULID` in `$defs.party`
  (NOT in `required`).
- `docs/contracts/case-box-contract/src/audit-log.ts` — `CASE_BOX_AUDIT_ENTITY_TYPES` (+4);
  `CASE_BOX_AUDIT_EVENT_KINDS` (+18 `{action, entity_type, reasonRequired}` metas).
- `docs/contracts/case-box-contract/src/generated/*` — regenerated via `npm run gen:types` (no hand-edit).
- `docs/contracts/case-box-contract/fixtures/{valid,invalid}/*` — add: a party fixture carrying `id`; audit-event
  fixtures for a representative new kind (create / update / **delete-hard**) per new entity; keep the existing
  id-less party/matter fixtures unchanged (they must still validate).
- `docs/contracts/case-box-contract/tests/validators.test.mjs` — its hard-coded schema-action drift guard
  (`SCHEMA_ACTIONS`) must gain `delete-hard` (better: derive it from the schema `action` enum so future additive
  action changes cannot silently drift). (review-plan Med #1.)
- `apps/lawbar-desktop/renderer/i18n/labels.ts` — `eventKindLabel` gains the 18 labels; `entityTypeLabel` (if it
  enumerates) gains 4.
- `apps/lawbar-desktop/renderer/i18n/catalog.ts` — zh-CN `eventKind.*` (+ entity-type) entries for the additions.

**3. Exact acceptance criteria.**
- Existing party AND matter fixtures **without** party ids still validate (frozen §12; decision #1).
- `delete-hard` is a distinct `action` value; `delete-soft` unchanged (decision #11).
- New `event_kind` metas: `*_CREATED→create`, `*_UPDATED / *_WITHDRAWN / *_RESOLVED / *_USED_IN_TRIAL_* /
  *_FOLLOW_UP_*→update`, `*_DELETED→delete-hard`; entity_type per model. **`reasonRequired:true` for the four
  `*_DELETED` kinds and for `CLAIM_TRACK_WITHDRAWN`** (destructive / legally-meaningful reversals, matching the
  existing treatment of soft-delete / unlink / dismissal / downgrade); `false` for the routine
  create/update/resolved/set/clear kinds (review-plan High #2). Align exactly with the existing precedent values
  (`DOCUMENT_SOFT_DELETED`, `LINK_UNLINKED`, `PRIVILEGE_MARKER_DISMISSED`, classification downgrade/reset) when
  implementing. NOTE: `DEADLINE_WITHDRAWN` is `reasonRequired:false` in the repo — do NOT cite it as a true-reason
  precedent (review-plan re-review).
- Audit hash-chain semantics (`event_count==COUNT==MAX(sequence)`) unaffected; `audit_schema_version:2` unchanged.
- All four guard suites green: contract `audit-event-kind-v2` + `exports` + `validators`; renderer
  `renderer-audit-labels` (label exhaustiveness over `CASE_BOX_AUDIT_EVENT_KINDS`) + `renderer-i18n` (catalog
  exhaustiveness).
- No feature model schema, no persistence migration, no IPC, no UI screen.

**4. Out-of-scope.** ClaimTrack / EvidencePreparation / CrossExaminationOpinion / LegalOpinionCard schemas
(PTA-04..07); persistence v13/v14 (PTA-08/09); `ensureMatterPartyIds` runtime (persistence PTA-08 / IPC PTA-12);
IPC, renderer feature screens, trial mode. Frozen §13 non-goals untouched.

**5. Essential references.** `src/audit-log.ts` (`CASE_BOX_AUDIT_EVENT_KINDS` `satisfies Record<string,
AuditKindMeta>` at L67–125, `CASE_BOX_AUDIT_ENTITY_TYPES` L28); `case-box-audit-event.schema.json` (action=8,
entity_type=10, event_kind=53, `audit_schema_version` const 2); `labels.ts` `eventKindLabel` L264 (TYPE-import
only, exhaustive); `tests/audit-event-kind-v2.test.mjs`; `renderer-audit-labels.test.mjs`; `renderer-i18n.test.mjs`.

**6. Review questions.**
1. Are the 18 kind→(action, entity_type) mappings correct and complete for the four models, and is
   `*_DELETED→delete-hard` (vs `delete-soft`) the right choice given ClaimTrack's guarded hard-delete needs
   referenced prep/cross-exam/card cleared first (frozen §8)?
2. Should any new kind set `reasonRequired:true` (e.g. `CLAIM_TRACK_DELETED` / `CLAIM_TRACK_WITHDRAWN`), by
   analogy with `PRIVILEGE_MARKER_DISMISSED` / classification downgrades — or is `false` correct for a manual
   local-first prep layer?
3. Is optional `Party.id` in BOTH `case-box-party.schema.json` and `CaseBoxMatter.$defs.party` safe — existing
   id-less fixtures still valid, no consumer assumes a party id — and is it right that ClaimTrack's
   reject-unknown-party validation is deferred to PTA-12 (not this WI)?
4. Is the additive-vs-exhaustive split correct: schema enums additive, `audit-log.ts` metas additive,
   `labels.ts`/`catalog.ts` updated to keep the exhaustiveness guards green, generated types regenerated (not
   hand-edited)?
5. Any hidden consumer of `action` / `entity_type` / `event_kind` (beyond audit-log.ts + labels.ts + catalog.ts)
   that an additive enum growth would break?

## The 18 additive event kinds

| kind | action | entity_type |
|---|---|---|
| CLAIM_TRACK_CREATED | create | claim_track |
| CLAIM_TRACK_UPDATED | update | claim_track |
| CLAIM_TRACK_WITHDRAWN | update | claim_track |
| CLAIM_TRACK_RESOLVED | update | claim_track |
| CLAIM_TRACK_DELETED | delete-hard | claim_track |
| EVIDENCE_PREPARATION_CREATED | create | evidence_preparation |
| EVIDENCE_PREPARATION_UPDATED | update | evidence_preparation |
| EVIDENCE_PREPARATION_DELETED | delete-hard | evidence_preparation |
| CROSS_EXAM_OPINION_CREATED | create | cross_examination_opinion |
| CROSS_EXAM_OPINION_UPDATED | update | cross_examination_opinion |
| CROSS_EXAM_OPINION_DELETED | delete-hard | cross_examination_opinion |
| LEGAL_OPINION_CARD_CREATED | create | legal_opinion_card |
| LEGAL_OPINION_CARD_UPDATED | update | legal_opinion_card |
| LEGAL_OPINION_CARD_DELETED | delete-hard | legal_opinion_card |
| LEGAL_OPINION_CARD_USED_IN_TRIAL_SET | update | legal_opinion_card |
| LEGAL_OPINION_CARD_USED_IN_TRIAL_CLEARED | update | legal_opinion_card |
| LEGAL_OPINION_CARD_FOLLOW_UP_SET | update | legal_opinion_card |
| LEGAL_OPINION_CARD_FOLLOW_UP_CLEARED | update | legal_opinion_card |

(**18 rows.** `reasonRequired:true` for `CLAIM_TRACK_DELETED`, `EVIDENCE_PREPARATION_DELETED`,
`CROSS_EXAM_OPINION_DELETED`, `LEGAL_OPINION_CARD_DELETED`, and `CLAIM_TRACK_WITHDRAWN`; `false` for the other 13.)

## Party.id — contract-only in this WI (explicit deferral)

Adding optional `Party.id` here is a pure contract expansion. **Deferred to later WIs, NOT this one:** the
`ensureMatterPartyIds` backfill runtime (persistence PTA-08), its IPC exposure + ClaimTrack reject-unknown-party
validation (PTA-12), and any renderer DTO exposure/acceptance of party ids. No renderer DTO or handler is touched
in WI-PTA-03. (review-plan Med #2.)

## Tests to add / update
- Contract `audit-event-kind-v2.test.mjs`: assert each new kind's meta (action/entity_type) + that `delete-hard`
  is accepted by the schema + a delete-hard audit event validates + hashes into the chain.
- Contract fixtures: a valid party-with-`id`; existing id-less party/matter fixtures asserted still-valid.
- Renderer `renderer-audit-labels.test.mjs` + `renderer-i18n.test.mjs`: exhaustiveness stays green with the 18
  new labels/catalog entries.
- Contract `state-machine.test.mjs`: its entity_type schema-vs-TS drift guard must accept the 4 new entity_types
  (review-plan re-review Q5 hidden consumer).

## Verification
`npm --prefix docs/contracts/case-box-contract test` · `npm --prefix apps/lawbar-desktop test`.

## Review record (cc-suite review-plan, Path 1 runner cc-suite/0.2.18, gpt-5.5/high/read-only)

The scope below was reviewed across three passes. **Verdicts are preserved exactly as returned — all three are
`NEEDS-FIX`.** They are NOT restated as `READY`.

| Pass | Job ID | Verdict (verbatim) | Findings → disposition |
|---|---|---|---|
| 1 | `review-plan-mrkr4h6n-uzm0qp` | **NEEDS-FIX** | High: "19" vs 18-row table → **fixed** (18). High: `reasonRequired:false` for all too weak → **fixed** (`true` for the four `*_DELETED` + `CLAIM_TRACK_WITHDRAWN`). Med: `validators.test.mjs` `SCHEMA_ACTIONS` drift guard → **added to scope**. Med: `Party.id` runtime/DTO deferral → **made explicit**. Low: keep full package suites as gates → **already listed**. |
| 2 | `review-plan-mrkrah33-ip3psr` | **NEEDS-FIX** | Residual "19" in two spots → **fixed**. Wrong `DEADLINE_WITHDRAWN` (=`reasonRequired:false` in repo) cited as a true-reason precedent → **corrected** (cite `DOCUMENT_SOFT_DELETED`/`LINK_UNLINKED`/`PRIVILEGE_MARKER_DISMISSED`/classification downgrade-reset). Hidden consumer `state-machine.test.mjs` entity_type drift guard → **added to scope**. All substantive scope findings confirmed resolved. |
| 3 | `review-plan-mrkrdpd9-zmvd9z` | **NEEDS-FIX** | Confirmed the two text nits fixed and all substantive findings resolved. **Sole remaining objection:** the contract implementation (`delete-hard`, the 4 entity types, the 18 event kinds) "is not present at HEAD." |

### Human disposition of the pass-3 `NEEDS-FIX`
The pass-3 verdict remains **NEEDS-FIX** and is recorded as such. Its sole remaining objection checks for
*implementation artifacts at repository HEAD*, but this review-plan was **intentionally performed before
implementation** (it is the pre-implementation scoping gate, not a post-implementation audit). The objection is
therefore **non-actionable for scope approval** — it is not "resolved" by pretending the implementation already
exists; it will be discharged only when WI-PTA-03 is implemented and separately audited/verified. Every
*substantive scope* finding from passes 1–2 is resolved. On that basis the reviewed scope is **authorized for
implementation by explicit human determination (user, 2026-07-14)**, despite the nominal NEEDS-FIX verdict. This
scope commit contains **no implementation files** — only this governance/scope artifact.
