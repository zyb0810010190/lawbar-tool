// Persistence boundary for the OCR worker contract.
//
// Design notes
// ------------
// 1. Records mirror the contract payloads. We do not invent incompatible fields.
//    The only derived value stored on top of contract data is `terminal_state`,
//    which is a cache of the last persisted status transition's `to` so the
//    web app can answer "what state is job X in?" without replaying the timeline.
//
// 2. Linkage fields (tenant_id / case_id / document_id / document_revision) are
//    lifted onto the job record for indexing only. They are NOT a second source
//    of truth — the canonical values live inside `submission`.
//
// 3. Status timeline is append-only. Each event stores its `seq` so iteration
//    order is total even if the underlying store re-orders rows.
//
// 4. Result records are keyed by (job_id, page_id). The contract permits multiple
//    page results per job (partial_succeeded), and a single page may not be
//    overwritten — `saveOcrResult` rejects a duplicate (job_id, page_id).
//
// 5. This file defines the *interface*. The DB-backed implementation slots in
//    behind `OcrPersistence`; today only an in-memory implementation exists.

import type {
  OcrSubmission,
} from "ocr-worker-contract";
import type {
  OcrResult,
} from "ocr-worker-contract";
import type {
  TransitionRecord,
  OcrJobState,
} from "ocr-worker-contract";

/**
 * Stored representation of an accepted OCR job. Indexing fields are lifted
 * from the submission for cheap lookup; the canonical submission payload is
 * preserved verbatim under `submission`.
 */
export interface OcrJobRecord {
  job_id: string;
  tenant_id: string;
  /** From submission.case_id when present; the contract leaves this optional. */
  case_id?: string;
  document_id: string;
  document_revision?: number;
  /** Verbatim contract-valid submission payload. */
  submission: OcrSubmission;
  /** When the persistence layer accepted the submission. */
  created_at: string;
  /**
   * Cache of the last appended status's `to`. Undefined until the first
   * status is appended. Updated atomically with each `appendOcrStatus` call.
   */
  terminal_state?: OcrJobState;
}

/** A single status transition, persisted with chain-position metadata. */
export interface OcrStatusEvent extends TransitionRecord {
  /** 1-indexed position within the timeline for this job_id. */
  seq: number;
  /** When the persistence layer committed the event. */
  persisted_at: string;
}

/** A single per-page OCR result, persisted with timestamp metadata. */
export interface OcrResultRecord {
  /** The full contract-valid result payload. */
  result: OcrResult;
  /** When the persistence layer committed the result. */
  persisted_at: string;
}

/**
 * The persistence seam. A DB-backed implementation lives behind this
 * interface. All methods are async to match a future real backend even
 * though the in-memory implementation resolves synchronously.
 *
 * Ordering guarantees:
 *   - listOcrJobStatuses: ascending by `seq`.
 *   - listOcrResults: ascending by `persisted_at`, ties broken by `page_id`.
 */
export interface OcrPersistence {
  /**
   * Validate the submission against the contract and persist it. Returns
   * the stored record. Throws `OcrPersistenceError` on validation failure
   * or if a job with the same `submission.job_id` already exists.
   */
  createOcrJob(submission: unknown): Promise<OcrJobRecord>;

  /**
   * Append a status transition to a job's timeline.
   * Validates the appended transition by re-validating the FULL chain via
   * the contract's `validateOcrStatusTransitionSequence`, so:
   *   - the single edge must be a documented transition
   *   - the new `from` must equal the previous event's `to`
   *   - terminal states cannot be re-departed
   * Throws `OcrPersistenceError` on any of the above or if the job is unknown.
   *
   * Strict variant — rejects every duplicate, even an exact replay. Use this
   * on the single-pass write path. For at-least-once queue redelivery, use
   * `appendOcrStatusOnce`.
   */
  appendOcrStatus(jobId: string, transition: TransitionRecord): Promise<OcrStatusEvent>;

  /**
   * Replay-safe variant of `appendOcrStatus`. Same validation, but tolerates
   * exact replays. Specifically:
   *   - if a canonically-equal copy of `transition` already exists anywhere
   *     in the job's timeline, return the stored event unchanged (no-op);
   *   - if no equal copy exists, do a strict append — which naturally
   *     rejects illegal edges, chain breaks, terminal-state re-departures,
   *     and any conflicting transition that disagrees with the chain.
   *
   * Use case: a queue coordinator that persisted a status transition and
   * then failed to ack the queue message can safely retry on redelivery
   * without crashing on "already exists".
   */
  appendOcrStatusOnce(
    jobId: string,
    transition: TransitionRecord,
  ): Promise<OcrStatusEvent>;

  /**
   * Validate and persist a per-page result. Cross-checks that
   * `result.job_id === jobId` and that linkage (tenant_id, document_id)
   * matches the stored job record. Rejects a duplicate (job_id, page_id).
   *
   * Strict variant — rejects every duplicate, even an exact replay. Use this
   * on the single-pass write path. For at-least-once queue redelivery, use
   * `saveOcrResultOnce`.
   */
  saveOcrResult(jobId: string, result: unknown): Promise<OcrResultRecord>;

  /**
   * Replay-safe variant of `saveOcrResult`. Validation and linkage checks
   * are unchanged (job existence, tenant/document/page/page_number/
   * document_revision linkage, contract validation). The duplicate check
   * is relaxed:
   *   - if no result exists for `(job_id, page_id)`, do a strict insert;
   *   - if an existing result is canonically-equal to the incoming one,
   *     return the stored record unchanged (no-op);
   *   - if an existing result differs, reject as `conflicting duplicate`.
   *
   * Equality compares the contract result payload (`OcrResult`) only. The
   * `persisted_at` wrapper field is store-assigned and is NOT part of the
   * equality check.
   */
  saveOcrResultOnce(jobId: string, result: unknown): Promise<OcrResultRecord>;

  getOcrJob(jobId: string): Promise<OcrJobRecord | null>;
  listOcrJobStatuses(jobId: string): Promise<OcrStatusEvent[]>;
  listOcrResults(jobId: string): Promise<OcrResultRecord[]>;

  /**
   * Cross-job: list jobs scoped to a tenant + document, optionally filtered
   * by document_revision. Sort: created_at DESC, then job_id ASC.
   * Pagination is seek-based via opaque cursor strings; see ./cursor.ts.
   */
  listOcrJobsByDocument(
    query: ListOcrJobsByDocumentQuery,
  ): Promise<ListOcrJobsByDocumentPage>;

  /**
   * Cross-job: list (job, result) row pairs whose
   * `result.review.manual_review_recommended === true`. Both succeeded and
   * failed result pages are eligible. Filters are tenant-scoped (required)
   * with optional document_id, document_revision, and case_id narrowing.
   * Sort: result.persisted_at DESC, job.job_id ASC, result.page_number ASC,
   * result.page_id ASC.
   */
  listOcrReviewPageRows(
    query: ListOcrReviewPageRowsQuery,
  ): Promise<ListOcrReviewPageRowsPage>;
}

// ---------------------------------------------------------------------------
// Cross-job query inputs/outputs
// ---------------------------------------------------------------------------

export interface ListOcrJobsByDocumentQuery {
  tenant_id: string;
  document_id: string;
  document_revision?: number;
  /** Default 50, max 200. Throws on invalid input. */
  limit?: number;
  /** Opaque cursor from a previous page; null/undefined starts fresh. */
  cursor?: string;
}

export interface ListOcrJobsByDocumentPage {
  rows: OcrJobRecord[];
  next_cursor: string | null;
}

export interface ListOcrReviewPageRowsQuery {
  tenant_id: string;
  document_id?: string;
  document_revision?: number;
  case_id?: string;
  /** Default 50, max 200. Throws on invalid input. */
  limit?: number;
  /** Opaque cursor from a previous page; null/undefined starts fresh. */
  cursor?: string;
}

/** Joined (job, result) row for the manual-review queue. */
export interface OcrReviewPageRow {
  job: OcrJobRecord;
  result: OcrResultRecord;
}

export interface ListOcrReviewPageRowsPage {
  rows: OcrReviewPageRow[];
  next_cursor: string | null;
}

export class OcrPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrPersistenceError";
  }
}
