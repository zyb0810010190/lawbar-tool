// Real @gutenye/ocr-node engine factory. See ADR-11C.3b.
//
// Pairs the engine instance with its version string in one returned
// object: `{ engine, version }`. The bin (11C.3c) wires this into
// `WORKER_REGISTRY["paddleocr-onnx"].load({ ... engine, engineVersion })`.
//
// Cold load runs INSIDE the factory (ADR-11C.3b §2): bin startup
// surfaces cold-load failure as exit 2 per ADR-11A.0 §10, rather
// than letting it leak mid-job through the queue's retry path.

// Note: `@gutenye/ocr-node` is imported lazily inside
// `makeRealPaddleEngine` via dynamic `import()`. Top-level import
// would load `onnxruntime-node` + `sharp` native binaries during
// module evaluation of this file, which adds hundreds of
// milliseconds to bin startup even for code paths that never use
// the real engine (every fake-worker test path). Pushing that cost
// behind the factory keeps the import side-effect-free until the
// caller actually wants the engine.

import type { EnginePort } from "./paddleocr-onnx.js";
import type { EngineLine } from "./mapper.js";

/**
 * Pinned `@gutenye/ocr-node` version. Must match
 * `services/ocr-worker/package.json#dependencies."@gutenye/ocr-node"`
 * (the resolved version, not the semver range).
 *
 * Why hardcoded: the package ships `exports` without a
 * `./package.json` entry, so neither static
 * `import pkg from "@gutenye/ocr-node/package.json"` nor
 * `createRequire("...").resolve("@gutenye/ocr-node/package.json")`
 * is portable. A drift test in
 * tests/engines.real-paddleocr-engine.test.mjs reads the installed
 * package's manifest from disk and asserts equality, so an upgrade
 * that forgets to bump this constant fails fast at test time.
 */
const ENGINE_PKG_VERSION = "1.4.8";

export interface MakeRealPaddleEngineOptions {
  /**
   * Optional override for model paths. v1 leaves this undefined to
   * use the bundled `@gutenye/ocr-models` defaults
   * (`ch_PP-OCRv4_det_infer.onnx` + `ch_PP-OCRv4_rec_infer.onnx` +
   * `ppocr_keys_v1.txt`). The bin in 11C.3c does NOT expose this
   * via env yet.
   */
  readonly models?: {
    readonly detectionPath: string;
    readonly recognitionPath: string;
    readonly dictionaryPath: string;
  };
}

export interface RealPaddleEngine {
  /** EnginePort-shaped wrapper around `Ocr.detect`. */
  readonly engine: EnginePort;
  /**
   * `<pkg-version>+<model-set>` per ADR-11A.5. With default options
   * this is `1.4.8+ch_PP-OCRv4` (model_set is hardcoded to that
   * string for the default path; overridden options surface as
   * `+custom` because the caller knows which model set they passed).
   */
  readonly version: string;
}

/**
 * Construct a real OCR engine. Cold load runs here — failure throws
 * out of this function so the bin surfaces it as exit 2 (config
 * fault).
 *
 * Subsequent `detect()` calls reuse the constructed engine session;
 * cold load is paid exactly once per process lifetime per ADR-11B §7.
 */
export async function makeRealPaddleEngine(
  options?: MakeRealPaddleEngineOptions,
): Promise<RealPaddleEngine> {
  // Lazy import — see top-of-file note. The dynamic specifier MUST
  // be a string literal (not a variable) so bundlers / static
  // analyzers can still detect the dep edge.
  const { default: Ocr } = await import("@gutenye/ocr-node");
  // `Ocr.create` is typed `Promise<any>` in the upstream d.ts. We
  // narrow the runtime to the structural interface we depend on.
  const created = await Ocr.create(
    options?.models ? { models: options.models } : undefined,
  );

  if (
    created === null ||
    typeof created !== "object" ||
    typeof (created as { detect?: unknown }).detect !== "function"
  ) {
    throw new Error(
      "Ocr.create did not return an object with a callable `detect`",
    );
  }
  const ocr = created as { detect: (image: string) => Promise<unknown> };

  const engine: EnginePort = {
    async detect(imagePath: string): Promise<ReadonlyArray<EngineLine>> {
      // The adapter's `sanitizeEngineLines` boundary will assert
      // the return shape (Array.isArray + per-line text). We pass
      // the raw return through here — re-checking would be
      // redundant.
      const result = await ocr.detect(imagePath);
      return result as ReadonlyArray<EngineLine>;
    },
  };

  return {
    engine,
    version: buildEngineVersion(options),
  };
}

/**
 * Exported so the drift test can read the same constant the factory
 * uses. Consumers of the engine factory should read
 * `RealPaddleEngine.version` instead.
 */
export const RAW_ENGINE_PKG_VERSION: string = ENGINE_PKG_VERSION;

function buildEngineVersion(
  options: MakeRealPaddleEngineOptions | undefined,
): string {
  const modelSet = options?.models ? "custom" : "ch_PP-OCRv4";
  return `${ENGINE_PKG_VERSION}+${modelSet}`;
}
