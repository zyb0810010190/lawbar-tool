// Public surface of the OCR queue adapter.

export { OcrJobAdapter, type OcrJobAdapterOptions } from "./adapter.js";
export {
  InMemoryOcrQueue,
  DEFAULT_LEASE_MS,
  type InMemoryOcrQueueOptions,
} from "./inMemoryQueue.js";
export {
  OcrAdapterError,
  OcrQueueError,
  type EnqueueResult,
  type OcrJob,
  type OcrJobQueueBackend,
  type OcrQueueClaim,
  type OcrQueueErrorCode,
  type OcrWorker,
  type ProcessResult,
} from "./types.js";
export {
  validateWorkerOutcomeContract,
  type OutcomeValidationResult,
} from "./outcomeValidation.js";
export {
  OcrProcessingCoordinator,
  processOneOcrQueueClaim,
  type OcrCoordinatorOutcome,
  type OcrCoordinatorResult,
  type OcrPersistencePort,
  type OcrProcessingCoordinatorOptions,
  type ProcessOneOcrQueueClaimOptions,
} from "./coordinator.js";
export {
  runOcrWorkerLoop,
  type OcrCoordinatorLike,
  type OcrWorkerLoopErrorEvent,
  type OcrWorkerLoopErrorPhase,
  type OcrWorkerLoopOptions,
  type OcrWorkerLoopSummary,
} from "./workerLoop.js";
