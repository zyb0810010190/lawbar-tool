/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * This interface was referenced by `OcrSubmission`'s JSON-Schema
 * via the `definition` "semver".
 */
export type Semver = string;
/**
 * Lowercase 26-char ULID. Conventionally Crockford base32 (no i/l/o/u), but the schema accepts the broader [0-9a-z] alphabet so fixtures and stub IDs aren't blocked. Producers SHOULD emit valid Crockford ULIDs.
 *
 * This interface was referenced by `OcrSubmission`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
/**
 * This interface was referenced by `OcrSubmission`'s JSON-Schema
 * via the `definition` "source".
 */
export type Source =
  | {
      kind: "s3";
      bucket: string;
      key: string;
      etag?: string;
      expected_sha256?: string;
      byte_size?: number;
      mime_type?: string;
      [k: string]: unknown;
    }
  | {
      kind: "https";
      url: string;
      url_expires_at?: string;
      expected_sha256?: string;
      byte_size?: number;
      mime_type?: string;
      [k: string]: unknown;
    }
  | {
      kind: "inline";
      base64: string;
      byte_size: number;
      mime_type?: string;
      [k: string]: unknown;
    }
  | {
      kind: "file";
      path: string;
      byte_size: number;
      mime_type: string;
      [k: string]: unknown;
    };

/**
 * Web app -> queue -> OCR worker. See docs/contracts/ocr-worker-contract.md §1.
 */
export interface OcrSubmission {
  contract_version: Semver;
  job_id: Ulid;
  tenant_id: Ulid;
  case_id?: Ulid;
  document_id: Ulid;
  document_revision: number;
  submitted_at: string;
  submitted_by: string;
  /**
   * @minItems 1
   */
  pages: [PageRef, ...PageRef[]];
  rerun?: {
    [k: string]: unknown;
  };
  ocr_options: {
    /**
     * @minItems 1
     */
    languages: [string, ...string[]];
    detect_orientation?: boolean;
    detect_vertical_text?: boolean;
    table_recognition?: "off" | "auto" | "force";
    seal_recognition?: boolean;
    return_word_confidence?: boolean;
    return_polygon?: boolean;
    min_confidence_emit?: number;
    [k: string]: unknown;
  };
  preprocessing: {
    deskew?: "off" | "auto" | "force";
    denoise?: "off" | "auto" | "aggressive";
    binarize?: boolean;
    remove_seal_bleed?: boolean;
    upscale_low_dpi?: boolean;
    target_dpi_floor?: number;
    crop_borders?: "off" | "auto";
    [k: string]: unknown;
  };
  /**
   * Higher = more urgent. Range 0-100 inclusive.
   */
  priority: number;
  deadline?: string;
  retry: {
    [k: string]: unknown;
  };
  metadata: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
/**
 * This interface was referenced by `OcrSubmission`'s JSON-Schema
 * via the `definition` "pageRef".
 */
export interface PageRef {
  page_id: Ulid;
  page_number: number;
  source: Source;
  [k: string]: unknown;
}
