// lawbar-ocr-vision — Apple Vision, reached THROUGH the app's own helper boundary (R3, WI-12 step 3).
//
// See lawbar-ocr-helper.ts for the boundary (resolution, pin, deadline, identity). This candidate
// is the OCR tier: the helper renders the page (a PNG as is, a PDF page at 150 dpi) and Vision
// recognises the render. `vision_text` — lines joined in Vision's reading order — is the
// measurement-only transcript; `vision_ms` the per-page inference. What remains of the wall clock
// after render and inference is process start, framework initialisation, `time`, and pipe
// teardown — reported under the contract's `cold_model_load_ms` name, which for this candidate
// means "overhead per page", not a measured model load. Only `cold` runs are honest for a
// per-invocation CLI.

import type { EngineCandidate, EngineObservation, LicenseEvidence } from "../types.js";
import {
  extractVerifiedPage,
  HELPER_VERSION_PINNED,
  isVerifiedPage,
  probeCandidateCached,
  type LawbarOcrHelperOptions,
  type ProbeCache,
} from "./lawbar-ocr-helper.js";

export {
  parseMaxRssBytesFromTimeL,
  readDesktopPin,
  resolveHelperLocation,
  resolveVisionLang,
  sha256OfFile,
  type HelperLocation,
} from "./lawbar-ocr-helper.js";
export type LawbarOcrVisionHarnessOptions = LawbarOcrHelperOptions;

const ENGINE_NAME = "lawbar-ocr-vision";

export const LAWBAR_OCR_LICENSE: LicenseEvidence = {
  // The helper is this repository's code; Vision and PDFKit are macOS system frameworks linked at
  // run time under the macOS software licence. Nothing of Apple's is redistributed: no model, no
  // framework, no weights. What ships is a 550 KB executable that calls what every Mac already has.
  code_license: "repository licence (helper) + Apple macOS SLA (Vision.framework, PDFKit.framework — system, not redistributed)",
  model_license: null,
  redistribution: "permitted",
  code_evidence_url: "https://developer.apple.com/documentation/vision/vnrecognizetextrequest",
  model_evidence_url: null,
  last_verified_at: "2026-09-10",
  notes: "Recognition models are part of macOS (offline, on-device). The bake-off records the OS build with every probe because the model changes with the OS, not with this repository.",
};

export function makeLawbarOcrVisionCandidate(
  fixturesRoot: string,
  options: LawbarOcrHelperOptions = {},
): EngineCandidate {
  const cache: ProbeCache = {};
  return {
    name: ENGINE_NAME,
    version_pinned: HELPER_VERSION_PINNED,
    license: LAWBAR_OCR_LICENSE,
    supported_run_kinds: ["cold"],
    // A PNG is recognised as is; a PDF page is rendered by PDFKit first. Both are one page.
    supported_media: ["png", "pdf"],
    probe: () => probeCandidateCached(options, cache),
    run: async (fixture, opts): Promise<EngineObservation> => {
      const page = await extractVerifiedPage(ENGINE_NAME, fixture, opts, options, fixturesRoot, cache);
      if (!isVerifiedPage(page)) return page;
      const text = page.record.vision_text;
      if (typeof text !== "string") {
        return { outcome: "failure", fixture_id: fixture.id, engine_name: ENGINE_NAME, code: "helper_output_unparseable", message: "page record has no vision_text" };
      }
      return {
        outcome: "success",
        fixture_id: fixture.id,
        engine_name: ENGINE_NAME,
        engine_version: `${page.probed.helper_version}+sha256.${page.probed.digest.slice(0, 12)}`,
        transcript: text,
        latency_ms: page.latency_ms,
        peak_rss_bytes: page.peak_rss_bytes,
        cold_model_load_ms: Math.max(0, page.latency_ms - (page.vision_ms ?? 0) - (page.render_ms ?? 0)),
        per_page_inference_ms: page.vision_ms ?? 0,
        run_kind: "cold",
      };
    },
    dispose: async () => { cache.probed = undefined; /* one process per run; nothing outlives run() */ },
  };
}
