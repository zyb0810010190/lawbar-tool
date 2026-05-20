import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { deadlineSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import type { CaseBoxDeadline } from "./generated/case-box-deadline.js";

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  return (compiled ??= ajv.compile(deadlineSchema as object));
}

export function validateDeadline(payload: unknown): ValidationResult<CaseBoxDeadline> {
  const v = getValidator();
  const ok = v(payload);
  if (ok) {
    return { ok: true, value: payload as CaseBoxDeadline };
  }
  const errors = (v.errors ?? []) as AjvErrorObject[];
  return { ok: false, summary: summarizeErrors(errors), errors };
}
