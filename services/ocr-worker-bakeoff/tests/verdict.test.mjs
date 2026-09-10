// The verdict: pre-registered thresholds applied as written, aggregates that carry no page (R3, WI-12 item 6).
//
// Every claim is provoked on a hand-built run report: a spec line that fails flips the award; a
// missing subgroup fails a requirement rather than passing it; a one-character gap is a tie; the
// folded CER ignores punctuation width where the raw one does not; and a committable result never
// carries a transcript, a fixture id, or a path. The committed spec itself is parsed and its
// registration date checked, so an edit to a threshold cannot slip past as a formatting change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  aggregate,
  assertCommittable,
  buildVerdict,
  computeCERFolded,
  evaluate,
  parseVerdictSpec,
  readSpecFile,
  sha256Hex,
  subgroupOf,
  VerdictSpecError,
} from "../dist/verdict.js";
import { computeCER } from "../dist/accuracy.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const SPEC_PATH = join(pkgRoot, "fixtures", "verdict-spec.json");

// ---------------------------------------------------------------------------
// A hand-built holdout: three subgroups, two OCR candidates, one layer candidate
// ---------------------------------------------------------------------------

const TEXT = { a: "本院经审理查明", b: "(2025) 沪0115民初12345号", c: "原告：张三 被告：李四" };
function fixtures() {
  const mk = (id, media, text, role = "holdout") => ({
    active: true, id, role, kind: "synthetic", category: "t", media, language: "zh-Hans",
    path: `holdout/${id}.${media}`, expected_text_path: `holdout/${id}.txt`, sha256: "0".repeat(64), expected_text_sha256: "0".repeat(64),
    provenance: "t", last_verified_at: "t", render: { render_command: "t", font: "t", point_size: 1, canvas: "t", source_text: text },
  });
  return [
    mk("h1", "png", TEXT.a), mk("h2", "png", TEXT.b), mk("h3", "png", TEXT.c),
    mk("h1-pdf-layer", "pdf", TEXT.a), mk("h2-pdf-layer", "pdf", TEXT.b),
    mk("h1-pdf-scan", "pdf", TEXT.a), mk("h2-pdf-scan", "pdf", TEXT.b),
    mk("tuning-only", "png", TEXT.a, "verdict"),
  ];
}
const expectedText = (f) => f.render.source_text;

const ok = (engine, fixture_id, transcript, latency_ms = 100, rss = 50 * 1024 * 1024) =>
  ({ outcome: "success", fixture_id, engine_name: engine, engine_version: "t", transcript, latency_ms, peak_rss_bytes: rss, cold_model_load_ms: 0, per_page_inference_ms: 1, run_kind: "cold" });
const fail = (engine, fixture_id, code) => ({ outcome: "failure", fixture_id, engine_name: engine, code, message: "t" });

function report(observations, role = "holdout") {
  return {
    schema: "bakeoff-run-report/provisional", generated_at: "2026-09-10T00:00:00Z", host: { platform: "darwin", arch: "arm64" },
    role_filter: role, verdict_ready: true, fixtures_scored: 7,
    probes: [
      { candidate: "lawbar-ocr-vision", result: { status: "available", resolved_version: "0.2.0+sha256.abc", detail: "helper=packaged:/secret/path os_build=24G90" } },
      { candidate: "paddleocr-onnx", result: { status: "available", resolved_version: "1.4.8" } },
      { candidate: "lawbar-ocr-pdfkit-layer", result: { status: "available", resolved_version: "0.2.0+sha256.abc" } },
      { candidate: "tesseract", result: { status: "missing_model", model: "chi_sim", expected_path: "x", remediation: "x" } },
    ],
    observations, cer_scores: [],
  };
}

/** A run where Vision is exact on PNGs, Paddle drops a space, the layer tier is exact and silent on scans. */
function goodRun(role = "holdout") {
  return report([
    ok("lawbar-ocr-vision", "h1", TEXT.a, 300, 70e6), ok("lawbar-ocr-vision", "h2", "（2025） 沪0115民初12345号", 310, 72e6), ok("lawbar-ocr-vision", "h3", TEXT.c, 290, 71e6),
    ok("lawbar-ocr-vision", "h1-pdf-layer", TEXT.a), ok("lawbar-ocr-vision", "h2-pdf-layer", TEXT.b), ok("lawbar-ocr-vision", "h1-pdf-scan", TEXT.a), ok("lawbar-ocr-vision", "h2-pdf-scan", TEXT.b),
    ok("paddleocr-onnx", "h1", TEXT.a, 350, 300e6), ok("paddleocr-onnx", "h2", TEXT.b, 340, 310e6), ok("paddleocr-onnx", "h3", "原告：张三被告：李四", 330, 305e6),
    fail("paddleocr-onnx", "h1-pdf-layer", "unsupported_media"), fail("paddleocr-onnx", "h2-pdf-layer", "unsupported_media"), fail("paddleocr-onnx", "h1-pdf-scan", "unsupported_media"), fail("paddleocr-onnx", "h2-pdf-scan", "unsupported_media"),
    ok("lawbar-ocr-pdfkit-layer", "h1-pdf-layer", TEXT.a, 40, 17e6), ok("lawbar-ocr-pdfkit-layer", "h2-pdf-layer", TEXT.b, 45, 17e6),
    fail("lawbar-ocr-pdfkit-layer", "h1-pdf-scan", "no_text_layer"), fail("lawbar-ocr-pdfkit-layer", "h2-pdf-scan", "no_text_layer"),
    fail("lawbar-ocr-pdfkit-layer", "h1", "unsupported_media"), fail("lawbar-ocr-pdfkit-layer", "h2", "unsupported_media"), fail("lawbar-ocr-pdfkit-layer", "h3", "unsupported_media"),
    fail("tesseract", "h1", "probe_missing_model"), fail("tesseract", "h2", "probe_missing_model"), fail("tesseract", "h3", "probe_missing_model"),
  ], role);
}

// ---------------------------------------------------------------------------
// The committed spec
// ---------------------------------------------------------------------------

test("the committed spec parses, evaluates the holdout, names two slots and a control, and its registration date is fixed", () => {
  const { spec, sha256 } = readSpecFile(SPEC_PATH);
  assert.equal(spec.evaluate_on_role, "holdout");
  assert.deepEqual(spec.slots.map((s) => s.slot), ["text_layer", "ocr"]);
  assert.equal(spec.control.from_slot, "ocr");
  assert.equal(spec.registered_at, "2026-09-10", "the registration date is part of what was registered");
  assert.equal(sha256, sha256Hex(readFileSync(SPEC_PATH, "utf8")));
  // The lines as registered. A change here is a change to the decision and must be deliberate.
  const ocr = spec.slots.find((s) => s.slot === "ocr");
  assert.deepEqual(ocr.requirements.find((r) => r.metric === "mean_cer_folded"), { subgroup: "png", metric: "mean_cer_folded", op: "<=", value: 0.05 });
  const layer = spec.slots.find((s) => s.slot === "text_layer");
  assert.deepEqual(layer.requirements.find((r) => r.metric === "signal_rate"), { subgroup: "pdf-scan", metric: "signal_rate", code: "no_text_layer", op: ">=", value: 1 });
});

test("parseVerdictSpec refuses an unknown metric, an unknown subgroup, a slot without requirements, and a control naming no slot", () => {
  const base = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
  const mut = (f) => { const c = structuredClone(base); f(c); return JSON.stringify(c); };
  assert.throws(() => parseVerdictSpec(mut((c) => { c.slots[0].requirements[0].metric = "vibes"; })), VerdictSpecError);
  assert.throws(() => parseVerdictSpec(mut((c) => { c.slots[0].requirements[0].subgroup = "tiff"; })), VerdictSpecError);
  assert.throws(() => parseVerdictSpec(mut((c) => { c.slots[0].requirements = []; })), VerdictSpecError);
  assert.throws(() => parseVerdictSpec(mut((c) => { c.control.from_slot = "nope"; })), VerdictSpecError);
  assert.throws(() => parseVerdictSpec("{"), VerdictSpecError);
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

test("computeCERFolded ignores punctuation width where computeCER does not, and nothing else", () => {
  assert.ok(computeCER("(2025) 沪", "（2025） 沪") > 0);
  assert.equal(computeCERFolded("(2025) 沪", "（2025） 沪"), 0);
  assert.ok(computeCERFolded("本院查明", "本院查名") > 0, "a real substitution still counts");
});

test("subgroupOf: png by media; PDFs by id suffix; an unrecognised PDF id is not scored", () => {
  assert.equal(subgroupOf({ id: "x", media: "png" }), "png");
  assert.equal(subgroupOf({ id: "x-pdf-layer", media: "pdf" }), "pdf-layer");
  assert.equal(subgroupOf({ id: "x-pdf-scan", media: "pdf" }), "pdf-scan");
  assert.equal(subgroupOf({ id: "x-other", media: "pdf" }), null);
});

test("aggregate: per candidate and subgroup — counts, failure tallies, both CERs, exact rate, percentiles, RSS; only the report's role is counted", () => {
  const agg = aggregate(goodRun(), fixtures(), expectedText);
  const v = agg["lawbar-ocr-vision"].png;
  assert.equal(v.fixtures, 3, "the tuning-only fixture is not a holdout fixture");
  assert.equal(v.successes, 3);
  assert.equal(v.success_rate, 1);
  assert.ok(v.mean_cer > 0, "raw CER sees the full-width parentheses");
  assert.equal(v.mean_cer_folded, 0, "folded CER does not");
  assert.equal(v.exact_rate, 1);
  assert.equal(v.p95_latency_ms, 310);
  assert.equal(v.max_rss_mb, Number((72e6 / 1048576).toFixed(1)));
  const p = agg["paddleocr-onnx"].png;
  assert.ok(p.mean_cer_folded > 0 && p.mean_cer_folded < 0.1, "a dropped space is one edit");
  assert.deepEqual(agg["paddleocr-onnx"]["pdf-layer"].failures, { unsupported_media: 2 });
  const l = agg["lawbar-ocr-pdfkit-layer"];
  assert.deepEqual(l["pdf-scan"].failures, { no_text_layer: 2 });
  assert.equal(l["pdf-scan"].successes, 0);
  assert.equal(l["pdf-layer"].exact_rate, 1);
  assert.deepEqual(agg["tesseract"].png.failures, { probe_missing_model: 3 });
  assert.equal(agg["tesseract"].png.mean_cer, null, "no success, no mean");
});

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

test("evaluate: the good run awards both slots, ranks Vision above Paddle on folded CER, and names Paddle as the control", () => {
  const { spec } = readSpecFile(SPEC_PATH);
  const { slots, control } = evaluate(spec, aggregate(goodRun(), fixtures(), expectedText));
  const layer = slots.find((s) => s.slot === "text_layer");
  assert.equal(layer.awarded_to, "lawbar-ocr-pdfkit-layer");
  assert.ok(layer.evaluations[0].requirements.every((r) => r.pass), JSON.stringify(layer.evaluations[0].requirements));
  const ocr = slots.find((s) => s.slot === "ocr");
  assert.deepEqual(ocr.ranking, ["lawbar-ocr-vision", "paddleocr-onnx"]);
  assert.equal(ocr.awarded_to, "lawbar-ocr-vision");
  assert.equal(ocr.tie, null);
  assert.equal(control, "paddleocr-onnx");
  const tess = ocr.evaluations.find((e) => e.candidate === "tesseract");
  assert.equal(tess.qualifies, false);
  assert.equal(tess.requirements[0].measured, 0, "success_rate is measured as 0, not missing");
});

test("evaluate: a requirement that fails flips the award; an absent subgroup fails rather than passes", () => {
  const { spec } = readSpecFile(SPEC_PATH);
  // The layer tier reads one scan as text: the signal_rate line fails and the slot is unfilled.
  const bad = goodRun();
  const i = bad.observations.findIndex((o) => o.engine_name === "lawbar-ocr-pdfkit-layer" && o.fixture_id === "h1-pdf-scan");
  bad.observations[i] = ok("lawbar-ocr-pdfkit-layer", "h1-pdf-scan", "ghost text", 40, 17e6);
  let r = evaluate(spec, aggregate(bad, fixtures(), expectedText));
  const layer = r.slots.find((s) => s.slot === "text_layer");
  assert.equal(layer.awarded_to, null);
  const sig = layer.evaluations[0].requirements.find((q) => q.metric === "signal_rate");
  assert.equal(sig.measured, 0.5);
  assert.equal(sig.pass, false);

  // No PDF fixtures at all: the layer slot's pdf-layer requirements are unmeasured → fail.
  const pngOnly = fixtures().filter((f) => f.media === "png");
  r = evaluate(spec, aggregate(goodRun(), pngOnly, expectedText));
  const layer2 = r.slots.find((s) => s.slot === "text_layer");
  assert.equal(layer2.awarded_to, null);
  assert.ok(layer2.evaluations[0].requirements.some((q) => q.measured === null && q.pass === false));
});

test("evaluate: two candidates within one character per page are a TIE, recorded as such; the tie-break is memory", () => {
  const { spec } = readSpecFile(SPEC_PATH);
  const run = goodRun();
  // Give Vision the same single dropped space Paddle has on h3, so their folded CERs are equal.
  const i = run.observations.findIndex((o) => o.engine_name === "lawbar-ocr-vision" && o.fixture_id === "h3");
  run.observations[i] = ok("lawbar-ocr-vision", "h3", "原告：张三被告：李四", 290, 71e6);
  const { slots } = evaluate(spec, aggregate(run, fixtures(), expectedText));
  const ocr = slots.find((s) => s.slot === "ocr");
  assert.deepEqual(ocr.tie, ["lawbar-ocr-vision", "paddleocr-onnx"]);
  assert.equal(ocr.awarded_to, "lawbar-ocr-vision", "the tie-break is the second rank key, max_rss_mb");
});

test("evaluate: the control is null when only one OCR candidate qualifies", () => {
  const { spec } = readSpecFile(SPEC_PATH);
  const run = goodRun();
  for (const o of run.observations) if (o.engine_name === "paddleocr-onnx" && o.outcome === "success") o.transcript = "全错全错全错全错";
  const { control, slots } = evaluate(spec, aggregate(run, fixtures(), expectedText));
  assert.equal(control, null);
  assert.equal(slots.find((s) => s.slot === "ocr").awarded_to, "lawbar-ocr-vision");
});

// ---------------------------------------------------------------------------
// The committed result
// ---------------------------------------------------------------------------

test("buildVerdict: aggregates and identity only — no transcript, no fixture id, no path; the helper's source path is stripped from probe detail", () => {
  const { spec, sha256 } = readSpecFile(SPEC_PATH);
  const result = buildVerdict({ report: goodRun(), fixtures: fixtures(), expectedText, spec, specSha256: sha256, manifestSha256: "m".repeat(64), root: "external", gitSha: "abc" });
  assertCommittable(result);
  const text = JSON.stringify(result);
  for (const forbidden of [TEXT.a, TEXT.b, "h1-pdf-layer", "/secret/path", "transcript"]) {
    assert.ok(!text.includes(forbidden), `result must not carry ${forbidden}`);
  }
  assert.equal(result.manifest.root, "external");
  assert.equal(result.candidates["lawbar-ocr-vision"].detail, "helper=packaged os_build=24G90");
  assert.equal(result.spec.sha256, sha256);
  assert.equal(result.harness.git_sha, "abc");
  assert.equal(result.control, "paddleocr-onnx");
});

test("buildVerdict refuses a report of the wrong role; assertCommittable refuses a result that smuggles observations", () => {
  const { spec, sha256 } = readSpecFile(SPEC_PATH);
  assert.throws(() => buildVerdict({ report: goodRun("verdict"), fixtures: fixtures(), expectedText, spec, specSha256: sha256, manifestSha256: "m".repeat(64), root: "repo", gitSha: null }), VerdictSpecError);
  const result = buildVerdict({ report: goodRun(), fixtures: fixtures(), expectedText, spec, specSha256: sha256, manifestSha256: "m".repeat(64), root: "repo", gitSha: null });
  assert.throws(() => assertCommittable({ ...result, observations: [] }), VerdictSpecError);
  assert.throws(() => assertCommittable({ ...result, extra: { transcript: "x" } }), VerdictSpecError);
});

// ---------------------------------------------------------------------------
// The bin: argument contract only (a real run is the committed result's job)
// ---------------------------------------------------------------------------

test("bin/verdict.mjs: refuses a missing --out, an unknown role, a relative fixtures root, and a role the spec does not evaluate", () => {
  const bin = join(pkgRoot, "bin", "verdict.mjs");
  const run = (args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", timeout: 30_000 });
  assert.equal(run(["--role=holdout"]).status, 3);
  assert.equal(run(["--role=smoke", "--out=/tmp/x.json"]).status, 3);
  assert.equal(run(["--role=holdout", "--fixtures-root=relative/dir", "--out=/tmp/x.json"]).status, 3);
  const r = run(["--role=verdict", "--out=/tmp/x.json"]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /spec evaluates role holdout/);
  const dir = mkdtempSync(join(tmpdir(), "verdict-bin-"));
  const existing = join(dir, "taken.json");
  writeFileSync(existing, "{}");
  // Overwrite refusal is checked before any run would be written; here the manifest has no holdout
  // fixtures yet, so the bin stops earlier with exit 2 — both are refusals, neither writes.
  const r2 = run(["--role=holdout", `--out=${existing}`]);
  assert.ok([2, 3].includes(r2.status), `${r2.status}: ${r2.stderr}`);
  assert.equal(readFileSync(existing, "utf8"), "{}", "the existing file must be untouched");
});
