# OCR Worker Contract

**Status:** Draft v0.1
**Audience:** Web application engineers, OCR worker engineers, infra reviewers
**Scope:** Wire-format contract between the web application and the PaddleOCR worker service, exchanged via a job queue (e.g., Redis/BullMQ). Implementation of the queue, persistence, UI, and authentication is **out of scope** — see §5.

The web application is a Chinese litigation and counsel workflow platform. OCR is treated as infrastructure: the worker is a separate process/container running PaddleOCR ≥ 2.7, and the web app **never** invokes OCR libraries directly. All communication crosses the queue boundary defined here.

---

## Conventions

- Encoding: UTF-8 JSON. All strings NFC-normalized.
- IDs: lowercase ULIDs (26 chars) unless noted. ULIDs are sortable by creation time, which simplifies queue debugging.
- Timestamps: RFC 3339 with millisecond precision and explicit timezone (`2026-04-27T08:14:32.451+08:00`).
- Coordinates: integer pixels, origin top-left, axis-aligned unless `polygon` is provided.
- Languages: BCP-47 tags (`zh-Hans`, `zh-Hant`, `en`).
- Forward compatibility: consumers MUST ignore unknown fields. Producers MAY add fields without bumping the major version.
- Versioning: `contract_version` is a semver string. Breaking changes bump major.

---

## 1. Job Submission Payload

Direction: **web app → queue → OCR worker**.
Queue topic suggestion: `ocr.jobs.v1` (not normative).

```json
{
  "contract_version": "1.0.0",
  "job_id": "01jrk8m4q4xv2v8d4d4ymf5xnk",
  "tenant_id": "01jrk8m4q4xv2v8d4d4ymf5tnt",
  "case_id": "01jrk8m4q4xv2v8d4d4ymf5cas",
  "document_id": "01jrk8m4q4xv2v8d4d4ymf5doc",
  "document_revision": 3,
  "submitted_at": "2026-04-27T08:14:32.451+08:00",
  "submitted_by": "user_01jrk8m4q4xv2v8d4d4ymf5usr",

  "pages": [
    {
      "page_id": "01jrk8m4q4xv2v8d4d4ymf5p01",
      "page_number": 1,
      "source": {
        "kind": "s3",
        "bucket": "ocr-ingest-prod",
        "key": "tenant/01jrk.../doc/01jrk.../page-001.png",
        "etag": "\"d41d8cd98f00b204e9800998ecf8427e\"",
        "expected_sha256": "9b74c9897bac770ffc029102a200c5de",
        "byte_size": 1843201,
        "mime_type": "image/png"
      }
    }
  ],

  "rerun": {
    "is_rerun": false,
    "previous_job_id": null,
    "page_ids": null
  },

  "ocr_options": {
    "languages": ["zh-Hans", "en"],
    "detect_orientation": true,
    "detect_vertical_text": true,
    "table_recognition": "auto",
    "seal_recognition": true,
    "return_word_confidence": true,
    "return_polygon": true,
    "min_confidence_emit": 0.30
  },

  "preprocessing": {
    "deskew": "auto",
    "denoise": "auto",
    "binarize": false,
    "remove_seal_bleed": false,
    "upscale_low_dpi": true,
    "target_dpi_floor": 200,
    "crop_borders": "auto"
  },

  "priority": 50,
  "deadline": "2026-04-27T08:19:32.451+08:00",

  "retry": {
    "max_attempts": 3,
    "backoff": "exponential",
    "base_delay_ms": 2000,
    "max_delay_ms": 60000,
    "attempt": 1
  },

  "metadata": {
    "trace_id": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    "originating_request_id": "req_01jrk8m4...",
    "client_tags": ["evidence-index", "court-filing-2025-hu-min-12345"]
  }
}
```

### 1.1 Required identifiers

| Field | Type | Rationale |
|---|---|---|
| `contract_version` | string (semver) | Lets the worker reject incompatible payloads loudly instead of mis-parsing. |
| `job_id` | ULID | Idempotency key. The worker MUST treat duplicate `job_id` deliveries as the same logical job. |
| `tenant_id` | ULID | Multi-tenant isolation; carried through for logging, billing, and storage scoping. |
| `case_id` | ULID | Litigation case grouping. Useful for prioritizing batches owned by the same matter. |
| `document_id` | ULID | The logical document the page(s) belong to. |
| `document_revision` | int | Documents can be re-uploaded; revision pins which version was OCR'd. Without this, a re-run can silently overwrite results from a different file. |
| `submitted_at` | RFC 3339 | Queueing-vs-processing latency analysis. |
| `submitted_by` | string | Audit trail. The worker does not enforce authorization (out of scope), but the value MUST round-trip into results. |

### 1.2 Document / page references

- A job carries **one or more pages**. Worker processes per page; results are emitted per page (see §2). One-job-per-page and one-job-per-document are both valid use modes — the contract does not prescribe.
- `page_id` is stable across re-runs of the same logical page. `page_number` is 1-indexed and human-facing.
- Partial re-run is expressed by submitting a new job with `rerun.is_rerun = true`, `rerun.previous_job_id` set, and `rerun.page_ids` listing the subset to redo. The new `job_id` is fresh; results carry the new `job_id` and reference the prior one.

### 1.3 File / image location reference

`source` is a discriminated union on `kind`:

| `kind` | Required fields | Notes |
|---|---|---|
| `s3` | `bucket`, `key` | Worker uses its own credentials. Web app does **not** pass credentials. |
| `https` | `url` | For pre-signed URLs. `url_expires_at` SHOULD be present so the worker can fail fast instead of after a timeout. |
| `inline` | `base64`, `byte_size` | For test fixtures and small (<1 MB) pages. Not for production volume. |

Integrity fields (`expected_sha256`, `etag`, `byte_size`) are advisory but strongly recommended: the worker compares them after fetch and emits a permanent failure on mismatch. This catches the case where a re-uploaded file changed underneath the queued job.

### 1.4 OCR options

| Field | Type | Default | Rationale |
|---|---|---|---|
| `languages` | string[] | `["zh-Hans", "en"]` | Order is a hint to the engine. Chinese legal docs routinely include English party names, statute citations, and exhibit labels. |
| `detect_orientation` | bool | true | Scanned filings arrive rotated; worker should auto-rotate before recognition. |
| `detect_vertical_text` | bool | true | Vertical Chinese text appears in older filings, traditional petitions, and seals. |
| `table_recognition` | enum: `off` \| `auto` \| `force` | `auto` | Evidence indexes (证据目录) are table-dense; `force` overrides PaddleOCR's heuristic when we know structure. |
| `seal_recognition` | bool | true | Red seals (公章) overlap body text and corrupt naive OCR. Enabling routes seal regions through PaddleOCR's seal pipeline so the body text underneath is still recovered. |
| `return_word_confidence` | bool | true | Required for review-flagging logic. |
| `return_polygon` | bool | true | Bounding boxes are insufficient for skewed scans; polygons preserve the actual quad. |
| `min_confidence_emit` | float [0,1] | 0.30 | Below this, blocks are dropped from the result rather than flooding the UI with garbage. Manual-review flagging happens upstream of this filter. |

### 1.5 Preprocessing flags

These are deliberately a **flag block, not a pipeline definition**, so the web app does not encode worker-internal ordering.

| Flag | Type | Default | Rationale |
|---|---|---|---|
| `deskew` | enum: `off` \| `auto` \| `force` | `auto` | Faxed and photographed filings are routinely 1–5° off-axis. |
| `denoise` | enum: `off` \| `auto` \| `aggressive` | `auto` | `aggressive` for photographed pages; risks erasing thin strokes in 宋体 small print. |
| `binarize` | bool | false | Off by default — color information helps seal detection. Operators may force on for monochrome legacy scans. |
| `remove_seal_bleed` | bool | false | Pink/red bleed from seal stamps onto reverse-side text. Only useful on duplex scans. |
| `upscale_low_dpi` | bool | true | Tied to `target_dpi_floor`. |
| `target_dpi_floor` | int | 200 | If detected DPI is below this, super-resolution upscale is applied. PaddleOCR accuracy collapses below ~150 DPI on dense Chinese text. |
| `crop_borders` | enum: `off` \| `auto` | `auto` | Removes scanner black borders that confuse layout analysis. |

The contract reserves the right to add preprocessing flags in minor versions. Workers MUST ignore unknown flags rather than fail.

### 1.6 Priority

- `priority`: integer, **0–100, higher = more urgent**. Default 50.
- The contract defines the *meaning* of priority (relative ordering hint); the queue implementation defines the mechanics. Stating the range explicitly avoids the BullMQ-vs-Redis-streams confusion where lower numbers mean higher priority in some libraries.
- Suggested bands: 90–100 interactive (user is staring at a spinner), 50–70 batch ingestion, 10–30 background re-OCR.

### 1.7 Retry settings

| Field | Type | Default | Notes |
|---|---|---|---|
| `max_attempts` | int | 3 | Total attempts including the first. |
| `backoff` | enum: `fixed` \| `exponential` | `exponential` | |
| `base_delay_ms` | int | 2000 | First retry waits this long. |
| `max_delay_ms` | int | 60000 | Cap for exponential backoff. |
| `attempt` | int | 1 | Current attempt number. The queue increments this on each redelivery. |

The web app sets these at submission; the worker honors them but MAY emit a permanent failure earlier if the cause is non-transient (see §4).

### 1.8 Round-trip metadata

Anything inside `metadata` is **opaque to the worker** and MUST be echoed unchanged in the result envelope. This is the seam for distributed tracing (`trace_id`), request correlation, and feature tagging without polluting the typed contract. The worker MUST NOT inspect, log selectively, or mutate this object.

---

## 2. Job Result Payload

Direction: **OCR worker → queue → web app**.
Emitted **once per page** for multi-page jobs. The web app correlates pages by `(job_id, page_id)`.

```json
{
  "contract_version": "1.0.0",
  "job_id": "01jrk8m4q4xv2v8d4d4ymf5xnk",
  "tenant_id": "01jrk8m4q4xv2v8d4d4ymf5tnt",
  "document_id": "01jrk8m4q4xv2v8d4d4ymf5doc",
  "document_revision": 3,
  "page_id": "01jrk8m4q4xv2v8d4d4ymf5p01",
  "page_number": 1,
  "status": "succeeded",

  "engine": {
    "name": "paddleocr",
    "version": "2.7.3",
    "model_set": "PP-OCRv4-server-zh",
    "preprocessing_applied": ["deskew:1.8deg", "upscale:200dpi->300dpi"]
  },

  "page_metrics": {
    "detected_dpi": 198,
    "detected_orientation_deg": 90,
    "detected_dominant_script": "zh-Hans",
    "page_width_px": 2480,
    "page_height_px": 3508,
    "processing_duration_ms": 4321,
    "queued_duration_ms": 870
  },

  "raw_text": "上海市浦东新区人民法院\n民事判决书\n(2025) 沪0115民初12345号\n...",

  "blocks": [
    {
      "block_id": "b_0001",
      "type": "paragraph",
      "text": "上海市浦东新区人民法院",
      "confidence": 0.982,
      "bbox": { "x": 412, "y": 188, "w": 1656, "h": 96 },
      "polygon": [[412,188],[2068,188],[2068,284],[412,284]],
      "reading_order": 1,
      "writing_mode": "horizontal-tb",
      "language": "zh-Hans",
      "words": [
        { "text": "上海市浦东新区人民法院", "confidence": 0.982, "bbox": { "x": 412, "y": 188, "w": 1656, "h": 96 } }
      ]
    },
    {
      "block_id": "b_0017",
      "type": "seal",
      "text": "上海市浦东新区人民法院",
      "confidence": 0.71,
      "bbox": { "x": 1680, "y": 2900, "w": 480, "h": 480 },
      "polygon": [[1680,2900],[2160,2900],[2160,3380],[1680,3380]],
      "seal_shape": "circle",
      "overlaps_block_ids": ["b_0014", "b_0015"],
      "language": "zh-Hans"
    },
    {
      "block_id": "b_0023",
      "type": "table",
      "confidence": 0.84,
      "bbox": { "x": 200, "y": 2200, "w": 2080, "h": 600 },
      "table": {
        "rows": 5,
        "cols": 4,
        "cells": [
          { "row": 0, "col": 0, "text": "证据序号", "confidence": 0.96, "row_span": 1, "col_span": 1 }
        ]
      }
    }
  ],

  "review": {
    "manual_review_recommended": true,
    "reasons": ["seal_overlap", "low_dpi", "low_word_confidence_density"],
    "low_confidence_block_ids": ["b_0017"],
    "page_confidence_summary": {
      "min": 0.41,
      "median": 0.94,
      "mean": 0.91,
      "p10": 0.62,
      "fraction_below_0_80": 0.07
    }
  },

  "partial_failure": null,

  "metadata": {
    "trace_id": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    "originating_request_id": "req_01jrk8m4...",
    "client_tags": ["evidence-index", "court-filing-2025-hu-min-12345"]
  },

  "completed_at": "2026-04-27T08:14:37.643+08:00"
}
```

### 2.1 Raw OCR output

`raw_text` is the engine-ordered, newline-joined concatenation of recognized text. It exists so consumers that don't care about layout (search indexing, copy-to-clipboard, grep) can avoid traversing `blocks`. It MUST be derivable from `blocks` in `reading_order`; if the two disagree, `blocks` is canonical.

### 2.2 Block-level output with bounding boxes

Each block has:

- `block_id`: unique within the page result.
- `type`: `paragraph` | `line` | `heading` | `table` | `seal` | `figure` | `formula` | `handwriting` | `unknown`. The Chinese legal corpus motivates `seal` and `table` as first-class types.
- `bbox`: axis-aligned rectangle. Always present.
- `polygon`: 4-point quad (or N-point) for skewed/rotated regions. Required when `return_polygon=true`.
- `reading_order`: integer, dense or sparse. Determines `raw_text` assembly.
- `writing_mode`: `horizontal-tb` | `vertical-rl` | `vertical-lr`. Vertical text is not rare in Chinese legal documents (older petitions, traditional formats, seal interiors).
- `language`: detected per-block; mixed-language pages are common (Chinese body + English party names).

`type:"table"` blocks carry a `table` substructure with cells. `type:"seal"` blocks carry `seal_shape` and `overlaps_block_ids` so the consumer can render the seal as a layered annotation rather than corrupting the underlying paragraph text.

### 2.3 Per-block confidence

`confidence` ∈ [0, 1]. For composite types (table, seal), this is the engine's own composite score; cells/words carry their own confidences.

### 2.4 Word-level confidence array

`words[]` is per-block, present when `return_word_confidence=true`. Each word has `text`, `confidence`, `bbox`. This array is what powers granular highlighting in the review UI and what feeds the `manual_review_recommended` heuristic.

For CJK text, "word" means the engine's recognition unit, which for PaddleOCR is typically a line segment or character cluster, not a linguistic word. The contract documents this honestly rather than pretending tokenization is solved.

### 2.5 Detected DPI

`page_metrics.detected_dpi` is the worker's estimate after preprocessing (so a page that was upscaled reports the upscaled DPI, with the original captured in `engine.preprocessing_applied`). Required because the review UI uses it to decide whether to surface a "rescan recommended" banner.

### 2.6 Processing duration

`page_metrics.processing_duration_ms` covers fetch + preprocessing + recognition + serialization, measured inside the worker.
`page_metrics.queued_duration_ms` is the time between job receipt and processing start. Together they let ops separate queue backlog from worker slowness.

### 2.7 Engine name / version

`engine.name`, `engine.version`, `engine.model_set` are mandatory. When the model set changes (e.g., upgrading PP-OCRv4 → v5), historical results remain reproducible-by-reference even if not byte-identical.

### 2.8 Partial failure representation

For multi-page jobs, an individual page result may be `status:"failed"` while sibling pages succeed:

```json
{
  "status": "failed",
  "blocks": [],
  "raw_text": "",
  "partial_failure": {
    "code": "page_decode_error",
    "message": "Image decoded but layout analysis returned no regions; likely blank or near-blank page.",
    "is_transient": false,
    "attempted_count": 1
  }
}
```

`partial_failure` is `null` on success. When a page fails permanently mid-job, the worker emits the failure result for that page and continues processing the rest. The job-level status (§3) reflects the aggregate.

### 2.9 Manual-review recommendation flag

`review.manual_review_recommended` is a single boolean. It is true when **any** of the following hold (the contract specifies the *inputs*; the threshold function is owned by the worker and may evolve):

- Page-level mean confidence < 0.85
- Any block confidence < 0.60
- `fraction_below_0_80` > 0.10
- Detected DPI < `target_dpi_floor`
- Seal overlaps with paragraph blocks that contain low-confidence words
- Vertical text detected on a page the user didn't flag as such (often indicates rotation failure)
- Table block recognized with cell confidence variance above the engine's flagging threshold

`review.reasons` enumerates which inputs fired, so the UI can surface specific guidance ("Seal overlaps body text — verify recovered text near 公章") rather than a generic "low quality" warning.

---

## 3. Job Status Model

States are **page-level** for granular reporting and **aggregated to job-level** for UI summary.

### 3.1 States

| State | Meaning |
|---|---|
| `queued` | Submitted, awaiting pickup. |
| `claimed` | A worker has reserved the job; not yet processing. |
| `processing` | Active OCR. |
| `succeeded` | Terminal. Result emitted. |
| `failed` | Terminal. No further retries. |
| `partial_succeeded` | **Job-level only.** At least one page `succeeded`, at least one page `failed`. |
| `cancelled` | Terminal. Web app withdrew the job before completion. |
| `dead_lettered` | Terminal. Exhausted retries; result envelope carries the last failure. |

### 3.2 Allowed transitions

```
queued       → claimed | cancelled
claimed      → processing | queued (on worker crash / visibility timeout) | cancelled
processing   → succeeded | failed | partial_succeeded | cancelled
failed       → queued (on retry, attempt < max_attempts) | dead_lettered
succeeded    → (terminal)
partial_succeeded → (terminal)
cancelled    → (terminal)
dead_lettered → (terminal)
```

### 3.3 Who controls each transition

| Transition | Controlled by |
|---|---|
| `queued → claimed` | Queue infrastructure (visibility lease). |
| `claimed → processing` | Worker. |
| `claimed → queued` | Queue infrastructure (lease expiry). |
| `processing → succeeded` / `failed` / `partial_succeeded` | Worker. |
| `failed → queued` | Queue infrastructure (retry policy applied). |
| `failed → dead_lettered` | Queue infrastructure (after `max_attempts`). |
| `* → cancelled` | Web app, via a cancel signal carrying `job_id`. The cancel mechanism itself is out of scope; the contract guarantees the worker, on observing cancel, MUST emit a `cancelled` terminal status and SHOULD include `partial_failure` summarizing how far it got. |

The status itself is reported via a status envelope (same `job_id`, `tenant_id`, `metadata`) on a status topic; the structure mirrors the result envelope minus `blocks`/`raw_text`. The transport details — separate topic vs. multiplexed — are an implementation choice.

---

## 4. Failure and Retry Behavior

### 4.1 Transient failure

Conditions that justify retry:

- Source fetch network errors (timeout, 5xx, connection reset).
- Pre-signed URL valid but slow (>30s to first byte).
- Worker OOM / process crash during processing (lease expires, redelivered).
- Engine-internal CUDA/driver errors that historical telemetry shows recover on a different worker.

Marked by `partial_failure.is_transient = true` (when emitted) and by leaving the job in `failed` so the queue's retry policy can re-queue it.

### 4.2 Permanent failure

Conditions that MUST NOT retry, even if attempts remain:

- `expected_sha256` mismatch — file content changed underneath the job.
- Source returns 404 / 403 — file gone or access revoked.
- File decodes but is not an image (`page_decode_error`).
- Image decoded but is blank or below a usability floor (e.g., < 50×50 px).
- Unsupported `mime_type`.
- `contract_version` incompatible.

The worker MUST set `partial_failure.is_transient = false` and the queue MUST move directly to `dead_lettered`, skipping remaining attempts. Wasting two more attempts on a 404 burns latency and money.

### 4.3 Partial success

Multi-page job where some pages `succeeded` and some `failed`:

- Each page emits its own result with its own status.
- The job-level status is `partial_succeeded`.
- The web app decides whether to surface this as a soft warning (most pages OK) or a hard failure (e.g., evidence index page failed). The contract does not prescribe.

### 4.4 Retry cap

`retry.max_attempts` from §1.7 is the cap. The queue is responsible for enforcement; the worker is responsible for honest classification (transient vs. permanent). Misclassifying a permanent failure as transient is the more expensive bug — it multiplies wasted compute by `max_attempts`.

### 4.5 Backoff convention

- `backoff: "fixed"` → wait `base_delay_ms` between every attempt.
- `backoff: "exponential"` → wait `min(max_delay_ms, base_delay_ms * 2^(attempt-1))`, with ±20% jitter applied by the queue.
- Jitter is mandatory to avoid thundering herd after a worker fleet restart.

---

## 5. Out of Scope

The following are explicitly **not** defined by this contract, by design:

- **Database schema.** How the web app persists jobs, results, blocks, or audit trails. The contract is a wire format; storage is an internal choice.
- **Queue implementation.** Redis Streams vs. BullMQ vs. SQS vs. NATS — the contract names neither and depends on none. Topic names in this document are suggestions, not normative.
- **UI.** Review interfaces, highlighting, accept/reject flows. The contract supplies the inputs (confidences, polygons, review flags); the UI owns presentation.
- **Authentication and authorization.** The web app is responsible for verifying that `submitted_by` may submit jobs for `tenant_id` / `case_id`. The worker trusts the queue boundary and does not re-authorize. End-to-end auth (e.g., signed payloads) is a future extension if the queue is shared across trust boundaries.
- **Pricing, quotas, rate limiting.** Tenant fairness and cost accounting are infrastructure concerns layered above this contract.
- **PII handling and retention.** Source files and OCR results frequently contain PII (party names, ID numbers, addresses); retention policy lives in the storage and access layers, not in the contract.

---

## 6. Chinese Legal Document Edge Cases

Each first-class concern below is addressed by the fields cited.

| Edge case | Why it matters | Handled by |
|---|---|---|
| **Official seals (公章) overlapping text** | Red seals are stamped *over* the body text on judgments, contracts, and receipts. Naive OCR returns garbled characters where the seal sits. | `ocr_options.seal_recognition`; `block.type:"seal"` with `overlaps_block_ids` so the body text under the seal is preserved as a separate block. Review flagged when overlap coincides with low confidence. |
| **Vertical text** | Older petitions, certain seal interiors, and traditional-format documents use top-to-bottom text. | `ocr_options.detect_vertical_text`; `block.writing_mode`. Unflagged vertical text on a horizontal page is itself a review reason (often indicates rotation failure). |
| **Table-heavy evidence indexes (证据目录)** | Evidence indexes are dense tables: 序号 / 证据名称 / 证明对象 / 页码. Losing structure makes them unusable for downstream review. | `ocr_options.table_recognition`; `block.type:"table"` with `table.cells[]` carrying `row`, `col`, `row_span`, `col_span`, per-cell `confidence`. |
| **Mixed-resolution pages** | A single document often blends 600 DPI scans, 150 DPI faxes, and phone photos. | Per-page `source` and per-page `page_metrics.detected_dpi`. `preprocessing.upscale_low_dpi` + `target_dpi_floor` lifts faxes; review flag fires on persistent low DPI. |

Additional concerns the contract is shaped around but does not call out as edge cases above:
- Mixed-script content (Simplified + Traditional + English).
- Handwritten annotations on otherwise printed pages — `block.type:"handwriting"`.
- Faxed pages with severe noise — `preprocessing.denoise:"aggressive"`.

---

## 7. Assumptions to Validate in Benchmark

This contract reflects design intent. Several knobs are guessed and MUST be validated against representative Chinese legal corpora before declaring v1.0 stable. The benchmark should treat each item as a falsifiable claim.

1. **PaddleOCR PP-OCRv4-server-zh accuracy at 200 DPI on dense legal Chinese.** The `target_dpi_floor: 200` default assumes accuracy is acceptable here. Validate on a 100-page sample of judgments at 150 / 200 / 300 / 600 DPI; if the cliff is at 250 DPI, raise the default.
2. **Seal-recognition pipeline preserves underlying body text.** Assumption: enabling `seal_recognition` recovers the text under the seal as a separate block at usable confidence. Validate on stamped contracts and judgments; measure character error rate (CER) on the under-seal region specifically.
3. **Table recognition on 证据目录.** Assumption: PaddleOCR's table mode handles the typical 4–6 column evidence index without merging cells incorrectly. Validate cell-level recall, column-merge errors, and `row_span` correctness.
4. **`min_confidence_emit: 0.30` is a useful floor.** Too high and we drop legitimate text; too low and we flood the review UI. Sweep 0.10 / 0.20 / 0.30 / 0.50 and measure precision/recall against ground truth.
5. **Manual-review threshold function.** The criteria in §2.9 (mean < 0.85, any block < 0.60, fraction-below-0.80 > 0.10) are placeholders. Calibrate against human labels: false-positive rate of "review recommended on actually-clean pages" should be < 15%; false-negative rate on actually-bad pages should be < 5%.
6. **Vertical text detection precision.** Detector should not mis-fire on tall narrow paragraphs (e.g., margin notes, single-character columns in tables).
7. **DPI estimator accuracy.** Worker's `detected_dpi` should be within ±15% of true DPI on a labeled set; otherwise the upscale-trigger logic is unreliable.
8. **Per-page processing latency budget.** The default 5-minute `deadline` (`submitted_at + 5min`) assumes ≤ 2s/page on PP-OCRv4-server with seal + table enabled, ×10 pages, ×backoff headroom. Validate on the slowest realistic page (full-page seal + dense table + 600 DPI) and adjust.
9. **`raw_text` reconstruction matches reading_order.** Assumption: reading order from PaddleOCR's layout model produces text usable for full-text search without post-processing. Validate by sampling and comparing against a manually reconstructed gold standard.
10. **Word-level confidence is meaningfully granular for Chinese.** Because PaddleOCR's recognition unit is line-segment-level, `words[]` may be coarser than the field name suggests. Validate whether per-word highlights in the review UI line up with actual recognition errors, or whether per-block highlights are sufficient.
11. **Retry classification accuracy.** The transient/permanent split in §4.1–§4.2 is asserted; validate by replaying production failure traces and confirming the worker classifies them correctly. Misclassifying permanent failures as transient is the costliest bug class.
12. **Forward compatibility actually works.** Add an unknown field to a payload in a controlled environment and confirm both worker and web app ignore it without warnings.

Items 1–7 are technical risks the contract structure depends on; items 8–12 are operational risks the contract implies but does not enforce.
