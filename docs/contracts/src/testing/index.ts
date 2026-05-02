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
