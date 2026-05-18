// Subprocess runner for the PaddleOCR-ONNX harness.
//
// Spawned by src/harnesses/paddleocr-onnx.ts under `/usr/bin/time -l` so
// `peak_rss_bytes` measures THIS process, not the parent Node runtime.
//
// CLI:
//   node paddleocr-onnx-runner.mjs <image-path>
//
// Stdout: a single JSON line carrying the OCR transcript + timing split.
// Stderr: passes through @gutenye/ocr-node diagnostics + /usr/bin/time -l
//         output. The harness parses both.
//
// The subprocess deliberately uses `console.log` for the JSON line only,
// after `console.error`-redirecting the OCR library's own logging. This
// keeps stdout clean for parsing.

import { performance } from "node:perf_hooks";
import Ocr from "@gutenye/ocr-node";

const imagePath = process.argv[2];
if (!imagePath) {
  process.stderr.write("usage: paddleocr-onnx-runner.mjs <image-path>\n");
  process.exit(2);
}

// Redirect any library-side console.log to stderr so it doesn't pollute
// our JSON output line on stdout.
const realLog = console.log;
console.log = (...args) => process.stderr.write(args.join(" ") + "\n");

try {
  const coldStart = performance.now();
  const ocr = await Ocr.create();
  const cold_model_load_ms = Math.round(performance.now() - coldStart);

  const inferStart = performance.now();
  const lines = await ocr.detect(imagePath);
  const per_page_inference_ms = Math.round(performance.now() - inferStart);

  // Transcript projection: join line texts with newlines. Engine-specific
  // projection per ADR-11A.5 v0.1 — measurement-only, NOT the production
  // OcrResult mapper. The bakeoff CER comparison normalizes whitespace
  // and line breaks via the CER normative spec.
  const transcript = lines.map((l) => l.text).join("\n");

  // Restore console.log just before the JSON emission so the JSON line
  // goes to stdout.
  console.log = realLog;
  process.stdout.write(
    JSON.stringify({
      ok: true,
      transcript,
      lines: lines.map((l) => ({ text: l.text, mean: l.mean })),
      cold_model_load_ms,
      per_page_inference_ms,
    }) + "\n",
  );
} catch (err) {
  console.log = realLog;
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: (err instanceof Error ? err.message : String(err)),
      stack: (err instanceof Error ? err.stack : undefined),
    }) + "\n",
  );
  process.exit(1);
}
