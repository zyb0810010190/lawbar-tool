import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { ocrLinkSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import { OcrSubordinationError } from "./transitions.js";
import type { CaseBoxOcrLink } from "./generated/case-box-ocr-link.js";

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  return (compiled ??= ajv.compile(ocrLinkSchema as object));
}

export function validateOcrLink(payload: unknown): ValidationResult<CaseBoxOcrLink> {
  const v = getValidator();
  const ok = v(payload);
  if (ok) {
    return { ok: true, value: payload as CaseBoxOcrLink };
  }
  const errors = (v.errors ?? []) as AjvErrorObject[];
  return { ok: false, summary: summarizeErrors(errors), errors };
}

/**
 * Assert that a CaseBoxOcrLink-shaped object is read-only — OCR is a
 * subordinate data feed; case-box never writes to ocr-persistence.
 *
 * Throws OcrSubordinationError if the shape implies a write. The schema
 * already pins `direction === "read-only"`; this helper exists so persistence
 * / ingestion code can re-assert it at IPC and storage boundaries without
 * paying for full Ajv compilation per call.
 */
export function assertCaseBoxIsSubordinateToOcr(link: { direction?: unknown }): void {
  if (link.direction !== "read-only") {
    throw new OcrSubordinationError(
      `CaseBoxOcrLink.direction must be "read-only" (got ${JSON.stringify(link.direction)}). OCR is a subordinate data feed; case-box never writes to ocr-persistence.`,
    );
  }
}
