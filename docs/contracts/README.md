# OCR Worker Contract — Schemas, Fixtures, Validators, and Tests

This directory makes the OCR worker boundary **executable** before any OCR engine is implemented. It contains:

- The human-readable contract: [`ocr-worker-contract.md`](./ocr-worker-contract.md)
- JSON Schemas (machine-checkable shape rules) under [`schemas/`](./schemas) — **source of truth**
- TypeScript validators that wrap the schemas under [`src/`](./src), exposed as the package entry point
- Generated TypeScript types derived from the schemas under [`src/generated/`](./src/generated)
- Example payloads (valid + invalid) under [`fixtures/`](./fixtures)
- Contract tests that pin both shape and semantics under [`tests/`](./tests)

Until this repo becomes a proper monorepo, `docs/contracts/` itself **is** the OCR contract package. If/when a `packages/ocr-contract` location is created, move it as a single rename — the files here are already structured as a publishable package (`package.json`, `tsconfig.json`, `src/`, `dist/`).

The OCR engine itself is **out of scope here**. So is the queue, the database, the UI, and authentication. This package is purely about the wire-format contract between the web application and the OCR worker.

---

## How to run the tests

From this directory:

```bash
npm install
npm test           # builds dist/ then runs both test files
npm run build      # tsc-only build (regenerates types first)
npm run gen:types  # regenerate src/generated/*.ts from schemas/*.json
```

A single `npm test` invocation:

1. Regenerates `src/generated/*.ts` from `schemas/*.json` (`prebuild` hook).
2. Compiles TypeScript to `dist/` with `tsc`.
3. Compiles the three JSON Schemas with Ajv (draft 2020-12) at runtime.
4. Loads every fixture under `fixtures/valid/` and asserts it passes its target schema (both directly via Ajv in `tests/contract.test.mjs` and via the validator wrappers in `tests/validators.test.mjs`).
5. Loads every fixture under `fixtures/invalid/` and asserts it is rejected — and that the error points at the documented offense (e.g. priority out of range, malformed polygon, missing required field).
6. Runs the **semantic** rules that JSON Schema cannot express on its own: the status transition state machine, the transient-vs-permanent retry policy, and the higher-level retry classifier.

You should see something like `tests 38`, `pass 38`, `fail 0`. Any failure here means a contract drift — either a fixture, a schema, or the documented rule is wrong.

### Tooling choice

The smallest reasonable validation stack:

- **`ajv` + `ajv-formats`** (runtime) for JSON Schema validation. Ajv is the de facto standard, supports JSON Schema draft 2020-12, and `ajv-formats` adds `date-time` and `uri` which the contract uses.
- **`typescript`** (devDep) for the validator wrappers. tsc-only — no bundler, no dual ESM/CJS build. Output is ESM, target ES2022, module/moduleResolution NodeNext.
- **`json-schema-to-typescript`** (devDep) to derive TypeScript types from the schemas at build time. The schemas remain the source of truth; types are regenerated, never hand-written.
- **`node:test`** (built into Node ≥ 20) for the test runner. No Jest, no Mocha, no test-framework opinions to maintain.

If the parent web app later standardizes on a different JSON Schema library or test runner, these schemas (in `schemas/`) and fixtures (in `fixtures/`) are framework-agnostic and can be reused as-is.

---

## Importing the validators (recommended)

Once this package has been built (`npm run build`), application or worker code can import the validators directly:

```ts
import {
  validateOcrSubmission,
  validateOcrResult,
  validateOcrStatusEnvelope,
  validateOcrStatusTransitionSequence,
  assertValidOcrStatusTransition,
  classifyOcrFailureForRetry,
  type OcrSubmission,
  type OcrResult,
} from "ocr-worker-contract"; // or relative path until packaged
```

All validators return `{ ok: true, value }` or `{ ok: false, summary, errors }`. The `errors` array preserves Ajv error details (`instancePath`, `keyword`, `params`, `message`) so callers can pick a single offending field for UX or surface the full list for logs.

`assertValidOcrStatusTransition(from, to, controlledBy?)` is the throw-on-error variant for state-machine guards in queue handlers; it raises `IllegalTransitionError`.

`classifyOcrFailureForRetry({ status, failure, retry })` returns one of:

- `{ kind: "retry", attemptsRemaining, reason }` — transient and attempts remain
- `{ kind: "dead_letter", reason }` — permanent OR transient with attempts exhausted
- `{ kind: "not_failed", reason }` — status was not `"failed"`

The classifier does not enqueue or dead-letter; the caller owns queue mechanics.

### Web application

**On submission (web app → queue):**

1. Build the submission payload from your domain types.
2. Call `validateOcrSubmission(payload)` *before* enqueueing.
3. If `ok=false`, treat that as a programmer error — the worker would reject it and the job would dead-letter. Don't ship invalid jobs to the queue.

**On receiving a result (queue → web app):**

1. Call `validateOcrResult(payload)`.
2. Reject malformed results loudly. A worker emitting a malformed result is a worker bug; silently absorbing it loses the signal.
3. Use the typed `OcrResult.status` and `OcrResult.partial_failure` (contract §2.8) to decide success / failure / partial-success handling.

**For status updates:**

1. Call `validateOcrStatusEnvelope(payload)` for single observations.
2. Call `validateOcrStatusTransitionSequence(payload)` for full transition histories — this checks both shape AND semantics (chain integrity, allowed edges, actor ownership).
3. Use `assertValidOcrStatusTransition` as a guard in code that drives transitions.

### OCR worker

The worker should treat the schemas (and the typed validators) as the contract it has to satisfy:

1. On dequeue, call `validateOcrSubmission(payload)`. Reject malformed submissions immediately as permanent failures (not retryable) — they will not become valid by being retried.
2. Build results so they validate against `validateOcrResult(...)`. The most common drift points:
   - `partial_failure` MUST be `null` on `succeeded` and a fully populated object on `failed`.
   - `seal` blocks MUST include `seal_shape` and `overlaps_block_ids`.
   - `table` blocks MUST include the `table.{rows,cols,cells}` substructure.
   - Polygons MUST be ≥4 points of `[x, y]` integer pairs.
3. Honor the retry semantics. The queue (or whatever calls into queue mechanics) should drive the dispatch decision through `classifyOcrFailureForRetry`.
   - `is_transient: true` → the queue MAY retry up to `max_attempts`.
   - `is_transient: false` → no retries; the job must dead-letter.
4. Echo `metadata` byte-identically. Do not inspect, log selectively, or mutate it.

### Fake worker (test / integration scaffolding)

A deterministic in-process fake of the OCR worker is exposed via the `./testing` subpath. It validates the submission, walks documented status transitions, returns results derived from `fixtures/valid/`, and validates everything it emits — all without running OCR.

```ts
import { processFakeOcrJob } from "ocr-worker-contract/testing";

const outcome = processFakeOcrJob(submissionPayload, { scenario: "success" });
// outcome.statuses: TransitionRecord[]   — every edge contract-valid
// outcome.results:  OcrResult[]          — every result schema-valid
// outcome.terminal_state: OcrJobState    — last `to` in the chain
```

Scenarios:

| `scenario` | terminal state | results | use it for |
|---|---|---|---|
| `"success"` (default) | `succeeded` | 1× success | happy-path queue consumer wiring |
| `"partial_failure"` | `partial_succeeded` | 1× succeeded + 1× failed | multi-page UX where some pages fail |
| `"permanent_failure"` | `dead_lettered` | 1× failed (`is_transient: false`) | poison-pill / hash-mismatch handling |
| `"transient_then_success"` | `succeeded` | 1× success | retry path with one transient blip |

Options:

- `scenario` — picks one of the four above.
- `now` — inject a deterministic clock for snapshot tests. If omitted, the fake derives a clock from `submission.submitted_at` and advances 100ms per emitted timestamp.

The fake is **not** production OCR. It is exported under a separate subpath specifically so that `import "ocr-worker-contract"` never accidentally pulls in fake-worker code. The implementation header carries an explicit warning. If you find yourself reaching for the fake from production code, stop — write a real worker that satisfies the same contract.

### When NOT to use the typed validators

Workers written in non-TypeScript runtimes (Python, Go, Rust) should consume the JSON Schemas directly from `schemas/*.json`. The schemas have stable `$id`s and are framework-agnostic. The TypeScript validators are a convenience for JS/TS callers; they do not introduce any rules beyond the schemas plus the documented semantic checks (state machine, retry classifier).

---

## Out of scope (intentional)

These are **not** defined here, by design:

- **OCR engine implementation.** No PaddleOCR code, no model loading, no image preprocessing. This package is the contract; the worker is a separate process built to satisfy it.
- **Queue implementation.** Whether the transport is BullMQ, Redis Streams, SQS, NATS, or something else is irrelevant to the schemas. Topic names mentioned in the contract document are suggestions only.
- **Database schema and migrations.** How the web app persists submissions, results, blocks, or audit trails is an internal concern.
- **UI.** Review interfaces, highlighting, accept/reject flows. The contract supplies the inputs (confidences, polygons, review flags); the UI owns presentation.
- **Authentication and authorization.** The web app verifies that `submitted_by` may submit jobs for `tenant_id` / `case_id`; the worker trusts the queue boundary.

If you find yourself reaching for any of the above to make a contract test pass, stop — the test is wrong, or the contract is wrong, or you're trying to test something this package isn't responsible for.

---

## Layout

```
docs/contracts/
├── ocr-worker-contract.md                # human-readable spec (source of truth)
├── package.json                          # ajv (runtime) + tsc / json-schema-to-typescript (devDeps)
├── tsconfig.json                         # ESM, NodeNext, ES2022, declarations on
├── README.md                             # this file
├── scripts/
│   └── gen-types.mjs                     # regenerates src/generated/*.ts from schemas
├── schemas/                              # source of truth
│   ├── ocr-submission.schema.json
│   ├── ocr-result.schema.json
│   └── ocr-status.schema.json
├── src/
│   ├── index.ts                          # public package surface
│   ├── ajv-instance.ts                   # shared Ajv2020 + ajv-formats instance
│   ├── result-types.ts                   # ValidationResult<T>
│   ├── loadSchemas.ts                    # JSON-module imports of schemas
│   ├── validateSubmission.ts
│   ├── validateResult.ts
│   ├── validateStatusTransition.ts       # incl. assertValidOcrStatusTransition
│   ├── retryPolicy.ts                    # classifyOcrFailureForRetry
│   ├── transitions.ts                    # state-machine logic (used by validators + tests)
│   ├── retry-rules.ts                    # transient vs permanent retry rules
│   ├── testing/                          # ⚠️  test/integration scaffolding only
│   │   ├── index.ts                      # subpath barrel: ocr-worker-contract/testing
│   │   └── fake-worker.ts                # processFakeOcrJob + scenarios
│   └── generated/                        # AUTO-GENERATED — do not edit
│       ├── ocr-submission.ts
│       ├── ocr-result.ts
│       └── ocr-status.ts
├── dist/                                 # tsc output (gitignored or vendored per repo policy)
├── fixtures/
│   ├── valid/
│   │   ├── submission-s3.json
│   │   ├── submission-https.json
│   │   ├── submission-inline.json
│   │   ├── result-chinese-litigation.json   # seal + table + vertical-rl block
│   │   ├── result-partial-failure.json
│   │   ├── status-transitions.json
│   │   └── status-transitions-retry.json
│   └── invalid/
│       ├── submission-bad-priority.json
│       ├── submission-missing-page-refs.json
│       ├── result-malformed-polygon.json
│       ├── status-illegal-transition.json
│       └── retry-violation.json
└── tests/
    ├── contract.test.mjs                 # raw schema + semantic-rule tests (imports from dist/)
    └── validators.test.mjs               # API-level validator tests (imports from dist/)
```

## Adding a fixture

1. Drop a JSON file under `fixtures/valid/` or `fixtures/invalid/`.
2. For invalid fixtures, include a `_invalid_reason` and `_target_schema` field at the top so the next reader can tell at a glance what the offense is.
3. Add an explicit test in `tests/contract.test.mjs`. The sweep tests at the bottom of that file fail if a fixture is left untested — they pin the explicit-test list against the directory contents.

## Bumping the contract version

`contract_version` is a semver string in every payload. Minor versions add fields; consumers must ignore unknown fields (forward compatibility). Major versions break shape — bump `$id` and ship the old schema alongside the new one until all producers and consumers cut over.

## Known limitations

- **`src/generated/*.ts` types are not the source of truth.** `json-schema-to-typescript` produces structurally accurate types from each schema in isolation, but it cannot express cross-schema invariants (e.g. *result.page_id must be one of submission.pages[*].page_id*) or runtime-only rules (e.g. status transition legality, retry policy semantics). The `validate*` wrappers in `src/index.ts` are authoritative — every consumer must validate at the boundary even if the TypeScript compiler is satisfied. The generated files are deliberately treated as throwaway: the `prebuild` hook regenerates them on every build, and we do **not** hand-patch them. If a consumer relies on a generated type for fields a downstream rule constrains, that consumer must still call the runtime validator. Codex audit (2026-04) flagged this as a Medium item; the design choice is intentional — runtime validation is the contract, generated types are a developer convenience.

