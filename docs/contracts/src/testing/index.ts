// Subpath barrel — `import { processFakeOcrJob } from "ocr-worker-contract/testing"`.
//
// This entry point is intentionally kept out of the main package surface
// (`docs/contracts/src/index.ts`). The fake worker is for tests and integration
// scaffolding only; production code that imports `ocr-worker-contract` should
// never receive it as a side effect.

export {
  processFakeOcrJob,
  FakeWorkerError,
  type FakeScenario,
  type FakeWorkerOptions,
  type FakeJobOutcome,
} from "./fake-worker.js";

// Queue conformance harness (Step 10I-A relocation; see ADR
// `docs/adr/ocr-queue-boundary-amendment-step-10h-a.md`). Backend-agnostic;
// `InMemoryOcrQueue` and the future `SqliteOcrQueue` both prove identical
// behavior against this matrix.
export {
  runOcrQueueConformance,
  type RunOcrQueueConformanceOptions,
  type MakeImplOptions,
} from "./queue-conformance.js";
