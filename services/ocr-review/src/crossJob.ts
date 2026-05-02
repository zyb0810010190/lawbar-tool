// Cross-job read APIs (Step 8B). Pure reads over OcrPersistence.
//
// Constraints honored here:
//   - All ordering, filtering, and cursor encoding is owned by persistence.
//     The review layer never re-sorts and passes cursors through unchanged.
//   - listOcrJobsForDocument NEVER calls `listOcrJobStatuses` per row.
//     `current_state` / `terminal_state` come from `OcrJobRecord.terminal_state`,
//     the cache of the last persisted `to`.
//   - Counts come from `submission.pages` + per-job result rows. Manual-review
//     verdict is read from `result.review.manual_review_recommended` verbatim;
//     the read model never recomputes the threshold.
//   - Rows returned by listOcrJobsForDocument are runtime-frozen so callers
//     cannot mutate them post-hoc.

import { isTerminalState } from "ocr-worker-contract";
import type {
  ListOcrJobsByDocumentQuery,
  ListOcrReviewPageRowsQuery,
  OcrJobRecord,
  OcrPersistence,
  OcrResultRecord,
} from "ocr-persistence";

import { buildReviewableOcrPage } from "./page.js";
import type { OcrDocumentJobSummary, ReviewableOcrPage } from "./types.js";

interface ResultLike {
  page_id: string;
  status: "succeeded" | "failed" | "cancelled";
  review?: { manual_review_recommended?: boolean };
}

interface SubmissionLike {
  submitted_by?: string;
  pages: ReadonlyArray<{ page_id: string }>;
  metadata?: Record<string, unknown>;
}

export interface ListOcrJobsForDocumentResult {
  rows: ReadonlyArray<OcrDocumentJobSummary>;
  next_cursor: string | null;
}

export interface ListPagesNeedingManualReviewResult {
  rows: ReadonlyArray<ReviewableOcrPage>;
  next_cursor: string | null;
}

/**
 * Cross-job summary view scoped to (tenant_id, document_id) [+ revision].
 * Pagination is delegated to persistence.listOcrJobsByDocument; the cursor
 * is passed through unchanged. Each row's per-job result list is fetched
 * via persistence.listOcrResults — no status-event fan-out occurs.
 */
export async function listOcrJobsForDocument(
  persistence: OcrPersistence,
  query: ListOcrJobsByDocumentQuery,
): Promise<ListOcrJobsForDocumentResult> {
  const page = await persistence.listOcrJobsByDocument(query);
  const rows: OcrDocumentJobSummary[] = [];
  for (const job of page.rows) {
    const results = await persistence.listOcrResults(job.job_id);
    rows.push(buildJobSummary(job, results));
  }
  return { rows, next_cursor: page.next_cursor };
}

/**
 * Cross-job manual-review queue. Pagination is delegated to
 * persistence.listOcrReviewPageRows; the cursor is passed through unchanged.
 * Each (job, result) row is mapped through Step 8A's buildReviewableOcrPage,
 * so manual_review_recommended/reasons are read verbatim and never recomputed.
 */
export async function listPagesNeedingManualReview(
  persistence: OcrPersistence,
  query: ListOcrReviewPageRowsQuery,
): Promise<ListPagesNeedingManualReviewResult> {
  const page = await persistence.listOcrReviewPageRows(query);
  const rows = page.rows.map((row) => buildReviewableOcrPage(row.job, row.result));
  return { rows, next_cursor: page.next_cursor };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildJobSummary(
  job: OcrJobRecord,
  results: ReadonlyArray<OcrResultRecord>,
): OcrDocumentJobSummary {
  const submission = job.submission as unknown as SubmissionLike;
  const submittedPages = submission.pages;
  const total_pages = submittedPages.length;

  const seenPageIds = new Set<string>();
  let succeeded_pages = 0;
  let failed_pages = 0;
  let manual_review_pages = 0;
  for (const r of results) {
    const rl = r.result as unknown as ResultLike;
    seenPageIds.add(rl.page_id);
    if (rl.status === "succeeded") succeeded_pages++;
    else failed_pages++; // failed OR cancelled
    if (rl.review?.manual_review_recommended === true) manual_review_pages++;
  }
  const result_pages = results.length;

  let pending_pages = 0;
  for (const p of submittedPages) {
    if (!seenPageIds.has(p.page_id)) pending_pages++;
  }

  // current_state comes from the persistence cache, NOT from a status fan-out.
  const cached = job.terminal_state;
  const current_state = cached;
  const is_terminal = current_state !== undefined && isTerminalState(current_state);
  const terminal_state = is_terminal ? current_state : undefined;

  const summary: OcrDocumentJobSummary = {
    job_id: job.job_id,
    tenant_id: job.tenant_id,
    case_id: job.case_id,
    document_id: job.document_id,
    document_revision: job.document_revision,
    created_at: job.created_at,
    submitted_by: submission.submitted_by,
    current_state,
    is_terminal,
    terminal_state,
    total_pages,
    result_pages,
    succeeded_pages,
    failed_pages,
    pending_pages,
    manual_review_pages,
    metadata: submission.metadata
      ? Object.freeze({ ...submission.metadata })
      : undefined,
  };
  return Object.freeze(summary);
}
