import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { crossExaminationOpinionSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import type { CaseBoxCrossExaminationOpinion } from "./generated/case-box-cross-examination-opinion.js";

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  return (compiled ??= ajv.compile(crossExaminationOpinionSchema as object));
}

export function validateCrossExaminationOpinion(
  payload: unknown,
): ValidationResult<CaseBoxCrossExaminationOpinion> {
  const v = getValidator();
  const ok = v(payload);
  if (ok) {
    return { ok: true, value: payload as CaseBoxCrossExaminationOpinion };
  }
  const errors = (v.errors ?? []) as AjvErrorObject[];
  return { ok: false, summary: summarizeErrors(errors), errors };
}
