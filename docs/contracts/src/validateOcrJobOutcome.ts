// Composed validator for OcrJobOutcome. See ADR-11A.5 v0.1.
//
// Layers, in order:
//   1. Envelope schema (ocr-job-outcome.schema.json), with resultSchema
//      pre-registered on the shared Ajv instance so the cross-$ref to
//      OcrResult resolves at compile time.
//   2. Status transition sequence semantics via
//      validateOcrStatusTransitionSequence (illegal-edge / actor / etc.).
//   3. Per-result validation via validateOcrResult — each element of
//      `results` must independently satisfy the OcrResult contract.
//   4. terminal_state coherence: outcome.terminal_state === statuses[last].to.
//
// Job/submission binding (outcome.job_id === submission.job_id, per-result
// page binding) is NOT done here — that needs external job context and lives
// in services/ocr-worker/src/outcomeValidation.ts.

import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { resultSchema, outcomeSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import { validateOcrResult } from "./validateResult.js";
import { validateOcrStatusTransitionSequence } from "./validateStatusTransition.js";
import type { OcrJobOutcome } from "./generated/ocr-job-outcome.js";

const RESULT_SCHEMA_ID =
  "https://litigation-platform.local/contracts/ocr-result.schema.json";

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (compiled) return compiled;
  // Register resultSchema by $id so the outcome schema's cross-$ref resolves.
  // Safe to call regardless of whether validateOcrResult ran first — Ajv
  // throws on duplicate $id, so we guard.
  if (!ajv.getSchema(RESULT_SCHEMA_ID)) {
    ajv.addSchema(resultSchema as object);
  }
  compiled = ajv.compile(outcomeSchema as object);
  return compiled;
}

export function validateOcrJobOutcome(
  payload: unknown,
): ValidationResult<OcrJobOutcome> {
  // Layer 1: envelope schema.
  const v = getValidator();
  const schemaOk = v(payload);
  if (!schemaOk) {
    const errors = (v.errors ?? []) as AjvErrorObject[];
    return { ok: false, summary: summarizeErrors(errors), errors };
  }
  const outcome = payload as OcrJobOutcome;

  // Layer 2: status transition sequence semantics.
  const seq = validateOcrStatusTransitionSequence({
    job_id: outcome.job_id,
    transitions: outcome.statuses,
  });
  if (!seq.ok) {
    return {
      ok: false,
      summary: `statuses: ${seq.summary}`,
      errors: seq.errors,
    };
  }

  // Layer 3: per-result validity.
  for (let i = 0; i < outcome.results.length; i++) {
    const rv = validateOcrResult(outcome.results[i]);
    if (!rv.ok) {
      return {
        ok: false,
        summary: `results[${i}]: ${rv.summary}`,
        errors: rv.errors,
      };
    }
  }

  // Layer 4: terminal coherence.
  const lastTransition = outcome.statuses[outcome.statuses.length - 1];
  const lastTo = lastTransition?.to;
  if (outcome.terminal_state !== lastTo) {
    return {
      ok: false,
      summary: `terminal_state '${String(outcome.terminal_state)}' does not match final transition.to '${String(lastTo)}'`,
      errors: [
        {
          instancePath: "/terminal_state",
          schemaPath: "",
          keyword: "semanticCoherence",
          params: { final_to: lastTo, terminal_state: outcome.terminal_state },
          message: "terminal_state must equal statuses[last].to",
        },
      ],
    };
  }

  return { ok: true, value: outcome };
}
