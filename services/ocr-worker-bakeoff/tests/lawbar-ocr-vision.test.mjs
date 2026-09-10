// lawbar-ocr-vision harness tests (R3, WI-12 step 3).
//
// Two layers, as for the other harnesses. ALWAYS-ON: fake helpers — POSIX shell scripts that speak
// the helper's one-line JSON protocol — injected through `binary_path`, pinned to their own bytes,
// and a fake `time -l`. They run with an EMPTY PATH, exactly as the real helper does, so they use
// only builtins and absolute paths. OPT-IN (`OCR_REAL_LAWBAR_OCR_TESTS=1`): the real helper,
// resolved the way the bin resolves it (packaged bundle, then staged build, or LAWBAR_OCR_HELPER)
// and pinned by the desktop build, scored on the Chinese heading fixture. Fails LOUDLY if requested
// and absent — a requested real run never silently skips.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  makeLawbarOcrVisionCandidate,
  parseMaxRssBytesFromTimeL,
  readDesktopPin,
  resolveHelperLocation,
  resolveVisionLang,
  sha256OfFile,
} from "../dist/harnesses/lawbar-ocr-vision.js";
import { runBakeoff } from "../dist/runner.js";
import { loadManifest } from "../dist/manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const fixturesRoot = join(pkgRoot, "fixtures");

const REAL_ENV_KEY = "OCR_REAL_LAWBAR_OCR_TESTS";
const realTestsRequested = process.env[REAL_ENV_KEY] === "1";

// ---------------------------------------------------------------------------
// Fakes (POSIX)
// ---------------------------------------------------------------------------

const PROBE_TAIL = '"helper_version":"0.2.0","os_version":"0","os_build":"0F0","arch":"fake","vision_languages":["zh-Hans","en-US"]';

/**
 * A fake helper. `probe` answers with its OWN digest (read from a sidecar written after the file
 * exists) unless `claimedDigest` is given; `extract` prints `pageLine` with %DIGEST% substituted,
 * or runs `extractBody` when given.
 */
function makeFakeHelper({ pageLine = "", claimedDigest = null, extractBody = null, probeBody = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-lawbar-ocr-"));
  const path = join(dir, "lawbar-ocr");
  const digestArg = claimedDigest === null ? '"$d"' : `"${claimedDigest}"`;
  const probe = probeBody ?? `printf '{"kind":"probe","helper_build_digest":"%s",${PROBE_TAIL}}\\n' ${digestArg}`;
  const extract = extractBody ?? `printf '%s\\n' "$(printf '%s' '${pageLine.replace(/'/g, "'\\''")}' | /usr/bin/sed "s/%DIGEST%/$d/")"`;
  writeFileSync(path, [
    "#!/bin/sh",
    'read d < "$0.digest"',
    'if [ "$1" = "probe" ]; then',
    `  ${probe}`,
    "  exit 0",
    "fi",
    'if [ "$1" = "extract" ]; then',
    `  ${extract}`,
    "  exit 0",
    "fi",
    "exit 2",
  ].join("\n"));
  chmodSync(path, 0o755);
  writeFileSync(`${path}.digest`, `${sha256OfFile(path)}\n`);
  return { path, dir };
}

function pageRecord(overrides = {}) {
  return JSON.stringify({
    kind: "page", mode: "full", page: 1, page_count: 1, source: "image", layer_text: null, layer_chars: 0, layer_ms: null,
    render_width: 800, render_height: 80, render_digest: "0".repeat(64),
    vision_lines: [{ text: "上海市浦东新区人民法院", confidence: 1, x: 0.2, y: 0.2, w: 0.6, h: 0.6 }],
    vision_text: "上海市浦东新区人民法院", vision_ms: 45, render_ms: 3,
    helper_build_digest: "%DIGEST%", error: null,
    ...overrides,
  });
}

function makeFakeTimeBin() {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-lawbar-time-"));
  const path = join(dir, "time");
  writeFileSync(path, [
    "#!/bin/sh",
    "shift",
    '"$@"',
    "rc=$?",
    'echo "             1474560  maximum resident set size" >&2',
    "exit $rc",
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

/** Options for a fake: pinned to its own bytes, fake time, the fixture languages. */
function optsFor(fake, extra = {}) {
  return { binary_path: fake.path, pinned_digest: sha256OfFile(fake.path), time_binary: makeFakeTimeBin(), required_languages: ["zh-Hans"], ...extra };
}

const manifest = loadManifest(fixturesRoot);
const zh02 = manifest.fixtures.find((f) => f.id === "zh-02-court-heading");
assert.ok(zh02, "zh-02-court-heading fixture must exist");
const zh02Expected = readFileSync(join(fixturesRoot, zh02.expected_text_path), "utf8");

const COLD = { run_kind: "cold", timeout_ms: 10_000 };

// ---------------------------------------------------------------------------
// Language mapping, resolution, pin reading
// ---------------------------------------------------------------------------

test("resolveVisionLang: fixture tags map to Vision languages; unknown tags are null", () => {
  assert.equal(resolveVisionLang("eng"), "en-US");
  assert.equal(resolveVisionLang("en-US"), "en-US");
  assert.equal(resolveVisionLang("zh-Hans"), "zh-Hans");
  assert.equal(resolveVisionLang("ZH-HANS"), "zh-Hans");
  assert.equal(resolveVisionLang("chi_sim"), "zh-Hans");
  assert.equal(resolveVisionLang("zh-Hant"), "zh-Hant");
  assert.equal(resolveVisionLang("jpn"), null);
  assert.equal(resolveVisionLang(""), null);
});

test("resolveHelperLocation: LAWBAR_OCR_HELPER wins outright, even when it does not exist (a missing explicit path is reported, not replaced)", () => {
  const r = resolveHelperLocation({ LAWBAR_OCR_HELPER: "/nope/lawbar-ocr" });
  assert.deepEqual(r, { path: "/nope/lawbar-ocr", source: "env" });
  const unset = resolveHelperLocation({});
  if (unset !== null) {
    assert.ok(["packaged", "staged"].includes(unset.source), `unexpected source ${unset.source}`);
    assert.ok(existsSync(unset.path));
  }
});

test("readDesktopPin: a well-formed pin is read; missing or malformed is null", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-pin-"));
  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify({ sha256: "a".repeat(64) }));
  assert.equal(readDesktopPin(good), "a".repeat(64));
  assert.equal(readDesktopPin(join(dir, "absent.json")), null);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ sha256: "nope" }));
  assert.equal(readDesktopPin(bad), null);
});

test("parseMaxRssBytesFromTimeL parses the BSD time -l line", () => {
  assert.equal(parseMaxRssBytesFromTimeL("   1474560  maximum resident set size\n"), 1474560);
  assert.equal(parseMaxRssBytesFromTimeL("nothing here"), null);
});

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

test("probe: an honest, pinned fake helper is available, and the resolved version carries its digest", async () => {
  const fake = makeFakeHelper();
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake, { required_languages: ["zh-Hans", "eng"] }));
  const p = await c.probe();
  assert.equal(p.status, "available", JSON.stringify(p));
  assert.equal(p.resolved_version, `0.2.0+sha256.${sha256OfFile(fake.path).slice(0, 12)}`);
  assert.match(p.detail, /helper=option:/);
  assert.match(p.detail, /os_build=0F0/);
});

test("probe: a helper that is not the pinned bytes is bad_version and is NEVER RUN", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-ran-"));
  const ran = join(dir, "ran");
  const fake = makeFakeHelper({ probeBody: `: > "${ran}"; printf '{"kind":"probe","helper_build_digest":"%s",${PROBE_TAIL}}\\n' "$d"` });
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake, { pinned_digest: "c".repeat(64) }));
  const p = await c.probe();
  assert.equal(p.status, "bad_version", JSON.stringify(p));
  assert.equal(p.required_version, `sha256:${"c".repeat(64)}`);
  assert.equal(existsSync(ran), false, "a helper that is not the pin must not be executed");
  // Explicitly unpinned: it runs.
  const c2 = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake, { pinned_digest: null }));
  assert.equal((await c2.probe()).status, "available");
  assert.equal(existsSync(ran), true);
});

test("probe: a helper reporting a version other than the pinned one is bad_version", async () => {
  const fake = makeFakeHelper({ probeBody: `printf '{"kind":"probe","helper_build_digest":"%s","helper_version":"9.9.9","os_version":"0","os_build":"0F0","arch":"fake","vision_languages":["zh-Hans"]}\\n' "$d"` });
  const p = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake)).probe();
  assert.equal(p.status, "bad_version");
  assert.equal(p.required_version, "0.2.0");
  assert.equal(p.resolved_version, "9.9.9");
});

test("probe: a helper whose self-report is not the executed file's digest is probe_failed", async () => {
  const fake = makeFakeHelper({ claimedDigest: "a".repeat(64) });
  const p = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake)).probe();
  assert.equal(p.status, "probe_failed");
  assert.match(p.error_message, /identity mismatch/);
});

test("probe: a missing helper is missing_dependency with a build remediation; an unmapped tag is missing_model", async () => {
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, { binary_path: "/definitely/not/here", pinned_digest: null, required_languages: ["zh-Hans"] });
  const p = await c.probe();
  assert.equal(p.status, "missing_dependency");
  assert.match(p.remediation, /build:helper|LAWBAR_OCR_HELPER/);

  const fake = makeFakeHelper();
  const p2 = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake, { required_languages: ["jpn"] })).probe();
  assert.equal(p2.status, "missing_model");
  assert.equal(p2.model, "<unmapped:jpn>");
});

test("probe: a language this macOS build's Vision does not offer is missing_model, naming the OS build", async () => {
  const fake = makeFakeHelper({ probeBody: `printf '{"kind":"probe","helper_build_digest":"%s","helper_version":"0.2.0","os_version":"0","os_build":"0F0","arch":"fake","vision_languages":["en-US"]}\\n' "$d"` });
  const p = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake)).probe();
  assert.equal(p.status, "missing_model");
  assert.equal(p.model, "zh-Hans");
  assert.match(p.expected_path, /0F0/);
});

test("probe: output that is not one probe record is probe_failed; an execute-only helper cannot be hashed and is probe_failed, not a throw", async () => {
  const fake = makeFakeHelper({ probeBody: "printf 'hello\\n'" });
  const p = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake)).probe();
  assert.equal(p.status, "probe_failed");
  assert.match(p.error_message, /not JSON/);

  if (process.getuid?.() !== 0) {
    const execOnly = makeFakeHelper();
    chmodSync(execOnly.path, 0o111);
    const p2 = await makeLawbarOcrVisionCandidate(fixturesRoot, { binary_path: execOnly.path, pinned_digest: null, required_languages: ["zh-Hans"] }).probe();
    assert.equal(p2.status, "probe_failed");
    assert.match(p2.error_message, /could not hash/);
  }
});

test("probe: a helper whose probe hangs and ignores SIGTERM is probe_failed within the probe deadline, with no survivor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-probe-hang-"));
  const childPidFile = join(dir, "child.pid");
  const fake = makeFakeHelper({ probeBody: `trap '' TERM; /bin/sleep 30 & echo $! > "${childPidFile}"; wait` });
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake, { probe_timeout_ms: 2000 }));
  const t0 = Date.now();
  const p = await c.probe();
  const took = Date.now() - t0;
  assert.equal(p.status, "probe_failed", JSON.stringify(p));
  assert.match(p.error_message, /exceeded 2000 ms/);
  assert.ok(took < 10_000, `probe deadline not enforced: ${took} ms`);
  assert.ok(existsSync(childPidFile), "the fake must have started its child before the deadline");
  const childPid = Number(readFileSync(childPidFile, "utf8").trim());
  let alive = true;
  try { process.kill(childPid, 0); } catch (e) { alive = e.code !== "ESRCH"; }
  assert.equal(alive, false, `SURVIVOR: child ${childPid} outlived the probe deadline`);
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

test("run: a page record becomes a success observation — vision_text is the transcript, vision_ms the inference, the rest the overhead", async () => {
  const fake = makeFakeHelper({ pageLine: pageRecord() });
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake));
  const o = await c.run(zh02, COLD);
  assert.equal(o.outcome, "success", JSON.stringify(o));
  assert.equal(o.transcript, "上海市浦东新区人民法院");
  assert.equal(o.per_page_inference_ms, 45);
  assert.equal(o.peak_rss_bytes, 1474560);
  assert.equal(o.run_kind, "cold");
  assert.equal(o.engine_version, `0.2.0+sha256.${sha256OfFile(fake.path).slice(0, 12)}`);
  assert.equal(o.cold_model_load_ms, Math.max(0, o.latency_ms - 45 - 3), "overhead is the wall clock minus the helper's two timings");
});

test("run: the helper runs with an EMPTY PATH (a helper that needs a tool on PATH finds nothing)", async () => {
  const fake = makeFakeHelper({ extractBody: `printf '{"kind":"page","page":1,"page_count":1,"mode":"full","source":"image","layer_chars":0,"render_width":1,"render_height":1,"render_digest":"x","vision_lines":[],"vision_text":"[%s]","vision_ms":1,"render_ms":0,"helper_build_digest":"%s"}\\n' "$PATH" "$d"` });
  const o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake)).run(zh02, COLD);
  assert.equal(o.outcome, "success", JSON.stringify(o));
  assert.equal(o.transcript, "[]");
});

test("run: a page record carrying another binary's digest is helper_identity_mismatch, never a transcript", async () => {
  const fake = makeFakeHelper({ pageLine: pageRecord({ helper_build_digest: "b".repeat(64) }) });
  const o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake)).run(zh02, COLD);
  assert.equal(o.outcome, "failure");
  assert.equal(o.code, "helper_identity_mismatch");
});

test("run: a fixture language Vision does not offer on this host is refused at run time too", async () => {
  const fake = makeFakeHelper({ pageLine: pageRecord(), probeBody: `printf '{"kind":"probe","helper_build_digest":"%s","helper_version":"0.2.0","os_version":"0","os_build":"0F0","arch":"fake","vision_languages":["en-US"]}\\n' "$d"` });
  const o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake, { required_languages: ["eng"] })).run(zh02, COLD);
  assert.equal(o.outcome, "failure");
  assert.equal(o.code, "vision_language_unavailable");
});

test("run: helper codes are an allowlist — known ones become fixed codes, anything else is helper_error with the value only in detail", async () => {
  const err = makeFakeHelper({ extractBody: `printf '{"kind":"error","code":"unreadable_input","detail":"no"}\\n'; exit 3` });
  let o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(err)).run(zh02, COLD);
  assert.equal(o.outcome, "failure");
  assert.equal(o.code, "helper_unreadable_input");

  const evil = makeFakeHelper({ extractBody: `printf '{"kind":"error","code":"/Clients/A.pdf: denied","detail":"x"}\\n'; exit 3` });
  o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(evil)).run(zh02, COLD);
  assert.equal(o.code, "helper_error", "a made-up code must never become an observation code");
  assert.match(o.detail, /unknown helper code/);

  const pageErr = makeFakeHelper({ pageLine: pageRecord({ error: "vision_failed", vision_text: "" }) });
  o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(pageErr)).run(zh02, COLD);
  assert.equal(o.code, "helper_vision_failed");

  const pageEvil = makeFakeHelper({ pageLine: pageRecord({ error: "../../secret", vision_text: "" }) });
  o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(pageEvil)).run(zh02, COLD);
  assert.equal(o.code, "helper_error");
  assert.match(o.detail, /unknown page error/);
});

test("run: two-line output and malformed timings are helper_output_unparseable, not zeroed measurements", async () => {
  const two = makeFakeHelper({ extractBody: `printf '%s\\n%s\\n' '{"kind":"page"}' '{"kind":"page"}'` });
  let o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(two)).run(zh02, COLD);
  assert.equal(o.code, "helper_output_unparseable");
  assert.match(o.message, /got 2/);

  const noTiming = makeFakeHelper({ pageLine: pageRecord({ vision_ms: "fast" }) });
  o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(noTiming)).run(zh02, COLD);
  assert.equal(o.code, "helper_output_unparseable");
  assert.match(o.message, /timings/);

  const negative = makeFakeHelper({ pageLine: pageRecord({ render_ms: -1 }) });
  o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(negative)).run(zh02, COLD);
  assert.equal(o.code, "helper_output_unparseable");
});

test("run: warm is refused as unsupported_run_kind; an unmapped fixture language is unsupported_language_tag", async () => {
  const fake = makeFakeHelper({ pageLine: pageRecord() });
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake));
  const warm = await c.run(zh02, { run_kind: "warm", timeout_ms: 1000 });
  assert.equal(warm.code, "unsupported_run_kind");
  const jpn = await c.run({ ...zh02, language: "jpn" }, COLD);
  assert.equal(jpn.code, "unsupported_language_tag");
});

test("run: a helper that ignores SIGTERM and leaves a child is killed as a process group at the deadline, with no survivor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-lawbar-hang-"));
  const childPidFile = join(dir, "child.pid");
  const fake = makeFakeHelper({ extractBody: `trap '' TERM; /bin/sleep 30 & echo $! > "${childPidFile}"; wait` });
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake));
  const t0 = Date.now();
  const o = await c.run(zh02, { run_kind: "cold", timeout_ms: 3000 });
  const took = Date.now() - t0;
  assert.equal(o.outcome, "failure");
  assert.equal(o.code, "timeout");
  assert.ok(took < 10_000, `deadline not enforced: ${took} ms`);
  assert.ok(existsSync(childPidFile), "the fake must have started its child before the deadline");
  const childPid = Number(readFileSync(childPidFile, "utf8").trim());
  let alive = true;
  try { process.kill(childPid, 0); } catch (e) { alive = e.code !== "ESRCH"; }
  assert.equal(alive, false, `SURVIVOR: child ${childPid} outlived the deadline`);
});

test("run: a descendant that ESCAPES the process group and holds the pipe cannot hold the bake-off past the deadline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-lawbar-escape-"));
  const orphanPidFile = join(dir, "orphan.pid");
  const fake = makeFakeHelper({ extractBody: `/usr/bin/python3 -c 'import os,time,sys\nos.setsid()\nopen(sys.argv[1],"w").write(str(os.getpid()))\ntime.sleep(30)' "${orphanPidFile}" &\nexit 0` });
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake));
  const t0 = Date.now();
  const o = await c.run(zh02, { run_kind: "cold", timeout_ms: 3000 });
  const took = Date.now() - t0;
  if (existsSync(orphanPidFile)) { try { process.kill(Number(readFileSync(orphanPidFile, "utf8")), "SIGKILL"); } catch {} }
  assert.equal(o.code, "timeout", JSON.stringify(o));
  assert.ok(took < 10_000, `the bake-off was held by an escaped descendant: took ${took} ms`);
});

test("run: a helper that floods stdout is killed at the cap and refused as helper_output_overflow, well before the deadline", async () => {
  const fake = makeFakeHelper({ extractBody: "exec /usr/bin/yes" });
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake));
  const t0 = Date.now();
  const o = await c.run(zh02, { run_kind: "cold", timeout_ms: 20_000 });
  const took = Date.now() - t0;
  assert.equal(o.code, "helper_output_overflow", JSON.stringify(o));
  assert.ok(took < 15_000, `the flood was read until the deadline: ${took} ms`);
});

test("run before any probe: the probe runs under the RUN's deadline, not its own; a hanging probe fails within timeout_ms", async () => {
  const fake = makeFakeHelper({ probeBody: `trap '' TERM; /bin/sleep 30 & wait` });
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake)); // no probe() call first
  const t0 = Date.now();
  const o = await c.run(zh02, { run_kind: "cold", timeout_ms: 2000 });
  const took = Date.now() - t0;
  assert.equal(o.outcome, "failure");
  assert.equal(o.code, "helper_probe_failed");
  assert.match(o.message, /exceeded 2000 ms/);
  assert.ok(took < 10_000, `the probe inside run() escaped the run's deadline: ${took} ms`);
});

test("a helper whose bytes change after the probe is refused before it is spawned again — the record's digest is not the only check", async () => {
  const fake = makeFakeHelper({ pageLine: pageRecord() });
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake));
  assert.equal((await c.probe()).status, "available");
  assert.equal((await c.run(zh02, COLD)).outcome, "success");
  // Rewrite the executable in place; the pin and the cached probe still describe the old bytes.
  writeFileSync(fake.path, readFileSync(fake.path, "utf8") + "\n# changed\n");
  const o = await c.run(zh02, COLD);
  assert.equal(o.outcome, "failure");
  assert.equal(o.code, "helper_identity_mismatch");
  assert.match(o.message, /changed since it was probed/);
});

test("signal and exit failures carry FIXED codes; the number lives in the message", async () => {
  const dying = makeFakeHelper({ extractBody: "exit 7" });
  const o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(dying)).run(zh02, COLD);
  assert.equal(o.outcome, "failure");
  assert.equal(o.code, "helper_exit_nonzero");
  assert.match(o.message, /code 7/);
});

test("an image record that claims a layer time is malformed: an image has no layer to time", async () => {
  const fake = makeFakeHelper({ pageLine: pageRecord({ source: "image", layer_ms: 12 }) });
  const o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake)).run(zh02, COLD);
  assert.equal(o.outcome, "failure");
  assert.equal(o.code, "helper_output_unparseable");
  assert.match(o.message, /image has no text layer/);
});

test("a record whose mode is not the one asked for is refused — a layer-only answer to a full request would be a transcript of nothing", async () => {
  const fake = makeFakeHelper({ pageLine: pageRecord({ mode: "layer_only" }) });
  const o = await makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake)).run(zh02, COLD);
  assert.equal(o.outcome, "failure");
  assert.equal(o.code, "helper_output_unparseable");
  assert.match(o.message, /asked for full/);
});

// ---------------------------------------------------------------------------
// Through the runner
// ---------------------------------------------------------------------------

test("runBakeoff scores the candidate: an exact transcript is CER 0 and the probe records the helper identity", async () => {
  const fake = makeFakeHelper({ pageLine: pageRecord({ vision_text: zh02Expected.trim() }) });
  const c = makeLawbarOcrVisionCandidate(fixturesRoot, optsFor(fake));
  const report = await runBakeoff({ candidates: [c], fixtures: [zh02], roleFilter: "verdict", fixturesRoot, timeout_ms: 10_000 });
  assert.equal(report.probes.length, 1);
  assert.equal(report.probes[0].result.status, "available");
  const score = report.cer_scores.find((s) => s.candidate === "lawbar-ocr-vision" && s.fixture_id === "zh-02-court-heading");
  assert.ok(score, JSON.stringify(report.cer_scores));
  assert.equal(score.cer, 0);
  assert.equal(report.verdict_ready, true);
});

// ---------------------------------------------------------------------------
// Opt-in: the real helper, the way the bin resolves it, pinned by the desktop build
// ---------------------------------------------------------------------------

test(
  "REAL: the resolved helper (packaged bundle, staged build, or LAWBAR_OCR_HELPER) is the desktop build's pin and reads the Chinese heading fixture exactly",
  { skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false },
  async () => {
    const loc = resolveHelperLocation();
    assert.ok(loc !== null, `${REAL_ENV_KEY}=1 but no helper found — build it: npm --prefix apps/lawbar-desktop run dist (or build:helper)`);
    assert.ok(readDesktopPin() !== null, `${REAL_ENV_KEY}=1 but the desktop pin is missing — npm --prefix apps/lawbar-desktop run build:helper writes it`);
    const c = makeLawbarOcrVisionCandidate(fixturesRoot, { required_languages: ["zh-Hans"] });
    const p = await c.probe();
    assert.equal(p.status, "available", JSON.stringify(p));
    assert.match(p.detail, new RegExp(`helper=${loc.source}:`));
    const o = await c.run(zh02, { run_kind: "cold", timeout_ms: 60_000 });
    assert.equal(o.outcome, "success", JSON.stringify(o));
    assert.equal(o.transcript.replace(/\s+/g, ""), zh02Expected.replace(/\s+/g, ""));
    assert.ok(o.peak_rss_bytes > 0);
    assert.ok(o.per_page_inference_ms > 0);
  },
);
