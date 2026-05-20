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
  toCoordinatorEvent,
  formatCoordinatorEventJson,
  OCR_COORDINATOR_EVENT_SCHEMA_VERSION,
  type OcrCoordinatorEvent,
  type OcrCoordinatorEventSeverity,
  type OcrCoordinatorEmptyEvent,
  type OcrCoordinatorCompletedEvent,
  type OcrCoordinatorCompletedAlreadyTerminalEvent,
  type OcrCoordinatorRequeuedEvent,
  type OcrCoordinatorRetriedEvent,
  type OcrCoordinatorDeadLetteredEvent,
  type OcrCoordinatorPersistenceFailedEvent,
  type OcrCoordinatorAckFailedEvent,
  type OcrCoordinatorLeaseLostEvent,
  type ToCoordinatorEventOptions,
} from "./observability.js";
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
export {
  fetchPageBytes,
  FetcherError,
  FETCHER_ERROR_CODES,
  type FetcherErrorCode,
  type FetcherDeps,
  type FetchedPage,
  type HttpsTransport,
  type HttpsTransportResponse,
  type DnsAddress,
  type DnsLookupFn,
  makeNodeHttpsRequestTransport,
  makeNodeFetchHttpsTransport,
  makePinnedLookup,
  type MakeNodeHttpsRequestTransportOptions,
} from "./fetcher/index.js";
export {
  WORKER_REGISTRY,
  type WorkerKey,
  type WorkerEntry,
} from "./registry.js";
export {
  processPaddleOcrOnnxJob,
  makePaddleOcrOnnxWorker,
  ENGINE_FAILED_CODE,
  classifyFetcherError,
  type EnginePort,
  type PaddleOcrOnnxAdapterDeps,
} from "./engines/paddleocr-onnx.js";
export {
  makeRealPaddleEngine,
  buildEngineVersion,
  RAW_ENGINE_PKG_VERSION,
  RAW_MODELS_PKG_VERSION,
  RAW_DEFAULT_MODEL_SET,
  type RealPaddleEngine,
} from "./engines/real-paddleocr-engine.js";
