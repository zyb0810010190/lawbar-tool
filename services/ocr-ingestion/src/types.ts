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

export class IngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestionError";
  }
}
