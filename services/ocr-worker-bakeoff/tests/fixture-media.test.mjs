// The PDF fixture kind and the PDFKit text-layer candidate (R3, WI-12).
//
// Three claims, each provoked: (1) the manifest defaults media to png, refuses an unknown media,
// and refuses a media that disagrees with the file extension; (2) the runner never hands a
// candidate a fixture whose media it did not declare — the failure is structured and excluded
// from CER; (3) the text-layer candidate calls `layer_text` the transcript, reports a page with no
// layer as `no_text_layer` (the escalation signal, not a bad transcript), and refuses a PNG.
// OPT-IN (`OCR_REAL_LAWBAR_OCR_TESTS=1`): the real packaged helper reads the authored text-layer
// PDFs back exactly, reports the scanned PDFs as no_text_layer, and Vision reads the scans.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { loadManifest, ManifestValidationError } from "../dist/manifest.js";
import { runBakeoff } from "../dist/runner.js";
import { makeLawbarOcrPdfkitLayerCandidate } from "../dist/harnesses/lawbar-ocr-pdfkit-layer.js";
import { makeLawbarOcrVisionCandidate, sha256OfFile } from "../dist/harnesses/lawbar-ocr-vision.js";
import { normalizeForCer } from "../dist/accuracy.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const fixturesRoot = join(pkgRoot, "fixtures");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const REAL_ENV_KEY = "OCR_REAL_LAWBAR_OCR_TESTS";
const realTestsRequested = process.env[REAL_ENV_KEY] === "1";

// ---------------------------------------------------------------------------
// A manifest in a temp root, one fixture, configurable
// ---------------------------------------------------------------------------

function manifestWith(fixtureOverrides = {}, { file = "page.png", bytes = Buffer.from("png-bytes") } = {}) {
  const root = mkdtempSync(join(tmpdir(), "bakeoff-media-"));
  mkdirSync(join(root, "synthetic"));
  writeFileSync(join(root, "synthetic", file), bytes);
  writeFileSync(join(root, "synthetic", "page.txt"), "文本");
  const fixture = {
    active: true, id: "page", role: "verdict", kind: "synthetic", category: "test",
    path: `synthetic/${file}`, expected_text_path: "synthetic/page.txt",
    sha256: sha256(bytes), expected_text_sha256: sha256(Buffer.from("文本")),
    language: "zh-Hans", provenance: "test", last_verified_at: "2026-09-10T00:00:00Z",
    render: { render_command: "none", font: "none", point_size: 1, canvas: "1x1", source_text: "文本" },
    ...fixtureOverrides,
  };
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ version: 1, fixtures: [fixture] }));
  return root;
}

test("manifest: media defaults to png; pdf is accepted with a .pdf path; an unknown media is refused", () => {
  assert.equal(loadManifest(manifestWith()).fixtures[0].media, "png");
  assert.equal(loadManifest(manifestWith({ media: "pdf" }, { file: "page.pdf" })).fixtures[0].media, "pdf");
  assert.throws(() => loadManifest(manifestWith({ media: "tiff" }, { file: "page.tiff" })), (e) => e instanceof ManifestValidationError && /media/.test(e.message));
});

test("manifest: a media that disagrees with the file extension is refused — a .pdf declared png would reach image-only engines", () => {
  assert.throws(() => loadManifest(manifestWith({}, { file: "page.pdf" })), /media is "png" but path .* is a \.pdf/);
  assert.throws(() => loadManifest(manifestWith({ media: "pdf" })), /media is "pdf" but path .* is a \.png/);
  assert.throws(() => loadManifest(manifestWith({}, { file: "page.tif" })), /neither a \.png nor a \.pdf/);
});

test("manifest: the committed manifest carries ten PDF fixtures, five text-layer and five scanned, each reusing its PNG sibling's expected text", () => {
  const m = loadManifest(fixturesRoot);
  const pdfs = m.fixtures.filter((f) => f.active && f.media === "pdf");
  assert.equal(pdfs.length, 10);
  assert.equal(pdfs.filter((f) => f.id.endsWith("-pdf-layer")).length, 5);
  assert.equal(pdfs.filter((f) => f.id.endsWith("-pdf-scan")).length, 5);
  for (const f of pdfs) {
    const sibling = m.fixtures.find((s) => s.id === f.id.replace(/-pdf-(layer|scan)$/, ""));
    assert.ok(sibling, `PNG sibling of ${f.id}`);
    assert.equal(f.expected_text_path, sibling.expected_text_path);
    assert.equal(f.expected_text_sha256, sibling.expected_text_sha256);
    assert.equal(sha256(readFileSync(join(fixturesRoot, f.path))), f.sha256, `${f.id} bytes must match the manifest`);
  }
});

// ---------------------------------------------------------------------------
// Runner media gate
// ---------------------------------------------------------------------------

function stubCandidate(name, supported_media, onRun) {
  return {
    name, version_pinned: "0", supported_run_kinds: ["cold"],
    license: { code_license: "x", model_license: null, redistribution: "permitted", code_evidence_url: "x", model_evidence_url: null, last_verified_at: "x" },
    ...(supported_media === undefined ? {} : { supported_media }),
    probe: async () => ({ status: "available", resolved_version: "0" }),
    run: async (fx) => { onRun?.(fx); return { outcome: "success", fixture_id: fx.id, engine_name: name, engine_version: "0", transcript: "文本", latency_ms: 1, peak_rss_bytes: 1, cold_model_load_ms: 0, per_page_inference_ms: 1, run_kind: "cold" }; },
    dispose: async () => {},
  };
}

test("runner: a candidate that did not declare pdf never sees a PDF fixture — unsupported_media, run() not called, no CER; a declaring candidate is run", async () => {
  const root = manifestWith({ media: "pdf" }, { file: "page.pdf", bytes: Buffer.from("%PDF-1.3 fake") });
  const m = loadManifest(root);
  const seen = [];
  const pngOnly = stubCandidate("png-only", undefined, (fx) => seen.push(`png-only:${fx.id}`));
  const declared = stubCandidate("pdf-ok", ["png", "pdf"], (fx) => seen.push(`pdf-ok:${fx.id}`));
  const report = await runBakeoff({ candidates: [pngOnly, declared], fixtures: m.fixtures, roleFilter: "verdict", fixturesRoot: root, timeout_ms: 1000 });
  const refused = report.observations.find((o) => o.engine_name === "png-only");
  assert.equal(refused.outcome, "failure");
  assert.equal(refused.code, "unsupported_media");
  assert.deepEqual(seen, ["pdf-ok:page"], "run() must be called only for the declaring candidate");
  assert.deepEqual(report.cer_scores.map((s) => s.candidate), ["pdf-ok"]);
});

// ---------------------------------------------------------------------------
// PDFKit text-layer candidate, with a fake helper
// ---------------------------------------------------------------------------

const PROBE_TAIL = '"helper_version":"0.1.0","os_version":"0","os_build":"0F0","arch":"fake","vision_languages":["zh-Hans","en-US"]';

function makeFakeHelper(pageOverrides) {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-layer-fake-"));
  const path = join(dir, "lawbar-ocr");
  const record = JSON.stringify({
    kind: "page", page: 1, page_count: 1, source: "pdf", layer_text: "文本", layer_chars: 2,
    render_width: 100, render_height: 100, render_digest: "0".repeat(64), vision_lines: [],
    vision_text: "文本", vision_ms: 40, render_ms: 5, helper_build_digest: "%DIGEST%", error: null,
    ...pageOverrides,
  });
  writeFileSync(path, [
    "#!/bin/sh",
    'read d < "$0.digest"',
    `if [ "$1" = "probe" ]; then printf '{"kind":"probe","helper_build_digest":"%s",${PROBE_TAIL}}\\n' "$d"; exit 0; fi`,
    `printf '%s\\n' "$(printf '%s' '${record}' | /usr/bin/sed "s/%DIGEST%/$d/")"`,
  ].join("\n"));
  chmodSync(path, 0o755);
  writeFileSync(`${path}.digest`, `${sha256OfFile(path)}\n`);
  return path;
}

function makeFakeTimeBin() {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-layer-time-"));
  const path = join(dir, "time");
  writeFileSync(path, '#!/bin/sh\nshift\n"$@"\nrc=$?\necho "             1474560  maximum resident set size" >&2\nexit $rc\n');
  chmodSync(path, 0o755);
  return path;
}

const optsFor = (binary) => ({ binary_path: binary, pinned_digest: sha256OfFile(binary), time_binary: makeFakeTimeBin(), required_languages: ["zh-Hans"] });
const COLD = { run_kind: "cold", timeout_ms: 10_000 };
const pdfFixture = { id: "page", path: "synthetic/page.pdf", language: "zh-Hans", media: "pdf" };
const pngFixture = { id: "page", path: "synthetic/page.png", language: "zh-Hans", media: "png" };

test("layer candidate: layer_text is the transcript; inference is reported as 0 because the helper does not time the layer read", async () => {
  const c = makeLawbarOcrPdfkitLayerCandidate(fixturesRoot, optsFor(makeFakeHelper({ layer_text: "本院经审理查明", layer_chars: 7 })));
  assert.deepEqual(c.supported_media, ["pdf"]);
  const o = await c.run(pdfFixture, COLD);
  assert.equal(o.outcome, "success", JSON.stringify(o));
  assert.equal(o.transcript, "本院经审理查明");
  assert.equal(o.per_page_inference_ms, 0);
  assert.equal(o.cold_model_load_ms, Math.max(0, o.latency_ms - 40 - 5), "the overhead field is the wall clock minus the helper's two timings");
  assert.equal(o.peak_rss_bytes, 1474560);
  assert.equal(o.engine_name, "lawbar-ocr-pdfkit-layer");
});

test("layer candidate: a page with no text layer is the structured no_text_layer failure, never an empty transcript", async () => {
  for (const overrides of [{ layer_text: "", layer_chars: 0 }, { layer_text: null, layer_chars: 0 }, { layer_text: "   ", layer_chars: 3 }]) {
    const c = makeLawbarOcrPdfkitLayerCandidate(fixturesRoot, optsFor(makeFakeHelper(overrides)));
    const o = await c.run(pdfFixture, COLD);
    assert.equal(o.outcome, "failure", JSON.stringify(o));
    assert.equal(o.code, "no_text_layer", JSON.stringify(overrides));
  }
});

test("layer candidate: a record that counts characters but carries no layer text is malformed output, not the escalation signal", async () => {
  for (const overrides of [{ layer_text: "", layer_chars: 5 }, { layer_text: null, layer_chars: 5 }]) {
    const c = makeLawbarOcrPdfkitLayerCandidate(fixturesRoot, optsFor(makeFakeHelper(overrides)));
    const o = await c.run(pdfFixture, COLD);
    assert.equal(o.outcome, "failure");
    assert.equal(o.code, "helper_output_unparseable", JSON.stringify(overrides));
  }
});

test("layer candidate: a PNG is refused as unsupported_media even when called directly; a missing layer_chars is unparseable", async () => {
  const c = makeLawbarOcrPdfkitLayerCandidate(fixturesRoot, optsFor(makeFakeHelper()));
  const png = await c.run(pngFixture, COLD);
  assert.equal(png.outcome, "failure");
  assert.equal(png.code, "unsupported_media");
  const bad = await makeLawbarOcrPdfkitLayerCandidate(fixturesRoot, optsFor(makeFakeHelper({ layer_chars: "two" }))).run(pdfFixture, COLD);
  assert.equal(bad.outcome, "failure");
  assert.equal(bad.code, "helper_output_unparseable");
});

test("layer candidate: the shared boundary still applies — a record with another binary's digest is refused", async () => {
  const c = makeLawbarOcrPdfkitLayerCandidate(fixturesRoot, optsFor(makeFakeHelper({ helper_build_digest: "b".repeat(64) })));
  const o = await c.run(pdfFixture, COLD);
  assert.equal(o.outcome, "failure");
  assert.equal(o.code, "helper_identity_mismatch");
});

test("vision candidate declares png AND pdf, so the runner hands it every PDF fixture", () => {
  assert.deepEqual(makeLawbarOcrVisionCandidate(fixturesRoot, {}).supported_media, ["png", "pdf"]);
});

// ---------------------------------------------------------------------------
// Opt-in: the real packaged helper on the authored PDFs
// ---------------------------------------------------------------------------

test(
  "REAL: text-layer PDFs read back exactly through the layer tier; scanned PDFs are no_text_layer for the layer and readable by Vision",
  { skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false },
  async () => {
    const m = loadManifest(fixturesRoot);
    const layer = makeLawbarOcrPdfkitLayerCandidate(fixturesRoot, { required_languages: ["zh-Hans"] });
    const vision = makeLawbarOcrVisionCandidate(fixturesRoot, { required_languages: ["zh-Hans"] });
    assert.equal((await layer.probe()).status, "available");
    for (const f of m.fixtures.filter((x) => x.active && x.media === "pdf")) {
      const expected = normalizeForCer(readFileSync(join(fixturesRoot, f.expected_text_path), "utf8"));
      const lo = await layer.run(f, { run_kind: "cold", timeout_ms: 60_000 });
      if (f.id.endsWith("-pdf-layer")) {
        assert.equal(lo.outcome, "success", `${f.id}: ${JSON.stringify(lo)}`);
        assert.deepEqual(normalizeForCer(lo.transcript), expected, `${f.id}: the layer must read back the authored text exactly under the CER normalisation`);
      } else {
        assert.equal(lo.outcome, "failure", `${f.id}: a scan has no layer`);
        assert.equal(lo.code, "no_text_layer");
        const vo = await vision.run(f, { run_kind: "cold", timeout_ms: 60_000 });
        assert.equal(vo.outcome, "success", `${f.id}: ${JSON.stringify(vo)}`);
        assert.ok(vo.transcript.length > 0);
      }
    }
  },
);
