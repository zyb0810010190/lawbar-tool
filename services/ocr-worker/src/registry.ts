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

/**
 * Real runtime type guard for the no-arg form of `load`. Audit
 * 019e3a2e D4: a shallow presence check + cast lets `{ engineVersion:
 * "" }` or `engine` without a callable `detect` through to the
 * adapter, where it eventually crashes deeper. We narrow up front
 * so the un-wired vs malformed-deps split is observable here.
 */
function isPaddleOcrOnnxAdapterDeps(value: unknown): value is PaddleOcrOnnxAdapterDeps {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.engineVersion !== "string" || v.engineVersion.length === 0) return false;
  if (v.fetcher === null || typeof v.fetcher !== "object") return false;
  const engine = v.engine;
  if (engine === null || typeof engine !== "object") return false;
  if (typeof (engine as { detect?: unknown }).detect !== "function") return false;
  return true;
}

async function loadPaddleOcrOnnxWorker(deps?: unknown): Promise<OcrWorker> {
  if (!isPaddleOcrOnnxAdapterDeps(deps)) {
    throw new Error(
      "WORKER_REGISTRY[\"paddleocr-onnx\"].load is not yet wired with " +
        "default deps; in 11C.3a callers must construct " +
        "PaddleOcrOnnxAdapterDeps (with non-empty engineVersion, object " +
        "fetcher, and callable engine.detect) and call " +
        "makePaddleOcrOnnxWorker directly. The no-arg factory ships in 11C.3b.",
    );
  }
  return makePaddleOcrOnnxWorker(deps);
}

/**
 * Deep-freeze the registry: Object.freeze stops top-level
 * re-assignment, but nested entries stay mutable without a recursive
 * pass (audit 019e3a2e D4). A misbehaving consumer could otherwise
 * swap `WORKER_REGISTRY.fake.load` for arbitrary code.
 */
function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const key of Object.keys(o as object)) {
      deepFreeze((o as Record<string, unknown>)[key]);
    }
  }
  return o;
}

/**
 * Frozen registry. Deep-frozen so neither the map itself nor its
 * entries can be mutated at runtime. Matches the defense pattern in
 * `INGESTION_ERROR_CODES` + `FETCHER_ERROR_CODES`.
 */
export const WORKER_REGISTRY: Readonly<Record<WorkerKey, WorkerEntry>>
  = deepFreeze({
    fake: { name: "fake" as const, load: loadFakeWorker },
    "paddleocr-onnx": {
      name: "paddleocr-onnx" as const,
      load: loadPaddleOcrOnnxWorker,
    },
  });
