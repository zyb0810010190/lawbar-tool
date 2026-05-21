// Row ↔ record mappers for ocr_jobs. Extracted from SqliteOcrPersistence
// (LOC-01) so the list handlers, the single-job read, and the atomic-ingest
// seam can share one mapping path without re-declaring the row shape.
//
// Pure; no driver or transaction coupling — callers pass already-fetched
// rows or already-validated submissions.

import type { OcrSubmission } from "ocr-worker-contract";

import type { OcrJobRecord } from "../types.js";

/**
 * Row shape returned by `SELECT * FROM ocr_jobs`. Kept in sync with
 * `schema.ts`. Exported so list-handler modules can type their JOIN result
 * sets without re-declaring the columns.
 */
export interface OcrJobRow {
  job_id: string;
  tenant_id: string;
  case_id: string | null;
  document_id: string;
  document_revision: number | null;
  submitted_by: string;
  created_at: string;
  terminal_state: string | null;
  submission_json: string;
  metadata_json: string | null;
  /** ADR-11G outbox column; NULL means no pending retry. */
  pending_retry_submission_json: string | null;
}

/**
 * Materialize an `OcrJobRecord` from a fetched `ocr_jobs` row. Parses the
 * submission JSON and lifts nullable columns into optional record fields.
 */
export function rowToJobRecord(row: OcrJobRow): OcrJobRecord {
  const submission = JSON.parse(row.submission_json) as OcrSubmission;
  const record: OcrJobRecord = {
    job_id: row.job_id,
    tenant_id: row.tenant_id,
    document_id: row.document_id,
    submission,
    created_at: row.created_at,
  };
  if (row.case_id !== null) record.case_id = row.case_id;
  if (row.document_revision !== null) {
    record.document_revision = row.document_revision;
  }
  if (row.terminal_state !== null) {
    // The DB column is unconstrained TEXT; the contract OcrJobState union is
    // narrower. The terminal_state cache only ever receives values that
    // appendOcrStatus has validated against the contract, so this cast is safe.
    record.terminal_state = row.terminal_state as OcrJobRecord["terminal_state"];
  }
  if (row.pending_retry_submission_json !== null) {
    record.pending_retry_submission = JSON.parse(
      row.pending_retry_submission_json,
    ) as OcrSubmission;
  }
  return record;
}

/**
 * Build a fresh `OcrJobRecord` from an already-validated submission (the
 * caller has just inserted the ocr_jobs row). Used by the createOcrJob and
 * enqueueNewOcrJob paths so they do not need to re-read the row they just
 * wrote.
 */
export function buildJobRecordFromSubmission(
  sub: OcrSubmission & {
    case_id?: string;
    document_revision?: number;
  },
  createdAt: string,
  terminalState: OcrJobRecord["terminal_state"] | null,
): OcrJobRecord {
  const record: OcrJobRecord = {
    job_id: sub.job_id,
    tenant_id: sub.tenant_id,
    document_id: sub.document_id,
    submission: sub,
    created_at: createdAt,
  };
  if (sub.case_id !== undefined) record.case_id = sub.case_id;
  if (sub.document_revision !== undefined) {
    record.document_revision = sub.document_revision;
  }
  if (terminalState !== null && terminalState !== undefined) {
    record.terminal_state = terminalState;
  }
  return record;
}
