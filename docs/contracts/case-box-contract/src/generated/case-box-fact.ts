/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * Statement-level fact derived from a document, an LLM, an OCR excerpt, an import, or authored by the lawyer. v1 invariants: all facts created in status=candidate; no auto-promote from candidate to accepted; supersedes_fact_id (on the NEW row) points to the old row it replaces (no row-level superseded state). See docs/adr/case-box-step-2-fact-promotion-and-provenance.md.
 */
export type CaseBoxFact = {
  [k: string]: unknown;
} & {
  id: Ulid;
  tenant_id: string;
  /**
   * Creator. v1 sentinel: "local-user".
   */
  actor_user_id: string;
  matter_id: Ulid;
  /**
   * The fact's prose. Lawyer-authored or extractor-generated.
   */
  statement_text: string;
  status: "candidate" | "reviewed" | "accepted" | "rejected";
  /**
   * Where the fact came from. Machine sources (llm_extraction, ocr_excerpt, imported) MUST be created as candidate and cannot be auto-accepted.
   */
  source_type: "lawyer_authored" | "llm_extraction" | "ocr_excerpt" | "imported";
  /**
   * CaseBoxDocument id. Required for ocr_excerpt; optional for other sources.
   */
  source_document_id: null | Ulid;
  /**
   * 1-based page number within the source document. Required for ocr_excerpt.
   */
  source_page_number: null | number;
  /**
   * The text the fact derives from. Required for ocr_excerpt.
   */
  source_excerpt: null | string;
  /**
   * Opaque READ-ONLY reference to ocr-persistence; case-box never FKs to OCR. Required for ocr_excerpt.
   */
  source_ocr_job_id: null | string;
  /**
   * Extractor identity for machine sources (e.g. "claude-opus-4-7", "clio-import-v1"). Required for llm_extraction and imported. MUST be null for lawyer_authored.
   */
  extractor_name: null | string;
  /**
   * Extractor version for reproducibility. MUST be null for lawyer_authored.
   */
  extractor_version: null | string;
  /**
   * Informational 0..1 confidence. MUST be null for lawyer_authored.
   */
  extraction_confidence: null | number;
  /**
   * Lawyer who reviewed. Set when status leaves candidate. MUST be null when status is candidate.
   */
  reviewer_actor_user_id: null | string;
  reviewed_at: null | string;
  /**
   * Set iff status === accepted.
   */
  accepted_at: null | string;
  /**
   * Set iff status === rejected.
   */
  rejected_at: null | string;
  /**
   * Free-form lawyer note. Required when status === rejected. MUST be null otherwise.
   */
  rejection_reason: null | string;
  /**
   * On a NEW accepted fact, points to the prior accepted fact it semantically replaces. MUST be null unless status === accepted. Self-cycle (id === supersedes_fact_id) caught by validator-helper, not schema.
   */
  supersedes_fact_id: null | Ulid;
  created_at: string;
  [k: string]: unknown;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ulid".
 */
export type Ulid = string;
