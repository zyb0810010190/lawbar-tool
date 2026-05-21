import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { confidentialityClassificationSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import type { CaseBoxConfidentialityClassification } from "./generated/case-box-confidentiality-classification.js";

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  return (compiled ??= ajv.compile(confidentialityClassificationSchema as object));
}

export function validateConfidentialityClassification(
  payload: unknown,
): ValidationResult<CaseBoxConfidentialityClassification> {
  const v = getValidator();
  const ok = v(payload);
  if (ok) {
    return { ok: true, value: payload as CaseBoxConfidentialityClassification };
  }
  const errors = (v.errors ?? []) as AjvErrorObject[];
  return { ok: false, summary: summarizeErrors(errors), errors };
}
