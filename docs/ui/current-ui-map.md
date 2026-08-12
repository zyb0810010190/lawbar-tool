# Current UI Map (UI-00 baseline)

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
**Status**: **Baseline zero — no UI implementation exists.**
**Method**: exhaustive repo sweep + backend-contract derivation.

## Bottom line

The lawbar-tool repository at HEAD (`06c83d2`, branch `ui-contract-and-design-recovery`) contains **zero UI code**. This file documents that fact, enumerates what was searched, and then — per AGENTS.md "no false claims" — describes the **inferred required UI surface** derived from the backend contracts that already exist. Every screen below is an *inference*, not an artifact. None has a current implementation; none has tests; none has any style or responsive risk yet because none has any code.

## What was searched

| Search | Result |
|---|---|
| Files matching `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.html` (excluding `node_modules`) | 0 hits |
| Directories named `components` / `pages` / `routes` / `views` / `ui` / `web` / `frontend` / `client` / `extension` (depth ≤ 3) | 0 hits |
| Any `package.json` declaring react / vue / svelte / next / vite / preact / solid-js / astro / webpack | 0 hits |
| Browser-extension `manifest.json` | only `services/ocr-worker-bakeoff/fixtures/manifest.json` — a test fixture for the OCR benchmarking harness, **not** a browser-extension manifest |
| `docs/ui/` directory | did not exist; created by this task |

The repo is **5 backend Node services + 1 contract package**, all TypeScript ESM, all data/library APIs:

- `docs/contracts/` — schemas + validators + state machine (the vocabulary owner)
- `services/ocr-ingestion/` — domain → submission
- `services/ocr-worker/` — queue-facing adapter + CLI
- `services/ocr-persistence/` — source-of-truth DB layer
- `services/ocr-review/` — read model (lawyer-facing OCR review state, exposed as a TypeScript library API, **not** as a UI)
- `services/ocr-worker-bakeoff/` — engine benchmarking harness

The phrase "lawyer-facing" in `ocr-review/package.json` refers to the **shape** of data it returns (what a lawyer would care about reviewing), not a UI implementation.

## The web_app actor is named in the contract but not implemented

`docs/contracts/src/transitions.ts` defines three actors that own OCR state transitions:

```ts
export type OcrJobActor = "queue" | "worker" | "web_app";
```

`web_app` owns exactly one transition: **cancel** (any non-terminal state → `cancelled`). So the contract has a designed-for UI seam, but no UI has been built.

## Inferred required UI surface

Derived from the backend contracts. Every screen here is **proposed**, not implemented.

For each: classification per the UI-00 spec is **defer** (no work scheduled) unless explicitly tagged otherwise; classification will be revisited in `ui-gap-report.md`.

---

### S1. Job submission

| Attribute | Value |
|---|---|
| Purpose | Allow an operator to submit a new OCR job for a document. |
| User goal | Hand a multi-page legal document to the OCR pipeline and observe it queue. |
| Data inputs | Submission per `docs/contracts/schemas/ocr-submission.schema.json` — at minimum: tenant_id, document_id, pages[].page_id + page_number + source (file/https/inline), ocr_options, preprocessing, retry, priority, metadata. |
| Actions / buttons | Submit, Cancel (form-level), per-page Add / Remove / Reorder. |
| Loading states | Submission in flight; per-page upload progress if source.kind = "inline". |
| Empty states | No pages yet (initial form). |
| Error states | Validation rejection per Ajv (which field, which constraint); 4xx server error; 5xx server error; transient network. Map to contract validators: `validateSubmission` returns `{ ok: false, summary, errors }`. |
| Validation states | Per-field schema validation (sync); pre-submit dry-run of `validateSubmission`. |
| Persistence / storage | Browser draft only (not yet persisted in `ocr-persistence`). |
| Backend dependency | `ocr-ingestion` (no HTTP API today — would need to be wrapped). |
| Existing tests | none |
| Missing tests | unit (form validation), integration (submission round-trip), accessibility, error-mapping |
| Hardcoded style risks | N/A (no code) |
| Responsive risks | N/A (no code) |
| **Classification** | **defer** until backend ingestion API exposed |

---

### S2. Job-list / "all jobs for a document"

| Attribute | Value |
|---|---|
| Purpose | List every OCR job run against a given document_id within a tenant. |
| User goal | Find the latest successful OCR run, or compare reruns. |
| Data inputs | `listOcrJobsForDocument({ tenant_id, document_id })` from `ocr-review`. Returns `ReadonlyArray<OcrDocumentJobSummary>` with: job_id, created_at, submitted_by, current_state, is_terminal, terminal_state, total_pages, succeeded_pages, failed_pages, pending_pages, manual_review_pages, metadata. |
| Actions / buttons | Open job detail (S3), View pages needing review (S5), Cancel (only when `is_terminal === false`; web_app actor per contract). |
| Loading states | Fetching list; per-row "still updating" if a job is non-terminal. |
| Empty states | No jobs for this document yet → "Submit your first job" CTA → S1. |
| Error states | Tenant scoping failure (auth); document not found; persistence read failure. |
| Validation states | Document/tenant identity validation; no field-level validation needed (read-only). |
| Persistence / storage | None — pure read-model. |
| Backend dependency | `ocr-review.listOcrJobsForDocument` (already exists, library-only — needs HTTP wrapping). |
| Existing tests | none in UI; `ocr-review/tests/review.crossjob.test.mjs` covers the data layer |
| Missing tests | UI render of summary rows; terminal-vs-in-flight cell rendering; manual-review-pages badge; rerun-collapse (intentionally not done — multiple runs over same document_revision appear as separate rows) |
| Hardcoded style risks | N/A |
| Responsive risks | N/A |
| **Classification** | **defer** |

---

### S3. Job detail (single-job lifecycle)

| Attribute | Value |
|---|---|
| Purpose | Show one OCR job's lifecycle in detail. |
| User goal | Diagnose what happened to a specific job: state timeline, per-page outcomes, retry history. |
| Data inputs | `getOcrJobLifecycle(job_id)` from `ocr-review`. Returns `OcrJobLifecycle` with: job (record), statuses (append-order timeline), results (per-page), current_state, is_terminal, terminal_state. |
| Actions / buttons | Open per-page review (S4), Cancel (web_app actor, only when non-terminal), Refresh, Copy job_id. |
| Loading states | Initial fetch; polling for in-flight jobs (cadence TBD). |
| Empty states | Job_id not found; tenant mismatch. |
| Error states | Permission denied; persistence read failure; result iterator exhaustion. |
| Validation states | job_id format validation (likely ULID per contract). |
| Persistence / storage | None — pure read. |
| Backend dependency | `ocr-review.getOcrJobLifecycle` (library API; needs HTTP wrap). |
| Existing tests | none in UI; `ocr-review/tests/review.test.mjs` covers the data layer |
| Missing tests | timeline rendering across all 8 states; partial_succeeded view; dead_lettered with reason; non-terminal vs terminal CTA gating |
| Hardcoded style risks | N/A |
| Responsive risks | N/A |
| **Classification** | **defer** |

---

### S4. Per-page review

| Attribute | Value |
|---|---|
| Purpose | Surface the OCR output for one page so a lawyer can verify or correct it. |
| User goal | Confirm OCR text matches source; act on manual-review flags; investigate detected seals/tables/evidence. |
| Data inputs | `getReviewableOcrPage({ job_id, page_id })` returning `ReviewableOcrPage`: outcome ("succeeded"/"failed"), raw_text, text_preview (≤500 chars), manual_review_recommended, manual_review_reasons[], detected_seals.{count,block_ids[]}, detected_tables.{count,block_ids[]}, evidence_index signal, partial_failure (when failed), persisted_at. |
| Actions / buttons | Mark reviewed (would need new persistence write path; **NOT in current contract**), Open original source, Open next page, Open previous page, Flag for re-OCR (would invoke ingestion). |
| Loading states | Page-data fetch; image render (when source viewing is added). |
| Empty states | Page has no result yet (pending) → `getReviewableOcrPage` returns `null`; surface as "Not yet OCR-ed". |
| Error states | Failed-page detail (show partial_failure.{code,message,is_transient,attempted_count}); cancelled-page detail; persistence read failure. |
| Validation states | none from contract; UI would validate manual-correction inputs if those are added. |
| Persistence / storage | Read-only today. Any "save correction" feature requires a new persistence surface — **not yet specified**. |
| Backend dependency | `ocr-review.getReviewableOcrPage`. |
| Existing tests | `ocr-review/tests/review.test.mjs` |
| Missing tests | succeeded/failed/cancelled outcome rendering; manual-review-reason rendering; partial_failure display; text-preview truncation at 500 chars (TEXT_PREVIEW_MAX_CHARS); evidence_index signal rendering |
| Hardcoded style risks | N/A |
| Responsive risks | N/A |
| **Classification** | **defer** (and depends on a yet-unspecified "save correction" persistence surface for write actions) |

---

### S5. Pages needing manual review (cross-job worklist)

| Attribute | Value |
|---|---|
| Purpose | Reviewer worklist of pages where the worker recommended manual review. |
| User goal | Triage manual-review pages across the tenant. |
| Data inputs | `listPagesNeedingManualReview({ tenant_id, ... })` from `ocr-review` (Step 8B). Pagination handled by persistence-owned cursors. |
| Actions / buttons | Open page (S4), mark triaged (requires new write surface — **not specified**). |
| Loading states | Initial fetch; pagination. |
| Empty states | Inbox zero (no pages flagged). |
| Error states | Permission denied; cursor invalid; persistence read failure. |
| Validation states | none. |
| Persistence / storage | Read-only today. |
| Backend dependency | `ocr-review.listPagesNeedingManualReview` (already exists). |
| Existing tests | `ocr-review/tests/review.crossjob.test.mjs` |
| Missing tests | UI rendering of paged worklist; cursor handling; per-row open-link wiring |
| Hardcoded style risks | N/A |
| Responsive risks | N/A |
| **Classification** | **defer** |

---

### S6. Job-cancel action (component, not a screen)

| Attribute | Value |
|---|---|
| Purpose | Allow the `web_app` actor to transition any non-terminal job to `cancelled`. |
| User goal | Stop a job that is running too long, was submitted in error, or is no longer needed. |
| Data inputs | job_id + current_state (must be non-terminal per contract). |
| Actions / buttons | Cancel (with confirm), Undo (where possible — but cancel is terminal so no undo). |
| Loading states | Cancel in flight. |
| Empty states | N/A (component). |
| Error states | "Already terminal" — UI should refuse before sending. "Permission denied". "Race: state changed between fetch and submit" — UI shows updated state. |
| Validation states | Pre-flight: `isTerminalState(current_state) === false`. |
| Persistence / storage | Cancel writes a new status event via worker / queue / API surface — **the exact write path is not yet specified**. The contract authorizes `web_app` as actor; persistence is via `ocr-persistence.appendOcrStatusOnce`. |
| Backend dependency | A still-unspecified HTTP / RPC surface that the web_app calls. Per AGENTS.md "Coordinator owns lifecycle. Adapter must not own lifecycle." — the web_app must NOT bypass the coordinator. |
| Existing tests | none |
| Missing tests | confirm flow; idempotent re-submission; terminal-race handling; coordinator-mediated write path |
| Hardcoded style risks | N/A |
| Responsive risks | N/A |
| **Classification** | **defer** (gated on a designed cancel-endpoint that respects coordinator ownership) |

---

### S7. Tenant / case scoping (cross-cutting concern, not a screen)

| Attribute | Value |
|---|---|
| Purpose | Every read API in `ocr-review` is tenant-scoped. The UI must establish tenant identity before any data fetch. |
| User goal | Operate in the correct tenant context; never cross-contaminate. |
| Data inputs | tenant_id (and case_id if scoped). |
| Actions / buttons | Switch tenant / Switch case. |
| Loading states | Auth fetch. |
| Empty states | No tenants for this user. |
| Error states | Auth failure; tenant not assigned; cross-tenant attempt blocked. |
| Validation states | tenant_id format (likely ULID). |
| Persistence / storage | Session token, current-tenant selection. |
| Backend dependency | Auth surface — **not in this repo today**. |
| Existing tests | none |
| Missing tests | tenant-switch isolation; cross-tenant access denied; session expiry |
| Hardcoded style risks | N/A |
| Responsive risks | N/A |
| **Classification** | **defer** (depends on auth surface that does not exist yet) |

---

## Cross-cutting nothing-yet

- No design system, no theme, no token file, no component library.
- No HTTP API gateway in front of the services (every backend module is a TypeScript library API today, not a network surface).
- No accessibility audit baseline.
- No internationalization. The OCR target language is Chinese (`zh-Hans` per the worker's `ocr_options.languages` default), but no UI strings exist to translate.
- No telemetry / analytics integration; no error reporting wiring.

## Honest caveats

- This inference assumes the same backend contracts will gate the UI. If the project pivots (different surface, different data model), redo this map.
- The contract has a designed-for `web_app` actor but **no API gateway exposes the worker / review / ingestion libraries to a network client today**. Any UI work depends on that gateway existing — that is a backend prerequisite, not a UI task.
- The "lawyer-facing" framing is data-shape language, not UX language. There is no validated lawyer-user research in this repo.
