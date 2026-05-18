// Tesseract harness tests. Two test layers:
//
//   ALWAYS-ON  — exercise the harness's orchestration, parser, and
//                failure taxonomy via fake-binary subprocesses. These
//                run on any POSIX host without Tesseract installed.
//
// POSIX-only (audit 019e3854 D8.1):
//   The always-on layer writes shell scripts (`#!/bin/sh`) and chmods
//   them executable, then spawns them. That depends on `/bin/sh`,
//   `chmod`, and the spawn-an-arbitrary-file-with-shebang behavior of
//   POSIX. Windows lacks the shebang resolution path; this suite is not
//   expected to pass there. When/if the bakeoff package needs Windows
//   support, rewrite the fakes as Node helper scripts spawned via
//   `process.execPath`.
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
import { parseMaxRssBytesFromTimeL, resolveTesseractLang } from "../dist/harnesses/tesseract.js";
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

test("probe: missing language → missing_model (BCP-47 tag resolves to absent engine model)", async () => {
  // Fake binary: --version returns 5.5.2, --list-langs returns only "eng".
  // Harness is asked for ["eng", "zh-Hans"]; resolveTesseractLang maps
  // zh-Hans → chi_sim, which is absent → missing_model on chi_sim.
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
    required_languages: ["eng", "zh-Hans"],
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
// Language mapping (BCP-47 → Tesseract engine lang) — audit 019e36a0 D3.4
// ---------------------------------------------------------------------------

test("resolveTesseractLang: known BCP-47 tags resolve to Tesseract engine names", () => {
  assert.equal(resolveTesseractLang("eng"), "eng");
  assert.equal(resolveTesseractLang("en"), "eng");
  assert.equal(resolveTesseractLang("en-US"), "eng");
  assert.equal(resolveTesseractLang("zh-Hans"), "chi_sim");
  assert.equal(resolveTesseractLang("zh-CN"), "chi_sim");
  assert.equal(resolveTesseractLang("zh"), "chi_sim");
  assert.equal(resolveTesseractLang("zh-Hant"), "chi_tra");
  assert.equal(resolveTesseractLang("zh-TW"), "chi_tra");
  assert.equal(resolveTesseractLang("ja"), "jpn");
  assert.equal(resolveTesseractLang("ko"), "kor");
});

test("resolveTesseractLang: unknown tags return null (no silent passthrough)", () => {
  assert.equal(resolveTesseractLang("fr"), null);
  assert.equal(resolveTesseractLang("de"), null);
  assert.equal(resolveTesseractLang(""), null);
  // The raw BCP-47 tag "zh-Hans" is mapped; the engine name "chi_sim"
  // is NOT a BCP-47 tag and should not round-trip through this map.
  assert.equal(resolveTesseractLang("chi_sim"), null);
});

test("resolveTesseractLang: non-canonical casing resolves correctly (RFC 5646 case-insensitive)", () => {
  // Audit 019e3854 F2: BCP-47 §2.1.1 declares tags case-insensitive;
  // canonical casing is RECOMMENDED for presentation, not for matching.
  assert.equal(resolveTesseractLang("ZH-HANS"), "chi_sim");
  assert.equal(resolveTesseractLang("zh-hans"), "chi_sim");
  assert.equal(resolveTesseractLang("Zh-HaNs"), "chi_sim");
  assert.equal(resolveTesseractLang("EN-US"), "eng");
  assert.equal(resolveTesseractLang("en-us"), "eng");
  assert.equal(resolveTesseractLang("zh-tw"), "chi_tra");
  assert.equal(resolveTesseractLang("ZH-Hant-TW"), "chi_tra");
});

test("probe: required BCP-47 tag with no Tesseract mapping → missing_model unmapped", async () => {
  // Fake binary with only eng installed.
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
    required_languages: ["fr"], // not in TAG_TO_TESS_LANG
  });
  const result = await candidate.probe();
  assert.equal(result.status, "missing_model");
  if (result.status === "missing_model") {
    assert.match(result.model, /^<unmapped:fr>$/);
    assert.match(result.remediation, /TAG_TO_TESS_LANG/);
  }
});

test("probe: BCP-47 zh-Hans against eng-only binary → missing_model chi_sim.traineddata", async () => {
  // Fake binary that lists ONLY eng — the harness should resolve
  // zh-Hans → chi_sim, find chi_sim absent, and report missing_model
  // for the engine model name (not the raw tag).
  const fake = makeFakeBin([
    "#!/bin/sh",
    'case "$1" in',
    "  --version) echo 'tesseract 5.5.2'; exit 0;;",
    "  --list-langs)",
    "    # Include the header line that real Tesseract emits;",
    "    # the parser must NOT treat it as a language.",
    "    echo 'List of available languages (1):'",
    "    echo 'eng'",
    "    exit 0",
    "    ;;",
    "  *) exit 1;;",
    "esac",
  ].join("\n"));
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: fake,
    required_languages: ["zh-Hans"],
  });
  const result = await candidate.probe();
  assert.equal(result.status, "missing_model");
  if (result.status === "missing_model") {
    assert.equal(result.model, "chi_sim.traineddata");
    assert.match(result.remediation, /tesseract-lang/);
    // Remediation should mention the original tag so operators trace it back.
    assert.match(result.remediation, /zh-Hans/);
  }
});

test("probe: header line 'List of available languages...' is NOT treated as a language", async () => {
  // Fake binary that emits ONLY the header line, no actual languages.
  // The parser used to admit the header as a language identifier; with
  // the regex filter it should not.
  const fake = makeFakeBin([
    "#!/bin/sh",
    'case "$1" in',
    "  --version) echo 'tesseract 5.5.2'; exit 0;;",
    "  --list-langs) echo 'List of available languages (0):'; exit 0;;",
    "  *) exit 1;;",
    "esac",
  ].join("\n"));
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: fake,
    required_languages: ["eng"],
  });
  const result = await candidate.probe();
  // eng should be missing — the header line must NOT count as "eng".
  assert.equal(result.status, "missing_model");
  if (result.status === "missing_model") {
    assert.equal(result.model, "eng.traineddata");
  }
});

test("run: fixture with unmapped language tag → unsupported_language_tag failure", async () => {
  // Use a real-fixture-shaped object so the active branch is exercised.
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: "/nonexistent", // run() returns before reaching spawn
  });
  const fakeFixture = {
    active: true,
    id: "unmapped-lang",
    role: "smoke",
    kind: "real",
    category: "test",
    path: "synthetic/01-hello-bakeoff.png",
    expected_text_path: "synthetic/01-hello-bakeoff.txt",
    sha256: "0".repeat(64),
    expected_text_sha256: "0".repeat(64),
    language: "fr", // no TAG_TO_TESS_LANG entry
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    real_source: "in-test",
    pii_review: "not_required",
  };
  const obs = await candidate.run(fakeFixture, { run_kind: "cold", timeout_ms: 5000 });
  assert.equal(obs.outcome, "failure");
  if (obs.outcome === "failure") {
    assert.equal(obs.code, "unsupported_language_tag");
    assert.match(obs.message, /fr/);
  }
});

test("run: fixture with zh-Hans invokes Tesseract with `-l chi_sim`", async () => {
  // Fake binary that records its argv to a side-channel file so we can
  // assert exactly what the harness passed.
  const argFile = join(mkdtempSync(join(tmpdir(), "bakeoff-args-")), "argv.txt");
  const fakeTesseract = makeFakeBin([
    "#!/bin/sh",
    'case "$1" in',
    "  --version) echo 'tesseract 5.5.2'; exit 0;;",
    "  --list-langs) echo 'List of available languages (2):'; echo 'eng'; echo 'chi_sim'; exit 0;;",
    "  *)",
    '    echo "$@" > "' + argFile + '"',
    "    echo '你好'", // pretend transcript
    "    exit 0",
    "    ;;",
    "esac",
  ].join("\n"));
  const fakeTime = makeFakeTimeBin();
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: fakeTesseract,
    time_binary: fakeTime,
  });
  const fakeFixture = {
    active: true,
    id: "zh-fixture",
    role: "smoke",
    kind: "synthetic",
    category: "printed-chinese",
    path: "synthetic/01-hello-bakeoff.png", // any existing file
    expected_text_path: "synthetic/01-hello-bakeoff.txt",
    sha256: "0".repeat(64),
    expected_text_sha256: "0".repeat(64),
    language: "zh-Hans",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: {
      render_command: "stub",
      font: "stub",
      point_size: 12,
      canvas: "10x10",
      source_text: "你好",
    },
  };
  const obs = await candidate.run(fakeFixture, { run_kind: "cold", timeout_ms: 5000 });
  assert.equal(obs.outcome, "success", `expected success, got ${JSON.stringify(obs)}`);
  // The recorded argv must contain `-l chi_sim`, not `-l zh-Hans`.
  const recordedArgv = readFileSync(argFile, "utf8").trim();
  assert.match(recordedArgv, /-l chi_sim\b/, `harness must pass -l chi_sim, got argv: ${recordedArgv}`);
  assert.doesNotMatch(recordedArgv, /-l zh-Hans/, "harness must NOT pass raw BCP-47 tag to Tesseract");
});

// ---------------------------------------------------------------------------
// Real Tesseract integration (opt-in via OCR_REAL_TESSERACT_TESTS=1)
//
// Runs the entire pipeline against the installed Tesseract binary and the
// committed canonical fixture. FAILS LOUDLY if the env is set but the
// engine is absent — no silent skip when explicitly requested.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Audit 019e3854 R1: probe timeout terminal — a partially-chatty hung
// probe must NOT be parsed as a healthy result.
// ---------------------------------------------------------------------------

test("probe: --version hangs after emitting valid output → probe_failed (timeout terminal)", async () => {
  // Fake binary that prints a valid version line, then sleeps far longer
  // than the probe timeout. The harness must NOT parse the captured
  // stdout as a successful probe.
  const fake = makeFakeBin([
    "#!/bin/sh",
    'case "$1" in',
    "  --version) echo 'tesseract 5.5.2'; sleep 60; exit 0;;",
    "  *) exit 1;;",
    "esac",
  ].join("\n"));
  // The harness's captureCommand uses a 5s default timeout; this test
  // would normally take 5s. Skip when the host's `sh`/`sleep` are
  // unusable — but at least pin the contract.
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: fake,
  });
  const result = await candidate.probe();
  assert.equal(result.status, "probe_failed");
  if (result.status === "probe_failed") {
    assert.match(result.error_message, /timed out/);
  }
}, { timeout: 15_000 });

test("probe: --list-langs hangs → probe_failed (not silently accepted as healthy)", async () => {
  const fake = makeFakeBin([
    "#!/bin/sh",
    'case "$1" in',
    "  --version) echo 'tesseract 5.5.2'; exit 0;;",
    "  --list-langs) echo 'List of available languages (1):'; echo 'eng'; sleep 60; exit 0;;",
    "  *) exit 1;;",
    "esac",
  ].join("\n"));
  const candidate = makeTesseractCandidate(fixturesRoot, {
    binary_path: fake,
  });
  const result = await candidate.probe();
  assert.equal(result.status, "probe_failed");
  if (result.status === "probe_failed") {
    assert.match(result.error_message, /list-langs.*timed out/);
  }
}, { timeout: 15_000 });

// ---------------------------------------------------------------------------
// Audit 019e3854 R2: hash-gate I/O failures become structured observations
// instead of throwing out of runBakeoff.
// ---------------------------------------------------------------------------

test("runner: missing image file → fixture_unreadable observation (not a thrown error)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-missing-img-"));
  // Create only the expected-text file; the image is intentionally absent.
  writeFileSync(join(dir, "img.txt"), Buffer.from("expected"));

  // Use a stub candidate that should never be reached because the hash
  // gate fails first.
  const stubCandidate = {
    name: "stub",
    version_pinned: "0.0.0",
    license: {
      code_license: "Apache-2.0",
      model_license: null,
      redistribution: "permitted",
      code_evidence_url: "https://example.invalid/code",
      model_evidence_url: null,
      last_verified_at: "2026-01-01",
    },
    supported_run_kinds: ["cold"],
    async probe() { return { status: "available", resolved_version: "0.0.0" }; },
    async run() {
      throw new Error("stub.run must never be invoked when the hash gate fails first");
    },
    async dispose() {},
  };

  const fixtures = [{
    active: true,
    id: "missing-img",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "absent.png", // missing on disk
    expected_text_path: "img.txt",
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
  }];

  const report = await runBakeoff({
    candidates: [stubCandidate],
    fixtures,
    roleFilter: "smoke",
    fixturesRoot: dir,
  });
  // Runner did not throw; emitted one structured failure.
  assert.equal(report.observations.length, 1);
  const obs = report.observations[0];
  assert.equal(obs.outcome, "failure");
  if (obs.outcome === "failure") {
    assert.equal(obs.code, "fixture_unreadable");
    assert.match(obs.message, /image.*absent\.png.*could not be read/);
  }
});

test("runner: missing expected-text file → fixture_unreadable observation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-missing-txt-"));
  // Create only the image file; the expected-text is intentionally absent.
  const imgBytes = Buffer.from("synthetic image bytes");
  writeFileSync(join(dir, "img.png"), imgBytes);
  const imgSha = (await import("node:crypto")).createHash("sha256").update(imgBytes).digest("hex");

  const stubCandidate = {
    name: "stub",
    version_pinned: "0.0.0",
    license: {
      code_license: "Apache-2.0",
      model_license: null,
      redistribution: "permitted",
      code_evidence_url: "https://example.invalid/code",
      model_evidence_url: null,
      last_verified_at: "2026-01-01",
    },
    supported_run_kinds: ["cold"],
    async probe() { return { status: "available", resolved_version: "0.0.0" }; },
    async run() { throw new Error("must not run when txt is missing"); },
    async dispose() {},
  };

  const fixtures = [{
    active: true,
    id: "missing-txt",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "img.png",
    expected_text_path: "absent.txt",
    sha256: imgSha,
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
  }];

  const report = await runBakeoff({
    candidates: [stubCandidate],
    fixtures,
    roleFilter: "smoke",
    fixturesRoot: dir,
  });
  assert.equal(report.observations.length, 1);
  const obs = report.observations[0];
  assert.equal(obs.outcome, "failure");
  if (obs.outcome === "failure") {
    assert.equal(obs.code, "fixture_unreadable");
    assert.match(obs.message, /expected text.*absent\.txt.*could not be read/);
  }
});

test("runner: bytes drift triggers fixture_hash_drift, not fixture_unreadable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-drift-"));
  // Files exist, but their actual SHA-256 won't match the manifest.
  writeFileSync(join(dir, "img.png"), Buffer.from("actual bytes"));
  writeFileSync(join(dir, "img.txt"), Buffer.from("actual text"));

  const stubCandidate = {
    name: "stub",
    version_pinned: "0.0.0",
    license: {
      code_license: "Apache-2.0",
      model_license: null,
      redistribution: "permitted",
      code_evidence_url: "https://example.invalid/code",
      model_evidence_url: null,
      last_verified_at: "2026-01-01",
    },
    supported_run_kinds: ["cold"],
    async probe() { return { status: "available", resolved_version: "0.0.0" }; },
    async run() { throw new Error("must not run on hash drift"); },
    async dispose() {},
  };

  const fixtures = [{
    active: true,
    id: "drift",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "img.png",
    expected_text_path: "img.txt",
    sha256: "1".repeat(64), // deliberately wrong
    expected_text_sha256: "1".repeat(64),
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
  }];

  const report = await runBakeoff({
    candidates: [stubCandidate],
    fixtures,
    roleFilter: "smoke",
    fixturesRoot: dir,
  });
  assert.equal(report.observations.length, 1);
  const obs = report.observations[0];
  assert.equal(obs.outcome, "failure");
  if (obs.outcome === "failure") {
    assert.equal(obs.code, "fixture_hash_drift");
    assert.match(obs.message, /image sha256.*does not match/);
  }
});

test("REAL: probe returns `available` on this host", { skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false }, async () => {
  const candidate = makeTesseractCandidate(fixturesRoot);
  const probe = await candidate.probe();
  assert.equal(
    probe.status,
    "available",
    `Real Tesseract probe expected 'available' but returned ${JSON.stringify(probe)}`,
  );
});

test("REAL: runBakeoff on the smoke fixture yields CER === 0", { skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false }, async () => {
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
  // Tesseract reads the canonical "hello bakeoff" PNG verbatim — CER
  // should be 0. Tightened from <0.10 to ===0 per audit 019e3854 D7.5:
  // the prior loose threshold would have masked a one-character
  // regression on a tiny smoke string.
  assert.equal(score.cer, 0, `real Tesseract CER on the smoke fixture must be exactly 0; got ${score.cer}`);
});

test("REAL: smoke fixture is excluded from the verdict roleFilter scoring", { skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false }, async () => {
  const candidate = makeTesseractCandidate(fixturesRoot);
  const manifest = JSON.parse(readFileSync(join(fixturesRoot, "manifest.json"), "utf8"));
  // Run with role=verdict. The 5 zh-* Chinese verdict fixtures are
  // present; the 01-hello-bakeoff smoke fixture MUST NOT leak into the
  // verdict report's scored set.
  const verdictReport = await runBakeoff({
    candidates: [candidate],
    fixtures: manifest.fixtures,
    roleFilter: "verdict",
    fixturesRoot,
  });
  assert.equal(verdictReport.role_filter, "verdict");
  // Manifest currently has 5 verdict-role active fixtures (all zh-Hans).
  const verdictFixtureIds = manifest.fixtures
    .filter((f) => f.active === true && f.role === "verdict")
    .map((f) => f.id);
  assert.equal(verdictReport.fixtures_scored, verdictFixtureIds.length);
  // No observation may carry the smoke fixture's id.
  assert.ok(
    !verdictReport.observations.some((o) => o.fixture_id === "01-hello-bakeoff"),
    "smoke fixture must NOT appear in verdict observations",
  );
  // Tesseract on zh-Hans without chi_sim → probe_missing_model failures
  // for every verdict fixture; verdict_ready remains false because no
  // CER score is computable.
  assert.equal(verdictReport.verdict_ready, false);
});
