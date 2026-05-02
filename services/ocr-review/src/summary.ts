// Job-level outcome summary. Pure read over OcrPersistence.
//
// Page-count math
// ---------------
//   total_pages       — submitted pages (submission.pages.length).
//   succeeded_pages   — count of result records with status === "succeeded".
//   failed_pages      — count of result records with status === "failed"
//                       OR status === "cancelled" (per-page failure umbrella).
//   pending_pages     — submitted pages with no result yet.
//   failed_page_ids   — page_ids of failed/cancelled results.
//   pending_page_ids  — submitted page_ids with no corresponding result.
//
// Retry/dead-letter
// -----------------
//   retry_count   — number of `failed -> queued` edges in the timeline.
//   dead_lettered — current_state is terminal AND equals "dead_lettered".
//
// We deliberately do NOT collapse partial_failure into a job-level
// "single reason" — the per-page partial_failure is the ground truth.
// Aggregation here is counts; detail belongs in `getReviewableOcrPage`.

import type {
  OcrPersistence,
  OcrJobRecord,
  OcrResultRecord,
} from "ocr-persistence";

import { deriveCurrentState, deriveRetryCount } from "./lifecycle.js";
import { isTerminalState } from "ocr-worker-contract";
import type { OcrIngestionOutcomeSummary } from "./types.js";

interface ResultLike {
  page_id: string;
  status: "succeeded" | "failed" | "cancelled";
  review?: { manual_review_recommended: boolean };
}

interface PageRefLike {
  page_id: string;
}

export async function summarizeOcrIngestionOutcome(
  persistence: OcrPersistence,
  jobId: string,
): Promise<OcrIngestionOutcomeSummary | null> {
  const job = await persistence.getOcrJob(jobId);
  if (!job) return null;
  const statuses = await persistence.listOcrJobStatuses(jobId);
  const results = await persistence.listOcrResults(jobId);

  const current_state = deriveCurrentState(statuses);
  const is_terminal =
    current_state !== undefined && isTerminalState(current_state);
  const terminal_state = is_terminal ? current_state : undefined;
  const dead_lettered = terminal_state === "dead_lettered";

  const retry_count = deriveRetryCount(statuses);

  const pageBreakdown = derivePageBreakdown(job, results);

  const pages_needing_manual_review = countManualReviewPages(results);

  return {
    job_id: job.job_id,
    tenant_id: job.tenant_id,
    case_id: job.case_id,
    document_id: job.document_id,
    document_revision: job.document_revision,
    current_state,
    is_terminal,
    terminal_state,
    dead_lettered,
    retry_count,
    total_pages: pageBreakdown.total_pages,
    succeeded_pages: pageBreakdown.succeeded_pages,
    failed_pages: pageBreakdown.failed_pages,
    pending_pages: pageBreakdown.pending_pages,
    failed_page_ids: pageBreakdown.failed_page_ids,
    pending_page_ids: pageBreakdown.pending_page_ids,
    pages_needing_manual_review,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PageBreakdown {
  total_pages: number;
  succeeded_pages: number;
  failed_pages: number;
  pending_pages: number;
  failed_page_ids: string[];
  pending_page_ids: string[];
}

function derivePageBreakdown(
  job: OcrJobRecord,
  results: ReadonlyArray<OcrResultRecord>,
): PageBreakdown {
  const submittedPages = (job.submission as { pages: ReadonlyArray<PageRefLike> })
    .pages;
  const total_pages = submittedPages.length;

  const resultByPageId = new Map<string, ResultLike>();
  for (const r of results) {
    resultByPageId.set(
      (r.result as unknown as ResultLike).page_id,
      r.result as unknown as ResultLike,
    );
  }

  let succeeded_pages = 0;
  let failed_pages = 0;
  let pending_pages = 0;
  const failed_page_ids: string[] = [];
  const pending_page_ids: string[] = [];

  for (const p of submittedPages) {
    const result = resultByPageId.get(p.page_id);
    if (!result) {
      pending_pages++;
      pending_page_ids.push(p.page_id);
      continue;
    }
    if (result.status === "succeeded") {
      succeeded_pages++;
    } else {
      // failed OR cancelled — both count against the page.
      failed_pages++;
      failed_page_ids.push(p.page_id);
    }
  }

  return {
    total_pages,
    succeeded_pages,
    failed_pages,
    pending_pages,
    failed_page_ids,
    pending_page_ids,
  };
}

function countManualReviewPages(
  results: ReadonlyArray<OcrResultRecord>,
): number {
  let n = 0;
  for (const r of results) {
    const rl = r.result as unknown as ResultLike;
    if (rl.review?.manual_review_recommended === true) n++;
  }
  return n;
}
