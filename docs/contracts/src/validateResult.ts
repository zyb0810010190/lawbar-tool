import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { resultSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import type { OcrResult } from "./generated/ocr-result.js";

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  return (compiled ??= ajv.compile(resultSchema as object));
}

/**
 * Validate a candidate OCR result envelope against the contract schema.
 * Returns a typed result: ok=true narrows the value to OcrResult.
 */
export function validateOcrResult(
  payload: unknown,
): ValidationResult<OcrResult> {
  const v = getValidator();
  const ok = v(payload);
  if (ok) {
    return { ok: true, value: payload as OcrResult };
  }
  const errors = (v.errors ?? []) as AjvErrorObject[];
  return { ok: false, summary: summarizeErrors(errors), errors };
}
