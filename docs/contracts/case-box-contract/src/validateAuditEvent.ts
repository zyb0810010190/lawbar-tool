import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { auditEventSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import type { CaseBoxAuditEvent } from "./generated/case-box-audit-event.js";

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  return (compiled ??= ajv.compile(auditEventSchema as object));
}

export function validateAuditEvent(payload: unknown): ValidationResult<CaseBoxAuditEvent> {
  const v = getValidator();
  const ok = v(payload);
  if (ok) {
    return { ok: true, value: payload as CaseBoxAuditEvent };
  }
  const errors = (v.errors ?? []) as AjvErrorObject[];
  return { ok: false, summary: summarizeErrors(errors), errors };
}
