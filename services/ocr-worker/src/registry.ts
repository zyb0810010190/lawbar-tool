// WORKER_REGISTRY — typed static map of worker keys to load factories.
// See ADR-11B §1 (shape decision) + ADR-11C.3a (this commit, code lands).
//
// Used by the bin (11C.3c) to route `OCR_WORKER=<key>` env values to
// the right worker factory. The key set is a closed discriminated
// union; the bin parses caller input against this exact set and fails
// closed on unknown values, never reaching `load()` with a
// caller-supplied string.

import { processFakeOcrJob } from "ocr-worker-contract/testing";

import type { OcrJob, OcrWorker } from "./types.js";
import {
  makePaddleOcrOnnxWorker,
  type PaddleOcrOnnxAdapterDeps,
} from "./engines/paddleocr-onnx.js";

/**
 * Closed set of admitted worker keys for v1.
 *
 * - `fake`: the contract package's in-process deterministic fake. Used
 *   by tests + integration harnesses.
 * - `paddleocr-onnx`: the production engine adapter (real
 *   `@gutenye/ocr-node` wiring lands in 11C.3b; 11C.3a defines the
 *   adapter shape with an injected EnginePort).
 */
export type WorkerKey = "fake" | "paddleocr-onnx";

export interface WorkerEntry {
  readonly name: WorkerKey;
  /**
   * Async factory. The bin awaits this before entering the job loop.
   *
   * - `fake` ignores its argument and returns the deterministic fake.
   * - `paddleocr-onnx` requires `PaddleOcrOnnxAdapterDeps` (fetcher
   *   deps, EnginePort, version). 11C.3a leaves the no-arg form a
   *   thrown error so the un-wired state is observable; 11C.3b lands
   *   the no-arg factory that constructs the real engine.
   */
  readonly load: (deps?: unknown) => Promise<OcrWorker>;
}

async function loadFakeWorker(): Promise<OcrWorker> {
  return {
    async process(job: OcrJob) {
      return processFakeOcrJob(job.submission, {
        scenario: job.scenario ?? "success",
      });
    },
  };
}

async function loadPaddleOcrOnnxWorker(deps?: unknown): Promise<OcrWorker> {
  if (
    deps === undefined ||
    deps === null ||
    typeof deps !== "object" ||
    !("fetcher" in deps) ||
    !("engine" in deps) ||
    !("engineVersion" in deps)
  ) {
    throw new Error(
      "WORKER_REGISTRY[\"paddleocr-onnx\"].load is not yet wired with " +
        "default deps; in 11C.3a callers must construct " +
        "PaddleOcrOnnxAdapterDeps and call makePaddleOcrOnnxWorker " +
        "directly. The no-arg factory ships in 11C.3b.",
    );
  }
  return makePaddleOcrOnnxWorker(deps as PaddleOcrOnnxAdapterDeps);
}

/**
 * Frozen registry. Runtime-frozen (not just `as const`) so a
 * misbehaving consumer cannot mutate the public-surface entries.
 * Same defense as `INGESTION_ERROR_CODES` + `FETCHER_ERROR_CODES`.
 */
export const WORKER_REGISTRY: Readonly<Record<WorkerKey, WorkerEntry>>
  = Object.freeze({
    fake: { name: "fake", load: loadFakeWorker },
    "paddleocr-onnx": {
      name: "paddleocr-onnx",
      load: loadPaddleOcrOnnxWorker,
    },
  });
