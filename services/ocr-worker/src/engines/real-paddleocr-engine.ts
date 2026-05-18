// Real @gutenye/ocr-node engine factory. See ADR-11C.3b + audit
// 019e3a4c fix-up for every guard pinned here.
//
// Pairs the engine instance with its provenance string in one returned
// object: `{ engine, version }`. The bin (11C.3c) wires this into
// `WORKER_REGISTRY["paddleocr-onnx"].load({ ... engine, engineVersion })`.

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
 * RESOLVED VERSION (not the semver range), and the version installed
 * in `node_modules/@gutenye/ocr-node/package.json`.
 *
 * Why hardcoded: the package ships `exports` without a
 * `./package.json` entry, so neither static
 * `import pkg from "@gutenye/ocr-node/package.json"` nor
 * `createRequire(...).resolve("@gutenye/ocr-node/package.json")` is
 * portable. A drift test in
 * tests/engines.real-paddleocr-engine.test.mjs reads the installed
 * package's manifest from disk and asserts equality.
 */
const ENGINE_PKG_VERSION = "1.4.8";

/**
 * Pinned `@gutenye/ocr-models` version. The transitive dep that ships
 * the bundled ONNX model files (default `ch_PP-OCRv4` detection +
 * recognition + dictionary). The model bytes are what actually drive
 * the OCR result — recording only the wrapper version (which doesn't
 * change when a model is swapped under it) means two runs with
 * different inference outputs could report identical `engine.version`
 * strings. Audit 019e3a4c D8 High: include this in the provenance.
 *
 * Drift-tested alongside ENGINE_PKG_VERSION.
 */
const MODELS_PKG_VERSION = "1.4.2";

/**
 * Default model set identifier. Matches what `@gutenye/ocr-models`
 * ships as defaults at `MODELS_PKG_VERSION`. If the upstream
 * `@gutenye/ocr-models` ever ships a different default set under the
 * same package name (e.g., `ch_PP-OCRv5`), bump MODELS_PKG_VERSION
 * AND this label together.
 */
const DEFAULT_MODEL_SET = "ch_PP-OCRv4";

export interface RealPaddleEngine {
  /** EnginePort-shaped wrapper around `Ocr.detect`. */
  readonly engine: EnginePort;
  /**
   * `<engine-pkg>+<model-set>@<models-pkg>` per ADR-11A.5
   * `engine.version` rule, extended in 11C.3b audit fix to include
   * the model-package version so the string identifies the actual
   * bytes that ran.
   *
   * For the v1 default deployment: `1.4.8+ch_PP-OCRv4@1.4.2`.
   */
  readonly version: string;
}

/**
 * Construct a real OCR engine. Cold load runs here — failure throws
 * out of this function so the bin surfaces it as exit 2 (config
 * fault) per ADR-11A.0 §10.
 *
 * The bin (11C.3c) is expected to call this EXACTLY ONCE per
 * process lifetime per ADR-11B §7. The factory itself does not
 * memoize — module-level state would complicate testing and the
 * single-call contract is the bin's responsibility, not the
 * factory's.
 *
 * No options for v1 (audit 019e3a4c D2 fix): model-path overrides
 * are kept off the public API until a trusted-config use case
 * exists. When added, overrides MUST flow through an allowlist +
 * digest check, not raw paths.
 */
export async function makeRealPaddleEngine(): Promise<RealPaddleEngine> {
  // Lazy import — see top-of-file note. The dynamic specifier MUST
  // be a string literal (not a variable) so bundlers / static
  // analyzers can still detect the dep edge.
  const { default: Ocr } = await import("@gutenye/ocr-node");

  // `Ocr.create` is typed `Promise<any>` in the upstream d.ts. We
  // narrow the runtime to the structural interface we depend on.
  const created = await Ocr.create();

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
      const raw = await ocr.detect(imagePath);
      // Factory boundary validation (audit 019e3a4c D4): the public
      // EnginePort type promises ReadonlyArray<EngineLine>, but the
      // upstream return is `unknown`. We assert the OUTER shape
      // here so direct consumers of the factory (not just the
      // adapter) get the type-level guarantee. The adapter's
      // `sanitizeEngineLines` re-checks; that is intentional
      // defense-in-depth — both seams enforce the same invariant.
      if (!Array.isArray(raw)) {
        throw new TypeError(
          `Ocr.detect returned a non-array value (typeof=${typeof raw})`,
        );
      }
      for (let i = 0; i < raw.length; i++) {
        const line = raw[i];
        if (line === null || typeof line !== "object") {
          throw new TypeError(`Ocr.detect line[${i}] is not an object`);
        }
        if (typeof (line as { text?: unknown }).text !== "string") {
          throw new TypeError(`Ocr.detect line[${i}].text is not a string`);
        }
      }
      return raw as ReadonlyArray<EngineLine>;
    },
  };

  return {
    engine,
    version: buildEngineVersion(),
  };
}

/**
 * Exposed so the drift test can read the same constants the factory
 * uses. Consumers should read `RealPaddleEngine.version` instead.
 */
export const RAW_ENGINE_PKG_VERSION: string = ENGINE_PKG_VERSION;
export const RAW_MODELS_PKG_VERSION: string = MODELS_PKG_VERSION;
export const RAW_DEFAULT_MODEL_SET: string = DEFAULT_MODEL_SET;

/**
 * Pure version-string assembly. Exported so the always-on
 * format/value tests can verify it without paying the cold-load
 * cost.
 */
export function buildEngineVersion(): string {
  return `${ENGINE_PKG_VERSION}+${DEFAULT_MODEL_SET}@${MODELS_PKG_VERSION}`;
}
