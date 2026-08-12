# UI State Contract (UI-00 baseline)

> ### ⚠️ SNAPSHOT OF A PRE-DESKTOP REPO — do not read as current
>
> **This document describes a repository state that no longer exists.** It asserts there is no UI
> implementation. Verified 2026-08-12: `apps/lawbar-desktop/renderer/` ships 25 TypeScript
> modules, `index.html`, `router.ts` declaring `#/matters`, `#/matters/new`, `#/matters/:id` and
> `#/matters/:id/archive`, plus `screens/`, `nav.ts`, `i18n/` and `theme/`.
>
> Any row claiming zero `.html`/UI hits is false against the current tree.
>
> **The gap analysis rests on a void premise.** Surfaces are deferred here on the grounds that a
> missing HTTP API gateway blocks every screen. The desktop client uses Electron IPC, not HTTP,
> so that blocker never applied to it and the deferral verdicts do not follow.
>
> Retained as the UI-00 baseline record. For what the UI actually is, see
> `docs/product/product-definition.md` Part III.


**Date**: 2026-05-20
**Status**: **No UI implementation. This document derives the UI-side state contract from the existing backend contracts.**

## Source of truth

A future UI must NEVER define its own copy of OCR state. The backend contract owns the vocabulary:

- **States**: `docs/contracts/src/transitions.ts` — 8 documented states.
- **Transitions + ownership**: same file — `ALLOWED_EDGES` (deep-frozen) lists every legal edge and the actor that owns it.
- **Read-model shapes**: `services/ocr-review/src/types.ts` — `OcrJobLifecycle`, `ReviewableOcrPage`, `OcrIngestionOutcomeSummary`, `OcrDocumentJobSummary`, `BlockDigest`, `EvidenceIndexSignal`, `PartialFailureDigest`.
- **Submission shape**: `docs/contracts/schemas/ocr-submission.schema.json`.
- **Public fetcher error codes** (relevant when surfacing pipeline failures): `services/ocr-worker/src/fetcher/types.ts` → `FETCHER_ERROR_CODES`.

## The eight states

```
queued → claimed → processing → succeeded
                            ↘ failed → queued (retry) | dead_lettered
                            ↘ partial_succeeded (terminal)
claimed → queued (lease expired)
(any non-terminal) → cancelled (web_app actor)
```

Terminal states: `succeeded`, `partial_succeeded`, `cancelled`, `dead_lettered`. A UI must use `isTerminalState(state)` from `ocr-worker-contract` — never its own list, because the contract's terminal set may grow without the UI noticing.

| State | UI semantics | Polling? | Actor that can change it |
|---|---|---|---|
| `queued` | "waiting for a worker" | yes (slow cadence) | `queue` → `claimed` |
| `claimed` | "a worker has it, hasn't started" | yes | `worker` → `processing`; `queue` → `queued` (lease expired) |
| `processing` | "OCR in flight" | yes (faster cadence) | `worker` → `succeeded` / `failed` / `partial_succeeded` |
| `succeeded` | terminal, all pages succeeded | no | none |
| `partial_succeeded` | terminal, some pages failed; surface per-page outcomes | no | none |
| `failed` | retryable failure (transient) OR pre-dead-letter; next edge depends on retry policy | yes (short) | `queue` → `queued` (retry) or `dead_lettered` |
| `cancelled` | terminal, user-initiated | no | none |
| `dead_lettered` | terminal failure after retry exhaustion or permanent error | no | none |

**UI must NOT show "retry" as a user action.** Retry is `queue`-actor-owned, automatic per `failed → queued` policy. The only user-driven transition is **cancel** (`web_app` actor).

## Read-model → screen mapping

| Read API | UI surface |
|---|---|
| `listOcrJobsForDocument` | S2 job list |
| `getOcrJobLifecycle` | S3 job detail |
| `getReviewableOcrPage` | S4 per-page review |
| `summarizeOcrIngestionOutcome` | could surface at S3 header or as a job-card collapsed view |
| `listPagesNeedingManualReview` | S5 reviewer worklist |

## Per-screen state contract

### S1 job submission

| UI state | Trigger | Visible component |
|---|---|---|
| draft | initial | form, no submit-disabled |
| validating | on blur / on submit | per-field error if `validateSubmission` returns `ok:false` |
| submitting | submit clicked, request in flight | submit-disabled, spinner |
| submitted | server returns 2xx | redirect to S3 with new job_id |
| network_error | fetch error | retry CTA + draft-preserved |
| schema_error | server rejected | per-field error mapped from `summary.errors` |

Drafts SHOULD be browser-local until backend gains a draft-save surface (not yet specified).

### S2 job list

| UI state | Trigger | Visible component |
|---|---|---|
| loading | initial fetch | skeleton rows |
| empty | `rows.length === 0` | "no jobs yet" + CTA → S1 |
| populated | `rows.length > 0` | table |
| stale | row's `is_terminal === false` and polling cadence elapsed | re-fetch tag on row |
| paginating | cursor advance | inline spinner on table footer |
| error | persistence read failed | inline error + retry CTA |

### S3 job detail

| UI state | Trigger | Visible component |
|---|---|---|
| loading | initial fetch | skeleton |
| not_found | `getOcrJobLifecycle` returns null / 404 | "job not found" |
| in_flight | `is_terminal === false` | timeline + active-state indicator + cancel CTA (only when non-terminal) |
| terminal_succeeded | `terminal_state === "succeeded"` | green status + per-page rollup |
| terminal_partial | `terminal_state === "partial_succeeded"` | yellow status + per-page rollup; failed-page list at top |
| terminal_cancelled | `terminal_state === "cancelled"` | grey status + "cancelled by web_app at <timestamp>" |
| terminal_dead | `terminal_state === "dead_lettered"` | red status + final-failure reason + retry-exhausted note |
| cancel_pending | cancel CTA clicked, write in flight | disable cancel button; show "cancelling…" |
| cancel_failed | server rejected cancel | inline error, re-fetch latest state |

### S4 per-page review

| UI state | Trigger | Visible component |
|---|---|---|
| loading | initial fetch | skeleton |
| pending | `getReviewableOcrPage` returns null (no result yet) | "not yet OCR-ed" badge; deep-link to S3 |
| succeeded | `outcome === "succeeded"` | text-preview + full-text expander + flags |
| failed | `outcome === "failed"` | partial_failure.{code, message, is_transient, attempted_count} block |
| cancelled | `outcome === "cancelled"` | grey status, no text body expected |
| manual_review_recommended | `manual_review_recommended === true` | warning banner + reasons[] list |
| seal_detected | `detected_seals.count > 0` | seal-count chip with block_ids in hover |
| table_detected | `detected_tables.count > 0` | table-count chip with block_ids in hover |
| evidence_index_present | `evidence_index.present === true` | badge: "evidence index" |

### S6 cancel component (cross-screen)

| UI state | Trigger | Visible component |
|---|---|---|
| eligible | `isTerminalState(current_state) === false` | cancel button enabled |
| ineligible | `isTerminalState(current_state) === true` | cancel button hidden (NOT disabled — terminal jobs do not need a UI affordance) |
| confirming | button clicked | modal confirm |
| submitting | confirm pressed, write in flight | disabled + spinner |
| success | server returned 2xx | refresh state; show toast |
| race | server returned "already terminal" | refresh state; toast "already finished" |
| error | other error | inline error + retry |

## Error → fetcher-code mapping reference

When a UI shows a failed job or page, the failure code often originates from the fetcher. The full list lives in `services/ocr-worker/src/fetcher/types.ts` under `FETCHER_ERROR_CODES`. The UI should NEVER define its own copy of these codes; it should import the type or accept the code as opaque text. Codes the UI is most likely to surface:

| Code | UX framing suggestion |
|---|---|
| `host_not_allowlisted` | "the source URL host is not allowed by this tenant" — operator misconfiguration |
| `host_resolves_to_private_ip` | "the source URL resolves to a private network" — security rejection |
| `url_expired` | "the pre-signed URL has expired" — user-fixable by re-submission |
| `https_client_error_4xx` | "the source server rejected the request" — operator/source issue |
| `https_server_error_5xx` | "the source server had a temporary error" — likely retryable |
| `https_timeout` | "the source took too long to respond" |
| `https_network_error` | "could not reach the source" |
| `content_hash_mismatch` | "the fetched bytes do not match the declared SHA-256" — data integrity |
| `mime_signature_mismatch` | "the file's actual format does not match the declared MIME type" |
| `size_cap_exceeded` | "the file is larger than the 50 MB per-page cap" |

The contract's protocol-surface guardrails (ADR-11D.2-A "Protocol-surface guardrails") imply that any future UI feature involving HTTP/2 / proxy / agent pooling on the worker MUST trigger a new ADR + review. UI work itself does not change this surface, but UI-driven feature requests can.

## What the UI must NOT do

- Define its own list of states or terminal states.
- Define its own copy of `FETCHER_ERROR_CODES`.
- Recompute manual_review_recommended from page data (the worker owns the threshold; the read model surfaces it verbatim).
- Subset DNS answers or otherwise touch SSRF-relevant data shapes.
- Trigger retries directly (retry is queue-owned and automatic).
- Bypass the coordinator on writes (per AGENTS.md "Coordinator owns lifecycle. Adapter must not own lifecycle.").

## What the UI MUST do

- Treat read-model field names as load-bearing strings (changing them is a contract change).
- Treat the `ALLOWED_EDGES` table as the only legal transitions; if a server response implies an illegal transition, surface it as a bug, not a UI feature.
- Use `isTerminalState(state)` rather than hard-coded terminal lists.
- Tenant-scope every read.
- Surface failure codes verbatim somewhere visible (a UI that swallows the code makes pipeline diagnostics harder).
