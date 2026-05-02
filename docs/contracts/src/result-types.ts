// Shared result and error types for validators.

import type { AjvErrorObject } from "./ajv-instance.js";

export interface ValidationOk<T> {
  ok: true;
  value: T;
}

export interface ValidationErr {
  ok: false;
  /** Short human-readable summary, e.g. "/priority must be <= 100; /pages must NOT have fewer than 1 items" */
  summary: string;
  /** Raw Ajv errors. Stable schema fields (instancePath, keyword, params, message). */
  errors: AjvErrorObject[];
}

export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

export function summarizeErrors(errors: AjvErrorObject[]): string {
  if (errors.length === 0) return "validation failed";
  return errors
    .map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`)
    .join("; ");
}
