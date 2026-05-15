/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * This interface was referenced by `OcrJobOutcome`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
/**
 * This interface was referenced by `OcrJobOutcome`'s JSON-Schema
 * via the `definition` "state".
 */
export type State =
  | "queued"
  | "claimed"
  | "processing"
  | "succeeded"
  | "failed"
  | "partial_succeeded"
  | "cancelled"
  | "dead_lettered";
/**
 * This interface was referenced by `OcrJobOutcome`'s JSON-Schema
 * via the `definition` "actor".
 */
export type Actor = "queue" | "worker" | "web_app";
/**
 * OCR worker -> queue/web app. See docs/contracts/ocr-worker-contract.md §2.
 */
export type OcrResult = {
  [k: string]: unknown;
} & {
  /**
   * This interface was referenced by `undefined`'s JSON-Schema
   * via the `definition` "semver".
   */
  contract_version: string;
  /**
   * This interface was referenced by `undefined`'s JSON-Schema
   * via the `definition` "ulid".
   */
  job_id: string;
  /**
   * This interface was referenced by `undefined`'s JSON-Schema
   * via the `definition` "ulid".
   */
  tenant_id: string;
  /**
   * This interface was referenced by `undefined`'s JSON-Schema
   * via the `definition` "ulid".
   */
  document_id: string;
  document_revision?: number;
  /**
   * This interface was referenced by `undefined`'s JSON-Schema
   * via the `definition` "ulid".
   */
  page_id: string;
  page_number: number;
  status: "succeeded" | "failed" | "cancelled";
  engine: {
    name: string;
    version: string;
    model_set?: string;
    preprocessing_applied?: string[];
    [k: string]: unknown;
  };
  page_metrics: {
    detected_dpi?: number;
    detected_orientation_deg?: number;
    detected_dominant_script?: string;
    page_width_px?: number;
    page_height_px?: number;
    processing_duration_ms: number;
    queued_duration_ms?: number;
    [k: string]: unknown;
  };
  raw_text?: string;
  blocks?: Block[];
  review?: {
    manual_review_recommended: boolean;
    reasons?: (
      | "low_page_mean_confidence"
      | "low_block_confidence"
      | "low_word_confidence_density"
      | "low_dpi"
      | "seal_overlap"
      | "unexpected_vertical_text"
      | "table_cell_variance"
    )[];
    low_confidence_block_ids?: string[];
    page_confidence_summary?: {
      min?: number;
      median?: number;
      mean?: number;
      p10?: number;
      fraction_below_0_80?: number;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  partial_failure?: null | PartialFailure;
  metadata: {
    [k: string]: unknown;
  };
  completed_at: string;
  [k: string]: unknown;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "block".
 */
export type Block = {
  [k: string]: unknown;
} & {
  block_id: string;
  type:
    | "paragraph"
    | "line"
    | "heading"
    | "table"
    | "seal"
    | "figure"
    | "formula"
    | "handwriting"
    | "unknown";
  text?: string;
  confidence: number;
  bbox: Bbox;
  polygon?: Polygon;
  reading_order?: number;
  writing_mode?: "horizontal-tb" | "vertical-rl" | "vertical-lr";
  language?: string;
  words?: {
    text: string;
    confidence: number;
    bbox: Bbox;
    [k: string]: unknown;
  }[];
  seal_shape?: "circle" | "ellipse" | "square" | "rectangle" | "triangle" | "other";
  overlaps_block_ids?: string[];
  table?: Table;
  [k: string]: unknown;
};
/**
 * @minItems 4
 *
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "polygon".
 */
export type Polygon = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
  ...[number, number][]
];

/**
 * Production return shape of OcrWorker.process(job). See ADR-11A.5 v0.1. Engine-shaped mapping rules (reading order, bbox, confidence aggregation, etc.) are deferred to v1.0 post-bakeoff.
 */
export interface OcrJobOutcome {
  job_id: Ulid;
  /**
   * @minItems 1
   */
  statuses: [TransitionRecord, ...TransitionRecord[]];
  results: OcrResult[];
  terminal_state: State;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `OcrJobOutcome`'s JSON-Schema
 * via the `definition` "transitionRecord".
 */
export interface TransitionRecord {
  from: State;
  to: State;
  controlled_by: Actor;
  at: string;
  note?: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "bbox".
 */
export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "table".
 */
export interface Table {
  rows: number;
  cols: number;
  /**
   * @minItems 1
   */
  cells: [
    {
      row: number;
      col: number;
      text: string;
      confidence: number;
      row_span?: number;
      col_span?: number;
      [k: string]: unknown;
    },
    ...{
      row: number;
      col: number;
      text: string;
      confidence: number;
      row_span?: number;
      col_span?: number;
      [k: string]: unknown;
    }[]
  ];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "partialFailure".
 */
export interface PartialFailure {
  code: string;
  message: string;
  is_transient: boolean;
  attempted_count: number;
  [k: string]: unknown;
}
