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
// Canonical adapter-side import path for the production outcome type
// (per ADR-11A.5 §"Consequences"). Adapter consumers should not need to
// reach into ocr-worker-contract directly.
export type { OcrJobOutcome } from "ocr-worker-contract";
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
export {
  parseOcrWorkerConfig,
  OcrWorkerConfigError,
  type OcrWorkerConfig,
  type OcrWorkerPersistenceKind,
  type ParseOcrWorkerConfigInput,
} from "./config.js";
export {
  installShutdownHandlers,
  type InstallShutdownHandlersOptions,
  type InstalledShutdownHandlers,
  type SignalSource,
  type SupportedSignal,
} from "./processSignals.js";
export {
  runOcrWorkerProcess,
  type OcrWorkerProcessDeps,
  type OcrWorkerProcessDepsBuilder,
  type OcrWorkerProcessLike,
  type RunOcrWorkerProcessOptions,
} from "./cli.js";
