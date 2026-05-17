// Pure validator for a worker outcome bound to a specific job.
//
// Extracted so both the compatibility adapter (`OcrJobAdapter`) and the
// Step 10C processing coordinator can apply the same contract + binding
// rules without duplicating logic. Returns a `Result`-shaped value rather
// than throwing — each caller maps the failure to its own error model
// (the adapter throws `OcrAdapterError`; the coordinator returns a
// `requeued` outcome).
//
// Scope:
//   - status sequence schema + chain validity (via the contract validator);
//   - terminal_state coherence with the last transition;
//   - outcome.job_id matches submission.job_id;
//   - every result is contract-valid AND linked to the submitted job
//     (job_id, tenant_id, document_id, page_id/page_number, document_revision).
//
// What this DOES NOT do:
//   - Step 10C-specific normalization (leading queued→claimed strip,
//     queue/web_app-edge rejection, single-attempt admission). That lives
//     in the coordinator because the adapter has different semantics.

import {
  validateOcrResult,
  validateOcrStatusTransitionSequence,
  type OcrJobOutcome,
} from "ocr-worker-contract";

import type { OcrJob } from "./types.js";

export type OutcomeValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateWorkerOutcomeContract(
  outcome: OcrJobOutcome,
  job: OcrJob,
): OutcomeValidationResult {
  const sub = job.submission as {
    job_id: string;
    tenant_id: string;
    document_id: string;
    document_revision?: number;
    pages: ReadonlyArray<{ page_id: string; page_number: number }>;
  };

  const seq = validateOcrStatusTransitionSequence({
    job_id: outcome.job_id,
    transitions: outcome.statuses,
  });
  if (!seq.ok) {
    return { ok: false, reason: `worker returned invalid status sequence: ${seq.summary}` };
  }

  const lastTo = outcome.statuses[outcome.statuses.length - 1]?.to;
  if (lastTo === undefined) {
    return { ok: false, reason: "worker returned an empty status sequence" };
  }
  if (outcome.terminal_state !== lastTo) {
    return {
      ok: false,
      reason: `outcome.terminal_state '${outcome.terminal_state}' does not match final transition.to '${lastTo}'`,
    };
  }

  if (outcome.job_id !== sub.job_id) {
    return {
      ok: false,
      reason: `outcome.job_id ${outcome.job_id} does not match submission.job_id ${sub.job_id}`,
    };
  }

  const pageByIdNumber = new Map<string, number>();
  for (const p of sub.pages) pageByIdNumber.set(p.page_id, p.page_number);

  for (const r of outcome.results) {
    const v = validateOcrResult(r);
    if (!v.ok) {
      return { ok: false, reason: `worker returned invalid result: ${v.summary}` };
    }
    if (r.job_id !== sub.job_id) {
      return {
        ok: false,
        reason: `result.job_id ${r.job_id} does not match submission.job_id ${sub.job_id}`,
      };
    }
    if (r.tenant_id !== sub.tenant_id) {
      return {
        ok: false,
        reason: `result.tenant_id ${r.tenant_id} does not match submission.tenant_id ${sub.tenant_id}`,
      };
    }
    if (r.document_id !== sub.document_id) {
      return {
        ok: false,
        reason: `result.document_id ${r.document_id} does not match submission.document_id ${sub.document_id}`,
      };
    }
    const expectedPageNumber = pageByIdNumber.get(r.page_id);
    if (expectedPageNumber === undefined) {
      return {
        ok: false,
        reason: `result.page_id ${r.page_id} is not present in submission.pages`,
      };
    }
    if (r.page_number !== expectedPageNumber) {
      return {
        ok: false,
        reason: `result.page_number ${r.page_number} does not match submitted page_number ${expectedPageNumber} for page_id ${r.page_id}`,
      };
    }
    if (sub.document_revision !== undefined) {
      const rRev = (r as { document_revision?: number }).document_revision;
      if (rRev !== sub.document_revision) {
        return {
          ok: false,
          reason: `result.document_revision ${rRev} does not match submission.document_revision ${sub.document_revision}`,
        };
      }
    }
  }

  return { ok: true };
}
