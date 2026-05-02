// Single-page review view. Pure read over OcrPersistence.
//
// Step 8A constraints honored here:
//   - manual_review_recommended is read from result.review.manual_review_recommended,
//     never recomputed from confidence numbers (the contract doc fixes the
//     threshold function as worker-owned).
//   - manual_review_reasons comes from result.review.reasons.
//   - detected_seals / detected_tables are derived from blocks[].type
//     ("seal" | "table"), since the contract has no top-level seal/table list.
//   - evidence_index recognises only ONE explicit signal:
//     submission.metadata.client_tags / result.metadata.client_tags
//     containing "evidence-index". Structural heuristics over tables are
//     deliberately NOT implemented in 8A.
//   - text_preview is the first TEXT_PREVIEW_MAX_CHARS code units of raw_text.
//
// `getReviewableOcrPage` returns null when:
//   (a) the job does not exist, OR
//   (b) the job exists but no result has been persisted for that page yet
//       (the page is "pending" — the lifecycle/summary APIs surface that).
// In other words, there must be a result record to review. This keeps the
// API honest about what data backs each field.

import type {
  OcrPersistence,
  OcrJobRecord,
  OcrResultRecord,
} from "ocr-persistence";

import {
  TEXT_PREVIEW_MAX_CHARS,
  type BlockDigest,
  type EvidenceIndexSignal,
  type PartialFailureDigest,
  type ReviewableOcrPage,
} from "./types.js";

interface ResultLike {
  job_id: string;
  tenant_id: string;
  document_id: string;
  document_revision?: number;
  page_id: string;
  page_number: number;
  status: "succeeded" | "failed" | "cancelled";
  raw_text?: string;
  blocks?: ReadonlyArray<BlockLike>;
  review?: { manual_review_recommended: boolean; reasons?: ReadonlyArray<string> };
  partial_failure?: {
    code: string;
    message: string;
    is_transient: boolean;
    attempted_count: number;
  } | null;
  metadata?: { client_tags?: ReadonlyArray<string> } & Record<string, unknown>;
}

interface BlockLike {
  block_id: string;
  type: string;
}

const EVIDENCE_INDEX_TAG = "evidence-index";

export async function getReviewableOcrPage(
  persistence: OcrPersistence,
  args: { job_id: string; page_id: string },
): Promise<ReviewableOcrPage | null> {
  const { job_id, page_id } = args;
  const job = await persistence.getOcrJob(job_id);
  if (!job) return null;

  const results = await persistence.listOcrResults(job_id);
  const record = results.find((r) => r.result.page_id === page_id);
  if (!record) return null; // result-backed only; pending pages return null.

  return buildReviewableOcrPage(job, record);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildReviewableOcrPage(
  job: OcrJobRecord,
  record: OcrResultRecord,
): ReviewableOcrPage {
  const r = record.result as unknown as ResultLike;

  // status === "cancelled" is contract-permissible but `outcome` only
  // exposes succeeded/failed — cancellation propagates through the
  // job-level lifecycle, not the per-page review view. Map cancelled
  // -> "failed" for the queue view; downstream consumers asking "why"
  // can read partial_failure or fall back to the lifecycle.
  const outcome: "succeeded" | "failed" =
    r.status === "succeeded" ? "succeeded" : "failed";

  const raw_text = typeof r.raw_text === "string" ? r.raw_text : "";
  const text_preview = raw_text.slice(0, TEXT_PREVIEW_MAX_CHARS);

  const review = r.review;
  const manual_review_recommended = review?.manual_review_recommended === true;
  const manual_review_reasons: ReadonlyArray<string> = review?.reasons
    ? [...review.reasons]
    : [];

  const detected_seals = digestBlocks(r.blocks, "seal");
  const detected_tables = digestBlocks(r.blocks, "table");

  const evidence_index = deriveEvidenceIndexSignal(job, r);

  const partial_failure: PartialFailureDigest | null =
    outcome === "failed" && r.partial_failure
      ? {
          code: r.partial_failure.code,
          message: r.partial_failure.message,
          is_transient: r.partial_failure.is_transient,
          attempted_count: r.partial_failure.attempted_count,
        }
      : null;

  return {
    job_id: r.job_id,
    tenant_id: r.tenant_id,
    case_id: job.case_id,
    document_id: r.document_id,
    document_revision: r.document_revision,
    page_id: r.page_id,
    page_number: r.page_number,
    outcome,
    raw_text,
    text_preview,
    manual_review_recommended,
    manual_review_reasons,
    detected_seals,
    detected_tables,
    evidence_index,
    partial_failure,
    persisted_at: record.persisted_at,
  };
}

function digestBlocks(
  blocks: ReadonlyArray<BlockLike> | undefined,
  type: "seal" | "table",
): BlockDigest {
  if (!blocks || blocks.length === 0) return { count: 0, block_ids: [] };
  const matched = blocks.filter((b) => b.type === type);
  return {
    count: matched.length,
    block_ids: matched.map((b) => b.block_id),
  };
}

function deriveEvidenceIndexSignal(
  job: OcrJobRecord,
  result: ResultLike,
): EvidenceIndexSignal {
  // Look in either the submission metadata or the result metadata. Both
  // are arbitrary opaque objects per the contract; we accept either as a
  // legitimate carrier of the explicit "evidence-index" tag. Heuristic
  // detection is intentionally NOT done here (Step 8A constraint).
  const submissionTags =
    (job.submission as { metadata?: { client_tags?: ReadonlyArray<string> } }).metadata
      ?.client_tags;
  const resultTags = result.metadata?.client_tags;
  const present =
    hasEvidenceIndexTag(submissionTags) || hasEvidenceIndexTag(resultTags);
  return present
    ? { source: "metadata.client_tags", present: true }
    : { source: "none", present: false };
}

function hasEvidenceIndexTag(
  tags: ReadonlyArray<string> | undefined,
): boolean {
  if (!Array.isArray(tags)) return false;
  return tags.includes(EVIDENCE_INDEX_TAG);
}
