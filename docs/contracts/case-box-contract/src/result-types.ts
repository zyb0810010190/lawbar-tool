// Shared result and error types for validators. Modeled on
// ../../src/result-types.ts.

import type { AjvErrorObject } from "./ajv-instance.js";

export interface ValidationOk<T> {
  ok: true;
  value: T;
}

export interface ValidationErr {
  ok: false;
  summary: string;
  errors: AjvErrorObject[];
}

export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

export function summarizeErrors(errors: AjvErrorObject[]): string {
  if (errors.length === 0) return "validation failed";
  return errors
    .map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`)
    .join("; ");
}
