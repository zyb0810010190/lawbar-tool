import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { evidenceItemSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import type { CaseBoxEvidenceItem } from "./generated/case-box-evidence-item.js";

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  return (compiled ??= ajv.compile(evidenceItemSchema as object));
}

export function validateEvidenceItem(payload: unknown): ValidationResult<CaseBoxEvidenceItem> {
  const v = getValidator();
  const ok = v(payload);
  if (ok) {
    return { ok: true, value: payload as CaseBoxEvidenceItem };
  }
  const errors = (v.errors ?? []) as AjvErrorObject[];
  return { ok: false, summary: summarizeErrors(errors), errors };
}
