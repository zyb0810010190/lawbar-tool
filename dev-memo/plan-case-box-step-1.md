# CASE-BOX Step 1 — Plan (case-box-contract package)

**Status**: implementing.
**Date**: 2026-05-20.
**Authorizes**: code WI per `docs/adr/case-box-step-0-boundary.md` Step-1.
**Out of scope**: persistence, ingestion, review, UI, sync bridge, auth, cloud, LLM, framework choice, OCR worker changes.

---

## 1. Location

`docs/contracts/case-box-contract/` — sibling to the existing OCR contract (which lives at `docs/contracts/` directly). The two coexist:

```
docs/contracts/
├── package.json                      (ocr-worker-contract — UNCHANGED)
├── src/                              (OCR — UNCHANGED)
├── schemas/                          (OCR — UNCHANGED)
├── ...
└── case-box-contract/                (NEW — this WI)
    ├── package.json
    ├── tsconfig.json
    ├── scripts/gen-types.mjs
    ├── schemas/
    ├── src/
    ├── fixtures/
    ├── tests/
    └── README.md
```

This matches `docs/adr/case-box-step-0-boundary.md` §1 stated layout. OCR contract stays put at `docs/contracts/`; the case-box contract nests one level deeper for now (monorepo move is a future concern).

## 2. Package manifest

- name: `case-box-contract`
- private: true
- type: module
- main: `./dist/index.js`
- types: `./dist/index.d.ts`
- exports: `.` and `./schemas/*`
- engines: node `>=22.0.0` (JSON import attributes, parity with `ocr-worker-contract`)
- dependencies: `ajv@^8.17.1`, `ajv-formats@^3.0.1` (parity with OCR contract; established repo convention; justified per user-spec "no runtime deps unless justified")
- devDependencies: `@types/node@^22.0.0`, `json-schema-to-typescript@^15.0.4`, `typescript@^5.6.0`
- scripts: `gen:types`, `build`, `prebuild`, `test`

## 3. Entities (v1 backbone — 7 entities)

| Entity | Schema file | Generated type | Validator |
|---|---|---|---|
| `CaseBoxMatter` | `case-box-matter.schema.json` | `case-box-matter.ts` | `validateMatter` |
| `CaseBoxDocument` | `case-box-document.schema.json` | `case-box-document.ts` | `validateDocument` |
| `CaseBoxParty` | `case-box-party.schema.json` | `case-box-party.ts` | `validateParty` |
| `CaseBoxDeadline` | `case-box-deadline.schema.json` | `case-box-deadline.ts` | `validateDeadline` |
| `CaseBoxEvidenceItem` | `case-box-evidence-item.schema.json` | `case-box-evidence-item.ts` | `validateEvidenceItem` |
| `CaseBoxOcrLink` | `case-box-ocr-link.schema.json` | `case-box-ocr-link.ts` | `validateOcrLink` |
| `CaseBoxAuditEvent` | `case-box-audit-event.schema.json` | `case-box-audit-event.ts` | `validateAuditEvent` |

Shared embedded shapes:
- **Actor identity** — every persisted shape has `actor_user_id: string`. The literal value `"local-user"` is the v1 sentinel for local-only mode. The schema does NOT enforce the literal (multi-user shape compatibility); the documentation + `isLocalOnlyActor()` helper marks it.
- **Tenant** — every persisted shape has `tenant_id: string`. Single tenant in v1; multi-tenant shape-ready.
- **Opt-in external flags** — `CaseBoxMatter.external_ocr_authorized`, `CaseBoxMatter.sync_grant_present`, `CaseBoxMatter.llm_extraction_opt_in`. All default `false`. v1 default workflow has all three false.

## 4. State machines

Four lifecycles. Each in its own file under `src/state-machines/`:

| Lifecycle | States | Notes |
|---|---|---|
| `matter-lifecycle` | `active`, `archived` | terminal-but-reversible per case-box-step-0; archive→active needs explicit unarchive |
| `document-lifecycle` | `registered`, `ocr_pending`, `ocr_complete`, `ocr_failed`, `triaged`, `tagged`, `reviewed` | linear-ish with branch at OCR outcome |
| `evidence-lifecycle` | `proposed`, `accepted`, `rejected`, `superseded` | accept can be superseded via chain |
| `deadline-lifecycle` | `pending`, `met`, `missed`, `withdrawn` | `missed → met` requires reason (transition flag) |

Single shared `transitions.ts` lists `ALLOWED_EDGES` per entity with `controlled_by` actor (one of `lawyer`, `coordinator`, `ingestion`, `review`). `assertValidTransition*` helpers throw `IllegalTransitionError`.

## 5. Validators

Per-entity validator pattern mirrors `validateOcrSubmission`:

```ts
export function validateX(payload: unknown): ValidationResult<X>
```

`ValidationResult<T>` = `{ ok: true, value: T } | { ok: false, summary, errors }`. Shared `ajv-instance.ts` + `result-types.ts` directly modeled on the OCR contract.

Plus semantic helpers (no IO):
- `isLocalOnlyActor(actor_user_id) → boolean` — returns true iff value is `"local-user"`; helper for upstream local-only enforcement.
- `assertCaseBoxIsSubordinateToOcr(link) → void` — structural check that `CaseBoxOcrLink` carries `direction: "read-only"` and `ocr_job_id` is opaque; throws `OcrSubordinationError` if shape implies write.
- `defaultsAreLocalFirst(matter) → boolean` — returns true iff `external_ocr_authorized === false && sync_grant_present === false && llm_extraction_opt_in === false`.

## 6. Invariants encoded

Schema-encoded:
- `actor_user_id` required on every SoT shape.
- `tenant_id` required on every SoT shape.
- `external_ocr_authorized`, `sync_grant_present`, `llm_extraction_opt_in` are booleans with `default: false`.
- `CaseBoxOcrLink.direction` literal `"read-only"`.
- `CaseBoxAuditEvent.prev_event_hash` and `after_state_hash` present (chain shape; chain integrity = persistence's job).
- `CaseBoxDeadline.status === "met"` after `"missed"` requires `transition_reason` (encoded as conditional `if/then`).

Semantic-encoded (state machines + validators):
- Matter `jurisdiction` shape carries `locked` boolean; `locked === true` once any deadline exists; locking enforcement is persistence's job. Contract carries the shape only.
- Document `content_hash` immutable shape: marked `readOnly: true` in schema; runtime immutability is persistence's job.
- Evidence superseded chain: `supersedes_evidence_id` nullable; validator rejects shape where `status === "superseded"` without `supersedes_evidence_id`.
- OCR is subordinate: `CaseBoxOcrLink.direction === "read-only"` enforced by validator + schema literal.

## 7. Public surface

`src/index.ts` exports:

- Validators: `validateMatter`, `validateDocument`, `validateParty`, `validateDeadline`, `validateEvidenceItem`, `validateOcrLink`, `validateAuditEvent`.
- Transition helpers: `assertValidMatterTransition`, `assertValidDocumentTransition`, `assertValidEvidenceTransition`, `assertValidDeadlineTransition`, `isAllowedMatterTransition`, etc.
- Constants: `MATTER_STATES`, `DOCUMENT_STATES`, `EVIDENCE_STATES`, `DEADLINE_STATES`, `TERMINAL_MATTER_STATES` etc.
- Errors: `IllegalTransitionError`, `OcrSubordinationError`.
- Semantic helpers: `isLocalOnlyActor`, `defaultsAreLocalFirst`.
- Types (schema-derived): `CaseBoxMatter`, `CaseBoxDocument`, `CaseBoxParty`, `CaseBoxDeadline`, `CaseBoxEvidenceItem`, `CaseBoxOcrLink`, `CaseBoxAuditEvent`.
- Shared validation types: `ValidationResult`, `ValidationOk`, `ValidationErr`, `AjvErrorObject`.
- Deep-frozen schemas: `matterSchema`, `documentSchema`, etc. for downstream re-validation.

## 8. Fixtures

`fixtures/valid/` — one minimal valid example per entity.
`fixtures/invalid/` — one per entity, each with `_invalid_reason` + `_target_schema` metadata for the fixture sweep test (mirrors OCR fixture convention).

## 9. Tests (`tests/*.test.mjs`)

- `contract.test.mjs` — fixture sweep: every `fixtures/valid/*.json` passes its target schema; every `fixtures/invalid/*.json` fails its target schema.
- `validators.test.mjs` — per-validator: happy path returns `ok=true, value`; error path returns `ok=false` with non-empty `errors` and a sane `summary`.
- `state-machine.test.mjs` — every entity: legal transitions return ok; illegal transitions throw `IllegalTransitionError`; terminal-state self-transitions rejected; reason-required transitions enforced.
- `invariants.test.mjs` — local-first defaults: a matter with all three opt-in flags false reports `defaultsAreLocalFirst=true`; flipping any flag flips the helper; `isLocalOnlyActor("local-user") === true`; any other value returns false; `CaseBoxOcrLink.direction === "read-only"` enforced.
- `exports.test.mjs` — smoke import from `../dist/index.js`; assert every documented export is defined and of the expected typeof.

## 10. Build chain

Identical to OCR contract:
1. `npm install`
2. `npm run gen:types` → regenerates `src/generated/*.ts` from `schemas/*.json`.
3. `npm run build` → tsc emits `dist/`.
4. `npm test` → builds, then runs `node --test tests/*.test.mjs`.

Generated files committed (parity with OCR contract).

## 11. Risks / open items

- Schema cross-refs: v1 does NOT need cross-schema `$ref` between case-box schemas. If a future Step adds `CaseBoxFact` referencing `CaseBoxDocument`, the `contractIdResolver.mjs` pattern from OCR will need to be ported. Out of scope for Step 1.
- `actor_user_id` literal: schema does NOT pin to `"local-user"` to keep multi-user shape forward compat. The "local-only" judgment lives in `isLocalOnlyActor()` + persistence layer, not the contract. Captured in case-box-step-0-boundary.md §7.
- Audit hash chain: contract carries the SHAPE only. Chain integrity (replay-tamper-detection) is persistence's job per case-box-step-0.

## 12. Acceptance

- `npm --prefix docs/contracts/case-box-contract test` exits 0.
- `tsc -p docs/contracts/case-box-contract/tsconfig.json` exits 0.
- No runtime IO/network/cloud/auth dependencies introduced.
- Public surface lists every documented export.
- Existing OCR contract package tests still green.
- Existing services unchanged.
- AGENTS.md test-commands list updated to add the new package.
