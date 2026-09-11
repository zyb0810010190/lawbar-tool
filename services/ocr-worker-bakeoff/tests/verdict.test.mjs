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
  computeContainment,
  computeInflation,
  computeOrder,
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
const HOLDOUT_FIXTURES = 7;
const expectedText = (f) => f.render.source_text;

const ok = (engine, fixture_id, transcript, latency_ms = 100, rss = 50 * 1024 * 1024) =>
  ({ outcome: "success", fixture_id, engine_name: engine, engine_version: "t", transcript, latency_ms, peak_rss_bytes: rss, cold_model_load_ms: 0, per_page_inference_ms: 1, run_kind: "cold" });
const fail = (engine, fixture_id, code) => ({ outcome: "failure", fixture_id, engine_name: engine, code, message: "t" });

function report(observations, role = "holdout") {
  return {
    schema: "bakeoff-run-report/provisional", generated_at: "2026-09-10T00:00:00Z", host: { platform: "darwin", arch: "arm64" },
    role_filter: role, verdict_ready: true, fixtures_scored: HOLDOUT_FIXTURES,
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
    // An observation for a fixture OUTSIDE the scored role: it must be excluded from every count.
    ok("lawbar-ocr-vision", "tuning-only", "全错", 1, 1),
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
  // The hash of the spec AS REGISTERED. Any edit to the file — a threshold, a rank key, a word —
  // changes it, and this line is where that edit has to be made deliberate.
  assert.equal(sha256, "c75486e92c340bdb4201201c050f42120a764ee5eaaf9383033bf54a6256e8f3");
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
  // A slot with several candidates and no ranking rule would be ranked by name: refused.
  assert.throws(() => parseVerdictSpec(mut((c) => { c.slots[1].rank_by = []; })), /registers no rank_by/);
  // A signal_rate rank key without a code measures nothing: refused.
  assert.throws(() => parseVerdictSpec(mut((c) => { c.slots[1].rank_by = [{ subgroup: "png", metric: "signal_rate", direction: "asc" }]; })), /signal_rate needs a code/);
  // The single-candidate slot may have none.
  assert.doesNotThrow(() => parseVerdictSpec(mut((c) => { c.slots[0].rank_by = []; })));
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

test("computeCERFolded ignores punctuation width where computeCER does not, and nothing else", () => {
  assert.ok(computeCER("(2025) 沪", "（2025） 沪") > 0);
  assert.equal(computeCERFolded("(2025) 沪", "（2025） 沪"), 0);
  assert.ok(computeCERFolded("本院查明", "本院查名") > 0, "a real substitution still counts");
});

test("percentile is nearest-rank: latencies 1…100 give p95 = 95 and p50 = 50, not the maximum", () => {
  const fx = Array.from({ length: 100 }, (_, i) => ({
    active: true, id: `p${i}`, role: "holdout", kind: "synthetic", category: "t", media: "png", language: "zh-Hans",
    path: `holdout/p${i}.png`, expected_text_path: "holdout/p.txt", sha256: "0".repeat(64), expected_text_sha256: "0".repeat(64),
    provenance: "t", last_verified_at: "t", render: { render_command: "t", font: "t", point_size: 1, canvas: "t", source_text: "文" },
  }));
  const obs = fx.map((f, i) => ok("e", f.id, "文", i + 1, 1));
  const rep = { ...report(obs), fixtures_scored: 100, probes: [{ candidate: "e", result: { status: "available", resolved_version: "1" } }] };
  const a = aggregate(rep, fx, () => "文")["e"].png;
  assert.equal(a.p95_latency_ms, 95);
  assert.equal(a.p50_latency_ms, 50);
});

test("aggregate refuses a report whose scored count disagrees with the manifest, and a scored PDF with no subgroup suffix", () => {
  assert.throws(() => aggregate({ ...goodRun(), fixtures_scored: 20 }, fixtures(), expectedText), /says 20 fixtures were scored/);
  const fx = [...fixtures(), { ...fixtures()[3], id: "h9-pdf-other", path: "holdout/h9-pdf-other.pdf" }];
  assert.throws(() => aggregate({ ...goodRun(), fixtures_scored: 8 }, fx, expectedText), /has no subgroup/);
});

test("containment, inflation and order see what CER cannot: the same characters in another order score containment 1, order low, CER high", () => {
  const ref = "原告王五诉被告赵六借款合同纠纷一案";
  const reordered = "借款合同纠纷一案原告王五诉被告赵六"; // two blocks swapped — a column read in the wrong order
  assert.equal(computeContainment(ref, reordered), 1);
  assert.equal(computeInflation(ref, reordered), 1);
  assert.ok(computeOrder(ref, reordered) < 0.6, `order ${computeOrder(ref, reordered)}`);
  assert.ok(computeCERFolded(ref, reordered) > 0.4, "CER punishes the swap as if half the page were misread");
  // A genuine misread: containment drops, order stays.
  const misread = "原告王五诉被告赵六借款合同纠纷一桌";
  assert.ok(computeContainment(ref, misread) < 1 && computeContainment(ref, misread) > 0.9);
  assert.equal(computeOrder(ref, misread), 1);
  // Width and whitespace do not count; extra text inflates.
  assert.equal(computeContainment("(2025) 沪", "（2025）\n沪"), 1);
  assert.ok(computeInflation("沪", "沪沪沪") > 2.9);
  // An empty reference has no ratio: null, never 1, never Infinity — and null is excluded from means.
  assert.equal(computeContainment("", "x"), null);
  assert.equal(computeInflation("", "x"), null);
  assert.equal(computeOrder("", ""), null);
  assert.equal(computeOrder("abc", "xyz"), null, "nothing contained: no order to speak of");
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
  assert.equal(v.successes, 3, "its observation is not counted either");
  assert.equal(v.exact_rate, 1, "an out-of-role wrong transcript must not lower the rate");
  assert.equal(v.mean_containment, 1);
  assert.equal(v.mean_order, 1);
  assert.ok(Math.abs(v.mean_inflation - 1) < 0.01);
  assert.equal(v.success_rate, 1);
  assert.ok(v.mean_cer > 0, "raw CER sees the full-width parentheses");
  assert.equal(v.mean_cer_folded, 0, "folded CER does not");
  assert.equal(v.exact_rate, 1);
  assert.equal(v.p95_latency_ms, 310);
  assert.equal(v.max_rss_mb, 72e6 / 1048576, "aggregates are unrounded; rounding happens only in the committed result");
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
  const pngRun = { ...goodRun(), fixtures_scored: 3, observations: goodRun().observations.filter((o) => !o.fixture_id.includes("-pdf-")) };
  r = evaluate(spec, aggregate(pngRun, pngOnly, expectedText));
  const layer2 = r.slots.find((s) => s.slot === "text_layer");
  assert.equal(layer2.awarded_to, null);
  for (const q of layer2.evaluations[0].requirements) {
    assert.equal(q.measured, null, `${q.subgroup}/${q.metric}: nothing to measure`);
    assert.equal(q.pass, false, `${q.subgroup}/${q.metric}: unmeasured must fail, never default`);
  }
});

test("evaluate follows the spec AS WRITTEN: mutating an operator, a value, a code, or the ranking order changes the outcome accordingly", () => {
  const base = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
  const agg = aggregate(goodRun(), fixtures(), expectedText);
  const withSpec = (f) => { const c = structuredClone(base); f(c); return evaluate(parseVerdictSpec(JSON.stringify(c)), agg); };
  const layerReq = (c, metric) => c.slots[0].requirements.find((q) => q.metric === metric);
  // Tighter latency line than the fake's 45 ms → the layer slot is unfilled.
  assert.equal(withSpec((c) => { layerReq(c, "p95_latency_ms").value = 10; }).slots[0].awarded_to, null);
  // Flip the operator → the same measured value now fails.
  assert.equal(withSpec((c) => { layerReq(c, "p95_latency_ms").op = ">="; layerReq(c, "p95_latency_ms").value = 1000; }).slots[0].awarded_to, null);
  // A different signal code than the one the layer tier emits → its signal_rate is 0 → unfilled.
  assert.equal(withSpec((c) => { layerReq(c, "signal_rate").code = "something_else"; }).slots[0].awarded_to, null);
  // Rank the OCR slot by memory descending → Paddle (more memory) wins, Vision is the control.
  const r = withSpec((c) => { c.slots[1].rank_by = [{ subgroup: "png", metric: "max_rss_mb", direction: "desc" }]; });
  assert.deepEqual(r.slots[1].ranking, ["paddleocr-onnx", "lawbar-ocr-vision"]);
  assert.equal(r.control, "lawbar-ocr-vision");
  // A rank by a metric one candidate lacks: the unmeasured one ranks last on a descending key too.
  const r2 = withSpec((c) => { c.slots[1].rank_by = [{ subgroup: "pdf-scan", metric: "p95_latency_ms", direction: "desc" }]; });
  assert.deepEqual(r2.slots[1].ranking, ["lawbar-ocr-vision", "paddleocr-onnx"], "Paddle has no pdf-scan latency and must not beat a measured value by being null");
});

test("evaluate: an equal folded CER is a TIE, recorded as such and judged unrounded; a gap above 0.01 is not; the tie-break is memory", () => {
  const { spec } = readSpecFile(SPEC_PATH);
  // Paddle's folded CER over the three PNGs is one dropped space in TEXT.c: (1/11)/3 ≈ 0.0303.
  // Vision with one substitution on h1 (7 chars): (1/7)/3 ≈ 0.0476 — a gap of ≈0.017, above the line.
  const runWide = goodRun();
  let i = runWide.observations.findIndex((o) => o.engine_name === "lawbar-ocr-vision" && o.fixture_id === "h1");
  runWide.observations[i] = ok("lawbar-ocr-vision", "h1", "本院经审理查名", 300, 70e6);
  const wide = evaluate(spec, aggregate(runWide, fixtures(), expectedText)).slots.find((s) => s.slot === "ocr");
  assert.equal(wide.tie, null);
  assert.deepEqual(wide.ranking, ["paddleocr-onnx", "lawbar-ocr-vision"]);
  // Vision drops the same space as Paddle: identical means, a tie; memory breaks it and says so.
  const runTie = goodRun();
  i = runTie.observations.findIndex((o) => o.engine_name === "lawbar-ocr-vision" && o.fixture_id === "h3");
  runTie.observations[i] = ok("lawbar-ocr-vision", "h3", "原告：张三被告：李四", 290, 71e6);
  const tie = evaluate(spec, aggregate(runTie, fixtures(), expectedText)).slots.find((s) => s.slot === "ocr");
  assert.deepEqual(tie.tie, ["lawbar-ocr-vision", "paddleocr-onnx"]);
  assert.equal(tie.awarded_to, "lawbar-ocr-vision", "the tie-break is the second rank key, max_rss_mb");
  // A nonzero gap inside (0, 0.01): Vision one error on h2 (24 chars) → (1/24)/3 ≈ 0.0139 against a
  // Paddle that ALSO errs on h2 instead of h3 → equal; against Paddle on h3 → 0.0164. With these
  // page lengths no pair lands strictly inside (0, 0.01), so the exclusive boundary is exercised
  // with a synthetic aggregate instead of a run:
  const agg = aggregate(runTie, fixtures(), expectedText);
  const nudged = { ...agg, "paddleocr-onnx": { ...agg["paddleocr-onnx"], png: { ...agg["paddleocr-onnx"].png, mean_cer_folded: agg["lawbar-ocr-vision"].png.mean_cer_folded + 0.0099 } } };
  assert.deepEqual(evaluate(spec, nudged).slots.find((s) => s.slot === "ocr").tie, ["lawbar-ocr-vision", "paddleocr-onnx"], "0.0099 apart is a tie");
  const atLine = { ...agg, "paddleocr-onnx": { ...agg["paddleocr-onnx"], png: { ...agg["paddleocr-onnx"].png, mean_cer_folded: agg["lawbar-ocr-vision"].png.mean_cer_folded + 0.01 } } };
  assert.equal(evaluate(spec, atLine).slots.find((s) => s.slot === "ocr").tie, null, "exactly 0.01 apart is not a tie: the line is exclusive");
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
  for (const forbidden of [TEXT.a, TEXT.b, TEXT.c, "h1-pdf-layer", "h1", "/secret/path", "secret", "transcript", "全错"]) {
    assert.ok(!text.includes(forbidden), `result must not carry ${forbidden}`);
  }
  // Every retained string in the result is shape-checked, not copied: page text or a relative
  // path in resolved_version never survives.
  const dirty = goodRun();
  dirty.probes[0] = { candidate: "lawbar-ocr-vision", result: { status: "available", resolved_version: "案情 ../client/page", detail: "text=本院经审理查明" } };
  const r2 = buildVerdict({ report: dirty, fixtures: fixtures(), expectedText, spec, specSha256: sha256, manifestSha256: "m".repeat(64), root: "external", gitSha: null });
  assertCommittable(r2);
  assert.equal(r2.candidates["lawbar-ocr-vision"].resolved_version, null);
  assert.ok(!JSON.stringify(r2).includes("案情") && !JSON.stringify(r2).includes("client"));
  assert.equal(result.manifest.root, "external");
  assert.deepEqual(result.candidates["lawbar-ocr-vision"], { probe_status: "available", resolved_version: "0.2.0+sha256.abc", os_build: "24G90", arch: null }, "only the OS build and arch are extracted from probe detail; the text itself is not copied");
  assert.equal(result.spec.sha256, sha256);
  assert.equal(result.harness.git_sha, "abc");
  assert.equal(result.control, "paddleocr-onnx");
});

test("a failure code that is not code-shaped — a path, a message — is tallied under unrecognised_code, never committed as a key; a probe detail that carries a path or text does not reach the result", () => {
  const { spec, sha256 } = readSpecFile(SPEC_PATH);
  const run = goodRun();
  const i = run.observations.findIndex((o) => o.engine_name === "paddleocr-onnx" && o.fixture_id === "h1-pdf-layer");
  run.observations[i] = fail("paddleocr-onnx", "h1-pdf-layer", "/Users/me/Client/page.pdf: denied");
  run.probes[1] = { candidate: "paddleocr-onnx", result: { status: "available", resolved_version: "1.4.8", detail: "source=/Users/me/Client/page.pdf; text=案情 os_build=24G90 arch=arm64" } };
  const result = buildVerdict({ report: run, fixtures: fixtures(), expectedText, spec, specSha256: sha256, manifestSha256: "m".repeat(64), root: "external", gitSha: null });
  assertCommittable(result);
  const text = JSON.stringify(result);
  assert.ok(!text.includes("/Users"), "no path may survive");
  assert.ok(!text.includes("案情"), "no page text may survive");
  assert.deepEqual(result.aggregates["paddleocr-onnx"]["pdf-layer"].failures, { unrecognised_code: 1, unsupported_media: 1 });
  assert.deepEqual(result.candidates["paddleocr-onnx"], { probe_status: "available", resolved_version: "1.4.8", os_build: "24G90", arch: "arm64" });
});

test("assertCommittable walks every key and value: a path-like string anywhere is refused", () => {
  const { spec, sha256 } = readSpecFile(SPEC_PATH);
  const result = buildVerdict({ report: goodRun(), fixtures: fixtures(), expectedText, spec, specSha256: sha256, manifestSha256: "m".repeat(64), root: "repo", gitSha: null });
  assert.throws(() => assertCommittable({ ...result, harness: { ...result.harness, git_sha: "/Users/me/repo" } }), /path-like string/);
  assert.throws(() => assertCommittable({ ...result, aggregates: { ...result.aggregates, "x/y": {} } }), /path-like key/);
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
  // There is no way to point the bin at another spec: the committed one is the only judge.
  const spec = run(["--role=holdout", "--spec=/tmp/easy.json", "--out=/tmp/x.json"]);
  assert.equal(spec.status, 3);
  assert.match(spec.stderr, /unknown arg: --spec/);
  assert.equal(run(["--role=holdout", "--fixtures-root=relative/dir", "--out=/tmp/x.json"]).status, 3);
  const r = run(["--role=verdict", "--out=/tmp/x.json"]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /spec evaluates role holdout/);
  const dir = mkdtempSync(join(tmpdir(), "verdict-bin-"));
  const existing = join(dir, "taken.json");
  writeFileSync(existing, "{}");
  // An existing result is never overwritten, and the refusal comes before any engine runs.
  const t0 = Date.now();
  const r2 = spawnSync(process.execPath, [bin, "--role=holdout", `--out=${existing}`], { encoding: "utf8", timeout: 60_000 });
  assert.equal(r2.status, 3, `${r2.status}: ${r2.stderr.slice(-300)}`);
  assert.ok(Date.now() - t0 < 10_000, "the refusal must not wait for a bake-off run");
  assert.match(r2.stderr, /refusing to overwrite/);
  assert.equal(readFileSync(existing, "utf8"), "{}", "the existing file must be untouched");
});
