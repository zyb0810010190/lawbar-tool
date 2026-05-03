// Public surface of the OCR worker contract package.
//
// Importers (web app, worker, internal tooling) should depend on this entry
// point. The JSON Schemas under docs/contracts/schemas/ remain the source of
// truth; everything exported here is derived from them.

export { validateOcrSubmission } from "./validateSubmission.js";
export { validateOcrResult } from "./validateResult.js";
export {
  validateOcrStatusEnvelope,
  validateOcrStatusTransitionSequence,
  assertValidOcrStatusTransition,
  IllegalTransitionError,
  type OcrStatusEnvelope,
  type OcrStatusTransitionSequence,
} from "./validateStatusTransition.js";
export {
  classifyOcrFailureForRetry,
  validateRetryBehavior,
  type RetryDecision,
  type PartialFailure,
  type ResultEmitted,
  type RetryPolicy,
  type RetryRecord,
  type RetryRuleResult,
} from "./retryPolicy.js";

export {
  STATES,
  TERMINAL_STATES,
  isTerminalState,
  ALLOWED_EDGES,
  isAllowedTransition,
  validateTransitionSequence,
  type OcrJobState,
  type OcrJobActor,
  type AllowedEdge,
  type TransitionRecord,
  type TransitionSequenceResult,
} from "./transitions.js";

export { RetryPolicyError } from "./retryPolicy.js";
export { validateRetryCounters } from "./retry-rules.js";

// Queue transport types (Step 10I-A relocation; see ADR
// `docs/adr/ocr-queue-boundary-amendment-step-10h-a.md`). `ocr-worker-adapter`
// re-exports these for source compatibility; new consumers
// (`ocr-persistence`, future SqliteOcrQueue) should import from here.
export {
  OcrQueueError,
  type EnqueueResult,
  type OcrJob,
  type OcrJobQueueBackend,
  type OcrQueueClaim,
  type OcrQueueErrorCode,
} from "./queue.js";

export type {
  ValidationResult,
  ValidationOk,
  ValidationErr,
} from "./result-types.js";

export type { AjvErrorObject } from "./ajv-instance.js";

// Schema-derived data types.
export type { OcrSubmission } from "./generated/ocr-submission.js";
export type { OcrResult } from "./generated/ocr-result.js";
export type { OcrStatus } from "./generated/ocr-status.js";

// Re-export the schemas in case callers want to validate elsewhere
// (e.g., in a different runtime, with a different Ajv config). They are
// deep-frozen at the public boundary so a downstream consumer cannot weaken
// process-wide validation by mutating, e.g., `submissionSchema.properties
// .priority.maximum`. The internal validators in this package are still
// compiled from the live module-local schema objects, so freezing is a
// boundary concern only.
import {
  submissionSchema as rawSubmissionSchema,
  resultSchema as rawResultSchema,
  statusSchema as rawStatusSchema,
} from "./loadSchemas.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const k of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[k]);
    }
    Object.freeze(value);
  }
  return value;
}

export const submissionSchema = deepFreeze(structuredClone(rawSubmissionSchema));
export const resultSchema = deepFreeze(structuredClone(rawResultSchema));
export const statusSchema = deepFreeze(structuredClone(rawStatusSchema));
