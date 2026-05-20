import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { matterSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import type { CaseBoxMatter } from "./generated/case-box-matter.js";

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  return (compiled ??= ajv.compile(matterSchema as object));
}

export function validateMatter(payload: unknown): ValidationResult<CaseBoxMatter> {
  const v = getValidator();
  const ok = v(payload);
  if (ok) {
    return { ok: true, value: payload as CaseBoxMatter };
  }
  const errors = (v.errors ?? []) as AjvErrorObject[];
  return { ok: false, summary: summarizeErrors(errors), errors };
}
