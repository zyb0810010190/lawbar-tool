// Read-model types. These are NOT contract types — they are derivations
// over OcrPersistence records (jobs, statuses, results). The contract
// remains the source of truth; this module re-exposes already-validated
// data in a shape lawyers / reviewers care about.
//
// Step 8A scope: single-job-id-scoped derivations only. Cross-job
// queries (listOcrJobsForDocument, listPagesNeedingManualReview, paging,
// rerun collapse) are deferred to Step 8B once OcrPersistence grows
// the corresponding read methods.

import type {
  OcrStatusEvent,
  OcrJobRecord,
  OcrResultRecord,
} from "ocr-persistence";
import type { OcrJobState } from "ocr-worker-contract";

/** Per-page outcome derived from result records (NOT from job status). */
export type PageOutcome = "succeeded" | "failed" | "pending" | "cancelled";

/** Lifecycle view for a single OCR job. */
export interface OcrJobLifecycle {
  job: OcrJobRecord;
  /** Append-order status timeline (already ordered by seq by persistence). */
  statuses: OcrStatusEvent[];
  /** All persisted page results for this job. */
  results: OcrResultRecord[];
  /**
   * Last status.to, or undefined when no statuses exist yet (a job that
   * was created but never claimed). Caller should treat undefined as
   * "queued but not yet observed by the worker".
   */
  current_state: OcrJobState | undefined;
  /**
   * True iff `current_state` is one of the contract's documented terminal
   * states. Always false when `current_state` is undefined.
   */
  is_terminal: boolean;
  /**
   * Mirrors `current_state` only when terminal. Undefined while the job
   * is still in flight. Use this when the consumer specifically wants
   * "is the job done, and how did it end" rather than "what state is
   * the job in right now". The persistence layer's `OcrJobRecord.terminal_state`
   * is a non-canonical cache (it tracks the *last* `to`, terminal or not);
   * this read-model field is the disambiguated version.
   */
  terminal_state: OcrJobState | undefined;
}

/** Per-page review view, returned by `getReviewableOcrPage`. */
export interface ReviewableOcrPage {
  /** Identity & linkage. */
  job_id: string;
  tenant_id: string;
  case_id: string | undefined;
  document_id: string;
  document_revision: number | undefined;
  page_id: string;
  page_number: number;
  /** Result-driven outcome: "succeeded" or "failed" (cancelled is allowed
   *  by the contract but only via a worker-emitted result record). The
   *  read model never returns "pending" here — that case yields `null`
   *  from `getReviewableOcrPage` because there is no result to review. */
  outcome: Exclude<PageOutcome, "pending">;
  /** Full text from result.raw_text. Empty string when the result did not
   *  store text (e.g. failed pages frequently omit raw_text). */
  raw_text: string;
  /** First TEXT_PREVIEW_MAX_CHARS code units of `raw_text`. Caller-friendly
   *  when listing pages without paying for full transcripts. Truncation is
   *  byte-naive (JS string slicing); good enough for a reviewer summary. */
  text_preview: string;
  /** Manual review flags read verbatim from `result.review`. The read model
   *  NEVER recomputes the threshold — that is worker-owned per the contract. */
  manual_review_recommended: boolean;
  manual_review_reasons: ReadonlyArray<string>;
  /** Counts and block IDs for blocks of type "seal" / "table". */
  detected_seals: BlockDigest;
  detected_tables: BlockDigest;
  /** Evidence-index signal. Step 8A only honors an explicit metadata.client_tags
   *  marker ("evidence-index"); structural heuristics over `tables` are NOT
   *  implemented. When neither signal is present, status is "unknown". */
  evidence_index: EvidenceIndexSignal;
  /** Partial-failure detail when `outcome === "failed"`, otherwise null. */
  partial_failure: PartialFailureDigest | null;
  /** When the persistence layer committed the result (mirrors OcrResultRecord). */
  persisted_at: string;
}

export interface BlockDigest {
  count: number;
  block_ids: ReadonlyArray<string>;
}

export type EvidenceIndexSignal =
  | { source: "metadata.client_tags"; present: true }
  | { source: "none"; present: false };

export interface PartialFailureDigest {
  code: string;
  message: string;
  is_transient: boolean;
  attempted_count: number;
}

/** Job-level outcome summary returned by `summarizeOcrIngestionOutcome`. */
export interface OcrIngestionOutcomeSummary {
  job_id: string;
  tenant_id: string;
  case_id: string | undefined;
  document_id: string;
  document_revision: number | undefined;
  current_state: OcrJobState | undefined;
  is_terminal: boolean;
  terminal_state: OcrJobState | undefined;
  /** Convenience boolean: terminal_state === "dead_lettered". */
  dead_lettered: boolean;
  /** Number of `failed -> queued` transitions in the timeline. */
  retry_count: number;
  /** Total submitted pages from `submission.pages`. */
  total_pages: number;
  succeeded_pages: number;
  failed_pages: number;
  pending_pages: number;
  failed_page_ids: ReadonlyArray<string>;
  pending_page_ids: ReadonlyArray<string>;
  /** Count of page results whose review.manual_review_recommended is true. */
  pages_needing_manual_review: number;
}

/** Truncation cap for ReviewableOcrPage.text_preview. */
export const TEXT_PREVIEW_MAX_CHARS = 500;

/**
 * Compact, lawyer-facing summary of an OCR job, returned as a row by
 * `listOcrJobsForDocument`. The shape is deliberately frozen — adding
 * fields here is a contract change, not an implementation detail. Counts
 * are derived from `submission.pages` + persisted result records only;
 * the read model never fans out to `listOcrJobStatuses` per row, so
 * `current_state` / `terminal_state` come from `OcrJobRecord.terminal_state`
 * (a non-canonical cache of the last persisted `to`).
 *
 * Multiple OCR runs over the same (tenant, document, document_revision)
 * appear as separate rows; rerun grouping is intentionally NOT applied here.
 */
export interface OcrDocumentJobSummary {
  job_id: string;
  tenant_id: string;
  case_id: string | undefined;
  document_id: string;
  document_revision: number | undefined;
  created_at: string;
  submitted_by: string | undefined;
  /** Last persisted status `to`; undefined when no statuses exist yet. */
  current_state: OcrJobState | undefined;
  /** True iff `current_state` is one of the contract's terminal states. */
  is_terminal: boolean;
  /** Mirrors `current_state` only when terminal; undefined otherwise. */
  terminal_state: OcrJobState | undefined;
  /** Submitted page count (submission.pages.length). */
  total_pages: number;
  /** Number of persisted result records for this job (any status). */
  result_pages: number;
  /** Number of result records with status === "succeeded". */
  succeeded_pages: number;
  /** Number of result records with status === "failed" OR "cancelled". */
  failed_pages: number;
  /** Number of submitted pages with no persisted result yet. */
  pending_pages: number;
  /** Number of result records flagged for manual review. */
  manual_review_pages: number;
  /** Verbatim submission.metadata, or undefined when not present. */
  metadata: Readonly<Record<string, unknown>> | undefined;
}
