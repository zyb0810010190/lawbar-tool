import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { submissionSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import type { OcrSubmission } from "./generated/ocr-submission.js";

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  return (compiled ??= ajv.compile(submissionSchema as object));
}

/**
 * Validate a candidate OCR submission payload against the contract schema.
 * Returns a typed result: ok=true narrows the value to OcrSubmission.
 */
export function validateOcrSubmission(
  payload: unknown,
): ValidationResult<OcrSubmission> {
  const v = getValidator();
  const ok = v(payload);
  if (ok) {
    return { ok: true, value: payload as OcrSubmission };
  }
  const errors = (v.errors ?? []) as AjvErrorObject[];
  return { ok: false, summary: summarizeErrors(errors), errors };
}
