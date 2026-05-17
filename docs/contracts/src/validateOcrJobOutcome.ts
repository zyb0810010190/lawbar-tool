// Composed validator for OcrJobOutcome. See ADR-11A.5 v0.1.
//
// Layers, in order:
//   1. Envelope schema (ocr-job-outcome.schema.json), with resultSchema
//      pre-registered on the shared Ajv instance so the cross-$ref to
//      OcrResult resolves at compile time. The schema's cross-$ref also
//      covers per-element OcrResult validity for `results[]`, so a
//      dedicated per-result layer would be redundant and is not present.
//   2. Status transition sequence semantics via
//      validateOcrStatusTransitionSequence (illegal-edge / actor / etc.).
//      Returned error paths are remapped from `/transitions/N` to
//      `/statuses/N` so the machine-readable path tracks the outcome
//      envelope rather than the temporary sequence-payload shape.
//   3. terminal_state coherence: outcome.terminal_state === statuses[last].to.
//
// Job/submission binding (outcome.job_id === submission.job_id, per-result
// page binding) is NOT done here — that needs external job context and lives
// in services/ocr-worker/src/outcomeValidation.ts.

import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { resultSchema, outcomeSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import { validateOcrStatusTransitionSequence } from "./validateStatusTransition.js";
import type { OcrJobOutcome } from "./generated/ocr-job-outcome.js";

// Derive the result schema's $id from the schema itself rather than
// hard-coding it, so the validator and gen-types script cannot drift apart
// when the schema's $id changes.
const RESULT_SCHEMA_ID = (resultSchema as { $id: string }).$id;

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (compiled) return compiled;
  // Register resultSchema by $id so the outcome schema's cross-$ref resolves.
  // Safe to call regardless of whether validateOcrResult ran first — Ajv
  // returns the existing validator for an already-registered $id, so we
  // guard with getSchema to avoid duplicate-id errors.
  if (!ajv.getSchema(RESULT_SCHEMA_ID)) {
    ajv.addSchema(resultSchema as object);
  }
  compiled = ajv.compile(outcomeSchema as object);
  return compiled;
}

export function validateOcrJobOutcome(
  payload: unknown,
): ValidationResult<OcrJobOutcome> {
  // Layer 1: envelope schema. Cross-$ref also enforces per-result validity.
  const v = getValidator();
  const schemaOk = v(payload);
  if (!schemaOk) {
    const errors = (v.errors ?? []) as AjvErrorObject[];
    return { ok: false, summary: summarizeErrors(errors), errors };
  }
  const outcome = payload as OcrJobOutcome;

  // Layer 2: status transition sequence semantics.
  // Errors come back keyed under `/transitions/N` because the underlying
  // validator takes a `{ job_id, transitions }` payload. Remap to
  // `/statuses/N` so callers reading the path see the outcome envelope's
  // field name, not the sequence-validator's internal one.
  const seq = validateOcrStatusTransitionSequence({
    job_id: outcome.job_id,
    transitions: outcome.statuses,
  });
  if (!seq.ok) {
    return {
      ok: false,
      summary: `statuses: ${seq.summary}`,
      errors: seq.errors.map((e) => ({
        ...e,
        instancePath: e.instancePath.startsWith("/transitions")
          ? `/statuses${e.instancePath.slice("/transitions".length)}`
          : e.instancePath,
      })),
    };
  }

  // Layer 3: terminal coherence.
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
