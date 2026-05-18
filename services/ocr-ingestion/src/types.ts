// Ingestion-layer types. The shape here is what a legal-domain caller
// (case workspace, evidence pipeline, batch importer) provides; the layer
// translates it into a contract-valid `OcrSubmission`.
//
// Why a separate type instead of OcrSubmission directly?
//   - Domain callers should not have to know the OCR contract version,
//     retry policy, or `submitted_at` formatting.
//   - Domain callers own tenant/case/document/page IDs; the ingestion
//     layer owns `job_id` and `submitted_at`.
//   - Sensible defaults for ocr_options/preprocessing/retry are concentrated
//     here so domain callers aren't forced to repeat them.

import type { OcrSubmission } from "ocr-worker-contract";

/** A single page reference. Source mirrors the OCR contract's union. */
export interface IngestionPage {
  page_id: string;
  page_number: number;
  source: OcrSubmission["pages"][number]["source"];
}

export interface DocumentIngestionInput {
  tenant_id: string;
  /**
   * Optional — included on the submission only when present. The contract
   * leaves case_id optional so it does not block teams without a case model.
   */
  case_id?: string;
  document_id: string;
  /** Defaults to 1 if omitted. The contract requires it >= 1. */
  document_revision?: number;
  submitted_by: string;
  pages: IngestionPage[];
  // Optional knobs — passed through verbatim when present.
  ocr_options?: Partial<OcrSubmission["ocr_options"]>;
  preprocessing?: OcrSubmission["preprocessing"];
  priority?: number;
  deadline?: string;
  retry?: OcrSubmission["retry"];
  /**
   * Opaque legal-domain metadata. Round-tripped onto the submission as-is.
   * Use this for trace IDs, originating request IDs, court filing refs, etc.
   */
  metadata?: Record<string, unknown>;
}

export interface IngestionEnvironment {
  /** Default: pseudo-random 26-char [0-9a-z]. */
  generateJobId?: () => string;
  /** Default: `() => new Date()`. */
  now?: () => Date;
  /** Default: "1.0.0" (matches the current contract version). */
  contractVersion?: string;
}

/**
 * Stable, contract-relevant error codes the ingestion layer raises. Callers
 * (web app, batch importer) can branch on these without parsing the human
 * message. Add a new entry here when a NEW caller actually needs to branch
 * on a NEW class of rejection — codes are part of the public ingestion
 * surface and once exported MUST NOT be renamed or removed without a
 * coordinated change.
 *
 * Rationale: ADR-11B §3 caps OCR jobs at N=1 page for v1 (no lease
 * renewal). Multi-page submissions must be rejected at the ingestion
 * validator, not at the queue or worker, so the rejection is observable
 * before any I/O. `multi_page_unsupported` is the contract code for that
 * rejection class.
 */
export const INGESTION_ERROR_CODES = {
  MULTI_PAGE_UNSUPPORTED: "multi_page_unsupported",
} as const;

export type IngestionErrorCode =
  (typeof INGESTION_ERROR_CODES)[keyof typeof INGESTION_ERROR_CODES];

export class IngestionError extends Error {
  /**
   * Optional stable code for caller-side branching. `undefined` means the
   * error class is internal / not contract-relevant; callers should only
   * branch on errors whose code is present and listed in
   * `INGESTION_ERROR_CODES`.
   */
  readonly code?: IngestionErrorCode;

  constructor(message: string, options?: { code?: IngestionErrorCode }) {
    super(message);
    this.name = "IngestionError";
    if (options?.code !== undefined) {
      this.code = options.code;
    }
  }
}
