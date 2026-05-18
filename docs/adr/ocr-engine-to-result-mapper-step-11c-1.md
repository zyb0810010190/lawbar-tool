# ADR: Real OCR Worker — Engine → OcrResult Mapper (Step 11C.1)

## Status

Accepted. **Decision + code**. First atomic unit of the staged ADR-11C
sequence (11C.1 mapper, 11C.2 fetcher, 11C.3 wire bin). Pins the pure
projection from `@gutenye/ocr-node` `Line[]` to the contract-shaped
`OcrResult`, with the schema relaxations the projection requires.
Companion code in `services/ocr-worker/src/engines/mapper.ts` and the
schema patch in `docs/contracts/schemas/ocr-result.schema.json` ship
in the same commit.

## Context

ADR-11B §1 froze `WORKER_REGISTRY["paddleocr-onnx"].load` as the
in-process production adapter. The adapter has two parts: the engine
call (`Ocr.create()` + `ocr.detect()` — straightforward; in-process per
ADR-11B §2) and the **mapper** from engine output to the
`OcrResult` schema. The mapper is non-obvious: the engine's
`Line` type is materially poorer than the schema's `Block` type
(positional info is optional in the engine, required in the schema; the
engine emits no notion of paragraph/heading/seal/table). 11C.1 settles
those mismatches before any wiring lands.

`@gutenye/ocr-node@1.4.8` types (from
`node_modules/@gutenye/ocr-common/build/types/types.d.ts`):

```ts
export type Line = {
  text: string;
  mean: number;        // confidence, [0, 1]; always present
  box?: number[][];    // 4 corner polygon, OPTIONAL
};
```

Existing `ocr-result` schema (pre-patch) requires `block.bbox` and
requires `block.confidence` as `number` in `[0, 1]`. Two mismatches:
the engine may omit `box`, and other future engines may omit
confidence. Both demand schema relaxation — covered below.

User decisions captured in this session:

1. **bbox-omit handling** → **schema patch: bbox optional on block.**
   Emit text-only blocks; do not synthesize placeholder positions.
   Honest signal beats schema rigidity.
2. **engine.version format** → **`<package-version>+<model-set>`** —
   pins both the library and the model identifier.
3. **confidence default when engine omits** → **null** (forward-looking;
   `@gutenye/ocr-node` itself always reports `mean`, so paddle never
   uses the null branch — but the schema must allow it so future engine
   adapters land without a second relax).

## Decisions

### §1 Pure function signature

`services/ocr-worker/src/engines/mapper.ts`:

```ts
import type { OcrResult } from "ocr-worker-contract";

export type EngineLine = {
  readonly text: string;
  readonly mean: number;            // [0, 1]
  readonly box?: ReadonlyArray<readonly [number, number]>;
};

export type MapperJobMeta = {
  readonly contract_version: string;
  readonly job_id: string;          // ULID
  readonly tenant_id: string;       // ULID
  readonly document_id: string;     // ULID
  readonly document_revision?: number;
  readonly page_id: string;         // ULID
  readonly page_number: number;     // >= 1
};

export type MapperEngineMeta = {
  readonly name: "paddleocr-onnx";  // closed for now; opens in 11C.3
  readonly version: string;         // `<pkg-version>+<model-set>`
};

export type MapperTiming = {
  readonly processing_duration_ms: number;     // >= 0
  readonly queued_duration_ms?: number;        // >= 0
  readonly completed_at: string;               // ISO-8601 UTC
};

export type MapperPageGeometry = {
  readonly page_width_px?: number;             // from fetcher if known
  readonly page_height_px?: number;
};

export interface MapperInput {
  readonly lines: ReadonlyArray<EngineLine>;
  readonly job: MapperJobMeta;
  readonly engine: MapperEngineMeta;
  readonly timing: MapperTiming;
  readonly geometry: MapperPageGeometry;
}

export function mapEngineLinesToOcrResult(input: MapperInput): OcrResult;
```

Pure: no I/O, no clock, no randomness. All time + ULIDs injected via
`input`. Determinism is a test invariant.

### §2 Block projection — one engine line ⇒ one block

- `block_id`: `b_NNNN`, zero-padded 4-digit, starting at `b_0001`,
  in engine-output order. Matches the existing fixture convention in
  `docs/contracts/fixtures/valid/result-chinese-litigation.json`. The
  schema only requires `minLength: 1`; the 4-digit pad is a project
  convention pinned here.
- `type`: `"line"`. The engine emits no paragraph/heading/seal/table
  signal. **No inference v1.** Promotion to richer block types is the
  job of a downstream block-grouping pass (out of 11C scope).
- `text`: `line.text` verbatim. No NFC normalization here — that lives
  in the CER metric, not in the persisted result. The schema does not
  require any particular Unicode normalization form.
- `confidence`: `line.mean`. Schema patched to allow `null` (§5);
  `@gutenye/ocr-node` always sets `mean`, so the null branch is
  unreachable for δ but the schema is forward-compatible.
- `reading_order`: not emitted. Engine output order is the only
  available signal; downstream consumers can use `block_id` ordering
  (the zero-pad guarantees lexicographic = numeric).

### §3 bbox derivation from optional polygon

When `line.box` is present (4 corners):

```
xs = box.map(p => p[0])
ys = box.map(p => p[1])
x  = floor(min(xs))
y  = floor(min(ys))
w  = max(1, ceil(max(xs)) - x)
h  = max(1, ceil(max(ys)) - y)
```

`floor`/`ceil` widen rather than truncate — a sub-pixel polygon still
becomes a `1×1` bbox the schema accepts. Clamp `w` and `h` to `≥ 1`
because the schema requires `minimum: 1`. Negative coords are clamped
to `0` (schema requires `minimum: 0`).

`polygon` (schema field) is also emitted alongside `bbox` when `box`
is present: each `[x, y]` rounded to integer. Reason: the engine's
polygon is more precise than its axis-aligned bbox and downstream
review UI may want to render the tighter shape. Cost is small (8 ints
per line).

When `line.box` is absent: omit both `bbox` and `polygon` on that
block. The block is text-only. Schema patch (§5) allows this.

### §4 OcrResult assembly

| Field | Source / rule |
|---|---|
| `contract_version` | `input.job.contract_version` |
| `job_id`, `tenant_id`, `document_id`, `page_id`, `page_number` | `input.job.*` verbatim |
| `document_revision` | `input.job.document_revision` if present, else omit |
| `status` | Always `"succeeded"` v1. The mapper does not produce `failed` or `cancelled` — those edges are owned by the adapter on engine-throw / cancellation per ADR-10C |
| `engine.name` | `input.engine.name` (`"paddleocr-onnx"` for δ) |
| `engine.version` | `input.engine.version` — `<pkg-version>+<model-set>` |
| `engine.model_set` | OMIT v1. Carried inside `engine.version` after the `+`. Splitting later is non-breaking |
| `engine.preprocessing_applied` | OMIT v1. No preprocessing in the paddle adapter yet |
| `page_metrics.processing_duration_ms` | `input.timing.processing_duration_ms` |
| `page_metrics.queued_duration_ms` | `input.timing.queued_duration_ms` if present, else omit |
| `page_metrics.page_width_px` / `page_height_px` | `input.geometry.*` if present, else omit |
| `page_metrics.detected_dpi` / `detected_orientation_deg` / `detected_dominant_script` | OMIT v1. Engine reports none of these |
| `raw_text` | `lines.map(l => l.text).join("\n")`. Empty array → `""`. Matches the bakeoff transcript projection (also a `\n` join) |
| `blocks` | Per-§2 projection over `lines`, preserving order. Empty array allowed on `succeeded` (schema requires the field, not non-emptiness) |
| `review` | OMIT v1. No manual-review heuristic until a downstream review service exists (separate ADR) |
| `partial_failure` | `null`. Status is always `succeeded`; schema's `succeeded → partial_failure: null` `allOf` clause holds |
| `metadata` | `{}` v1. Open for downstream tagging |
| `completed_at` | `input.timing.completed_at` |

### §5 Schema patch

`docs/contracts/schemas/ocr-result.schema.json`:

1. `$defs.block.required` — remove `"bbox"` and `"confidence"`. Both
   become optional fields. Existing fixtures keep both populated;
   nothing to migrate.
2. `$defs.block.properties.confidence` — change to:
   ```json
   "confidence": {
     "anyOf": [
       { "type": "number", "minimum": 0, "maximum": 1 },
       { "type": "null" }
     ]
   }
   ```

Both changes are **widening**: every previously-conformant payload
still validates. No `contract_version` bump required (semver allows
schema relaxations without a major bump when no consumer relies on the
removed constraint — none does).

Word-level `bbox` (inside `block.words[]`) stays required: words only
appear if the engine emits per-word positions, and an engine that has
words must have positions.

Seal blocks still require `seal_shape` + `overlaps_block_ids`. Table
blocks still require `table`. Those `allOf` clauses are unaffected by
removing top-level `bbox`/`confidence` from `required` because no
`type: seal | table` block survives §2 (mapper only emits `type: line`).

### §6 Error model

Mapper is total over the typed input. It does **not** throw. The
adapter wrapping the mapper handles engine-throw / fetch-failure /
cancellation and produces `OcrResult.status: "failed"` records (per
ADR-10C edge ownership — that's the adapter's job, not the mapper's).

Pre-conditions verified by the type system:
- `input.lines` is `ReadonlyArray<EngineLine>` — empty allowed
- `input.job.*` ULIDs are strings — schema validation happens in the
  outer envelope check, not here
- Each `line.mean ∈ [0, 1]` is **trusted** from the engine. If paddle
  ever returns out-of-range mean (it does not in 1.4.8), the schema
  validator catches it at the outer envelope. Mapper does not re-check.

### §7 Determinism + idempotency

Same input ⇒ same `OcrResult`. Specifically:
- No `Date.now()` / no `crypto.randomUUID()`
- No `Math.random()`
- No reliance on `Map`/`Set` iteration nondeterminism (we iterate `lines` directly)
- No floating-point reductions whose order matters (only `min`, `max`,
  `floor`, `ceil`, all order-stable)

This pins the recognition-layer idempotency assumed by ADR-11A.5 §2
(layer 1 — pure recognition). Layer 2 envelope idempotency (statuses,
job_id, terminal_state) belongs to the adapter, not the mapper.

### §8 Out-of-scope (deferred)

- Paragraph / heading / seal / table inference (block-grouping pass)
- Word-level positions (engine doesn't emit them)
- Review heuristic (`manual_review_recommended`, `low_*_confidence`)
- DPI / orientation / dominant-script detection
- Multi-page jobs (rejected at submission by 11C.2 fetcher contract
  per the N=1 cap)
- Engine plugin schema variations (only `paddleocr-onnx` for now;
  `MapperEngineMeta.name` is a closed `"paddleocr-onnx"` literal
  — opens in 11C.3 if a second engine ships in v1)

## Consequences

- `docs/contracts/src/generated/ocr-result.ts` regenerates with
  `confidence` typed as `number | null | undefined` and `bbox` as
  `Bbox | undefined`.
- `services/ocr-worker/src/engines/mapper.ts` is the first file under
  `services/ocr-worker/src/engines/`. 11C.3 lands
  `paddleocr-onnx.ts` adapter (calls the engine + invokes the mapper)
  alongside it.
- No existing test/fixture changes required: widening the schema cannot
  reject anything that previously passed.
- 11C.2 fetcher contract can assume the mapper handles empty `lines[]`
  (returns `succeeded` with `blocks: []` and `raw_text: ""`) — that is
  the "fetcher succeeded but engine found no text" path.

## Open questions (for 11C.2 / 11C.3)

- Q1 (11C.2): exact `MapperPageGeometry` source — does the fetcher
  rasterize and measure, or do we trust EXIF / image headers? Affects
  whether `page_width_px` is always populated for `succeeded` results.
- Q2 (11C.3): when paddle's `mean` reports `0` for a clearly-correct
  line (edge bug in some versions), do we coerce or pass through?
  Pass through v1 — the review service will surface low-confidence
  lines anyway.
- Q3 (11C.3): cold-load failure exit code from `bin/ocr-worker.mjs`.
  Deferred — comes when 11C.3 wires the bin entrypoint.

## Rejected alternatives

- **Synthesize placeholder bbox** `{x:0,y:0,w:1,h:1}` when `box` is
  absent. Rejected on independence grounds: downstream consumers
  cannot distinguish a synthesized bbox from a real one, and the
  schema would be silently lying about position. The schema patch is
  the honest fix.
- **Drop lines without `box` from `blocks[]` entirely.** Rejected:
  the text would still appear in `raw_text` (newline-joined) but
  there would be no block carrying its confidence — review UI loses
  a hook. Emitting text-only blocks keeps the data complete.
- **Promote engine output to richer block types (`heading` /
  `paragraph`) heuristically.** Rejected v1: any heuristic in the
  mapper conflates recognition with layout analysis. Layout pass
  belongs in a separate, testable module.
- **Major contract version bump for the schema patch.** Rejected: the
  change is strictly widening. No payload that validated against
  v1.0.0 fails against the patched schema, and no current consumer
  relies on `bbox`/`confidence` being required on `block`.
