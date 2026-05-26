#!/usr/bin/env node
// test-packaged-wrapper.mjs — fail-closed crash detector around packaged-binary
// tests. Implements dev-memo/plan-pkg-verify-detection-redesign-00.md §3-§9
// (rev-0.2.1; committed at 7f16c5d).
//
// Phases (per plan §3.5):
//   0 Platform guard       — exit 0 if not darwin.
//   1 CI guard validation  — pure config check; no FS reads.
//   2 Pre-scan             — snapshot DiagnosticReports + tempfile pid-log.
//   3 Run tests            — spawnSync node --test.
//   4 Settle               — sleep settleSeconds (default 30).
//   5 Post-scan+attribution — two-pass parse per §5.1; decision tree per §5.2.
//   6 Exit-code resolution — per §8.
//   7 Cleanup              — unlink pid-log; keep .ips files as audit trail.
//
// Exit codes (§8):
//   0 — test passed AND no attributable .ips.
//   1 — test failed AND no attributable .ips (pass-through).
//   2 — CI guard tripped in Phase 1.
//   3 — attributable .ips found OR ATTRIBUTION_UNKNOWN per §3.6 unified rule.
//   4 — wrapper internal error (unreadable DiagnosticReports; wrapper bug).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- Phase 0: Platform guard -----

if (process.platform !== "darwin") {
  console.log("[test-packaged-wrapper] skipped: darwin-only");
  process.exit(0);
}

// ----- Env contract (plan §3.3) -----

const env = process.env;
const isCi = env.LAWBAR_CI === "true" || env.CI === "true";
const settleSecondsRaw = Number(env.LAWBAR_TEST_SETTLE_SECONDS ?? "30");
const settleSeconds = Number.isFinite(settleSecondsRaw) && settleSecondsRaw >= 0
  ? settleSecondsRaw
  : 30;
const strictUnattributed = env.LAWBAR_TEST_STRICT_UNATTRIBUTED !== "false";
const observeSecondsRaw = env.LAWBAR_TEST_OBSERVE_SECONDS;
let observeSeconds = null;
if (observeSecondsRaw !== undefined && observeSecondsRaw !== "") {
  const parsed = Number(observeSecondsRaw);
  if (Number.isFinite(parsed) && parsed >= 0) observeSeconds = parsed;
}

const diagnosticDir = env.LAWBAR_DIAGNOSTIC_DIR
  ?? path.join(os.homedir(), "Library", "Logs", "DiagnosticReports");

const defaultTestFile = path.resolve(__dirname, "..", "tests", "smoke.packaged.electron.test.mjs");
// LAWBAR_TEST_FILES is comma-separated per plan §3.3.
// Trim each entry; reject empty entries to avoid passing "" to node --test.
const testFiles = (env.LAWBAR_TEST_FILES ?? defaultTestFile)
  .split(",")
  .map((p) => p.trim())
  .filter((p) => p.length > 0);

// ----- Phase 1: CI guard + config validation -----

function ciFail(message) {
  console.error(`[test-packaged-wrapper] FATAL (CI): ${message}`);
  console.error(`  isCi=${isCi} (LAWBAR_CI=${env.LAWBAR_CI ?? ""}, CI=${env.CI ?? ""})`);
  process.exit(2);
}

// Fail-closed if LAWBAR_TEST_FILES is empty after parsing. Per audit
// mpm3q7de M-new: empty/all-comma values like "" or ",,," produce
// testFiles.length === 0; the wrapper would then call `node --test` with
// NO file arguments, falling back to discovery and running an unintended
// suite. Validate in Phase 1 + exit 2.
if (testFiles.length === 0) {
  console.error("[test-packaged-wrapper] FATAL: LAWBAR_TEST_FILES must contain at least one comma-delimited test file (got: " + JSON.stringify(env.LAWBAR_TEST_FILES ?? "") + ").");
  console.error("  Do not allow node --test to run with no explicit file arguments — discovery would run unintended tests.");
  process.exit(2);
}

if (isCi && env.LAWBAR_TEST_STRICT_UNATTRIBUTED === "false") {
  ciFail("LAWBAR_TEST_STRICT_UNATTRIBUTED=false is forbidden in CI. Either unset LAWBAR_TEST_STRICT_UNATTRIBUTED or unset both CI and LAWBAR_CI for this run.");
}
if (isCi && settleSeconds < 30) {
  ciFail(`LAWBAR_TEST_SETTLE_SECONDS=${settleSeconds} below CI floor (30s).`);
}
if (isCi && observeSeconds !== null) {
  ciFail("LAWBAR_TEST_OBSERVE_SECONDS is dev-only; not allowed in CI.");
}
if (observeSeconds !== null && observeSeconds > 600) {
  console.error(`[test-packaged-wrapper] warning: LAWBAR_TEST_OBSERVE_SECONDS=${observeSeconds} > 600; clamping to 600.`);
  observeSeconds = 600;
}

const effectiveSettle = observeSeconds !== null ? observeSeconds : settleSeconds;

// ----- Phase 2: Pre-scan + tempfile + bundle-root resolution -----

const suiteStartIso = new Date().toISOString();
const suiteStartMs = Date.parse(suiteStartIso);

function snapshotDiagnosticDir() {
  if (!fs.existsSync(diagnosticDir)) return new Set();
  try {
    return new Set(fs.readdirSync(diagnosticDir));
  } catch (e) {
    console.error(`[test-packaged-wrapper] FATAL: cannot read DiagnosticReports at ${diagnosticDir}: ${e.message}`);
    console.error("  Verify Full Disk Access for the terminal app.");
    process.exit(4);
  }
}

const preSnapshot = snapshotDiagnosticDir();

const pidLogPath = fs.mkdtempSync(path.join(os.tmpdir(), "lawbar-test-pid-")) + "/pid-log.jsonl";
fs.writeFileSync(pidLogPath, "", "utf-8");

const wrapperMtime = fs.statSync(__filename).mtime.toISOString();
const wrapperVersion = `test:packaged:${wrapperMtime}`;

function resolveBundleRoots() {
  const projectRoot = path.resolve(__dirname, "..");
  const releaseDirs = [path.join(projectRoot, "dist"), path.join(projectRoot, "release")];
  const isArm64 = os.arch() === "arm64";
  const hostArchSubdirs = isArm64 ? ["mac-arm64"] : ["mac-x64", "mac"];
  const otherArchSubdirs = isArm64 ? ["mac-x64", "mac"] : ["mac-arm64"];
  const roots = [];
  for (const sub of [...hostArchSubdirs, ...otherArchSubdirs]) {
    for (const dir of releaseDirs) {
      const candidate = path.join(dir, sub, "lawbar.app");
      if (fs.existsSync(candidate)) roots.push(candidate);
    }
  }
  return roots;
}

const bundleRoots = resolveBundleRoots();

console.log(
  `[test-packaged-wrapper] Starting (suite=${testFiles.length} file(s), `
  + `settle=${effectiveSettle}s${observeSeconds !== null ? " (OBSERVE)" : ""}, `
  + `strict-unattributed=${strictUnattributed}, isCi=${isCi} (LAWBAR_CI=${env.LAWBAR_CI ?? ""}, CI=${env.CI ?? ""}))`,
);
console.log(`[test-packaged-wrapper] Pre-scan: ${preSnapshot.size} existing entries in ${diagnosticDir}`);
console.log(`[test-packaged-wrapper] Bundle roots: ${bundleRoots.length === 0 ? "(none found — packaged .app may be missing)" : bundleRoots.join(", ")}`);

// ----- Phase 3: Run tests -----

const childEnv = {
  ...env,
  LAWBAR_TEST_PID_LOG: pidLogPath,
  LAWBAR_TEST_SUITE_START: suiteStartIso,
  LAWBAR_TEST_BUNDLE_ROOTS: bundleRoots.join(":"),
  LAWBAR_WRAPPER_VERSION: wrapperVersion,
};

const testResult = spawnSync("node", ["--test", ...testFiles], {
  env: childEnv,
  stdio: "inherit",
});

// POSIX convention: a process killed by signal N exits with code (128 + N).
// `testResult.signal` is the signal NAME (e.g. "SIGKILL"); map via
// os.constants.signals to its numeric value. Fail conservatively if the
// signal name is not recognized (unmapped signal → exit 1 with a log line).
function signalNameToExitCode(signalName) {
  if (typeof signalName !== "string") return null;
  const num = os.constants.signals[signalName];
  if (typeof num !== "number" || num <= 0) return null;
  return 128 + num;
}

let testExitCode;
if (testResult.status !== null) {
  testExitCode = testResult.status;
} else if (testResult.signal !== null) {
  const mapped = signalNameToExitCode(testResult.signal);
  if (mapped !== null) {
    testExitCode = mapped;
  } else {
    console.error(`[test-packaged-wrapper] WARNING: unmapped signal "${testResult.signal}" — propagating as exit 1`);
    testExitCode = 1;
  }
} else {
  testExitCode = 1;
}

console.log(`[test-packaged-wrapper] Test exit: ${testExitCode}${testResult.signal !== null ? ` (signal=${testResult.signal})` : ""}`);

// ----- Phase 4: Settle -----

console.log(`[test-packaged-wrapper] Sleeping ${effectiveSettle}s for crash-report settle`);
await new Promise((resolve) => setTimeout(resolve, effectiveSettle * 1000));

// ----- Phase 5: Post-scan + attribution -----

function readPidLog() {
  try {
    const raw = fs.readFileSync(pidLogPath, "utf-8");
    return raw.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

const recordedLaunches = readPidLog();
const recordedPids = new Set(recordedLaunches.map((l) => l.pid));

const procNameAllowlist = /^lawbar( Helper( \([A-Za-z]+\))?)?$/;

function safeReadFile(p) {
  try { return fs.readFileSync(p, "utf-8"); } catch { return null; }
}

function parseIps(absPath) {
  // .ips = two JSON documents concatenated. The first is the header (single
  // line); the second is the body (multi-line). Split on the first balanced
  // boundary. Simple heuristic: find the first "\n{" sequence after the first
  // complete top-level "}".
  const raw = safeReadFile(absPath);
  if (raw === null) return { header: null, body: null, parseError: "read-failed" };
  // Locate split point: first "\n{" after a balanced first object.
  const newlineBracePos = raw.indexOf("\n{");
  if (newlineBracePos === -1) {
    // Try whole-file parse as a single doc.
    try { return { header: JSON.parse(raw), body: null, parseError: null }; }
    catch (e) { return { header: null, body: null, parseError: `single-doc parse: ${e.message}` }; }
  }
  const headerRaw = raw.slice(0, newlineBracePos);
  const bodyRaw = raw.slice(newlineBracePos + 1);
  let header = null;
  let body = null;
  let parseError = null;
  try { header = JSON.parse(headerRaw); } catch (e) { parseError = `header parse: ${e.message}`; }
  try { body = JSON.parse(bodyRaw); } catch (e) { parseError = (parseError ?? "") + `; body parse: ${e.message}`; }
  return { header, body, parseError };
}

function procPathAttributes(procPath, _bundleRoots) {
  if (typeof procPath !== "string" || procPath.length === 0) return false;
  // Step 1: absolute-prefix match against any bundle root.
  for (const root of _bundleRoots) {
    if (procPath.startsWith(root + "/")) return true;
  }
  // Step 2: redacted-path fallback. Find last "lawbar.app/".
  const idx = procPath.lastIndexOf("lawbar.app/");
  if (idx === -1) return false;
  // Suffix-shape gate: must match one of the expected packaged-root patterns
  // OR a redaction placeholder shape.
  const shapeOk = (
    procPath.startsWith("/Users/USER/")
    || /\/dist\/mac-(arm64|x64|[a-z0-9]+)\/lawbar\.app\//.test(procPath)
    || /\/release\/mac-(arm64|x64|[a-z0-9]+)\/lawbar\.app\//.test(procPath)
    || procPath.startsWith("lawbar.app/")
  );
  // Suffix-only is provisional; caller MUST combine with a secondary signal.
  // We return the shape-match result; the decision tree applies the
  // secondary-signal requirement.
  return shapeOk;
}

function attributeCandidate(parsed) {
  const { header, body, parseError } = parsed;
  // Header criterion
  const headerBundleMatch = header !== null && header.bundleID === "io.lawbar.desktop";

  // If body unparseable but a positive selection criterion exists, classify
  // as ATTRIBUTION_UNKNOWN (per §3.6 + §5.1 rev-0.2 M-B unified rule).
  if (body === null) {
    if (headerBundleMatch) {
      return { klass: "ATTRIBUTION_UNKNOWN", reason: `header bundleID matched but body parse failed: ${parseError}`, pid: null, exception: null, procName: null };
    }
    // Will be promoted to ATTRIBUTION_UNKNOWN by caller if Scan A matched.
    return { klass: "NEEDS_FILENAME_CHECK", reason: `no header bundle match; body parse failed: ${parseError}`, pid: null, exception: null, procName: null };
  }

  const pid = typeof body.pid === "number" ? body.pid : null;
  const bundleId = body.bundleInfo?.CFBundleIdentifier;
  const procPath = body.procPath;
  const procName = body.procName;
  const exception = body.exception;

  // 1. pid match AND lawbar bundle id → HIGH-CONFIDENCE.
  if (pid !== null && recordedPids.has(pid) && bundleId === "io.lawbar.desktop") {
    return { klass: "HIGH-CONFIDENCE", reason: `pid ${pid} matches recorded launch + bundleID match`, pid, exception, procName };
  }

  // 2. bundle id match → HELPER-PROCESS or UNATTRIBUTED-PARENT.
  if (bundleId === "io.lawbar.desktop" || headerBundleMatch) {
    const isHelper = typeof procName === "string" && procNameAllowlist.test(procName);
    if (isHelper) {
      return { klass: "HELPER-PROCESS", reason: `bundleID match + procName allowlist`, pid, exception, procName };
    }
    return { klass: "UNATTRIBUTED-PARENT", reason: `bundleID match; procName does not match allowlist (${procName ?? "<none>"})`, pid, exception, procName };
  }

  // 3. procPath attribution (absolute-prefix OR redacted+secondary-signal).
  const procPathShapeOk = procPathAttributes(procPath, bundleRoots);
  if (procPathShapeOk) {
    // Suffix-only (when not absolute-prefix) requires secondary signal.
    const isAbsolutePrefix = bundleRoots.some((root) => typeof procPath === "string" && procPath.startsWith(root + "/"));
    if (isAbsolutePrefix) {
      return { klass: "HELPER-PROCESS", reason: `procPath absolute-prefix matches bundle root`, pid, exception, procName };
    }
    const secondarySignal = procNameAllowlist.test(procName ?? "") || (pid !== null && recordedPids.has(pid));
    if (secondarySignal) {
      return { klass: "HELPER-PROCESS", reason: `procPath redacted-suffix-shape + secondary signal (${procNameAllowlist.test(procName ?? "") ? "procName" : "pid"})`, pid, exception, procName };
    }
    // Shape matches but no secondary signal → NOT-ATTRIBUTED (false-positive guard).
  }

  // 4. procName allowlist alone → HELPER-PROCESS (rev-0.2 M-D branch).
  if (typeof procName === "string" && procNameAllowlist.test(procName)) {
    return { klass: "HELPER-PROCESS", reason: `procName allowlist match (no other criteria)`, pid, exception, procName };
  }

  // 5. pid match without lawbar metadata → SUSPICIOUS-PID-REUSE (rev-0.2 explicit branch).
  if (pid !== null && recordedPids.has(pid)) {
    return { klass: "SUSPICIOUS-PID-REUSE", reason: `pid ${pid} matched recorded launch but bundleID/procName/procPath all non-lawbar`, pid, exception, procName };
  }

  return { klass: "NOT-ATTRIBUTED", reason: `no positive criterion`, pid, exception, procName };
}

function isLawbarFilenameMatch(filename) {
  return /^lawbar.*\.ips$/.test(filename);
}

function scanCandidates() {
  let dirEntries;
  try {
    dirEntries = fs.readdirSync(diagnosticDir);
  } catch (e) {
    console.error(`[test-packaged-wrapper] FATAL: cannot read DiagnosticReports post-suite: ${e.message}`);
    process.exit(4);
  }
  const windowEndMs = suiteStartMs + (Date.now() - suiteStartMs) + 5000;
  const ipsFiles = dirEntries
    .filter((name) => name.endsWith(".ips"))
    .filter((name) => !preSnapshot.has(name))
    .map((name) => path.join(diagnosticDir, name))
    .filter((p) => {
      try {
        const m = fs.statSync(p).mtimeMs;
        return m >= suiteStartMs && m <= windowEndMs;
      } catch { return false; }
    });

  const candidates = [];
  for (const absPath of ipsFiles) {
    const filenameMatch = isLawbarFilenameMatch(path.basename(absPath));
    const parsed = parseIps(absPath);
    const result = attributeCandidate(parsed);
    if (result.klass === "NEEDS_FILENAME_CHECK") {
      // Promote to ATTRIBUTION_UNKNOWN only if Scan A matched.
      if (filenameMatch) {
        candidates.push({ path: absPath, klass: "ATTRIBUTION_UNKNOWN", reason: `Scan A filename match + body parse failed`, exception: null, procName: null });
      }
      // Otherwise silently drop (no positive criterion at all).
      continue;
    }
    if (result.klass === "NOT-ATTRIBUTED") {
      // Log for transparency but do not promote to candidate.
      console.log(`[test-packaged-wrapper] NOT-ATTRIBUTED: ${absPath} (${result.reason})`);
      continue;
    }
    candidates.push({ path: absPath, ...result });
  }
  return candidates;
}

const candidates = scanCandidates();

const highConfidence = candidates.filter((c) => c.klass === "HIGH-CONFIDENCE");
const helperProcess = candidates.filter((c) => c.klass === "HELPER-PROCESS");
const unattributedParent = candidates.filter((c) => c.klass === "UNATTRIBUTED-PARENT");
const attributionUnknown = candidates.filter((c) => c.klass === "ATTRIBUTION_UNKNOWN");
const suspiciousPidReuse = candidates.filter((c) => c.klass === "SUSPICIOUS-PID-REUSE");

console.log(
  `[test-packaged-wrapper] Attribution: `
  + `${highConfidence.length} HIGH-CONFIDENCE / `
  + `${helperProcess.length} HELPER-PROCESS / `
  + `${unattributedParent.length} UNATTRIBUTED-PARENT / `
  + `${attributionUnknown.length} ATTRIBUTION_UNKNOWN / `
  + `${suspiciousPidReuse.length} SUSPICIOUS-PID-REUSE`,
);

// SUSPICIOUS-PID-REUSE: log diagnostic; do NOT fail.
for (const c of suspiciousPidReuse) {
  console.log(`[test-packaged-wrapper] SUSPICIOUS-PID-REUSE: ${c.path} (${c.reason})`);
}

// Failing classes per §5.2 + §8.
function reportCrash(c) {
  console.log(`[test-packaged-wrapper] CRASH DETECTED (${c.klass})`);
  console.log(`  - .ips path: ${c.path}`);
  console.log(`  - reason: ${c.reason}`);
  if (c.exception) {
    console.log(`  - exception.type: ${c.exception.type ?? "?"}`);
    console.log(`  - exception.signal: ${c.exception.signal ?? "?"}`);
    if (c.exception.subtype) console.log(`  - exception.subtype: ${c.exception.subtype}`);
  }
  if (c.procName) console.log(`  - procName: ${c.procName}`);
}

const failClasses = [
  ...highConfidence,
  ...helperProcess,
  ...unattributedParent,
  ...attributionUnknown,
];

// In non-strict dev mode, demote UNATTRIBUTED-PARENT + ATTRIBUTION_UNKNOWN to warn-only.
const failingNow = strictUnattributed
  ? failClasses
  : failClasses.filter((c) => c.klass === "HIGH-CONFIDENCE" || c.klass === "HELPER-PROCESS");

for (const c of failingNow) reportCrash(c);

// ----- Phase 6: Exit-code resolution (§8) -----

// Phase 7 cleanup happens regardless of exit branch.
function cleanup() {
  try { fs.unlinkSync(pidLogPath); } catch { /* ignore */ }
  try { fs.rmdirSync(path.dirname(pidLogPath)); } catch { /* ignore */ }
}

if (failingNow.length > 0) {
  console.log(`[test-packaged-wrapper] FAILED (exit 3)`);
  cleanup();
  process.exit(3);
}

if (testExitCode !== 0) {
  console.log(`[test-packaged-wrapper] Test failure pass-through (exit ${testExitCode})`);
  cleanup();
  process.exit(testExitCode);
}

console.log(`[test-packaged-wrapper] SUCCESS (exit 0)`);
cleanup();
process.exit(0);
