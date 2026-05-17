// Tesseract harness tests. Two test layers:
//
//   ALWAYS-ON  — exercise the harness's orchestration, parser, and
//                failure taxonomy via fake-binary subprocesses. These
//                run on any host without Tesseract installed.
//
//   OPT-IN     — gated on `OCR_REAL_TESSERACT_TESTS=1`. Requires a real
//                Tesseract installation + the language packs the
//                harness expects. Fails LOUDLY if the env is set but
//                the engine is absent — the runner does NOT silently
//                skip when explicitly requested.
//
// The always-on layer is the actual safety net here. The opt-in layer
// validates the host once when the dev runs it locally.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

import { makeTesseractCandidate } from "../dist/harnesses/tesseract.js";
import { parseMaxRssBytesFromTimeL } from "../dist/harnesses/tesseract.js";
import { runBakeoff } from "../dist/runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const fixturesRoot = join(pkgRoot, "fixtures");

const REAL_ENV_KEY = "OCR_REAL_TESSERACT_TESTS";
const realTestsRequested = process.env[REAL_ENV_KEY] === "1";

// ---------------------------------------------------------------------------
// Fake-binary helpers
//
// Each "fake" is a tiny shell script that writes specific stdout/stderr
// and exits with a given code. Living on disk inside a per-test tmpdir
// so the harness's spawn() sees a real executable.
// ---------------------------------------------------------------------------

function makeFakeBin(contents) {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-fake-"));
  const path = join(dir, "tesseract");
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
  return path;
}

// A fake `/usr/bin/time -l <cmd...>` that runs `<cmd...>` and prints a
// known macOS-style time line to stderr. Used so the harness can rely on
// the RSS parser when the host's /usr/bin/time may or may not exist
// (mostly: when we want to control the RSS bytes deterministically).
function makeFakeTimeBin() {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-time-"));
  const path = join(dir, "time");
  // Exec the wrapped command; after it exits, emit a fake time -l line.
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
// RSS parser
// ---------------------------------------------------------------------------

test("parseMaxRssBytesFromTimeL: valid macOS stderr → bytes", () => {
  const stderr = "       0.05 real         0.02 user         0.02 sys\n             1474560  maximum resident set size\n";
  assert.equal(parseMaxRssBytesFromTimeL(stderr), 1474560);
});

test("parseMaxRssBytesFromTimeL: stderr without RSS line → null", () => {
  assert.equal(parseMaxRssBytesFromTimeL("some random stderr text"), null);
});

test("parseMaxRssBytesFromTimeL: malformed numeric → null", () => {
  assert.equal(parseMaxRssBytesFromTimeL("           NOTANUMBER  maximum resident set size"), null);
});

test("parseMaxRssBytesFromTimeL: interleaved Tesseract + time output → bytes from time line", () => {
  const stderr = [
    "Tesseract Open Source OCR Engine v5.5.2",
    "Some diagnostic message",
    "             1474560  maximum resident set size",
    "Trailing line",
  ].join("\n");
  assert.equal(parseMaxRssBytesFromTimeL(stderr), 1474560);
});

// ---------------------------------------------------------------------------
// Probe matrix (always-on, fake binaries)
// ---------------------------------------------------------------------------

test("probe: missing binary (ENOENT) → missing_dependency with remediation", async () => {
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: "/nonexistent/path/to/tesseract",
  });
  const result = await candidate.probe();
  assert.equal(result.status, "missing_dependency");
  if (result.status === "missing_dependency") {
    assert.equal(result.dependency, "/nonexistent/path/to/tesseract");
    assert.match(result.remediation, /brew install tesseract|binary_path/);
  }
});

test("probe: wrong version → bad_version", async () => {
  // Fake binary that reports 4.0.0 instead of the pinned 5.5.2.
  const fake = makeFakeBin("#!/bin/sh\necho 'tesseract 4.0.0'\nexit 0\n");
  const candidate = makeTesseractCandidate(fixturesRoot, { binary_path: fake });
  const result = await candidate.probe();
  assert.equal(result.status, "bad_version");
  if (result.status === "bad_version") {
    assert.equal(result.resolved_version, "4.0.0");
    assert.equal(result.required_version, "5.5.2");
  }
});

test("probe: missing language → missing_model", async () => {
  // Fake binary: --version returns 5.5.2, --list-langs returns only "eng".
  const fake = makeFakeBin([
    "#!/bin/sh",
    'case "$1" in',
    "  --version) echo 'tesseract 5.5.2'; exit 0;;",
    "  --list-langs) echo 'List of available languages (1):'; echo 'eng'; exit 0;;",
    "  *) exit 1;;",
    "esac",
  ].join("\n"));
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: fake,
    required_languages: ["eng", "chi_sim"],
  });
  const result = await candidate.probe();
  assert.equal(result.status, "missing_model");
  if (result.status === "missing_model") {
    assert.equal(result.model, "chi_sim.traineddata");
    assert.match(result.remediation, /tesseract-lang/);
  }
});

test("probe: unparseable version → probe_failed", async () => {
  const fake = makeFakeBin("#!/bin/sh\necho 'garbage line'\nexit 0\n");
  const candidate = makeTesseractCandidate(fixturesRoot, { binary_path: fake });
  const result = await candidate.probe();
  assert.equal(result.status, "probe_failed");
});

// ---------------------------------------------------------------------------
// Run-kind capability
// ---------------------------------------------------------------------------

test("candidate advertises supported_run_kinds=['cold'] (Tesseract has no warm regime)", () => {
  const candidate = makeTesseractCandidate(fixturesRoot);
  assert.deepEqual([...candidate.supported_run_kinds], ["cold"]);
});

test("run: warm request returns unsupported_run_kind (no silent downgrade)", async () => {
  // Build a candidate; we won't actually spawn a real binary because run()
  // checks run_kind before spawning.
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: "/nonexistent",
  });
  const fakeFixture = {
    active: true,
    id: "stub",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "synthetic/does-not-exist.png",
    expected_text_path: "synthetic/does-not-exist.txt",
    sha256: "0".repeat(64),
    expected_text_sha256: "0".repeat(64),
    language: "eng",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: {
      render_command: "stub",
      font: "stub",
      point_size: 12,
      canvas: "10x10",
      source_text: "stub",
    },
  };
  const obs = await candidate.run(fakeFixture, { run_kind: "warm", timeout_ms: 1000 });
  assert.equal(obs.outcome, "failure");
  if (obs.outcome === "failure") {
    assert.equal(obs.code, "unsupported_run_kind");
  }
});

// ---------------------------------------------------------------------------
// License shape
// ---------------------------------------------------------------------------

test("license carries separate code/model evidence URLs", () => {
  const candidate = makeTesseractCandidate(fixturesRoot);
  assert.equal(candidate.license.code_license, "Apache-2.0");
  assert.equal(candidate.license.model_license, "Apache-2.0");
  assert.match(candidate.license.code_evidence_url, /tesseract-ocr\/tesseract.*LICENSE/);
  assert.match(candidate.license.model_evidence_url ?? "", /tessdata_fast.*4\.1\.0.*LICENSE/);
  assert.equal(candidate.license.redistribution, "permitted");
});

// ---------------------------------------------------------------------------
// Process-tree timeout cleanup (always-on, fake binary + child sleeper)
// ---------------------------------------------------------------------------

test("timeout kills the entire process group (parent + child sleeper)", async () => {
  // Fake "tesseract" that spawns a child sleeper and writes the child's
  // PID to a side-channel file. We'll trigger a timeout, then assert the
  // child PID is no longer alive.
  const sideDir = mkdtempSync(join(tmpdir(), "bakeoff-pgid-"));
  const pidFile = join(sideDir, "child.pid");
  const fakeTesseract = makeFakeBin([
    "#!/bin/sh",
    // Spawn a long sleeper as a child; record its PID first (so the
    // file exists even if our outer timeout fires very early), then
    // wait for it.
    "sleep 30 &",
    "child_pid=$!",
    'echo "$child_pid" > "' + pidFile + '"',
    "wait $child_pid",
  ].join("\n"));
  const fakeTime = makeFakeTimeBin();
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: fakeTesseract,
    time_binary: fakeTime,
  });

  const fakeFixture = {
    active: true,
    id: "pgid-test",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "synthetic/does-not-exist.png",
    expected_text_path: "synthetic/does-not-exist.txt",
    sha256: "0".repeat(64),
    expected_text_sha256: "0".repeat(64),
    language: "eng",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: {
      render_command: "stub",
      font: "stub",
      point_size: 12,
      canvas: "10x10",
      source_text: "stub",
    },
  };

  const start = Date.now();
  // 2000ms is well above shell startup but well below the 30s sleeper —
  // gives the fake script room to spawn its child + write the pid file
  // before our timeout fires.
  const obs = await candidate.run(fakeFixture, { run_kind: "cold", timeout_ms: 2000 });
  const elapsed = Date.now() - start;

  assert.equal(obs.outcome, "failure", `expected failure, got ${JSON.stringify(obs)}`);
  if (obs.outcome === "failure") {
    assert.equal(obs.code, "timeout", `expected timeout, got ${obs.code}`);
  }
  assert.ok(elapsed < 5000, `timeout cleanup took too long: ${elapsed}ms`);

  // Read the child sleeper's PID and assert it's no longer running.
  const childPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  assert.ok(Number.isFinite(childPid), `child PID must be readable: ${childPid}`);

  // Wait up to 2s for the kernel to reap the killed process.
  let alive = true;
  for (let i = 0; i < 20; i++) {
    try {
      // signal 0 = existence check, no signal sent.
      process.kill(childPid, 0);
    } catch {
      alive = false;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(alive, false, `child sleeper PID ${childPid} survived timeout cleanup`);
});

// ---------------------------------------------------------------------------
// Happy-path run with fake binaries (always-on)
// ---------------------------------------------------------------------------

test("run: happy path with fake binary + fake time → success observation", async () => {
  // Fake tesseract that prints "stub transcript\n" to stdout. The fake
  // time wrapper supplies the RSS line.
  const fakeTesseract = makeFakeBin([
    "#!/bin/sh",
    'case "$1" in',
    "  --version) echo 'tesseract 5.5.2'; exit 0;;",
    "  --list-langs) echo 'List of available languages (1):'; echo 'eng'; exit 0;;",
    "  *)",
    "    # Tesseract invoked as: tesseract <image> stdout -l <lang>",
    "    echo 'stub transcript'",
    "    exit 0",
    "    ;;",
    "esac",
  ].join("\n"));
  const fakeTime = makeFakeTimeBin();
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: fakeTesseract,
    time_binary: fakeTime,
  });

  const fixture = {
    active: true,
    id: "fake-happy",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "synthetic/01-hello-bakeoff.png", // any existing file
    expected_text_path: "synthetic/01-hello-bakeoff.txt",
    sha256: "0".repeat(64),
    expected_text_sha256: "0".repeat(64),
    language: "eng",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: {
      render_command: "stub",
      font: "stub",
      point_size: 12,
      canvas: "10x10",
      source_text: "stub transcript",
    },
  };

  const obs = await candidate.run(fixture, { run_kind: "cold", timeout_ms: 5000 });
  assert.equal(obs.outcome, "success", `expected success, got ${JSON.stringify(obs)}`);
  if (obs.outcome === "success") {
    assert.equal(obs.transcript, "stub transcript\n");
    assert.equal(obs.engine_version, "5.5.2");
    assert.equal(obs.run_kind, "cold");
    assert.equal(obs.cold_model_load_ms, 0);
    assert.equal(obs.peak_rss_bytes, 1474560);
    assert.ok(obs.latency_ms >= 0);
    assert.equal(obs.per_page_inference_ms, obs.latency_ms);
  }
});

// ---------------------------------------------------------------------------
// Real Tesseract integration (opt-in via OCR_REAL_TESSERACT_TESTS=1)
//
// Runs the entire pipeline against the installed Tesseract binary and the
// committed canonical fixture. FAILS LOUDLY if the env is set but the
// engine is absent — no silent skip when explicitly requested.
// ---------------------------------------------------------------------------

test("REAL: probe returns `available` on this host", { skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false }, async () => {
  const candidate = makeTesseractCandidate(fixturesRoot);
  const probe = await candidate.probe();
  assert.equal(
    probe.status,
    "available",
    `Real Tesseract probe expected 'available' but returned ${JSON.stringify(probe)}`,
  );
});

test("REAL: runBakeoff on the smoke fixture yields CER < 0.10", { skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false }, async () => {
  const candidate = makeTesseractCandidate(fixturesRoot);
  const manifest = JSON.parse(readFileSync(join(fixturesRoot, "manifest.json"), "utf8"));
  const report = await runBakeoff({
    candidates: [candidate],
    fixtures: manifest.fixtures,
    roleFilter: "smoke",
    fixturesRoot,
  });
  assert.equal(report.role_filter, "smoke");
  assert.equal(report.verdict_ready, false, "smoke run must NEVER be verdict_ready");
  assert.equal(report.observations.length, 1, "expected one observation against the 01-hello-bakeoff fixture");
  const obs = report.observations[0];
  assert.equal(obs.outcome, "success", `real Tesseract run failed: ${JSON.stringify(obs)}`);
  if (obs.outcome === "success") {
    assert.equal(obs.run_kind, "cold");
    assert.ok(obs.peak_rss_bytes > 0, "RSS must be measured");
  }
  const score = report.cer_scores[0];
  assert.ok(score, "expected a CER score");
  assert.ok(score.cer < 0.10, `real Tesseract CER ${score.cer} exceeds 0.10 threshold`);
});

test("REAL: smoke roleFilter does NOT count toward verdict_ready even when successful", { skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false }, async () => {
  const candidate = makeTesseractCandidate(fixturesRoot);
  const manifest = JSON.parse(readFileSync(join(fixturesRoot, "manifest.json"), "utf8"));
  // Run with role=verdict; smoke fixtures are excluded → fixtures_scored=0.
  const verdictReport = await runBakeoff({
    candidates: [candidate],
    fixtures: manifest.fixtures,
    roleFilter: "verdict",
    fixturesRoot,
  });
  assert.equal(verdictReport.role_filter, "verdict");
  assert.equal(verdictReport.fixtures_scored, 0, "no verdict fixtures exist in β; smoke must NOT leak in");
  assert.equal(verdictReport.verdict_ready, false);
});
