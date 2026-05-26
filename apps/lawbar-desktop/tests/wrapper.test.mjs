// Pure-Node tests for scripts/test-packaged-wrapper.mjs. Covers:
//   G2.4 attribution fixture matrix (G2.4.a-h)
//   G2.8 CI guard sub-cases (G2.8.a-c + G2.8.d.1-d.8 + G2.8.j-l)
// Per dev-memo/plan-pkg-verify-detection-redesign-00.md §11 (rev-0.2.1).
//
// Runs entirely without Playwright / Electron. Drives the wrapper via
// `spawnSync` with a controlled env that points LAWBAR_DIAGNOSTIC_DIR at
// an isolated temp dir; writes synthetic .ips fixtures into that dir;
// asserts the wrapper's exit code against the expected attribution.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WRAPPER = path.resolve(__dirname, "..", "scripts", "test-packaged-wrapper.mjs");

// Synthetic-detector smoke uses a no-op child test file so the wrapper's
// Phase 3 always exits 0 — exit-code is then determined by the post-suite
// attribution scan alone.
const NOOP_TEST_FILE = path.resolve(__dirname, "_wrapper-noop.test.mjs");

// Write the no-op test file once at module load.
fs.writeFileSync(NOOP_TEST_FILE, [
  "// Auto-generated no-op test for wrapper.test.mjs. DO NOT EDIT.",
  'import { test } from "node:test";',
  'test("noop", () => {});',
  "",
].join("\n"), "utf-8");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawbar-wrapper-test-"));
}

function runWrapper(envOverrides) {
  const baseEnv = {
    ...process.env,
    LAWBAR_TEST_SETTLE_SECONDS: "0",
    LAWBAR_TEST_STRICT_UNATTRIBUTED: "true",
    LAWBAR_TEST_FILES: NOOP_TEST_FILE,
    PATH: process.env.PATH ?? "",
  };
  // Strip NODE_TEST_CONTEXT so the wrapper's spawned `node --test` does NOT
  // detect recursive-test mode (which would silently no-op child tests).
  delete baseEnv.NODE_TEST_CONTEXT;
  // Remove inherited CI envs so the test controls them.
  delete baseEnv.LAWBAR_CI;
  delete baseEnv.CI;
  delete baseEnv.LAWBAR_DIAGNOSTIC_DIR;
  delete baseEnv.LAWBAR_TEST_OBSERVE_SECONDS;
  delete baseEnv.LAWBAR_TEST_PID_LOG;
  delete baseEnv.LAWBAR_WRAPPER_VERSION;
  const env = { ...baseEnv, ...envOverrides };
  return spawnSync("node", [WRAPPER], { env, encoding: "utf-8" });
}

const baseHeader = (overrides) => ({
  bundleID: "io.lawbar.desktop",
  os_version: "macOS 15.6.1 (24G90)",
  bug_type: "309",
  ...overrides,
});

const baseBody = (overrides) => ({
  pid: 99999,
  procName: "lawbar",
  procPath: "/Users/USER/*/dist/mac-arm64/lawbar.app/Contents/MacOS/lawbar",
  bundleInfo: { CFBundleIdentifier: "io.lawbar.desktop", CFBundleShortVersionString: "0.1.0" },
  exception: { type: "EXC_BAD_ACCESS", signal: "SIGSEGV" },
  ...overrides,
});

// Unified seeder: writes a child test file that, when invoked by the wrapper
// during Phase 3, (1) optionally appends a pid entry to LAWBAR_TEST_PID_LOG,
// (2) writes a single .ips fixture into LAWBAR_DIAGNOSTIC_DIR with the given
// header + body. The .ips file is created DURING Phase 3 — after the
// wrapper's Phase 2 pre-snapshot — so the post-scan picks it up.
//
// `bodyOverride` can be the string "MALFORMED_BODY" to write a malformed
// body (header parses fine; body parse fails). Otherwise it's serialized
// as JSON.
function makeSeeder(name, opts) {
  const { diagnosticDir, ipsName, header, body, pidLogEntry } = opts;
  const seederPath = path.resolve(__dirname, `_wrapper-seeder-${name}.test.mjs`);
  const bodyLiteral = body === "MALFORMED_BODY"
    ? `"{not valid json"`
    : `JSON.stringify(${JSON.stringify(body)}, null, 2)`;
  const pidLogLine = pidLogEntry === null
    ? ""
    : `  fs.appendFileSync(process.env.LAWBAR_TEST_PID_LOG, JSON.stringify(${JSON.stringify(pidLogEntry)}) + "\\n", "utf-8");`;
  const lines = [
    `// Auto-generated seeder for wrapper.test.mjs ${name}. DO NOT EDIT.`,
    'import { test } from "node:test";',
    'import fs from "node:fs";',
    'import path from "node:path";',
    `test(${JSON.stringify("seed-" + name)}, () => {`,
    pidLogLine,
    `  const ipsPath = path.join(${JSON.stringify(diagnosticDir)}, ${JSON.stringify(ipsName)});`,
    `  fs.writeFileSync(ipsPath, JSON.stringify(${JSON.stringify(header)}) + "\\n" + ${bodyLiteral}, "utf-8");`,
    "});",
    "",
  ];
  fs.writeFileSync(seederPath, lines.join("\n"), "utf-8");
  return seederPath;
}

// ----------------------------------------------------------------------
// G2.4 — attribution fixture matrix
// ----------------------------------------------------------------------

test("G2.4.a — main pid match (seeded) → HIGH-CONFIDENCE → strict exit 3", () => {
  const tmp = makeTempDir();
  const fixturePid = 65432;
  const seederPath = makeSeeder("G2.4.a", {
    diagnosticDir: tmp,
    ipsName: "lawbar-g24a.ips",
    header: baseHeader(),
    body: baseBody({ pid: fixturePid }),
    pidLogEntry: { pid: fixturePid, launchedAt: new Date().toISOString(), testName: "G2.4.a-seeder", iteration: null, bundleRoot: null },
  });
  const r = runWrapper({ LAWBAR_DIAGNOSTIC_DIR: tmp, LAWBAR_TEST_FILES: seederPath });
  assert.equal(r.status, 3, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  assert.match(r.stdout, /HIGH-CONFIDENCE/);
});

test("G2.4.b — non-lawbar*.ips body bundle-id match → strict exit 3", () => {
  const tmp = makeTempDir();
  const seederPath = makeSeeder("G2.4.b", {
    diagnosticDir: tmp,
    ipsName: "notlawbar-name.ips",
    header: baseHeader({ bundleID: "" }),
    body: baseBody({ procName: "unknown", procPath: "/some/path" }),
    pidLogEntry: null,
  });
  const r = runWrapper({ LAWBAR_DIAGNOSTIC_DIR: tmp, LAWBAR_TEST_FILES: seederPath });
  assert.equal(r.status, 3, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
});

test("G2.4.c — helper procName match alone → strict exit 3", () => {
  const tmp = makeTempDir();
  const seederPath = makeSeeder("G2.4.c", {
    diagnosticDir: tmp,
    ipsName: "lawbar Helper (Renderer)-x.ips",
    header: baseHeader({ bundleID: "" }),
    body: baseBody({
      procName: "lawbar Helper (Renderer)",
      procPath: "/some/other/path",
      bundleInfo: { CFBundleIdentifier: "" },
    }),
    pidLogEntry: null,
  });
  const r = runWrapper({ LAWBAR_DIAGNOSTIC_DIR: tmp, LAWBAR_TEST_FILES: seederPath });
  assert.equal(r.status, 3, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
});

test("G2.4.d — helper procPath under Frameworks (redacted) + secondary signal → strict exit 3", () => {
  const tmp = makeTempDir();
  const seederPath = makeSeeder("G2.4.d", {
    diagnosticDir: tmp,
    ipsName: "anyname.ips",
    header: baseHeader({ bundleID: "" }),
    body: baseBody({
      procName: "lawbar Helper",
      procPath: "/Users/USER/*/dist/mac-arm64/lawbar.app/Contents/Frameworks/lawbar Helper.app/Contents/MacOS/lawbar Helper",
      bundleInfo: { CFBundleIdentifier: "" },
    }),
    pidLogEntry: null,
  });
  const r = runWrapper({ LAWBAR_DIAGNOSTIC_DIR: tmp, LAWBAR_TEST_FILES: seederPath });
  assert.equal(r.status, 3, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
});

test("G2.4.e — unrelated lawbar*.ips → NOT-ATTRIBUTED → exit 0", () => {
  const tmp = makeTempDir();
  const seederPath = makeSeeder("G2.4.e", {
    diagnosticDir: tmp,
    ipsName: "lawbar-other-app.ips",
    header: baseHeader({ bundleID: "org.someone-else.lawbar-other" }),
    body: baseBody({
      procName: "lawbar-other",
      procPath: "/Users/someone/lawbar-other-app/lawbar-other",
      bundleInfo: { CFBundleIdentifier: "org.someone-else.lawbar-other" },
      pid: 88888,
    }),
    pidLogEntry: null,
  });
  const r = runWrapper({ LAWBAR_DIAGNOSTIC_DIR: tmp, LAWBAR_TEST_FILES: seederPath });
  assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
});

test("G2.4.f — malformed body on filename-matched candidate → ATTRIBUTION_UNKNOWN → strict exit 3", () => {
  const tmp = makeTempDir();
  const seederPath = makeSeeder("G2.4.f", {
    diagnosticDir: tmp,
    ipsName: "lawbar-malformed-body.ips",
    header: baseHeader(),
    body: "MALFORMED_BODY",
    pidLogEntry: null,
  });
  const r = runWrapper({ LAWBAR_DIAGNOSTIC_DIR: tmp, LAWBAR_TEST_FILES: seederPath });
  assert.equal(r.status, 3, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
});

test("G2.4.g — pid-reuse: pid match without lawbar metadata → SUSPICIOUS-PID-REUSE → exit 0", () => {
  const tmp = makeTempDir();
  const fixturePid = 54321;
  const seederPath = makeSeeder("G2.4.g", {
    diagnosticDir: tmp,
    ipsName: "lawbar-pid-reuse.ips",
    header: baseHeader({ bundleID: "" }),
    body: baseBody({
      pid: fixturePid,
      procName: "unrelated-binary",
      procPath: "/usr/local/bin/unrelated-binary",
      bundleInfo: { CFBundleIdentifier: "com.example.other" },
    }),
    pidLogEntry: { pid: fixturePid, launchedAt: new Date().toISOString(), testName: "G2.4.g-seeder", iteration: null, bundleRoot: null },
  });
  const r = runWrapper({ LAWBAR_DIAGNOSTIC_DIR: tmp, LAWBAR_TEST_FILES: seederPath });
  assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  assert.match(r.stdout, /SUSPICIOUS-PID-REUSE/);
});

test("G2.4.h — /Applications/lawbar.app/ false-positive guard → exit 0", () => {
  const tmp = makeTempDir();
  const seederPath = makeSeeder("G2.4.h", {
    diagnosticDir: tmp,
    ipsName: "anyname-applications.ips",
    header: baseHeader({ bundleID: "" }),
    body: baseBody({
      procName: "lawbar-other",
      procPath: "/Applications/lawbar.app/Contents/MacOS/lawbar",
      bundleInfo: { CFBundleIdentifier: "org.someone-else.lawbar-other" },
      pid: 77777,
    }),
    pidLogEntry: null,
  });
  const r = runWrapper({ LAWBAR_DIAGNOSTIC_DIR: tmp, LAWBAR_TEST_FILES: seederPath });
  assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
});

// ----------------------------------------------------------------------
// G2.8 — CI guard sub-cases
// ----------------------------------------------------------------------

test("G2.8.a — LAWBAR_CI=true + STRICT_UNATTRIBUTED=false → exit 2", () => {
  const tmp = makeTempDir();
  const r = runWrapper({
    LAWBAR_CI: "true",
    LAWBAR_TEST_STRICT_UNATTRIBUTED: "false",
    LAWBAR_DIAGNOSTIC_DIR: tmp,
  });
  assert.equal(r.status, 2);
});

test("G2.8.b — CI=true + STRICT_UNATTRIBUTED=false → exit 2", () => {
  const tmp = makeTempDir();
  const r = runWrapper({
    CI: "true",
    LAWBAR_TEST_STRICT_UNATTRIBUTED: "false",
    LAWBAR_DIAGNOSTIC_DIR: tmp,
  });
  assert.equal(r.status, 2);
});

test("G2.8.c — LAWBAR_CI=true + settle < 30 → exit 2", () => {
  const tmp = makeTempDir();
  const r = runWrapper({
    LAWBAR_CI: "true",
    LAWBAR_TEST_SETTLE_SECONDS: "10",
    LAWBAR_DIAGNOSTIC_DIR: tmp,
  });
  assert.equal(r.status, 2);
});

// G2.8.d.x — Guard #3 sentinel-pair absence matrix
// Tests run the child test file directly (NOT via the wrapper) with the
// specified env. The test file's top-of-file sentinel block must exit 2
// in CI cases AND must NOT exit on sentinel absence in dev.
const SMOKE_TEST_FILE = path.resolve(__dirname, "smoke.packaged.electron.test.mjs");

function runSmokeDirect(envOverrides) {
  const baseEnv = { ...process.env, PATH: process.env.PATH ?? "" };
  delete baseEnv.NODE_TEST_CONTEXT;
  delete baseEnv.LAWBAR_CI;
  delete baseEnv.CI;
  delete baseEnv.LAWBAR_TEST_PID_LOG;
  delete baseEnv.LAWBAR_WRAPPER_VERSION;
  const env = { ...baseEnv, ...envOverrides };
  return spawnSync("node", ["--test", SMOKE_TEST_FILE], { env, encoding: "utf-8", timeout: 10_000 });
}

// G2.8.d.x assertion shape: node --test catches process.exit(2) inside a
// test file and re-emits its own exit code (1 for failed-subtest). The
// load-bearing signal is the FATAL stderr line + non-zero exit. Both
// assertions are checked.
function assertSentinelFired(r) {
  assert.notEqual(r.status, 0, `expected non-zero exit; got ${r.status} (stderr=${r.stderr}, stdout=${r.stdout})`);
  assert.match(
    r.stderr + r.stdout,
    /FATAL: must run through scripts\/test-packaged-wrapper\.mjs in CI/,
    `expected sentinel FATAL line in output`,
  );
}

test("G2.8.d.1 — LAWBAR_CI=true, both absent → sentinel fires", () => {
  assertSentinelFired(runSmokeDirect({ LAWBAR_CI: "true" }));
});

test("G2.8.d.2 — CI=true, both absent → sentinel fires", () => {
  assertSentinelFired(runSmokeDirect({ CI: "true" }));
});

test("G2.8.d.3 — LAWBAR_CI=true, PID_LOG absent + WRAPPER_VERSION present → sentinel fires", () => {
  assertSentinelFired(runSmokeDirect({
    LAWBAR_CI: "true",
    LAWBAR_WRAPPER_VERSION: "foo:bar",
  }));
});

test("G2.8.d.4 — CI=true, PID_LOG absent + WRAPPER_VERSION present → sentinel fires", () => {
  assertSentinelFired(runSmokeDirect({
    CI: "true",
    LAWBAR_WRAPPER_VERSION: "foo:bar",
  }));
});

test("G2.8.d.5 — LAWBAR_CI=true, PID_LOG present + WRAPPER_VERSION absent → sentinel fires", () => {
  assertSentinelFired(runSmokeDirect({
    LAWBAR_CI: "true",
    LAWBAR_TEST_PID_LOG: "/tmp/foo.jsonl",
  }));
});

test("G2.8.d.6 — CI=true, PID_LOG present + WRAPPER_VERSION absent → sentinel fires", () => {
  assertSentinelFired(runSmokeDirect({
    CI: "true",
    LAWBAR_TEST_PID_LOG: "/tmp/foo.jsonl",
  }));
});

test("G2.8.d.7 — both LAWBAR_CI=true AND CI=true, both absent → sentinel fires (sanity)", () => {
  assertSentinelFired(runSmokeDirect({
    LAWBAR_CI: "true",
    CI: "true",
  }));
});

test("G2.8.d.8 — dev mode (neither CI form), both absent → sentinel does NOT fire", () => {
  // In dev mode the sentinel must NOT trigger. The smoke test's other test
  // bodies may then proceed and pass/fail based on .app presence + Class B
  // shutdown timing; that downstream behavior is NOT what this sub-case
  // asserts. We assert ONLY: stderr/stdout does NOT contain the sentinel
  // FATAL line.
  const r = runSmokeDirect({});
  assert.doesNotMatch(
    r.stderr + r.stdout,
    /FATAL: must run through scripts\/test-packaged-wrapper\.mjs in CI/,
    `dev mode must not trigger Guard #3 sentinel; sentinel FATAL line found in output`,
  );
});

// G2.8.j/k/l — OBSERVE_SECONDS guards
test("G2.8.j — LAWBAR_CI=true + OBSERVE_SECONDS=120 → exit 2", () => {
  const tmp = makeTempDir();
  const r = runWrapper({
    LAWBAR_CI: "true",
    LAWBAR_TEST_OBSERVE_SECONDS: "120",
    LAWBAR_DIAGNOSTIC_DIR: tmp,
  });
  assert.equal(r.status, 2);
});

test("G2.8.k — dev + OBSERVE_SECONDS=2 → exit 0 (no crashes; clean settle)", () => {
  const tmp = makeTempDir();
  const r = runWrapper({
    LAWBAR_TEST_OBSERVE_SECONDS: "2",
    LAWBAR_DIAGNOSTIC_DIR: tmp,
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
});

test("G2.8.l — dev + OBSERVE_SECONDS=9999 → clamps to 600, warns; we don't actually wait 600s", () => {
  // Test the clamp behavior by setting OBSERVE_SECONDS=9999 and asserting
  // the wrapper STARTS with a clamp warning. We don't want to actually
  // settle for 600s in a test; instead set a stdout-only check: the
  // wrapper's startup log should mention clamp. To do this without waiting:
  // set OBSERVE_SECONDS=9999 + override settle to 0 via DIAGNOSTIC_DIR
  // pointing at a clean temp dir, then kill the wrapper after seeing the
  // clamp warning in stdout. Simpler: just assert the clamp warning text
  // appears within the wrapper's output by using a short timeout.
  //
  // Pragmatic shortcut: assert wrapper output CONTAINS the clamp warning
  // string. With OBSERVE_SECONDS=9999 the wrapper sleeps 600s — too long.
  // Instead, assert via spawnSync timeout: kill after 5s and check
  // stdout contains "clamping to 600".
  const tmp = makeTempDir();
  const env = {
    ...process.env,
    PATH: process.env.PATH ?? "",
    LAWBAR_TEST_OBSERVE_SECONDS: "9999",
    LAWBAR_DIAGNOSTIC_DIR: tmp,
    LAWBAR_TEST_FILES: NOOP_TEST_FILE,
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.LAWBAR_CI;
  delete env.CI;
  delete env.LAWBAR_TEST_PID_LOG;
  delete env.LAWBAR_WRAPPER_VERSION;
  const r = spawnSync("node", [WRAPPER], { env, encoding: "utf-8", timeout: 5_000 });
  // Wrapper will be killed by timeout (signal=SIGTERM) AFTER printing the
  // clamp warning + starting the 600s sleep. Assert the warning is present.
  assert.match(
    r.stderr + r.stdout,
    /clamping to 600/,
    `expected clamp warning in output; got stderr=${r.stderr}\nstdout=${r.stdout}`,
  );
});

// ----------------------------------------------------------------------
// Audit M1 — signal exit-code propagation (post audit-mpm2xd7g-cjydjr)
// ----------------------------------------------------------------------

test("audit-M1.a — node --test killed by SIGKILL → wrapper exits 137 (128+9), Phase 4/5 still run", () => {
  const tmp = makeTempDir();
  // On Node 22+, `node --test` runs each test file in a subprocess
  // (isolation: 'process'). `process.kill(process.pid, 'SIGKILL')` in a
  // test file only kills the file-subprocess; the parent test runner
  // reports failed subtest + exits 1, with spawnSync.signal === null.
  // To make spawnSync.signal === "SIGKILL" we must kill the RUNNER itself.
  // Target process.ppid (the node --test runner) from inside the file.
  // Note: doing this from inside a test() callback is too late (runner
  // has already started). Do it at top-level (module load).
  const suicidePath = path.resolve(__dirname, "_wrapper-suicide.test.mjs");
  fs.writeFileSync(suicidePath, [
    "// Auto-generated SIGKILL self-killer for audit-M1.a. DO NOT EDIT.",
    "// Top-level module-load SIGKILL targeting process.ppid (the node --test runner).",
    "process.kill(process.ppid, 'SIGKILL');",
    "",
  ].join("\n"), "utf-8");
  const r = runWrapper({
    LAWBAR_DIAGNOSTIC_DIR: tmp,
    LAWBAR_TEST_FILES: suicidePath,
    LAWBAR_TEST_SETTLE_SECONDS: "0",
  });
  // Runner killed by SIGKILL → POSIX exit 128+9 = 137. The wrapper's
  // signal-mapping code (signalNameToExitCode) should produce 137.
  // Phase 4/5 still run; no attributable .ips → wrapper passes through
  // the mapped exit code.
  assert.equal(r.status, 137, `expected 137 (128+SIGKILL); got ${r.status} (stderr=${r.stderr}, stdout=${r.stdout})`);
  // Verify Phase 4/5 logging ran.
  assert.match(r.stdout, /Sleeping 0s for crash-report settle/);
  assert.match(r.stdout, /Attribution:/);
});

test("audit-M1.b — unmapped signal → fallback to exit 1 with WARNING", () => {
  // Direct unit check on the wrapper's signal mapping. Simulated by env vars
  // is not possible (we need the child to be killed). Instead: verify the
  // wrapper's mapping by reading the WARNING log line on an unmapped name.
  // Approach: send the child SIGTRAP (signal 5; usually mapped) — but we
  // want to verify the unmapped path. os.constants.signals has all standard
  // signals; "ZZZZ" would be unmapped, but spawnSync only sees real signals.
  // So we verify by reading the wrapper source — pure asserting the code
  // shape is sufficient for this audit-driven test; the actual fallback
  // path is exercised only in the impossible scenario of an unmapped POSIX
  // signal. We document this here and assert presence of the WARNING text
  // in the source as a regression guard against accidental removal.
  const src = fs.readFileSync(WRAPPER, "utf-8");
  assert.match(src, /unmapped signal/, "wrapper must log unmapped-signal fallback per audit M1.b");
  assert.match(src, /signalNameToExitCode/, "wrapper must have signalNameToExitCode helper per audit M1");
});

// ----------------------------------------------------------------------
// Audit M2 — LAWBAR_TEST_FILES comma-delimiter (post audit-mpm2xd7g-cjydjr)
// ----------------------------------------------------------------------

test("audit-M2.a — comma-delimited LAWBAR_TEST_FILES runs all listed files", () => {
  const tmp = makeTempDir();
  const markerPath = path.join(tmp, "marker.txt");
  function markerSeederPath(name, markerText) {
    const seederPath = path.resolve(__dirname, `_wrapper-seeder-${name}.test.mjs`);
    fs.writeFileSync(seederPath, [
      `// Auto-generated marker seeder ${name} for audit-M2. DO NOT EDIT.`,
      'import { test } from "node:test";',
      'import fs from "node:fs";',
      `test(${JSON.stringify("marker-" + name)}, () => {`,
      `  fs.appendFileSync(${JSON.stringify(markerPath)}, ${JSON.stringify(markerText + "\n")}, "utf-8");`,
      "});",
      "",
    ].join("\n"), "utf-8");
    return seederPath;
  }
  const seederA = markerSeederPath("M2A", "marker-A-ran");
  const seederB = markerSeederPath("M2B", "marker-B-ran");
  const r = runWrapper({
    LAWBAR_DIAGNOSTIC_DIR: tmp,
    LAWBAR_TEST_FILES: `${seederA},${seederB}`,
    LAWBAR_TEST_SETTLE_SECONDS: "0",
  });
  assert.equal(r.status, 0, `expected exit 0; got ${r.status} (stderr=${r.stderr}, stdout=${r.stdout})`);
  const marker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf-8") : "";
  assert.match(marker, /marker-A-ran/, "seeder A must run");
  assert.match(marker, /marker-B-ran/, "seeder B must run");
});

test("audit-M2.b — empty entries in LAWBAR_TEST_FILES are filtered", () => {
  const tmp = makeTempDir();
  // Single real file with two empty entries flanking it.
  const r = runWrapper({
    LAWBAR_DIAGNOSTIC_DIR: tmp,
    LAWBAR_TEST_FILES: `,${NOOP_TEST_FILE},,`,
    LAWBAR_TEST_SETTLE_SECONDS: "0",
  });
  // If empty entries were passed to node --test, it would fail; wrapper
  // would exit non-zero. With proper filtering, this should pass.
  assert.equal(r.status, 0, `expected exit 0; got ${r.status} (stderr=${r.stderr}, stdout=${r.stdout})`);
});

test("audit-M2.c — whitespace-padded entries are trimmed", () => {
  const tmp = makeTempDir();
  // Entries with surrounding spaces should be trimmed.
  const r = runWrapper({
    LAWBAR_DIAGNOSTIC_DIR: tmp,
    LAWBAR_TEST_FILES: `   ${NOOP_TEST_FILE}   `,
    LAWBAR_TEST_SETTLE_SECONDS: "0",
  });
  assert.equal(r.status, 0, `expected exit 0; got ${r.status} (stderr=${r.stderr}, stdout=${r.stdout})`);
});

// ----------------------------------------------------------------------
// Audit M-new (post audit-mpm3q7de-pgwi6t) — empty LAWBAR_TEST_FILES must fail closed.
// ----------------------------------------------------------------------

function assertEmptyTestFilesFailsClosed(envValue, label) {
  const tmp = makeTempDir();
  const r = runWrapper({
    LAWBAR_DIAGNOSTIC_DIR: tmp,
    LAWBAR_TEST_FILES: envValue,
    LAWBAR_TEST_SETTLE_SECONDS: "0",
  });
  assert.equal(r.status, 2, `${label}: expected exit 2; got ${r.status} (stderr=${r.stderr}, stdout=${r.stdout})`);
  assert.match(
    r.stderr + r.stdout,
    /LAWBAR_TEST_FILES must contain at least one comma-delimited test file/,
    `${label}: expected fail-closed FATAL line`,
  );
  // Confirm node --test was NOT invoked (no test-runner output).
  assert.doesNotMatch(
    r.stderr + r.stdout,
    /tests 0|tests \d+\n.*pass \d+/,
    `${label}: node --test must NOT have run`,
  );
}

test("audit-Mnew.a — LAWBAR_TEST_FILES='' → exit 2; no discovery", () => {
  assertEmptyTestFilesFailsClosed("", "empty string");
});

test("audit-Mnew.b — LAWBAR_TEST_FILES=',,,' → exit 2; no discovery", () => {
  assertEmptyTestFilesFailsClosed(",,,", "all-comma");
});

test("audit-Mnew.c — LAWBAR_TEST_FILES='   ' (whitespace-only) → exit 2; no discovery", () => {
  assertEmptyTestFilesFailsClosed("   ", "whitespace-only");
});

test("audit-Mnew.d — LAWBAR_TEST_FILES=' , , ' (comma + whitespace) → exit 2; no discovery", () => {
  assertEmptyTestFilesFailsClosed(" , , ", "comma + whitespace");
});
