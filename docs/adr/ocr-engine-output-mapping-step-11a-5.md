# ADR: OCR Engine-Output Mapping + `OcrJobOutcome` Production Type (Step 11A.5 v0.1)

## Status

Accepted as **v0.1**. Pins the engine-INDEPENDENT core of the production
OCR worker contract: outcome shape, JSON Schema, composed validator, and
the two-layer idempotency rule. All engine-shaped mapping rules (reading
order, bbox space, rotation, confidence aggregation, error taxonomy,
empty-page semantics, field-by-field mapping for `raw_text` / `blocks` /
`words` / `review`) are explicitly **deferred to v1.0 amendment after
ADR-11A.1 bakeoff**.

This ADR introduces production contract artifacts (schema + validator +
type + fixtures + tests). It does NOT modify `services/` source files.
The `services/ocr-worker/src/*` swap from `FakeJobOutcome` to
`OcrJobOutcome` is a follow-up commit derivative of this ADR.

## Context

### State recap

| ADR | Status |
|---|---|
| 11A.0 — Source access + threat model | ✅ committed `926a322` |
| **11A.5 — Engine-output mapping + `OcrJobOutcome`** | **this ADR (v0.1)** |
| 11A.1 — Engine bakeoff | open |
| 11B — Runtime / transport | open |
| 11C — Implementation + tests | open |

ADR-11A.0 §11 acknowledges C3 debt: production source today imports
`FakeJobOutcome` and `processFakeOcrJob` from
`ocr-worker-contract/testing`. 11A.0 says the production `OcrJobOutcome`
type is **introduced by 11A.5** with field-by-field decision + JSON
Schema. This ADR closes that obligation for v0.1.

### The shape disagreement, reconciled

Three pre-existing documents pinned different `OcrJobOutcome` shapes:

| Source | Pinned shape |
|---|---|
| `dev-memo/real-ocr-worker-brainstorm.md` (Round-2 + Round-3 fix #1) | `{ statuses, results }` (2-field) |
| `dev-memo/adr-11-series-plan.md` step 1 | `{ job_id, statuses, results, terminal_state }` (4-field) |
| `docs/adr/ocr-real-worker-source-access-step-11a-0.md` §11 | "`FakeJobOutcome` minus `scenario`" = 4-field |

ADR-11A.0 §11 is the committed authoritative source. The 4-field shape
also matches the load-bearing runtime checks in
`services/ocr-worker/src/outcomeValidation.ts:46-67`, which actively
consume both `outcome.job_id` and `outcome.terminal_state`:

```ts
if (outcome.terminal_state !== lastTo) { return { ok: false, reason: ... }; }
if (outcome.job_id !== sub.job_id)      { return { ok: false, reason: ... }; }
```

The 2-field shape from the brainstorm is **rejected** by this ADR.

### Why v0.1, not v1.0

ADR-11A.1 (engine bakeoff) is the empirical step that surfaces what
each engine actually returns (PaddleOCR / RapidOCR / Tesseract differ
in reading-order primitives, bbox coordinate conventions, confidence
semantics, and rotation handling). Pinning mapping rules before that
evidence exists guarantees rework.

v0.1 pins only what is engine-independent — the OUTER outcome shape,
its schema, the composed validator, and the idempotency rule. v1.0
fills in the engine-shaped mapping rules.

## Decisions

### §1 `OcrJobOutcome` shape — 4 fields

```ts
export interface OcrJobOutcome {
  job_id: string;        // ULID; equals submission.job_id
  statuses: TransitionRecord[];
  results: OcrResult[];
  terminal_state: OcrJobState;  // = statuses[last].to (verified projection)
}

export interface FakeJobOutcome extends OcrJobOutcome {
  scenario?: FakeScenario;
}
```

`terminal_state` is a **verified projection** of `statuses[last].to`,
NOT a free field. The composed validator (§3) rejects payloads where
`terminal_state` disagrees with the final transition. This lets the
validator detect sender-side drift between the stated terminal and the
actual transition chain, which is the function
`services/ocr-worker/src/outcomeValidation.ts` already performs at
runtime.

`FakeJobOutcome extends OcrJobOutcome` so the fake-worker test seam
remains a structural subtype of the production return type. Existing
call sites at 10E / 10F / 10G / 10K / 10L continue to compile under
the swap, which the follow-up commit performs.

### §2 JSON Schema — self-$id, cross-$ref for `results`, local `$defs/transitionRecord`

New file `docs/contracts/schemas/ocr-job-outcome.schema.json`:

- `$id`: `https://litigation-platform.local/contracts/ocr-job-outcome.schema.json`
- Required: `job_id`, `statuses`, `results`, `terminal_state`.
- `statuses`: array of `$defs/transitionRecord`, `minItems: 1`.
- `results`: array of `$ref` to
  `https://litigation-platform.local/contracts/ocr-result.schema.json#`
  (the OcrResult schema by `$id`). Element shape is the existing
  `OcrResult` contract — no fork.
- `terminal_state`: `$defs/state` enum (mirrors `transitions.ts`).
- `$defs`: `ulid`, `state`, `actor`, `transitionRecord`.

The `transitionRecord` and `state` / `actor` enum definitions are
declared **locally** rather than `$ref`d into `ocr-status.schema.json`,
because the status schema's transition record lives inside a
`oneOf` → `transitionSequence` → `properties.transitions.items`
chain and is not directly addressable by an external `$ref`.

The duplication risk is closed by the drift test in §6.

### §3 Composed validator — schema + sequence + per-result + terminal coherence

`docs/contracts/src/validateOcrJobOutcome.ts` runs four layers, in
order, short-circuiting on the first failure:

1. **Envelope schema.** Ajv compiles `outcomeSchema` against the
   shared package Ajv instance. The cross-`$ref` to
   `ocr-result.schema.json` resolves because the result schema is
   registered on the same instance before compile.
2. **Status transition sequence semantics.** Delegates to existing
   `validateOcrStatusTransitionSequence` (illegal-edge + actor
   ownership + terminal-state-exit rules).
3. **Per-result validity.** Loops `outcome.results[]` and delegates
   each element to existing `validateOcrResult`. Returns a
   `results[i]:`-prefixed error on first failure. (Schema layer 1
   already cross-validates via `$ref`; layer 3 is defense-in-depth
   plus explicit per-index error context.)
4. **Terminal coherence.** Asserts `outcome.terminal_state ===
   statuses[statuses.length - 1].to`. Returns a structured
   `semanticCoherence` error on mismatch.

**Out of scope here:** job/submission binding
(`outcome.job_id === submission.job_id`, per-result page binding).
That validator has external job context and lives in
`services/ocr-worker/src/outcomeValidation.ts`. A future refactor MAY
simplify `outcomeValidation.ts` by delegating layers 1–4 to
`validateOcrJobOutcome` and layering the binding checks on top. That
refactor is NOT in v0.1.

### §4 Idempotency — two layers, recognition pure, envelope contextual

The production OCR worker emits `OcrResult` payloads whose fields
split cleanly into:

- **Recognition layer** — `status`, `raw_text`, `blocks`, `words`,
  `review`, `page_confidence_summary`, `partial_failure`. MUST be a
  pure function of `(engine_output, model_version)`. The mapper MUST
  NOT consult clock, env, RNG, or network for these fields. Same
  inputs always produce same recognition output.

- **Envelope layer** — `contract_version`, `job_id`, `tenant_id`,
  `document_id`, `document_revision`, `page_id`, `page_number`,
  `engine.{name, version, model_set, preprocessing_applied}`,
  `page_metrics`, `metadata`, `completed_at`. Filled by the worker
  pipeline using job context + clock + engine identity. NOT pure
  across runs.

`OcrResult` is contract-required to carry both layers. Mapper purity
applies to recognition fields only.

**Persistence replay behavior is unchanged in v0.1.** The current
`saveOcrResultOnce` semantic (`inMemoryRepo.ts:262-270`,
`SqliteOcrPersistence.ts:565,717`) compares the full payload via
`deepEquals`; envelope drift on a replayed write throws "conflicting
duplicate result". This ADR does NOT relax that behavior.

**11C obligation (named here, not codified here):** the production
worker SHALL consult persistence for an existing `OcrResult` keyed by
`(job_id, page_id)` BEFORE re-emitting on a redelivered claim. If an
existing record is found, the worker returns the persisted record
verbatim rather than re-running the mapper. Recovery from
at-least-once redelivery is owned by the worker, NOT the mapper. The
coordinator's ADR-10C path-B (`claimed-but-unknown-job →
persistence_failed → requeue`) remains the cross-cutting safety net.

### §5 What v0.1 does NOT decide

- Reading order algorithm.
- bbox coordinate space conventions.
- Rotation / vertical text normalization.
- Confidence aggregation formula (page-level mean / min / weighted).
- Empty-page semantics.
- Error taxonomy → reason codes → `partial_failure.is_transient`
  mapping.
- Field-by-field mapping table for `raw_text` / `blocks` / `words` /
  `review` / `page_confidence_summary` / `engine.preprocessing_applied`.
- `saveOcrResultOnce` / `replaySafe` semantic change.
- Pre-process-check rule codification beyond naming it as a 11C
  obligation.
- Engine choice → ADR-11A.1.
- `WORKER_REGISTRY` allowlist → ADR-11B.
- Mapper or worker implementation → ADR-11C.

### §6 Drift guard for the locally-duplicated `transitionRecord`

Because `transitionRecord` is declared locally in
`ocr-job-outcome.schema.json` rather than `$ref`d from
`ocr-status.schema.json`, divergence is possible. The
`docs/contracts/tests/contract.test.mjs` drift test (v0.1 acceptance
bar) compares both definitions structurally:

- `required` field list (sorted).
- Each property (`from`, `to`, `controlled_by`, `at`, `note`).
- `state` enum.
- `actor` enum.

Adding a field to one definition without parity in the other fails
the test in v0.1, not v1.0.

### §7 Plumbing scope

This ADR ships first-class contract-package plumbing alongside the
decision, matching the existing pattern used for `OcrSubmission` /
`OcrResult` / `OcrStatus`:

- `docs/contracts/schemas/ocr-job-outcome.schema.json` — new.
- `docs/contracts/src/validateOcrJobOutcome.ts` — new, composed
  validator.
- `docs/contracts/scripts/gen-types.mjs` — items list extended; an
  offline `$refOptions.read` resolver maps the cross-`$ref` `$id` to
  its local file so `gen:types` works without network access. The
  exact resolver shape is an implementation detail — the binding
  constraint is that the generated `OcrJobOutcome["results"][number]`
  must be structurally equivalent to the generated `OcrResult`.
- `docs/contracts/src/loadSchemas.ts` — imports + re-exports
  `outcomeSchema`.
- `docs/contracts/src/index.ts` — re-exports `validateOcrJobOutcome`,
  `OcrJobOutcome`, and the deep-frozen `outcomeSchema`.
- `docs/contracts/fixtures/valid/ocr-job-outcome.example.json` —
  happy-path valid fixture (matched against `submission-s3.json`
  job_id by convention).
- `docs/contracts/fixtures/invalid/ocr-job-outcome-{missing-job-id,
  empty-statuses, terminal-state-bad-enum,
  statuses-element-malformed}.json` — schema-detectable invalid
  cases only.
- `docs/contracts/tests/contract.test.mjs` — extended schema-sweep
  + per-fixture rejection tests + drift test.
- `docs/contracts/tests/validators.test.mjs` — extended validator
  unit tests (happy path, schema-invalid per fixture, semantic
  cases for terminal-mismatch + illegal-edge + malformed-result
  built inline).

**Zero edits to `services/`.** The fake-worker / production-default
swap and the `outcomeValidation.ts` simplification are derivative
commits, not part of this ADR.

## Acceptance — 11A.5 v0.1 itself

| Criterion | Result |
|---|---|
| ADR file at `docs/adr/ocr-engine-output-mapping-step-11a-5.md` | ✅ |
| New schema at `docs/contracts/schemas/ocr-job-outcome.schema.json` | ✅ |
| Schema cross-`$ref`s `ocr-result.schema.json` by `$id`; offline resolver in `gen-types.mjs` | ✅ |
| Local `$defs/transitionRecord` byte-equivalent to status schema's nested transition shape (asserted by drift test) | ✅ |
| `OcrJobOutcome` 4-field shape, with `terminal_state` as a verified projection | ✅ |
| Composed validator: schema + sequence + per-result + terminal coherence | ✅ |
| Generated TS preserves `results: OcrResult[]` | ✅ |
| Zero edits to existing schemas | ✅ |
| Zero edits to `services/` | ✅ |
| All five package test suites green | ✅ |

## Consequences

- The follow-up commit swaps `services/ocr-worker/src/{types,
  outcomeValidation, adapter}.ts` from `FakeJobOutcome` to
  `OcrJobOutcome` and updates `services/ocr-worker/src/index.ts`
  public re-exports. That commit is derivative of this ADR.
- `outcomeValidation.ts` becomes a candidate for simplification —
  layers 1–4 of its current logic now live in
  `validateOcrJobOutcome`; only the binding checks need to stay
  external. The refactor is post-v0.1.
- ADR-11A.1 (engine bakeoff) inherits a fixed outcome shape. Mapping
  rules will be added as ADR-11A.5 v1.0 after bakeoff measures real
  engine outputs.
- ADR-11B inherits a frozen-at-the-shape contract.
- ADR-11C inherits the worker-side pre-process-check obligation
  (§4) and the v1.0-amended mapping rules (post-bakeoff).

## Non-goals (strict)

- Implement the mapper or fetcher.
- Pick the rasterization tool's exact API.
- Validate against real fixture pages.
- Pick the engine.
- Pin sidecar vs in-process.
- Define field-by-field engine→`OcrResult` mapping rules.
- Modify `services/ocr-worker/src/*.ts`.
- Modify `replaySafe` / `saveOcrResultOnce`.
- Introduce a redelivery cap / DLQ.
- Codify the worker pre-process-check rule beyond declaring it a
  11C obligation.
