// lawbar-ocr-pdfkit-layer — the PDF text layer, reached THROUGH the app's own helper (R3, WI-12).
//
// The cheapest tier in the plan's ladder: for a born-digital PDF, PDFKit's `page.string` IS the
// page's text, and no OCR should run at all. This candidate measures that claim against the same
// fixtures OCR is measured against, through the same boundary (lawbar-ocr-helper.ts). Two things
// it must say honestly:
//
// - A page with NO text layer is not a bad transcript; it is the signal that OCR must run. It is
//   reported as the failure `no_text_layer`, which the CER metric excludes, so the layer tier is
//   scored only on pages that have one. The escalation rule in the plan reads this code.
// - What the layer says can be stale, invisible, duplicated or in column order — a non-empty
//   `page.string` is not proof (plan risk "text-layer semantics"). That is what the different-
//   engine control is for; here the fixture's expected text plays the control.
//
// Timings and memory, stated plainly: the helper today ALWAYS renders the page and runs Vision,
// so this candidate's `latency_ms` and `peak_rss_bytes` include an OCR pass the layer tier would
// never pay in production. They are upper bounds, not the tier's cost. `per_page_inference_ms` is
// 0 because the helper does not time the layer read, and the overhead field is the wall clock
// minus render and Vision. A layer-only helper mode is the fix (a protocol change, its own item);
// until then this candidate's measurement is the TRANSCRIPT, and the numbers say what they are not.

import type { EngineCandidate, EngineObservation } from "../types.js";
import {
  extractVerifiedPage,
  HELPER_VERSION_PINNED,
  isVerifiedPage,
  probeCandidateCached,
  type LawbarOcrHelperOptions,
  type ProbeCache,
} from "./lawbar-ocr-helper.js";
import { LAWBAR_OCR_LICENSE } from "./lawbar-ocr-vision.js";

const ENGINE_NAME = "lawbar-ocr-pdfkit-layer";

export function makeLawbarOcrPdfkitLayerCandidate(
  fixturesRoot: string,
  options: LawbarOcrHelperOptions = {},
): EngineCandidate {
  const cache: ProbeCache = {};
  return {
    name: ENGINE_NAME,
    version_pinned: HELPER_VERSION_PINNED,
    license: LAWBAR_OCR_LICENSE,
    supported_run_kinds: ["cold"],
    // Only a PDF has a text layer. The runner never hands this candidate a PNG; the check inside
    // run() is the same rule enforced a second time, for a caller that is not the runner.
    supported_media: ["pdf"],
    probe: () => probeCandidateCached(options, cache),
    run: async (fixture, opts): Promise<EngineObservation> => {
      if (fixture.media !== "pdf") {
        return { outcome: "failure", fixture_id: fixture.id, engine_name: ENGINE_NAME, code: "unsupported_media", message: `the PDFKit text layer exists only for PDF fixtures; ${fixture.id} is ${String(fixture.media)}` };
      }
      const page = await extractVerifiedPage(ENGINE_NAME, fixture, opts, options, fixturesRoot, cache);
      if (!isVerifiedPage(page)) return page;
      const chars = page.record.layer_chars;
      const text = page.record.layer_text;
      if (typeof chars !== "number" || !Number.isFinite(chars) || chars < 0) {
        return { outcome: "failure", fixture_id: fixture.id, engine_name: ENGINE_NAME, code: "helper_output_unparseable", message: "page record has no layer_chars" };
      }
      // `no_text_layer` is reserved for what it names. A record that COUNTS characters but carries
      // no string, or an empty one, is malformed output — it must not masquerade as the
      // escalation signal. A whitespace-only layer (a blank page's newline) is no usable layer.
      if (chars > 0 && (typeof text !== "string" || text === "")) {
        return { outcome: "failure", fixture_id: fixture.id, engine_name: ENGINE_NAME, code: "helper_output_unparseable", message: `page record counts ${chars} layer characters but carries no layer_text` };
      }
      if (chars === 0 || typeof text !== "string" || text.trim() === "") {
        // The escalation signal, not an error: this page must be OCR'd.
        return { outcome: "failure", fixture_id: fixture.id, engine_name: ENGINE_NAME, code: "no_text_layer", message: "the PDF page carries no text layer; OCR must run for this page" };
      }
      return {
        outcome: "success",
        fixture_id: fixture.id,
        engine_name: ENGINE_NAME,
        engine_version: `${page.probed.helper_version}+sha256.${page.probed.digest.slice(0, 12)}`,
        transcript: text,
        latency_ms: page.latency_ms,
        peak_rss_bytes: page.peak_rss_bytes,
        cold_model_load_ms: Math.max(0, page.latency_ms - page.vision_ms - page.render_ms),
        per_page_inference_ms: 0,
        run_kind: "cold",
      };
    },
    dispose: async () => { cache.probed = undefined; /* one process per run; nothing outlives run() */ },
  };
}
