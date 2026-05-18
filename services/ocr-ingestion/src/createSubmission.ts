// Translate a domain-side `DocumentIngestionInput` into a contract-valid
// `OcrSubmission`. The function fills defaults for fields the contract
// requires but the domain caller does not own (job_id, submitted_at,
// retry policy, ocr_options.languages, etc.) and then runs the produced
// payload through `validateOcrSubmission` so a malformed result fails
// loudly here rather than at the queue boundary.

import { randomInt } from "node:crypto";

import {
  validateOcrSubmission,
  type OcrSubmission,
} from "ocr-worker-contract";

import {
  IngestionError,
  INGESTION_ERROR_CODES,
  type DocumentIngestionInput,
  type IngestionEnvironment,
} from "./types.js";

const DEFAULT_CONTRACT_VERSION = "1.0.0";
const DEFAULT_OCR_LANGUAGES = ["zh-Hans", "en"];

const DEFAULT_OCR_OPTIONS = {
  languages: DEFAULT_OCR_LANGUAGES,
  detect_orientation: true,
  detect_vertical_text: true,
  table_recognition: "auto" as const,
  seal_recognition: true,
  return_word_confidence: true,
  return_polygon: true,
  min_confidence_emit: 0.3,
};

const DEFAULT_PREPROCESSING = {
  deskew: "auto" as const,
  denoise: "auto" as const,
  binarize: false,
  remove_seal_bleed: false,
  upscale_low_dpi: true,
  target_dpi_floor: 200,
  crop_borders: "auto" as const,
};

const DEFAULT_RETRY = {
  max_attempts: 3,
  backoff: "exponential" as const,
  base_delay_ms: 2000,
  max_delay_ms: 60000,
  attempt: 1,
};

/**
 * Build a contract-valid OCR submission from a domain ingestion request.
 * Throws `IngestionError` for missing structural fields the layer expects
 * the caller to own, OR for any contract validation failure (Ajv summary
 * is included in the message so it surfaces in test output).
 */
export function createOcrSubmissionFromDocument(
  input: DocumentIngestionInput,
  env: IngestionEnvironment = {},
): OcrSubmission {
  // Cheap up-front guards. The contract validator catches all of these too,
  // but the messages from domain-facing callers are more useful when we
  // explain the missing identity directly.
  if (!input || typeof input !== "object") {
    throw new IngestionError("ingestion input is required");
  }
  requireNonEmptyString(input.tenant_id, "tenant_id");
  requireNonEmptyString(input.document_id, "document_id");
  requireNonEmptyString(input.submitted_by, "submitted_by");
  if (!Array.isArray(input.pages) || input.pages.length === 0) {
    throw new IngestionError("at least one page is required");
  }
  // ADR-11B §3: v1 caps OCR jobs at N=1 page so lease-renewal math holds
  // (no renewal needed). Multi-page submissions must be rejected here at
  // the validator, before any persistence or queue I/O, with a stable
  // contract code callers can branch on.
  if (input.pages.length > 1) {
    throw new IngestionError(
      `multi-page OCR submissions are not supported in v1 (received ${input.pages.length} pages; cap is 1 per ADR-11B §3)`,
      { code: INGESTION_ERROR_CODES.MULTI_PAGE_UNSUPPORTED },
    );
  }
  for (const [i, p] of input.pages.entries()) {
    requireNonEmptyString(p?.page_id, `pages[${i}].page_id`);
    if (!Number.isInteger(p?.page_number) || p.page_number < 1) {
      throw new IngestionError(`pages[${i}].page_number must be an integer >= 1`);
    }
    if (!p?.source || typeof p.source !== "object") {
      throw new IngestionError(`pages[${i}].source is required`);
    }
  }

  const now = env.now ?? (() => new Date());
  const generateJobId = env.generateJobId ?? defaultJobIdGenerator;
  const contractVersion = env.contractVersion ?? DEFAULT_CONTRACT_VERSION;

  const submission: OcrSubmission = {
    contract_version: contractVersion,
    job_id: generateJobId(),
    tenant_id: input.tenant_id,
    document_id: input.document_id,
    document_revision: input.document_revision ?? 1,
    submitted_at: now().toISOString(),
    submitted_by: input.submitted_by,
    // Guarded above (input.pages.length >= 1); cast satisfies the generated
    // tuple type [PageRef, ...PageRef[]] which TS cannot infer from .map().
    pages: input.pages.map((p) => ({
      page_id: p.page_id,
      page_number: p.page_number,
      source: p.source,
    })) as unknown as OcrSubmission["pages"],
    rerun: { is_rerun: false, previous_job_id: null, page_ids: null },
    // Defensive cloning of every default below: without it, two submissions
    // built back-to-back would share the same `languages` array, the same
    // `preprocessing` object, and the same `retry` object, so a downstream
    // mutation of one submission's payload would silently corrupt the other.
    // structuredClone is also applied to caller-supplied objects so the
    // returned submission cannot leak references back to caller-held state.
    ocr_options: {
      ...DEFAULT_OCR_OPTIONS,
      ...(input.ocr_options ? structuredClone(input.ocr_options) : {}),
      // Schema requires `languages` to be a non-empty array of strings. Empty
      // arrays from the caller fall through to the contract validator below
      // and produce a clear `IngestionError` with the Ajv summary attached.
      // The inline copy of DEFAULT_OCR_LANGUAGES guarantees a fresh array per
      // submission so downstream mutation cannot leak across calls.
      languages: (input.ocr_options?.languages !== undefined
        ? [...input.ocr_options.languages]
        : [...DEFAULT_OCR_LANGUAGES]) as
        unknown as OcrSubmission["ocr_options"]["languages"],
    },
    preprocessing: input.preprocessing
      ? structuredClone(input.preprocessing)
      : { ...DEFAULT_PREPROCESSING },
    priority: input.priority ?? 50,
    retry: input.retry ? structuredClone(input.retry) : { ...DEFAULT_RETRY },
    metadata: input.metadata ? structuredClone(input.metadata) : {},
  };

  // Optional fields layer on only when present.
  if (input.case_id !== undefined) submission.case_id = input.case_id;
  if (input.deadline !== undefined) submission.deadline = input.deadline;

  // Final word: the contract validator. If anything in the assembled payload
  // disagrees with the schema, refuse to ship it downstream.
  const v = validateOcrSubmission(submission);
  if (!v.ok) {
    throw new IngestionError(`generated submission is not contract-valid: ${v.summary}`);
  }
  return v.value;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requireNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new IngestionError(`${name} is required`);
  }
}

const ULID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Default job_id generator. Produces a 26-char [0-9a-z] string that
 * satisfies the contract's relaxed ULID pattern. NOT a real ULID — real
 * production code should swap in a Crockford-base32 ULID library.
 */
function defaultJobIdGenerator(): string {
  let s = "";
  for (let i = 0; i < 26; i++) {
    s += ULID_ALPHABET[randomInt(0, ULID_ALPHABET.length)];
  }
  return s;
}
