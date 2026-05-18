// PaddleOCR-via-ONNX harness tests (δ). Two test layers, same shape as
// the Tesseract harness:
//
//   ALWAYS-ON  — exercises probe + run orchestration via stubs (fake
//                runner scripts, fake time wrapper). No real OCR.
//   OPT-IN     — gated on `OCR_REAL_PADDLEOCR_TESTS=1`. Requires the
//                @gutenye/ocr-node + onnxruntime-node deps to be
//                installed (already in package.json). Fails LOUDLY if
//                the env is set but the deps are absent.
//
// POSIX-only same as the Tesseract suite: fake helpers write
// `#!/bin/sh` scripts and chmod them executable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  makePaddleOcrOnnxCandidate,
  parseMaxRssBytesFromTimeL,
  resolvePaddleLang,
  canonicalizePaddleTag,
} from "../dist/harnesses/paddleocr-onnx.js";
import { runBakeoff } from "../dist/runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const fixturesRoot = join(pkgRoot, "fixtures");

const REAL_ENV_KEY = "OCR_REAL_PADDLEOCR_TESTS";
const realTestsRequested = process.env[REAL_ENV_KEY] === "1";

// ---------------------------------------------------------------------------
// Fake-binary helpers (POSIX)
// ---------------------------------------------------------------------------

function makeFakeRunnerScript(jsonOutput) {
  // A "fake runner" that just writes the supplied JSON to stdout. The
  // harness expects exactly one JSON line per spawn.
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-paddle-runner-"));
  const path = join(dir, "fake-runner.mjs");
  writeFileSync(
    path,
    `process.stdout.write(${JSON.stringify(jsonOutput)} + "\\n");\n`,
  );
  return path;
}

function makeFakeTimeBin() {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-paddle-time-"));
  const path = join(dir, "time");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      "shift", // drop the `-l` flag
      '"$@"',
      "rc=$?",
      'echo "             1474560  maximum resident set size" >&2',
      "exit $rc",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return path;
}

// ---------------------------------------------------------------------------
// Language mapping
// ---------------------------------------------------------------------------

test("resolvePaddleLang: supported BCP-47 tags resolve to 'default'", () => {
  assert.equal(resolvePaddleLang("eng"), "default");
  assert.equal(resolvePaddleLang("en"), "default");
  assert.equal(resolvePaddleLang("en-US"), "default");
  assert.equal(resolvePaddleLang("zh-Hans"), "default");
  assert.equal(resolvePaddleLang("zh-CN"), "default");
  assert.equal(resolvePaddleLang("zh"), "default");
});

test("resolvePaddleLang: case-insensitive per RFC 5646", () => {
  assert.equal(resolvePaddleLang("ZH-HANS"), "default");
  assert.equal(resolvePaddleLang("zh-hans"), "default");
  assert.equal(resolvePaddleLang("Zh-HaNs"), "default");
  assert.equal(resolvePaddleLang("EN-US"), "default");
});

test("resolvePaddleLang: unmapped tags (e.g. Japanese, French) return null", () => {
  // The bundled models don't ship Japanese/Korean/French — the harness
  // must NOT silently pass these to the engine.
  assert.equal(resolvePaddleLang("ja"), null);
  assert.equal(resolvePaddleLang("jpn"), null);
  assert.equal(resolvePaddleLang("ko"), null);
  assert.equal(resolvePaddleLang("fr"), null);
  assert.equal(resolvePaddleLang(""), null);
});

test("canonicalizePaddleTag: subtag-position-aware casing", () => {
  assert.equal(canonicalizePaddleTag("ZH-HANS-CN"), "zh-Hans-CN");
  assert.equal(canonicalizePaddleTag("en-us"), "en-US");
  assert.equal(canonicalizePaddleTag("ZH"), "zh");
});

// ---------------------------------------------------------------------------
// RSS parser
// ---------------------------------------------------------------------------

test("parseMaxRssBytesFromTimeL: valid macOS stderr → bytes", () => {
  assert.equal(
    parseMaxRssBytesFromTimeL("       0.05 real\n             2884563  maximum resident set size\n"),
    2884563,
  );
});

test("parseMaxRssBytesFromTimeL: stderr without RSS line → null", () => {
  assert.equal(parseMaxRssBytesFromTimeL("random stderr"), null);
});

// ---------------------------------------------------------------------------
// Probe matrix
// ---------------------------------------------------------------------------

test("probe: unsupported language tag → missing_model unmapped", async () => {
  const candidate = makePaddleOcrOnnxCandidate(fixturesRoot, {
    required_languages: ["jpn"],
  });
  const result = await candidate.probe();
  assert.equal(result.status, "missing_model");
  if (result.status === "missing_model") {
    assert.match(result.model, /^<unmapped:jpn>$/);
    assert.match(result.remediation, /SUPPORTED_TAGS_NORMALIZED/);
  }
});

test("probe: missing runner script → missing_dependency", async () => {
  const candidate = makePaddleOcrOnnxCandidate(fixturesRoot, {
    runner_path: "/nonexistent/path/to/runner.mjs",
  });
  const result = await candidate.probe();
  assert.equal(result.status, "missing_dependency");
  if (result.status === "missing_dependency") {
    assert.match(result.remediation, /npm.*run build/);
  }
});

// ---------------------------------------------------------------------------
// Run-kind capability
// ---------------------------------------------------------------------------

test("candidate advertises supported_run_kinds=['cold'] (cold-only same as Tesseract)", () => {
  const candidate = makePaddleOcrOnnxCandidate(fixturesRoot);
  assert.deepEqual([...candidate.supported_run_kinds], ["cold"]);
});

test("run: warm request returns unsupported_run_kind (no silent downgrade)", async () => {
  const candidate = makePaddleOcrOnnxCandidate(fixturesRoot);
  const fakeFixture = {
    active: true,
    id: "stub",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "synthetic/01-hello-bakeoff.png",
    expected_text_path: "synthetic/01-hello-bakeoff.txt",
    sha256: "0".repeat(64),
    expected_text_sha256: "0".repeat(64),
    language: "eng",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: { render_command: "stub", font: "stub", point_size: 12, canvas: "10x10", source_text: "stub" },
  };
  const obs = await candidate.run(fakeFixture, { run_kind: "warm", timeout_ms: 5000 });
  assert.equal(obs.outcome, "failure");
  if (obs.outcome === "failure") {
    assert.equal(obs.code, "unsupported_run_kind");
  }
});

test("run: fixture with unsupported language → unsupported_language_tag failure (run never spawns)", async () => {
  const candidate = makePaddleOcrOnnxCandidate(fixturesRoot, {
    node_binary: "/nonexistent",
    runner_path: "/nonexistent",
  });
  const fakeFixture = {
    active: true,
    id: "ja-stub",
    role: "smoke",
    kind: "real",
    category: "test",
    path: "synthetic/01-hello-bakeoff.png",
    expected_text_path: "synthetic/01-hello-bakeoff.txt",
    sha256: "0".repeat(64),
    expected_text_sha256: "0".repeat(64),
    language: "ja",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    real_source: "in-test",
    pii_review: "not_required",
  };
  const obs = await candidate.run(fakeFixture, { run_kind: "cold", timeout_ms: 5000 });
  assert.equal(obs.outcome, "failure");
  if (obs.outcome === "failure") {
    assert.equal(obs.code, "unsupported_language_tag");
    assert.match(obs.message, /ja/);
  }
});

// ---------------------------------------------------------------------------
// License shape
// ---------------------------------------------------------------------------

test("license carries separate code/model evidence URLs", () => {
  const candidate = makePaddleOcrOnnxCandidate(fixturesRoot);
  assert.equal(candidate.license.code_license, "MIT");
  assert.equal(candidate.license.model_license, "MIT");
  assert.match(candidate.license.code_evidence_url, /gutenye\/ocr.*LICENSE/);
  assert.match(candidate.license.model_evidence_url ?? "", /ocr-models.*LICENSE/);
  assert.equal(candidate.license.redistribution, "permitted");
  // Codex audit pattern: notes must call out the model-derivation chain.
  assert.match(candidate.license.notes ?? "", /derivative.*PaddleOCR/);
});

// ---------------------------------------------------------------------------
// Run via fake runner — happy path
// ---------------------------------------------------------------------------

test("run: happy path via fake runner returns success observation with parsed cold/per-page split", async () => {
  const runnerPath = makeFakeRunnerScript(JSON.stringify({
    ok: true,
    transcript: "stub transcript",
    cold_model_load_ms: 250,
    per_page_inference_ms: 80,
  }));
  const fakeTime = makeFakeTimeBin();
  const candidate = makePaddleOcrOnnxCandidate(fixturesRoot, {
    time_binary: fakeTime,
    runner_path: runnerPath,
  });

  const fakeFixture = {
    active: true,
    id: "happy-paddle",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "synthetic/01-hello-bakeoff.png",
    expected_text_path: "synthetic/01-hello-bakeoff.txt",
    sha256: "0".repeat(64),
    expected_text_sha256: "0".repeat(64),
    language: "eng",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: { render_command: "stub", font: "stub", point_size: 12, canvas: "10x10", source_text: "stub transcript" },
  };

  const obs = await candidate.run(fakeFixture, { run_kind: "cold", timeout_ms: 10000 });
  assert.equal(obs.outcome, "success", `expected success: ${JSON.stringify(obs)}`);
  if (obs.outcome === "success") {
    assert.equal(obs.transcript, "stub transcript");
    assert.equal(obs.cold_model_load_ms, 250);
    assert.equal(obs.per_page_inference_ms, 80);
    assert.equal(obs.run_kind, "cold");
    assert.equal(obs.peak_rss_bytes, 1474560);
    assert.equal(obs.engine_name, "paddleocr-onnx");
    assert.equal(obs.engine_version, "1.4.8");
  }
});

test("run: runner reports ok=false → runner_reported_failure observation", async () => {
  const runnerPath = makeFakeRunnerScript(JSON.stringify({
    ok: false,
    error: "synthetic engine error",
  }));
  const fakeTime = makeFakeTimeBin();
  const candidate = makePaddleOcrOnnxCandidate(fixturesRoot, {
    time_binary: fakeTime,
    runner_path: runnerPath,
  });

  const fakeFixture = {
    active: true,
    id: "runner-fails",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "synthetic/01-hello-bakeoff.png",
    expected_text_path: "synthetic/01-hello-bakeoff.txt",
    sha256: "0".repeat(64),
    expected_text_sha256: "0".repeat(64),
    language: "eng",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: { render_command: "stub", font: "stub", point_size: 12, canvas: "10x10", source_text: "stub" },
  };

  const obs = await candidate.run(fakeFixture, { run_kind: "cold", timeout_ms: 10000 });
  // Fake runner exits 0 but reports ok=false → runner_reported_failure.
  assert.equal(obs.outcome, "failure");
  if (obs.outcome === "failure") {
    assert.equal(obs.code, "runner_reported_failure");
    assert.match(obs.message, /synthetic engine error/);
  }
});

test("run: runner emits non-JSON garbage → runner_output_unparseable", async () => {
  // Runner that writes plain text instead of JSON.
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-paddle-garbage-"));
  const path = join(dir, "garbage-runner.mjs");
  writeFileSync(path, `process.stdout.write("this is not json\\n");\n`);
  const fakeTime = makeFakeTimeBin();
  const candidate = makePaddleOcrOnnxCandidate(fixturesRoot, {
    time_binary: fakeTime,
    runner_path: path,
  });

  const fakeFixture = {
    active: true,
    id: "garbage",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "synthetic/01-hello-bakeoff.png",
    expected_text_path: "synthetic/01-hello-bakeoff.txt",
    sha256: "0".repeat(64),
    expected_text_sha256: "0".repeat(64),
    language: "eng",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: { render_command: "stub", font: "stub", point_size: 12, canvas: "10x10", source_text: "stub" },
  };

  const obs = await candidate.run(fakeFixture, { run_kind: "cold", timeout_ms: 10000 });
  assert.equal(obs.outcome, "failure");
  if (obs.outcome === "failure") {
    assert.equal(obs.code, "runner_output_unparseable");
  }
});

// ---------------------------------------------------------------------------
// Real PaddleOCR-ONNX integration (opt-in via OCR_REAL_PADDLEOCR_TESTS=1)
// ---------------------------------------------------------------------------

test(
  "REAL: probe returns 'available' on this host",
  { skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false },
  async () => {
    const candidate = makePaddleOcrOnnxCandidate(fixturesRoot);
    const probe = await candidate.probe();
    assert.equal(
      probe.status,
      "available",
      `Real probe expected 'available' but returned ${JSON.stringify(probe)}`,
    );
  },
);

test(
  "REAL: runBakeoff on the smoke fixture yields CER === 0",
  { skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false },
  async () => {
    const candidate = makePaddleOcrOnnxCandidate(fixturesRoot);
    const manifest = JSON.parse(readFileSync(join(fixturesRoot, "manifest.json"), "utf8"));
    const report = await runBakeoff({
      candidates: [candidate],
      fixtures: manifest.fixtures,
      roleFilter: "smoke",
      fixturesRoot,
      timeout_ms: 60_000,
    });
    assert.equal(report.role_filter, "smoke");
    assert.equal(report.verdict_ready, false);
    assert.equal(report.observations.length, 1);
    const obs = report.observations[0];
    assert.equal(obs.outcome, "success", `real PaddleOCR-ONNX run failed: ${JSON.stringify(obs)}`);
    if (obs.outcome === "success") {
      assert.equal(obs.run_kind, "cold");
      assert.ok(obs.peak_rss_bytes > 0);
      // Cold load is meaningful (>0) for PaddleOCR-ONNX, unlike Tesseract.
      assert.ok(obs.cold_model_load_ms > 0, `expected cold_model_load_ms > 0; got ${obs.cold_model_load_ms}`);
      assert.ok(obs.per_page_inference_ms > 0, `expected per_page_inference_ms > 0; got ${obs.per_page_inference_ms}`);
    }
    const score = report.cer_scores[0];
    assert.ok(score, "expected a CER score");
    assert.equal(score.cer, 0, `PaddleOCR-ONNX CER on the smoke fixture must be exactly 0; got ${score.cer}`);
  },
);
